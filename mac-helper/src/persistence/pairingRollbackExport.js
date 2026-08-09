// @ts-check

import { createHash } from "node:crypto";
import { join } from "node:path";
import { parsePairingCredential, parsePairingInvitation } from "../contracts/pairing.js";
import { normalizePairingStateSnapshot } from "./sqlitePairingStateRepository.js";
import { normalizePairingAuthorityState } from "./pairingAuthorityReadRepository.js";
import {
  pairingProjectionHash,
  validatePairingLegacySource,
  withPairingLegacyLocksSync,
} from "./pairingLockedLegacySnapshot.js";

/** @typedef {import("../contracts/pairing.js").PairingCredentialRecord} PairingCredentialRecord */
/** @typedef {import("../contracts/pairing.js").PairingInvitationRecord} PairingInvitationRecord */
/** @typedef {import("../contracts/repository.js").PairingAuthorityRepository} PairingAuthorityRepository */
/** @typedef {import("../contracts/repository.js").PairingAuthorityState} PairingAuthorityState */
/** @typedef {import("../contracts/repository.js").PairingStateReader} PairingStateReader */
/** @typedef {import("../contracts/repository.js").PairingStateSnapshot} PairingStateSnapshot */
/** @typedef {import("../infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("../infrastructure/ports.js").LockManager} LockManager */
/** @typedef {import("../infrastructure/ports.js").LockRequest} LockRequest */

/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   lockRequest: LockRequest,
 * }} LegacySource
 * @typedef {{
 *   backupExistingFiles(): readonly string[],
 *   writeCredential(credential: PairingCredentialRecord): void,
 *   writeInvitations(invitations: readonly PairingInvitationRecord[]): void,
 *   readAndVerify(snapshot: PairingStateSnapshot): PairingStateSnapshot,
 * }} LockedLegacyWriterAccess
 * @typedef {{
 *   expectedRevision: number,
 *   sourceRevision: string,
 *   rolledBackAt: string,
 * }} PairingRollbackRequest
 * @typedef {{
 *   status: "rolled-back" | "already-legacy",
 *   sourceRevision: string,
 *   projectionHash: string | null,
 *   recordCount: number | null,
 *   backups: readonly string[],
 *   snapshot: Readonly<PairingStateSnapshot> | null,
 *   authority: Readonly<PairingAuthorityState>,
 * }} PairingRollbackResult
 * @typedef {{ read(): PairingStateSnapshot }} PairingSnapshotReader
 * @typedef {{ withLockedSources<T>(operation: (access: LockedLegacyWriterAccess) => T): T }} LockedLegacyWriter
 */

const WRITE_OPTIONS = Object.freeze({
  mode: 0o600,
  createParentMode: 0o700,
  replace: true,
  syncDirectory: true,
});

export class PairingLockedLegacyWriter {
  /** @type {AtomicFileStore} */
  #fileStore;
  /** @type {LockManager} */
  #lockManager;
  /** @type {LegacySource} */
  #credentialSource;
  /** @type {LegacySource} */
  #invitationSource;
  /** @type {string} */
  #backupDirectory;

  /**
   * @param {{
   *   fileStore: AtomicFileStore,
   *   lockManager: LockManager,
   *   credentialSource: LegacySource,
   *   invitationSource: LegacySource,
   *   backupDirectory: string,
   * }} options
   */
  constructor({ fileStore, lockManager, credentialSource, invitationSource, backupDirectory }) {
    if (
      !fileStore ||
      typeof fileStore.readTextSync !== "function" ||
      typeof fileStore.writeTextSync !== "function"
    ) {
      throw new Error("Pairing legacy atomic file store is required.");
    }
    if (!lockManager || typeof lockManager.withLockSync !== "function") {
      throw new Error("Pairing legacy lock manager is required.");
    }
    this.#fileStore = fileStore;
    this.#lockManager = lockManager;
    this.#credentialSource = validatePairingLegacySource(credentialSource, "credential");
    this.#invitationSource = validatePairingLegacySource(invitationSource, "invitation");
    if (this.#credentialSource.lockRequest.path === this.#invitationSource.lockRequest.path) {
      throw new Error("Pairing legacy sources must use distinct lock paths.");
    }
    this.#backupDirectory = requireNonEmptyString(
      backupDirectory,
      "Pairing legacy backup directory",
    );
  }

  /**
   * Run one synchronous rollback export operation while both legacy locks are
   * held. The returned access object cannot perform asynchronous writes.
   *
   * @template T
   * @param {(access: LockedLegacyWriterAccess) => T} operation
   * @returns {T}
   */
  withLockedSources(operation) {
    if (typeof operation !== "function") {
      throw new Error("Pairing legacy writer operation must be a function.");
    }
    if (operation.constructor?.name === "AsyncFunction") {
      throw new Error("Pairing legacy writer operation must complete synchronously.");
    }
    return withPairingLegacyLocksSync(
      this.#lockManager,
      this.#credentialSource,
      this.#invitationSource,
      () => {
        /** @type {LockedLegacyWriterAccess} */
        const access = {
          backupExistingFiles: () => Object.freeze(this.#backupExistingFiles()),
          writeCredential: (credential) => this.#writeCredential(credential),
          writeInvitations: (invitations) => this.#writeInvitations(invitations),
          readAndVerify: (snapshot) => this.#readAndVerify(snapshot),
        };
        const result = operation(access);
        if (isThenable(result)) {
          throw new Error("Pairing legacy writer operation must complete synchronously.");
        }
        return result;
      },
    );
  }

  /** @returns {string[]} */
  #backupExistingFiles() {
    const backups = [];
    for (const source of [
      { role: "credential", source: this.#credentialSource },
      { role: "invitations", source: this.#invitationSource },
    ]) {
      let raw;
      try {
        raw = this.#fileStore.readTextSync(source.source.path);
      } catch (error) {
        if (hasErrorCode(error, "ENOENT")) continue;
        throw error;
      }
      const digest = sha256(raw);
      const backupPath = join(
        this.#backupDirectory,
        `${source.role}-${sanitizeSourceName(source.source.name)}.${digest}.bak`,
      );
      try {
        this.#fileStore.writeTextSync(backupPath, raw, {
          mode: 0o600,
          createParentMode: 0o700,
          replace: false,
          syncDirectory: true,
        });
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
      }
      if (this.#fileStore.readTextSync(backupPath) !== raw) {
        throw new Error(`Pairing legacy backup content mismatch: ${backupPath}.`);
      }
      backups.push(backupPath);
    }
    return backups;
  }

  /** @param {PairingCredentialRecord} credential */
  #writeCredential(credential) {
    this.#fileStore.writeTextSync(
      this.#credentialSource.path,
      serializeJSON(credential),
      WRITE_OPTIONS,
    );
  }

  /** @param {readonly PairingInvitationRecord[]} invitations */
  #writeInvitations(invitations) {
    this.#fileStore.writeTextSync(
      this.#invitationSource.path,
      serializeJSON(invitations),
      WRITE_OPTIONS,
    );
  }

  /**
   * Reread both files, require the canonical store shapes, and compare their
   * normalized projection to the SQLite snapshot before authority changes.
   *
   * @param {PairingStateSnapshot} snapshot
   * @returns {PairingStateSnapshot}
   */
  #readAndVerify(snapshot) {
    const expected = normalizePairingStateSnapshot(snapshot);
    if (!expected.credential) {
      throw new Error("Pairing rollback requires a non-null SQLite credential.");
    }
    const credentialRaw = this.#fileStore.readTextSync(this.#credentialSource.path);
    const invitationRaw = this.#fileStore.readTextSync(this.#invitationSource.path);
    let rawInvitations;
    try {
      rawInvitations = JSON.parse(invitationRaw);
    } catch (error) {
      throw new Error("Pairing invitation legacy reread is not valid JSON.", { cause: error });
    }
    if (!Array.isArray(rawInvitations)) {
      throw new Error("Pairing invitation legacy reread must contain an array.");
    }
    let rawCredential;
    try {
      rawCredential = JSON.parse(credentialRaw);
    } catch (error) {
      throw new Error("Pairing credential legacy reread is not valid JSON.", { cause: error });
    }
    const verified = normalizePairingStateSnapshot({
      credential: parsePairingCredential(rawCredential),
      invitations: rawInvitations.map((value) => parsePairingInvitation(value)),
    });
    if (pairingProjectionHash(verified) !== pairingProjectionHash(expected)) {
      throw new Error("Pairing legacy reread projection did not match the SQLite snapshot.");
    }
    return immutablePairingSnapshot(verified);
  }
}

export class PairingRollbackCoordinator {
  /** @type {PairingAuthorityRepository} */
  #authorityRepository;
  /** @type {PairingSnapshotReader} */
  #sqliteRepository;
  /** @type {LockedLegacyWriter} */
  #legacyWriter;

  /**
   * @param {{
   *   authorityRepository: PairingAuthorityRepository,
   *   sqliteRepository: PairingSnapshotReader,
   *   legacyWriter: LockedLegacyWriter,
   * }} options
   */
  constructor({ authorityRepository, sqliteRepository, legacyWriter }) {
    this.#authorityRepository = requireAuthorityRepository(authorityRepository);
    this.#sqliteRepository = requirePairingStateReader(sqliteRepository);
    this.#legacyWriter = requireLegacyWriter(legacyWriter);
  }

  /** @param {unknown} request @returns {Readonly<PairingRollbackResult>} */
  run(request) {
    const normalized = normalizeRequest(request);
    const current = normalizePairingAuthorityState(this.#authorityRepository.current());
    if (current.mode === "legacy") {
      if (current.revision !== normalized.expectedRevision + 1) {
        throw new Error("Pairing rollback retry does not match the completed legacy epoch.");
      }
      return alreadyLegacyResult(normalized.sourceRevision, current);
    }
    requireActiveRollbackState(current, normalized);
    requireRollbackWindow(current, normalized.rolledBackAt);

    const result = this.#legacyWriter.withLockedSources((access) => {
      const latest = normalizePairingAuthorityState(this.#authorityRepository.current());
      requireActiveRollbackState(latest, normalized);
      requireRollbackWindow(latest, normalized.rolledBackAt);
      const snapshot = immutablePairingSnapshot(
        normalizePairingStateSnapshot(this.#sqliteRepository.read()),
      );
      if (!snapshot.credential) {
        throw new Error("Pairing rollback requires a non-null SQLite credential.");
      }
      const backups = access.backupExistingFiles();
      access.writeCredential(snapshot.credential);
      access.writeInvitations(snapshot.invitations);
      const verified = access.readAndVerify(snapshot);
      const sourceRevision = requireHash(latest.sourceRevision, "Pairing authority sourceRevision");
      const authority = normalizePairingAuthorityState(
        this.#authorityRepository.rollbackToLegacy({
          expectedRevision: latest.revision,
          sourceRevision,
          rolledBackAt: normalized.rolledBackAt,
        }),
      );
      requireRolledBackState(authority, normalized);
      return Object.freeze({
        status: "rolled-back",
        sourceRevision,
        projectionHash: pairingProjectionHash(verified),
        recordCount: (verified.credential ? 1 : 0) + verified.invitations.length,
        backups: Object.freeze([...backups]),
        snapshot: immutablePairingSnapshot(verified),
        authority,
      });
    });
    if (isThenable(result)) {
      throw new Error("Pairing rollback locked operation must complete synchronously.");
    }
    return result;
  }
}

/** @param {unknown} value @returns {PairingRollbackRequest} */
function normalizeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing rollback request must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  return {
    expectedRevision: requireTransitionRevision(
      values.expectedRevision,
      "Pairing rollback expectedRevision",
    ),
    sourceRevision: requireHash(values.sourceRevision, "Pairing rollback sourceRevision"),
    rolledBackAt: requireCanonicalTimestamp(values.rolledBackAt, "Pairing rolledBackAt").value,
  };
}

/**
 * @param {Readonly<PairingAuthorityState>} state
 * @param {PairingRollbackRequest} request
 */
function requireActiveRollbackState(state, request) {
  if (
    state.mode !== "sqlite-rollback" ||
    state.revision !== request.expectedRevision ||
    state.sourceRevision !== request.sourceRevision
  ) {
    throw new Error("Pairing authority does not match the requested rollback epoch.");
  }
}

/** @param {Readonly<PairingAuthorityState>} state @param {string} rolledBackAt */
function requireRollbackWindow(state, rolledBackAt) {
  const rollbackAt = requireCanonicalTimestamp(rolledBackAt, "Pairing rolledBackAt");
  const cutoverAt = requireCanonicalTimestamp(state.cutoverAt, "Pairing cutoverAt");
  const rollbackExpiresAt = requireCanonicalTimestamp(
    state.rollbackExpiresAt,
    "Pairing rollbackExpiresAt",
  );
  if (rollbackAt.time < cutoverAt.time) {
    throw new Error("Pairing rollback cannot precede cutover.");
  }
  if (rollbackAt.time >= rollbackExpiresAt.time) {
    throw new Error("Pairing rollback window has expired.");
  }
}

/** @param {Readonly<PairingAuthorityState>} state @param {PairingRollbackRequest} request */
function requireRolledBackState(state, request) {
  if (state.mode !== "legacy" || state.revision !== request.expectedRevision + 1) {
    throw new Error("Pairing rollback authority did not persist the exact legacy transition.");
  }
}

/**
 * @param {string} sourceRevision
 * @param {Readonly<PairingAuthorityState>} authority
 * @returns {Readonly<PairingRollbackResult>}
 */
function alreadyLegacyResult(sourceRevision, authority) {
  return Object.freeze({
    status: "already-legacy",
    sourceRevision,
    projectionHash: null,
    recordCount: null,
    backups: Object.freeze([]),
    snapshot: null,
    authority,
  });
}

/** @param {unknown} value @returns {PairingAuthorityRepository} */
function requireAuthorityRepository(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing authority repository is required.");
  }
  const repository = /** @type {Record<string, unknown>} */ (value);
  for (const method of ["current", "rollbackToLegacy"]) {
    if (typeof repository[method] !== "function") {
      throw new Error(`Pairing authority repository must implement ${method}().`);
    }
  }
  return /** @type {PairingAuthorityRepository} */ (value);
}

/** @param {unknown} value @returns {PairingSnapshotReader} */
function requirePairingStateReader(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite pairing state reader is required.");
  }
  const reader = /** @type {Record<string, unknown>} */ (value);
  if (typeof reader.read !== "function") {
    throw new Error("SQLite pairing state reader must implement read().");
  }
  return /** @type {PairingSnapshotReader} */ (value);
}

/** @param {unknown} value @returns {LockedLegacyWriter} */
function requireLegacyWriter(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing locked legacy writer is required.");
  }
  const writer = /** @type {Record<string, unknown>} */ (value);
  if (typeof writer.withLockedSources !== "function") {
    throw new Error("Pairing locked legacy writer must implement withLockedSources().");
  }
  return /** @type {LockedLegacyWriter} */ (value);
}

/** @param {PairingStateSnapshot} snapshot @returns {Readonly<PairingStateSnapshot>} */
function immutablePairingSnapshot(snapshot) {
  const normalized = normalizePairingStateSnapshot(snapshot);
  return Object.freeze({
    credential: normalized.credential === null ? null : Object.freeze({ ...normalized.credential }),
    invitations: Object.freeze(
      normalized.invitations.map((invitation) => Object.freeze({ ...invitation })),
    ),
  });
}

/** @param {unknown} value */
function serializeJSON(value) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new Error("Pairing value is not JSON serializable.");
  return serialized;
}

/** @param {unknown} value @param {string} label */
function requireCanonicalTimestamp(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return { value, time };
}

/** @param {unknown} value @param {string} label */
function requireTransitionRevision(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  if (value >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} cannot be incremented safely.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

/** @param {string} value */
function sanitizeSourceName(value) {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) throw new Error("Pairing legacy source name has no safe backup characters.");
  return sanitized;
}

/** @param {unknown} value */
function isThenable(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (/** @type {{ then?: unknown }} */ (value).then) === "function"
  );
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    /** @type {{ code?: unknown }} */ (error).code === code
  );
}

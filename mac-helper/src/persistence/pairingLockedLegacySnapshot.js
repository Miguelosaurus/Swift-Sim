// @ts-check

import { createHash } from "node:crypto";
import { join } from "node:path";
import { parsePairingCredential, parsePairingInvitation } from "../contracts/pairing.js";
import { normalizePairingStateSnapshot } from "./sqlitePairingStateRepository.js";

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
 *   role: "credential" | "invitations",
 *   source: LegacySource,
 *   raw: string | null,
 *   digest: string | null,
 *   backupPath: string | null,
 * }} LoadedLegacySource
 * @typedef {{
 *   snapshot: PairingStateSnapshot,
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 * }} LockedPairingLegacySnapshot
 */

const BACKUP_WRITE_OPTIONS = Object.freeze({
  mode: 0o600,
  createParentMode: 0o700,
  replace: false,
  syncDirectory: true,
});

export class PairingLockedLegacySnapshotReader {
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
  constructor({
    fileStore,
    lockManager,
    credentialSource,
    invitationSource,
    backupDirectory,
  }) {
    if (!fileStore || typeof fileStore.readTextSync !== "function") {
      throw new Error("Pairing legacy atomic file store is required.");
    }
    if (!lockManager || typeof lockManager.withLockSync !== "function") {
      throw new Error("Pairing legacy lock manager is required.");
    }
    this.#fileStore = fileStore;
    this.#lockManager = lockManager;
    this.#credentialSource = validateSource(credentialSource, "credential");
    this.#invitationSource = validateSource(invitationSource, "invitation");
    if (this.#credentialSource.lockRequest.path === this.#invitationSource.lockRequest.path) {
      throw new Error("Pairing legacy sources must use distinct lock paths.");
    }
    this.#backupDirectory = requireNonEmptyString(
      backupDirectory,
      "Pairing legacy backup directory",
    );
  }

  /**
   * Execute a synchronous operation while the exact credential and invitation
   * source bytes remain protected by their existing legacy locks.
   *
   * @template T
   * @param {(lockedSnapshot: LockedPairingLegacySnapshot) => T} operation
   * @returns {T}
   */
  withLockedSnapshot(operation) {
    if (typeof operation !== "function") {
      throw new Error("Pairing locked snapshot operation must be a function.");
    }
    if (operation.constructor?.name === "AsyncFunction") {
      throw new Error("Pairing locked snapshot operation must complete synchronously.");
    }
    const lockRequests = [
      this.#credentialSource.lockRequest,
      this.#invitationSource.lockRequest,
    ].sort(compareLockPaths);
    return withLocksSync(this.#lockManager, lockRequests, () => {
      const lockedSnapshot = this.#readLockedSnapshot();
      const result = operation(lockedSnapshot);
      if (isThenable(result)) {
        throw new Error("Pairing locked snapshot operation must complete synchronously.");
      }
      return result;
    });
  }

  /** @returns {LockedPairingLegacySnapshot} */
  #readLockedSnapshot() {
    const credentialSource = this.#loadSource("credential", this.#credentialSource, true);
    const invitationSource = this.#loadSource("invitations", this.#invitationSource, false);
    const sources = [credentialSource, invitationSource];

    for (const loaded of sources) this.#publishBackup(loaded);

    const snapshot = immutablePairingSnapshot(
      parseLegacySnapshot(credentialSource, invitationSource),
    );
    const backups = Object.freeze(
      sources.map((source) => source.backupPath).filter((path) => path !== null),
    );
    return Object.freeze({
      snapshot,
      sourceRevision: sourceRevisionFor(sources),
      projectionHash: pairingProjectionHash(snapshot),
      recordCount: (snapshot.credential ? 1 : 0) + snapshot.invitations.length,
      backups,
    });
  }

  /**
   * @param {"credential" | "invitations"} role
   * @param {LegacySource} source
   * @param {boolean} required
   * @returns {LoadedLegacySource}
   */
  #loadSource(role, source, required) {
    try {
      const raw = this.#fileStore.readTextSync(source.path);
      return {
        role,
        source,
        raw,
        digest: sha256(raw),
        backupPath: null,
      };
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
      if (required) {
        throw new Error(`Required pairing legacy source is missing: ${source.path}.`);
      }
      return {
        role,
        source,
        raw: null,
        digest: null,
        backupPath: null,
      };
    }
  }

  /** @param {LoadedLegacySource} loaded */
  #publishBackup(loaded) {
    if (loaded.raw === null || loaded.digest === null) return;
    const safeName = sanitizeSourceName(loaded.source.name);
    const backupPath = join(
      this.#backupDirectory,
      `${loaded.role}-${safeName}.${loaded.digest}.bak`,
    );
    try {
      this.#fileStore.writeTextSync(backupPath, loaded.raw, BACKUP_WRITE_OPTIONS);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
    }
    const persisted = this.#fileStore.readTextSync(backupPath);
    if (persisted !== loaded.raw) {
      throw new Error(`Pairing legacy backup content mismatch: ${backupPath}.`);
    }
    loaded.backupPath = backupPath;
  }
}

/** @param {PairingStateSnapshot} snapshot */
export function pairingProjectionHash(snapshot) {
  return sha256(JSON.stringify(normalizePairingStateSnapshot(snapshot)));
}

/**
 * @param {LoadedLegacySource} credentialSource
 * @param {LoadedLegacySource} invitationSource
 * @returns {PairingStateSnapshot}
 */
function parseLegacySnapshot(credentialSource, invitationSource) {
  if (credentialSource.raw === null) {
    throw new Error("Required pairing credential source was not loaded.");
  }
  const credential = parsePairingCredential(
    parseJSON(credentialSource.raw, credentialSource.source),
  );
  const rawInvitations =
    invitationSource.raw === null ? [] : parseJSON(invitationSource.raw, invitationSource.source);
  if (!Array.isArray(rawInvitations)) {
    throw new Error(
      `Pairing legacy invitation source must contain an array: ${invitationSource.source.path}.`,
    );
  }
  const invitations = rawInvitations.map((value) => parsePairingInvitation(value));
  return normalizePairingStateSnapshot({ credential, invitations });
}

/** @param {PairingStateSnapshot} snapshot */
function immutablePairingSnapshot(snapshot) {
  const normalized = normalizePairingStateSnapshot(snapshot);
  return Object.freeze({
    credential:
      normalized.credential === null ? null : Object.freeze({ ...normalized.credential }),
    invitations: Object.freeze(
      normalized.invitations.map((invitation) => Object.freeze({ ...invitation })),
    ),
  });
}

/** @param {string} raw @param {LegacySource} source */
function parseJSON(raw, source) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in pairing legacy source ${source.path}.`, { cause: error });
  }
}

/** @param {readonly LoadedLegacySource[]} sources */
function sourceRevisionFor(sources) {
  return sha256(
    JSON.stringify({
      version: 1,
      sources: sources.map((loaded) => ({
        role: loaded.role,
        name: loaded.source.name,
        present: loaded.raw !== null,
        digest: loaded.digest,
      })),
    }),
  );
}

/**
 * @template T
 * @param {LockManager} lockManager
 * @param {readonly LockRequest[]} requests
 * @param {() => T} operation
 * @param {number} [index]
 * @returns {T}
 */
function withLocksSync(lockManager, requests, operation, index = 0) {
  const request = requests[index];
  if (!request) return operation();
  return lockManager.withLockSync(request, () =>
    withLocksSync(lockManager, requests, operation, index + 1),
  );
}

/** @param {LockRequest} left @param {LockRequest} right */
function compareLockPaths(left, right) {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  return 0;
}

/** @param {LegacySource} source @param {string} label */
function validateSource(source, label) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`Pairing legacy ${label} source is required.`);
  }
  return {
    name: requireNonEmptyString(source.name, `Pairing legacy ${label} source name`),
    path: requireNonEmptyString(source.path, `Pairing legacy ${label} source path`),
    lockRequest: validateLockRequest(source.lockRequest, label),
  };
}

/** @param {LockRequest} request @param {string} label */
function validateLockRequest(request, label) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error(`Pairing legacy ${label} lock request is required.`);
  }
  return {
    path: requireNonEmptyString(request.path, `Pairing legacy ${label} lock path`),
    waitMs: request.waitMs,
    staleAfterMs: request.staleAfterMs,
    ownerMode: request.ownerMode,
  };
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
    typeof /** @type {{ then?: unknown }} */ (value).then === "function"
  );
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
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

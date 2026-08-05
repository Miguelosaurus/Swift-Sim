// @ts-check

import { createHash } from "node:crypto";
import { join } from "node:path";
import { parsePairingCredential, parsePairingInvitation } from "../contracts/pairing.js";
import { normalizePairingStateSnapshot } from "./sqlitePairingStateRepository.js";

/** @typedef {import("../contracts/repository.js").LegacyImportCheckpoint} LegacyImportCheckpoint */
/** @typedef {import("../contracts/repository.js").LegacyImportCheckpointRepository} LegacyImportCheckpointRepository */
/** @typedef {import("../contracts/repository.js").PairingStateRepository} PairingStateRepository */
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
 *   required: boolean,
 *   raw: string | null,
 *   digest: string | null,
 *   backupPath: string | null,
 * }} LoadedLegacySource
 * @typedef {{
 *   status: "applied" | "checkpointed" | "already-current",
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 * }} PairingLegacyImportResult
 */

const BACKUP_WRITE_OPTIONS = Object.freeze({
  mode: 0o600,
  createParentMode: 0o700,
  replace: false,
  syncDirectory: true,
});

export class PairingLegacyImportCoordinator {
  /** @type {PairingStateRepository} */
  #pairingRepository;
  /** @type {LegacyImportCheckpointRepository} */
  #checkpointRepository;
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
  /** @type {string} */
  #checkpointSource;
  /** @type {() => string} */
  #now;

  /**
   * @param {{
   *   pairingRepository: PairingStateRepository,
   *   checkpointRepository: LegacyImportCheckpointRepository,
   *   fileStore: AtomicFileStore,
   *   lockManager: LockManager,
   *   credentialSource: LegacySource,
   *   invitationSource: LegacySource,
   *   backupDirectory: string,
   *   checkpointSource?: string,
   *   now?: () => string,
   * }} options
   */
  constructor({
    pairingRepository,
    checkpointRepository,
    fileStore,
    lockManager,
    credentialSource,
    invitationSource,
    backupDirectory,
    checkpointSource = "pairing-state-v1",
    now = () => new Date().toISOString(),
  }) {
    this.#pairingRepository = pairingRepository;
    this.#checkpointRepository = checkpointRepository;
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
    this.#checkpointSource = requireNonEmptyString(
      checkpointSource,
      "Pairing legacy checkpoint source",
    );
    this.#now = now;
  }

  /** @returns {PairingLegacyImportResult} */
  run() {
    const lockRequests = [
      this.#credentialSource.lockRequest,
      this.#invitationSource.lockRequest,
    ].sort(compareLockPaths);
    return withLocksSync(this.#lockManager, lockRequests, () => this.#runLocked());
  }

  /** @returns {PairingLegacyImportResult} */
  #runLocked() {
    const credentialSource = this.#loadSource("credential", this.#credentialSource, true);
    const invitationSource = this.#loadSource("invitations", this.#invitationSource, false);
    const sources = [credentialSource, invitationSource];

    for (const loaded of sources) this.#publishBackup(loaded);

    const snapshot = parseLegacySnapshot(credentialSource, invitationSource);
    const sourceRevision = sourceRevisionFor(sources);
    const projectionHash = projectionHashFor(snapshot);
    const recordCount = (snapshot.credential ? 1 : 0) + snapshot.invitations.length;
    const checkpoint = {
      source: this.#checkpointSource,
      sourceRevision,
      projectionHash,
      importedAt: requireTimestamp(this.#now(), "Pairing legacy importedAt"),
      recordCount,
    };
    const backups = sources
      .map((source) => source.backupPath)
      .filter((path) => path !== null);

    const existingProjectionHash = projectionHashFor(this.#pairingRepository.read());
    if (existingProjectionHash === projectionHash) {
      const existingCheckpoint = this.#checkpointRepository.get(this.#checkpointSource);
      if (checkpointMatches(existingCheckpoint, checkpoint)) {
        return {
          status: "already-current",
          sourceRevision,
          projectionHash,
          recordCount,
          backups,
        };
      }
      this.#writeAndVerifyCheckpoint(checkpoint);
      return {
        status: "checkpointed",
        sourceRevision,
        projectionHash,
        recordCount,
        backups,
      };
    }

    this.#pairingRepository.replace(snapshot);
    if (projectionHashFor(this.#pairingRepository.read()) !== projectionHash) {
      throw new Error("Pairing SQLite projection did not match after legacy import.");
    }
    this.#writeAndVerifyCheckpoint(checkpoint);
    if (projectionHashFor(this.#pairingRepository.read()) !== projectionHash) {
      throw new Error("Pairing SQLite projection changed while recording the import checkpoint.");
    }
    return {
      status: "applied",
      sourceRevision,
      projectionHash,
      recordCount,
      backups,
    };
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
        required,
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
        required,
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
      const existing = this.#fileStore.readTextSync(backupPath);
      if (existing !== loaded.raw) {
        throw new Error(`Pairing legacy backup content mismatch: ${backupPath}.`);
      }
    }
    loaded.backupPath = backupPath;
  }

  /** @param {LegacyImportCheckpoint} checkpoint */
  #writeAndVerifyCheckpoint(checkpoint) {
    this.#checkpointRepository.upsert(checkpoint);
    const persisted = this.#checkpointRepository.get(checkpoint.source);
    if (!checkpointMatches(persisted, checkpoint) || persisted?.importedAt !== checkpoint.importedAt) {
      throw new Error("Pairing legacy import checkpoint did not persist exactly.");
    }
  }
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
  const credential = parsePairingCredential(parseJSON(credentialSource.raw, credentialSource.source));
  const rawInvitations =
    invitationSource.raw === null ? [] : parseJSON(invitationSource.raw, invitationSource.source);
  if (!Array.isArray(rawInvitations)) {
    throw new Error(`Pairing legacy invitation source must contain an array: ${invitationSource.source.path}.`);
  }
  const invitations = rawInvitations.map((value) => parsePairingInvitation(value));
  return normalizePairingStateSnapshot({ credential, invitations });
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

/** @param {PairingStateSnapshot} snapshot */
function projectionHashFor(snapshot) {
  return sha256(JSON.stringify(normalizePairingStateSnapshot(snapshot)));
}

/**
 * @param {LegacyImportCheckpoint | null} actual
 * @param {LegacyImportCheckpoint} expected
 */
function checkpointMatches(actual, expected) {
  return (
    actual !== null &&
    actual.source === expected.source &&
    actual.sourceRevision === expected.sourceRevision &&
    actual.projectionHash === expected.projectionHash &&
    actual.recordCount === expected.recordCount
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
  return left.path.localeCompare(right.path);
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

/** @param {unknown} value @param {string} label */
function requireTimestamp(value, label) {
  const timestamp = requireNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`${label} must be a valid timestamp.`);
  return timestamp;
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

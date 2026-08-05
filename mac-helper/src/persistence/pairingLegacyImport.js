// @ts-check

import {
  PairingLockedLegacySnapshotReader,
  pairingProjectionHash,
} from "./pairingLockedLegacySnapshot.js";
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
 *   snapshot: PairingStateSnapshot,
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 * }} LockedPairingLegacySnapshot
 * @typedef {{
 *   status: "applied" | "checkpointed" | "already-current",
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 * }} PairingLegacyImportResult
 */

export class PairingLegacyImportCoordinator {
  /** @type {PairingLockedLegacySnapshotReader} */
  #snapshotReader;
  /** @type {PairingLegacyImportApplier} */
  #applier;

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
    this.#snapshotReader = new PairingLockedLegacySnapshotReader({
      fileStore,
      lockManager,
      credentialSource,
      invitationSource,
      backupDirectory,
    });
    this.#applier = new PairingLegacyImportApplier({
      pairingRepository,
      checkpointRepository,
      checkpointSource,
      now,
    });
  }

  /** @returns {PairingLegacyImportResult} */
  run() {
    return this.#snapshotReader.withLockedSnapshot((lockedSnapshot) =>
      this.#applier.apply(lockedSnapshot),
    );
  }
}

export class PairingLegacyImportApplier {
  /** @type {PairingStateRepository} */
  #pairingRepository;
  /** @type {LegacyImportCheckpointRepository} */
  #checkpointRepository;
  /** @type {string} */
  #checkpointSource;
  /** @type {() => string} */
  #now;

  /**
   * @param {{
   *   pairingRepository: PairingStateRepository,
   *   checkpointRepository: LegacyImportCheckpointRepository,
   *   checkpointSource?: string,
   *   now?: () => string,
   * }} options
   */
  constructor({
    pairingRepository,
    checkpointRepository,
    checkpointSource = "pairing-state-v1",
    now = () => new Date().toISOString(),
  }) {
    if (
      !pairingRepository ||
      typeof pairingRepository.read !== "function" ||
      typeof pairingRepository.replace !== "function"
    ) {
      throw new Error("Pairing SQLite state repository is required.");
    }
    if (
      !checkpointRepository ||
      typeof checkpointRepository.get !== "function" ||
      typeof checkpointRepository.upsert !== "function"
    ) {
      throw new Error("Pairing legacy checkpoint repository is required.");
    }
    if (typeof now !== "function") {
      throw new Error("Pairing legacy import clock must be a function.");
    }
    this.#pairingRepository = pairingRepository;
    this.#checkpointRepository = checkpointRepository;
    this.#checkpointSource = requireNonEmptyString(
      checkpointSource,
      "Pairing legacy checkpoint source",
    );
    this.#now = now;
  }

  /**
   * Apply one immutable snapshot while its caller still owns the legacy source
   * locks. The future cutover coordinator can activate authority after this
   * method returns and before leaving the same locked callback.
   *
   * @param {LockedPairingLegacySnapshot} lockedSnapshot
   * @returns {PairingLegacyImportResult}
   */
  apply(lockedSnapshot) {
    const locked = normalizeLockedSnapshot(lockedSnapshot);
    const checkpoint = {
      source: this.#checkpointSource,
      sourceRevision: locked.sourceRevision,
      projectionHash: locked.projectionHash,
      importedAt: requireTimestamp(this.#now(), "Pairing legacy importedAt"),
      recordCount: locked.recordCount,
    };

    const existingProjectionHash = pairingProjectionHash(this.#pairingRepository.read());
    if (existingProjectionHash === locked.projectionHash) {
      const existingCheckpoint = this.#checkpointRepository.get(this.#checkpointSource);
      if (checkpointMatches(existingCheckpoint, checkpoint)) {
        return importResult("already-current", locked);
      }
      this.#writeAndVerifyCheckpoint(checkpoint);
      return importResult("checkpointed", locked);
    }

    this.#pairingRepository.replace(locked.snapshot);
    if (pairingProjectionHash(this.#pairingRepository.read()) !== locked.projectionHash) {
      throw new Error("Pairing SQLite projection did not match after legacy import.");
    }
    this.#writeAndVerifyCheckpoint(checkpoint);
    if (pairingProjectionHash(this.#pairingRepository.read()) !== locked.projectionHash) {
      throw new Error("Pairing SQLite projection changed while recording the import checkpoint.");
    }
    return importResult("applied", locked);
  }

  /** @param {LegacyImportCheckpoint} checkpoint */
  #writeAndVerifyCheckpoint(checkpoint) {
    this.#checkpointRepository.upsert(checkpoint);
    const persisted = this.#checkpointRepository.get(checkpoint.source);
    if (
      !checkpointMatches(persisted, checkpoint) ||
      persisted?.importedAt !== checkpoint.importedAt
    ) {
      throw new Error("Pairing legacy import checkpoint did not persist exactly.");
    }
  }
}

/**
 * @param {"applied" | "checkpointed" | "already-current"} status
 * @param {LockedPairingLegacySnapshot} locked
 * @returns {PairingLegacyImportResult}
 */
function importResult(status, locked) {
  return {
    status,
    sourceRevision: locked.sourceRevision,
    projectionHash: locked.projectionHash,
    recordCount: locked.recordCount,
    backups: locked.backups,
  };
}

/** @param {unknown} value @returns {LockedPairingLegacySnapshot} */
function normalizeLockedSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing locked legacy snapshot must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  const snapshot = normalizePairingStateSnapshot(
    /** @type {PairingStateSnapshot} */ (values.snapshot),
  );
  const sourceRevision = requireHash(values.sourceRevision, "Pairing legacy sourceRevision");
  const projectionHash = requireHash(values.projectionHash, "Pairing legacy projectionHash");
  if (pairingProjectionHash(snapshot) !== projectionHash) {
    throw new Error("Pairing locked snapshot projectionHash does not match its snapshot.");
  }
  const recordCount = requireSafeInteger(values.recordCount, "Pairing legacy recordCount");
  const expectedRecordCount = (snapshot.credential ? 1 : 0) + snapshot.invitations.length;
  if (recordCount !== expectedRecordCount) {
    throw new Error("Pairing locked snapshot recordCount does not match its snapshot.");
  }
  if (!Array.isArray(values.backups)) {
    throw new Error("Pairing locked snapshot backups must be an array.");
  }
  const backups = Object.freeze(
    values.backups.map((path) =>
      requireNonEmptyString(path, "Pairing locked snapshot backup path"),
    ),
  );
  return Object.freeze({
    snapshot: Object.freeze({
      credential: snapshot.credential === null ? null : Object.freeze({ ...snapshot.credential }),
      invitations: Object.freeze(
        snapshot.invitations.map((invitation) => Object.freeze({ ...invitation })),
      ),
    }),
    sourceRevision,
    projectionHash,
    recordCount,
    backups,
  });
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

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireSafeInteger(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
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

/** @param {unknown} value @param {string} label */
function requireTimestamp(value, label) {
  const timestamp = requireNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp;
}

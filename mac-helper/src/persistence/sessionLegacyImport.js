// @ts-check

import { durableSessionProjectionHash } from "./sessionDurableProjection.js";
import { SessionLockedLegacySnapshotReader } from "./sessionLockedLegacySnapshot.js";
import { normalizeDurableSessions } from "./sqliteDurableSessionRepository.js";

/** @typedef {import("../contracts/durableSessionRepository.js").DurableSessionRepository} DurableSessionRepository */
/** @typedef {import("../contracts/repository.js").LegacyImportCheckpoint} LegacyImportCheckpoint */
/** @typedef {import("../contracts/repository.js").LegacyImportCheckpointRepository} LegacyImportCheckpointRepository */
/** @typedef {import("../infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("../infrastructure/ports.js").Clock} Clock */
/** @typedef {import("../infrastructure/ports.js").LockManager} LockManager */
/** @typedef {import("../infrastructure/ports.js").LockRequest} LockRequest */
/** @typedef {import("../contracts/durableSession.js").DurableSessionRecord} DurableSessionRecord */

/**
 * @typedef {{ name: string, path: string, lockRequest: LockRequest }} SessionLegacySource
 * @typedef {{
 *   snapshot: readonly DurableSessionRecord[],
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 * }} LockedSessionLegacySnapshot
 * @typedef {{
 *   status: "applied" | "checkpointed" | "already-current",
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 * }} SessionLegacyImportResult
 */

export class SessionLegacyImportCoordinator {
  #snapshotReader;
  #applier;

  /**
   * @param {{
   *   sessionRepository: DurableSessionRepository,
   *   checkpointRepository: LegacyImportCheckpointRepository,
   *   fileStore: AtomicFileStore,
   *   lockManager: LockManager,
   *   source: SessionLegacySource,
   *   backupDirectory: string,
   *   clock: Clock,
   *   checkpointSource?: string,
   * }} options
   */
  constructor({
    sessionRepository,
    checkpointRepository,
    fileStore,
    lockManager,
    source,
    backupDirectory,
    clock,
    checkpointSource = "durable-session-state-v1",
  }) {
    this.#snapshotReader = new SessionLockedLegacySnapshotReader({
      fileStore,
      lockManager,
      source,
      backupDirectory,
    });
    this.#applier = new SessionLegacyImportApplier({
      sessionRepository,
      checkpointRepository,
      clock,
      checkpointSource,
    });
  }

  /** @returns {SessionLegacyImportResult} */
  run() {
    return this.#snapshotReader.withLockedSnapshot((snapshot) =>
      this.#applier.apply(snapshot),
    );
  }
}

export class SessionLegacyImportApplier {
  /** @type {DurableSessionRepository} */
  #sessionRepository;
  /** @type {LegacyImportCheckpointRepository} */
  #checkpointRepository;
  /** @type {Clock} */
  #clock;
  /** @type {string} */
  #checkpointSource;

  /**
   * @param {{
   *   sessionRepository: DurableSessionRepository,
   *   checkpointRepository: LegacyImportCheckpointRepository,
   *   clock: Clock,
   *   checkpointSource?: string,
   * }} options
   */
  constructor({
    sessionRepository,
    checkpointRepository,
    clock,
    checkpointSource = "durable-session-state-v1",
  }) {
    if (
      !sessionRepository ||
      typeof sessionRepository.list !== "function" ||
      typeof sessionRepository.replace !== "function"
    ) {
      throw new Error("Durable-session SQLite repository is required.");
    }
    if (
      !checkpointRepository ||
      typeof checkpointRepository.get !== "function" ||
      typeof checkpointRepository.upsert !== "function"
    ) {
      throw new Error("Session legacy checkpoint repository is required.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new Error("Session legacy import clock is required.");
    }
    this.#sessionRepository = sessionRepository;
    this.#checkpointRepository = checkpointRepository;
    this.#clock = clock;
    this.#checkpointSource = requireNonEmptyString(
      checkpointSource,
      "Session legacy checkpoint source",
    );
  }

  /** @param {LockedSessionLegacySnapshot} lockedSnapshot @returns {SessionLegacyImportResult} */
  apply(lockedSnapshot) {
    const locked = normalizeLockedSnapshot(lockedSnapshot);
    const checkpoint = {
      source: this.#checkpointSource,
      sourceRevision: locked.sourceRevision,
      projectionHash: locked.projectionHash,
      importedAt: requireTimestamp(
        this.#clock.now().toISOString(),
        "Session legacy importedAt",
      ),
      recordCount: locked.recordCount,
    };

    if (durableSessionProjectionHash(this.#sessionRepository.list()) === locked.projectionHash) {
      const existingCheckpoint = this.#checkpointRepository.get(this.#checkpointSource);
      if (checkpointMatches(existingCheckpoint, checkpoint)) {
        return importResult("already-current", locked);
      }
      this.#writeAndVerifyCheckpoint(checkpoint);
      return importResult("checkpointed", locked);
    }

    this.#sessionRepository.replace(locked.snapshot);
    if (durableSessionProjectionHash(this.#sessionRepository.list()) !== locked.projectionHash) {
      throw new Error("Durable-session SQLite projection did not match after legacy import.");
    }
    this.#writeAndVerifyCheckpoint(checkpoint);
    if (durableSessionProjectionHash(this.#sessionRepository.list()) !== locked.projectionHash) {
      throw new Error(
        "Durable-session SQLite projection changed while recording the import checkpoint.",
      );
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
      throw new Error("Session legacy import checkpoint did not persist exactly.");
    }
  }
}

/** @param {unknown} value @returns {LockedSessionLegacySnapshot} */
function normalizeLockedSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Session locked legacy snapshot must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  if (!Array.isArray(values.snapshot)) {
    throw new Error("Session locked snapshot must contain an array.");
  }
  const snapshot = Object.freeze(
    normalizeDurableSessions(values.snapshot).map((record) => Object.freeze(record)),
  );
  const sourceRevision = requireHash(values.sourceRevision, "Session legacy sourceRevision");
  const projectionHash = requireHash(values.projectionHash, "Session legacy projectionHash");
  if (durableSessionProjectionHash(snapshot) !== projectionHash) {
    throw new Error("Session locked snapshot projectionHash does not match its snapshot.");
  }
  const recordCount = requireSafeInteger(values.recordCount, "Session legacy recordCount");
  if (recordCount !== snapshot.length) {
    throw new Error("Session locked snapshot recordCount does not match its snapshot.");
  }
  if (!Array.isArray(values.backups)) {
    throw new Error("Session locked snapshot backups must be an array.");
  }
  const backups = Object.freeze(
    values.backups.map((path) => requireNonEmptyString(path, "Session backup path")),
  );
  return Object.freeze({ snapshot, sourceRevision, projectionHash, recordCount, backups });
}

/**
 * @param {"applied" | "checkpointed" | "already-current"} status
 * @param {LockedSessionLegacySnapshot} locked
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

/** @param {LegacyImportCheckpoint | null} actual @param {LegacyImportCheckpoint} expected */
function checkpointMatches(actual, expected) {
  return Boolean(
    actual &&
      actual.source === expected.source &&
      actual.sourceRevision === expected.sourceRevision &&
      actual.projectionHash === expected.projectionHash &&
      actual.recordCount === expected.recordCount,
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

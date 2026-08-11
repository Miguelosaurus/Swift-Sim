// @ts-check

import { BUILD_STATE_VERSION } from "../deviceBuildStoreCore.js";
import {
  DeviceBuildLockedLegacySnapshotReader,
  deviceBuildProjectionHash,
} from "./deviceBuildLockedLegacySnapshot.js";
import { normalizeDeviceBuildStateSnapshot } from "./sqliteDeviceBuildStateRepository.js";

/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateRepository} DeviceBuildStateRepository */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateSnapshot} DeviceBuildStateSnapshot */
/** @typedef {import("../contracts/repository.js").LegacyImportCheckpoint} LegacyImportCheckpoint */
/** @typedef {import("../contracts/repository.js").LegacyImportCheckpointRepository} LegacyImportCheckpointRepository */
/** @typedef {import("../infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("../infrastructure/ports.js").Clock} Clock */
/** @typedef {import("../infrastructure/ports.js").LockManager} LockManager */
/** @typedef {import("../infrastructure/ports.js").LockRequest} LockRequest */

/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   lockRequest: LockRequest,
 * }} DeviceBuildLegacySource
 * @typedef {{
 *   snapshot: DeviceBuildStateSnapshot,
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 *   sourceVersion: number,
 * }} LockedDeviceBuildLegacySnapshot
 * @typedef {{
 *   status: "applied" | "checkpointed" | "already-current",
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 *   sourceVersion: number,
 * }} DeviceBuildLegacyImportResult
 */

export class DeviceBuildLegacyImportCoordinator {
  /** @type {DeviceBuildLockedLegacySnapshotReader} */
  #snapshotReader;
  /** @type {DeviceBuildLegacyImportApplier} */
  #applier;

  /**
   * @param {{
   *   deviceBuildRepository: DeviceBuildStateRepository,
   *   checkpointRepository: LegacyImportCheckpointRepository,
   *   fileStore: AtomicFileStore,
   *   lockManager: LockManager,
   *   source: DeviceBuildLegacySource,
   *   backupDirectory: string,
   *   clock: Clock,
   *   checkpointSource?: string,
   * }} options
   */
  constructor({
    deviceBuildRepository,
    checkpointRepository,
    fileStore,
    lockManager,
    source,
    backupDirectory,
    clock,
    checkpointSource = "device-build-state-v1",
  }) {
    this.#snapshotReader = new DeviceBuildLockedLegacySnapshotReader({
      fileStore,
      lockManager,
      source,
      backupDirectory,
    });
    this.#applier = new DeviceBuildLegacyImportApplier({
      deviceBuildRepository,
      checkpointRepository,
      clock,
      checkpointSource,
    });
  }

  /** @returns {DeviceBuildLegacyImportResult} */
  run() {
    return this.#snapshotReader.withLockedSnapshot((lockedSnapshot) =>
      this.#applier.apply(lockedSnapshot),
    );
  }
}

export class DeviceBuildLegacyImportApplier {
  /** @type {DeviceBuildStateRepository} */
  #deviceBuildRepository;
  /** @type {LegacyImportCheckpointRepository} */
  #checkpointRepository;
  /** @type {Clock} */
  #clock;
  /** @type {string} */
  #checkpointSource;

  /**
   * @param {{
   *   deviceBuildRepository: DeviceBuildStateRepository,
   *   checkpointRepository: LegacyImportCheckpointRepository,
   *   clock: Clock,
   *   checkpointSource?: string,
   * }} options
   */
  constructor({
    deviceBuildRepository,
    checkpointRepository,
    clock,
    checkpointSource = "device-build-state-v1",
  }) {
    if (
      !deviceBuildRepository ||
      typeof deviceBuildRepository.read !== "function" ||
      typeof deviceBuildRepository.replace !== "function"
    ) {
      throw new Error("Device-build SQLite state repository is required.");
    }
    if (
      !checkpointRepository ||
      typeof checkpointRepository.get !== "function" ||
      typeof checkpointRepository.upsert !== "function"
    ) {
      throw new Error("Device-build legacy checkpoint repository is required.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new Error("Device-build legacy import clock is required.");
    }
    this.#deviceBuildRepository = deviceBuildRepository;
    this.#checkpointRepository = checkpointRepository;
    this.#clock = clock;
    this.#checkpointSource = requireNonEmptyString(
      checkpointSource,
      "Device-build legacy checkpoint source",
    );
  }

  /**
   * Apply one immutable snapshot while its caller still owns the legacy source
   * lock. Data publication and checkpoint publication are intentionally
   * resumable rather than wrapped in a nested transaction: each repository
   * owns its own synchronous SQLite transaction, and SwiftSimSqliteDatabase
   * rejects nested transactions. If checkpoint publication is interrupted,
   * retry observes the already-matching projection and repairs only checkpoint
   * evidence without replacing domain state again.
   *
   * @param {LockedDeviceBuildLegacySnapshot} lockedSnapshot
   * @returns {DeviceBuildLegacyImportResult}
   */
  apply(lockedSnapshot) {
    const locked = normalizeLockedSnapshot(lockedSnapshot);
    const checkpoint = {
      source: this.#checkpointSource,
      sourceRevision: locked.sourceRevision,
      projectionHash: locked.projectionHash,
      importedAt: requireTimestamp(
        this.#clock.now().toISOString(),
        "Device-build legacy importedAt",
      ),
      recordCount: locked.recordCount,
    };

    const existingProjectionHash = deviceBuildProjectionHash(this.#deviceBuildRepository.read());
    if (existingProjectionHash === locked.projectionHash) {
      const existingCheckpoint = this.#checkpointRepository.get(this.#checkpointSource);
      if (checkpointMatches(existingCheckpoint, checkpoint)) {
        return importResult("already-current", locked);
      }
      this.#writeAndVerifyCheckpoint(checkpoint);
      return importResult("checkpointed", locked);
    }

    this.#deviceBuildRepository.replace(locked.snapshot);
    if (deviceBuildProjectionHash(this.#deviceBuildRepository.read()) !== locked.projectionHash) {
      throw new Error("Device-build SQLite projection did not match after legacy import.");
    }
    this.#writeAndVerifyCheckpoint(checkpoint);
    if (deviceBuildProjectionHash(this.#deviceBuildRepository.read()) !== locked.projectionHash) {
      throw new Error(
        "Device-build SQLite projection changed while recording the import checkpoint.",
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
      throw new Error("Device-build legacy import checkpoint did not persist exactly.");
    }
  }
}

/**
 * @param {"applied" | "checkpointed" | "already-current"} status
 * @param {LockedDeviceBuildLegacySnapshot} locked
 * @returns {DeviceBuildLegacyImportResult}
 */
function importResult(status, locked) {
  return {
    status,
    sourceRevision: locked.sourceRevision,
    projectionHash: locked.projectionHash,
    recordCount: locked.recordCount,
    backups: locked.backups,
    sourceVersion: locked.sourceVersion,
  };
}

/** @param {unknown} value @returns {LockedDeviceBuildLegacySnapshot} */
function normalizeLockedSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Device-build locked legacy snapshot must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  const snapshot = normalizeDeviceBuildStateSnapshot(
    /** @type {DeviceBuildStateSnapshot} */ (values.snapshot),
  );
  const sourceRevision = requireHash(values.sourceRevision, "Device-build legacy sourceRevision");
  const projectionHash = requireHash(values.projectionHash, "Device-build legacy projectionHash");
  if (deviceBuildProjectionHash(snapshot) !== projectionHash) {
    throw new Error("Device-build locked snapshot projectionHash does not match its snapshot.");
  }
  const sourceVersion = requireSafeInteger(
    values.sourceVersion,
    "Device-build legacy sourceVersion",
  );
  if (sourceVersion > BUILD_STATE_VERSION) {
    throw new Error(
      `Device-build locked snapshot sourceVersion ${sourceVersion} exceeds supported version ${BUILD_STATE_VERSION}.`,
    );
  }
  const recordCount = requireSafeInteger(values.recordCount, "Device-build legacy recordCount");
  const expectedRecordCount =
    snapshot.builds.length +
    snapshot.apps.length +
    snapshot.artifactCleanupJobs.length +
    snapshot.deliveryReferenceCleanupJobs.length;
  if (recordCount !== expectedRecordCount) {
    throw new Error("Device-build locked snapshot recordCount does not match its snapshot.");
  }
  if (!Array.isArray(values.backups)) {
    throw new Error("Device-build locked snapshot backups must be an array.");
  }
  const backups = Object.freeze(
    values.backups.map((path) =>
      requireNonEmptyString(path, "Device-build locked snapshot backup path"),
    ),
  );
  const immutableSnapshot = /** @type {DeviceBuildStateSnapshot} */ (
    deepFreeze(structuredClone(snapshot))
  );
  return Object.freeze({
    snapshot: immutableSnapshot,
    sourceRevision,
    projectionHash,
    recordCount,
    backups,
    sourceVersion,
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

/** @param {unknown} value */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(/** @type {Record<string, unknown>} */ (value))) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

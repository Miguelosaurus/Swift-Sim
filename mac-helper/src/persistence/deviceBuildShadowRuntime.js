// @ts-check

import { dirname } from "node:path";
import { createDarwinLegacyProcessIdentity } from "../infrastructure/darwinLegacyProcessIdentity.js";
import {
  ensureDirectoryModeSync,
  NodeAtomicFileStore,
} from "../infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../infrastructure/nodeLockManager.js";
import { SystemClock } from "../infrastructure/systemClock.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "./deviceBuildSqliteSchema.js";
import { DeviceBuildLegacyImportCoordinator } from "./deviceBuildLegacyImport.js";
import { DeviceBuildRevisionFencedShadowObserver } from "./deviceBuildRevisionFencedShadowObserver.js";
import { DeviceBuildShadowComparator } from "./deviceBuildShadowComparison.js";
import { DeviceBuildShadowObserver } from "./deviceBuildShadowObserver.js";
import { SqliteDeviceBuildShadowMismatchRepository } from "./sqliteDeviceBuildShadowMismatchRepository.js";
import { SqliteDeviceBuildStateRepository } from "./sqliteDeviceBuildStateRepository.js";
import { SqliteLegacyImportCheckpointRepository } from "./sqliteLegacyImportCheckpointRepository.js";
import { SwiftSimSqliteDatabase } from "./swiftSimSqliteDatabase.js";

/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowComparisonResult} DeviceBuildShadowComparisonResult */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowProjection} DeviceBuildShadowProjection */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowSurface} DeviceBuildShadowSurface */
/** @typedef {import("../contracts/repository.js").RepositoryHealth} RepositoryHealth */
/** @typedef {import("../infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("../infrastructure/ports.js").Clock} Clock */
/** @typedef {import("../infrastructure/ports.js").LockRequest} LockRequest */
/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */
/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   lockRequest: LockRequest,
 * }} DeviceBuildLegacySource
 * @typedef {{
 *   status: "applied" | "checkpointed" | "already-current",
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 *   sourceVersion: number,
 * }} DeviceBuildLegacyImportResult
 * @typedef {{
 *   observe(input: {
 *     surface: DeviceBuildShadowSurface,
 *     key: string,
 *     legacy: DeviceBuildShadowProjection,
 *   }): DeviceBuildShadowComparisonResult | null,
 * }} DeviceBuildShadowObserverPort
 * @typedef {{
 *   importLegacy(): DeviceBuildLegacyImportResult,
 *   shadowObserver: DeviceBuildShadowObserverPort,
 *   health(): RepositoryHealth,
 *   close(): void,
 * }} DeviceBuildShadowRuntime
 */

/**
 * Assemble the already-validated Phase 4 device-build migration/shadow pieces
 * without wiring them into helper startup or changing JSON authority.
 *
 * The caller owns path selection and the legacy source-lock request. In
 * particular, `source.lockRequest.path` must identify the exact lock used by
 * the legacy DeviceBuildStore. The injected spawnSync is adapted to the exact
 * Darwin `ps -o lstart=` identity required to interoperate with `startedAt`
 * owners; this module imports no child-process API itself.
 *
 * SQLite creation, WAL setup, and migrations are synchronous. Temporarily
 * tightening the process umask to 077 across that bounded constructor window
 * ensures newly created database/WAL/SHM files are private without adding a
 * second filesystem-permission owner. The previous process umask is restored
 * before this factory returns or throws.
 *
 * @param {{
 *   databasePath: string,
 *   source: DeviceBuildLegacySource,
 *   backupDirectory: string,
 *   spawnSync: SpawnSyncLike,
 *   fileStore?: AtomicFileStore,
 *   clock?: Clock,
 *   reportError?: (error: Error) => unknown,
 *   checkpointSource?: string,
 * }} options
 * @returns {DeviceBuildShadowRuntime}
 */
export function createDeviceBuildShadowRuntime(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("Device-build shadow runtime options are required.");
  }
  const databasePath = requireNonEmptyString(options.databasePath, "Device-build SQLite path");
  const backupDirectory = requireNonEmptyString(
    options.backupDirectory,
    "Device-build legacy backup directory",
  );
  if (typeof options.spawnSync !== "function") {
    throw new TypeError("Device-build shadow runtime requires spawnSync.");
  }
  if (options.reportError !== undefined && typeof options.reportError !== "function") {
    throw new TypeError("Device-build shadow error reporter must be a function.");
  }
  const fileStore = options.fileStore || new NodeAtomicFileStore();
  validateFileStore(fileStore);
  const clock = options.clock || new SystemClock();
  validateClock(clock);

  ensureDirectoryModeSync(dirname(databasePath), 0o700);
  const identity = createDarwinLegacyProcessIdentity({ spawnSync: options.spawnSync });
  const lockManager = new NodeLockManager({ identity, fileStore, clock });
  /** @type {SwiftSimSqliteDatabase | undefined} */
  let database;
  try {
    const openedDatabase = withPrivateFileCreationMask(
      () =>
        new SwiftSimSqliteDatabase({
          path: databasePath,
          migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
          now: () => clock.now().toISOString(),
        }),
    );
    database = openedDatabase;
    const deviceBuildRepository = new SqliteDeviceBuildStateRepository(openedDatabase);
    const checkpointRepository = new SqliteLegacyImportCheckpointRepository(openedDatabase);
    const mismatchRepository = new SqliteDeviceBuildShadowMismatchRepository(openedDatabase);
    const comparator = new DeviceBuildShadowComparator({ mismatchRepository, clock });
    const fallbackObserver = new DeviceBuildShadowObserver({
      deviceBuildRepository,
      comparator,
      ...(options.reportError ? { reportError: options.reportError } : {}),
    });
    const shadowObserver = new DeviceBuildRevisionFencedShadowObserver({
      deviceBuildRepository,
      comparator,
      fallbackObserver,
      ...(options.reportError ? { reportError: options.reportError } : {}),
    });
    const importCoordinator = new DeviceBuildLegacyImportCoordinator({
      deviceBuildRepository,
      checkpointRepository,
      fileStore,
      lockManager,
      source: options.source,
      backupDirectory,
      clock,
      ...(options.checkpointSource ? { checkpointSource: options.checkpointSource } : {}),
    });

    return Object.freeze({
      importLegacy: () => importCoordinator.run(),
      shadowObserver,
      health: () => openedDatabase.health(),
      close: () => openedDatabase.close(),
    });
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Construction already failed; do not replace the original error.
    }
    throw error;
  }
}

/** @template T @param {() => T} operation @returns {T} */
function withPrivateFileCreationMask(operation) {
  const previousUmask = process.umask(0o077);
  try {
    return operation();
  } finally {
    process.umask(previousUmask);
  }
}

/** @param {AtomicFileStore} fileStore */
function validateFileStore(fileStore) {
  if (typeof fileStore?.readTextSync !== "function") {
    throw new TypeError("Device-build shadow runtime file store requires readTextSync.");
  }
  if (typeof fileStore.writeTextSync !== "function") {
    throw new TypeError("Device-build shadow runtime file store requires writeTextSync.");
  }
}

/** @param {Clock} clock */
function validateClock(clock) {
  if (!clock || typeof clock.now !== "function") {
    throw new TypeError("Device-build shadow runtime clock is required.");
  }
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

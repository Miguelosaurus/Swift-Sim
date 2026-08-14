// @ts-check

import { dirname } from "node:path";
import { ensureDirectoryModeSync, NodeAtomicFileStore } from "../infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../infrastructure/nodeLockManager.js";
import { createSessionLegacyProcessIdentity } from "../infrastructure/sessionLegacyProcessIdentity.js";
import { SystemClock } from "../infrastructure/systemClock.js";
import { PHASE4_SQLITE_MIGRATIONS } from "./phase4SqliteSchema.js";
import { SessionLegacyImportApplier } from "./sessionLegacyImport.js";
import { SessionLockedLegacySnapshotReader } from "./sessionLockedLegacySnapshot.js";
import { compareDurableSessionShadow } from "./sessionDurableShadowComparison.js";
import { SqliteDurableSessionRepository } from "./sqliteDurableSessionRepository.js";
import { SqliteLegacyImportCheckpointRepository } from "./sqliteLegacyImportCheckpointRepository.js";
import { SwiftSimSqliteDatabase } from "./swiftSimSqliteDatabase.js";

/** @typedef {import("../contracts/durableSession.js").DurableSessionRecord} DurableSessionRecord */
/** @typedef {import("../infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("../infrastructure/ports.js").Clock} Clock */
/** @typedef {import("../infrastructure/ports.js").LockRequest} LockRequest */
/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */

/**
 * Run one bounded staged session import/shadow observation against the
 * authoritative legacy JSON snapshot. SQLite is populated only as migration
 * evidence; no business decision is authorized from its contents.
 *
 * The legacy snapshot, pre-import comparison, import, and post-import
 * comparison all occur under the exact sessions.json lock. The lock manager
 * uses createSessionLegacyProcessIdentity, which preserves the Darwin
 * `/bin/ps -p <pid> -o lstart=` process-start token semantics required to
 * distinguish PID reuse.
 *
 * @param {{
 *   databasePath: string,
 *   source: { name: string, path: string, lockRequest: LockRequest },
 *   backupDirectory: string,
 *   spawnSync: SpawnSyncLike,
 *   fileStore?: AtomicFileStore,
 *   clock?: Clock,
 *   checkpointSource?: string,
 * }} options
 */
export function observeSessionDurableShadowSnapshot(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("Session durable shadow options are required.");
  }
  if (typeof options.spawnSync !== "function") {
    throw new TypeError("Session durable shadow requires spawnSync.");
  }
  const fileStore = options.fileStore || new NodeAtomicFileStore();
  const clock = options.clock || new SystemClock();
  const databasePath = requireNonEmptyString(options.databasePath, "Session SQLite path");
  const backupDirectory = requireNonEmptyString(
    options.backupDirectory,
    "Session legacy backup directory",
  );

  ensureDirectoryModeSync(dirname(databasePath), 0o700);
  const identity = createSessionLegacyProcessIdentity({ spawnSync: options.spawnSync });
  const lockManager = new NodeLockManager({ identity, fileStore, clock });
  /** @type {SwiftSimSqliteDatabase | undefined} */
  let database;
  try {
    const openedDatabase = withPrivateFileCreationMask(() => new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
      now: () => clock.now().toISOString(),
    }));
    database = openedDatabase;
    const sessionRepository = new SqliteDurableSessionRepository(openedDatabase);
    const checkpointRepository = new SqliteLegacyImportCheckpointRepository(openedDatabase);
    const snapshotReader = new SessionLockedLegacySnapshotReader({
      fileStore,
      lockManager,
      source: options.source,
      backupDirectory,
    });
    const importApplier = new SessionLegacyImportApplier({
      sessionRepository,
      checkpointRepository,
      clock,
      ...(options.checkpointSource ? { checkpointSource: options.checkpointSource } : {}),
    });

    return snapshotReader.withLockedSnapshot((snapshot) => {
      const before = compareSnapshots(snapshot.snapshot, sessionRepository.list());
      const importResult = importApplier.apply(snapshot);
      const after = compareSnapshots(snapshot.snapshot, sessionRepository.list());
      if (after.mismatchCount !== 0) {
        throw new Error("Durable-session shadow still mismatched after staged legacy import.");
      }
      return Object.freeze({
        enabled: true,
        authority: "legacy-json",
        importResult,
        preImportMismatchCount: before.mismatchCount,
        postImportMismatchCount: after.mismatchCount,
        health: openedDatabase.health(),
      });
    });
  } finally {
    database?.close();
  }
}

/**
 * @param {readonly DurableSessionRecord[]} legacy
 * @param {readonly DurableSessionRecord[]} sqlite
 */
function compareSnapshots(legacy, sqlite) {
  const legacyByID = new Map(legacy.map((record) => [record.id, record]));
  const sqliteByID = new Map(sqlite.map((record) => [record.id, record]));
  const ids = new Set([...legacyByID.keys(), ...sqliteByID.keys()]);
  let mismatchCount = 0;
  for (const id of ids) {
    const result = compareDurableSessionShadow(
      legacyByID.get(id) || null,
      sqliteByID.get(id) || null,
    );
    if (!result.matched) mismatchCount += 1;
  }
  return { mismatchCount };
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

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

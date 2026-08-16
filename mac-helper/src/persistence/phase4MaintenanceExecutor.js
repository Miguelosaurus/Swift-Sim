// @ts-check

import { PHASE4_SQLITE_MIGRATIONS } from "./phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "./swiftSimSqliteDatabase.js";
import {
  assertPhase4BoundMaintenanceEvidence,
  bindPhase4MaintenanceEvidence,
  bindPhase4PostMigrationEvidence,
} from "./phase4MaintenanceEvidence.js";
import { inspectPhase4MigrationIdentity } from "./phase4MigrationIdentity.js";
import { createVerifiedPhase4PreMigrationSnapshot } from "./phase4MaintenanceSnapshot.js";

/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} DatabaseOwner */

/**
 * Run one maintenance operation only after all applicable read-only gates have
 * succeeded. For preparation this enforces the strict order:
 *
 *   read-only v7/v8/v9 prefix + provenance/process/permissions/shadow gates
 *   -> verified SQLite online-backup snapshot
 *   -> first migration-capable open
 *   -> close/read-only exact v9
 *   -> second idempotent open + close/read-only exact v9
 *   -> coordinator operation
 *
 * No SwiftSimSqliteDatabase is constructed before the snapshot and all
 * applicable pre-migration gates are complete.
 *
 * @template T
 * @param {{
 *   stateRoot: string,
 *   evidence: unknown,
 *   stage: "prepare" | "cancel" | "activate" | "rollback",
 *   spawnSync: (command: string, args: string[], options: { encoding: string }) => unknown,
 *   provenancePath: string,
 *   openDatabase?: () => DatabaseOwner,
 * }} options
 * @param {(database: DatabaseOwner, boundEvidence: any) => T} operation
 * @returns {Promise<T>}
 */
export async function withPhase4MaintenanceDatabase(options, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("Phase-4 maintenance database operation must be a function.");
  }
  const stateRoot = requireString(options.stateRoot, "Phase-4 state root");
  const databasePath = `${stateRoot}/state.sqlite`;
  const openDatabase =
    options.openDatabase ||
    (() =>
      new SwiftSimSqliteDatabase({
        path: databasePath,
        migrations: PHASE4_SQLITE_MIGRATIONS,
      }));

  // Stage 1-3: immutable/read-only inspection and externally supplied ceremony
  // binding. Any failure here occurs before snapshot creation or a migration-
  // capable database owner is constructed.
  const preMigration = bindPhase4MaintenanceEvidence(
    options.evidence,
    /** @type {any} */ (options.stage),
    {
      stateRoot,
      spawnSync: options.spawnSync,
      provenancePath: options.provenancePath,
    },
  );

  let boundEvidence = preMigration;
  if (options.stage === "prepare") {
    // Stage 4: SQLite-consistent snapshot, created only after helper/writer,
    // locks, permissions, exact prefix, provenance and shadow gates succeeded.
    const snapshot = await createVerifiedPhase4PreMigrationSnapshot({
      stateRoot,
      databasePath,
      expectedMigration: preMigration.measured.migration,
    });

    // Stage 5: first and only now may a migration-capable owner apply missing
    // v8/v9 migrations. The owner itself revalidates the exact frozen history.
    const migrated = openDatabase();
    try {
      const health = migrated.health();
      if (!health.ok) throw new Error("Phase-4 migrated database failed owner health checks.");
    } finally {
      migrated.close();
    }

    // Stage 6/7: exact full identity after close, then reopen through the same
    // owner. A second close/read-only observation proves migration idempotency.
    const firstPostMigration = inspectPhase4MigrationIdentity(databasePath, {
      allowedVersions: [9],
      requireFull: true,
      requireWal: true,
    });
    const reopened = openDatabase();
    try {
      const health = reopened.health();
      if (!health.ok) throw new Error("Phase-4 reopened database failed owner health checks.");
    } finally {
      reopened.close();
    }
    const reopenPostMigration = inspectPhase4MigrationIdentity(databasePath, {
      allowedVersions: [9],
      requireFull: true,
      requireWal: true,
    });
    boundEvidence = bindPhase4PostMigrationEvidence(preMigration, {
      stateRoot,
      spawnSync: options.spawnSync,
      provenancePath: options.provenancePath,
      snapshot,
      firstPostMigration,
      reopenPostMigration,
    });
  }

  // Stage 8: all facts needed by the stage are now bound. Activation/rollback
  // and cancellation start from exact full v9 and therefore do not need another
  // pre-migration snapshot; their read-only binding still precedes this owner.
  assertPhase4BoundMaintenanceEvidence(boundEvidence, /** @type {any} */ (options.stage));

  // Stage 9 / operation: construct the owner only after all applicable gates.
  const database = openDatabase();
  try {
    return operation(database, boundEvidence);
  } finally {
    database.close();
  }
}

/** @param {unknown} value @param {string} label */
function requireString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be non-empty.`);
  return value;
}

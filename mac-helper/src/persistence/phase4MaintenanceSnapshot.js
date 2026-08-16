// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
  ensureDirectoryModeSync,
  ensureFileModeSync,
} from "../infrastructure/nodeAtomicFileStore.js";
import { inspectPhase4MigrationIdentity } from "./phase4MigrationIdentity.js";

/**
 * Create one new SQLite-consistent pre-migration snapshot after writer/helper
 * quiescence has already been proven by the caller. The online backup API is
 * used instead of copying the main database file so WAL-resident committed
 * pages are included consistently.
 *
 * @param {{
 *   stateRoot: string,
 *   databasePath: string,
 *   expectedMigration: ReturnType<typeof inspectPhase4MigrationIdentity>,
 * }} options
 */
export async function createVerifiedPhase4PreMigrationSnapshot({
  stateRoot,
  databasePath,
  expectedMigration,
}) {
  if (!expectedMigration?.coherent) {
    throw new Error("Phase-4 snapshot requires a previously verified migration prefix.");
  }
  const directory = join(stateRoot, "migration-backups", "phase4-cutover", "database");
  ensureDirectoryModeSync(directory, 0o700);
  assertPrivatePath(directory, "Phase-4 snapshot directory", true);

  const snapshotPath = join(
    directory,
    `state.pre-v${expectedMigration.schemaVersion}.${randomUUID()}.sqlite`,
  );
  if (existsSync(snapshotPath)) {
    throw new Error("Phase-4 snapshot destination unexpectedly already exists.");
  }

  const source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    source.exec("PRAGMA foreign_keys = ON");
    source.exec("PRAGMA query_only = ON");
    const beforeVersion = pragmaInteger(source, "PRAGMA data_version");
    await backup(source, snapshotPath);
    const afterVersion = pragmaInteger(source, "PRAGMA data_version");
    if (afterVersion !== beforeVersion) {
      throw new Error(
        "Phase-4 pre-migration snapshot observed a concurrent database writer; refusing the snapshot.",
      );
    }
  } finally {
    source.close();
  }

  ensureFileModeSync(snapshotPath, 0o600);
  return verifyPhase4PreMigrationSnapshot({ snapshotPath, expectedMigration });
}

/**
 * Reopen and validate a snapshot without mutating it. This is separately
 * exported so fault-injection tests can prove corrupted/inconsistent snapshots
 * fail before any migration-capable database owner is constructed.
 *
 * @param {{
 *   snapshotPath: string,
 *   expectedMigration: ReturnType<typeof inspectPhase4MigrationIdentity>,
 * }} options
 */
export function verifyPhase4PreMigrationSnapshot({ snapshotPath, expectedMigration }) {
  assertPrivatePath(snapshotPath, "Phase-4 pre-migration snapshot", false);
  const observed = inspectPhase4MigrationIdentity(snapshotPath, {
    allowedVersions: [expectedMigration.schemaVersion],
    requireFull: false,
    requireWal: false,
  });
  if (
    observed.schemaVersion !== expectedMigration.schemaVersion ||
    observed.historyDigest !== expectedMigration.historyDigest
  ) {
    throw new Error(
      "Phase-4 pre-migration snapshot migration identity does not match the live database.",
    );
  }
  const bytes = readFileSync(snapshotPath);
  if (bytes.length === 0) throw new Error("Phase-4 pre-migration snapshot is empty.");
  return Object.freeze({
    present: true,
    verified: true,
    path: snapshotPath,
    byteLength: bytes.length,
    sha256: sha256(bytes),
    schemaVersion: observed.schemaVersion,
    migrationHistoryDigest: observed.historyDigest,
    integrity: observed.integrity,
  });
}

/** @param {DatabaseSync} database @param {string} pragma */
function pragmaInteger(database, pragma) {
  const row = database.prepare(pragma).get();
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${pragma} returned no row.`);
  }
  const value = Object.values(row)[0];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${pragma} returned an invalid value.`);
  }
  return Number(value);
}

/** @param {string} path @param {string} label @param {boolean} directory */
function assertPrivatePath(path, label, directory) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
  if (directory ? !entry.isDirectory() : !entry.isFile()) {
    throw new Error(`${label} has the wrong filesystem type.`);
  }
  const mode = statSync(path).mode;
  if ((mode & 0o077) !== 0) throw new Error(`${label} permissions are not owner-only.`);
}

/** @param {Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

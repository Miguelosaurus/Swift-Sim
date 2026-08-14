// @ts-check

import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectPhase4SupportDiagnostics } from "./phase4SupportDiagnostics.js";

const LATEST_SCHEMA_VERSION = 8;

/**
 * Build the accepted Phase-4 support report from read-only operator probes.
 * This module deliberately does not construct SwiftSimSqliteDatabase or any
 * compatibility runtime because those owners may migrate or perform startup
 * maintenance. The database handle is opened read-only and no cleanup/cutover
 * command is reachable from this path.
 *
 * @param {{ artifactAudit?: unknown, stateRoot?: string }} [options]
 */
export function collectPhase4OperatorDiagnostics(options = {}) {
  const fixture = testFixtureProbes();
  if (fixture) return collectPhase4SupportDiagnostics(fixture);

  const stateRoot = options.stateRoot || join(homedir(), ".swift-sim");
  const databasePath = join(stateRoot, "state.sqlite");
  /** @type {DatabaseSync | null} */
  let database = null;
  /** @type {Record<string, unknown> | null} */
  let databaseSnapshot = null;

  const openDatabase = () => {
    if (database) return database;
    assertPrivateStorageReadable(stateRoot, databasePath);
    database = new DatabaseSync(databasePath, { readOnly: true });
    return database;
  };

  const repositoryHealth = () => {
    if (databaseSnapshot) return databaseSnapshot;
    const db = openDatabase();
    const schemaVersion = pragmaInteger(db, "user_version");
    if (schemaVersion > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `schema version ${schemaVersion} is newer than supported ${LATEST_SCHEMA_VERSION}`,
      );
    }
    const integrity = String(db.prepare("PRAGMA integrity_check").get()?.integrity_check || "unknown");
    const journalMode = String(db.prepare("PRAGMA journal_mode").get()?.journal_mode || "unknown");
    const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row.name || "")),
    );
    const requiredTables = [
      "schema_migrations",
      "legacy_import_checkpoints",
      "pairing_records",
      "device_build_records",
      "session_records",
    ];
    const missingTables = requiredTables.filter((name) => !tables.has(name));
    databaseSnapshot = {
      ok:
        integrity === "ok" &&
        foreignKeyViolations === 0 &&
        missingTables.length === 0 &&
        schemaVersion === LATEST_SCHEMA_VERSION,
      integrity,
      journalMode,
      foreignKeys: true,
      foreignKeyViolations,
      missingTables,
      schemaVersion,
      latestSchemaVersion: LATEST_SCHEMA_VERSION,
      migrationsApplied: schemaVersion,
    };
    return databaseSnapshot;
  };

  const migration = () => {
    const health = repositoryHealth();
    return {
      status:
        health.schemaVersion === LATEST_SCHEMA_VERSION ? "already-current" : "checkpointed",
      recordCount: countRowsIfPresent(openDatabase(), "legacy_import_checkpoints"),
    };
  };

  const shadow = () => {
    const db = openDatabase();
    const mismatchTables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%shadow%mismatch%'",
      )
      .all()
      .map((row) => String(row.name || ""))
      .filter(isSafeIdentifier);
    let mismatchCount = 0;
    for (const table of mismatchTables) {
      mismatchCount += Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
    }
    return {
      enabled: true,
      mismatchCount,
      observationCount: null,
    };
  };

  const compatibility = () => {
    const health = repositoryHealth();
    return {
      state:
        health.schemaVersion === LATEST_SCHEMA_VERSION ? "compatible" : "transitioning",
      legacyReadable: canReadStateRoot(stateRoot),
      sqliteReadable: true,
      rollbackReadable: canReadStateRoot(stateRoot),
    };
  };

  const artifactStorage = () => {
    if (!options.artifactAudit) throw new Error("artifact audit unavailable");
    return options.artifactAudit;
  };

  try {
    return collectPhase4SupportDiagnostics({
      repositoryHealth,
      migration,
      shadow,
      compatibility,
      artifactStorage,
    });
  } finally {
    database?.close();
  }
}

/** @param {string} stateRoot @param {string} databasePath */
function assertPrivateStorageReadable(stateRoot, databasePath) {
  accessSync(stateRoot, constants.R_OK | constants.X_OK);
  if (!existsSync(databasePath)) {
    const error = new Error("Phase-4 database is unavailable");
    // @ts-expect-error Node-style support classification code.
    error.code = "ENOENT";
    throw error;
  }
  accessSync(databasePath, constants.R_OK);
  const rootMode = statSync(stateRoot).mode & 0o777;
  if ((rootMode & 0o077) !== 0) {
    const error = new Error("permission denied: state root is not private");
    // @ts-expect-error Node-style support classification code.
    error.code = "EACCES";
    throw error;
  }
}

/** @param {string} stateRoot */
function canReadStateRoot(stateRoot) {
  try {
    accessSync(stateRoot, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** @param {DatabaseSync} db @param {string} name */
function pragmaInteger(db, name) {
  const value = db.prepare(`PRAGMA ${name}`).get()?.[name];
  return Number.isSafeInteger(Number(value)) ? Number(value) : 0;
}

/** @param {DatabaseSync} db @param {string} table */
function countRowsIfPresent(db, table) {
  const present = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!present) return 0;
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
}

/** @param {string} value */
function isSafeIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function testFixtureProbes() {
  if (process.env.NODE_ENV !== "test") return null;
  const fixturePath = process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
  if (!fixturePath) return null;
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  /** @type {Record<string, () => unknown>} */
  const probes = {};
  for (const key of [
    "repositoryHealth",
    "migration",
    "shadow",
    "compatibility",
    "artifactStorage",
  ]) {
    const entry = fixture[key];
    probes[key] = () => {
      if (entry?.throw) {
        const error = new Error(String(entry.throw.message || entry.throw));
        if (entry.throw.code) {
          // @ts-expect-error Node-style fixture error code.
          error.code = String(entry.throw.code);
        }
        throw error;
      }
      return entry?.value ?? entry;
    };
  }
  return probes;
}

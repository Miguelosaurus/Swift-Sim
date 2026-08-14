// @ts-check

import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PHASE4_SQLITE_MIGRATIONS } from "../persistence/phase4SqliteSchema.js";
import { collectPhase4SupportDiagnostics } from "./phase4SupportDiagnostics.js";

const LATEST_SCHEMA_VERSION = PHASE4_SQLITE_MIGRATIONS.at(-1)?.version || 0;
const REQUIRED_TABLES = Object.freeze([
  "schema_migrations",
  ...new Set(PHASE4_SQLITE_MIGRATIONS.flatMap((migration) => migration.requiredTables)),
]);

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
  const previousUmask = process.umask(0o077);

  const openDatabase = () => {
    if (database) return database;
    assertPrivateStorageReadable(stateRoot, databasePath);
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec("PRAGMA query_only = ON");
    database.exec("PRAGMA foreign_keys = ON");
    return database;
  };

  const repositoryHealth = () => {
    if (databaseSnapshot) return databaseSnapshot;
    const db = openDatabase();
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String(row.name || "")),
    );
    const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
    const schemaVersion = tables.has("schema_migrations")
      ? integerColumn(
          db.prepare("SELECT COALESCE(MAX(version), 0) AS value FROM schema_migrations").get(),
          "value",
        )
      : 0;
    const migrationsApplied = tables.has("schema_migrations")
      ? integerColumn(db.prepare("SELECT COUNT(*) AS value FROM schema_migrations").get(), "value")
      : 0;
    if (schemaVersion > LATEST_SCHEMA_VERSION || migrationsApplied > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `schema version ${schemaVersion} is newer than supported ${LATEST_SCHEMA_VERSION}`,
      );
    }
    const integrity = firstValue(db.prepare("PRAGMA integrity_check").get());
    const journalMode = firstValue(db.prepare("PRAGMA journal_mode").get());
    const foreignKeys = Number(firstValue(db.prepare("PRAGMA foreign_keys").get())) === 1;
    const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;
    databaseSnapshot = {
      ok:
        integrity === "ok" &&
        journalMode === "wal" &&
        foreignKeys &&
        foreignKeyViolations === 0 &&
        missingTables.length === 0 &&
        schemaVersion === LATEST_SCHEMA_VERSION &&
        migrationsApplied === LATEST_SCHEMA_VERSION,
      integrity,
      journalMode,
      foreignKeys,
      foreignKeyViolations,
      missingTables,
      schemaVersion,
      latestSchemaVersion: LATEST_SCHEMA_VERSION,
      migrationsApplied,
    };
    return databaseSnapshot;
  };

  const migration = () => {
    const health = repositoryHealth();
    return {
      status:
        health.schemaVersion === LATEST_SCHEMA_VERSION &&
        health.migrationsApplied === LATEST_SCHEMA_VERSION
          ? "already-current"
          : "checkpointed",
      recordCount: countRowsIfPresent(openDatabase(), "legacy_import_checkpoints"),
    };
  };

  const shadow = () => {
    const db = openDatabase();
    const mismatchTables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE '%shadow%mismatch%'",
      )
      .all()
      .map((row) => String(row.name || ""))
      .filter(isSafeIdentifier);
    let mismatchCount = 0;
    for (const table of mismatchTables) {
      mismatchCount += Number(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0,
      );
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
        health.schemaVersion === LATEST_SCHEMA_VERSION &&
        health.migrationsApplied === LATEST_SCHEMA_VERSION
          ? "compatible"
          : "transitioning",
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
    try {
      closeDatabaseHandle(database);
    } finally {
      process.umask(previousUmask);
    }
  }
}

/** @param {DatabaseSync | null} database */
function closeDatabaseHandle(database) {
  if (database) database.close();
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
  const databaseMode = statSync(databasePath).mode & 0o777;
  if ((rootMode & 0o077) !== 0 || (databaseMode & 0o077) !== 0) {
    const error = new Error("permission denied: Phase-4 state storage is not private");
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

/** @param {unknown} row @param {string} key */
function integerColumn(row, key) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return 0;
  const value = /** @type {Record<string, unknown>} */ (row)[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** @param {unknown} row */
function firstValue(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "";
  const values = Object.values(/** @type {Record<string, unknown>} */ (row));
  return values[0] ?? "";
}

/** @param {DatabaseSync} db @param {string} table */
function countRowsIfPresent(db, table) {
  const present = db
    .prepare("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?")
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

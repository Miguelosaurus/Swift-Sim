// @ts-check

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/** @typedef {import("../contracts/repository.js").RepositoryHealth} RepositoryHealth */
/** @typedef {import("../contracts/repository.js").SchemaMigration} SchemaMigration */

/** @type {readonly SchemaMigration[]} */
export const SWIFT_SIM_SQLITE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "legacy_import_checkpoints",
    statements: Object.freeze([
      `CREATE TABLE legacy_import_checkpoints (
        source TEXT PRIMARY KEY CHECK (length(source) > 0),
        source_revision TEXT NOT NULL CHECK (length(source_revision) > 0),
        projection_hash TEXT NOT NULL CHECK (length(projection_hash) > 0),
        imported_at TEXT NOT NULL CHECK (length(imported_at) > 0),
        record_count INTEGER NOT NULL CHECK (record_count >= 0)
      ) STRICT`,
    ]),
  }),
]);

/**
 * Single synchronous SQLite connection and migration owner for transactional
 * domain state. Callers must provide a path whose private parent directory
 * already exists; filesystem preparation remains outside this foundation PR.
 */
export class SwiftSimSqliteDatabase {
  /** @type {DatabaseSync} */
  #database;
  /** @type {string} */
  #path;
  /** @type {readonly SchemaMigration[]} */
  #migrations;
  /** @type {() => string} */
  #now;
  #transactionActive = false;
  #closed = false;

  /**
   * @param {{
   *   path: string,
   *   migrations?: readonly SchemaMigration[],
   *   now?: () => string,
   * }} options
   */
  constructor({
    path,
    migrations = SWIFT_SIM_SQLITE_MIGRATIONS,
    now = () => new Date().toISOString(),
  }) {
    this.#path = requireNonEmptyString(path, "SQLite database path");
    this.#migrations = validateMigrations(migrations);
    this.#now = now;
    this.#database = new DatabaseSync(this.#path);
    try {
      this.#database.exec("PRAGMA foreign_keys = ON");
      this.#database.exec("PRAGMA busy_timeout = 5000");
      this.#database.exec("PRAGMA journal_mode = WAL");
      this.#database.exec("PRAGMA synchronous = FULL");
      this.migrate();
      const health = this.health();
      if (!health.ok) throw databaseHealthError(health);
    } catch (error) {
      this.#database.close();
      this.#closed = true;
      throw error;
    }
  }

  get path() {
    return this.#path;
  }

  migrate() {
    this.#assertOpen();
    this.#database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
      checksum TEXT NOT NULL CHECK (length(checksum) = 64),
      applied_at TEXT NOT NULL CHECK (length(applied_at) > 0)
    ) STRICT`);

    const applied = this.#database
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all()
      .map(parseAppliedMigrationRow);
    const expectedByVersion = new Map(
      this.#migrations.map((migration) => [migration.version, migration]),
    );
    let expectedAppliedVersion = 1;
    for (const row of applied) {
      if (row.version !== expectedAppliedVersion) {
        throw new Error(
          `SQLite migration history is non-contiguous; expected version ${expectedAppliedVersion}, found ${row.version}.`,
        );
      }
      const expected = expectedByVersion.get(row.version);
      if (!expected) {
        throw new Error(`SQLite schema version ${row.version} is newer than this Swift Sim build.`);
      }
      if (row.name !== expected.name) {
        throw new Error(
          `SQLite migration ${row.version} is recorded as ${row.name}, expected ${expected.name}.`,
        );
      }
      const expectedChecksum = migrationChecksum(expected);
      if (row.checksum !== expectedChecksum) {
        throw new Error(
          `SQLite migration ${row.version} checksum does not match this Swift Sim build.`,
        );
      }
      expectedAppliedVersion += 1;
    }

    const appliedVersions = new Set(applied.map((row) => row.version));
    const recordMigration = this.#database.prepare(
      "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
    );
    for (const migration of this.#migrations) {
      if (appliedVersions.has(migration.version)) continue;
      this.transaction(() => {
        for (const statement of migration.statements) this.#database.exec(statement);
        recordMigration.run(
          migration.version,
          migration.name,
          migrationChecksum(migration),
          requireNonEmptyString(this.#now(), "SQLite migration appliedAt"),
        );
      });
    }
  }

  /** @param {string} sql */
  prepare(sql) {
    this.#assertOpen();
    return this.#database.prepare(requireNonEmptyString(sql, "SQL statement"));
  }

  /** @param {string} sql */
  exec(sql) {
    this.#assertOpen();
    this.#database.exec(requireNonEmptyString(sql, "SQL batch"));
  }

  /**
   * @template T
   * @param {() => T} operation
   * @returns {T}
   */
  transaction(operation) {
    this.#assertOpen();
    if (this.#transactionActive) {
      throw new Error("Nested Swift Sim SQLite transactions are not supported.");
    }
    this.#database.exec("BEGIN IMMEDIATE");
    this.#transactionActive = true;
    try {
      const result = operation();
      if (isPromiseLike(result)) {
        throw new Error("Swift Sim SQLite transactions must be synchronous.");
      }
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the owning operation error. Integrity checks expose a failed
        // rollback separately before any later cutover can proceed.
      }
      throw error;
    } finally {
      this.#transactionActive = false;
    }
  }

  /** @returns {RepositoryHealth} */
  health() {
    this.#assertOpen();
    const integrity = firstPragmaValue(this.#database.prepare("PRAGMA integrity_check").get());
    const journalMode = firstPragmaValue(this.#database.prepare("PRAGMA journal_mode").get());
    const foreignKeys =
      Number(firstPragmaValue(this.#database.prepare("PRAGMA foreign_keys").get())) === 1;
    const schemaVersion = requiredIntegerColumn(
      this.#database
        .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
        .get(),
      "version",
      "SQLite schema version",
    );
    const migrationsApplied = requiredIntegerColumn(
      this.#database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
      "count",
      "SQLite migration count",
    );
    const existingTables = new Set(
      this.#database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .all()
        .map(parseTableNameRow),
    );
    const requiredTables = this.#migrations.flatMap(
      (migration) => migration.requiredTables || [],
    );
    const missingTables = [...new Set(requiredTables.filter((name) => !existingTables.has(name)))].sort(
      compareStrings,
    );
    const latestSchemaVersion = this.#migrations.at(-1)?.version || 0;
    return {
      ok:
        integrity === "ok" &&
        journalMode === "wal" &&
        foreignKeys &&
        schemaVersion === latestSchemaVersion &&
        migrationsApplied === latestSchemaVersion &&
        missingTables.length === 0,
      path: this.#path,
      integrity,
      journalMode,
      foreignKeys,
      schemaVersion,
      latestSchemaVersion,
      migrationsApplied,
      missingTables,
    };
  }

  close() {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  #assertOpen() {
    if (this.#closed) throw new Error("Swift Sim SQLite database is closed.");
  }
}

/** @param {RepositoryHealth} health */
function databaseHealthError(health) {
  /** @type {string[]} */
  const failures = [];
  if (health.integrity !== "ok") failures.push(`integrity=${health.integrity || "unknown"}`);
  if (health.journalMode !== "wal") {
    failures.push(`journal_mode=${health.journalMode || "unknown"}`);
  }
  if (!health.foreignKeys) failures.push("foreign_keys=off");
  if (health.schemaVersion !== health.latestSchemaVersion) {
    failures.push(`schema_version=${health.schemaVersion}/${health.latestSchemaVersion}`);
  }
  if (health.migrationsApplied !== health.latestSchemaVersion) {
    failures.push(`migration_count=${health.migrationsApplied}/${health.latestSchemaVersion}`);
  }
  if (health.missingTables.length > 0) {
    failures.push(`missing_tables=${health.missingTables.join("|")}`);
  }
  return new Error(
    `Swift Sim SQLite database at ${health.path} failed health checks (${failures.join(", ")}). ` +
      "Refusing to use it; restore a verified backup before retrying.",
  );
}

/** @param {readonly SchemaMigration[]} migrations */
function validateMigrations(migrations) {
  if (!Array.isArray(migrations)) throw new Error("SQLite migrations must be an array.");
  let expectedVersion = 1;
  /** @type {SchemaMigration[]} */
  const validated = [];
  const names = new Set();
  /** @type {Set<string>} */
  const requiredTableNames = new Set();
  for (const migration of migrations) {
    if (!migration || migration.version !== expectedVersion) {
      throw new Error(
        `SQLite migrations must be contiguous from version 1; expected ${expectedVersion}.`,
      );
    }
    const name = requireNonEmptyString(
      migration.name,
      `SQLite migration ${migration.version} name`,
    );
    if (names.has(name)) throw new Error(`Duplicate SQLite migration name: ${name}.`);
    const rawStatements = /** @type {unknown} */ (migration.statements);
    if (!Array.isArray(rawStatements) || rawStatements.length === 0) {
      throw new Error(`SQLite migration ${migration.version} must contain at least one statement.`);
    }
    const statements = /** @type {unknown[]} */ (rawStatements).map((statement) =>
      requireNonEmptyString(statement, `SQLite migration ${migration.version} statement`),
    );
    const rawRequiredTables = /** @type {unknown} */ (migration.requiredTables);
    /** @type {readonly string[] | undefined} */
    let requiredTables;
    if (rawRequiredTables !== undefined) {
      if (!Array.isArray(rawRequiredTables)) {
        throw new Error(`SQLite migration ${migration.version} requiredTables must be an array.`);
      }
      const values = /** @type {unknown[]} */ (rawRequiredTables).map((tableName) =>
        requireNonEmptyString(tableName, `SQLite migration ${migration.version} required table`),
      );
      for (const tableName of values) {
        if (requiredTableNames.has(tableName)) {
          throw new Error(`Duplicate SQLite required table: ${tableName}.`);
        }
        requiredTableNames.add(tableName);
      }
      requiredTables = Object.freeze(values);
    }
    validated.push(
      Object.freeze({
        version: migration.version,
        name,
        statements: Object.freeze(statements),
        ...(requiredTables === undefined ? {} : { requiredTables }),
      }),
    );
    names.add(name);
    expectedVersion += 1;
  }
  return Object.freeze(validated);
}

/** @param {unknown} row */
function parseAppliedMigrationRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SQLite returned an invalid migration-history row.");
  }
  const values = /** @type {Record<string, unknown>} */ (row);
  const version = values.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    throw new Error("SQLite returned an invalid migration version.");
  }
  return {
    version,
    name: requireNonEmptyString(values.name, "SQLite migration name"),
    checksum: requireChecksum(values.checksum),
  };
}

/** @param {unknown} row */
function parseTableNameRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SQLite returned an invalid table-name row.");
  }
  return requireNonEmptyString(
    /** @type {Record<string, unknown>} */ (row).name,
    "SQLite table name",
  );
}

/** @param {SchemaMigration} migration */
function migrationChecksum(migration) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: migration.version,
        name: migration.name,
        statements: [...migration.statements],
        ...(migration.requiredTables === undefined
          ? {}
          : { requiredTables: [...migration.requiredTables] }),
      }),
    )
    .digest("hex");
}

/** @param {unknown} value */
function requireChecksum(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("SQLite migration checksum is invalid.");
  }
  return value;
}

/** @param {unknown} row @param {string} key @param {string} label */
function requiredIntegerColumn(row, key, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label} query returned no row.`);
  }
  const value = /** @type {Record<string, unknown>} */ (row)[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
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

/** @param {unknown} row */
function firstPragmaValue(row) {
  if (!row || typeof row !== "object") return "";
  const value = Object.values(row)[0];
  return String(value ?? "");
}

/** @param {string} left @param {string} right */
function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** @param {unknown} value */
function isPromiseLike(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  const candidate = /** @type {{ then?: unknown }} */ (value);
  return typeof candidate.then === "function";
}

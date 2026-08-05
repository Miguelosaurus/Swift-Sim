// @ts-check

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
  constructor({ path, migrations = SWIFT_SIM_SQLITE_MIGRATIONS, now = () => new Date().toISOString() }) {
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
      applied_at TEXT NOT NULL CHECK (length(applied_at) > 0)
    ) STRICT`);

    /** @type {Array<{ version: number | bigint, name: string }>} */
    const applied = /** @type {any} */ (
      this.#database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all()
    );
    const expectedByVersion = new Map(this.#migrations.map((migration) => [migration.version, migration]));
    for (const row of applied) {
      const version = Number(row.version);
      const expected = expectedByVersion.get(version);
      if (!expected) {
        throw new Error(`SQLite schema version ${version} is newer than this Swift Sim build.`);
      }
      if (row.name !== expected.name) {
        throw new Error(
          `SQLite migration ${version} is recorded as ${row.name}, expected ${expected.name}.`,
        );
      }
    }

    const appliedVersions = new Set(applied.map((row) => Number(row.version)));
    const recordMigration = this.#database.prepare(
      "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
    );
    for (const migration of this.#migrations) {
      if (appliedVersions.has(migration.version)) continue;
      this.transaction(() => {
        for (const statement of migration.statements) this.#database.exec(statement);
        recordMigration.run(migration.version, migration.name, this.#now());
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
    this.#transactionActive = true;
    this.#database.exec("BEGIN IMMEDIATE");
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
    const foreignKeys = Number(firstPragmaValue(this.#database.prepare("PRAGMA foreign_keys").get())) === 1;
    /** @type {{ version: number | bigint }} */
    const latest = /** @type {any} */ (
      this.#database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get()
    );
    /** @type {{ count: number | bigint }} */
    const count = /** @type {any} */ (
      this.#database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()
    );
    const schemaVersion = Number(latest.version);
    const latestSchemaVersion = this.#migrations.at(-1)?.version || 0;
    const migrationsApplied = Number(count.count);
    return {
      ok: integrity === "ok" && foreignKeys && schemaVersion === latestSchemaVersion,
      path: this.#path,
      integrity,
      journalMode,
      foreignKeys,
      schemaVersion,
      latestSchemaVersion,
      migrationsApplied,
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

/** @param {readonly SchemaMigration[]} migrations */
function validateMigrations(migrations) {
  if (!Array.isArray(migrations)) throw new Error("SQLite migrations must be an array.");
  let expectedVersion = 1;
  /** @type {SchemaMigration[]} */
  const validated = [];
  const names = new Set();
  for (const migration of migrations) {
    if (!migration || migration.version !== expectedVersion) {
      throw new Error(`SQLite migrations must be contiguous from version 1; expected ${expectedVersion}.`);
    }
    const name = requireNonEmptyString(migration.name, `SQLite migration ${migration.version} name`);
    if (names.has(name)) throw new Error(`Duplicate SQLite migration name: ${name}.`);
    if (!Array.isArray(migration.statements) || migration.statements.length === 0) {
      throw new Error(`SQLite migration ${migration.version} must contain at least one statement.`);
    }
    const statements = migration.statements.map((statement) =>
      requireNonEmptyString(statement, `SQLite migration ${migration.version} statement`),
    );
    validated.push(Object.freeze({ version: migration.version, name, statements: Object.freeze(statements) }));
    names.add(name);
    expectedVersion += 1;
  }
  return Object.freeze(validated);
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

/** @param {unknown} value */
function isPromiseLike(value) {
  return Boolean(
    value &&
      (typeof value === "object" || typeof value === "function") &&
      "then" in value &&
      typeof value.then === "function",
  );
}

// @ts-check

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PHASE4_SQLITE_MIGRATIONS } from "./phase4SqliteSchema.js";

const EXPECTED_IDENTITIES = Object.freeze(
  PHASE4_SQLITE_MIGRATIONS.map((migration) =>
    Object.freeze({
      version: migration.version,
      name: migration.name,
      checksum: migrationChecksum(migration),
    }),
  ),
);

export function expectedPhase4MigrationIdentities() {
  return EXPECTED_IDENTITIES;
}

/**
 * Read and validate an immutable exact migration prefix. This never constructs
 * SwiftSimSqliteDatabase and therefore can never apply a migration.
 *
 * @param {string} databasePath
 * @param {{ allowedVersions?: readonly number[], requireFull?: boolean, requireWal?: boolean }} [options]
 */
export function inspectPhase4MigrationIdentity(
  databasePath,
  { allowedVersions = [7, 8, 9], requireFull = false, requireWal = true } = {},
) {
  if (typeof databasePath !== "string" || !databasePath) {
    throw new TypeError("Phase-4 migration inspection requires a database path.");
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    // foreign_keys is connection-local. Enabling it on this read-only handle is
    // not a durable database mutation and lets the inspection exercise FK
    // checks under the same semantics as the migration-capable owner.
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA query_only = ON");

    const rows = database
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all()
      .map(parseMigrationRow);
    if (rows.length === 0) {
      throw new Error("Phase-4 schema_migrations is empty.");
    }

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const expectedVersion = index + 1;
      if (row.version !== expectedVersion) {
        throw new Error(
          `Phase-4 migration history is non-contiguous; expected ${expectedVersion}, found ${row.version}.`,
        );
      }
      const expected = EXPECTED_IDENTITIES[index];
      if (!expected) {
        throw new Error(`Phase-4 schema version ${row.version} is newer than this candidate.`);
      }
      if (row.name !== expected.name) {
        throw new Error(
          `Phase-4 migration ${row.version} is ${row.name}, expected ${expected.name}.`,
        );
      }
      if (row.checksum !== expected.checksum) {
        throw new Error(`Phase-4 migration ${row.version} checksum does not match this candidate.`);
      }
    }

    const schemaVersion = rows.at(-1)?.version || 0;
    if (!allowedVersions.includes(schemaVersion)) {
      throw new Error(
        `Phase-4 preflight does not accept schema version ${schemaVersion}; expected ${allowedVersions.join(" or ")}.`,
      );
    }
    if (requireFull && schemaVersion !== EXPECTED_IDENTITIES.length) {
      throw new Error(
        `Phase-4 post-migration inspection requires exact v${EXPECTED_IDENTITIES.length}, found v${schemaVersion}.`,
      );
    }
    if (rows.length !== schemaVersion) {
      throw new Error("Phase-4 migration row count does not match the exact contiguous prefix.");
    }

    const requiredTables = new Set(["schema_migrations"]);
    for (const migration of PHASE4_SQLITE_MIGRATIONS.slice(0, schemaVersion)) {
      for (const table of migration.requiredTables) requiredTables.add(table);
    }
    const existingTables = new Set(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => requireStringColumn(row, "name", "SQLite schema table name")),
    );
    const missingTables = [...requiredTables].filter((table) => !existingTables.has(table));
    if (missingTables.length > 0) {
      throw new Error(`Phase-4 database is missing required tables: ${missingTables.join(", ")}.`);
    }

    const integrity = firstPragmaValue(database.prepare("PRAGMA integrity_check").get());
    const journalMode = firstPragmaValue(database.prepare("PRAGMA journal_mode").get());
    const foreignKeys = Number(firstPragmaValue(database.prepare("PRAGMA foreign_keys").get())) === 1;
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all().length;
    if (integrity !== "ok") {
      throw new Error(`Phase-4 database integrity check failed: ${integrity || "unknown"}.`);
    }
    if (requireWal && journalMode !== "wal") {
      throw new Error(`Phase-4 database journal mode is ${journalMode || "unknown"}, expected wal.`);
    }
    if (!foreignKeys) throw new Error("Phase-4 database foreign-key enforcement is unavailable.");
    if (foreignKeyViolations !== 0) {
      throw new Error(`Phase-4 database has ${foreignKeyViolations} foreign-key violations.`);
    }

    return Object.freeze({
      schemaVersion,
      latestSchemaVersion: EXPECTED_IDENTITIES.length,
      migrationIdentities: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
      historyDigest: sha256(JSON.stringify(rows)),
      integrity,
      journalMode,
      foreignKeys,
      foreignKeyViolations,
      missingTables: Object.freeze([]),
      coherent: true,
      full: schemaVersion === EXPECTED_IDENTITIES.length,
    });
  } finally {
    database.close();
  }
}

/** @param {unknown} row */
function parseMigrationRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Phase-4 migration query returned an invalid row.");
  }
  const values = /** @type {Record<string, unknown>} */ (row);
  if (!Number.isSafeInteger(values.version) || Number(values.version) <= 0) {
    throw new Error("Phase-4 migration query returned an invalid version.");
  }
  const checksum = requireString(values.checksum, "Phase-4 migration checksum");
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error("Phase-4 migration checksum is not a lowercase SHA-256 digest.");
  }
  return {
    version: Number(values.version),
    name: requireString(values.name, "Phase-4 migration name"),
    checksum,
  };
}

/** @param {unknown} row @param {string} key @param {string} label */
function requireStringColumn(row, key, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label} query returned an invalid row.`);
  }
  return requireString(/** @type {Record<string, unknown>} */ (row)[key], label);
}

/** @param {unknown} value @param {string} label */
function requireString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be non-empty.`);
  return value;
}

/** @param {unknown} row */
function firstPragmaValue(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Phase-4 SQLite pragma returned no row.");
  }
  const values = Object.values(row);
  if (values.length !== 1) throw new Error("Phase-4 SQLite pragma returned an ambiguous row.");
  return String(values[0] ?? "");
}

/** @param {{ version: number, name: string, statements: readonly string[], requiredTables: readonly string[] }} migration */
function migrationChecksum(migration) {
  return sha256(
    JSON.stringify({
      version: migration.version,
      name: migration.name,
      statements: [...migration.statements],
      requiredTables: [...migration.requiredTables],
    }),
  );
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

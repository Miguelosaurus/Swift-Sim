// @ts-check

/** @typedef {import("../contracts/repository.js").LegacyImportCheckpoint} LegacyImportCheckpoint */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

/**
 * Durable idempotency/shadow-comparison evidence for staged JSON imports.
 * This repository is not wired into production readers or writers in Phase 4A.
 */
export class SqliteLegacyImportCheckpointRepository {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  #getStatement;
  #listStatement;
  #upsertStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#database = database;
    this.#getStatement = database.prepare(`SELECT
      source,
      source_revision,
      projection_hash,
      imported_at,
      record_count
    FROM legacy_import_checkpoints
    WHERE source = ?`);
    this.#listStatement = database.prepare(`SELECT
      source,
      source_revision,
      projection_hash,
      imported_at,
      record_count
    FROM legacy_import_checkpoints
    ORDER BY source`);
    this.#upsertStatement = database.prepare(`INSERT INTO legacy_import_checkpoints(
      source,
      source_revision,
      projection_hash,
      imported_at,
      record_count
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET
      source_revision = excluded.source_revision,
      projection_hash = excluded.projection_hash,
      imported_at = excluded.imported_at,
      record_count = excluded.record_count`);
  }

  /** @param {string} source @returns {LegacyImportCheckpoint | null} */
  get(source) {
    const row = this.#getStatement.get(requireNonEmptyString(source, "Legacy import source"));
    return row ? mapCheckpointRow(row) : null;
  }

  /** @returns {LegacyImportCheckpoint[]} */
  list() {
    return this.#listStatement.all().map(mapCheckpointRow);
  }

  /** @param {LegacyImportCheckpoint} checkpoint */
  upsert(checkpoint) {
    const record = validateCheckpoint(checkpoint);
    this.#upsertStatement.run(
      record.source,
      record.sourceRevision,
      record.projectionHash,
      record.importedAt,
      record.recordCount,
    );
  }

  /**
   * Atomically update checkpoint evidence with other future repository writes.
   * @template T
   * @param {() => T} operation
   * @returns {T}
   */
  transaction(operation) {
    return this.#database.transaction(operation);
  }
}

/** @param {LegacyImportCheckpoint} checkpoint */
function validateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") {
    throw new Error("Legacy import checkpoint must be an object.");
  }
  const recordCount = Number(checkpoint.recordCount);
  if (!Number.isSafeInteger(recordCount) || recordCount < 0) {
    throw new Error("Legacy import checkpoint recordCount must be a non-negative safe integer.");
  }
  return {
    source: requireNonEmptyString(checkpoint.source, "Legacy import source"),
    sourceRevision: requireNonEmptyString(
      checkpoint.sourceRevision,
      "Legacy import sourceRevision",
    ),
    projectionHash: requireNonEmptyString(
      checkpoint.projectionHash,
      "Legacy import projectionHash",
    ),
    importedAt: requireNonEmptyString(checkpoint.importedAt, "Legacy import importedAt"),
    recordCount,
  };
}

/** @param {unknown} row @returns {LegacyImportCheckpoint} */
function mapCheckpointRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SQLite returned an invalid legacy import checkpoint row.");
  }
  const values = /** @type {Record<string, unknown>} */ (row);
  return validateCheckpoint({
    source: values.source,
    sourceRevision: values.source_revision,
    projectionHash: values.projection_hash,
    importedAt: values.imported_at,
    recordCount: values.record_count,
  });
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

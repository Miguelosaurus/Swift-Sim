// @ts-check

import { pairingShadowMismatchID } from "./pairingShadowComparison.js";

/** @typedef {import("../contracts/repository.js").PairingShadowMismatchEvidence} PairingShadowMismatchEvidence */
/** @typedef {import("../contracts/repository.js").PairingShadowMismatchObservation} PairingShadowMismatchObservation */
/** @typedef {import("../contracts/repository.js").PairingShadowSurface} PairingShadowSurface */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

export class SqlitePairingShadowMismatchRepository {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  #getStatement;
  #listStatement;
  #observeStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#database = database;
    this.#getStatement = database.prepare(`${SELECT_COLUMNS}
      WHERE mismatch_id = ?`);
    this.#listStatement = database.prepare(`${SELECT_COLUMNS}
      ORDER BY surface, key_hash, mismatch_id`);
    this.#observeStatement = database.prepare(`INSERT INTO pairing_shadow_mismatches(
      mismatch_id,
      surface,
      key_hash,
      legacy_projection_hash,
      sqlite_projection_hash,
      first_observed_at,
      last_observed_at,
      observation_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(mismatch_id) DO UPDATE SET
      last_observed_at = excluded.last_observed_at,
      observation_count = pairing_shadow_mismatches.observation_count + 1
    WHERE
      pairing_shadow_mismatches.surface = excluded.surface AND
      pairing_shadow_mismatches.key_hash = excluded.key_hash AND
      pairing_shadow_mismatches.legacy_projection_hash IS excluded.legacy_projection_hash AND
      pairing_shadow_mismatches.sqlite_projection_hash IS excluded.sqlite_projection_hash`);
  }

  /** @param {string} mismatchID @returns {PairingShadowMismatchEvidence | null} */
  get(mismatchID) {
    const row = this.#getStatement.get(requireHash(mismatchID, "Pairing shadow mismatchID"));
    return row ? mapEvidenceRow(row) : null;
  }

  /** @returns {PairingShadowMismatchEvidence[]} */
  list() {
    return this.#listStatement.all().map(mapEvidenceRow);
  }

  /**
   * @param {PairingShadowMismatchObservation} observation
   * @returns {PairingShadowMismatchEvidence}
   */
  observe(observation) {
    const record = validateObservation(observation);
    this.#observeStatement.run(
      record.mismatchID,
      record.surface,
      record.keyHash,
      record.legacyProjectionHash,
      record.sqliteProjectionHash,
      record.observedAt,
      record.observedAt,
    );
    const persisted = this.get(record.mismatchID);
    if (!persisted) {
      throw new Error("Pairing shadow mismatch evidence did not persist.");
    }
    return persisted;
  }
}

const SELECT_COLUMNS = `SELECT
  mismatch_id,
  surface,
  key_hash,
  legacy_projection_hash,
  sqlite_projection_hash,
  first_observed_at,
  last_observed_at,
  observation_count
FROM pairing_shadow_mismatches`;

/** @param {unknown} observation @returns {PairingShadowMismatchObservation} */
function validateObservation(observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    throw new Error("Pairing shadow mismatch observation must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (observation);
  const surface = requireSurface(values.surface);
  const keyHash = requireHash(values.keyHash, "Pairing shadow keyHash");
  const legacyProjectionHash = requireNullableHash(
    values.legacyProjectionHash,
    "Pairing shadow legacyProjectionHash",
  );
  const sqliteProjectionHash = requireNullableHash(
    values.sqliteProjectionHash,
    "Pairing shadow sqliteProjectionHash",
  );
  if (legacyProjectionHash === sqliteProjectionHash) {
    throw new Error("Pairing shadow mismatch observation must contain different projections.");
  }
  const mismatchID = requireHash(values.mismatchID, "Pairing shadow mismatchID");
  const expectedMismatchID = pairingShadowMismatchID({
    surface,
    keyHash,
    legacyProjectionHash,
    sqliteProjectionHash,
  });
  if (mismatchID !== expectedMismatchID) {
    throw new Error("Pairing shadow mismatchID does not match its redacted projections.");
  }
  return {
    mismatchID,
    surface,
    keyHash,
    legacyProjectionHash,
    sqliteProjectionHash,
    observedAt: requireTimestamp(values.observedAt, "Pairing shadow observedAt"),
  };
}

/** @param {unknown} row @returns {PairingShadowMismatchEvidence} */
function mapEvidenceRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SQLite returned an invalid pairing shadow mismatch row.");
  }
  const values = /** @type {Record<string, unknown>} */ (row);
  const observationCount = values.observation_count;
  if (
    typeof observationCount !== "number" ||
    !Number.isSafeInteger(observationCount) ||
    observationCount < 1
  ) {
    throw new Error("Pairing shadow observationCount must be a positive safe integer.");
  }
  const surface = requireSurface(values.surface);
  const keyHash = requireHash(values.key_hash, "Pairing shadow keyHash");
  const legacyProjectionHash = requireNullableHash(
    values.legacy_projection_hash,
    "Pairing shadow legacyProjectionHash",
  );
  const sqliteProjectionHash = requireNullableHash(
    values.sqlite_projection_hash,
    "Pairing shadow sqliteProjectionHash",
  );
  if (legacyProjectionHash === sqliteProjectionHash) {
    throw new Error("SQLite returned matching pairing shadow projections as a mismatch.");
  }
  const mismatchID = requireHash(values.mismatch_id, "Pairing shadow mismatchID");
  if (
    mismatchID !==
    pairingShadowMismatchID({ surface, keyHash, legacyProjectionHash, sqliteProjectionHash })
  ) {
    throw new Error("SQLite returned pairing shadow evidence with an invalid mismatchID.");
  }
  const firstObservedAt = requireTimestamp(
    values.first_observed_at,
    "Pairing shadow firstObservedAt",
  );
  const lastObservedAt = requireTimestamp(values.last_observed_at, "Pairing shadow lastObservedAt");
  if (Date.parse(lastObservedAt) < Date.parse(firstObservedAt)) {
    throw new Error("Pairing shadow lastObservedAt cannot precede firstObservedAt.");
  }
  return {
    mismatchID,
    surface,
    keyHash,
    legacyProjectionHash,
    sqliteProjectionHash,
    firstObservedAt,
    lastObservedAt,
    observationCount,
  };
}

/** @param {unknown} value @returns {PairingShadowSurface} */
function requireSurface(value) {
  if (value !== "credential" && value !== "invitation") {
    throw new Error("Pairing shadow surface must be credential or invitation.");
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireNullableHash(value, label) {
  return value === null ? null : requireHash(value, label);
}

/** @param {unknown} value @param {string} label */
function requireTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return value;
}

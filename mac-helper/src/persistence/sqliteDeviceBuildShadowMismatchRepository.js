// @ts-check

import { deviceBuildShadowMismatchID } from "./deviceBuildShadowComparison.js";

/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowMismatchEvidence} DeviceBuildShadowMismatchEvidence */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowMismatchObservation} DeviceBuildShadowMismatchObservation */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowSurface} DeviceBuildShadowSurface */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

const MAX_OBSERVATION_COUNT = Number.MAX_SAFE_INTEGER;
const SELECT_COLUMNS = `SELECT
  mismatch_id,
  surface,
  key_hash,
  legacy_projection_hash,
  sqlite_projection_hash,
  first_observed_at,
  last_observed_at,
  observation_count
FROM device_build_shadow_mismatches`;

export class SqliteDeviceBuildShadowMismatchRepository {
  #getStatement;
  #listStatement;
  #observeStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#getStatement = database.prepare(`${SELECT_COLUMNS}
      WHERE mismatch_id = ?`);
    this.#listStatement = database.prepare(`${SELECT_COLUMNS}
      ORDER BY surface, key_hash, mismatch_id`);
    this.#observeStatement = database.prepare(`INSERT INTO device_build_shadow_mismatches(
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
      last_observed_at = CASE
        WHEN excluded.last_observed_at > device_build_shadow_mismatches.last_observed_at
          THEN excluded.last_observed_at
        ELSE device_build_shadow_mismatches.last_observed_at
      END,
      observation_count = CASE
        WHEN device_build_shadow_mismatches.observation_count < ${MAX_OBSERVATION_COUNT}
          THEN device_build_shadow_mismatches.observation_count + 1
        ELSE device_build_shadow_mismatches.observation_count
      END
    WHERE
      device_build_shadow_mismatches.surface = excluded.surface AND
      device_build_shadow_mismatches.key_hash = excluded.key_hash AND
      device_build_shadow_mismatches.legacy_projection_hash IS excluded.legacy_projection_hash AND
      device_build_shadow_mismatches.sqlite_projection_hash IS excluded.sqlite_projection_hash`);
  }

  /** @param {string} mismatchID @returns {DeviceBuildShadowMismatchEvidence | null} */
  get(mismatchID) {
    const row = this.#getStatement.get(requireHash(mismatchID, "Device-build shadow mismatchID"));
    return row ? mapEvidenceRow(row) : null;
  }

  /** @returns {DeviceBuildShadowMismatchEvidence[]} */
  list() {
    return this.#listStatement.all().map(mapEvidenceRow);
  }

  /**
   * @param {DeviceBuildShadowMismatchObservation} observation
   * @returns {DeviceBuildShadowMismatchEvidence}
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
      throw new Error("Device-build shadow mismatch evidence did not persist.");
    }
    return persisted;
  }
}

/** @param {unknown} observation @returns {DeviceBuildShadowMismatchObservation} */
function validateObservation(observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    throw new Error("Device-build shadow mismatch observation must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (observation);
  const surface = requireSurface(values.surface);
  const keyHash = requireHash(values.keyHash, "Device-build shadow keyHash");
  const legacyProjectionHash = requireNullableHash(
    values.legacyProjectionHash,
    "Device-build shadow legacyProjectionHash",
  );
  const sqliteProjectionHash = requireNullableHash(
    values.sqliteProjectionHash,
    "Device-build shadow sqliteProjectionHash",
  );
  if (legacyProjectionHash === sqliteProjectionHash) {
    throw new Error("Device-build shadow mismatch observation must contain different projections.");
  }
  const mismatchID = requireHash(values.mismatchID, "Device-build shadow mismatchID");
  const expectedMismatchID = deviceBuildShadowMismatchID({
    surface,
    keyHash,
    legacyProjectionHash,
    sqliteProjectionHash,
  });
  if (mismatchID !== expectedMismatchID) {
    throw new Error("Device-build shadow mismatchID does not match its redacted projections.");
  }
  return {
    mismatchID,
    surface,
    keyHash,
    legacyProjectionHash,
    sqliteProjectionHash,
    observedAt: requireTimestamp(values.observedAt, "Device-build shadow observedAt"),
  };
}

/** @param {unknown} row @returns {DeviceBuildShadowMismatchEvidence} */
function mapEvidenceRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SQLite returned an invalid device-build shadow mismatch row.");
  }
  const values = /** @type {Record<string, unknown>} */ (row);
  const observationCount = values.observation_count;
  if (
    typeof observationCount !== "number" ||
    !Number.isSafeInteger(observationCount) ||
    observationCount < 1 ||
    observationCount > MAX_OBSERVATION_COUNT
  ) {
    throw new Error("Device-build shadow observationCount must be a positive safe integer.");
  }
  const surface = requireSurface(values.surface);
  const keyHash = requireHash(values.key_hash, "Device-build shadow keyHash");
  const legacyProjectionHash = requireNullableHash(
    values.legacy_projection_hash,
    "Device-build shadow legacyProjectionHash",
  );
  const sqliteProjectionHash = requireNullableHash(
    values.sqlite_projection_hash,
    "Device-build shadow sqliteProjectionHash",
  );
  if (legacyProjectionHash === sqliteProjectionHash) {
    throw new Error("SQLite returned matching device-build shadow projections as a mismatch.");
  }
  const mismatchID = requireHash(values.mismatch_id, "Device-build shadow mismatchID");
  if (
    mismatchID !==
    deviceBuildShadowMismatchID({
      surface,
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
    })
  ) {
    throw new Error("SQLite returned device-build shadow evidence with an invalid mismatchID.");
  }
  const firstObservedAt = requireTimestamp(
    values.first_observed_at,
    "Device-build shadow firstObservedAt",
  );
  const lastObservedAt = requireTimestamp(
    values.last_observed_at,
    "Device-build shadow lastObservedAt",
  );
  if (lastObservedAt < firstObservedAt) {
    throw new Error("Device-build shadow lastObservedAt cannot precede firstObservedAt.");
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

/** @param {unknown} value @returns {DeviceBuildShadowSurface} */
function requireSurface(value) {
  if (
    value !== "build" &&
    value !== "app" &&
    value !== "artifact-cleanup-job" &&
    value !== "delivery-cleanup-job"
  ) {
    throw new Error("Device-build shadow surface is invalid.");
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
  if (typeof value !== "string") {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return value;
}

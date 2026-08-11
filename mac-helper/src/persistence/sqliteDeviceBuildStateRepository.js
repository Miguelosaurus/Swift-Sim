// @ts-check

import { isDeviceBuildRecord } from "../contracts/build.js";

/** @typedef {import("../contracts/build.js").DeviceBuildRecord} DeviceBuildRecord */
/** @typedef {import("../contracts/deviceBuildRepository.js").ArtifactCleanupJobRecord} ArtifactCleanupJobRecord */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeliveryReferenceCleanupJobRecord} DeliveryReferenceCleanupJobRecord */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildAppStateRecord} DeviceBuildAppStateRecord */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateSnapshot} DeviceBuildStateSnapshot */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

export class SqliteDeviceBuildStateRepository {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  #readBuildsStatement;
  #readAppsStatement;
  #readArtifactCleanupJobsStatement;
  #readDeliveryCleanupJobsStatement;
  #getBuildStatement;
  #deleteBuildsStatement;
  #deleteAppsStatement;
  #deleteArtifactCleanupJobsStatement;
  #deleteDeliveryCleanupJobsStatement;
  #insertBuildStatement;
  #insertAppStatement;
  #insertArtifactCleanupJobStatement;
  #insertDeliveryCleanupJobStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#database = database;
    this.#readBuildsStatement = database.prepare(
      "SELECT record_json FROM device_builds ORDER BY created_at DESC, id",
    );
    this.#readAppsStatement = database.prepare(
      "SELECT record_json FROM device_app_state ORDER BY id",
    );
    this.#readArtifactCleanupJobsStatement = database.prepare(
      "SELECT record_json FROM artifact_cleanup_jobs ORDER BY created_at, id",
    );
    this.#readDeliveryCleanupJobsStatement = database.prepare(
      "SELECT record_json FROM delivery_reference_cleanup_jobs ORDER BY created_at, id",
    );
    this.#getBuildStatement = database.prepare(
      "SELECT record_json FROM device_builds WHERE id = ?",
    );
    this.#deleteDeliveryCleanupJobsStatement = database.prepare(
      "DELETE FROM delivery_reference_cleanup_jobs",
    );
    this.#deleteArtifactCleanupJobsStatement = database.prepare(
      "DELETE FROM artifact_cleanup_jobs",
    );
    this.#deleteAppsStatement = database.prepare("DELETE FROM device_app_state");
    this.#deleteBuildsStatement = database.prepare("DELETE FROM device_builds");
    this.#insertBuildStatement = database.prepare(`INSERT INTO device_builds(
      id,
      revision,
      app_identity,
      state,
      created_at,
      updated_at,
      record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    this.#insertAppStatement = database.prepare(`INSERT INTO device_app_state(
      id,
      archived_at,
      record_json
    ) VALUES (?, ?, ?)`);
    this.#insertArtifactCleanupJobStatement = database.prepare(`INSERT INTO artifact_cleanup_jobs(
      id,
      build_id,
      root,
      created_at,
      next_attempt_at,
      attempts,
      record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    this.#insertDeliveryCleanupJobStatement =
      database.prepare(`INSERT INTO delivery_reference_cleanup_jobs(
      id,
      build_id,
      generation,
      reference_id,
      created_at,
      next_attempt_at,
      attempts,
      record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  }

  /** @returns {DeviceBuildStateSnapshot} */
  read() {
    return normalizeDeviceBuildStateSnapshot({
      builds: this.#readBuildsStatement.all().map(mapBuildRow),
      apps: this.#readAppsStatement
        .all()
        .map((row) => mapJSONRow(row, normalizeAppState, "device app state")),
      artifactCleanupJobs: this.#readArtifactCleanupJobsStatement
        .all()
        .map((row) => mapJSONRow(row, normalizeArtifactCleanupJob, "artifact cleanup job")),
      deliveryReferenceCleanupJobs: this.#readDeliveryCleanupJobsStatement
        .all()
        .map((row) => mapJSONRow(row, normalizeDeliveryCleanupJob, "delivery cleanup job")),
    });
  }

  /** @param {string} id @returns {DeviceBuildRecord | null} */
  getBuild(id) {
    const row = this.#getBuildStatement.get(requireNonEmptyString(id, "Device build id"));
    return row ? mapBuildRow(row) : null;
  }

  /** @param {DeviceBuildStateSnapshot} snapshot */
  replace(snapshot) {
    const normalized = normalizeDeviceBuildStateSnapshot(snapshot);
    this.#database.transaction(() => {
      this.#deleteDeliveryCleanupJobsStatement.run();
      this.#deleteArtifactCleanupJobsStatement.run();
      this.#deleteAppsStatement.run();
      this.#deleteBuildsStatement.run();

      for (const build of normalized.builds) insertBuild(this.#insertBuildStatement, build);
      for (const app of normalized.apps) insertApp(this.#insertAppStatement, app);
      for (const job of normalized.artifactCleanupJobs) {
        insertArtifactCleanupJob(this.#insertArtifactCleanupJobStatement, job);
      }
      for (const job of normalized.deliveryReferenceCleanupJobs) {
        insertDeliveryCleanupJob(this.#insertDeliveryCleanupJobStatement, job);
      }
    });
  }
}

/** @param {DeviceBuildStateSnapshot} value @returns {DeviceBuildStateSnapshot} */
export function normalizeDeviceBuildStateSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Device build state snapshot must be an object.");
  }
  if (!Array.isArray(value.builds))
    throw new Error("Device build snapshot builds must be an array.");
  if (!Array.isArray(value.apps)) throw new Error("Device build snapshot apps must be an array.");
  if (!Array.isArray(value.artifactCleanupJobs)) {
    throw new Error("Device build snapshot artifact cleanup jobs must be an array.");
  }
  if (!Array.isArray(value.deliveryReferenceCleanupJobs)) {
    throw new Error("Device build snapshot delivery cleanup jobs must be an array.");
  }

  const builds = value.builds.map(normalizeBuild).sort(compareBuilds);
  const apps = value.apps.map(normalizeAppState).sort(compareIDs);
  const artifactCleanupJobs = value.artifactCleanupJobs
    .map(normalizeArtifactCleanupJob)
    .sort(compareCreatedIDs);
  const deliveryReferenceCleanupJobs = value.deliveryReferenceCleanupJobs
    .map(normalizeDeliveryCleanupJob)
    .sort(compareCreatedIDs);

  assertUnique(builds, (record) => record.id, "device build id");
  assertUnique(apps, (record) => record.id, "device app id");
  assertUnique(artifactCleanupJobs, (record) => record.id, "artifact cleanup job id");
  assertUnique(deliveryReferenceCleanupJobs, (record) => record.id, "delivery cleanup job id");

  return { builds, apps, artifactCleanupJobs, deliveryReferenceCleanupJobs };
}

/** @param {unknown} value @returns {DeviceBuildRecord} */
function normalizeBuild(value) {
  const build = cloneRecord(value, "Device build");
  if (!isDeviceBuildRecord(build)) throw new Error("Device build record is invalid.");
  return build;
}

/** @param {unknown} value @returns {DeviceBuildAppStateRecord} */
function normalizeAppState(value) {
  const record = cloneRecord(value, "Device app state");
  record.id = requireNonEmptyString(record.id, "Device app state id");
  record.archivedAt = requireString(record.archivedAt, "Device app archivedAt");
  return /** @type {DeviceBuildAppStateRecord} */ (record);
}

/** @param {unknown} value @returns {ArtifactCleanupJobRecord} */
function normalizeArtifactCleanupJob(value) {
  const record = cloneRecord(value, "Artifact cleanup job");
  record.id = requireNonEmptyString(record.id, "Artifact cleanup job id");
  record.root = requireNonEmptyString(record.root, "Artifact cleanup job root");
  normalizeOptionalString(record, "buildId", "Artifact cleanup job buildId");
  record.createdAt = requireNonEmptyString(record.createdAt, "Artifact cleanup job createdAt");
  normalizeOptionalString(record, "notBefore", "Artifact cleanup job notBefore");
  normalizeOptionalString(record, "nextAttemptAt", "Artifact cleanup job nextAttemptAt");
  record.attempts = requireNonNegativeInteger(record.attempts, "Artifact cleanup job attempts");
  record.lastError = requireString(record.lastError, "Artifact cleanup job lastError");
  normalizeOptionalString(record, "updatedAt", "Artifact cleanup job updatedAt");
  return /** @type {ArtifactCleanupJobRecord} */ (record);
}

/** @param {unknown} value @returns {DeliveryReferenceCleanupJobRecord} */
function normalizeDeliveryCleanupJob(value) {
  const record = cloneRecord(value, "Delivery cleanup job");
  record.id = requireNonEmptyString(record.id, "Delivery cleanup job id");
  record.generation = requireNonEmptyString(record.generation, "Delivery cleanup job generation");
  record.referenceID = requireNonEmptyString(
    record.referenceID,
    "Delivery cleanup job referenceID",
  );
  normalizeOptionalString(record, "buildId", "Delivery cleanup job buildId");
  record.createdAt = requireNonEmptyString(record.createdAt, "Delivery cleanup job createdAt");
  normalizeOptionalString(record, "nextAttemptAt", "Delivery cleanup job nextAttemptAt");
  record.attempts = requireNonNegativeInteger(record.attempts, "Delivery cleanup job attempts");
  record.lastError = requireString(record.lastError, "Delivery cleanup job lastError");
  normalizeOptionalString(record, "updatedAt", "Delivery cleanup job updatedAt");
  return /** @type {DeliveryReferenceCleanupJobRecord} */ (record);
}

/** @param {unknown} row @returns {DeviceBuildRecord} */
function mapBuildRow(row) {
  return mapJSONRow(row, normalizeBuild, "device build");
}

/**
 * @template T
 * @param {unknown} row
 * @param {(value: unknown) => T} normalize
 * @param {string} label
 * @returns {T}
 */
function mapJSONRow(row, normalize, label) {
  const values = rowValues(row, label);
  if (typeof values.record_json !== "string") {
    throw new Error(`SQLite returned an invalid ${label} JSON column.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(values.record_json);
  } catch {
    throw new Error(`SQLite returned malformed ${label} JSON.`);
  }
  return normalize(parsed);
}

/** @param {import("node:sqlite").StatementSync} statement @param {DeviceBuildRecord} build */
function insertBuild(statement, build) {
  statement.run(
    build.id,
    build.revision,
    build.app.identity || "",
    build.state,
    build.createdAt,
    build.updatedAt,
    serializeRecord(build, "Device build"),
  );
}

/** @param {import("node:sqlite").StatementSync} statement @param {DeviceBuildAppStateRecord} app */
function insertApp(statement, app) {
  statement.run(app.id, app.archivedAt, serializeRecord(app, "Device app state"));
}

/** @param {import("node:sqlite").StatementSync} statement @param {ArtifactCleanupJobRecord} job */
function insertArtifactCleanupJob(statement, job) {
  statement.run(
    job.id,
    job.buildId || "",
    job.root,
    job.createdAt,
    job.nextAttemptAt || "",
    job.attempts,
    serializeRecord(job, "Artifact cleanup job"),
  );
}

/** @param {import("node:sqlite").StatementSync} statement @param {DeliveryReferenceCleanupJobRecord} job */
function insertDeliveryCleanupJob(statement, job) {
  statement.run(
    job.id,
    job.buildId || "",
    job.generation,
    job.referenceID,
    job.createdAt,
    job.nextAttemptAt || "",
    job.attempts,
    serializeRecord(job, "Delivery cleanup job"),
  );
}

/** @param {unknown} value @param {string} label */
function cloneRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return /** @type {Record<string, unknown>} */ (structuredClone(value));
}

/** @param {Record<string, unknown>} record @param {string} key @param {string} label */
function normalizeOptionalString(record, key, label) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return;
  record[key] = requireString(record[key], label);
}

/** @param {unknown} value @param {string} label */
function requireString(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  const result = requireString(value, label);
  if (result.trim().length === 0) throw new Error(`${label} must be non-empty.`);
  return result;
}

/** @param {unknown} value @param {string} label */
function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} row @param {string} label */
function rowValues(row, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`SQLite returned an invalid ${label} row.`);
  }
  return /** @type {Record<string, unknown>} */ (row);
}

/** @param {Record<string, unknown> | DeviceBuildRecord} record @param {string} label */
function serializeRecord(record, label) {
  let serialized;
  try {
    serialized = JSON.stringify(record);
  } catch {
    throw new Error(`${label} must be JSON serializable.`);
  }
  if (typeof serialized !== "string") throw new Error(`${label} must be JSON serializable.`);
  return serialized;
}

/** @param {DeviceBuildRecord} left @param {DeviceBuildRecord} right */
function compareBuilds(left, right) {
  const created = right.createdAt.localeCompare(left.createdAt);
  return created || left.id.localeCompare(right.id);
}

/** @param {{ id: string }} left @param {{ id: string }} right */
function compareIDs(left, right) {
  return left.id.localeCompare(right.id);
}

/** @param {{ id: string, createdAt: string }} left @param {{ id: string, createdAt: string }} right */
function compareCreatedIDs(left, right) {
  const created = left.createdAt.localeCompare(right.createdAt);
  return created || left.id.localeCompare(right.id);
}

/**
 * @template T
 * @param {readonly T[]} records
 * @param {(record: T) => string} keyFor
 * @param {string} label
 */
function assertUnique(records, keyFor, label) {
  const keys = new Set();
  for (const record of records) {
    const key = keyFor(record);
    if (keys.has(key)) throw new Error(`Duplicate ${label}: ${key}.`);
    keys.add(key);
  }
}

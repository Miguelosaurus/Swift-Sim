// @ts-check

import { createHash } from "node:crypto";
import { isDeviceBuildRecord } from "../contracts/build.js";

/** @typedef {import("../contracts/deviceBuildRepository.js").ArtifactCleanupJobRecord} ArtifactCleanupJobRecord */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeliveryReferenceCleanupJobRecord} DeliveryReferenceCleanupJobRecord */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildAppStateRecord} DeviceBuildAppStateRecord */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowComparisonResult} DeviceBuildShadowComparisonResult */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowMismatchRepository} DeviceBuildShadowMismatchRepository */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowProjection} DeviceBuildShadowProjection */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowSurface} DeviceBuildShadowSurface */
/** @typedef {import("../infrastructure/ports.js").Clock} Clock */

export class DeviceBuildShadowComparator {
  /** @type {DeviceBuildShadowMismatchRepository} */
  #mismatchRepository;
  /** @type {Clock} */
  #clock;

  /**
   * @param {{
   *   mismatchRepository: DeviceBuildShadowMismatchRepository,
   *   clock: Clock,
   * }} options
   */
  constructor({ mismatchRepository, clock }) {
    if (
      !mismatchRepository ||
      typeof mismatchRepository.observe !== "function" ||
      typeof mismatchRepository.get !== "function" ||
      typeof mismatchRepository.list !== "function"
    ) {
      throw new Error("Device-build shadow mismatch repository is required.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new Error("Device-build shadow clock is required.");
    }
    this.#mismatchRepository = mismatchRepository;
    this.#clock = clock;
  }

  /**
   * Compare one already-authorized legacy projection with its SQLite shadow.
   * The returned hashes/evidence are diagnostic only and must never influence
   * legacy authorization, response projection, or mutation decisions.
   *
   * @param {{
   *   surface: DeviceBuildShadowSurface,
   *   key: string,
   *   legacy: DeviceBuildShadowProjection,
   *   sqlite: DeviceBuildShadowProjection,
   * }} input
   * @returns {DeviceBuildShadowComparisonResult}
   */
  compare({ surface, key, legacy, sqlite }) {
    const normalizedSurface = requireSurface(surface);
    const normalizedKey = requireNonEmptyString(key, "Device-build shadow key");
    const legacyProjection = normalizeProjection(normalizedSurface, normalizedKey, legacy);
    const sqliteProjection = normalizeProjection(normalizedSurface, normalizedKey, sqlite);
    const keyHash = deviceBuildShadowKeyHash(normalizedKey);
    const legacyProjectionHash = deviceBuildShadowProjectionHash(legacyProjection);
    const sqliteProjectionHash = deviceBuildShadowProjectionHash(sqliteProjection);

    if (legacyProjectionHash === sqliteProjectionHash) {
      return {
        matched: true,
        surface: normalizedSurface,
        keyHash,
        legacyProjectionHash,
        sqliteProjectionHash,
        evidence: null,
      };
    }

    const mismatchID = deviceBuildShadowMismatchID({
      surface: normalizedSurface,
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
    });
    const observedAt = canonicalTimestamp(
      this.#clock.now().toISOString(),
      "Device-build shadow observedAt",
    );
    const evidence = this.#mismatchRepository.observe({
      mismatchID,
      surface: normalizedSurface,
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
      observedAt,
    });
    return {
      matched: false,
      surface: normalizedSurface,
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
      evidence,
    };
  }
}

/** @param {string} key */
export function deviceBuildShadowKeyHash(key) {
  return sha256(requireNonEmptyString(key, "Device-build shadow key"));
}

/** @param {DeviceBuildShadowProjection} projection */
export function deviceBuildShadowProjectionHash(projection) {
  if (projection === null) return null;
  return sha256(canonicalJSONString(projection));
}

/**
 * @param {{
 *   surface: DeviceBuildShadowSurface,
 *   keyHash: string,
 *   legacyProjectionHash: string | null,
 *   sqliteProjectionHash: string | null,
 * }} input
 */
export function deviceBuildShadowMismatchID({
  surface,
  keyHash,
  legacyProjectionHash,
  sqliteProjectionHash,
}) {
  const normalizedSurface = requireSurface(surface);
  const normalizedKeyHash = requireHash(keyHash, "Device-build shadow keyHash");
  const normalizedLegacy = requireNullableHash(
    legacyProjectionHash,
    "Device-build shadow legacyProjectionHash",
  );
  const normalizedSqlite = requireNullableHash(
    sqliteProjectionHash,
    "Device-build shadow sqliteProjectionHash",
  );
  if (normalizedLegacy === normalizedSqlite) {
    throw new Error("Device-build shadow mismatch must contain different projections.");
  }
  return sha256(
    canonicalJSONString({
      surface: normalizedSurface,
      keyHash: normalizedKeyHash,
      legacyProjectionHash: normalizedLegacy,
      sqliteProjectionHash: normalizedSqlite,
    }),
  );
}

/**
 * @param {DeviceBuildShadowSurface} surface
 * @param {string} key
 * @param {DeviceBuildShadowProjection} projection
 * @returns {DeviceBuildShadowProjection}
 */
function normalizeProjection(surface, key, projection) {
  if (projection === null) return null;
  const clone = structuredClone(projection);
  switch (surface) {
    case "build":
      if (!isDeviceBuildRecord(clone)) {
        throw new Error("Device-build shadow build projection is invalid.");
      }
      requireProjectionKey(clone.id, key, surface);
      return clone;
    case "app":
      validateApp(clone);
      requireProjectionKey(clone.id, key, surface);
      return clone;
    case "artifact-cleanup-job":
      validateArtifactCleanupJob(clone);
      requireProjectionKey(clone.id, key, surface);
      return clone;
    case "delivery-cleanup-job":
      validateDeliveryCleanupJob(clone);
      requireProjectionKey(clone.id, key, surface);
      return clone;
  }
}

/** @param {unknown} value */
function validateApp(value) {
  const record = requireRecord(value, "Device-build shadow app projection");
  requireNonEmptyString(record.id, "Device-build shadow app id");
  requireString(record.archivedAt, "Device-build shadow app archivedAt");
  return /** @type {DeviceBuildAppStateRecord} */ (record);
}

/** @param {unknown} value */
function validateArtifactCleanupJob(value) {
  const record = requireRecord(value, "Device-build shadow artifact cleanup projection");
  requireNonEmptyString(record.id, "Device-build shadow artifact cleanup id");
  requireNonEmptyString(record.root, "Device-build shadow artifact cleanup root");
  requireNonEmptyString(record.createdAt, "Device-build shadow artifact cleanup createdAt");
  requireNonNegativeInteger(record.attempts, "Device-build shadow artifact cleanup attempts");
  requireString(record.lastError, "Device-build shadow artifact cleanup lastError");
  requireOptionalString(record, "buildId", "Device-build shadow artifact cleanup buildId");
  requireOptionalString(record, "notBefore", "Device-build shadow artifact cleanup notBefore");
  requireOptionalString(record, "nextAttemptAt", "Device-build shadow artifact cleanup nextAttemptAt");
  requireOptionalString(record, "updatedAt", "Device-build shadow artifact cleanup updatedAt");
  return /** @type {ArtifactCleanupJobRecord} */ (record);
}

/** @param {unknown} value */
function validateDeliveryCleanupJob(value) {
  const record = requireRecord(value, "Device-build shadow delivery cleanup projection");
  requireNonEmptyString(record.id, "Device-build shadow delivery cleanup id");
  requireNonEmptyString(record.generation, "Device-build shadow delivery cleanup generation");
  requireNonEmptyString(record.referenceID, "Device-build shadow delivery cleanup referenceID");
  requireNonEmptyString(record.createdAt, "Device-build shadow delivery cleanup createdAt");
  requireNonNegativeInteger(record.attempts, "Device-build shadow delivery cleanup attempts");
  requireString(record.lastError, "Device-build shadow delivery cleanup lastError");
  requireOptionalString(record, "buildId", "Device-build shadow delivery cleanup buildId");
  requireOptionalString(record, "nextAttemptAt", "Device-build shadow delivery cleanup nextAttemptAt");
  requireOptionalString(record, "updatedAt", "Device-build shadow delivery cleanup updatedAt");
  return /** @type {DeliveryReferenceCleanupJobRecord} */ (record);
}

/** @param {string} actual @param {string} expected @param {string} surface */
function requireProjectionKey(actual, expected, surface) {
  if (actual !== expected) {
    throw new Error(`Device-build shadow ${surface} projection id does not match its key.`);
  }
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
function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {Record<string, unknown>} record @param {string} key @param {string} label */
function requireOptionalString(record, key, label) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return;
  requireString(record[key], label);
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
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
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
function canonicalTimestamp(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a canonical UTC timestamp.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return value;
}

/** @param {unknown} value */
function canonicalJSONString(value) {
  const serialized = JSON.stringify(canonicalize(value));
  if (typeof serialized !== "string") {
    throw new Error("Device-build shadow projection must be JSON serializable.");
  }
  return serialized;
}

/** @param {unknown} value @returns {unknown} */
function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Device-build shadow projection must be finite JSON.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    /** @type {Record<string, unknown>} */
    const normalized = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) {
        throw new Error("Device-build shadow projection must not contain undefined values.");
      }
      normalized[key] = canonicalize(record[key]);
    }
    return normalized;
  }
  throw new Error("Device-build shadow projection must contain only JSON values.");
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

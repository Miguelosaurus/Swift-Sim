// @ts-check

import { createHash } from "node:crypto";
import { deviceBuildProjectionHash } from "./deviceBuildLockedLegacySnapshot.js";
import { normalizeDeviceBuildStateSnapshot } from "./sqliteDeviceBuildStateRepository.js";

/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowComparisonResult} DeviceBuildShadowComparisonResult */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowMismatchRepository} DeviceBuildShadowMismatchRepository */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateSnapshot} DeviceBuildStateSnapshot */
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
    if (!mismatchRepository || typeof mismatchRepository.observe !== "function") {
      throw new Error("Device-build shadow mismatch repository is required.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new Error("Device-build shadow comparison clock is required.");
    }
    this.#mismatchRepository = mismatchRepository;
    this.#clock = clock;
  }

  /**
   * Compare complete transactional snapshots that were already obtained by
   * their respective readers. This comparator never reads legacy JSON and its
   * result must never authorize a request or mutation. Only redacted hashes are
   * persisted when the normalized projections differ.
   *
   * @param {{
   *   key: string,
   *   legacy: DeviceBuildStateSnapshot,
   *   sqlite: DeviceBuildStateSnapshot,
   * }} input
   * @returns {DeviceBuildShadowComparisonResult}
   */
  compare({ key, legacy, sqlite }) {
    const normalizedLegacy = normalizeDeviceBuildStateSnapshot(legacy);
    const normalizedSqlite = normalizeDeviceBuildStateSnapshot(sqlite);
    const keyHash = sha256(requireNonEmptyString(key, "Device-build shadow comparison key"));
    const legacyProjectionHash = deviceBuildProjectionHash(normalizedLegacy);
    const sqliteProjectionHash = deviceBuildProjectionHash(normalizedSqlite);
    if (legacyProjectionHash === sqliteProjectionHash) {
      return {
        matched: true,
        keyHash,
        legacyProjectionHash,
        sqliteProjectionHash,
        evidence: null,
      };
    }

    const mismatchID = deviceBuildShadowMismatchID({
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
    });
    const evidence = this.#mismatchRepository.observe({
      mismatchID,
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
      observedAt: requireTimestamp(
        this.#clock.now().toISOString(),
        "Device-build shadow observedAt",
      ),
    });
    return {
      matched: false,
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
      evidence,
    };
  }
}

/**
 * @param {{
 *   keyHash: string,
 *   legacyProjectionHash: string,
 *   sqliteProjectionHash: string,
 * }} input
 */
export function deviceBuildShadowMismatchID(input) {
  return sha256(
    JSON.stringify({
      keyHash: requireHash(input.keyHash, "Device-build shadow keyHash"),
      legacyProjectionHash: requireHash(
        input.legacyProjectionHash,
        "Device-build shadow legacyProjectionHash",
      ),
      sqliteProjectionHash: requireHash(
        input.sqliteProjectionHash,
        "Device-build shadow sqliteProjectionHash",
      ),
    }),
  );
}

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
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

/** @param {unknown} value @param {string} label */
function requireTimestamp(value, label) {
  const timestamp = requireNonEmptyString(value, label);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return timestamp;
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

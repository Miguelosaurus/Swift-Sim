// @ts-check

import {
  deviceBuildProjectionHash,
  parseDeviceBuildLegacySnapshot,
} from "./deviceBuildLockedLegacySnapshot.js";
import { normalizeDeviceBuildStateSnapshot } from "./sqliteDeviceBuildStateRepository.js";

/**
 * @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateSnapshot} DeviceBuildStateSnapshot
 */

export const DEVICE_BUILD_COMPATIBILITY_AUTHORITY = "legacy";

/**
 * Pre-cutover compatibility reads are legacy-first and legacy-authoritative.
 * SQLite is optional comparison evidence only; it is never a fallback.
 */
export class DeviceBuildCompatibilityReader {
  #legacyReader;
  #sqliteReader;

  /**
   * @param {{
   *   legacyReader: { read(): DeviceBuildStateSnapshot },
   *   sqliteReader?: { read(): DeviceBuildStateSnapshot } | null,
   * }} options
   */
  constructor({ legacyReader, sqliteReader = null }) {
    this.#legacyReader = requireReader(legacyReader, "Device-build legacy compatibility");
    this.#sqliteReader =
      sqliteReader === null
        ? null
        : requireReader(sqliteReader, "Device-build SQLite compatibility");
  }

  /** @returns {Readonly<DeviceBuildStateSnapshot>} */
  read() {
    return immutableSnapshot(this.#legacyReader.read());
  }

  inspect() {
    const legacy = this.read();
    const legacyProjectionHash = deviceBuildProjectionHash(legacy);
    if (this.#sqliteReader === null) {
      return deepFreeze({
        authority: DEVICE_BUILD_COMPATIBILITY_AUTHORITY,
        matched: null,
        legacyProjectionHash,
        sqliteProjectionHash: null,
        snapshot: legacy,
      });
    }
    const sqlite = immutableSnapshot(this.#sqliteReader.read());
    const sqliteProjectionHash = deviceBuildProjectionHash(sqlite);
    return deepFreeze({
      authority: DEVICE_BUILD_COMPATIBILITY_AUTHORITY,
      matched: legacyProjectionHash === sqliteProjectionHash,
      legacyProjectionHash,
      sqliteProjectionHash,
      snapshot: legacy,
    });
  }
}

/** @param {unknown} authority @returns {"legacy"} */
export function assertDeviceBuildCompatibilityAuthority(authority) {
  if (authority !== DEVICE_BUILD_COMPATIBILITY_AUTHORITY) {
    throw new Error(
      "Device-build cutover foundation is compatibility-only; SQLite is not authoritative.",
    );
  }
  return DEVICE_BUILD_COMPATIBILITY_AUTHORITY;
}

/**
 * Read-only rollback proof over preserved legacy bytes. It deliberately uses
 * the existing legacy parser and performs no source rewrite or authority change.
 *
 * @param {{
 *   raw: string | null,
 *   sourcePath?: string,
 *   expectedProjectionHash?: string,
 *   expectedSourceVersion?: number,
 * }} input
 */
export function verifyDeviceBuildLegacyRollbackReadability(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Device-build rollback readability input must be an object.");
  }
  const sourcePath =
    input.sourcePath === undefined
      ? "device-builds.json"
      : requireNonEmptyString(input.sourcePath, "Device-build rollback sourcePath");
  if (input.raw !== null && typeof input.raw !== "string") {
    throw new Error("Device-build rollback raw source must be a string or null.");
  }
  const parsed = parseDeviceBuildLegacySnapshot(input.raw, sourcePath);
  const snapshot = immutableSnapshot(parsed.snapshot);
  const projectionHash = deviceBuildProjectionHash(snapshot);
  if (
    input.expectedProjectionHash !== undefined &&
    projectionHash !==
      requireHash(input.expectedProjectionHash, "Device-build rollback projectionHash")
  ) {
    throw new Error("Device-build rollback legacy projection no longer matches expected evidence.");
  }
  if (
    input.expectedSourceVersion !== undefined &&
    parsed.sourceVersion !==
      requireSafeInteger(input.expectedSourceVersion, "Device-build rollback sourceVersion")
  ) {
    throw new Error(
      "Device-build rollback legacy sourceVersion no longer matches expected evidence.",
    );
  }
  return deepFreeze({
    authority: DEVICE_BUILD_COMPATIBILITY_AUTHORITY,
    sourceVersion: parsed.sourceVersion,
    projectionHash,
    recordCount:
      snapshot.builds.length +
      snapshot.apps.length +
      snapshot.artifactCleanupJobs.length +
      snapshot.deliveryReferenceCleanupJobs.length,
    snapshot,
  });
}

/** @param {unknown} value @param {string} label */
function requireReader(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} reader is required.`);
  }
  if (typeof /** @type {Record<string, unknown>} */ (value).read !== "function") {
    throw new Error(`${label} reader must implement read().`);
  }
  return /** @type {{ read(): DeviceBuildStateSnapshot }} */ (value);
}

/** @param {DeviceBuildStateSnapshot} snapshot */
function immutableSnapshot(snapshot) {
  return /** @type {Readonly<DeviceBuildStateSnapshot>} */ (
    deepFreeze(structuredClone(normalizeDeviceBuildStateSnapshot(snapshot)))
  );
}

/** @param {unknown} value @param {string} label */
function requireSafeInteger(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
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

/** @param {unknown} value */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(/** @type {Record<string, unknown>} */ (value))) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

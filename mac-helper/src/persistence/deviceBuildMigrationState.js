// @ts-check

import { deviceBuildProjectionHash } from "./deviceBuildLockedLegacySnapshot.js";
import { normalizeDeviceBuildStateSnapshot } from "./sqliteDeviceBuildStateRepository.js";

/**
 * @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateSnapshot} DeviceBuildStateSnapshot
 */

export const DEVICE_BUILD_MIGRATION_STATE_VERSION = 1;
export const DEVICE_BUILD_MIGRATION_AUTHORITY = "legacy";

/**
 * @typedef {{
 *   version: 1,
 *   authority: "legacy",
 *   sourceRevision: string,
 *   projectionHash: string,
 *   sourceVersion: number,
 *   recordCount: number,
 *   cursor: number,
 * }} DeviceBuildMigrationState
 * @typedef {{
 *   snapshot: DeviceBuildStateSnapshot,
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   sourceVersion: number,
 * }} DeviceBuildLockedSnapshotEvidence
 */

/**
 * Seed inert migration evidence from the same locked legacy snapshot used by
 * the existing import path. This state can never select SQLite authority.
 *
 * @param {DeviceBuildLockedSnapshotEvidence} lockedSnapshot
 * @returns {Readonly<DeviceBuildMigrationState>}
 */
export function createDeviceBuildMigrationState(lockedSnapshot) {
  const locked = normalizeLockedSnapshotEvidence(lockedSnapshot);
  return freezeState({
    version: DEVICE_BUILD_MIGRATION_STATE_VERSION,
    authority: DEVICE_BUILD_MIGRATION_AUTHORITY,
    sourceRevision: locked.sourceRevision,
    projectionHash: locked.projectionHash,
    sourceVersion: locked.sourceVersion,
    recordCount: locked.recordCount,
    cursor: 0,
  });
}

/** @param {unknown} value @returns {Readonly<DeviceBuildMigrationState>} */
export function parseDeviceBuildMigrationState(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      throw new Error("Device-build migration state is not valid JSON.", { cause: error });
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Device-build migration state must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (parsed);
  if (values.version !== DEVICE_BUILD_MIGRATION_STATE_VERSION) {
    throw new Error(
      `Unsupported device-build migration state version: ${String(values.version)}.`,
    );
  }
  if (values.authority !== DEVICE_BUILD_MIGRATION_AUTHORITY) {
    throw new Error("Device-build migration state cannot select non-legacy authority.");
  }
  const state = {
    version: DEVICE_BUILD_MIGRATION_STATE_VERSION,
    authority: DEVICE_BUILD_MIGRATION_AUTHORITY,
    sourceRevision: requireHash(values.sourceRevision, "Device-build migration sourceRevision"),
    projectionHash: requireHash(values.projectionHash, "Device-build migration projectionHash"),
    sourceVersion: requireSafeInteger(
      values.sourceVersion,
      "Device-build migration sourceVersion",
    ),
    recordCount: requireSafeInteger(values.recordCount, "Device-build migration recordCount"),
    cursor: requireSafeInteger(values.cursor, "Device-build migration cursor"),
  };
  if (state.cursor > state.recordCount) {
    throw new Error("Device-build migration cursor cannot exceed recordCount.");
  }
  return freezeState(state);
}

/** @param {unknown} state */
export function serializeDeviceBuildMigrationState(state) {
  return `${JSON.stringify(parseDeviceBuildMigrationState(state))}\n`;
}

/** @param {DeviceBuildLockedSnapshotEvidence} value */
function normalizeLockedSnapshotEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Device-build locked snapshot evidence must be an object.");
  }
  const snapshot = normalizeDeviceBuildStateSnapshot(value.snapshot);
  const projectionHash = requireHash(
    value.projectionHash,
    "Device-build locked snapshot projectionHash",
  );
  if (deviceBuildProjectionHash(snapshot) !== projectionHash) {
    throw new Error("Device-build locked snapshot projectionHash does not match its snapshot.");
  }
  const recordCount = requireSafeInteger(
    value.recordCount,
    "Device-build locked snapshot recordCount",
  );
  const expectedCount =
    snapshot.builds.length +
    snapshot.apps.length +
    snapshot.artifactCleanupJobs.length +
    snapshot.deliveryReferenceCleanupJobs.length;
  if (recordCount !== expectedCount) {
    throw new Error("Device-build locked snapshot recordCount does not match its snapshot.");
  }
  return {
    sourceRevision: requireHash(
      value.sourceRevision,
      "Device-build locked snapshot sourceRevision",
    ),
    projectionHash,
    sourceVersion: requireSafeInteger(
      value.sourceVersion,
      "Device-build locked snapshot sourceVersion",
    ),
    recordCount,
  };
}

/** @param {DeviceBuildMigrationState} state */
function freezeState(state) {
  return /** @type {Readonly<DeviceBuildMigrationState>} */ (Object.freeze({ ...state }));
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

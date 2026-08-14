// @ts-check

import { createHash } from "node:crypto";
import { deviceBuildProjectionHash } from "./deviceBuildLockedLegacySnapshot.js";
import {
  DEVICE_BUILD_MIGRATION_STATE_VERSION,
  parseDeviceBuildMigrationState,
} from "./deviceBuildMigrationState.js";
import { normalizeDeviceBuildStateSnapshot } from "./sqliteDeviceBuildStateRepository.js";

/**
 * @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateSnapshot} DeviceBuildStateSnapshot
 * @typedef {import("./deviceBuildMigrationState.js").DeviceBuildMigrationState} DeviceBuildMigrationState
 */

export const DEFAULT_DEVICE_BUILD_EXPORT_MAX_RECORDS = 64;
export const DEFAULT_DEVICE_BUILD_EXPORT_MAX_BYTES = 256 * 1024;

const EXPORT_SURFACES = Object.freeze([
  "build",
  "app",
  "artifact-cleanup-job",
  "delivery-cleanup-job",
]);

/**
 * @typedef {{
 *   index: number,
 *   surface: "build" | "app" | "artifact-cleanup-job" | "delivery-cleanup-job",
 *   key: string,
 *   payload: Readonly<Record<string, unknown>>,
 *   payloadHash: string,
 *   idempotencyKey: string,
 *   byteLength: number,
 * }} DeviceBuildExportRecord
 * @typedef {{
 *   version: 1,
 *   sourceRevision: string,
 *   projectionHash: string,
 *   startIndex: number,
 *   endIndex: number,
 *   complete: boolean,
 *   byteLength: number,
 *   records: readonly DeviceBuildExportRecord[],
 * }} DeviceBuildExportBatch
 */

/**
 * Export only normalized domain records. Artifact payload bytes and all other
 * filesystem runtime state remain filesystem-owned and are never copied here.
 *
 * @param {DeviceBuildStateSnapshot} snapshot
 * @param {unknown} state
 * @param {{ maxRecords?: number, maxBytes?: number }} [options]
 * @returns {Readonly<DeviceBuildExportBatch>}
 */
export function createDeviceBuildExportBatch(snapshot, state, options = {}) {
  const migration = parseDeviceBuildMigrationState(state);
  const normalized = normalizeDeviceBuildStateSnapshot(snapshot);
  if (deviceBuildProjectionHash(normalized) !== migration.projectionHash) {
    throw new Error("Device-build export snapshot does not match migration projectionHash.");
  }
  const records = exportRecords(normalized);
  if (records.length !== migration.recordCount) {
    throw new Error("Device-build export snapshot does not match migration recordCount.");
  }

  const maxRecords = requirePositiveSafeInteger(
    options.maxRecords ?? DEFAULT_DEVICE_BUILD_EXPORT_MAX_RECORDS,
    "Device-build export maxRecords",
  );
  const maxBytes = requirePositiveSafeInteger(
    options.maxBytes ?? DEFAULT_DEVICE_BUILD_EXPORT_MAX_BYTES,
    "Device-build export maxBytes",
  );
  /** @type {DeviceBuildExportRecord[]} */
  const selected = [];
  let byteLength = 0;
  for (
    let index = migration.cursor;
    index < records.length && selected.length < maxRecords;
    index++
  ) {
    const record = records[index];
    if (!record) throw new Error("Device-build export record ordering is inconsistent.");
    if (record.byteLength > maxBytes) {
      throw new Error(
        `Device-build export record ${record.surface}:${record.key} exceeds maxBytes.`,
      );
    }
    if (selected.length > 0 && byteLength + record.byteLength > maxBytes) break;
    selected.push(record);
    byteLength += record.byteLength;
  }

  const endIndex = migration.cursor + selected.length;
  return deepFreeze({
    version: DEVICE_BUILD_MIGRATION_STATE_VERSION,
    sourceRevision: migration.sourceRevision,
    projectionHash: migration.projectionHash,
    startIndex: migration.cursor,
    endIndex,
    complete: endIndex === migration.recordCount,
    byteLength,
    records: selected,
  });
}

/**
 * Advance only after the caller durably acknowledges the whole batch. If a
 * target applied only part before interruption, unchanged state regenerates the
 * same batch and idempotency keys; repeated completed acknowledgements are no-ops.
 *
 * @param {unknown} state
 * @param {unknown} batch
 * @returns {Readonly<DeviceBuildMigrationState>}
 */
export function acknowledgeDeviceBuildExportBatch(state, batch) {
  const migration = parseDeviceBuildMigrationState(state);
  const normalized = normalizeExportBatch(batch);
  requireMatchingEpoch(migration, normalized);
  if (normalized.endIndex > migration.recordCount) {
    throw new Error("Device-build export acknowledgement exceeds migration recordCount.");
  }
  if (normalized.complete !== (normalized.endIndex === migration.recordCount)) {
    throw new Error("Device-build export batch completion marker is inconsistent with its cursor.");
  }
  if (normalized.endIndex <= migration.cursor) return migration;
  if (normalized.startIndex !== migration.cursor) {
    throw new Error(
      "Device-build export acknowledgement must be contiguous with migration cursor.",
    );
  }
  return Object.freeze({ ...migration, cursor: normalized.endIndex });
}

/** @param {DeviceBuildStateSnapshot} snapshot @returns {DeviceBuildExportRecord[]} */
function exportRecords(snapshot) {
  /** @type {DeviceBuildExportRecord[]} */
  const records = [];
  /**
   * @param {DeviceBuildExportRecord["surface"]} surface
   * @param {readonly unknown[]} values
   */
  const append = (surface, values) => {
    for (const value of values) {
      const payload = immutableRecord(value, `Device-build ${surface} export payload`);
      const key = requireNonEmptyString(payload.id, `Device-build ${surface} export key`);
      const payloadJSON = JSON.stringify(payload);
      const payloadHash = sha256(payloadJSON);
      records.push(
        deepFreeze({
          index: records.length,
          surface,
          key,
          payload,
          payloadHash,
          idempotencyKey: sha256(`${surface}\u0000${key}\u0000${payloadHash}`),
          byteLength: Buffer.byteLength(payloadJSON, "utf8"),
        }),
      );
    }
  };
  append("build", snapshot.builds);
  append("app", snapshot.apps);
  append("artifact-cleanup-job", snapshot.artifactCleanupJobs);
  append("delivery-cleanup-job", snapshot.deliveryReferenceCleanupJobs);
  return records;
}

/** @param {unknown} value @returns {DeviceBuildExportBatch} */
function normalizeExportBatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Device-build export batch must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  if (values.version !== DEVICE_BUILD_MIGRATION_STATE_VERSION) {
    throw new Error("Device-build export batch has an unsupported version.");
  }
  const startIndex = requireSafeInteger(values.startIndex, "Device-build export batch startIndex");
  const endIndex = requireSafeInteger(values.endIndex, "Device-build export batch endIndex");
  if (endIndex < startIndex) {
    throw new Error("Device-build export batch endIndex cannot precede startIndex.");
  }
  if (!Array.isArray(values.records) || values.records.length !== endIndex - startIndex) {
    throw new Error("Device-build export batch record count does not match its range.");
  }
  const records = values.records.map((record, offset) =>
    normalizeExportRecord(record, startIndex + offset),
  );
  const byteLength = requireSafeInteger(values.byteLength, "Device-build export batch byteLength");
  if (records.reduce((sum, record) => sum + record.byteLength, 0) !== byteLength) {
    throw new Error("Device-build export batch byteLength does not match its records.");
  }
  if (values.complete !== true && values.complete !== false) {
    throw new Error("Device-build export batch complete must be boolean.");
  }
  return deepFreeze({
    version: DEVICE_BUILD_MIGRATION_STATE_VERSION,
    sourceRevision: requireHash(values.sourceRevision, "Device-build export sourceRevision"),
    projectionHash: requireHash(values.projectionHash, "Device-build export projectionHash"),
    startIndex,
    endIndex,
    complete: values.complete,
    byteLength,
    records,
  });
}

/** @param {unknown} value @param {number} expectedIndex @returns {DeviceBuildExportRecord} */
function normalizeExportRecord(value, expectedIndex) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Device-build export record must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  if (values.index !== expectedIndex) {
    throw new Error("Device-build export record index is not contiguous.");
  }
  if (!EXPORT_SURFACES.includes(/** @type {never} */ (values.surface))) {
    throw new Error("Device-build export record has an unsupported surface.");
  }
  const surface = /** @type {DeviceBuildExportRecord["surface"]} */ (values.surface);
  const key = requireNonEmptyString(values.key, "Device-build export record key");
  const payload = immutableRecord(values.payload, "Device-build export record payload");
  if (payload.id !== key) {
    throw new Error("Device-build export record key does not match payload id.");
  }
  const payloadJSON = JSON.stringify(payload);
  const payloadHash = requireHash(values.payloadHash, "Device-build export payloadHash");
  if (sha256(payloadJSON) !== payloadHash) {
    throw new Error("Device-build export payloadHash does not match payload.");
  }
  const idempotencyKey = requireHash(values.idempotencyKey, "Device-build export idempotencyKey");
  if (sha256(`${surface}\u0000${key}\u0000${payloadHash}`) !== idempotencyKey) {
    throw new Error("Device-build export idempotencyKey does not match record evidence.");
  }
  const byteLength = requireSafeInteger(values.byteLength, "Device-build export record byteLength");
  if (Buffer.byteLength(payloadJSON, "utf8") !== byteLength) {
    throw new Error("Device-build export record byteLength does not match payload.");
  }
  return deepFreeze({
    index: expectedIndex,
    surface,
    key,
    payload,
    payloadHash,
    idempotencyKey,
    byteLength,
  });
}

/** @param {Readonly<DeviceBuildMigrationState>} state @param {DeviceBuildExportBatch} batch */
function requireMatchingEpoch(state, batch) {
  if (
    batch.sourceRevision !== state.sourceRevision ||
    batch.projectionHash !== state.projectionHash
  ) {
    throw new Error("Device-build export batch does not match migration epoch evidence.");
  }
}

/** @param {unknown} value @param {string} label */
function immutableRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return /** @type {Readonly<Record<string, unknown>>} */ (deepFreeze(structuredClone(value)));
}

/** @param {unknown} value @param {string} label */
function requirePositiveSafeInteger(value, label) {
  const integer = requireSafeInteger(value, label);
  if (integer === 0) throw new Error(`${label} must be greater than zero.`);
  return integer;
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

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (value));
  for (const nested of Object.values(record)) {
    deepFreeze(nested);
  }
  Object.freeze(/** @type {object} */ (/** @type {unknown} */ (value)));
  return value;
}

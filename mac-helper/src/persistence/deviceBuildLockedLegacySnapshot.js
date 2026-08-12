// @ts-check

import { createHash } from "node:crypto";
import { join } from "node:path";
import { BUILD_STATE_VERSION, normalizeDeviceBuildRecord } from "../deviceBuildStoreCore.js";
import { normalizeDeviceBuildStateSnapshot } from "./sqliteDeviceBuildStateRepository.js";

/** @typedef {import("../contracts/deviceBuildRepository.js").ArtifactCleanupJobRecord} ArtifactCleanupJobRecord */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeliveryReferenceCleanupJobRecord} DeliveryReferenceCleanupJobRecord */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateSnapshot} DeviceBuildStateSnapshot */
/** @typedef {import("../infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("../infrastructure/ports.js").LockManager} LockManager */
/** @typedef {import("../infrastructure/ports.js").LockRequest} LockRequest */

/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   lockRequest: LockRequest,
 * }} DeviceBuildLegacySource
 * @typedef {{
 *   source: DeviceBuildLegacySource,
 *   raw: string | null,
 *   digest: string | null,
 *   backupPath: string | null,
 * }} LoadedDeviceBuildLegacySource
 * @typedef {{
 *   snapshot: DeviceBuildStateSnapshot,
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 *   sourceVersion: number,
 * }} LockedDeviceBuildLegacySnapshot
 */

const BACKUP_WRITE_OPTIONS = Object.freeze({
  mode: 0o600,
  createParentMode: 0o700,
  replace: false,
  syncDirectory: true,
});

export class DeviceBuildLockedLegacySnapshotReader {
  /** @type {AtomicFileStore} */
  #fileStore;
  /** @type {LockManager} */
  #lockManager;
  /** @type {DeviceBuildLegacySource} */
  #source;
  /** @type {string} */
  #backupDirectory;

  /**
   * @param {{
   *   fileStore: AtomicFileStore,
   *   lockManager: LockManager,
   *   source: DeviceBuildLegacySource,
   *   backupDirectory: string,
   * }} options
   */
  constructor({ fileStore, lockManager, source, backupDirectory }) {
    if (
      !fileStore ||
      typeof fileStore.readTextSync !== "function" ||
      typeof fileStore.writeTextSync !== "function"
    ) {
      throw new Error("Device-build legacy atomic file store is required.");
    }
    if (!lockManager || typeof lockManager.withLockSync !== "function") {
      throw new Error("Device-build legacy lock manager is required.");
    }
    this.#fileStore = fileStore;
    this.#lockManager = lockManager;
    this.#source = validateDeviceBuildLegacySource(source);
    this.#backupDirectory = requireNonEmptyString(
      backupDirectory,
      "Device-build legacy backup directory",
    );
  }

  /**
   * Read one immutable migration snapshot while the caller owns the exact
   * legacy build-state lock. The live DeviceBuildStore is intentionally never
   * constructed here: migration reads may not compact state, expire tokens,
   * recover renewals, drain cleanup jobs, or start maintenance timers.
   *
   * @template T
   * @param {(lockedSnapshot: LockedDeviceBuildLegacySnapshot) => T} operation
   * @returns {T}
   */
  withLockedSnapshot(operation) {
    if (typeof operation !== "function") {
      throw new Error("Device-build locked snapshot operation must be a function.");
    }
    if (operation.constructor?.name === "AsyncFunction") {
      throw new Error("Device-build locked snapshot operation must complete synchronously.");
    }

    return this.#lockManager.withLockSync(this.#source.lockRequest, () => {
      const loaded = this.#loadSource();
      this.#publishBackup(loaded);
      const parsed = parseDeviceBuildLegacySnapshot(loaded.raw, this.#source.path);
      const snapshot = immutableDeviceBuildSnapshot(parsed.snapshot);
      const locked = Object.freeze({
        snapshot,
        sourceRevision: sourceRevisionFor(loaded, parsed.sourceVersion),
        projectionHash: deviceBuildProjectionHash(snapshot),
        recordCount:
          snapshot.builds.length +
          snapshot.apps.length +
          snapshot.artifactCleanupJobs.length +
          snapshot.deliveryReferenceCleanupJobs.length,
        backups: Object.freeze(loaded.backupPath === null ? [] : [loaded.backupPath]),
        sourceVersion: parsed.sourceVersion,
      });
      const result = operation(locked);
      if (isThenable(result)) {
        throw new Error("Device-build locked snapshot operation must complete synchronously.");
      }
      return result;
    });
  }

  /** @returns {LoadedDeviceBuildLegacySource} */
  #loadSource() {
    try {
      const raw = this.#fileStore.readTextSync(this.#source.path);
      return {
        source: this.#source,
        raw,
        digest: sha256(raw),
        backupPath: null,
      };
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
      return {
        source: this.#source,
        raw: null,
        digest: null,
        backupPath: null,
      };
    }
  }

  /** @param {LoadedDeviceBuildLegacySource} loaded */
  #publishBackup(loaded) {
    if (loaded.raw === null || loaded.digest === null) return;
    const safeName = sanitizeSourceName(loaded.source.name);
    const backupPath = join(this.#backupDirectory, `device-build-${safeName}.${loaded.digest}.bak`);
    try {
      this.#fileStore.writeTextSync(backupPath, loaded.raw, BACKUP_WRITE_OPTIONS);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
    }
    const persisted = this.#fileStore.readTextSync(backupPath);
    if (persisted !== loaded.raw) {
      throw new Error(`Device-build legacy backup content mismatch: ${backupPath}.`);
    }
    loaded.backupPath = backupPath;
  }
}

/** @param {DeviceBuildStateSnapshot} snapshot */
export function deviceBuildProjectionHash(snapshot) {
  return sha256(JSON.stringify(normalizeDeviceBuildStateSnapshot(snapshot)));
}

/**
 * @param {string | null} raw
 * @param {string} sourcePath
 * @returns {{ snapshot: DeviceBuildStateSnapshot, sourceVersion: number }}
 */
export function parseDeviceBuildLegacySnapshot(raw, sourcePath = "device-builds.json") {
  if (raw === null) {
    return {
      snapshot: normalizeDeviceBuildStateSnapshot(emptySnapshot()),
      sourceVersion: 0,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in device-build legacy source ${sourcePath}.`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Device-build legacy source must contain an object: ${sourcePath}.`);
  }
  const values = /** @type {Record<string, unknown>} */ (parsed);
  const sourceVersion = normalizeSourceVersion(values.version, sourcePath);
  if (sourceVersion > BUILD_STATE_VERSION) {
    throw new Error(
      `Device-build legacy source version ${sourceVersion} is newer than supported version ${BUILD_STATE_VERSION}: ${sourcePath}.`,
    );
  }

  const builds = normalizeBuildArray(values.builds, sourcePath);
  const apps = normalizeAppMap(values.apps, sourcePath);
  const artifactCleanupJobs = /** @type {ArtifactCleanupJobRecord[]} */ (
    normalizeRecordMap(values.artifactCleanupJobs, sourcePath, "artifact cleanup job")
  );
  const deliveryReferenceCleanupJobs = /** @type {DeliveryReferenceCleanupJobRecord[]} */ (
    normalizeRecordMap(
      values.deliveryReferenceCleanupJobs,
      sourcePath,
      "delivery-reference cleanup job",
    )
  );

  return {
    snapshot: normalizeDeviceBuildStateSnapshot({
      builds,
      apps,
      artifactCleanupJobs,
      deliveryReferenceCleanupJobs,
    }),
    sourceVersion,
  };
}

/** @returns {DeviceBuildStateSnapshot} */
function emptySnapshot() {
  return {
    builds: [],
    apps: [],
    artifactCleanupJobs: [],
    deliveryReferenceCleanupJobs: [],
  };
}

/** @param {unknown} value @param {string} sourcePath */
function normalizeBuildArray(value, sourcePath) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Device-build legacy builds must be an array: ${sourcePath}.`);
  }
  return value.map((build, index) => {
    const record = cloneRecord(build, `Device-build legacy build ${index}`);
    return normalizeDeviceBuildRecord(upgradeLegacyDeviceBuildRecord(record));
  });
}

/**
 * Historical v6 files may predate fields that are now required by the
 * strict persistence contract. Upgrade only omissions with known legacy
 * defaults; present-but-malformed values still flow to strict validation.
 *
 * @param {Record<string, unknown>} build
 */
function upgradeLegacyDeviceBuildRecord(build) {
  if (!Object.prototype.hasOwnProperty.call(build, "delivery")) {
    build.delivery = {
      mode: "quick-tunnel",
      provider: "cloudflare-quick-tunnel",
      expiresAt: "",
    };
  }

  const signingValue = build.signing;
  const signing =
    signingValue && typeof signingValue === "object" && !Array.isArray(signingValue)
      ? /** @type {Record<string, unknown>} */ (signingValue)
      : null;
  if (signing && !Object.prototype.hasOwnProperty.call(signing, "deviceInstallable")) {
    signing.deviceInstallable = false;
  }
  return build;
}

/** @param {unknown} value @param {string} sourcePath */
function normalizeAppMap(value, sourcePath) {
  const entries = mapEntries(value, sourcePath, "apps");
  return entries.map(([id, raw]) => {
    const record = cloneRecord(raw, `Device-build legacy app ${id}`);
    if (Object.prototype.hasOwnProperty.call(record, "id") && record.id !== id) {
      throw new Error(`Device-build legacy app id does not match map key: ${id}.`);
    }
    const archivedAt =
      record.archivedAt === undefined || record.archivedAt === null
        ? ""
        : requireString(record.archivedAt, `Device-build legacy app ${id} archivedAt`);
    return { ...record, id, archivedAt };
  });
}

/**
 * @param {unknown} value
 * @param {string} sourcePath
 * @param {string} label
 */
function normalizeRecordMap(value, sourcePath, label) {
  const entries = mapEntries(value, sourcePath, `${label}s`);
  return entries.map(([id, raw]) => {
    const record = cloneRecord(raw, `Device-build legacy ${label} ${id}`);
    if (!Object.prototype.hasOwnProperty.call(record, "id")) {
      throw new Error(`Device-build legacy ${label} is missing its id: ${id}.`);
    }
    if (record.id !== id) {
      throw new Error(`Device-build legacy ${label} id does not match map key: ${id}.`);
    }
    return record;
  });
}

/** @param {unknown} value @param {string} sourcePath @param {string} label */
function mapEntries(value, sourcePath, label) {
  if (value === undefined || value === null) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Device-build legacy ${label} must be an object map: ${sourcePath}.`);
  }
  return Object.entries(/** @type {Record<string, unknown>} */ (value));
}

/** @param {unknown} value @param {string} label */
function cloneRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return /** @type {Record<string, unknown>} */ (structuredClone(value));
}

/** @param {DeviceBuildStateSnapshot} snapshot */
function immutableDeviceBuildSnapshot(snapshot) {
  return /** @type {DeviceBuildStateSnapshot} */ (
    deepFreeze(structuredClone(normalizeDeviceBuildStateSnapshot(snapshot)))
  );
}

/** @param {unknown} value */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(/** @type {Record<string, unknown>} */ (value))) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

/** @param {LoadedDeviceBuildLegacySource} loaded @param {number} sourceVersion */
function sourceRevisionFor(loaded, sourceVersion) {
  return sha256(
    JSON.stringify({
      version: 1,
      source: {
        name: loaded.source.name,
        present: loaded.raw !== null,
        digest: loaded.digest,
        stateVersion: sourceVersion,
      },
    }),
  );
}

/** @param {unknown} value @param {string} sourcePath */
function normalizeSourceVersion(value, sourcePath) {
  if (value === undefined || value === null || value === "") return 0;
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error(`Device-build legacy source has an invalid version: ${sourcePath}.`);
  }
  return version;
}

/** @param {DeviceBuildLegacySource} source */
export function validateDeviceBuildLegacySource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Device-build legacy source is required.");
  }
  return {
    name: requireNonEmptyString(source.name, "Device-build legacy source name"),
    path: requireNonEmptyString(source.path, "Device-build legacy source path"),
    lockRequest: validateLockRequest(source.lockRequest),
  };
}

/** @param {LockRequest} request */
function validateLockRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Device-build legacy lock request is required.");
  }
  return {
    path: requireNonEmptyString(request.path, "Device-build legacy lock path"),
    waitMs: request.waitMs,
    staleAfterMs: request.staleAfterMs,
    ownerMode: request.ownerMode,
  };
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

/** @param {string} value */
function sanitizeSourceName(value) {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) {
    throw new Error("Device-build legacy source name has no safe backup characters.");
  }
  return sanitized;
}

/** @param {unknown} value */
function isThenable(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (/** @type {{ then?: unknown }} */ (value).then) === "function"
  );
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    /** @type {{ code?: unknown }} */ (error).code === code
  );
}

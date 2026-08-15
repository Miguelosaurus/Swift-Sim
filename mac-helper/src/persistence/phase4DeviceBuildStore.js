// @ts-check

import { DeviceBuildStore } from "../deviceBuildStore.js";
import { normalizeDeviceBuildTTLMinutes } from "../deviceBuildDefaults.js";
import { normalizeDeviceBuildStateSnapshot } from "./sqliteDeviceBuildStateRepository.js";

const CLEANUP_RETRY_INTERVAL_MS = 30_000;

/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateSnapshot} DeviceBuildStateSnapshot */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

/**
 * SQLite transaction seam for the existing DeviceBuildStore business logic.
 * The domain record format and cleanup policy remain unchanged; only the
 * authoritative durable backing store changes after the global Phase-4 epoch.
 */
export class SqliteDeviceBuildMutationRepository {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  #readBuilds;
  #readApps;
  #readArtifactJobs;
  #readDeliveryJobs;
  #deleteDeliveryJobs;
  #deleteArtifactJobs;
  #deleteApps;
  #deleteBuilds;
  #insertBuild;
  #insertApp;
  #insertArtifactJob;
  #insertDeliveryJob;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#database = database;
    this.#readBuilds = database.prepare(
      "SELECT record_json FROM device_builds ORDER BY created_at DESC, id",
    );
    this.#readApps = database.prepare("SELECT record_json FROM device_app_state ORDER BY id");
    this.#readArtifactJobs = database.prepare(
      "SELECT record_json FROM artifact_cleanup_jobs ORDER BY created_at, id",
    );
    this.#readDeliveryJobs = database.prepare(
      "SELECT record_json FROM delivery_reference_cleanup_jobs ORDER BY created_at, id",
    );
    this.#deleteDeliveryJobs = database.prepare("DELETE FROM delivery_reference_cleanup_jobs");
    this.#deleteArtifactJobs = database.prepare("DELETE FROM artifact_cleanup_jobs");
    this.#deleteApps = database.prepare("DELETE FROM device_app_state");
    this.#deleteBuilds = database.prepare("DELETE FROM device_builds");
    this.#insertBuild = database.prepare(`INSERT INTO device_builds(
      id, revision, app_identity, state, created_at, updated_at, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    this.#insertApp = database.prepare(
      "INSERT INTO device_app_state(id, archived_at, record_json) VALUES (?, ?, ?)",
    );
    this.#insertArtifactJob = database.prepare(`INSERT INTO artifact_cleanup_jobs(
      id, build_id, root, created_at, next_attempt_at, attempts, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    this.#insertDeliveryJob = database.prepare(`INSERT INTO delivery_reference_cleanup_jobs(
      id, build_id, generation, reference_id, created_at, next_attempt_at, attempts, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  }

  /** @returns {DeviceBuildStateSnapshot} */
  read() {
    return normalizeDeviceBuildStateSnapshot(this.#readUnlocked());
  }

  /**
   * Preserve the production store's read-side stale-renewal recovery without
   * turning the legacy JSON file back into a second durable writer.
   * @template T
   * @param {(state: ReturnType<typeof snapshotToMutableState>) => T} operation
   * @returns {T}
   */
  readWithRecovery(operation) {
    if (typeof operation !== "function" || operation.constructor?.name === "AsyncFunction") {
      throw new TypeError("Device-build SQLite read must be synchronous.");
    }
    return this.#database.transaction(() => {
      const state = snapshotToMutableState(normalizeDeviceBuildStateSnapshot(this.#readUnlocked()));
      const changed = recoverStaleRenewals(state.builds);
      const result = operation(state);
      if (changed) this.#replaceUnlocked(mutableStateToSnapshot(state));
      return structuredClone(result);
    });
  }

  runMaintenance() {
    return this.#database.transaction(() => {
      const state = snapshotToMutableState(normalizeDeviceBuildStateSnapshot(this.#readUnlocked()));
      const changed = recoverStaleRenewals(state.builds);
      if (changed) this.#replaceUnlocked(mutableStateToSnapshot(state));
      return changed;
    });
  }

  /**
   * @template T
   * @param {(state: ReturnType<typeof snapshotToMutableState>) => T} operation
   * @returns {T}
   */
  mutate(operation) {
    if (typeof operation !== "function" || operation.constructor?.name === "AsyncFunction") {
      throw new TypeError("Device-build SQLite mutation must be synchronous.");
    }
    return this.#database.transaction(() => {
      const state = snapshotToMutableState(normalizeDeviceBuildStateSnapshot(this.#readUnlocked()));
      recoverStaleRenewals(state.builds);
      const result = operation(state);
      if (result && typeof /** @type {any} */ (result).then === "function") {
        throw new Error("Device-build SQLite mutation must complete synchronously.");
      }
      const snapshot = mutableStateToSnapshot(state);
      this.#replaceUnlocked(snapshot);
      return structuredClone(result);
    });
  }

  #readUnlocked() {
    return {
      builds: this.#readBuilds.all().map(parseJSONRow),
      apps: this.#readApps.all().map(parseJSONRow),
      artifactCleanupJobs: this.#readArtifactJobs.all().map(parseJSONRow),
      deliveryReferenceCleanupJobs: this.#readDeliveryJobs.all().map(parseJSONRow),
    };
  }

  /** @param {DeviceBuildStateSnapshot} snapshot */
  #replaceUnlocked(snapshot) {
    const normalized = normalizeDeviceBuildStateSnapshot(snapshot);
    this.#deleteDeliveryJobs.run();
    this.#deleteArtifactJobs.run();
    this.#deleteApps.run();
    this.#deleteBuilds.run();
    for (const build of normalized.builds) {
      this.#insertBuild.run(
        build.id,
        build.revision,
        build.app?.identity || "",
        build.state,
        build.createdAt,
        build.updatedAt,
        JSON.stringify(build),
      );
    }
    for (const app of normalized.apps) {
      this.#insertApp.run(app.id, app.archivedAt || "", JSON.stringify(app));
    }
    for (const job of normalized.artifactCleanupJobs) {
      this.#insertArtifactJob.run(
        job.id,
        job.buildId || "",
        job.root,
        job.createdAt,
        job.nextAttemptAt || "",
        job.attempts,
        JSON.stringify(job),
      );
    }
    for (const job of normalized.deliveryReferenceCleanupJobs) {
      this.#insertDeliveryJob.run(
        job.id,
        job.buildId || "",
        job.generation,
        job.referenceID,
        job.createdAt,
        job.nextAttemptAt || "",
        job.attempts,
        JSON.stringify(job),
      );
    }
  }
}

/**
 * Reuse the production DeviceBuildStore prototype without invoking its legacy
 * JSON constructor. This is important: constructor-time cleanup/compaction is
 * not allowed to touch the legacy authority after the global selector commits.
 *
 * @param {{ database: SwiftSimSqliteDatabase, legacyPath: string, maintenance?: boolean }} options
 * @returns {DeviceBuildStore}
 */
export function createSqliteDeviceBuildStore({ database, legacyPath, maintenance = true }) {
  if (typeof legacyPath !== "string" || !legacyPath) {
    throw new TypeError("SQLite device-build store requires the legacy path for artifact layout.");
  }
  const repository = new SqliteDeviceBuildMutationRepository(database);
  const store = /** @type {DeviceBuildStore} */ (Object.create(DeviceBuildStore.prototype));
  store.path = legacyPath;
  store.lockPath = `${legacyPath}.lock`;
  store.builds = new Map();
  store.apps = new Map();
  store.artifactCleanupJobs = new Map();
  store.deliveryReferenceCleanupJobs = new Map();
  store.maintenanceEnabled = Boolean(maintenance);

  store.readState = () => snapshotToMutableState(repository.read());
  store.writeState = () => {
    throw new Error("Legacy device-build JSON writes are disabled under SQLite authority.");
  };
  store.withLock = (operation) => {
    if (typeof operation !== "function") throw new TypeError("Device-build operation is required.");
    return operation();
  };
  store.withTransaction = (operation) => {
    const result = repository.mutate(operation);
    const state = snapshotToMutableState(repository.read());
    store.applyState(state);
    return result;
  };
  store.readOnly = (operation) => repository.readWithRecovery(operation);
  store.runMaintenance = () => {
    const changed = repository.runMaintenance();
    if (changed) store.applyState(snapshotToMutableState(repository.read()));
    return changed;
  };

  store.load();
  if (maintenance) {
    try {
      store.runMaintenance();
    } catch {}
    const timer = setInterval(() => {
      try {
        store.runMaintenance();
      } catch {}
      try {
        store.drainArtifactCleanupJobs();
      } catch {}
    }, CLEANUP_RETRY_INTERVAL_MS);
    timer.unref?.();
    store.maintenanceTimer = timer;
  }
  return store;
}

/** @param {DeviceBuildStateSnapshot} snapshot */
function snapshotToMutableState(snapshot) {
  return {
    builds: new Map(snapshot.builds.map((record) => [record.id, structuredClone(record)])),
    apps: new Map(snapshot.apps.map((record) => [record.id, structuredClone(record)])),
    artifactCleanupJobs: new Map(
      snapshot.artifactCleanupJobs.map((record) => [record.id, structuredClone(record)]),
    ),
    deliveryReferenceCleanupJobs: new Map(
      snapshot.deliveryReferenceCleanupJobs.map((record) => [record.id, structuredClone(record)]),
    ),
    needsCompaction: false,
  };
}

/** @param {ReturnType<typeof snapshotToMutableState>} state @returns {DeviceBuildStateSnapshot} */
function mutableStateToSnapshot(state) {
  return normalizeDeviceBuildStateSnapshot({
    builds: [...state.builds.values()],
    apps: [...state.apps.values()],
    artifactCleanupJobs: [...state.artifactCleanupJobs.values()],
    deliveryReferenceCleanupJobs: [...state.deliveryReferenceCleanupJobs.values()],
  });
}

/** @param {unknown} row */
function parseJSONRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SQLite returned an invalid device-build row.");
  }
  const raw = /** @type {Record<string, unknown>} */ (row).record_json;
  if (typeof raw !== "string") throw new Error("SQLite device-build row is missing record_json.");
  return JSON.parse(raw);
}

/** @param {Map<string, any>} builds */
function recoverStaleRenewals(builds) {
  const now = Date.now();
  let changed = false;
  for (const build of builds.values()) {
    const normalizedCapabilities = normalizeCapabilities(build.capabilities, now);
    if (JSON.stringify(normalizedCapabilities) !== JSON.stringify(build.capabilities || [])) {
      build.capabilities = normalizedCapabilities;
      changed = true;
    }
    const deadline = Date.parse(build.pendingRenewal?.deadlineAt || "");
    if (!build.pendingRenewal || (Number.isFinite(deadline) && deadline > now)) continue;
    delete build.pendingRenewal;
    touchBuild(build);
    changed = true;
  }
  return changed;
}

/** @param {unknown} capabilities @param {number} [now] */
function normalizeCapabilities(capabilities, now = Date.now()) {
  const byToken = new Map();
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const normalized = {
      token: String(capability?.token || ""),
      expiresAt: String(capability?.expiresAt || ""),
      remoteBaseUrl: String(capability?.remoteBaseUrl || ""),
      delivery: capability?.delivery ? structuredClone(capability.delivery) : null,
      installTTLMinutes: normalizeDeviceBuildTTLMinutes(capability?.installTTLMinutes),
      createdAt: String(capability?.createdAt || ""),
    };
    const expiresAt = Date.parse(normalized.expiresAt);
    if (!normalized.token || !Number.isFinite(expiresAt) || expiresAt <= now) continue;
    byToken.set(normalized.token, normalized);
  }
  return [...byToken.values()]
    .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt));
}

/** @param {any} build */
function touchBuild(build) {
  build.revision = Number(build.revision || 0) + 1;
  build.updatedAt = new Date().toISOString();
}

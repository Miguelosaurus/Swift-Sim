import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { normalizeDeviceBuildTTLMinutes } from "./deviceBuildDefaults.js";
import { runRequiredBuildValidation } from "./buildValidation.js";
import { NodeAtomicFileStore } from "./infrastructure/nodeAtomicFileStore.js";

export const MAX_DEVICE_BUILD_LOG_LINES = 500;
export const MAX_DEVICE_BUILD_LOG_BYTES = 64 * 1024;
export const BUILD_STATE_LOCK_TIMEOUT_CODE = "SWIFT_SIM_BUILD_STATE_LOCK_TIMEOUT";
export const BUILD_STATE_VERSION = 6;
const LOG_TRUNCATION_MARKER = "[earlier build output truncated]";
const LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const ACTIVE_INSTALL_OBSERVATION_STATES = new Set([
  "requested",
  "not-installed",
  "different-version",
]);

export class DeviceBuildStore {
  constructor({
    path = join(homedir(), ".swift-sim", "device-builds.json"),
    atomicFileStore = new NodeAtomicFileStore(),
  } = {}) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.atomicFileStore = atomicFileStore;
    this.builds = new Map();
    this.apps = new Map();
    this.artifactCleanupJobs = new Map();
    this.deliveryReferenceCleanupJobs = new Map();
    this.load();
    // Ordinary construction is intentionally artifact-cleanup-inert. Queued
    // artifact cleanup stays queued until the separately authorized cleanup
    // owner runs it; the legacy constructor previously drained any due jobs.
  }

  create(input) {
    if (input.project || input.workspace) {
      runRequiredBuildValidation({ project: input.project, workspace: input.workspace });
    }
    const now = new Date().toISOString();
    const build = {
      id: randomUUID(),
      token: input.token || randomBytes(24).toString("base64url"),
      tokenExpiredAt: "",
      revision: 0,
      remoteBaseUrl: input.remoteBaseUrl || "",
      delivery: {
        mode: input.delivery || (input.remoteBaseUrl ? "custom" : "quick-tunnel"),
        provider: input.remoteBaseUrl ? "user-configured" : "cloudflare-quick-tunnel",
        expiresAt: "",
      },
      project: input.project || "",
      workspace: input.workspace || "",
      scheme: input.scheme || "",
      configuration: input.configuration || "Release",
      exportMethod: input.exportMethod || "development",
      preserveData: input.preserveData !== false,
      createdAt: now,
      updatedAt: now,
      installTTLMinutes: normalizeDeviceBuildTTLMinutes(input.ttlMinutes),
      ttlMinutes: normalizeDeviceBuildTTLMinutes(input.ttlMinutes),
      expiresAt: "",
      state: "queued",
      app: {
        identity: "",
        name: input.scheme || "iOS App",
        bundleIdentifier: "",
        version: "",
        build: "",
        teamID: "",
      },
      signing: {
        style: "",
        method: input.exportMethod || "development",
        deviceInstallable: false,
        updateSafe: "unknown",
        warnings: [],
      },
      installation: normalizeInstallation(),
      artifacts: {
        root: "",
        archivePath: "",
        exportPath: "",
        ipaPath: "",
        manifestPath: "",
      },
      logs: [],
    };
    return this.withTransaction((state) => {
      const incoming = normalizeDeviceBuildRecord(structuredClone(build));
      incoming.revision = 1;
      state.builds.set(incoming.id, incoming);
      Object.assign(build, structuredClone(incoming));
      return build;
    });
  }

  save(build) {
    return this.withTransaction((state) => {
      const existing = state.builds.get(build.id);
      // Only create() may introduce an id. This permanently prevents a stale
      // writer from resurrecting a build after its app has been deleted.
      if (!existing) return build;

      const incoming = normalizeDeviceBuildRecord(structuredClone(build));
      incoming.installation = newerInstallation(existing.installation, incoming.installation);
      incoming.logs = mergeLogs(existing.logs, incoming.logs);
      if (Number(existing.revision || 0) > Number(incoming.revision || 0)) {
        incoming.token = existing.token;
        incoming.tokenExpiredAt = existing.tokenExpiredAt || "";
        incoming.expiresAt = existing.expiresAt;
        incoming.remoteBaseUrl = existing.remoteBaseUrl;
        incoming.delivery = structuredClone(existing.delivery);
        incoming.pendingRenewal = structuredClone(existing.pendingRenewal || null);
      } else {
        incoming.tokenExpiredAt = incoming.tokenExpiredAt || existing.tokenExpiredAt || "";
        incoming.pendingRenewal =
          incoming.pendingRenewal || structuredClone(existing.pendingRenewal || null);
      }
      finalizePendingRenewal(incoming);
      incoming.revision =
        Math.max(Number(existing.revision || 0), Number(incoming.revision || 0)) + 1;
      incoming.updatedAt = new Date().toISOString();
      state.builds.set(incoming.id, incoming);
      Object.assign(build, structuredClone(incoming));
      return build;
    });
  }

  get(id) {
    return this.withTransaction((state) => state.builds.get(id));
  }

  markInstallRequested(id) {
    return this.withTransaction((state) => {
      const build = state.builds.get(id);
      if (!build) return null;
      build.installation = normalizeInstallation(build.installation);
      build.installation.state = build.installation.state === "verified" ? "verified" : "requested";
      build.installation.requestedAt = new Date().toISOString();
      build.installation.verificationDeadlineAt = new Date(
        Date.now() + 15 * 60 * 1000,
      ).toISOString();
      build.installation.updatedAt = new Date().toISOString();
      touchBuild(build);
      return build;
    });
  }

  renewInstallLink(id, { ttlMinutes } = {}) {
    return this.withTransaction((state) => {
      const build = state.builds.get(id);
      if (!build) return null;
      const nextExpiresAt = new Date(
        Date.now() + normalizeDeviceBuildTTLMinutes(ttlMinutes) * 60 * 1000,
      ).toISOString();
      build.pendingRenewal = {
        token: randomBytes(24).toString("base64url"),
        createdAt: new Date().toISOString(),
        previous: {
          expiresAt: build.expiresAt,
          remoteBaseUrl: build.remoteBaseUrl,
          delivery: structuredClone(build.delivery || null),
        },
      };
      build.expiresAt = nextExpiresAt;
      if (build.delivery?.mode !== "custom") {
        build.remoteBaseUrl = "";
        build.delivery = {
          mode: "quick-tunnel",
          provider: "cloudflare-quick-tunnel",
          expiresAt: "",
        };
      } else {
        build.delivery.expiresAt = nextExpiresAt;
      }
      touchBuild(build);
      return build;
    });
  }

  saveVerification(id, verification) {
    return this.withTransaction((state) => {
      const build = state.builds.get(id);
      if (!build) return null;
      const previous = normalizeInstallation(build.installation);
      const reportedState = verification.state || "unknown";
      const nextState =
        reportedState === "unknown" && ACTIVE_INSTALL_OBSERVATION_STATES.has(previous.state)
          ? previous.state
          : reportedState;
      build.installation = {
        ...previous,
        state: nextState,
        verifiedAt:
          reportedState === "verified"
            ? verification.verifiedAt || new Date().toISOString()
            : previous.verifiedAt,
        updatedAt: new Date().toISOString(),
        verificationDeadlineAt: reportedState === "verified" ? "" : previous.verificationDeadlineAt,
        devices: Array.isArray(verification.devices) ? verification.devices : [],
      };
      touchBuild(build);
      return build;
    });
  }

  list() {
    return this.withTransaction((state) => sortedBuilds(state.builds));
  }

  listApps({ includeArchived = false } = {}) {
    return this.withTransaction((state) => listAppsFromState(state, includeArchived));
  }

  getApp(id) {
    return this.withTransaction(
      (state) => listAppsFromState(state, true).find((app) => app.id === id) || null,
    );
  }

  setAppArchived(id, archived) {
    return this.withTransaction((state) => {
      const app = listAppsFromState(state, true).find((candidate) => candidate.id === id);
      if (!app) return null;
      const current = state.apps.get(id) || {};
      state.apps.set(id, {
        ...current,
        archivedAt: archived ? new Date().toISOString() : "",
      });
      return listAppsFromState(state, true).find((candidate) => candidate.id === id) || null;
    });
  }

  deleteApp(id, { deleteArtifacts = true } = {}) {
    const result = this.withTransaction((state) => {
      const app = listAppsFromState(state, true).find((candidate) => candidate.id === id);
      if (!app) return { deleted: false };
      for (const build of app.builds) {
        if (deleteArtifacts && build.artifacts?.root) {
          const job = {
            id: randomUUID(),
            root: build.artifacts.root,
            createdAt: new Date().toISOString(),
            attempts: 0,
            lastError: "",
          };
          state.artifactCleanupJobs.set(job.id, job);
        }
        state.builds.delete(build.id);
      }
      state.apps.delete(id);
      return { deleted: true };
    });
    if (result.deleted) this.drainArtifactCleanupJobs();
    return result.deleted;
  }

  drainArtifactCleanupJobs() {
    const jobs = this.withLock(() => [...this.readState().artifactCleanupJobs.values()]);
    for (const job of jobs) {
      try {
        rmSync(job.root, { recursive: true, force: true });
        this.withTransaction((state) => {
          state.artifactCleanupJobs.delete(job.id);
          return true;
        });
      } catch (error) {
        this.withTransaction((state) => {
          const current = state.artifactCleanupJobs.get(job.id);
          if (!current) return false;
          current.attempts = Number(current.attempts || 0) + 1;
          current.lastError = error instanceof Error ? error.message : String(error);
          current.updatedAt = new Date().toISOString();
          return false;
        });
      }
    }
  }

  load() {
    const state = this.withLock(() => {
      const loaded = this.readState();
      if (loaded.needsCompaction) this.writeState(loaded);
      return loaded;
    });
    this.applyState(state);
  }

  withTransaction(operation) {
    return this.withLock(() => {
      const state = this.readState();
      expireBuildTokens(state.builds);
      const result = operation(state);
      this.writeState(state);
      this.applyState(state);
      return structuredClone(result);
    });
  }

  withLock(operation) {
    const deadline = Date.now() + LOCK_WAIT_MS;
    const ownerPath = join(this.lockPath, "owner.json");
    const owner = { pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() };
    while (true) {
      let created = false;
      try {
        mkdirSync(this.lockPath, { mode: 0o700 });
        created = true;
        writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
        break;
      } catch (error) {
        if (created) {
          rmSync(this.lockPath, { recursive: true, force: true });
          throw error;
        }
        if (error?.code !== "EEXIST") throw error;
        let existingOwner;
        try {
          existingOwner = JSON.parse(readFileSync(ownerPath, "utf8"));
        } catch {}
        if (existingOwner && !processIsAlive(existingOwner.pid)) {
          rmSync(this.lockPath, { recursive: true, force: true });
          continue;
        }
        if (!existingOwner && ownerlessLockIsStale(this.lockPath)) {
          rmSync(this.lockPath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) {
          const timeout = new Error("Timed out waiting for the Swift Sim build-state lock.");
          timeout.code = BUILD_STATE_LOCK_TIMEOUT_CODE;
          throw timeout;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    try {
      return operation();
    } finally {
      try {
        const currentOwner = JSON.parse(readFileSync(ownerPath, "utf8"));
        if (currentOwner.pid === owner.pid && currentOwner.nonce === owner.nonce) {
          rmSync(this.lockPath, { recursive: true, force: true });
        }
      } catch {}
    }
  }

  readState() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      let needsCompaction = Number(parsed.version || 0) < BUILD_STATE_VERSION;
      return {
        builds: new Map(
          (parsed.builds || []).map((build) => {
            const previousLogs = Array.isArray(build.logs) ? build.logs : [];
            const normalized = normalizeDeviceBuildRecord(build);
            if (!sameLogs(previousLogs, normalized.logs)) needsCompaction = true;
            return [normalized.id, normalized];
          }),
        ),
        apps: new Map(Object.entries(parsed.apps || {})),
        artifactCleanupJobs: new Map(Object.entries(parsed.artifactCleanupJobs || {})),
        deliveryReferenceCleanupJobs: new Map(
          Object.entries(parsed.deliveryReferenceCleanupJobs || {}),
        ),
        needsCompaction,
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          builds: new Map(),
          apps: new Map(),
          artifactCleanupJobs: new Map(),
          deliveryReferenceCleanupJobs: new Map(),
          needsCompaction: false,
        };
      }
      throw new Error(
        `Unable to read Swift Sim build state: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  writeState(state) {
    this.atomicFileStore.writeJSONSync(
      this.path,
      {
        version: BUILD_STATE_VERSION,
        apps: Object.fromEntries(state.apps),
        artifactCleanupJobs: Object.fromEntries(state.artifactCleanupJobs),
        deliveryReferenceCleanupJobs: Object.fromEntries(state.deliveryReferenceCleanupJobs || []),
        builds: [...state.builds.values()],
      },
      {
        mode: 0o600,
        createParentMode: 0o700,
        replace: true,
        syncDirectory: true,
      },
    );
  }

  applyState(state) {
    this.builds = new Map(state.builds);
    this.apps = new Map(state.apps);
    this.artifactCleanupJobs = new Map(state.artifactCleanupJobs);
    this.deliveryReferenceCleanupJobs = new Map(state.deliveryReferenceCleanupJobs || []);
  }
}

export function deviceAppIdentity(app = {}) {
  const bundleIdentifier = String(app.bundleIdentifier || "")
    .trim()
    .toLowerCase();
  if (!bundleIdentifier) return "";
  const teamID = String(app.teamID || "")
    .trim()
    .toUpperCase();
  return createHash("sha256")
    .update(`${teamID}\0${bundleIdentifier}`)
    .digest("base64url")
    .slice(0, 24);
}

function finalizePendingRenewal(build) {
  const pending = build.pendingRenewal;
  if (!pending) return;
  const previous = pending.previous || {};
  if (
    build.expiresAt === previous.expiresAt &&
    build.remoteBaseUrl === previous.remoteBaseUrl &&
    JSON.stringify(build.delivery || null) === JSON.stringify(previous.delivery || null)
  ) {
    delete build.pendingRenewal;
    return;
  }
  const customReady =
    build.delivery?.mode === "custom" && build.delivery?.expiresAt === build.expiresAt;
  const quickTunnelReady =
    build.delivery?.mode === "quick-tunnel" &&
    Boolean(build.remoteBaseUrl) &&
    Boolean(build.delivery?.expiresAt);
  if (!customReady && !quickTunnelReady) return;
  build.token = pending.token;
  build.tokenExpiredAt = "";
  delete build.pendingRenewal;
}

function expireBuildTokens(builds) {
  const now = Date.now();
  for (const build of builds.values()) {
    if (build.pendingRenewal) continue;
    const expiresAt = Date.parse(build.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt >= now || build.tokenExpiredAt) continue;
    build.token = randomBytes(24).toString("base64url");
    build.tokenExpiredAt = new Date().toISOString();
    touchBuild(build);
  }
}

function sortedBuilds(builds) {
  return [...builds.values()].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt)),
  );
}

function listAppsFromState(state, includeArchived) {
  const grouped = new Map();
  for (const build of sortedBuilds(state.builds)) {
    const identity = build.app?.identity || deviceAppIdentity(build.app) || `build-${build.id}`;
    if (!grouped.has(identity)) {
      const saved = state.apps.get(identity) || {};
      grouped.set(identity, {
        id: identity,
        name: build.app?.name || build.scheme || "iOS App",
        bundleIdentifier: build.app?.bundleIdentifier || "",
        teamID: build.app?.teamID || "",
        archivedAt: saved.archivedAt || "",
        builds: [],
      });
    }
    grouped.get(identity).builds.push(build);
  }
  return [...grouped.values()]
    .filter((app) => includeArchived || !app.archivedAt)
    .sort((a, b) =>
      String(b.builds[0]?.createdAt || "").localeCompare(String(a.builds[0]?.createdAt || "")),
    );
}

function touchBuild(build) {
  build.revision = Number(build.revision || 0) + 1;
  build.updatedAt = new Date().toISOString();
}

export function normalizeDeviceBuildRecord(build) {
  build.app = build.app || {};
  build.app.identity = build.app.identity || deviceAppIdentity(build.app);
  build.installation = normalizeInstallation(build.installation);
  build.logs = boundBuildLogs(build.logs);
  build.revision = Number(build.revision || 0);
  build.tokenExpiredAt = build.tokenExpiredAt || "";
  build.installTTLMinutes = normalizeDeviceBuildTTLMinutes(
    build.installTTLMinutes ?? build.ttlMinutes,
  );
  // Keep the pre-hardening field as a compatibility alias for existing callers
  // and persisted 0.6.0 build records. installTTLMinutes is authoritative.
  build.ttlMinutes = build.installTTLMinutes;
  if (!build.pendingRenewal) delete build.pendingRenewal;
  return build;
}

function normalizeInstallation(installation = {}) {
  return {
    state: installation.state || "unknown",
    requestedAt: installation.requestedAt || "",
    verifiedAt: installation.verifiedAt || "",
    updatedAt: installation.updatedAt || installation.verifiedAt || installation.requestedAt || "",
    verificationDeadlineAt: installation.verificationDeadlineAt || "",
    devices: Array.isArray(installation.devices) ? installation.devices : [],
  };
}

function newerInstallation(first = {}, second = {}) {
  const a = normalizeInstallation(first);
  const b = normalizeInstallation(second);
  return Date.parse(a.updatedAt || "") > Date.parse(b.updatedAt || "") ? a : b;
}

function mergeLogs(first = [], second = []) {
  const prefix = Array.isArray(first) ? first : [];
  const suffix = Array.isArray(second) ? second : [];
  let overlap = Math.min(prefix.length, suffix.length);
  while (overlap > 0) {
    const left = prefix.slice(prefix.length - overlap);
    const right = suffix.slice(0, overlap);
    if (left.every((line, index) => line === right[index])) break;
    overlap -= 1;
  }
  return boundBuildLogs([...prefix, ...suffix.slice(overlap)]);
}

export function boundBuildLogs(logs) {
  const source = Array.isArray(logs)
    ? logs.slice(-MAX_DEVICE_BUILD_LOG_LINES).map((line) => String(line))
    : [];
  const bounded = [];
  let remainingBytes = MAX_DEVICE_BUILD_LOG_BYTES;
  let droppedForBytes = false;

  for (let index = source.length - 1; index >= 0; index -= 1) {
    const line = source[index];
    const separatorBytes = bounded.length > 0 ? 1 : 0;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes + separatorBytes <= remainingBytes) {
      bounded.unshift(line);
      remainingBytes -= lineBytes + separatorBytes;
      continue;
    }

    droppedForBytes = true;
    if (bounded.length === 0 && remainingBytes > 0) {
      bounded.unshift(truncatedLogTail(line, remainingBytes));
      remainingBytes = 0;
    }
    break;
  }

  const markerBytes = Buffer.byteLength(LOG_TRUNCATION_MARKER, "utf8");
  if (droppedForBytes && remainingBytes >= markerBytes + (bounded.length > 0 ? 1 : 0)) {
    bounded.unshift(LOG_TRUNCATION_MARKER);
  }
  return bounded;
}

function truncatedLogTail(line, maxBytes) {
  const marker = `${LOG_TRUNCATION_MARKER} `;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (maxBytes <= markerBytes) return utf8Tail(marker.trimEnd(), maxBytes);
  return marker + utf8Tail(line, maxBytes - markerBytes);
}

function utf8Tail(value, maxBytes) {
  if (maxBytes <= 0) return "";
  const bytes = Buffer.from(String(value), "utf8");
  if (bytes.length <= maxBytes) return String(value);
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

function sameLogs(first, second) {
  if (!Array.isArray(first) || first.length !== second.length) return false;
  return first.every((line, index) => typeof line === "string" && line === second[index]);
}

function ownerlessLockIsStale(lockPath) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch {
    return false;
  }
}

function processIsAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { normalizeDeviceBuildTTLMinutes } from "./deviceBuildDefaults.js";
import { runRequiredBuildValidation } from "./buildValidation.js";

export const MAX_DEVICE_BUILD_LOG_LINES = 500;
const LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;

export class DeviceBuildStore {
  constructor({ path = join(homedir(), ".swift-sim", "device-builds.json") } = {}) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.builds = new Map();
    this.apps = new Map();
    this.artifactCleanupJobs = new Map();
    this.deliveryReferenceCleanupJobs = new Map();
    this.load();
    this.drainArtifactCleanupJobs();
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
      const incoming = normalizeBuild(structuredClone(build));
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

      const incoming = normalizeBuild(structuredClone(build));
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
        incoming.pendingRenewal = incoming.pendingRenewal || structuredClone(existing.pendingRenewal || null);
      }
      finalizePendingRenewal(incoming);
      incoming.revision = Math.max(Number(existing.revision || 0), Number(incoming.revision || 0)) + 1;
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
      build.installation.verificationDeadlineAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
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
        Date.now() + normalizeDeviceBuildTTLMinutes(ttlMinutes) * 60 * 1000
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
      const nextState = reportedState === "unknown" && previous.state === "requested"
        ? "requested"
        : reportedState;
      build.installation = {
        ...previous,
        state: nextState,
        verifiedAt: reportedState === "verified"
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
    return this.withTransaction((state) => listAppsFromState(state, true).find((app) => app.id === id) || null);
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
    const state = this.withLock(() => this.readState());
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
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the Swift Sim build-state lock.");
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
      return {
        builds: new Map((parsed.builds || []).map((build) => {
          const normalized = normalizeBuild(build);
          return [normalized.id, normalized];
        })),
        apps: new Map(Object.entries(parsed.apps || {})),
        artifactCleanupJobs: new Map(Object.entries(parsed.artifactCleanupJobs || {})),
        deliveryReferenceCleanupJobs: new Map(Object.entries(parsed.deliveryReferenceCleanupJobs || {})),
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          builds: new Map(),
          apps: new Map(),
          artifactCleanupJobs: new Map(),
          deliveryReferenceCleanupJobs: new Map(),
        };
      }
      throw new Error(`Unable to read Swift Sim build state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  writeState(state) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({
      version: 5,
      apps: Object.fromEntries(state.apps),
      artifactCleanupJobs: Object.fromEntries(state.artifactCleanupJobs),
      deliveryReferenceCleanupJobs: Object.fromEntries(state.deliveryReferenceCleanupJobs || []),
      builds: [...state.builds.values()],
    }, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, this.path);
  }

  applyState(state) {
    this.builds = new Map(state.builds);
    this.apps = new Map(state.apps);
    this.artifactCleanupJobs = new Map(state.artifactCleanupJobs);
    this.deliveryReferenceCleanupJobs = new Map(state.deliveryReferenceCleanupJobs || []);
  }
}

export function deviceAppIdentity(app = {}) {
  const bundleIdentifier = String(app.bundleIdentifier || "").trim().toLowerCase();
  if (!bundleIdentifier) return "";
  const teamID = String(app.teamID || "").trim().toUpperCase();
  return createHash("sha256")
    .update(`${teamID}\0${bundleIdentifier}`)
    .digest("base64url")
    .slice(0, 24);
}

function finalizePendingRenewal(build) {
  const pending = build.pendingRenewal;
  if (!pending) return;
  const previous = pending.previous || {};
  if (build.expiresAt === previous.expiresAt
      && build.remoteBaseUrl === previous.remoteBaseUrl
      && JSON.stringify(build.delivery || null) === JSON.stringify(previous.delivery || null)) {
    delete build.pendingRenewal;
    return;
  }
  const customReady = build.delivery?.mode === "custom"
    && build.delivery?.expiresAt === build.expiresAt;
  const quickTunnelReady = build.delivery?.mode === "quick-tunnel"
    && Boolean(build.remoteBaseUrl)
    && Boolean(build.delivery?.expiresAt);
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
  return [...builds.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
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
    .sort((a, b) => String(b.builds[0]?.createdAt || "").localeCompare(String(a.builds[0]?.createdAt || "")));
}

function touchBuild(build) {
  build.revision = Number(build.revision || 0) + 1;
  build.updatedAt = new Date().toISOString();
}

function normalizeBuild(build) {
  build.app = build.app || {};
  build.app.identity = build.app.identity || deviceAppIdentity(build.app);
  build.installation = normalizeInstallation(build.installation);
  build.logs = Array.isArray(build.logs) ? build.logs.slice(-MAX_DEVICE_BUILD_LOG_LINES) : [];
  build.revision = Number(build.revision || 0);
  build.tokenExpiredAt = build.tokenExpiredAt || "";
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
  return [...prefix, ...suffix.slice(overlap)].slice(-MAX_DEVICE_BUILD_LOG_LINES);
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

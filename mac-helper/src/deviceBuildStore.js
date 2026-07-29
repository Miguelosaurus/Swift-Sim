import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeDeviceBuildTTLMinutes } from "./deviceBuildDefaults.js";
import {
  DeviceBuildStore as DeviceBuildStoreCore,
  MAX_DEVICE_BUILD_LOG_LINES,
  deviceAppIdentity,
} from "./deviceBuildStoreCore.js";

export { MAX_DEVICE_BUILD_LOG_LINES, deviceAppIdentity };

const LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_LOCK_MAX_AGE_MS = 30_000;
const RENEWAL_LEASE_MS = 2 * 60 * 1000;
const CLEANUP_RETRY_INTERVAL_MS = 30_000;
const ACTIVE_BUILD_CLEANUP_DELAY_MS = 70 * 60 * 1000;
const MAX_CLEANUP_BACKOFF_MS = 60 * 60 * 1000;
// round3-capability-generations
const MAX_RETAINED_CAPABILITIES = 16;
const ACTIVE_BUILD_STATES = new Set([
  "queued",
  "validating",
  "preparing",
  "archiving",
  "building",
  "exporting",
  "delivering",
  "failed",
]);

export class DeviceBuildStore extends DeviceBuildStoreCore {
  constructor(options = {}) {
    super(options);
    this.runMaintenance();
    this.maintenanceTimer = setInterval(() => {
      try { this.runMaintenance(); } catch {}
      try { this.drainArtifactCleanupJobs(); } catch {}
    }, CLEANUP_RETRY_INTERVAL_MS);
    this.maintenanceTimer.unref?.();
  }

  create(input) {
    const project = input.project || "";
    const workspace = input.workspace || "";
    const build = super.create({ ...input, project: "", workspace: "" });
    build.project = project;
    build.workspace = workspace;
    const artifactRoot = join(dirname(this.path), "device-builds", build.id);
    build.artifacts = { ...(build.artifacts || {}), root: artifactRoot };
    build.control = { ...(build.control || {}), cancelPath: join(artifactRoot, ".cancelled") };
    return this.save(build);
  }

  save(build) {
    return this.withTransaction((state) => {
      const existing = state.builds.get(build.id);
      if (!existing) {
        const error = new Error("Device build was cancelled or deleted.");
        error.code = "SWIFT_SIM_BUILD_CANCELLED";
        throw error;
      }

      const incoming = normalizeIncomingBuild(structuredClone(build));
      incoming.installation = newerInstallation(existing.installation, incoming.installation);
      incoming.logs = mergeLogs(existing.logs, incoming.logs);
      incoming.capabilities = mergeCapabilities(existing.capabilities, incoming.capabilities);

      const pending = existing.pendingRenewal;
      if (pending) {
        const sameLease = incoming.pendingRenewal?.id === pending.id;
        if (sameLease && renewalCandidateIsReady(incoming, pending.target)) {
          const previousCapability = currentCapability(existing);
          if (capabilityIsLive(previousCapability)) {
            incoming.capabilities = mergeCapabilities(incoming.capabilities, [previousCapability]);
          }
          incoming.token = pending.token;
          incoming.tokenExpiredAt = "";
          incoming.installTTLMinutes = pending.target.ttlMinutes;
          incoming.remoteBaseUrl = incoming.remoteBaseUrl || pending.target.remoteBaseUrl;
          delete incoming.pendingRenewal;
        } else {
          // A failed waiter must not cancel a lease that another concurrent
          // waiter may still complete. Preserve the live link and shared lease;
          // the lease is cleared only by a successful commit or its deadline.
          preserveSecurityFields(incoming, existing);
          incoming.pendingRenewal = structuredClone(pending);
        }
      } else if (incoming.pendingRenewal) {
        // This candidate completed after another waiter already committed or
        // the lease expired. It may not overwrite the current live security
        // fields or revive the old lease.
        preserveSecurityFields(incoming, existing);
        delete incoming.pendingRenewal;
      } else if (Number(existing.revision || 0) > Number(incoming.revision || 0)) {
        preserveSecurityFields(incoming, existing);
      } else {
        incoming.tokenExpiredAt = incoming.tokenExpiredAt || existing.tokenExpiredAt || "";
      }

      incoming.revision = Math.max(Number(existing.revision || 0), Number(incoming.revision || 0)) + 1;
      incoming.updatedAt = new Date().toISOString();
      state.builds.set(incoming.id, incoming);
      Object.assign(build, structuredClone(incoming));
      return build;
    });
  }

  get(id) {
    return this.readOnly((state) => state.builds.get(id));
  }

  list() {
    return this.readOnly((state) => sortedBuilds(state.builds));
  }

  listApps({ includeArchived = false } = {}) {
    return this.readOnly((state) => listAppsFromState(state, includeArchived));
  }

  getApp(id) {
    return this.readOnly((state) => listAppsFromState(state, true).find((app) => app.id === id) || null);
  }

  renewInstallLink(id, { ttlMinutes } = {}) {
    return this.withTransaction((state) => {
      const build = state.builds.get(id);
      if (!build) return null;

      if (!build.pendingRenewal) {
        const requestedTTLMinutes = normalizeDeviceBuildTTLMinutes(
          ttlMinutes ?? build.installTTLMinutes
        );
        const custom = build.delivery?.mode === "custom";
        build.pendingRenewal = {
          id: randomUUID(),
          token: randomBytes(24).toString("base64url"),
          createdAt: new Date().toISOString(),
          deadlineAt: new Date(Date.now() + RENEWAL_LEASE_MS).toISOString(),
          previous: {
            expiresAt: build.expiresAt,
            remoteBaseUrl: build.remoteBaseUrl,
            delivery: structuredClone(build.delivery || null),
            installTTLMinutes: build.installTTLMinutes,
          },
          target: {
            ttlMinutes: requestedTTLMinutes,
            remoteBaseUrl: custom ? build.remoteBaseUrl : "",
            deliveryMode: custom ? "custom" : "quick-tunnel",
          },
        };
        touchBuild(build);
      }

      return renewalCandidate(build, build.pendingRenewal);
    });
  }

  deleteApp(id, { deleteArtifacts = true } = {}) {
    const result = this.withTransaction((state) => {
      const app = listAppsFromState(state, true).find((candidate) => candidate.id === id);
      if (!app) return { deleted: false };
      const now = Date.now();
      for (const build of app.builds) {
        const active = ACTIVE_BUILD_STATES.has(build.state);
        if (active && build.control?.cancelPath) {
          mkdirSync(dirname(build.control.cancelPath), { recursive: true, mode: 0o700 });
          writeFileSync(build.control.cancelPath, JSON.stringify({
            buildId: build.id,
            cancelledAt: new Date(now).toISOString(),
          }), { mode: 0o600 });
        }
        if (deleteArtifacts && build.artifacts?.root) {
          const delay = active ? ACTIVE_BUILD_CLEANUP_DELAY_MS : 0;
          const job = {
            id: randomUUID(),
            root: build.artifacts.root,
            buildId: build.id,
            createdAt: new Date(now).toISOString(),
            notBefore: new Date(now + delay).toISOString(),
            nextAttemptAt: new Date(now + delay).toISOString(),
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
    const now = Date.now();
    for (const job of jobs) {
      const dueAt = Date.parse(job.nextAttemptAt || job.notBefore || job.createdAt || "");
      if (Number.isFinite(dueAt) && dueAt > now) continue;
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
          const backoff = Math.min(
            MAX_CLEANUP_BACKOFF_MS,
            CLEANUP_RETRY_INTERVAL_MS * 2 ** Math.min(current.attempts - 1, 7)
          );
          current.nextAttemptAt = new Date(Date.now() + backoff).toISOString();
          return false;
        });
      }
    }
  }

  runMaintenance() {
    return this.withLock(() => {
      const state = this.readState();
      if (!recoverStaleRenewals(state.builds)) return false;
      this.writeState(state);
      this.applyState(state);
      return true;
    });
  }

  readOnly(operation) {
    return this.withLock(() => {
      const state = this.readState();
      if (recoverStaleRenewals(state.builds)) {
        this.writeState(state);
        this.applyState(state);
      }
      return structuredClone(operation(state));
    });
  }

  withTransaction(operation) {
    return this.withLock(() => {
      const state = this.readState();
      recoverStaleRenewals(state.builds);
      const result = operation(state);
      this.writeState(state);
      this.applyState(state);
      return structuredClone(result);
    });
  }

  withLock(operation) {
    const deadline = Date.now() + LOCK_WAIT_MS;
    const ownerPath = join(this.lockPath, "owner.json");
    const owner = {
      pid: process.pid,
      startedAt: requiredProcessStartedAt(process.pid),
      nonce: randomUUID(),
      createdAt: new Date().toISOString(),
    };

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
        try { existingOwner = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
        if (existingOwner && !lockOwnerIsAlive(existingOwner)) {
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
}

function renewalCandidate(build, pending) {
  const candidate = structuredClone(build);
  candidate.installTTLMinutes = pending.target.ttlMinutes;
  candidate.expiresAt = "";
  candidate.remoteBaseUrl = pending.target.remoteBaseUrl;
  candidate.delivery = {
    mode: pending.target.deliveryMode,
    provider: pending.target.deliveryMode === "custom"
      ? "user-configured"
      : "cloudflare-quick-tunnel",
    expiresAt: "",
  };
  candidate.pendingRenewal = structuredClone(pending);
  return candidate;
}

function renewalCandidateIsReady(build, target) {
  const capabilityExpiry = Date.parse(build.expiresAt || "");
  if (!Number.isFinite(capabilityExpiry) || capabilityExpiry <= Date.now()) return false;
  if (normalizeDeviceBuildTTLMinutes(build.installTTLMinutes) !== target.ttlMinutes) return false;
  if (target.deliveryMode === "custom") {
    return build.delivery?.mode === "custom"
      && build.remoteBaseUrl === target.remoteBaseUrl
      && build.delivery?.expiresAt === build.expiresAt;
  }
  const deliveryExpiry = Date.parse(build.delivery?.expiresAt || "");
  return build.delivery?.mode === "quick-tunnel"
    && Boolean(build.remoteBaseUrl)
    && Number.isFinite(deliveryExpiry)
    && deliveryExpiry >= capabilityExpiry;
}

function preserveSecurityFields(target, source) {
  target.token = source.token;
  target.tokenExpiredAt = source.tokenExpiredAt || "";
  target.expiresAt = source.expiresAt;
  target.remoteBaseUrl = source.remoteBaseUrl;
  target.delivery = structuredClone(source.delivery || null);
  target.installTTLMinutes = source.installTTLMinutes;
  target.capabilities = normalizeCapabilities(source.capabilities);
}

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

function normalizeIncomingBuild(build) {
  build.app = build.app || {};
  build.app.identity = build.app.identity || deviceAppIdentity(build.app);
  build.installation = normalizeInstallation(build.installation);
  build.logs = Array.isArray(build.logs) ? build.logs.slice(-MAX_DEVICE_BUILD_LOG_LINES) : [];
  build.revision = Number(build.revision || 0);
  build.tokenExpiredAt = build.tokenExpiredAt || "";
  build.capabilities = normalizeCapabilities(build.capabilities);
  return build;
}


function currentCapability(build) {
  return {
    token: build.token || "",
    expiresAt: build.expiresAt || "",
    remoteBaseUrl: build.remoteBaseUrl || "",
    delivery: structuredClone(build.delivery || null),
    installTTLMinutes: build.installTTLMinutes,
    createdAt: build.updatedAt || build.createdAt || new Date().toISOString(),
  };
}

function capabilityIsLive(capability, now = Date.now()) {
  const expiresAt = Date.parse(capability?.expiresAt || "");
  return Boolean(capability?.token) && Number.isFinite(expiresAt) && expiresAt > now;
}

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
    if (!capabilityIsLive(normalized, now)) continue;
    byToken.set(normalized.token, normalized);
  }
  return [...byToken.values()]
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
    .slice(-MAX_RETAINED_CAPABILITIES);
}

function mergeCapabilities(first, second) {
  return normalizeCapabilities([...(first || []), ...(second || [])]);
}

function normalizeInstallation(installation = {}) {
  return {
    state: installation.state || "unknown",
    requestedAt: installation.requestedAt || "",
    verifiedAt: installation.verifiedAt || "",
    updatedAt: installation.updatedAt || installation.verifiedAt || installation.requestedAt || "",
    devices: Array.isArray(installation.devices) ? installation.devices : [],
  };
}

function newerInstallation(first = {}, second = {}) {
  const a = normalizeInstallation(first);
  const b = normalizeInstallation(second);
  const aTime = finiteDate(a.updatedAt);
  const bTime = finiteDate(b.updatedAt);
  if (aTime !== bTime) return aTime > bTime ? a : b;

  // Equal or missing observation times use state rank only as a deterministic
  // tie-breaker. A newer different-version observation therefore supersedes an
  // older verified observation instead of being treated as inferior forever.
  const rank = { unknown: 0, requested: 1, "different-version": 2, verified: 3 };
  const aRank = rank[a.state] ?? 1;
  const bRank = rank[b.state] ?? 1;
  return aRank > bRank ? a : b;
}

function finiteDate(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
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

function sortedBuilds(builds) {
  return [...builds.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function listAppsFromState(state, includeArchived) {
  const grouped = new Map();
  const builds = sortedBuilds(state.builds);
  for (const build of builds) {
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

function lockOwnerIsAlive(owner) {
  if (!processIsAlive(owner?.pid)) return false;
  if (!owner?.startedAt) {
    const createdAt = Date.parse(owner?.createdAt || "");
    return Number.isFinite(createdAt) && Date.now() - createdAt < LEGACY_LOCK_MAX_AGE_MS;
  }
  return processStartedAt(owner.pid) === owner.startedAt;
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = processStartedAt(pid);
    if (startedAt) return startedAt;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish a process start identity for the Swift Sim build-state lock.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
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

function ownerlessLockIsStale(lockPath) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch {
    return false;
  }
}

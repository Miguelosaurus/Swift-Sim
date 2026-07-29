import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeDeviceBuildTTLMinutes } from "./deviceBuildDefaults.js";
import {
  DeviceBuildStore as DeviceBuildStoreCore,
  MAX_DEVICE_BUILD_LOG_LINES,
  deviceAppIdentity,
} from "./deviceBuildStoreCore.js";

export { MAX_DEVICE_BUILD_LOG_LINES, deviceAppIdentity };

const LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const RENEWAL_LEASE_MS = 2 * 60 * 1000;
const CLEANUP_RETRY_INTERVAL_MS = 30_000;
const ACTIVE_BUILD_CLEANUP_DELAY_MS = 70 * 60 * 1000;
const MAX_CLEANUP_BACKOFF_MS = 60 * 60 * 1000;
const ACTIVE_BUILD_STATES = new Set([
  "queued",
  "validating",
  "preparing",
  "archiving",
  "building",
  "exporting",
]);

export class DeviceBuildStore extends DeviceBuildStoreCore {
  constructor(options = {}) {
    super(options);
    this.cleanupTimer = setInterval(() => {
      try { this.drainArtifactCleanupJobs(); } catch {}
    }, CLEANUP_RETRY_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  create(input) {
    const project = input.project || "";
    const workspace = input.workspace || "";
    const build = super.create({ ...input, project: "", workspace: "" });
    build.project = project;
    build.workspace = workspace;
    return this.save(build);
  }

  save(build) {
    return this.withTransaction((state) => {
      const existing = state.builds.get(build.id);
      if (!existing) return build;

      const incoming = normalizeIncomingBuild(structuredClone(build));
      incoming.installation = newerInstallation(existing.installation, incoming.installation);
      incoming.logs = mergeLogs(existing.logs, incoming.logs);

      const pending = existing.pendingRenewal;
      if (pending) {
        const sameLease = incoming.pendingRenewal?.id === pending.id;
        if (sameLease && matchesRenewalFields(incoming, pending.previous)) {
          preserveSecurityFields(incoming, existing);
          delete incoming.pendingRenewal;
        } else if (sameLease && renewalCandidateIsReady(incoming, pending.target)) {
          incoming.token = pending.token;
          incoming.tokenExpiredAt = "";
          incoming.expiresAt = pending.target.expiresAt;
          incoming.remoteBaseUrl = incoming.remoteBaseUrl || pending.target.remoteBaseUrl;
          delete incoming.pendingRenewal;
        } else {
          preserveSecurityFields(incoming, existing);
          incoming.pendingRenewal = structuredClone(pending);
        }
      } else if (incoming.pendingRenewal) {
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

  renewInstallLink(id, { ttlMinutes } = {}) {
    return this.withTransaction((state) => {
      const build = state.builds.get(id);
      if (!build) return null;

      if (!build.pendingRenewal) {
        const expiresAt = new Date(
          Date.now() + normalizeDeviceBuildTTLMinutes(ttlMinutes) * 60 * 1000
        ).toISOString();
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
          },
          target: {
            expiresAt,
            remoteBaseUrl: custom ? build.remoteBaseUrl : "",
            delivery: custom
              ? {
                  mode: "custom",
                  provider: "user-configured",
                  expiresAt,
                }
              : {
                  mode: "quick-tunnel",
                  provider: "cloudflare-quick-tunnel",
                  expiresAt: "",
                },
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
        if (deleteArtifacts && build.artifacts?.root) {
          const delay = ACTIVE_BUILD_STATES.has(build.state) ? ACTIVE_BUILD_CLEANUP_DELAY_MS : 0;
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

  withTransaction(operation) {
    return this.withLock(() => {
      const state = this.readState();
      recoverStaleRenewals(state.builds);
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
    const owner = {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
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
  candidate.expiresAt = pending.target.expiresAt;
  candidate.remoteBaseUrl = pending.target.remoteBaseUrl;
  candidate.delivery = structuredClone(pending.target.delivery);
  candidate.pendingRenewal = structuredClone(pending);
  return candidate;
}

function matchesRenewalFields(build, expected) {
  return build.expiresAt === expected.expiresAt
    && build.remoteBaseUrl === expected.remoteBaseUrl
    && JSON.stringify(build.delivery || null) === JSON.stringify(expected.delivery || null);
}

function renewalCandidateIsReady(build, target) {
  if (build.expiresAt !== target.expiresAt) return false;
  if (build.delivery?.mode === "custom") {
    return build.remoteBaseUrl === target.remoteBaseUrl
      && build.delivery?.expiresAt === target.expiresAt;
  }
  return build.delivery?.mode === "quick-tunnel"
    && Boolean(build.remoteBaseUrl)
    && Boolean(build.delivery?.expiresAt)
    && Date.parse(build.delivery.expiresAt) >= Date.parse(target.expiresAt) - 30_000;
}

function preserveSecurityFields(target, source) {
  target.token = source.token;
  target.tokenExpiredAt = source.tokenExpiredAt || "";
  target.expiresAt = source.expiresAt;
  target.remoteBaseUrl = source.remoteBaseUrl;
  target.delivery = structuredClone(source.delivery || null);
}

function recoverStaleRenewals(builds) {
  const now = Date.now();
  for (const build of builds.values()) {
    const deadline = Date.parse(build.pendingRenewal?.deadlineAt || "");
    if (!build.pendingRenewal || (Number.isFinite(deadline) && deadline > now)) continue;
    delete build.pendingRenewal;
    touchBuild(build);
  }
}

function expireBuildTokens(builds) {
  const now = Date.now();
  for (const build of builds.values()) {
    const expiresAt = Date.parse(build.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt >= now || build.tokenExpiredAt) continue;
    build.token = randomBytes(24).toString("base64url");
    build.tokenExpiredAt = new Date().toISOString();
    touchBuild(build);
  }
}

function normalizeIncomingBuild(build) {
  build.app = build.app || {};
  build.app.identity = build.app.identity || deviceAppIdentity(build.app);
  build.installation = normalizeInstallation(build.installation);
  build.logs = Array.isArray(build.logs) ? build.logs.slice(-MAX_DEVICE_BUILD_LOG_LINES) : [];
  build.revision = Number(build.revision || 0);
  build.tokenExpiredAt = build.tokenExpiredAt || "";
  return build;
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
  const rank = { unknown: 0, requested: 1, "different-version": 2, verified: 3 };
  const aRank = rank[a.state] ?? 1;
  const bRank = rank[b.state] ?? 1;
  if (aRank !== bRank) return aRank > bRank ? a : b;
  const aTime = finiteDate(a.updatedAt);
  const bTime = finiteDate(b.updatedAt);
  return aTime > bTime ? a : b;
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

function listAppsFromState(state, includeArchived) {
  const grouped = new Map();
  const builds = [...state.builds.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
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
  if (!owner?.startedAt) return true;
  return processStartedAt(owner.pid) === owner.startedAt;
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

import "./lockOwnershipPreload.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_LOCK_MAX_AGE_MS = 30_000;
export const MAX_SESSION_LOG_LINES = 1_000;
let currentProcessStartedAt;

export class SessionStore {
  constructor({ path = join(homedir(), ".swift-sim", "sessions.json") } = {}) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.sessions = new Map();
    this.load();
  }

  create(input) {
    const now = new Date().toISOString();
    const session = {
      id: randomUUID(),
      token: input.token,
      project: input.project,
      scheme: input.scheme,
      simulatorUDID: input.simulatorUDID,
      remoteBaseUrl: input.remoteBaseUrl || "",
      createdAt: now,
      updatedAt: now,
      revision: 0,
      build: { state: "external-or-not-run" },
      stream: {
        state: "starting",
        transport: input.transport || "serve-sim",
        quality: "fallback",
        localUrl: "",
        previewUrl: "",
        wsUrl: "",
        port: undefined,
        pid: undefined,
        raw: {},
        limitations: [],
      },
      logs: [],
    };
    return this.save(session);
  }

  save(session) {
    if (!session?.id) throw new Error("A Swift Sim session id is required.");
    return this.withLock(() => {
      const sessions = this.readStateUnlocked();
      const incoming = normalizeSession(session);
      const existing = sessions.get(incoming.id);
      const saved = mergeSession(existing, incoming);
      saved.revision = Math.max(
        Number(existing?.revision || 0),
        Number(incoming.revision || 0),
      ) + 1;
      saved.updatedAt = new Date().toISOString();
      sessions.set(saved.id, saved);
      this.writeStateUnlocked(sessions);
      this.sessions = sessions;
      replaceSession(session, saved);
      return session;
    });
  }

  get(sessionId) {
    const sessions = this.readStateUnlocked();
    this.sessions = sessions;
    const session = sessions.get(sessionId);
    return session ? structuredClone(session) : undefined;
  }

  list() {
    const sessions = this.readStateUnlocked();
    this.sessions = sessions;
    return [...sessions.values()].map((session) => structuredClone(session));
  }

  findReusable({ project, scheme, simulatorUDID }) {
    return this.list().find((session) => (
      session.simulatorUDID === simulatorUDID
      && session.project === project
      && session.scheme === scheme
      && session.stream.state === "running"
    ));
  }

  load() {
    this.sessions = this.readStateUnlocked();
    return [...this.sessions.values()].map((session) => structuredClone(session));
  }

  flush() {
    return this.withLock(() => {
      const sessions = this.readStateUnlocked();
      for (const candidate of this.sessions.values()) {
        const incoming = normalizeSession(candidate);
        const existing = sessions.get(incoming.id);
        const saved = mergeSession(existing, incoming);
        saved.revision = Math.max(
          Number(existing?.revision || 0),
          Number(incoming.revision || 0),
        ) + 1;
        saved.updatedAt = new Date().toISOString();
        sessions.set(saved.id, saved);
      }
      this.writeStateUnlocked(sessions);
      this.sessions = sessions;
      return [...sessions.values()].map((session) => structuredClone(session));
    });
  }

  readStateUnlocked() {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return new Map();
      throw sessionStateError(this.path, error);
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sessions)) {
      throw sessionStateError(this.path, new Error("the stored session record is malformed"));
    }
    const sessions = new Map();
    for (const candidate of parsed.sessions) {
      const session = normalizeSession(candidate);
      if (!session.id || sessions.has(session.id)) {
        throw sessionStateError(this.path, new Error("the stored session record contains an invalid or duplicate id"));
      }
      sessions.set(session.id, session);
    }
    return sessions;
  }

  writeStateUnlocked(sessions) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(
        temporaryPath,
        JSON.stringify({ sessions: [...sessions.values()] }, null, 2),
        { mode: 0o600, flag: "wx" },
      );
      renameSync(temporaryPath, this.path);
    } catch (error) {
      try { rmSync(temporaryPath, { force: true }); } catch {}
      throw error;
    }
  }

  withLock(operation) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const ownerPath = join(this.lockPath, "owner.json");
    const owner = {
      pid: process.pid,
      startedAt: processStartIdentity(),
      nonce: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const deadline = Date.now() + LOCK_WAIT_MS;

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
        if ((existingOwner && !lockOwnerIsAlive(existingOwner))
            || (!existingOwner && ownerlessLockIsStale(this.lockPath))) {
          rmSync(this.lockPath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for the Swift Sim session-state lock.");
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
}

function normalizeSession(value) {
  const session = value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
  session.id = typeof session.id === "string" ? session.id : "";
  session.revision = Math.max(0, Number.isFinite(Number(session.revision)) ? Number(session.revision) : 0);
  session.logs = Array.isArray(session.logs)
    ? session.logs.map((line) => String(line)).slice(-MAX_SESSION_LOG_LINES)
    : [];
  session.build = session.build && typeof session.build === "object" && !Array.isArray(session.build)
    ? session.build
    : { state: "external-or-not-run" };
  session.stream = session.stream && typeof session.stream === "object" && !Array.isArray(session.stream)
    ? session.stream
    : { state: "stopped", transport: "serve-sim", raw: {}, limitations: [] };
  return session;
}

function mergeSession(existing, incoming) {
  if (!existing) return normalizeSession(incoming);
  const merged = {
    ...existing,
    ...incoming,
    createdAt: existing.createdAt || incoming.createdAt,
    remoteBaseUrl: incoming.remoteBaseUrl || existing.remoteBaseUrl || "",
    build: { ...(existing.build || {}), ...(incoming.build || {}) },
    stream: { ...(existing.stream || {}), ...(incoming.stream || {}) },
    logs: mergeLogs(existing.logs, incoming.logs),
  };
  return normalizeSession(merged);
}

function mergeLogs(existing, incoming) {
  const current = Array.isArray(existing) ? existing.map(String) : [];
  const candidate = Array.isArray(incoming) ? incoming.map(String) : [];
  let commonPrefix = 0;
  while (commonPrefix < current.length
      && commonPrefix < candidate.length
      && current[commonPrefix] === candidate[commonPrefix]) {
    commonPrefix += 1;
  }
  return [...current, ...candidate.slice(commonPrefix)].slice(-MAX_SESSION_LOG_LINES);
}

function replaceSession(target, source) {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  Object.assign(target, structuredClone(source));
}

function lockOwnerIsAlive(owner) {
  if (!processIsAlive(owner?.pid)) return false;
  if (!owner?.startedAt) {
    const createdAt = Date.parse(owner?.createdAt || "");
    return Number.isFinite(createdAt) && Date.now() - createdAt < LEGACY_LOCK_MAX_AGE_MS;
  }
  return processStartedAt(owner.pid) === owner.startedAt;
}

function processStartIdentity() {
  currentProcessStartedAt ||= requiredProcessStartedAt(process.pid);
  return currentProcessStartedAt;
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = processStartedAt(pid);
    if (startedAt) return startedAt;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish a process start identity for the Swift Sim session-state lock.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processIsAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function ownerlessLockIsStale(path) {
  try {
    return Date.now() - statSync(path).mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch {
    return false;
  }
}

function sessionStateError(path, error) {
  const wrapped = new Error(
    `Swift Sim session state at ${path} could not be read safely: ${error instanceof Error ? error.message : String(error)}`,
  );
  wrapped.code = "SWIFT_SIM_SESSION_STATE_INVALID";
  return wrapped;
}

import "./lockOwnershipPreload.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { currentSessionTransportPreference } from "./sessionRequestContext.js";

const LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_LOCK_MAX_AGE_MS = 30_000;
const SESSION_START_LEASE_MS = 60_000;
const SESSION_BASELINE = Symbol("swift-sim-session-baseline");
const IMMUTABLE_SESSION_FIELDS = new Set([
  "id",
  "token",
  "project",
  "scheme",
  "simulatorUDID",
  "createdAt",
  "updatedAt",
  "revision",
  "logs",
]);
let currentProcessStartedAt;

export class SessionStore {
  constructor({ path = join(homedir(), ".swift-sim", "sessions.json") } = {}) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.sessions = new Map();
    this.stateError = null;
    this.load();
  }

  create(input) {
    this.assertReadableState();
    return this.withLock(() => {
      const sessions = this.readStateUnlocked();
      const conflicting = [...sessions.values()].find((candidate) =>
        sameSessionTarget(candidate, input) && sessionStartIsActive(candidate)
      );
      if (conflicting) {
        const error = new Error("A Swift Sim session is already starting for this Simulator.");
        error.code = "SWIFT_SIM_SESSION_START_IN_PROGRESS";
        throw error;
      }

      const now = new Date().toISOString();
      const session = normalizeSession({
        id: randomUUID(),
        token: input.token,
        project: input.project,
        scheme: input.scheme,
        simulatorUDID: input.simulatorUDID,
        remoteBaseUrl: input.remoteBaseUrl || "",
        createdAt: now,
        updatedAt: now,
        revision: 1,
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
      });
      sessions.set(session.id, session);
      this.writeStateUnlocked(sessions);
      this.sessions = sessions;
      return sessionCopy(session);
    });
  }

  save(session) {
    this.assertReadableState();
    if (!session?.id) throw new Error("A Swift Sim session id is required.");
    return this.withLock(() => {
      const sessions = this.readStateUnlocked();
      const baseline = session[SESSION_BASELINE]
        ? normalizeSession(session[SESSION_BASELINE])
        : null;
      const incoming = normalizeSession(session);
      const existing = sessions.get(incoming.id);
      const saved = mergeSession(existing, incoming, baseline);
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
    const sessions = this.readCurrentState();
    this.sessions = sessions;
    const session = sessions.get(sessionId);
    return session ? sessionCopy(session) : undefined;
  }

  list() {
    try {
      const sessions = this.readCurrentState();
      return [...sessions.values()].map(sessionCopy);
    } catch {
      return [];
    }
  }

  findReusable({ project, scheme, simulatorUDID, transport = "" }) {
    this.assertReadableState();
    const requestedTransport = resolveRequestedTransport(
      transport || currentSessionTransportPreference() || sessionTransportFromProcess()
    );
    const session = [...this.readCurrentState().values()].find((candidate) => (
      candidate.simulatorUDID === simulatorUDID
      && candidate.project === project
      && candidate.scheme === scheme
      && candidate.stream.state === "running"
      && (!requestedTransport
        || (candidate.stream.transport || "serve-sim") === requestedTransport)
    ));
    return session ? sessionCopy(session) : undefined;
  }

  load() {
    try {
      this.sessions = this.readStateUnlocked();
      this.stateError = null;
    } catch (error) {
      this.sessions = new Map();
      this.stateError = error;
    }
    return [...this.sessions.values()].map(sessionCopy);
  }

  flush() {
    this.assertReadableState();
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
      return this.list();
    });
  }

  readStateUnlocked() {
    let raw;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return new Map();
      throw sessionStateError(this.path, error);
    }
    try {
      if ((statSync(this.path).mode & 0o077) !== 0) chmodSync(this.path, 0o600);
    } catch (error) {
      throw sessionStateError(this.path, error);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw sessionStateError(this.path, error);
    }
    if (!isPlainObject(parsed) || !Array.isArray(parsed.sessions)) {
      throw sessionStateError(this.path, new Error("the stored session record is malformed"));
    }
    const sessions = new Map();
    for (const candidate of parsed.sessions) {
      try {
        validateStoredSession(candidate);
      } catch (error) {
        throw sessionStateError(this.path, error);
      }
      const session = normalizeSession(candidate);
      if (sessions.has(session.id)) {
        throw sessionStateError(this.path, new Error("the stored session record contains a duplicate id"));
      }
      sessions.set(session.id, session);
    }
    return sessions;
  }

  readCurrentState() {
    try {
      const sessions = this.readStateUnlocked();
      this.sessions = sessions;
      this.stateError = null;
      return sessions;
    } catch (error) {
      this.stateError = error;
      throw error;
    }
  }

  assertReadableState() {
    if (!this.stateError) return;
    this.readCurrentState();
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

function sameSessionTarget(session, input) {
  return session?.project === (input.project || "")
    && session?.scheme === (input.scheme || "")
    && session?.simulatorUDID === input.simulatorUDID
    && (session?.stream?.transport || "serve-sim") === (input.transport || "serve-sim");
}

function sessionStartIsActive(session) {
  if (session?.stream?.state === "running") return true;
  if (session?.stream?.state !== "starting") return false;
  const updatedAt = Date.parse(session.updatedAt || session.createdAt || "");
  return Number.isFinite(updatedAt) && updatedAt + SESSION_START_LEASE_MS > Date.now();
}

function sessionTransportFromProcess(argv = process.argv) {
  if (String(argv?.[2] || "") !== "start-session") return "";
  const args = Array.isArray(argv) ? argv.slice(3) : [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index] || "");
    if (argument === "--transport" && args[index + 1] !== undefined) {
      return String(args[index + 1]);
    }
    if (argument.startsWith("--transport=")) {
      return argument.slice("--transport=".length);
    }
  }
  return process.env.SWIFT_SIM_TRANSPORT || "auto";
}

function resolveRequestedTransport(preference) {
  if (!preference) return "";
  if (preference === "auto") {
    return process.env.SWIFT_SIM_DISABLE_NATIVE_TRANSPORT === "1"
      ? "serve-sim"
      : "native-companion";
  }
  return String(preference);
}

function validateStoredSession(value) {
  if (!isPlainObject(value)) throw new Error("a stored session is not an object");
  requireStoredString(value, "id", { nonempty: true });
  requireStoredString(value, "token", { nonempty: true });
  for (const field of [
    "project",
    "scheme",
    "simulatorUDID",
    "remoteBaseUrl",
    "createdAt",
    "updatedAt",
    "orientation",
  ]) {
    requireStoredString(value, field, { optional: true });
  }
  if (value.revision !== undefined
      && (!Number.isFinite(value.revision) || value.revision < 0)) {
    throw new Error("a stored session has an invalid revision");
  }
  if (!Array.isArray(value.logs) || !value.logs.every((line) => typeof line === "string")) {
    throw new Error("a stored session has invalid logs");
  }
  if (!isPlainObject(value.build)) throw new Error("a stored session has an invalid build record");
  if (!isPlainObject(value.stream)) throw new Error("a stored session has an invalid stream record");
  for (const field of ["state", "transport", "quality", "localUrl", "previewUrl", "wsUrl"]) {
    requireStoredString(value.stream, field, { optional: true });
  }
  for (const field of ["port", "pid"]) {
    const candidate = value.stream[field];
    if (candidate !== undefined && candidate !== null && !Number.isFinite(candidate)) {
      throw new Error(`a stored session stream has an invalid ${field}`);
    }
  }
  if (value.stream.raw !== undefined && !isPlainObject(value.stream.raw)) {
    throw new Error("a stored session stream has invalid raw metadata");
  }
  if (value.stream.limitations !== undefined
      && (!Array.isArray(value.stream.limitations)
        || !value.stream.limitations.every((item) => typeof item === "string"))) {
    throw new Error("a stored session stream has invalid limitations");
  }
}

function requireStoredString(value, field, { optional = false, nonempty = false } = {}) {
  const candidate = value[field];
  if (candidate === undefined && optional) return;
  if (typeof candidate !== "string" || (nonempty && candidate.length === 0)) {
    throw new Error(`a stored session has an invalid ${field}`);
  }
}

function normalizeSession(value) {
  const session = value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
  session.id = typeof session.id === "string" ? session.id : "";
  session.revision = Math.max(0, Number.isFinite(Number(session.revision)) ? Number(session.revision) : 0);
  session.logs = Array.isArray(session.logs)
    ? session.logs.map((line) => String(line))
    : [];
  session.build = session.build && typeof session.build === "object" && !Array.isArray(session.build)
    ? session.build
    : { state: "external-or-not-run" };
  session.stream = session.stream && typeof session.stream === "object" && !Array.isArray(session.stream)
    ? session.stream
    : { state: "stopped", transport: "serve-sim", raw: {}, limitations: [] };
  return session;
}

function mergeSession(existing, incoming, baseline = null) {
  if (!existing) return normalizeSession(incoming);
  if (!baseline) {
    return normalizeSession({
      ...existing,
      ...incoming,
      id: existing.id,
      token: existing.token,
      project: existing.project,
      scheme: existing.scheme,
      simulatorUDID: existing.simulatorUDID,
      createdAt: existing.createdAt || incoming.createdAt,
      logs: mergeLegacyLogs(existing.logs, incoming.logs),
    });
  }

  const merged = structuredClone(existing);
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(incoming)])) {
    if (IMMUTABLE_SESSION_FIELDS.has(key)) continue;
    const value = incoming[key];
    const original = baseline[key];
    if (isDeepStrictEqual(value, original)) continue;
    if (isPlainObject(value) && isPlainObject(original)) {
      merged[key] = mergeChangedObject(existing[key], value, original);
    } else if (key in incoming) {
      merged[key] = structuredClone(value);
    } else {
      delete merged[key];
    }
  }
  merged.logs = mergeAppendedLogs(existing.logs, incoming.logs, baseline.logs);
  return normalizeSession(merged);
}

function mergeChangedObject(existing, incoming, baseline) {
  const merged = isPlainObject(existing) ? structuredClone(existing) : {};
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(incoming)])) {
    const value = incoming[key];
    const original = baseline[key];
    if (isDeepStrictEqual(value, original)) continue;
    if (isPlainObject(value) && isPlainObject(original)) {
      merged[key] = mergeChangedObject(existing?.[key], value, original);
    } else if (key in incoming) {
      merged[key] = structuredClone(value);
    } else {
      delete merged[key];
    }
  }
  return merged;
}

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function mergeAppendedLogs(existing, incoming, baseline) {
  const current = Array.isArray(existing) ? existing.map(String) : [];
  const candidate = Array.isArray(incoming) ? incoming.map(String) : [];
  const original = Array.isArray(baseline) ? baseline.map(String) : [];
  const unchangedPrefix = original.length <= candidate.length
    && original.every((line, index) => candidate[index] === line);
  const additions = unchangedPrefix
    ? candidate.slice(original.length)
    : candidate.slice(commonPrefixLength(original, candidate));
  return [...current, ...additions];
}

function mergeLegacyLogs(existing, incoming) {
  const current = Array.isArray(existing) ? existing.map(String) : [];
  const candidate = Array.isArray(incoming) ? incoming.map(String) : [];
  return [...current, ...candidate.slice(commonPrefixLength(current, candidate))];
}

function commonPrefixLength(first, second) {
  let length = 0;
  while (length < first.length
      && length < second.length
      && first[length] === second[length]) {
    length += 1;
  }
  return length;
}

function replaceSession(target, source) {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  Object.assign(target, structuredClone(source));
  attachBaseline(target, source);
}

function sessionCopy(source) {
  const copy = structuredClone(source);
  attachBaseline(copy, source);
  return copy;
}

function attachBaseline(target, source) {
  Object.defineProperty(target, SESSION_BASELINE, {
    value: structuredClone(source),
    enumerable: false,
    configurable: true,
  });
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

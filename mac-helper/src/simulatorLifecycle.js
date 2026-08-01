import "./lockOwnershipPreload.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import * as base from "./simulatorLifecycleBase.js";
import {
  listSimulatorClaims,
  readSimulatorClaim,
  removeSimulatorClaim,
  updateSimulatorClaim,
  writeSimulatorClaim,
} from "./simulatorLifecycleClaims.js";

export * from "./simulatorLifecycleBase.js";

const RUNTIME_CLAIM_SEPARATOR = "#swift-sim-claim:";
const SESSION_LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_LOCK_MAX_AGE_MS = 30_000;
const claimContext = new AsyncLocalStorage();
const sessionRegistries = new Map();
let currentProcessStartedAt;

export function registerSimulatorSessionStore(storeID, sessions, { readable = true } = {}) {
  const id = requiredStoreID(storeID);
  sessionRegistries.set(id, {
    readable: Boolean(readable),
    sessions: Array.isArray(sessions) ? sessions.map(ownershipSessionProjection) : [],
  });
}

export function reserveSimulatorLifecycleClaim(session, { storeID, rootPath } = {}) {
  const simulatorUDID = requiredUDID(session?.simulatorUDID);
  const sessionID = requiredSessionID(session?.id);
  const claimID = String(session?.stream?.raw?.swiftSimLifecycleClaimID || "").trim();
  if (!claimID) throw new Error("A durable Simulator lifecycle claim id is required.");
  const claim = {
    version: 1,
    claimID,
    sessionID,
    simulatorUDID,
    storeID: requiredStoreID(storeID),
    kind: "start",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeSimulatorClaim(claim, { rootPath });
  claimContext.enterWith(claim);
  return claim;
}

export async function startSimulatorRuntime(options = {}) {
  const simulatorUDID = requiredUDID(options.simulatorUDID);
  const claim = currentClaim(simulatorUDID, "start");
  const authorizeRunningRecovery = claim && typeof options.recover === "function"
    ? (runtime) => acquireRunningRecoveryLease(
        decodeRuntimeState(runtime),
        claim,
        { rootPath: options.rootPath },
      )
    : undefined;
  const stream = restorePublicStream(await base.startSimulatorRuntime({
    ...options,
    operation: wrapProjectionOperation(options.operation, claim, options.rootPath),
    authorizeRunningRecovery,
  }));
  if (claim) finalizeClaim(claim, stream, { rootPath: options.rootPath });
  return stream;
}

export async function restartSimulatorRuntime(options = {}) {
  const session = options.session;
  const simulatorUDID = requiredUDID(session?.simulatorUDID);
  const previousNonce = sessionNonce(session);
  const claim = {
    version: 1,
    claimID: randomUUID(),
    sessionID: requiredSessionID(session?.id || `legacy:${previousNonce}`),
    simulatorUDID,
    storeID: "restart",
    kind: "restart",
    previousNonce,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeSimulatorClaim(claim, { rootPath: options.rootPath });
  try {
    const stream = restorePublicStream(await base.restartSimulatorRuntime({
      ...options,
      operation: wrapProjectionOperation(options.operation, claim, options.rootPath),
    }));
    finalizeClaim(claim, stream, { rootPath: options.rootPath });
    return stream;
  } catch (error) {
    markClaimFailed(claim, error, { rootPath: options.rootPath });
    throw error;
  }
}

export function readSimulatorRuntimeState(simulatorUDID, options = {}) {
  return decodeRuntimeState(base.readSimulatorRuntimeState(simulatorUDID, options));
}

export function simulatorSessionRuntimeSnapshot(session, { rootPath } = {}) {
  const simulatorUDID = requiredUDID(session?.simulatorUDID);
  if (base.simulatorLifecycleIsActive(simulatorUDID, { rootPath })) {
    return { disposition: "busy", runtime: null, projection: null };
  }
  let runtime;
  try {
    runtime = readSimulatorRuntimeState(simulatorUDID, { rootPath });
  } catch {
    return { disposition: "unreadable", runtime: null, projection: null };
  }
  const expectedNonce = sessionNonce(session);
  if (!runtime) {
    return {
      disposition: !expectedNonce && session?.stream?.state === "running" ? "legacy-running" : "missing",
      runtime: null,
      projection: null,
    };
  }
  if (runtime.status === "running" && expectedNonce && runtime.nonce === expectedNonce) {
    return { disposition: "owned-running", runtime, projection: claimProjectionFor(session, runtime, { rootPath }) };
  }
  if (runtime.status === "running"
      && ((expectedNonce && runtime.previousNonce === expectedNonce)
        || restartClaimOwnsRuntime(session, runtime, { rootPath }))) {
    return { disposition: "handoff-running", runtime, projection: claimProjectionFor(session, runtime, { rootPath }) };
  }
  if (runtime.status === "running" && startClaimOwnsRuntime(session, runtime, { rootPath })) {
    return { disposition: "claimed-running", runtime, projection: claimProjectionFor(session, runtime, { rootPath }) };
  }
  if (runtime.status === "running"
      && runtime.claimID
      && ["starting", "running"].includes(session?.stream?.state)) {
    return { disposition: "busy", runtime, projection: null };
  }
  if (runtime.status === "running") return { disposition: "superseded", runtime, projection: null };
  if (runtime.status === "stopped") return { disposition: "stopped", runtime, projection: null };
  if (String(runtime.status).startsWith("failed-")) return { disposition: "failed", runtime, projection: null };
  return { disposition: "busy", runtime, projection: null };
}

export function simulatorSessionIsReusable(session, options = {}) {
  return ["owned-running", "handoff-running", "claimed-running", "legacy-running"]
    .includes(simulatorSessionRuntimeSnapshot(session, options).disposition);
}

export function cleanupSimulatorLifecycleClaims(session, { rootPath } = {}) {
  const simulatorUDID = requiredUDID(session?.simulatorUDID);
  const sessionID = requiredSessionID(session?.id);
  for (const claim of listSimulatorClaims(simulatorUDID, { rootPath })) {
    if (claim.sessionID === sessionID) removeSimulatorClaim(claim, { rootPath });
  }
}

function wrapProjectionOperation(operation, claim, rootPath) {
  if (typeof operation !== "function") return operation;
  return async () => {
    const stream = await operation();
    if (!claim) return stream;
    const projection = publicStreamProjection(stream);
    updateSimulatorClaim(claim, {
      projection,
      updatedAt: new Date().toISOString(),
    }, { rootPath });
    return {
      ...stream,
      transport: encodeRuntimeTransport(projection.transport, claim.claimID),
      raw: {
        ...(stream?.raw && typeof stream.raw === "object" && !Array.isArray(stream.raw)
          ? stream.raw
          : {}),
        swiftSimLifecycleClaimID: claim.claimID,
        swiftSimPublicTransport: projection.transport,
      },
    };
  };
}

function finalizeClaim(claim, stream, { rootPath } = {}) {
  updateSimulatorClaim(claim, {
    runtimeNonce: String(stream?.raw?.swiftSimLifecycleNonce || ""),
    projection: publicStreamProjection(stream),
    status: "published",
    updatedAt: new Date().toISOString(),
  }, { rootPath });
  claim.completed = true;
}

function markClaimFailed(claim, error, { rootPath } = {}) {
  updateSimulatorClaim(claim, {
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    updatedAt: new Date().toISOString(),
  }, { rootPath });
}

function acquireRunningRecoveryLease(runtime, claim, { rootPath } = {}) {
  const registry = sessionRegistries.get(claim.storeID);
  if (!registry?.readable) return null;
  let release = null;
  try {
    release = acquireSessionStateLock(claim.storeID);
    if (registeredRuntimeOwner(runtime, claim, { rootPath }) === "unowned") {
      return release;
    }
  } catch {
    // Any lock, read, parse, or identity failure must fail closed.
  }
  releaseLock(release);
  return null;
}

function registeredRuntimeOwner(runtime, claim, { rootPath } = {}) {
  const registry = sessionRegistries.get(claim.storeID);
  if (!registry?.readable) return "unknown";
  let sessions;
  try {
    sessions = readCurrentSessionOwners(claim.storeID);
  } catch {
    return "unknown";
  }
  const candidates = sessions.filter((session) => (
    session?.simulatorUDID === runtime.simulatorUDID
    && ["starting", "running"].includes(session?.stream?.state)
  ));
  const owner = candidates.find((session) => {
    const nonce = sessionNonce(session);
    if (nonce && (runtime.nonce === nonce || runtime.previousNonce === nonce)) return true;
    if (!nonce && Number(session?.stream?.pid) === Number(runtime?.pid)) return true;
    return startClaimOwnsRuntime(session, runtime, { rootPath })
      || restartClaimOwnsRuntime(session, runtime, { rootPath });
  });
  if (owner) return "owned";
  if (runtime.claimID && candidates.length > 0) return "unknown";
  return "unowned";
}

function readCurrentSessionOwners(storeID) {
  const raw = readFileSync(requiredStoreID(storeID), "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.sessions)) {
    throw new Error("the stored Simulator session registry is malformed");
  }
  return parsed.sessions.map((session) => {
    validateStoredSessionForOwnership(session);
    return ownershipSessionProjection(session);
  });
}

function validateStoredSessionForOwnership(value) {
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

function startClaimOwnsRuntime(session, runtime, { rootPath } = {}) {
  const claimID = sessionClaimID(session);
  if (!claimID) return false;
  const claim = readSimulatorClaim(requiredUDID(session.simulatorUDID), claimID, { rootPath });
  return Boolean(claim
    && claim.kind === "start"
    && claim.sessionID === session.id
    && claimMatchesRuntime(claim, runtime));
}

function restartClaimOwnsRuntime(session, runtime, { rootPath } = {}) {
  const expectedNonce = sessionNonce(session);
  const sessionID = restartClaimSessionID(session, expectedNonce);
  return listSimulatorClaims(requiredUDID(session.simulatorUDID), { rootPath })
    .some((claim) => claim.kind === "restart"
      && claim.sessionID === sessionID
      && (!expectedNonce || claim.previousNonce === expectedNonce)
      && claimMatchesRuntime(claim, runtime));
}

function claimProjectionFor(session, runtime, { rootPath } = {}) {
  const claimID = String(session?.stream?.raw?.swiftSimLifecycleClaimID || "").trim();
  if (claimID) {
    const claim = readSimulatorClaim(requiredUDID(session.simulatorUDID), claimID, { rootPath });
    if (claim?.projection && claimMatchesRuntime(claim, runtime)) return structuredClone(claim.projection);
  }
  const expectedNonce = sessionNonce(session);
  const sessionID = restartClaimSessionID(session, expectedNonce);
  const claim = listSimulatorClaims(requiredUDID(session.simulatorUDID), { rootPath })
    .find((candidate) => candidate.kind === "restart"
      && candidate.sessionID === sessionID
      && (!expectedNonce || candidate.previousNonce === expectedNonce)
      && claimMatchesRuntime(candidate, runtime));
  if (claim?.projection) return structuredClone(claim.projection);
  return runtimeProjection(runtime);
}

function claimMatchesRuntime(claim, runtime) {
  if (!claim || !runtime) return false;
  if (runtime.claimID) return runtime.claimID === claim.claimID;
  return Boolean(claim.projection && projectionMatchesRuntime(claim.projection, runtime));
}

function projectionMatchesRuntime(projection, runtime) {
  const projectedPID = Number(projection?.pid);
  const runtimePID = Number(runtime?.pid);
  if (!Number.isInteger(projectedPID) || projectedPID <= 0) return false;
  if (!Number.isInteger(runtimePID) || runtimePID <= 0) return false;
  return projectedPID === runtimePID
    && (!runtime?.transport || projection.transport === runtime.transport);
}

function runtimeProjection(runtime) {
  if (!runtime || runtime.status !== "running") return null;
  const pid = Number(runtime.pid);
  return {
    state: "running",
    transport: String(runtime.transport || "serve-sim"),
    quality: "fallback",
    localUrl: "",
    previewUrl: "",
    wsUrl: "",
    port: undefined,
    pid: Number.isInteger(pid) && pid > 0 ? pid : undefined,
    limitations: [],
  };
}

function publicStreamProjection(stream) {
  const port = Number(stream?.port);
  const pid = Number(stream?.pid);
  return {
    state: "running",
    transport: String(stream?.transport || "serve-sim"),
    quality: String(stream?.quality || "fallback"),
    localUrl: String(stream?.localUrl || ""),
    previewUrl: String(stream?.previewUrl || stream?.localUrl || ""),
    wsUrl: String(stream?.wsUrl || ""),
    port: Number.isFinite(port) ? port : undefined,
    pid: Number.isInteger(pid) && pid > 0 ? pid : undefined,
    limitations: Array.isArray(stream?.limitations) ? stream.limitations.map(String) : [],
  };
}

function restorePublicStream(stream) {
  if (!stream || typeof stream !== "object") return stream;
  const raw = stream.raw && typeof stream.raw === "object" && !Array.isArray(stream.raw)
    ? stream.raw
    : {};
  const { swiftSimPublicTransport, ...publicRaw } = raw;
  return {
    ...stream,
    transport: String(swiftSimPublicTransport || publicRuntimeTransport(stream.transport) || "serve-sim"),
    raw: publicRaw,
  };
}

function decodeRuntimeState(runtime) {
  if (!runtime) return null;
  const taggedTransport = String(runtime.transport || "");
  return {
    ...runtime,
    transport: publicRuntimeTransport(taggedTransport),
    claimID: runtimeClaimID(taggedTransport),
  };
}

function encodeRuntimeTransport(transport, claimID) {
  return `${publicRuntimeTransport(transport)}${RUNTIME_CLAIM_SEPARATOR}${claimID}`;
}

function publicRuntimeTransport(value) {
  const transport = String(value || "");
  const separatorIndex = transport.lastIndexOf(RUNTIME_CLAIM_SEPARATOR);
  return separatorIndex >= 0 ? transport.slice(0, separatorIndex) : transport;
}

function runtimeClaimID(value) {
  const transport = String(value || "");
  const separatorIndex = transport.lastIndexOf(RUNTIME_CLAIM_SEPARATOR);
  return separatorIndex >= 0
    ? transport.slice(separatorIndex + RUNTIME_CLAIM_SEPARATOR.length)
    : "";
}

function currentClaim(simulatorUDID, kind) {
  const claim = claimContext.getStore();
  if (claim?.completed || claim?.simulatorUDID !== simulatorUDID || claim?.kind !== kind) return null;
  return claim;
}

function restartClaimSessionID(session, expectedNonce) {
  return requiredSessionID(session?.id || `legacy:${expectedNonce}`);
}

function ownershipSessionProjection(session) {
  return {
    id: String(session?.id || ""),
    simulatorUDID: String(session?.simulatorUDID || ""),
    stream: {
      state: String(session?.stream?.state || ""),
      pid: session?.stream?.pid,
      raw: {
        swiftSimLifecycleNonce: String(session?.stream?.raw?.swiftSimLifecycleNonce || ""),
        swiftSimLifecycleClaimID: String(session?.stream?.raw?.swiftSimLifecycleClaimID || ""),
      },
    },
  };
}

function acquireSessionStateLock(storeID) {
  const path = requiredStoreID(storeID);
  const lockPath = `${path}.lock`;
  const ownerPath = join(lockPath, "owner.json");
  const owner = {
    pid: process.pid,
    startedAt: processStartIdentity(),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const deadline = Date.now() + SESSION_LOCK_WAIT_MS;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  while (true) {
    let created = false;
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      created = true;
      writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
      return () => {
        try {
          const current = JSON.parse(readFileSync(ownerPath, "utf8"));
          if (current.pid === owner.pid && current.nonce === owner.nonce) {
            rmSync(lockPath, { recursive: true, force: true });
          }
        } catch {}
      };
    } catch (error) {
      if (created) {
        rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      if (error?.code !== "EEXIST") throw error;
      let existingOwner;
      try { existingOwner = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
      if ((existingOwner && !sessionLockOwnerIsAlive(existingOwner))
          || (!existingOwner && ownerlessSessionLockIsStale(lockPath))) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the Swift Sim session-state lock.");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function releaseLock(release) {
  try { release?.(); } catch {}
}

function sessionLockOwnerIsAlive(owner) {
  if (!processIsAlive(owner?.pid)) return false;
  if (!owner?.startedAt) {
    const createdAt = Date.parse(owner?.createdAt || "");
    return Number.isFinite(createdAt) && Date.now() - createdAt < LEGACY_LOCK_MAX_AGE_MS;
  }
  return processStartedAt(owner.pid) === owner.startedAt;
}

function ownerlessSessionLockIsStale(path) {
  try {
    return Date.now() - statSync(path).mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch {
    return false;
  }
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
  throw new Error("Unable to establish a process start identity for the Simulator ownership lock.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processIsAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

function sessionClaimID(session) {
  return String(session?.stream?.raw?.swiftSimLifecycleClaimID || "").trim();
}

function sessionNonce(session) {
  return String(session?.stream?.raw?.swiftSimLifecycleNonce || "").trim();
}

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requiredUDID(value) {
  const result = String(value || "").trim();
  if (!result) throw new Error("A Simulator UDID is required.");
  return result;
}

function requiredSessionID(value) {
  const result = String(value || "").trim();
  if (!result) throw new Error("A Simulator session id is required.");
  return result;
}

function requiredStoreID(value) {
  const result = String(value || "").trim();
  if (!result) throw new Error("A Simulator session store id is required.");
  return result;
}

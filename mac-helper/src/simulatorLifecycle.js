import "./lockOwnershipPreload.js";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOCK_WAIT_MS = 60_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_LOCK_MAX_AGE_MS = 30_000;
let currentProcessStartedAt;

export async function startSimulatorRuntime({ simulatorUDID, operation, recover, rootPath } = {}) {
  const requiredUDID = requiredSimulatorUDID(simulatorUDID);
  return withSimulatorLifecycleLock(requiredUDID, async () => {
    const current = readSimulatorRuntimeState(requiredUDID, { rootPath });
    if (current?.status === "running") throw activeRuntimeError();
    if (current && current.status !== "stopped") {
      if (typeof recover !== "function") throw uncertainRuntimeError();
      try {
        await recover();
      } catch (error) {
        publishRuntimeFailure(requiredUDID, "failed-stop", error, {
          previousNonce: current.previousNonce || current.nonce,
          rootPath,
        });
        throw error;
      }
    }
    const operationNonce = randomUUID();
    writeSimulatorRuntimeState(requiredUDID, {
      simulatorUDID: requiredUDID,
      nonce: operationNonce,
      status: "starting",
      previousNonce: current?.nonce || "",
      updatedAt: new Date().toISOString(),
    }, { rootPath });
    try {
      const stream = await requiredOperation(operation)();
      return publishRunningRuntime(requiredUDID, stream, {
        nonce: operationNonce,
        rootPath,
      });
    } catch (error) {
      publishRuntimeFailure(requiredUDID, "failed-start", error, {
        nonce: operationNonce,
        previousNonce: current?.nonce || "",
        rootPath,
      });
      throw error;
    }
  }, { rootPath });
}

export async function restartSimulatorRuntime({ session, operation, rootPath } = {}) {
  const simulatorUDID = requiredSimulatorUDID(session?.simulatorUDID);
  return withSimulatorLifecycleLock(simulatorUDID, async () => {
    const expectedNonce = sessionRuntimeNonce(session);
    const current = readSimulatorRuntimeState(simulatorUDID, { rootPath });
    if (!runningRuntimeOwnsSession(current, session, expectedNonce)) {
      throw supersededRuntimeError();
    }
    const operationNonce = randomUUID();
    writeSimulatorRuntimeState(simulatorUDID, {
      simulatorUDID,
      nonce: operationNonce,
      status: "restarting",
      previousNonce: current?.nonce || expectedNonce,
      updatedAt: new Date().toISOString(),
    }, { rootPath });
    try {
      const stream = await requiredOperation(operation)();
      return publishRunningRuntime(simulatorUDID, stream, {
        nonce: operationNonce,
        rootPath,
      });
    } catch (error) {
      publishRuntimeFailure(simulatorUDID, "failed-restart", error, {
        nonce: operationNonce,
        previousNonce: current?.nonce || expectedNonce,
        rootPath,
      });
      throw error;
    }
  }, { rootPath });
}

export async function stopSimulatorRuntime({ session, operation, rootPath } = {}) {
  const simulatorUDID = requiredSimulatorUDID(session?.simulatorUDID);
  return withSimulatorLifecycleLock(simulatorUDID, async () => {
    const expectedNonce = sessionRuntimeNonce(session);
    const current = readSimulatorRuntimeState(simulatorUDID, { rootPath });
    if (!runtimeMayBeStoppedBySession(current, session, expectedNonce)) {
      throw supersededRuntimeError();
    }
    const previousNonce = current?.status === "running"
      ? current.nonce
      : current?.previousNonce || expectedNonce;
    const operationNonce = randomUUID();
    writeSimulatorRuntimeState(simulatorUDID, {
      simulatorUDID,
      nonce: operationNonce,
      status: "stopping",
      previousNonce,
      updatedAt: new Date().toISOString(),
    }, { rootPath });
    try {
      const result = await requiredOperation(operation)();
      writeSimulatorRuntimeState(simulatorUDID, {
        simulatorUDID,
        nonce: randomUUID(),
        status: "stopped",
        previousNonce,
        updatedAt: new Date().toISOString(),
      }, { rootPath });
      return result;
    } catch (error) {
      publishRuntimeFailure(simulatorUDID, "failed-stop", error, {
        nonce: operationNonce,
        previousNonce,
        rootPath,
      });
      throw error;
    }
  }, { rootPath });
}

export function simulatorSessionIsReusable(session, { rootPath } = {}) {
  const simulatorUDID = requiredSimulatorUDID(session?.simulatorUDID);
  if (simulatorLifecycleIsActive(simulatorUDID, { rootPath })) return false;
  const expectedNonce = sessionRuntimeNonce(session);
  let current;
  try {
    current = readSimulatorRuntimeState(simulatorUDID, { rootPath });
  } catch {
    return false;
  }
  if (!current) return !expectedNonce;
  return runningRuntimeOwnsSession(current, session, expectedNonce);
}

export async function withSimulatorLifecycleLock(simulatorUDID, operation, {
  rootPath,
  waitMs = LOCK_WAIT_MS,
} = {}) {
  const statePath = simulatorRuntimeStatePath(simulatorUDID, { rootPath });
  const lockPath = `${statePath}.lock`;
  const release = await acquireLifecycleLock(lockPath, waitMs);
  try {
    return await requiredOperation(operation)();
  } finally {
    release();
  }
}

export function simulatorLifecycleIsActive(simulatorUDID, { rootPath } = {}) {
  const lockPath = `${simulatorRuntimeStatePath(simulatorUDID, { rootPath })}.lock`;
  if (!existsSync(lockPath)) return false;
  const ownerPath = join(lockPath, "owner.json");
  let owner;
  try { owner = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
  if (owner && lockOwnerIsAlive(owner)) return true;
  if (!owner && !ownerlessLockIsStale(lockPath)) return true;
  try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
  return existsSync(lockPath);
}

export function readSimulatorRuntimeState(simulatorUDID, { rootPath } = {}) {
  const path = simulatorRuntimeStatePath(simulatorUDID, { rootPath });
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw runtimeStateError(path, error);
  }
  try {
    const state = JSON.parse(raw);
    validateRuntimeState(state, requiredSimulatorUDID(simulatorUDID));
    return state;
  } catch (error) {
    throw runtimeStateError(path, error);
  }
}

export function simulatorRuntimeStatePath(simulatorUDID, { rootPath } = {}) {
  const value = requiredSimulatorUDID(simulatorUDID);
  const root = rootPath
    || process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT
    || join(homedir(), ".swift-sim", "simulator-runtime");
  const key = createHash("sha256").update(value).digest("hex");
  return join(root, `${key}.json`);
}

function publishRunningRuntime(simulatorUDID, stream, { nonce = randomUUID(), rootPath } = {}) {
  const next = {
    simulatorUDID,
    nonce,
    status: "running",
    pid: normalizedPID(stream?.pid),
    transport: String(stream?.transport || ""),
    updatedAt: new Date().toISOString(),
  };
  writeSimulatorRuntimeState(simulatorUDID, next, { rootPath });
  return {
    ...stream,
    raw: {
      ...(stream?.raw && typeof stream.raw === "object" && !Array.isArray(stream.raw)
        ? stream.raw
        : {}),
      swiftSimLifecycleNonce: nonce,
    },
  };
}

function publishRuntimeFailure(simulatorUDID, status, error, {
  nonce = randomUUID(),
  previousNonce = "",
  rootPath,
} = {}) {
  writeSimulatorRuntimeState(simulatorUDID, {
    simulatorUDID,
    nonce,
    status,
    previousNonce,
    error: error instanceof Error ? error.message : String(error),
    updatedAt: new Date().toISOString(),
  }, { rootPath });
}

function writeSimulatorRuntimeState(simulatorUDID, state, { rootPath } = {}) {
  const path = simulatorRuntimeStatePath(simulatorUDID, { rootPath });
  validateRuntimeState(state, requiredSimulatorUDID(simulatorUDID));
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporaryPath, path);
  } catch (error) {
    try { rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

async function acquireLifecycleLock(lockPath, waitMs) {
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  while (true) {
    const release = tryAcquireLifecycleLock(lockPath);
    if (release) return release;
    if (Date.now() >= deadline) {
      const error = new Error("Timed out waiting for the Swift Sim Simulator lifecycle lock.");
      error.code = "SWIFT_SIM_SIMULATOR_LIFECYCLE_BUSY";
      throw error;
    }
    await sleep(25);
  }
}

function tryAcquireLifecycleLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const ownerPath = join(lockPath, "owner.json");
  const owner = {
    pid: process.pid,
    startedAt: processStartIdentity(),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
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
    let current;
    try { current = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
    if ((current && !lockOwnerIsAlive(current))
        || (!current && ownerlessLockIsStale(lockPath))) {
      rmSync(lockPath, { recursive: true, force: true });
    }
    return null;
  }
}

function sessionRuntimeNonce(session) {
  return String(session?.stream?.raw?.swiftSimLifecycleNonce || "").trim();
}

function runningRuntimeOwnsSession(current, session, expectedNonce) {
  if (!current || current.status !== "running") return false;
  if (expectedNonce) return current.nonce === expectedNonce;
  return legacyRuntimePIDMatchesSession(current, session);
}

function runtimeMayBeStoppedBySession(current, session, expectedNonce) {
  if (!current) return !expectedNonce;
  if (current.status === "running") {
    return runningRuntimeOwnsSession(current, session, expectedNonce);
  }
  if (["restarting", "failed-restart", "stopping", "failed-stop"].includes(current.status)) {
    if (expectedNonce) return current.previousNonce === expectedNonce;
    return legacyRuntimePIDMatchesSession(current, session);
  }
  if (current.status === "failed-start") return !expectedNonce;
  return false;
}

function legacyRuntimePIDMatchesSession(current, session) {
  const recordedPID = Number(current?.pid);
  const sessionPID = Number(session?.stream?.pid);
  return Number.isInteger(recordedPID)
    && recordedPID > 0
    && Number.isInteger(sessionPID)
    && sessionPID > 0
    && recordedPID === sessionPID;
}

function validateRuntimeState(value, simulatorUDID) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("the Simulator runtime record is not an object");
  }
  if (value.simulatorUDID !== simulatorUDID) {
    throw new Error("the Simulator runtime identity changed");
  }
  if (typeof value.nonce !== "string" || !value.nonce) {
    throw new Error("the Simulator runtime record has no nonce");
  }
  if (typeof value.status !== "string" || !value.status) {
    throw new Error("the Simulator runtime record has no status");
  }
  if (value.pid !== undefined && value.pid !== null
      && (!Number.isInteger(value.pid) || value.pid <= 0)) {
    throw new Error("the Simulator runtime record has an invalid pid");
  }
  for (const field of ["transport", "updatedAt", "previousNonce", "error"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(`the Simulator runtime record has an invalid ${field}`);
    }
  }
}

function normalizedPID(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function requiredSimulatorUDID(value) {
  const simulatorUDID = String(value || "").trim();
  if (!simulatorUDID) throw new Error("A Simulator UDID is required.");
  return simulatorUDID;
}

function requiredOperation(operation) {
  if (typeof operation !== "function") throw new Error("A Simulator lifecycle operation is required.");
  return operation;
}

function activeRuntimeError() {
  const error = new Error("A Swift Sim stream is already active for this Simulator.");
  error.code = "SWIFT_SIM_SIMULATOR_RUNTIME_ACTIVE";
  return error;
}

function uncertainRuntimeError() {
  const error = new Error("Swift Sim could not safely recover the previous Simulator lifecycle operation.");
  error.code = "SWIFT_SIM_SIMULATOR_RECOVERY_REQUIRED";
  return error;
}

function supersededRuntimeError() {
  const error = new Error("This Simulator stream was stopped or replaced before the operation could begin.");
  error.code = "SWIFT_SIM_SIMULATOR_STREAM_SUPERSEDED";
  return error;
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
  throw new Error("Unable to establish a process start identity for the Simulator lifecycle lock.");
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

function ownerlessLockIsStale(path) {
  try {
    return Date.now() - statSync(path).mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch {
    return false;
  }
}

function runtimeStateError(path, error) {
  const wrapped = new Error(
    `Swift Sim Simulator runtime state at ${path} could not be read safely: ${error instanceof Error ? error.message : String(error)}`,
  );
  wrapped.code = "SWIFT_SIM_SIMULATOR_RUNTIME_STATE_INVALID";
  return wrapped;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

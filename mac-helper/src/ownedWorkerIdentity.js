import { kernelProcessIdentity } from "./liveEngineOwnershipPreload.js";

const OWNED_WORKER_RECORD_VERSION = 2;

export function requiredOwnedWorkerProcessRecord(pid, command) {
  const value = Number(pid);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const identity = kernelProcessIdentity(value);
    if (identity && identity.processGroup === value) {
      return {
        version: OWNED_WORKER_RECORD_VERSION,
        pid: value,
        processGroup: identity.processGroup,
        startToken: identity.startToken,
        executable: identity.executable,
        command: String(command || ""),
        createdAt: new Date().toISOString(),
      };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish the active build worker process identity.");
}

export function completeOwnedWorkerProcessRecord(record) {
  const pid = Number(record?.pid);
  const processGroup = Number(record?.processGroup);
  return Boolean(
    Number(record?.version) >= OWNED_WORKER_RECORD_VERSION
    && Number.isInteger(pid)
    && pid > 1
    && processGroup === pid
    && typeof record?.startToken === "string"
    && record.startToken
    && typeof record?.executable === "string"
    && record.executable
    && typeof record?.command === "string"
    && record.command
  );
}

export function ownedWorkerProcessState(record, options = {}) {
  if (!completeOwnedWorkerProcessRecord(record)) return "invalid";
  const pid = Number(record.pid);
  const alive = Object.prototype.hasOwnProperty.call(options, "alive")
    ? Boolean(options.alive)
    : processIsAlive(pid);
  if (!alive) return "dead";
  const identity = Object.prototype.hasOwnProperty.call(options, "identity")
    ? options.identity
    : kernelProcessIdentity(pid);
  if (!identity) return "unverifiable";
  return identity.processGroup === Number(record.processGroup)
    && identity.startToken === record.startToken
    && identity.executable === record.executable
    ? "current"
    : "replaced";
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

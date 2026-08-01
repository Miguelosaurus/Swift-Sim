import { randomUUID } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const fs = require("node:fs");
const originalSpawn = childProcess.spawn;
const originalSpawnSync = childProcess.spawnSync;
const originalReadFileSync = fs.readFileSync;
const originalWriteFileSync = fs.writeFileSync;
const originalRenameSync = fs.renameSync;
const originalRmSync = fs.rmSync;
const originalKill = process.kill.bind(process);
const DEFAULT_ENGINE_EXECUTABLE = join(
  homedir(),
  ".swift-sim",
  "engine",
  "InjectionNext.app",
  "Contents",
  "MacOS",
  "InjectionNext",
);
const DEFAULT_ENGINE_PID_PATH = join(homedir(), ".swift-sim", "engine", "engine.pid");
const AUTHORIZATION_WINDOW_MS = 2_000;
let installed = false;
let configuredExecutable = DEFAULT_ENGINE_EXECUTABLE;
let configuredPIDPath = DEFAULT_ENGINE_PID_PATH;
const pendingRecords = new Map();
const authorizedStops = new Map();

export function installLiveEngineOwnershipBoundary({
  engineExecutable = DEFAULT_ENGINE_EXECUTABLE,
  pidPath = DEFAULT_ENGINE_PID_PATH,
} = {}) {
  configuredExecutable = resolve(String(engineExecutable));
  configuredPIDPath = resolve(String(pidPath));
  if (installed) return;
  installed = true;

  childProcess.spawn = function guardedSpawn(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    const child = originalSpawn.call(this, command, normalized.args, normalized.options);
    if (resolveCommand(command) !== configuredExecutable || normalized.options.detached !== true) {
      return child;
    }

    // A failed spawn otherwise emits an unhandled `error` because the legacy
    // live-reload caller publishes the PID synchronously. The guarded PID write
    // below turns that condition into a normal synchronous failure.
    child.once("error", () => {});
    const pid = Number(child.pid);
    if (!Number.isInteger(pid) || pid <= 1) return child;

    const startedAt = requiredProcessStartedAt(pid);
    if (!startedAt) {
      terminateExactProcessGroup(pid, "");
      const error = new Error("Swift Sim could not establish ownership of the live engine process.");
      error.code = "SWIFT_SIM_LIVE_ENGINE_IDENTITY_UNAVAILABLE";
      throw error;
    }
    pendingRecords.set(pid, {
      version: 1,
      pid,
      processGroup: pid,
      startedAt,
      executable: configuredExecutable,
      nonce: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    return child;
  };

  fs.writeFileSync = function guardedWriteFileSync(path, data, options) {
    if (!samePath(path, configuredPIDPath)) {
      return originalWriteFileSync.call(this, path, data, options);
    }
    const pid = Number(String(data).trim());
    const record = pendingRecords.get(pid);
    if (!record || !liveEngineProcessRecordIsCurrent(record, {
      engineExecutable: configuredExecutable,
    })) {
      if (Number.isInteger(pid) && pid > 1) terminateExactProcessGroup(pid, record?.startedAt || "");
      const error = new Error("Swift Sim refused to publish an unowned live engine PID.");
      error.code = "SWIFT_SIM_LIVE_ENGINE_IDENTITY_INVALID";
      throw error;
    }
    pendingRecords.delete(pid);
    atomicWriteProcessRecord(configuredPIDPath, record);
    return undefined;
  };

  fs.readFileSync = function guardedReadFileSync(path, options) {
    if (!samePath(path, configuredPIDPath)) {
      return originalReadFileSync.call(this, path, options);
    }
    const raw = originalReadFileSync.call(this, path, "utf8");
    const record = parseLiveEngineProcessRecord(raw, {
      engineExecutable: configuredExecutable,
    });
    if (!record || !liveEngineProcessRecordIsCurrent(record, {
      engineExecutable: configuredExecutable,
      verifyLegacyCommand: record.legacy === true,
    })) {
      return encodedReadResult("", options);
    }
    authorizedStops.set(record.pid, {
      ...record,
      expiresAt: Date.now() + AUTHORIZATION_WINDOW_MS,
    });
    return encodedReadResult(`${record.pid}\n`, options);
  };

  process.kill = function guardedProcessKill(pid, signal) {
    const value = Number(pid);
    const authorization = signal === "SIGTERM" ? authorizedStops.get(value) : null;
    if (!authorization) return originalKill(pid, signal);
    authorizedStops.delete(value);
    if (authorization.expiresAt < Date.now()
        || !liveEngineProcessRecordIsCurrent(authorization, {
          engineExecutable: configuredExecutable,
          verifyLegacyCommand: authorization.legacy === true,
        })) {
      const error = new Error("Swift Sim refused to stop a process whose live-engine identity changed.");
      error.code = "ESRCH";
      throw error;
    }
    // The engine is deliberately detached. Stop its entire process group in
    // one identity-checked operation so descendants cannot survive and there
    // is no delayed PGID-reuse window.
    terminateExactProcessGroup(value, authorization.startedAt);
    return true;
  };

  syncBuiltinESMExports();
}

export function parseLiveEngineProcessRecord(raw, {
  engineExecutable = DEFAULT_ENGINE_EXECUTABLE,
} = {}) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const pid = Number(text);
    if (!Number.isInteger(pid) || pid <= 1) return null;
    return {
      version: 0,
      legacy: true,
      pid,
      processGroup: pid,
      startedAt: processStartedAt(pid),
      executable: resolve(String(engineExecutable)),
    };
  }
  try {
    const record = JSON.parse(text);
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    return record;
  } catch {
    return null;
  }
}

export function liveEngineProcessRecordIsCurrent(record, {
  engineExecutable = DEFAULT_ENGINE_EXECUTABLE,
  verifyLegacyCommand = false,
  startedAt = processStartedAt(record?.pid),
  command = verifyLegacyCommand ? processCommand(record?.pid) : "",
} = {}) {
  const pid = Number(record?.pid);
  const processGroup = Number(record?.processGroup);
  const expectedExecutable = resolve(String(engineExecutable));
  if (!Number.isInteger(pid) || pid <= 1
      || processGroup !== pid
      || typeof record?.startedAt !== "string"
      || !record.startedAt
      || record.startedAt !== startedAt
      || resolve(String(record?.executable || "")) !== expectedExecutable) {
    return false;
  }
  return !verifyLegacyCommand || commandLineMatchesExecutable(command, expectedExecutable);
}

export function readPublishedLiveEngineRecord(path = configuredPIDPath) {
  return parseLiveEngineProcessRecord(originalReadFileSync(resolve(String(path)), "utf8"), {
    engineExecutable: configuredExecutable,
  });
}

function atomicWriteProcessRecord(path, record) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    originalWriteFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    originalRenameSync(temporaryPath, path);
  } catch (error) {
    try { originalRmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

function terminateExactProcessGroup(pid, startedAt) {
  if (startedAt && processStartedAt(pid) !== startedAt) {
    const error = new Error("The live engine process identity changed before termination.");
    error.code = "ESRCH";
    throw error;
  }
  try {
    originalKill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH" || (startedAt && processStartedAt(pid) !== startedAt)) throw error;
    originalKill(pid, "SIGKILL");
  }
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = processStartedAt(pid);
    if (value) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return "";
}

function processStartedAt(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 1) return "";
  const result = originalSpawnSync("/bin/ps", ["-p", String(value), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processCommand(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 1) return "";
  const result = originalSpawnSync("/bin/ps", ["-ww", "-p", String(value), "-o", "command="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function commandLineMatchesExecutable(command, executable) {
  const value = String(command || "").trim();
  return value === executable
    || value.startsWith(`${executable} `)
    || value.startsWith(`"${executable}" `)
    || value.startsWith(`'${executable}' `);
}

function encodedReadResult(value, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  return encoding ? value : Buffer.from(value);
}

function normalizeInvocation(args, options) {
  if (Array.isArray(args)) return { args, options: options || {} };
  return { args: [], options: args || {} };
}

function resolveCommand(command) {
  const value = String(command || "");
  return value.startsWith("/") ? resolve(value) : value;
}

function samePath(left, right) {
  try {
    return resolve(String(left)) === resolve(String(right));
  } catch {
    return false;
  }
}

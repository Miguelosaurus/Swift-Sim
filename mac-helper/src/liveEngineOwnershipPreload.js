import { randomUUID } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const fs = require("node:fs");
const originalSpawn = childProcess.spawn;
const originalSpawnSync = childProcess.spawnSync;
const originalReadFileSync = fs.readFileSync;
const originalWriteFileSync = fs.writeFileSync;
const originalRenameSync = fs.renameSync;
const originalRmSync = fs.rmSync;
const originalMkdtempSync = fs.mkdtempSync;
const originalChmodSync = fs.chmodSync;
const originalReadlinkSync = fs.readlinkSync;
const originalRealpathSync = fs.realpathSync;
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
const ENGINE_INSTANCE_ENV = "SWIFT_SIM_ENGINE_INSTANCE_NONCE";
const IDENTITY_HELPER_SOURCE = fileURLToPath(new URL("./liveEngineIdentity.c", import.meta.url));
let installed = false;
let configuredExecutable = canonicalPath(DEFAULT_ENGINE_EXECUTABLE);
let configuredPIDPath = DEFAULT_ENGINE_PID_PATH;
let identityHelperDirectory = "";
let identityHelperPath = "";
const pendingRecords = new Map();
const authorizedStops = new Map();

export function installLiveEngineOwnershipBoundary({
  engineExecutable = DEFAULT_ENGINE_EXECUTABLE,
  pidPath = DEFAULT_ENGINE_PID_PATH,
} = {}) {
  configuredExecutable = canonicalPath(engineExecutable);
  configuredPIDPath = resolve(String(pidPath));
  if (installed) return;
  installed = true;

  childProcess.spawn = function guardedSpawn(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    const engineSpawn = canonicalPath(resolveCommand(command)) === configuredExecutable
      && normalized.options.detached === true;
    const instanceNonce = engineSpawn ? randomUUID() : "";
    if (engineSpawn) {
      normalized.options = {
        ...normalized.options,
        env: {
          ...process.env,
          ...(normalized.options.env || {}),
          [ENGINE_INSTANCE_ENV]: instanceNonce,
        },
      };
    }
    const child = originalSpawn.call(this, command, normalized.args, normalized.options);
    if (!engineSpawn) return child;

    // A failed spawn otherwise emits an unhandled `error` because the legacy
    // live-reload caller publishes the PID synchronously. The guarded PID write
    // below turns that condition into a normal synchronous failure.
    child.once("error", () => {});
    const pid = Number(child.pid);
    if (!Number.isInteger(pid) || pid <= 1) return child;

    const identity = requiredProcessIdentity(pid);
    if (!identity || identity.processGroup !== pid
        || identity.executable !== configuredExecutable
        || identity.instanceNonce !== instanceNonce) {
      terminateSpawnedProcessGroup(pid);
      const error = new Error("Swift Sim could not establish ownership of the live engine process.");
      error.code = "SWIFT_SIM_LIVE_ENGINE_IDENTITY_UNAVAILABLE";
      throw error;
    }
    pendingRecords.set(pid, {
      version: 2,
      pid,
      processGroup: pid,
      startToken: identity.startToken,
      executable: identity.executable,
      instanceNonce,
      recordNonce: randomUUID(),
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
        })) {
      const error = new Error("Swift Sim refused to stop a process whose live-engine identity changed.");
      error.code = "ESRCH";
      throw error;
    }
    // The engine is deliberately detached. Stop its entire process group in
    // one identity-checked operation so descendants cannot survive and there
    // is no delayed PGID-reuse window.
    terminateExactProcessGroup(authorization);
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
    // A numeric legacy record contains no collision-resistant ownership token.
    // Fail closed instead of authorizing a signal against a potentially reused PID.
    return null;
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
  identity = processIdentity(record?.pid),
} = {}) {
  const pid = Number(record?.pid);
  const processGroup = Number(record?.processGroup);
  const expectedExecutable = canonicalPath(engineExecutable);
  return Boolean(
    Number(record?.version) >= 2
    && Number.isInteger(pid)
    && pid > 1
    && processGroup === pid
    && typeof record?.startToken === "string"
    && record.startToken
    && typeof record?.instanceNonce === "string"
    && record.instanceNonce
    && canonicalPath(record?.executable || "") === expectedExecutable
    && identity
    && identity.processGroup === pid
    && identity.startToken === record.startToken
    && identity.executable === expectedExecutable
    && identity.instanceNonce === record.instanceNonce
  );
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

function terminateExactProcessGroup(record) {
  if (!liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: configuredExecutable,
  })) {
    const error = new Error("The live engine process identity changed before termination.");
    error.code = "ESRCH";
    throw error;
  }
  const pid = Number(record.pid);
  try {
    originalKill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH" || !liveEngineProcessRecordIsCurrent(record, {
      engineExecutable: configuredExecutable,
    })) throw error;
    originalKill(pid, "SIGKILL");
  }
}

function terminateSpawnedProcessGroup(pid) {
  try { originalKill(-Number(pid), "SIGKILL"); } catch {
    try { originalKill(Number(pid), "SIGKILL"); } catch {}
  }
}

function requiredProcessIdentity(pid) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = processIdentity(pid);
    if (value) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return null;
}

function processIdentity(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 1) return null;
  if (process.platform === "darwin") return darwinProcessIdentity(value);
  if (process.platform === "linux") return linuxProcessIdentity(value);
  return null;
}

function darwinProcessIdentity(pid) {
  const helper = identityHelperExecutable();
  if (!helper) return null;
  const result = originalSpawnSync(helper, [String(pid)], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const [rawStartToken, rawProcessGroup, rawExecutable] = String(result.stdout || "").split(/\r?\n/);
  const processGroup = Number(rawProcessGroup);
  const executable = canonicalPath(rawExecutable || "");
  const instanceNonce = processInstanceNonceFromPS(pid);
  if (!rawStartToken || !Number.isInteger(processGroup) || processGroup <= 1
      || !executable || !instanceNonce) return null;
  return {
    startToken: `darwin:${rawStartToken}`,
    processGroup,
    executable,
    instanceNonce,
  };
}

function linuxProcessIdentity(pid) {
  try {
    const stat = String(originalReadFileSync(`/proc/${pid}/stat`, "utf8"));
    const closing = stat.lastIndexOf(")");
    if (closing < 0) return null;
    const fields = stat.slice(closing + 2).trim().split(/\s+/);
    const processGroup = Number(fields[2]);
    const startTicks = fields[19] || "";
    const executable = canonicalPath(originalReadlinkSync(`/proc/${pid}/exe`));
    const environment = originalReadFileSync(`/proc/${pid}/environ`);
    const instanceNonce = environmentNonce(String(environment).replaceAll("\0", " "));
    if (!startTicks || !Number.isInteger(processGroup) || processGroup <= 1
        || !executable || !instanceNonce) return null;
    return {
      startToken: `linux:${startTicks}`,
      processGroup,
      executable,
      instanceNonce,
    };
  } catch {
    return null;
  }
}

function identityHelperExecutable() {
  if (identityHelperPath) return identityHelperPath;
  try {
    identityHelperDirectory = originalMkdtempSync(join(tmpdir(), "swift-sim-process-identity-"));
    const output = join(identityHelperDirectory, "live-engine-identity");
    const compile = originalSpawnSync("/usr/bin/xcrun", [
      "clang",
      "-Os",
      "-Wall",
      "-Wextra",
      "-Werror",
      IDENTITY_HELPER_SOURCE,
      "-lproc",
      "-o",
      output,
    ], {
      encoding: "utf8",
      timeout: 30_000,
    });
    if (compile.status !== 0) {
      try { originalRmSync(identityHelperDirectory, { recursive: true, force: true }); } catch {}
      identityHelperDirectory = "";
      return "";
    }
    originalChmodSync(output, 0o700);
    identityHelperPath = output;
    process.once("exit", () => {
      try { originalRmSync(identityHelperDirectory, { recursive: true, force: true }); } catch {}
    });
    return identityHelperPath;
  } catch {
    return "";
  }
}

function processInstanceNonceFromPS(pid) {
  const result = originalSpawnSync("/bin/ps", ["eww", "-p", String(pid), "-o", "command="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? environmentNonce(result.stdout) : "";
}

function environmentNonce(value) {
  return String(value || "").match(
    new RegExp(`(?:^|\\s)${ENGINE_INSTANCE_ENV}=([0-9a-f-]{36})(?:\\s|$)`, "i"),
  )?.[1] || "";
}

function canonicalPath(path) {
  const value = String(path || "");
  if (!value) return "";
  try {
    return resolve(originalRealpathSync.native ? originalRealpathSync.native(value) : originalRealpathSync(value));
  } catch {
    return resolve(value);
  }
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

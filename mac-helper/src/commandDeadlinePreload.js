import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const originalExecFileSync = childProcess.execFileSync;
const originalSpawnSync = childProcess.spawnSync;
const DEFAULT_FALLBACK_DEADLINE_MS = 15 * 60_000;
let installed = false;

export function installCommandDeadlinePreload() {
  if (installed) return;
  installed = true;
  childProcess.spawnSync = function boundedSpawnSync(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    const timeout = commandDeadline(command, normalized.args, normalized.options);
    const bounded = boundedCommandOptions(normalized.options, timeout);
    const result = originalSpawnSync.call(this, command, normalized.args, bounded.options);
    if (bounded.processGrouped && result?.error) terminateProcessGroup(result.pid);
    return result;
  };
  childProcess.execFileSync = function boundedExecFileSync(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    const timeout = commandDeadline(command, normalized.args, normalized.options);
    const bounded = boundedCommandOptions(normalized.options, timeout);
    try {
      return originalExecFileSync.call(this, command, normalized.args, bounded.options);
    } catch (error) {
      if (bounded.processGrouped) terminateProcessGroup(error?.pid);
      throw error;
    }
  };
  syncBuiltinESMExports();
}

export function commandDeadline(command, args = [], options = {}) {
  if (hasExplicitTimeout(options)) return Number(options.timeout);
  const override = positiveMilliseconds(process.env.SWIFT_SIM_SYNC_COMMAND_TIMEOUT_MS);
  if (override) return override;

  const executable = basename(String(command || ""));
  const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
  if (nodeExecutable(executable) && swiftSimHelperScript(normalizedArgs[0])) {
    if (normalizedArgs[1] === "serve") return 0;
    if (normalizedArgs[1] === "build-device") return 60 * 60_000;
    return 5 * 60_000;
  }
  if (executable === "brew") {
    if (normalizedArgs[0] === "upgrade") return 15 * 60_000;
    if (normalizedArgs[0] === "services") return 2 * 60_000;
    return 5 * 60_000;
  }
  if (["which", "ps", "lsof"].includes(executable)) return 5_000;
  if (executable === "xcodebuild" && normalizedArgs.includes("-version")) return 30_000;
  if (["xcrun", "plutil", "security", "cloudflared"].includes(executable)) return 60_000;
  if (["codex", "claude", "opencode", "cursor", "agent"].includes(executable)) return 2 * 60_000;
  if (/^swift-sim(?:-helper)?$/.test(executable)) return 5 * 60_000;
  return DEFAULT_FALLBACK_DEADLINE_MS;
}

installCommandDeadlinePreload();

function boundedCommandOptions(options, timeout) {
  if (!(timeout > 0)) return { options, processGrouped: false };
  const processGrouped = options.detached !== false;
  return {
    processGrouped,
    options: {
      ...options,
      detached: processGrouped,
      timeout,
      killSignal: options.killSignal || "SIGKILL",
    },
  };
}

function terminateProcessGroup(pid) {
  const numericPID = Number(pid);
  if (!Number.isInteger(numericPID) || numericPID <= 0) return;
  try { process.kill(-numericPID, "SIGKILL"); } catch {}
  const deadline = Date.now() + 1_000;
  while (processGroupIsAlive(numericPID) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

function processGroupIsAlive(pid) {
  try {
    process.kill(-Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function nodeExecutable(value) {
  return /^node(?:[.-]\d+)*$/.test(String(value || ""));
}

function swiftSimHelperScript(value) {
  return /(?:^|\/)swift-sim-helper(?:-entry)?\.js$/.test(String(value || ""));
}

function normalizeInvocation(args, options) {
  if (Array.isArray(args)) return { args, options: options || {} };
  return { args: [], options: args || {} };
}

function hasExplicitTimeout(options) {
  const timeout = Number(options?.timeout);
  return Number.isFinite(timeout) && timeout > 0;
}

function positiveMilliseconds(value) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? Math.floor(milliseconds)
    : 0;
}

import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const originalSpawnSync = childProcess.spawnSync;
let installed = false;

export function installCommandDeadlinePreload() {
  if (installed) return;
  installed = true;
  childProcess.spawnSync = function boundedSpawnSync(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    const timeout = commandDeadline(command, normalized.args, normalized.options);
    return originalSpawnSync.call(
      this,
      command,
      normalized.args,
      timeout > 0 && !hasExplicitTimeout(normalized.options)
        ? { ...normalized.options, timeout, killSignal: normalized.options.killSignal || "SIGKILL" }
        : normalized.options,
    );
  };
  syncBuiltinESMExports();
}

export function commandDeadline(command, args = [], options = {}) {
  if (hasExplicitTimeout(options)) return Number(options.timeout);
  const override = positiveMilliseconds(process.env.SWIFT_SIM_SYNC_COMMAND_TIMEOUT_MS);
  if (override) return override;

  const executable = basename(String(command || ""));
  const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
  if (executable === "brew") {
    if (normalizedArgs[0] === "upgrade") return 15 * 60_000;
    if (normalizedArgs[0] === "services") return 2 * 60_000;
    return 5 * 60_000;
  }
  if (["which", "ps", "lsof"].includes(executable)) return 5_000;
  if (executable === "xcodebuild" && normalizedArgs.includes("-version")) return 30_000;
  if (executable === "security") return 30_000;
  if (["codex", "claude", "opencode", "cursor", "agent"].includes(executable)) return 2 * 60_000;
  if (/^swift-sim(?:-helper)?$/.test(executable)) return 5 * 60_000;
  return 0;
}

installCommandDeadlinePreload();

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

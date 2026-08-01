import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const originalSpawn = childProcess.spawn;
const DEFAULT_FORCE_KILL_DELAY_MS = 250;
const managedCommands = new Set(["tailscale"]);
let installed = false;

export function installAsyncCommandGroupCleanup({
  forceKillDelayMs = configuredForceKillDelay(),
} = {}) {
  if (installed) return;
  installed = true;
  const forceDelayMs = nonnegativeMilliseconds(forceKillDelayMs, DEFAULT_FORCE_KILL_DELAY_MS);

  childProcess.spawn = function guardedAsyncSpawn(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    if (!managedAsyncCommand(command)) {
      return originalSpawn.call(this, command, normalized.args, normalized.options);
    }

    const child = originalSpawn.call(this, command, normalized.args, {
      ...normalized.options,
      detached: true,
    });
    const originalKill = child.kill.bind(child);
    let forceTimer = null;
    let cleanupRequested = false;

    child.kill = function killManagedCommand(signal = "SIGTERM") {
      const normalizedSignal = signal || "SIGTERM";
      cleanupRequested = true;
      const signalled = signalProcessGroup(child.pid, normalizedSignal, originalKill);
      if (normalizedSignal !== "SIGKILL" && !forceTimer) {
        forceTimer = setTimeout(() => {
          forceTimer = null;
          signalProcessGroup(child.pid, "SIGKILL", originalKill);
        }, forceDelayMs);
        forceTimer.unref?.();
      }
      return signalled;
    };

    child.once("error", () => {
      if (cleanupRequested && !forceTimer) {
        signalProcessGroup(child.pid, "SIGKILL", originalKill);
      }
    });
    return child;
  };
  syncBuiltinESMExports();
}

export function managedAsyncCommand(command) {
  const explicit = String(process.env.SWIFT_SIM_ASYNC_GROUP_COMMANDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return managedCommands.has(basename(String(command || "")))
    || explicit.includes(basename(String(command || "")));
}

installAsyncCommandGroupCleanup();

function signalProcessGroup(pid, signal, fallbackKill) {
  const numericPID = Number(pid);
  if (!Number.isInteger(numericPID) || numericPID <= 0) {
    try { return fallbackKill(signal); } catch { return false; }
  }
  try {
    process.kill(-numericPID, signal);
    return true;
  } catch {
    try { return fallbackKill(signal); } catch { return false; }
  }
}

function normalizeInvocation(args, options) {
  if (Array.isArray(args)) return { args, options: options || {} };
  return { args: [], options: args || {} };
}

function configuredForceKillDelay() {
  return nonnegativeMilliseconds(
    process.env.SWIFT_SIM_ASYNC_FORCE_KILL_DELAY_MS,
    DEFAULT_FORCE_KILL_DELAY_MS,
  );
}

function nonnegativeMilliseconds(value, fallback) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? Math.floor(milliseconds)
    : fallback;
}

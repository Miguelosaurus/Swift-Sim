import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const originalSpawn = childProcess.spawn;
const managedCommands = new Set(["tailscale"]);
let installed = false;

export function installAsyncCommandGroupCleanup() {
  if (installed) return;
  installed = true;

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

    child.kill = function killManagedCommand(signal = "SIGTERM") {
      if (signal === 0) {
        try { return originalKill(0); } catch { return false; }
      }
      // Managed commands are short-lived, read-only Tailscale probes. When a
      // probe times out, kill the complete process group immediately instead
      // of arming a delayed signal that could target a recycled PGID.
      return signalProcessGroup(child.pid, "SIGKILL", originalKill);
    };
    return child;
  };
  syncBuiltinESMExports();
}

export function managedAsyncCommand(command) {
  return managedCommands.has(basename(String(command || "")));
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

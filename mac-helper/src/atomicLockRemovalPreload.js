import { randomUUID } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const originalRenameSync = fs.renameSync;
const originalRmSync = fs.rmSync;
let installed = false;

export function installAtomicLockRemoval() {
  if (installed) return;
  installed = true;
  fs.rmSync = function atomicLockRmSync(path, options) {
    if (options?.recursive !== true || !looksLikeLockDirectory(path)) {
      return originalRmSync.call(this, path, options);
    }

    const target = String(path);
    const quarantine = join(
      dirname(target),
      `.${basename(target)}.swift-sim-reclaimed-${process.pid}-${randomUUID()}`,
    );
    try {
      originalRenameSync.call(fs, target, quarantine);
    } catch (error) {
      if (error?.code === "ENOENT" && options?.force) return undefined;
      throw error;
    }

    pauseAfterQuarantineForTest();
    return originalRmSync.call(fs, quarantine, options);
  };
  syncBuiltinESMExports();
}

installAtomicLockRemoval();

function looksLikeLockDirectory(path) {
  const value = String(path || "");
  return value.endsWith(".lock") || value.endsWith("lifecycle.lock");
}

function pauseAfterQuarantineForTest() {
  const milliseconds = Number(process.env.SWIFT_SIM_LOCK_RECLAIM_PAUSE_MS || 0);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    Math.min(5_000, Math.floor(milliseconds)),
  );
}

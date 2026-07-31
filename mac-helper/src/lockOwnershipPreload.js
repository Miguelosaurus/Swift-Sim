import { createRequire, syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const originalRmSync = fs.rmSync;
let installed = false;

export function installLockOwnershipGuard() {
  if (installed) return;
  installed = true;
  fs.rmSync = function guardedRmSync(path, options) {
    if (options?.recursive === true && looksLikeLockDirectory(path)) {
      const owner = readOwner(path);
      if (owner && ownerBelongsToAnotherLiveProcess(owner)) return;
    }
    return originalRmSync.call(this, path, options);
  };
  syncBuiltinESMExports();
}

export function ownerBelongsToAnotherLiveProcess(owner) {
  const pid = Number(owner?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  if (!processIsAlive(pid)) return false;
  if (!owner?.startedAt) {
    const createdAt = Date.parse(owner?.createdAt || "");
    return Number.isFinite(createdAt) && Date.now() - createdAt < 30_000;
  }
  return processStartedAt(pid) === owner.startedAt;
}

installLockOwnershipGuard();

function looksLikeLockDirectory(path) {
  const value = String(path || "");
  return value.endsWith(".lock") || value.endsWith("lifecycle.lock");
}

function readOwner(path) {
  try {
    return JSON.parse(fs.readFileSync(join(String(path), "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

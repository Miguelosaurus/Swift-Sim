import { randomUUID } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import {
  isProcessScopedRenewalCancellationPath,
  renewalCancellationFilePrefix,
  renewalCancellationPath,
} from "./renewalCancellation.js";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const originalCloseSync = fs.closeSync;
const originalExistsSync = fs.existsSync;
const originalFsyncSync = fs.fsyncSync;
const originalOpenSync = fs.openSync;
const originalReaddirSync = fs.readdirSync;
const originalRenameSync = fs.renameSync;
const originalRmSync = fs.rmSync;
const originalStatSync = fs.statSync;
const originalWriteFileSync = fs.writeFileSync;
const RECLAIM_FILE = ".swift-sim-reclaim.json";
const LEGACY_OWNER_GRACE_MS = 30_000;
let installed = false;

export function installLockOwnershipGuard() {
  if (installed) return;
  installed = true;
  fs.existsSync = function guardedExistsSync(path) {
    let candidate = path;
    let exists = originalExistsSync.call(this, candidate);
    if (!exists && looksLikeBaseCancellationMarker(path)) {
      cleanupStaleRenewalMarkers(path);
      candidate = renewalCancellationPath(path);
      exists = originalExistsSync.call(this, candidate);
    }
    if (!exists) return false;
    if (looksLikeCancellationMarker(candidate)) {
      const marker = readJSON(candidate);
      if (renewalMarkerIsStale(candidate, marker)) {
        try { originalRmSync.call(fs, candidate, { force: true }); } catch {}
        return false;
      }
    }
    return true;
  };
  fs.writeFileSync = function guardedWriteFileSync(path, data, options) {
    if (looksLikeLockOwnerFile(path)) {
      return writeLockOwner(path, data, options);
    }
    if (looksLikeDurableFence(path)) {
      return writeFileAtomically(path, data, options);
    }
    return originalWriteFileSync.call(this, path, data, options);
  };
  fs.rmSync = function guardedRmSync(path, options) {
    if (options?.recursive === true && looksLikeLockDirectory(path)) {
      const owner = readOwner(path);
      if (owner && ownerBelongsToAnotherLiveProcess(owner)) return;
      if (!ownerBelongsToCurrentProcess(owner) && !claimLockRemoval(path, owner)) return;
    }
    return originalRmSync.call(this, path, options);
  };
  fs.renameSync = function durableRenameSync(source, destination) {
    syncRegularFile(source);
    const result = originalRenameSync.call(this, source, destination);
    syncDirectory(dirname(String(destination)));
    return result;
  };
  syncBuiltinESMExports();
}

export function ownerBelongsToAnotherLiveProcess(owner) {
  return lockOwnerIsAlive(owner) && !ownerBelongsToCurrentProcess(owner);
}

export function renewalCancellationBelongsToDeadProcess(marker) {
  if (marker?.scope !== "renewal") return false;
  const owner = marker.owner || {};
  const pid = Number(owner.pid);
  if (!Number.isInteger(pid) || pid <= 0) return markerIsOlderThan(marker, LEGACY_OWNER_GRACE_MS);
  if (!processIsAlive(pid)) return true;
  if (owner.startedAt) {
    const observed = processStartedAt(pid);
    return Boolean(observed) && observed !== owner.startedAt;
  }
  return markerIsOlderThan(marker, LEGACY_OWNER_GRACE_MS);
}

installLockOwnershipGuard();

function looksLikeLockDirectory(path) {
  const value = String(path || "");
  return value.endsWith(".lock") || value.endsWith("lifecycle.lock");
}

function looksLikeLockOwnerFile(path) {
  const value = String(path || "");
  return basename(value) === "owner.json" && looksLikeLockDirectory(dirname(value));
}

function looksLikeCancellationMarker(path) {
  return String(path || "").endsWith(".cancelled");
}

function looksLikeBaseCancellationMarker(path) {
  return looksLikeCancellationMarker(path)
    && !isProcessScopedRenewalCancellationPath(path);
}

function looksLikeDurableFence(path) {
  const value = String(path || "");
  return looksLikeCancellationMarker(value) || value.endsWith(".worker.json");
}

function readOwner(path) {
  return readJSON(join(String(path), "owner.json"));
}

function readReclaim(path) {
  return readJSON(join(String(path), RECLAIM_FILE));
}

function readJSON(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeLockOwner(path, data, options) {
  const lockPath = dirname(String(path));
  const before = readReclaim(lockPath);
  if (before && ownerBelongsToAnotherLiveProcess(before)) throw busyLockError();
  const result = originalWriteFileSync.call(fs, path, data, options);
  const after = readReclaim(lockPath);
  if (after && ownerBelongsToAnotherLiveProcess(after)) {
    try { originalRmSync.call(fs, path, { force: true }); } catch {}
    throw busyLockError();
  }
  return result;
}

function claimLockRemoval(path, observedOwner) {
  const lockPath = String(path);
  const claimPath = join(lockPath, RECLAIM_FILE);
  const claim = {
    pid: process.pid,
    startedAt: processStartedAt(process.pid),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      originalWriteFileSync.call(fs, claimPath, JSON.stringify(claim), {
        mode: 0o600,
        flag: "wx",
      });
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") return false;
      const existing = readReclaim(lockPath);
      if (existing && ownerBelongsToAnotherLiveProcess(existing)) return false;
      try { originalRmSync.call(fs, claimPath, { force: true }); } catch { return false; }
      if (attempt === 1) return false;
    }
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  const currentOwner = readOwner(lockPath);
  if (!sameOwner(currentOwner, observedOwner) || lockOwnerIsAlive(currentOwner)) {
    removeOwnedClaim(claimPath, claim);
    return false;
  }
  return true;
}

function removeOwnedClaim(path, claim) {
  const current = readJSON(path);
  if (current?.pid !== claim.pid || current?.nonce !== claim.nonce) return;
  try { originalRmSync.call(fs, path, { force: true }); } catch {}
}

function sameOwner(first, second) {
  if (!first && !second) return true;
  if (!first || !second) return false;
  return Number(first.pid) === Number(second.pid)
    && String(first.startedAt || "") === String(second.startedAt || "")
    && String(first.nonce || "") === String(second.nonce || "")
    && String(first.createdAt || "") === String(second.createdAt || "");
}

function lockOwnerIsAlive(owner) {
  const pid = Number(owner?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || !processIsAlive(pid)) return false;
  if (!owner?.startedAt) {
    const createdAt = Date.parse(owner?.createdAt || "");
    return Number.isFinite(createdAt) && Date.now() - createdAt < LEGACY_OWNER_GRACE_MS;
  }
  return processStartedAt(pid) === owner.startedAt;
}

function ownerBelongsToCurrentProcess(owner) {
  if (!owner || Number(owner.pid) !== process.pid) return false;
  return !owner.startedAt || processStartedAt(process.pid) === owner.startedAt;
}

function renewalMarkerIsStale(path, marker) {
  if (marker?.scope === "renewal") return renewalCancellationBelongsToDeadProcess(marker);
  return isProcessScopedRenewalCancellationPath(path)
    && fileIsOlderThan(path, LEGACY_OWNER_GRACE_MS);
}

function cleanupStaleRenewalMarkers(cancelPath) {
  const prefix = basename(renewalCancellationFilePrefix(cancelPath));
  const directory = dirname(String(cancelPath));
  let names;
  try { names = originalReaddirSync.call(fs, directory); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".cancelled")) continue;
    const path = join(directory, name);
    if (!renewalMarkerIsStale(path, readJSON(path))) continue;
    try { originalRmSync.call(fs, path, { force: true }); } catch {}
  }
}

function writeFileAtomically(path, data, options) {
  const target = String(path);
  if (exclusiveWriteRequested(options) && originalExistsSync.call(fs, target)) {
    const error = new Error(`EEXIST: file already exists, open '${target}'`);
    error.code = "EEXIST";
    throw error;
  }
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    originalWriteFileSync.call(fs, temporary, data, atomicWriteOptions(options));
    syncRegularFile(temporary, true);
    originalRenameSync.call(fs, temporary, target);
    syncDirectory(dirname(target));
  } catch (error) {
    try { originalRmSync.call(fs, temporary, { force: true }); } catch {}
    throw error;
  }
}

function atomicWriteOptions(options) {
  if (typeof options === "string") {
    return { encoding: options, flag: "wx", mode: 0o600 };
  }
  return {
    ...(options && typeof options === "object" ? options : {}),
    flag: "wx",
    mode: options?.mode ?? 0o600,
  };
}

function exclusiveWriteRequested(options) {
  const flag = typeof options === "object" ? String(options?.flag || "") : "";
  return flag.includes("x");
}

function syncRegularFile(path, required = false) {
  let descriptor;
  try {
    if (!originalStatSync.call(fs, path).isFile()) return;
    descriptor = originalOpenSync.call(fs, path, "r");
    originalFsyncSync.call(fs, descriptor);
  } catch (error) {
    if (required) throw error;
  } finally {
    if (descriptor !== undefined) {
      try { originalCloseSync.call(fs, descriptor); } catch {}
    }
  }
}

function syncDirectory(path) {
  let descriptor;
  try {
    descriptor = originalOpenSync.call(fs, path, "r");
    originalFsyncSync.call(fs, descriptor);
  } catch {
    // Directory fsync is not supported by every filesystem.
  } finally {
    if (descriptor !== undefined) {
      try { originalCloseSync.call(fs, descriptor); } catch {}
    }
  }
}

function fileIsOlderThan(path, milliseconds) {
  try {
    return Date.now() - originalStatSync.call(fs, path).mtimeMs >= milliseconds;
  } catch {
    return false;
  }
}

function markerIsOlderThan(marker, milliseconds) {
  const timestamp = Date.parse(marker?.cancelledAt || marker?.createdAt || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp >= milliseconds;
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

function busyLockError() {
  const error = new Error("A live process is reclaiming this Swift Sim lock.");
  error.code = "EBUSY";
  return error;
}

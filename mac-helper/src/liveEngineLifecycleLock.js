import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { kernelProcessIdentity } from "./liveEngineOwnershipPreload.js";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_LOCK_PATH = join(homedir(), ".swift-sim", "engine", "lifecycle.lock");
const DEFAULT_WAIT_MS = 120_000;
const OWNERLESS_LOCK_GRACE_MS = 1_000;
let currentProcessStartToken = "";

export async function withLiveEngineLifecycleLock(operation, {
  lockPath = DEFAULT_LOCK_PATH,
  waitMs = DEFAULT_WAIT_MS,
} = {}) {
  if (typeof operation !== "function") throw new TypeError("A live-engine lifecycle operation is required.");
  const release = await acquireLiveEngineLifecycleLock(lockPath, waitMs);
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function acquireLiveEngineLifecycleLock(lockPath = DEFAULT_LOCK_PATH, waitMs = DEFAULT_WAIT_MS) {
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  while (true) {
    const release = tryAcquire(lockPath);
    if (release) return release;
    if (Date.now() >= deadline) {
      const error = new Error("Timed out waiting for the Swift Sim live-engine lifecycle lock.");
      error.code = "SWIFT_SIM_LIVE_ENGINE_BUSY";
      throw error;
    }
    await delay(25);
  }
}

function tryAcquire(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const ownerPath = join(lockPath, "owner.json");
  const owner = {
    pid: process.pid,
    version: 2,
    startToken: processStartIdentity(),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  let createdObservation = null;
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    createdObservation = observePath(lockPath);
    if (!createdObservation) throw new Error("Unable to observe the new live-engine lifecycle lock.");
    writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    return () => releaseOwnedLock(lockPath, ownerPath, owner);
  } catch (error) {
    if (createdObservation) {
      cleanupCreatedLockDirectory(lockPath, createdObservation);
      throw error;
    }
    if (error?.code !== "EEXIST") throw error;
    const observedOwner = readOwner(ownerPath);
    const ownerlessObservation = observedOwner ? null : observePath(lockPath);
    if ((observedOwner && !lockOwnerIsAlive(observedOwner))
        || (!observedOwner && ownerlessObservation && observationIsStale(ownerlessObservation))) {
      claimAndQuarantineStaleLock(lockPath, observedOwner, ownerlessObservation);
    }
    return null;
  }
}

export function cleanupCreatedLockDirectory(lockPath, createdObservation) {
  const ownerPath = join(lockPath, "owner.json");
  if (existsSync(ownerPath)) return false;
  const currentObservation = observePath(lockPath);
  if (!samePath(currentObservation, createdObservation)) return false;
  const quarantinePath = `${lockPath}.abandoned.${process.pid}.${randomUUID()}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const quarantinedObservation = observePath(quarantinePath);
  if (!samePath(quarantinedObservation, createdObservation)) {
    try { renameSync(quarantinePath, lockPath); } catch {}
    return false;
  }
  try { rmSync(quarantinePath, { recursive: true, force: true }); } catch {}
  return true;
}

function releaseOwnedLock(lockPath, ownerPath, owner) {
  try {
    const current = readOwner(ownerPath);
    if (sameOwner(current, owner)) {
      rmSync(lockPath, { recursive: true, force: true });
    }
  } catch {}
}

function claimAndQuarantineStaleLock(lockPath, observedOwner, ownerlessObservation) {
  const claimPath = join(lockPath, "reclaim.json");
  const claim = {
    pid: process.pid,
    version: 2,
    startToken: processStartIdentity(),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  try {
    writeFileSync(claimPath, JSON.stringify(claim), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") {
      quarantineAbandonedReclaimClaim(claimPath);
      return;
    }
    if (error?.code === "ENOENT") return;
    throw error;
  }

  try {
    const currentOwner = readOwner(join(lockPath, "owner.json"));
    if (observedOwner) {
      if (!sameOwner(currentOwner, observedOwner) || lockOwnerIsAlive(currentOwner)) return;
    } else {
      const currentObservation = observePath(lockPath);
      if (currentOwner || !samePath(currentObservation, ownerlessObservation)) return;
    }

    const currentClaim = readOwner(claimPath);
    if (!sameOwner(currentClaim, claim)) return;
    const quarantinePath = `${lockPath}.stale.${process.pid}.${claim.nonce}`;
    try {
      renameSync(lockPath, quarantinePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return;
    }

    // Verify the exact claim and observed stale owner after the atomic rename.
    // If either changed, restore the directory when possible instead of
    // deleting a replacement owner's lock.
    const quarantinedClaim = readOwner(join(quarantinePath, "reclaim.json"));
    const quarantinedOwner = readOwner(join(quarantinePath, "owner.json"));
    const stillClaimed = sameOwner(quarantinedClaim, claim);
    const sameStaleOwner = observedOwner
      ? sameOwner(quarantinedOwner, observedOwner)
      : !quarantinedOwner;
    if (!stillClaimed || !sameStaleOwner) {
      try { renameSync(quarantinePath, lockPath); } catch {}
      return;
    }
    try { rmSync(quarantinePath, { recursive: true, force: true }); } catch {}
  } finally {
    try {
      const currentClaim = readOwner(claimPath);
      if (sameOwner(currentClaim, claim)) rmSync(claimPath, { force: true });
    } catch {}
  }
}

function quarantineAbandonedReclaimClaim(claimPath) {
  const observedClaim = readOwner(claimPath);
  const observedPath = observePath(claimPath);
  if (!observedPath) return false;
  if (observedClaim) {
    if (lockOwnerIsAlive(observedClaim)) return false;
  } else if (!observationIsStale(observedPath)) {
    return false;
  }

  const quarantinePath = `${claimPath}.stale.${process.pid}.${randomUUID()}`;
  try {
    renameSync(claimPath, quarantinePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  const quarantinedClaim = readOwner(quarantinePath);
  const quarantinedPath = observePath(quarantinePath);
  const sameAbandonedClaim = observedClaim
    ? sameOwner(quarantinedClaim, observedClaim) && !lockOwnerIsAlive(quarantinedClaim)
    : !quarantinedClaim && samePath(quarantinedPath, observedPath);
  if (!sameAbandonedClaim) {
    try { renameSync(quarantinePath, claimPath); } catch {}
    return false;
  }
  try { rmSync(quarantinePath, { force: true }); } catch {}
  return true;
}

function readOwner(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return completeOwnerRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function completeOwnerRecord(value) {
  const pid = Number(value?.pid);
  const startToken = ownerStartToken(value);
  return Boolean(value
    && typeof value === "object"
    && !Array.isArray(value)
    && Number.isInteger(pid)
    && pid > 1
    && startToken
    && typeof value.nonce === "string"
    && value.nonce.length > 0);
}

function sameOwner(left, right) {
  return Boolean(left && right
    && Number(left.pid) === Number(right.pid)
    && ownerStartToken(left) === ownerStartToken(right)
    && left.nonce === right.nonce);
}

function ownerStartToken(owner) {
  return String(owner?.startToken || owner?.startedAt || "");
}

export function lockOwnerIsAlive(owner, {
  identity = kernelProcessIdentity(owner?.pid),
} = {}) {
  const pid = Number(owner?.pid);
  const startToken = String(owner?.startToken || "");
  if (!Number.isInteger(pid) || pid <= 1 || !startToken) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return Boolean(identity && identity.startToken === startToken);
}

function observePath(path) {
  try {
    const stat = statSync(path);
    return {
      device: String(stat.dev),
      inode: String(stat.ino),
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

function observationIsStale(observation) {
  return Boolean(observation
    && Date.now() - Number(observation.mtimeMs) >= OWNERLESS_LOCK_GRACE_MS);
}

function samePath(left, right) {
  return Boolean(left && right
    && left.device === right.device
    && left.inode === right.inode);
}

function processStartIdentity() {
  currentProcessStartToken ||= requiredProcessStartToken(process.pid);
  return currentProcessStartToken;
}

function requiredProcessStartToken(pid) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = kernelProcessIdentity(pid)?.startToken || "";
    if (value) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish live-engine lock ownership.");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

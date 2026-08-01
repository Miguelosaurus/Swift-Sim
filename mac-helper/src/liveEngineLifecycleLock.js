import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_LOCK_PATH = join(homedir(), ".swift-sim", "engine", "lifecycle.lock");
const DEFAULT_WAIT_MS = 120_000;
const OWNERLESS_LOCK_GRACE_MS = 1_000;
let currentProcessStartedAt = "";

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
    startedAt: processStartIdentity(),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  let created = false;
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    created = true;
    writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    return () => releaseOwnedLock(lockPath, ownerPath, owner);
  } catch (error) {
    if (created) {
      try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
      throw error;
    }
    if (error?.code !== "EEXIST") throw error;
    const observedOwner = readOwner(ownerPath);
    const ownerlessObservation = observedOwner ? null : observeLockDirectory(lockPath);
    if ((observedOwner && !lockOwnerIsAlive(observedOwner))
        || (!observedOwner && ownerlessObservation && ownerlessObservationIsStale(ownerlessObservation))) {
      claimAndQuarantineStaleLock(lockPath, observedOwner, ownerlessObservation);
    }
    return null;
  }
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
    startedAt: processStartIdentity(),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  try {
    writeFileSync(claimPath, JSON.stringify(claim), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST" || error?.code === "ENOENT") return;
    throw error;
  }

  try {
    const currentOwner = readOwner(join(lockPath, "owner.json"));
    if (observedOwner) {
      if (!sameOwner(currentOwner, observedOwner) || lockOwnerIsAlive(currentOwner)) return;
    } else {
      const currentObservation = observeLockDirectory(lockPath);
      if (currentOwner || !sameLockDirectory(currentObservation, ownerlessObservation)) return;
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

function readOwner(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function sameOwner(left, right) {
  return Boolean(left && right
    && Number(left.pid) === Number(right.pid)
    && left.startedAt === right.startedAt
    && left.nonce === right.nonce);
}

function lockOwnerIsAlive(owner) {
  const pid = Number(owner?.pid);
  if (!Number.isInteger(pid) || pid <= 1 || !owner?.startedAt) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return processStartedAt(pid) === owner.startedAt;
}

function observeLockDirectory(path) {
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

function ownerlessObservationIsStale(observation) {
  return Boolean(observation
    && Date.now() - Number(observation.mtimeMs) >= OWNERLESS_LOCK_GRACE_MS);
}

function sameLockDirectory(left, right) {
  return Boolean(left && right
    && left.device === right.device
    && left.inode === right.inode);
}

function processStartIdentity() {
  currentProcessStartedAt ||= requiredProcessStartedAt(process.pid);
  return currentProcessStartedAt;
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = processStartedAt(pid);
    if (value) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish live-engine lock ownership.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

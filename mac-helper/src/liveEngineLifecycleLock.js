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
const DEFAULT_WAIT_MS = 15_000;
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
    let current;
    try { current = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
    if ((current && !lockOwnerIsAlive(current))
        || (!current && ownerlessLockIsStale(lockPath))) {
      quarantineStaleLock(lockPath);
    }
    return null;
  }
}

function releaseOwnedLock(lockPath, ownerPath, owner) {
  try {
    const current = JSON.parse(readFileSync(ownerPath, "utf8"));
    if (current.pid === owner.pid
        && current.startedAt === owner.startedAt
        && current.nonce === owner.nonce) {
      rmSync(lockPath, { recursive: true, force: true });
    }
  } catch {}
}

function quarantineStaleLock(lockPath) {
  const quarantinePath = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }
  try { rmSync(quarantinePath, { recursive: true, force: true }); } catch {}
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

function ownerlessLockIsStale(path) {
  try {
    return Date.now() - statSync(path).mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch {
    return false;
  }
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

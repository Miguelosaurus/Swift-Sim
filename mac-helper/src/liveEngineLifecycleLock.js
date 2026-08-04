import { homedir } from "node:os";
import { join } from "node:path";
import { kernelProcessIdentity } from "./liveEngineOwnershipPreload.js";
import {
  NodeLockManager,
  cleanupCreatedLockDirectory,
  lockOwnerIsAlive,
} from "./infrastructure/nodeLockManager.js";

const DEFAULT_LOCK_PATH = join(homedir(), ".swift-sim", "engine", "lifecycle.lock");
const DEFAULT_WAIT_MS = 120_000;
const OWNERLESS_LOCK_GRACE_MS = 1_000;
const lockManager = new NodeLockManager({ identity: kernelProcessIdentity });

export async function withLiveEngineLifecycleLock(
  operation,
  { lockPath = DEFAULT_LOCK_PATH, waitMs = DEFAULT_WAIT_MS } = {},
) {
  if (typeof operation !== "function") {
    throw new TypeError("A live-engine lifecycle operation is required.");
  }
  const release = await acquireLiveEngineLifecycleLock(lockPath, waitMs);
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function acquireLiveEngineLifecycleLock(
  lockPath = DEFAULT_LOCK_PATH,
  waitMs = DEFAULT_WAIT_MS,
) {
  try {
    const lease = await lockManager.acquire({
      path: lockPath,
      waitMs,
      staleAfterMs: OWNERLESS_LOCK_GRACE_MS,
      ownerMode: 0o600,
    });
    return () => lease.releaseSync();
  } catch (error) {
    if (error?.code === "SWIFT_SIM_LOCK_BUSY") {
      error.code = "SWIFT_SIM_LIVE_ENGINE_BUSY";
      error.message = "Timed out waiting for the Swift Sim live-engine lifecycle lock.";
    }
    throw error;
  }
}

export { cleanupCreatedLockDirectory, lockOwnerIsAlive };

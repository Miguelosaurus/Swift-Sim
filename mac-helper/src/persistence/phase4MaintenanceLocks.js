// @ts-check

import { readFileSync } from "node:fs";
import { NodeLockManager } from "../infrastructure/nodeLockManager.js";
import { phase4LegacySources } from "./phase4CutoverCoordinator.js";

/** @typedef {import("../infrastructure/ports.js").LockLease} LockLease */
/** @typedef {import("./phase4HelperProcessIdentity.js").SpawnSyncLike} SpawnSyncLike */

/**
 * Unlike a free-lock probe, these exact legacy leases fence writers throughout
 * the asynchronous online backup and every migration/reopen observation.
 * Coordinator operations subsequently acquire their existing domain locks.
 *
 * @template T
 * @param {string} stateRoot
 * @param {SpawnSyncLike} spawnSync
 * @param {(leases: readonly LockLease[]) => Promise<T>} operation
 */
export async function withPhase4MaintenanceLocks(stateRoot, spawnSync, operation) {
  const manager = new NodeLockManager({
    identity: (pid) => observeMaintenanceProcessIdentity(pid, spawnSync),
  });
  const requests = Object.values(phase4LegacySources(stateRoot))
    .map((source) => source.lockRequest)
    .sort((left, right) => left.path.localeCompare(right.path));
  /** @type {LockLease[]} */
  const leases = [];
  try {
    for (const request of requests) {
      leases.push(manager.acquireSync({ ...request, waitMs: 0 }));
    }
    return await operation(Object.freeze([...leases]));
  } finally {
    for (const lease of leases.reverse()) lease.releaseSync();
  }
}

/**
 * Inspection failure cannot establish stale ownership. Only ps's documented
 * no-selection result (1, no output/error) establishes absence.
 * @param {number} pid
 * @param {SpawnSyncLike} spawnSync
 */
export function observeMaintenanceProcessIdentity(pid, spawnSync) {
  const result =
    /** @type {{status?: unknown, stdout?: unknown, stderr?: unknown, error?: unknown, signal?: unknown} | null} */ (
      spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" })
    );
  if (
    !result ||
    result.error ||
    result.signal ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string" ||
    result.stderr.trim()
  ) {
    throw new Error("Phase-4 process identity observation failed.");
  }
  const startToken = result.stdout.trim();
  if (result.status === 1 && !startToken) return null;
  if (result.status !== 0 || !startToken) {
    throw new Error("Phase-4 process identity observation is inconclusive.");
  }
  return { startToken };
}

/**
 * Bind a measured lock to the exact lease nonce, PID and process-start token;
 * a caller-authored JSON boolean cannot substitute for the executor's leases.
 * @param {readonly LockLease[] | undefined} leases
 * @param {string} path
 * @param {Record<string, unknown>} owner
 * @param {string | null} observedStartToken
 */
export function phase4MaintenanceOwnsLock(leases, path, owner, observedStartToken) {
  const lease = leases?.find((entry) => entry.path === path);
  if (!lease) return false;
  const current = JSON.parse(readFileSync(lease.ownerPath, "utf8"));
  return (
    owner.pid === process.pid &&
    current.pid === process.pid &&
    owner.nonce === lease.ownerNonce &&
    current.nonce === lease.ownerNonce &&
    observedStartToken !== null &&
    owner.startToken === observedStartToken &&
    current.startToken === observedStartToken
  );
}

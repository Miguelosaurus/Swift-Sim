// @ts-check
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { NodeAtomicFileStore } from "./nodeAtomicFileStore.js";
import { SystemClock } from "./systemClock.js";
import { SystemIdGenerator } from "./systemIdGenerator.js";

/** @typedef {import("./ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("./ports.js").Clock} Clock */
/** @typedef {import("./ports.js").IdGenerator} IdGenerator */
/** @typedef {import("./ports.js").LockLease} LockLease */
/** @typedef {import("./ports.js").LockManager} LockManager */
/** @typedef {import("./ports.js").LockRequest} LockRequest */

/**
 * @typedef {{ startToken: string } | null} ProcessStartIdentity
 * @typedef {(pid: number) => ProcessStartIdentity} ProcessIdentityProvider
 * @typedef {{ device: string, inode: string, mtimeMs: number }} PathObservation
 * @typedef {{ version: number, pid: number, startToken: string, nonce: string, createdAt: string }} LockOwner
 */

const LOCK_DIRECTORY_MODE = 0o700;
const RETRY_DELAY_MS = 25;
const OWNER_WRITE_OPTIONS = Object.freeze({
  mode: 0o600,
  createParentMode: LOCK_DIRECTORY_MODE,
  replace: false,
  syncDirectory: true,
});

/** @implements {LockManager} */
export class NodeLockManager {
  /**
   * @param {{
   *   identity: ProcessIdentityProvider,
   *   fileStore?: AtomicFileStore,
   *   clock?: Clock,
   *   idGenerator?: IdGenerator,
   * }} options
   */
  constructor({
    identity,
    fileStore = new NodeAtomicFileStore(),
    clock = new SystemClock(),
    idGenerator = new SystemIdGenerator(),
  }) {
    if (typeof identity !== "function") {
      throw new TypeError("NodeLockManager requires a process identity provider.");
    }
    this.identity = identity;
    this.fileStore = fileStore;
    this.clock = clock;
    this.idGenerator = idGenerator;
    this.currentProcessStartToken = "";
  }

  /** @param {LockRequest} request */
  async acquire(request) {
    const normalized = normalizeRequest(request);
    const deadline = this.clock.now().getTime() + normalized.waitMs;
    while (true) {
      const lease = this.tryAcquire(normalized);
      if (lease) return lease;
      if (this.clock.now().getTime() >= deadline) throw lockBusyError(normalized.path);
      await this.clock.sleep(RETRY_DELAY_MS);
    }
  }

  /** @param {LockRequest} request */
  acquireSync(request) {
    const normalized = normalizeRequest(request);
    const deadline = this.clock.now().getTime() + normalized.waitMs;
    while (true) {
      const lease = this.tryAcquire(normalized);
      if (lease) return lease;
      if (this.clock.now().getTime() >= deadline) throw lockBusyError(normalized.path);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS);
    }
  }

  /**
   * @template T
   * @param {LockRequest} request
   * @param {(lease: LockLease) => Promise<T>} operation
   */
  async withLock(request, operation) {
    if (typeof operation !== "function") throw new TypeError("A lock operation is required.");
    const lease = await this.acquire(request);
    try {
      return await operation(lease);
    } finally {
      await lease.release();
    }
  }

  /**
   * @template T
   * @param {LockRequest} request
   * @param {(lease: LockLease) => T} operation
   */
  withLockSync(request, operation) {
    if (typeof operation !== "function") throw new TypeError("A lock operation is required.");
    const lease = this.acquireSync(request);
    try {
      return operation(lease);
    } finally {
      lease.releaseSync();
    }
  }

  /** @param {LockRequest} request */
  tryAcquire(request) {
    mkdirSync(dirname(request.path), { recursive: true, mode: LOCK_DIRECTORY_MODE });
    const ownerPath = join(request.path, "owner.json");
    const owner = this.newOwner();
    /** @type {PathObservation | null} */
    let createdObservation = null;
    try {
      mkdirSync(request.path, { mode: LOCK_DIRECTORY_MODE });
      createdObservation = observePath(request.path);
      if (!createdObservation) throw new Error("Unable to observe the new lock directory.");
      this.fileStore.writeJSONSync(ownerPath, owner, {
        ...OWNER_WRITE_OPTIONS,
        mode: request.ownerMode,
      });
      return this.leaseFor(request.path, ownerPath, owner);
    } catch (error) {
      if (createdObservation) {
        cleanupCreatedLockDirectory(request.path, createdObservation, {
          idGenerator: this.idGenerator,
        });
        throw error;
      }
      if (!hasCode(error, "EEXIST")) throw error;
      const observedOwner = readOwner(ownerPath, this.fileStore);
      const ownerlessObservation = observedOwner ? null : observePath(request.path);
      if (
        (observedOwner && !lockOwnerIsAlive(observedOwner, { identity: this.identity(observedOwner.pid) }))
        || (!observedOwner
          && ownerlessObservation
          && observationIsStale(ownerlessObservation, request.staleAfterMs, this.clock))
      ) {
        this.claimAndQuarantineStaleLock(
          request,
          observedOwner,
          ownerlessObservation,
        );
      }
      return null;
    }
  }

  newOwner() {
    return {
      version: 2,
      pid: process.pid,
      startToken: this.processStartIdentity(),
      nonce: this.idGenerator.randomUUID(),
      createdAt: this.clock.now().toISOString(),
    };
  }

  /** @param {string} path @param {string} ownerPath @param {LockOwner} owner */
  leaseFor(path, ownerPath, owner) {
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      releaseOwnedLock(path, ownerPath, owner, this.fileStore);
    };
    return {
      path,
      ownerPath,
      ownerNonce: owner.nonce,
      async release() {
        releaseOnce();
      },
      releaseSync() {
        releaseOnce();
      },
    };
  }

  /**
   * @param {LockRequest} request
   * @param {LockOwner | null} observedOwner
   * @param {PathObservation | null} ownerlessObservation
   */
  claimAndQuarantineStaleLock(request, observedOwner, ownerlessObservation) {
    const claimPath = join(request.path, "reclaim.json");
    const claim = this.newOwner();
    try {
      this.fileStore.writeJSONSync(claimPath, claim, {
        ...OWNER_WRITE_OPTIONS,
        mode: request.ownerMode,
      });
    } catch (error) {
      if (hasCode(error, "EEXIST")) {
        this.quarantineAbandonedReclaimClaim(
          claimPath,
          request.staleAfterMs,
        );
        return;
      }
      if (hasCode(error, "ENOENT")) return;
      throw error;
    }

    try {
      const currentOwner = readOwner(join(request.path, "owner.json"), this.fileStore);
      if (observedOwner) {
        if (
          !sameOwner(currentOwner, observedOwner)
          || lockOwnerIsAlive(currentOwner, {
            identity: this.identity(Number(currentOwner?.pid)),
          })
        ) {
          return;
        }
      } else {
        const currentObservation = observePath(request.path);
        if (currentOwner || !samePath(currentObservation, ownerlessObservation)) return;
      }

      const currentClaim = readOwner(claimPath, this.fileStore);
      if (!sameOwner(currentClaim, claim)) return;
      const quarantinePath = `${request.path}.stale.${process.pid}.${claim.nonce}`;
      try {
        renameSync(request.path, quarantinePath);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
        return;
      }

      const quarantinedClaim = readOwner(join(quarantinePath, "reclaim.json"), this.fileStore);
      const quarantinedOwner = readOwner(join(quarantinePath, "owner.json"), this.fileStore);
      const stillClaimed = sameOwner(quarantinedClaim, claim);
      const sameStaleOwner = observedOwner
        ? sameOwner(quarantinedOwner, observedOwner)
        : !quarantinedOwner;
      if (!stillClaimed || !sameStaleOwner) {
        try {
          renameSync(quarantinePath, request.path);
        } catch {}
        return;
      }
      try {
        rmSync(quarantinePath, { recursive: true, force: true });
      } catch {}
    } finally {
      try {
        const currentClaim = readOwner(claimPath, this.fileStore);
        if (sameOwner(currentClaim, claim)) this.fileStore.removeSync(claimPath);
      } catch {}
    }
  }

  /** @param {string} claimPath @param {number} staleAfterMs */
  quarantineAbandonedReclaimClaim(claimPath, staleAfterMs) {
    const observedClaim = readOwner(claimPath, this.fileStore);
    const observedPath = observePath(claimPath);
    if (!observedPath) return false;
    if (observedClaim) {
      if (
        lockOwnerIsAlive(observedClaim, {
          identity: this.identity(observedClaim.pid),
        })
      ) {
        return false;
      }
    } else if (!observationIsStale(observedPath, staleAfterMs, this.clock)) {
      return false;
    }

    const quarantinePath = `${claimPath}.stale.${process.pid}.${this.idGenerator.randomUUID()}`;
    try {
      renameSync(claimPath, quarantinePath);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return false;
      throw error;
    }

    const quarantinedClaim = readOwner(quarantinePath, this.fileStore);
    const quarantinedPath = observePath(quarantinePath);
    const sameAbandonedClaim = observedClaim
      ? sameOwner(quarantinedClaim, observedClaim)
        && !lockOwnerIsAlive(quarantinedClaim, {
          identity: this.identity(Number(quarantinedClaim?.pid)),
        })
      : !quarantinedClaim && samePath(quarantinedPath, observedPath);
    if (!sameAbandonedClaim) {
      try {
        renameSync(quarantinePath, claimPath);
      } catch {}
      return false;
    }
    try {
      rmSync(quarantinePath, { force: true });
    } catch {}
    return true;
  }

  processStartIdentity() {
    if (this.currentProcessStartToken) return this.currentProcessStartToken;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const value = this.identity(process.pid)?.startToken || "";
      if (value) {
        this.currentProcessStartToken = value;
        return value;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    throw new Error("Unable to establish lock ownership.");
  }
}

/**
 * @param {string} lockPath
 * @param {PathObservation} createdObservation
 * @param {{ idGenerator?: IdGenerator }} [options]
 */
export function cleanupCreatedLockDirectory(
  lockPath,
  createdObservation,
  { idGenerator = new SystemIdGenerator() } = {},
) {
  const ownerPath = join(lockPath, "owner.json");
  if (existsSync(ownerPath)) return false;
  const currentObservation = observePath(lockPath);
  if (!samePath(currentObservation, createdObservation)) return false;
  const quarantinePath = `${lockPath}.abandoned.${process.pid}.${idGenerator.randomUUID()}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
  const quarantinedObservation = observePath(quarantinePath);
  if (!samePath(quarantinedObservation, createdObservation)) {
    try {
      renameSync(quarantinePath, lockPath);
    } catch {}
    return false;
  }
  try {
    rmSync(quarantinePath, { recursive: true, force: true });
  } catch {}
  return true;
}

/**
 * @param {unknown} owner
 * @param {{ identity?: ProcessStartIdentity }} [options]
 */
export function lockOwnerIsAlive(owner, { identity = null } = {}) {
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

/** @param {string} path @param {AtomicFileStore} fileStore */
function readOwner(path, fileStore) {
  try {
    const value = fileStore.readJSONSync(path);
    return completeOwnerRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {value is LockOwner} */
function completeOwnerRecord(value) {
  const pid = Number(value?.pid);
  const startToken = ownerStartToken(value);
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && Number.isInteger(pid)
      && pid > 1
      && startToken
      && typeof value.nonce === "string"
      && value.nonce.length > 0,
  );
}

/** @param {unknown} left @param {unknown} right */
function sameOwner(left, right) {
  return Boolean(
    left
      && right
      && Number(left.pid) === Number(right.pid)
      && ownerStartToken(left) === ownerStartToken(right)
      && left.nonce === right.nonce,
  );
}

/** @param {unknown} owner */
function ownerStartToken(owner) {
  return String(owner?.startToken || owner?.startedAt || "");
}

/** @param {string} path */
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

/** @param {PathObservation} observation @param {number} staleAfterMs @param {Clock} clock */
function observationIsStale(observation, staleAfterMs, clock) {
  return clock.now().getTime() - Number(observation.mtimeMs) >= staleAfterMs;
}

/** @param {PathObservation | null} left @param {PathObservation | null} right */
function samePath(left, right) {
  return Boolean(
    left
      && right
      && left.device === right.device
      && left.inode === right.inode,
  );
}

/** @param {string} lockPath @param {string} ownerPath @param {LockOwner} owner @param {AtomicFileStore} fileStore */
function releaseOwnedLock(lockPath, ownerPath, owner, fileStore) {
  try {
    const current = readOwner(ownerPath, fileStore);
    if (sameOwner(current, owner)) rmSync(lockPath, { recursive: true, force: true });
  } catch {}
}

/** @param {LockRequest} request */
function normalizeRequest(request) {
  if (!request || typeof request !== "object") throw new TypeError("A lock request is required.");
  if (typeof request.path !== "string" || !request.path) {
    throw new TypeError("Lock path must be a non-empty string.");
  }
  return {
    path: request.path,
    waitMs: nonNegativeDuration(request.waitMs, "waitMs"),
    staleAfterMs: nonNegativeDuration(request.staleAfterMs, "staleAfterMs"),
    ownerMode: normalizeMode(request.ownerMode),
  };
}

/** @param {number} value @param {string} label */
function nonNegativeDuration(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Lock ${label} must be a finite non-negative number.`);
  }
  return value;
}

/** @param {number} value */
function normalizeMode(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0o777) {
    throw new RangeError("Lock owner mode must be an integer from 0 to 0777.");
  }
  return value;
}

/** @param {string} path */
function lockBusyError(path) {
  const error = new Error(`Timed out waiting for lock ${path}.`);
  error.code = "SWIFT_SIM_LOCK_BUSY";
  return error;
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return Boolean(error && typeof error === "object" && error.code === code);
}

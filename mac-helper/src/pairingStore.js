import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir, hostname } from "node:os";

const LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_LOCK_MAX_AGE_MS = 30_000;

export class PairingStore {
  constructor({ path = join(homedir(), ".swift-sim", "pairing.json") } = {}) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.pairing = undefined;
    this.load();
  }

  current() {
    return this.withLock(() => {
      this.loadUnlocked();
      if (!this.pairing) this.createUnlocked();
      return structuredClone(this.pairing);
    });
  }

  rotate() {
    return this.withLock(() => {
      this.loadUnlocked();
      const now = new Date().toISOString();
      this.pairing = {
        token: randomBytes(32).toString("base64url"),
        installationID: this.pairing?.installationID || randomUUID(),
        macName: process.env.SWIFT_SIM_MAC_NAME || hostname(),
        createdAt: this.pairing?.createdAt || now,
        updatedAt: now,
      };
      this.flushUnlocked();
      return structuredClone(this.pairing);
    });
  }

  status() {
    const pairing = this.current();
    return {
      ok: true,
      installationID: pairing.installationID,
      macName: pairing.macName,
      helper: "swift-sim-helper",
      updatedAt: pairing.updatedAt,
    };
  }

  tokenMatches(token) {
    const expected = this.current().token;
    if (!expected || !token) return false;
    const expectedBuffer = Buffer.from(String(expected), "utf8");
    const actualBuffer = Buffer.from(String(token), "utf8");
    return expectedBuffer.length === actualBuffer.length
      && timingSafeEqual(expectedBuffer, actualBuffer);
  }

  load() {
    return this.withLock(() => {
      this.loadUnlocked();
      return this.pairing ? structuredClone(this.pairing) : undefined;
    });
  }

  loadUnlocked() {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.pairing = undefined;
        return;
      }
      throw pairingStateError(this.path, error);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
        || typeof parsed.token !== "string" || !parsed.token
        || (parsed.installationID !== undefined
          && (typeof parsed.installationID !== "string" || !parsed.installationID))) {
      throw pairingStateError(this.path, new Error("the stored pairing record is malformed"));
    }

    this.pairing = {
      token: parsed.token,
      installationID: parsed.installationID || randomUUID(),
      macName: typeof parsed.macName === "string" && parsed.macName
        ? parsed.macName
        : process.env.SWIFT_SIM_MAC_NAME || hostname(),
      createdAt: typeof parsed.createdAt === "string" && parsed.createdAt
        ? parsed.createdAt
        : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt
        ? parsed.updatedAt
        : new Date().toISOString(),
    };
    if (!parsed.installationID) this.flushUnlocked();
  }

  createUnlocked() {
    const now = new Date().toISOString();
    this.pairing = {
      token: randomBytes(32).toString("base64url"),
      installationID: randomUUID(),
      macName: process.env.SWIFT_SIM_MAC_NAME || hostname(),
      createdAt: now,
      updatedAt: now,
    };
    this.flushUnlocked();
  }

  flushUnlocked() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify(this.pairing, null, 2), "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, this.path);
      syncDirectory(dirname(this.path));
    } catch (error) {
      if (descriptor !== undefined) {
        try { closeSync(descriptor); } catch {}
      }
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  withLock(operation) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const ownerPath = join(this.lockPath, "owner.json");
    const owner = {
      pid: process.pid,
      startedAt: requiredProcessStartedAt(process.pid),
      nonce: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const deadline = Date.now() + LOCK_WAIT_MS;

    while (true) {
      let created = false;
      try {
        mkdirSync(this.lockPath, { mode: 0o700 });
        created = true;
        writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
        break;
      } catch (error) {
        if (created) {
          rmSync(this.lockPath, { recursive: true, force: true });
          throw error;
        }
        if (error?.code !== "EEXIST") throw error;
        let existingOwner;
        try { existingOwner = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
        if ((existingOwner && !lockOwnerIsAlive(existingOwner))
            || (!existingOwner && ownerlessLockIsStale(this.lockPath))) {
          rmSync(this.lockPath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for the Swift Sim pairing-state lock.");
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }

    try {
      return operation();
    } finally {
      try {
        const currentOwner = JSON.parse(readFileSync(ownerPath, "utf8"));
        if (currentOwner.pid === owner.pid && currentOwner.nonce === owner.nonce) {
          rmSync(this.lockPath, { recursive: true, force: true });
        }
      } catch {}
    }
  }
}

function lockOwnerIsAlive(owner) {
  if (!processIsAlive(owner?.pid)) return false;
  if (!owner?.startedAt) {
    const createdAt = Date.parse(owner?.createdAt || "");
    return Number.isFinite(createdAt) && Date.now() - createdAt < LEGACY_LOCK_MAX_AGE_MS;
  }
  return processStartedAt(owner.pid) === owner.startedAt;
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = processStartedAt(pid);
    if (startedAt) return startedAt;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish a process start identity for the Swift Sim pairing-state lock.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processIsAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch {
    return false;
  }
}

function ownerlessLockIsStale(lockPath) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch {
    return false;
  }
}

function syncDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch {
    // The file itself is already synced. Some filesystems do not permit
    // fsync on a directory, so directory syncing is best-effort only.
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
  }
}

function pairingStateError(path, error) {
  return new Error(
    `Unable to read Swift Sim pairing state at ${path}: ${error instanceof Error ? error.message : String(error)}. `
      + "Swift Sim will not rotate the helper identity automatically. Restore or remove this file explicitly."
  );
}

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
import { homedir } from "node:os";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_LOCK_MAX_AGE_MS = 30_000;

export class PairingInviteStore {
  constructor({ path = join(homedir(), ".swift-sim", "pairing-invites.json"), ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.path = path;
    this.ttlMs = normalizeTTL(ttlMs);
    this.now = now;
  }

  create({ pairing, ttlMs = this.ttlMs } = {}) {
    if (!pairing?.token || !pairing.installationID) throw new Error("Pairing state is unavailable.");
    const lifetime = normalizeTTL(ttlMs);
    return this.withLock(() => {
      const records = this.loadUnlocked();
      const now = this.now();
      const invite = randomBytes(32).toString("base64url");
      const record = {
        id: randomUUID(),
        inviteHash: digest(invite),
        installationID: pairing.installationID,
        clientNonce: null,
        claimed: false,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + lifetime).toISOString(),
      };
      records.push(record);
      this.saveUnlocked(records.filter((item) => Date.parse(item.expiresAt) > now));
      return { invite, expiresAt: record.expiresAt };
    });
  }

  claim(invite, clientNonce, pairing) {
    const normalizedInvite = String(invite || "");
    const normalizedNonce = String(clientNonce || "");
    if (!/^[A-Za-z0-9_-]{32,}$/.test(normalizedInvite)
        || !/^[A-Za-z0-9_-]{8,128}$/.test(normalizedNonce)) {
      return { ok: false, code: "malformed" };
    }
    return this.withLock(() => {
      const now = this.now();
      const records = this.loadUnlocked();
      const record = records.find((item) => equalDigest(item.inviteHash, digest(normalizedInvite)));
      if (!record) return { ok: false, code: "expired" };
      if (record.installationID !== pairing?.installationID) return { ok: false, code: "expired" };
      if (Date.parse(record.expiresAt) <= now) {
        this.saveUnlocked(records.filter((item) => Date.parse(item.expiresAt) > now));
        return { ok: false, code: "expired" };
      }
      if (record.claimed) {
        if (record.clientNonce === normalizedNonce) {
          return { ok: true, idempotent: true, expiresAt: record.expiresAt, pairing };
        }
        return { ok: false, code: "consumed" };
      }
      record.claimed = true;
      record.clientNonce = normalizedNonce;
      record.claimedAt = new Date(now).toISOString();
      this.saveUnlocked(records);
      return { ok: true, expiresAt: record.expiresAt, idempotent: false, pairing };
    });
  }

  inspect(invite, pairing = undefined) {
    const normalizedInvite = String(invite || "");
    if (!/^[A-Za-z0-9_-]{32,}$/.test(normalizedInvite)) return null;
    return this.withLock(() => {
      const now = this.now();
      const records = this.loadUnlocked();
      const record = records.find((item) => equalDigest(item.inviteHash, digest(normalizedInvite)));
      if (!record || (pairing !== undefined && record.installationID !== pairing.installationID)
          || Date.parse(record.expiresAt) <= now) {
        const kept = records.filter((item) => Date.parse(item.expiresAt) > now);
        if (kept.length !== records.length) this.saveUnlocked(kept);
        return null;
      }
      return { expiresAt: record.expiresAt, claimed: Boolean(record.claimed) };
    });
  }

  cleanup() {
    return this.withLock(() => {
      const now = this.now();
      const records = this.loadUnlocked();
      const kept = records.filter((item) => Date.parse(item.expiresAt) > now && !item.claimed);
      if (kept.length !== records.length) this.saveUnlocked(kept);
      return kept.length;
    });
  }

  loadUnlocked() {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(value) ? value : [];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  saveUnlocked(records) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify(records, null, 2), "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, this.path);
      syncDirectory(dirname(this.path));
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
    }
  }

  withLock(operation) {
    const lock = `${this.path}.lock`;
    const ownerPath = join(lock, "owner.json");
    const owner = {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
      nonce: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
      let created = false;
      try {
        mkdirSync(lock, { mode: 0o700 });
        created = true;
        writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
        break;
      } catch (error) {
        if (created) {
          rmSync(lock, { recursive: true, force: true });
          throw error;
        }
        if (error?.code !== "EEXIST") throw error;
        let existingOwner;
        try { existingOwner = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
        if ((existingOwner && !lockOwnerIsAlive(existingOwner))
            || (!existingOwner && ownerlessLockIsStale(lock))) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the Swift Sim pairing-invite lock.");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    try {
      return operation();
    } finally {
      try {
        const currentOwner = JSON.parse(readFileSync(ownerPath, "utf8"));
        if (currentOwner.pid === owner.pid && currentOwner.nonce === owner.nonce) {
          rmSync(lock, { recursive: true, force: true });
        }
      } catch {}
    }
  }
}

function normalizeTTL(value) {
  const ttlMs = Number(value);
  if (!Number.isFinite(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) {
    throw new Error("Pairing invite TTL must be between 1 and 15 minutes.");
  }
  return ttlMs;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function equalDigest(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function lockOwnerIsAlive(owner) {
  if (!processIsAlive(owner?.pid)) return false;
  if (!owner?.startedAt) {
    const createdAt = Date.parse(owner?.createdAt || "");
    return Number.isFinite(createdAt) && Date.now() - createdAt < LEGACY_LOCK_MAX_AGE_MS;
  }
  return processStartedAt(owner.pid) === owner.startedAt;
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

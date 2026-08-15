// @ts-check

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";
import {
  normalizePairingStateSnapshot,
  SqlitePairingStateRepository,
} from "./sqlitePairingStateRepository.js";

/** @typedef {import("../contracts/pairing.js").PairingCredentialRecord} PairingCredentialRecord */
/** @typedef {import("../contracts/pairing.js").PairingInvitationRecord} PairingInvitationRecord */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */
/** @typedef {{ credential: PairingCredentialRecord | null, invitations: PairingInvitationRecord[] }} PairingMutableSnapshot */

export class SqlitePairingMutationRepository {
  #database;
  #reader;
  #deleteInvites;
  #deleteCredential;
  #insertCredential;
  #insertInvite;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#database = database;
    this.#reader = new SqlitePairingStateRepository(database);
    this.#deleteInvites = database.prepare("DELETE FROM pairing_invitations");
    this.#deleteCredential = database.prepare("DELETE FROM pairing_credentials");
    this.#insertCredential = database.prepare(`INSERT INTO pairing_credentials(
      singleton, installation_id, token, mac_name, created_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?)`);
    this.#insertInvite = database.prepare(`INSERT INTO pairing_invitations(
      id, invite_hash, installation_id, client_nonce, claimed,
      created_at, expires_at, claimed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  }

  read() {
    return this.#reader.read();
  }

  /** @template T @param {(snapshot: PairingMutableSnapshot) => T} operation @returns {T} */
  mutate(operation) {
    if (typeof operation !== "function") throw new TypeError("Pairing mutation operation is required.");
    return this.#database.transaction(() => {
      const snapshot = /** @type {PairingMutableSnapshot} */ (
        structuredClone(this.#reader.read())
      );
      const result = operation(snapshot);
      if (isThenable(result)) {
        throw new Error("Pairing SQLite mutations must be synchronous.");
      }
      const normalized = normalizePairingStateSnapshot(snapshot);
      this.#deleteInvites.run();
      this.#deleteCredential.run();
      if (normalized.credential) {
        const record = normalized.credential;
        this.#insertCredential.run(
          record.installationID,
          record.token,
          record.macName,
          record.createdAt,
          record.updatedAt,
        );
      }
      for (const record of normalized.invitations) {
        this.#insertInvite.run(
          record.id,
          record.inviteHash,
          record.installationID,
          record.clientNonce,
          record.claimed ? 1 : 0,
          record.createdAt,
          record.expiresAt,
          record.claimedAt ?? null,
        );
      }
      return structuredClone(result);
    });
  }
}

export class SqlitePairingStore {
  #repository;
  /** @param {{ repository: SqlitePairingMutationRepository }} options */
  constructor({ repository }) {
    this.#repository = repository;
  }

  current() {
    const credential = this.#repository.read().credential;
    if (!credential) {
      throw new Error("SQLite pairing authority is active but no pairing credential exists.");
    }
    return structuredClone(credential);
  }

  load() {
    return this.current();
  }

  rotate() {
    return this.#repository.mutate((snapshot) => {
      const existing = snapshot.credential;
      if (!existing) throw new Error("SQLite pairing authority cannot rotate a missing credential.");
      const now = new Date().toISOString();
      snapshot.credential = {
        token: randomBytes(32).toString("base64url"),
        installationID: existing.installationID || randomUUID(),
        macName: process.env.SWIFT_SIM_MAC_NAME || hostname(),
        createdAt: existing.createdAt || now,
        updatedAt: now,
      };
      return snapshot.credential;
    });
  }

  /** @param {string | undefined} macName */
  updateMacName(macName) {
    const nextName = String(macName || "").trim();
    return this.#repository.mutate((snapshot) => {
      const existing = snapshot.credential;
      if (!existing) throw new Error("SQLite pairing authority is active but no pairing credential exists.");
      if (!nextName || nextName === existing.macName) return existing;
      snapshot.credential = { ...existing, macName: nextName, updatedAt: new Date().toISOString() };
      return snapshot.credential;
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

  /** @param {string | undefined | null} token */
  tokenMatches(token) {
    const expected = this.current().token;
    if (!expected || !token) return false;
    const left = Buffer.from(String(expected), "utf8");
    const right = Buffer.from(String(token), "utf8");
    return left.length === right.length && timingSafeEqual(left, right);
  }
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 15 * 60 * 1000;

export class SqlitePairingInviteStore {
  #repository;
  #ttlMs;
  #now;

  /** @param {{ repository: SqlitePairingMutationRepository, ttlMs?: number, now?: () => number }} options */
  constructor({ repository, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() }) {
    this.#repository = repository;
    this.#ttlMs = normalizeTTL(ttlMs);
    this.#now = now;
  }

  /** @param {{ pairing: PairingCredentialRecord, ttlMs?: number }} input */
  create({ pairing, ttlMs = this.#ttlMs }) {
    if (!pairing?.token || !pairing.installationID) throw new Error("Pairing state is unavailable.");
    const lifetime = normalizeTTL(ttlMs);
    const invite = randomBytes(32).toString("base64url");
    const inviteHash = digest(invite);
    const result = this.#repository.mutate((snapshot) => {
      assertCredential(snapshot, pairing.installationID);
      const now = this.#now();
      snapshot.invitations = snapshot.invitations.filter((item) => Date.parse(item.expiresAt) > now);
      /** @type {PairingInvitationRecord} */
      const record = {
        id: randomUUID(),
        inviteHash,
        installationID: pairing.installationID,
        clientNonce: null,
        claimed: false,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + lifetime).toISOString(),
      };
      snapshot.invitations.push(record);
      return { expiresAt: record.expiresAt };
    });
    return { invite, expiresAt: result.expiresAt };
  }

  /** @param {string} invite @param {string} clientNonce @param {PairingCredentialRecord} pairing */
  claim(invite, clientNonce, pairing) {
    const normalizedInvite = String(invite || "");
    const normalizedNonce = String(clientNonce || "");
    if (!/^[A-Za-z0-9_-]{32,}$/.test(normalizedInvite)
        || !/^[A-Za-z0-9_-]{8,128}$/.test(normalizedNonce)) {
      return { ok: false, code: "malformed" };
    }
    return this.#repository.mutate((snapshot) => {
      const now = this.#now();
      const inviteHash = digest(normalizedInvite);
      const record = snapshot.invitations.find((item) => equalDigest(item.inviteHash, inviteHash));
      if (!record || record.installationID !== pairing.installationID) {
        return { ok: false, code: "expired" };
      }
      if (Date.parse(record.expiresAt) <= now) {
        snapshot.invitations = snapshot.invitations.filter((item) => Date.parse(item.expiresAt) > now);
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
      return { ok: true, expiresAt: record.expiresAt, idempotent: false, pairing };
    });
  }

  /** @param {string} invite @param {PairingCredentialRecord | undefined} [pairing] */
  inspect(invite, pairing = undefined) {
    const normalizedInvite = String(invite || "");
    if (!/^[A-Za-z0-9_-]{32,}$/.test(normalizedInvite)) return null;
    return this.#repository.mutate((snapshot) => {
      const now = this.#now();
      const inviteHash = digest(normalizedInvite);
      const record = snapshot.invitations.find((item) => equalDigest(item.inviteHash, inviteHash));
      if (!record || (pairing !== undefined && record.installationID !== pairing.installationID)
          || Date.parse(record.expiresAt) <= now) {
        snapshot.invitations = snapshot.invitations.filter((item) => Date.parse(item.expiresAt) > now);
        return null;
      }
      return { expiresAt: record.expiresAt, claimed: Boolean(record.claimed) };
    });
  }

  cleanup() {
    return this.#repository.mutate((snapshot) => {
      const now = this.#now();
      snapshot.invitations = snapshot.invitations.filter(
        (item) => Date.parse(item.expiresAt) > now && !item.claimed,
      );
      return snapshot.invitations.length;
    });
  }
}

/** @param {PairingMutableSnapshot} snapshot @param {string} installationID */
function assertCredential(snapshot, installationID) {
  if (!snapshot.credential || snapshot.credential.installationID !== installationID) {
    throw new Error("Pairing invitation does not match the SQLite pairing credential.");
  }
}

/** @param {unknown} value */
function normalizeTTL(value) {
  const ttlMs = Number(value);
  if (!Number.isFinite(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) {
    throw new Error("Pairing invite TTL must be between 1 and 15 minutes.");
  }
  return ttlMs;
}

/** @param {string} value */
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} a @param {string} b */
function equalDigest(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** @param {unknown} value */
function isThenable(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof /** @type {{ then?: unknown }} */ (value).then === "function"
  );
}

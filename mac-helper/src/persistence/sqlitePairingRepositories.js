// @ts-check

import {
  parsePairingCredential,
  parsePairingInvitation,
} from "../contracts/pairing.js";

/** @typedef {import("../contracts/pairing.js").PairingCredentialRecord} PairingCredentialRecord */
/** @typedef {import("../contracts/pairing.js").PairingInvitationRecord} PairingInvitationRecord */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

export class SqlitePairingCredentialRepository {
  #getStatement;
  #listStatement;
  #upsertStatement;
  #deleteAllStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#getStatement = database.prepare(`SELECT
      installation_id,
      token,
      mac_name,
      created_at,
      updated_at
    FROM pairing_credentials
    WHERE singleton = 1 AND installation_id = ?`);
    this.#listStatement = database.prepare(`SELECT
      installation_id,
      token,
      mac_name,
      created_at,
      updated_at
    FROM pairing_credentials
    WHERE singleton = 1`);
    this.#upsertStatement = database.prepare(`INSERT INTO pairing_credentials(
      singleton,
      installation_id,
      token,
      mac_name,
      created_at,
      updated_at
    ) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      installation_id = excluded.installation_id,
      token = excluded.token,
      mac_name = excluded.mac_name,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at`);
    this.#deleteAllStatement = database.prepare("DELETE FROM pairing_credentials");
  }

  /** @param {string} installationID @returns {PairingCredentialRecord | null} */
  get(installationID) {
    const row = this.#getStatement.get(
      requireNonEmptyString(installationID, "Pairing installationID"),
    );
    return row ? mapCredentialRow(row) : null;
  }

  /** @returns {PairingCredentialRecord[]} */
  list() {
    return this.#listStatement.all().map(mapCredentialRow);
  }

  /** @param {PairingCredentialRecord} record */
  upsert(record) {
    const credential = parsePairingCredential(record);
    this.#upsertStatement.run(
      credential.installationID,
      credential.token,
      credential.macName,
      credential.createdAt,
      credential.updatedAt,
    );
  }

  /** @param {readonly PairingCredentialRecord[]} records */
  replaceAll(records) {
    if (!Array.isArray(records)) throw new Error("Replacement records must be an array.");
    if (records.length > 1) {
      throw new Error("Pairing shadow state may contain at most one credential.");
    }
    this.#deleteAllStatement.run();
    if (records[0]) this.upsert(records[0]);
  }
}

export class SqlitePairingInvitationRepository {
  #getStatement;
  #findByInviteHashStatement;
  #listStatement;
  #upsertStatement;
  #deleteAllStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#getStatement = database.prepare(`SELECT
      id,
      invite_hash,
      installation_id,
      client_nonce,
      claimed,
      created_at,
      expires_at,
      claimed_at
    FROM pairing_invitations
    WHERE id = ?`);
    this.#findByInviteHashStatement = database.prepare(`SELECT
      id,
      invite_hash,
      installation_id,
      client_nonce,
      claimed,
      created_at,
      expires_at,
      claimed_at
    FROM pairing_invitations
    WHERE invite_hash = ?`);
    this.#listStatement = database.prepare(`SELECT
      id,
      invite_hash,
      installation_id,
      client_nonce,
      claimed,
      created_at,
      expires_at,
      claimed_at
    FROM pairing_invitations
    ORDER BY id`);
    this.#upsertStatement = database.prepare(`INSERT INTO pairing_invitations(
      id,
      invite_hash,
      installation_id,
      client_nonce,
      claimed,
      created_at,
      expires_at,
      claimed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      invite_hash = excluded.invite_hash,
      installation_id = excluded.installation_id,
      client_nonce = excluded.client_nonce,
      claimed = excluded.claimed,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      claimed_at = excluded.claimed_at`);
    this.#deleteAllStatement = database.prepare("DELETE FROM pairing_invitations");
  }

  /** @param {string} id @returns {PairingInvitationRecord | null} */
  get(id) {
    const row = this.#getStatement.get(requireNonEmptyString(id, "Pairing invitation id"));
    return row ? mapInvitationRow(row) : null;
  }

  /** @param {string} inviteHash @returns {PairingInvitationRecord | null} */
  findByInviteHash(inviteHash) {
    const row = this.#findByInviteHashStatement.get(requireInviteHash(inviteHash));
    return row ? mapInvitationRow(row) : null;
  }

  /** @returns {PairingInvitationRecord[]} */
  list() {
    return this.#listStatement.all().map(mapInvitationRow);
  }

  /** @param {PairingInvitationRecord} record */
  upsert(record) {
    const invitation = validateInvitation(record);
    this.#upsertStatement.run(
      invitation.id,
      invitation.inviteHash,
      invitation.installationID,
      invitation.clientNonce,
      invitation.claimed ? 1 : 0,
      invitation.createdAt,
      invitation.expiresAt,
      invitation.claimedAt ?? null,
    );
  }

  /** @param {readonly PairingInvitationRecord[]} records */
  replaceAll(records) {
    assertUnique(records, (record) => validateInvitation(record).id, "id");
    assertUnique(records, (record) => validateInvitation(record).inviteHash, "inviteHash");
    this.#deleteAllStatement.run();
    for (const record of records) this.upsert(record);
  }
}

/** @param {unknown} row @returns {PairingCredentialRecord} */
function mapCredentialRow(row) {
  const values = rowValues(row, "pairing credential");
  return parsePairingCredential({
    installationID: values.installation_id,
    token: values.token,
    macName: values.mac_name,
    createdAt: values.created_at,
    updatedAt: values.updated_at,
  });
}

/** @param {unknown} row @returns {PairingInvitationRecord} */
function mapInvitationRow(row) {
  const values = rowValues(row, "pairing invitation");
  const claimed = values.claimed;
  if (claimed !== 0 && claimed !== 1) {
    throw new Error("SQLite returned an invalid pairing invitation claimed flag.");
  }
  const candidate = {
    id: values.id,
    inviteHash: values.invite_hash,
    installationID: values.installation_id,
    clientNonce: values.client_nonce,
    claimed: claimed === 1,
    createdAt: values.created_at,
    expiresAt: values.expires_at,
    ...(values.claimed_at === null ? {} : { claimedAt: values.claimed_at }),
  };
  return validateInvitation(candidate);
}

/** @param {unknown} value @returns {PairingInvitationRecord} */
function validateInvitation(value) {
  const invitation = parsePairingInvitation(value);
  requireInviteHash(invitation.inviteHash);
  return invitation;
}

/** @param {unknown} row @param {string} label */
function rowValues(row, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`SQLite returned an invalid ${label} row.`);
  }
  return /** @type {Record<string, unknown>} */ (row);
}

/** @param {unknown} value */
function requireInviteHash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Pairing invitation inviteHash must be a lowercase SHA-256 digest.");
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

/**
 * @template T
 * @param {readonly T[]} records
 * @param {(record: T) => string} keyFor
 * @param {string} label
 */
function assertUnique(records, keyFor, label) {
  if (!Array.isArray(records)) throw new Error("Replacement records must be an array.");
  const keys = new Set();
  for (const record of records) {
    const key = keyFor(record);
    if (keys.has(key)) throw new Error(`Duplicate pairing ${label}: ${key}.`);
    keys.add(key);
  }
}

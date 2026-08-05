// @ts-check

import { parsePairingCredential, parsePairingInvitation } from "../contracts/pairing.js";

/** @typedef {import("../contracts/pairing.js").PairingCredentialRecord} PairingCredentialRecord */
/** @typedef {import("../contracts/pairing.js").PairingInvitationRecord} PairingInvitationRecord */
/** @typedef {import("../contracts/repository.js").PairingStateSnapshot} PairingStateSnapshot */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

export class SqlitePairingStateRepository {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  #readSnapshotStatement;
  #getCredentialStatement;
  #getInvitationStatement;
  #findInvitationByHashStatement;
  #insertCredentialStatement;
  #insertInvitationStatement;
  #deleteInvitationsStatement;
  #deleteCredentialStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#database = database;
    this.#readSnapshotStatement = database.prepare(`SELECT
      'credential' AS row_kind,
      installation_id,
      token,
      mac_name,
      NULL AS id,
      NULL AS invite_hash,
      NULL AS client_nonce,
      NULL AS claimed,
      created_at,
      updated_at,
      NULL AS expires_at,
      NULL AS claimed_at
    FROM pairing_credentials
    UNION ALL
    SELECT
      'invitation' AS row_kind,
      installation_id,
      NULL AS token,
      NULL AS mac_name,
      id,
      invite_hash,
      client_nonce,
      claimed,
      created_at,
      NULL AS updated_at,
      expires_at,
      claimed_at
    FROM pairing_invitations
    ORDER BY row_kind, id`);
    this.#getCredentialStatement = database.prepare(`SELECT
      installation_id,
      token,
      mac_name,
      created_at,
      updated_at
    FROM pairing_credentials
    WHERE singleton = 1 AND installation_id = ?`);
    this.#getInvitationStatement = database.prepare(`SELECT
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
    this.#findInvitationByHashStatement = database.prepare(`SELECT
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
    this.#insertCredentialStatement = database.prepare(`INSERT INTO pairing_credentials(
      singleton,
      installation_id,
      token,
      mac_name,
      created_at,
      updated_at
    ) VALUES (1, ?, ?, ?, ?, ?)`);
    this.#insertInvitationStatement = database.prepare(`INSERT INTO pairing_invitations(
      id,
      invite_hash,
      installation_id,
      client_nonce,
      claimed,
      created_at,
      expires_at,
      claimed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    this.#deleteInvitationsStatement = database.prepare("DELETE FROM pairing_invitations");
    this.#deleteCredentialStatement = database.prepare("DELETE FROM pairing_credentials");
  }

  /** @returns {PairingStateSnapshot} */
  read() {
    /** @type {PairingCredentialRecord | null} */
    let credential = null;
    /** @type {PairingInvitationRecord[]} */
    const invitations = [];
    for (const row of this.#readSnapshotStatement.all()) {
      const values = rowValues(row, "pairing snapshot");
      if (values.row_kind === "credential") {
        if (credential) throw new Error("SQLite returned multiple pairing credentials.");
        credential = mapCredentialRow(values);
      } else if (values.row_kind === "invitation") {
        invitations.push(mapInvitationRow(values));
      } else {
        throw new Error("SQLite returned an invalid pairing snapshot row kind.");
      }
    }
    return normalizePairingStateSnapshot({ credential, invitations });
  }

  /** @param {PairingStateSnapshot} snapshot */
  replace(snapshot) {
    const normalized = normalizePairingStateSnapshot(snapshot);
    this.#database.transaction(() => {
      this.#deleteInvitationsStatement.run();
      this.#deleteCredentialStatement.run();
      if (normalized.credential) {
        insertCredential(this.#insertCredentialStatement, normalized.credential);
      }
      for (const invitation of normalized.invitations) {
        insertInvitation(this.#insertInvitationStatement, invitation);
      }
    });
  }

  /** @param {string} installationID @returns {PairingCredentialRecord | null} */
  getCredential(installationID) {
    const row = this.#getCredentialStatement.get(
      requireNonEmptyString(installationID, "Pairing installationID"),
    );
    return row ? mapCredentialRow(row) : null;
  }

  /** @param {string} id @returns {PairingInvitationRecord | null} */
  getInvitation(id) {
    const row = this.#getInvitationStatement.get(
      requireNonEmptyString(id, "Pairing invitation id"),
    );
    return row ? mapInvitationRow(row) : null;
  }

  /** @param {string} inviteHash @returns {PairingInvitationRecord | null} */
  findInvitationByInviteHash(inviteHash) {
    const row = this.#findInvitationByHashStatement.get(requireInviteHash(inviteHash));
    return row ? mapInvitationRow(row) : null;
  }
}

/** @param {PairingStateSnapshot} value @returns {PairingStateSnapshot} */
export function normalizePairingStateSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing state snapshot must be an object.");
  }
  const credential = value.credential === null ? null : normalizeCredential(value.credential);
  if (!Array.isArray(value.invitations)) {
    throw new Error("Pairing state invitations must be an array.");
  }
  const invitations = value.invitations.map(normalizeInvitation).sort(compareInvitationIDs);
  assertUnique(invitations, (record) => record.id, "id");
  assertUnique(invitations, (record) => record.inviteHash, "inviteHash");
  if (!credential && invitations.length > 0) {
    throw new Error("Pairing invitations cannot exist without a pairing credential.");
  }
  if (
    credential &&
    invitations.some((record) => record.installationID !== credential.installationID)
  ) {
    throw new Error("Pairing invitations must belong to the snapshot credential.");
  }
  return { credential, invitations };
}

/** @param {unknown} value @returns {PairingCredentialRecord} */
function normalizeCredential(value) {
  const credential = parsePairingCredential(value);
  const createdAt = requireTimestamp(credential.createdAt, "Pairing credential createdAt");
  const updatedAt = requireTimestamp(credential.updatedAt, "Pairing credential updatedAt");
  if (updatedAt.time < createdAt.time) {
    throw new Error("Pairing credential updatedAt cannot precede createdAt.");
  }
  return {
    token: requireNonEmptyString(credential.token, "Pairing credential token"),
    installationID: requireNonEmptyString(
      credential.installationID,
      "Pairing credential installationID",
    ),
    macName: requireNonEmptyString(credential.macName, "Pairing credential macName"),
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
  };
}

/** @param {unknown} value @returns {PairingInvitationRecord} */
function normalizeInvitation(value) {
  const invitation = parsePairingInvitation(value);
  const createdAt = requireTimestamp(invitation.createdAt, "Pairing invitation createdAt");
  const expiresAt = requireTimestamp(invitation.expiresAt, "Pairing invitation expiresAt");
  if (expiresAt.time <= createdAt.time) {
    throw new Error("Pairing invitation expiresAt must follow createdAt.");
  }

  if (!invitation.claimed) {
    if (invitation.clientNonce !== null || invitation.claimedAt !== undefined) {
      throw new Error("Unclaimed pairing invitations cannot contain claim evidence.");
    }
    return {
      id: requireNonEmptyString(invitation.id, "Pairing invitation id"),
      inviteHash: requireInviteHash(invitation.inviteHash),
      installationID: requireNonEmptyString(
        invitation.installationID,
        "Pairing invitation installationID",
      ),
      clientNonce: null,
      claimed: false,
      createdAt: createdAt.value,
      expiresAt: expiresAt.value,
    };
  }

  const clientNonce = requireNonEmptyString(
    invitation.clientNonce,
    "Claimed pairing invitation clientNonce",
  );
  const claimedAt = requireTimestamp(invitation.claimedAt, "Claimed pairing invitation claimedAt");
  if (claimedAt.time < createdAt.time || claimedAt.time >= expiresAt.time) {
    throw new Error("Pairing invitation claimedAt must be within its active interval.");
  }
  return {
    id: requireNonEmptyString(invitation.id, "Pairing invitation id"),
    inviteHash: requireInviteHash(invitation.inviteHash),
    installationID: requireNonEmptyString(
      invitation.installationID,
      "Pairing invitation installationID",
    ),
    clientNonce,
    claimed: true,
    createdAt: createdAt.value,
    expiresAt: expiresAt.value,
    claimedAt: claimedAt.value,
  };
}

/** @param {unknown} row @returns {PairingCredentialRecord} */
function mapCredentialRow(row) {
  const values = rowValues(row, "pairing credential");
  return normalizeCredential({
    token: values.token,
    installationID: values.installation_id,
    macName: values.mac_name,
    createdAt: values.created_at,
    updatedAt: values.updated_at,
  });
}

/** @param {unknown} row @returns {PairingInvitationRecord} */
function mapInvitationRow(row) {
  const values = rowValues(row, "pairing invitation");
  if (values.claimed !== 0 && values.claimed !== 1) {
    throw new Error("SQLite returned an invalid pairing invitation claimed flag.");
  }
  return normalizeInvitation({
    id: values.id,
    inviteHash: values.invite_hash,
    installationID: values.installation_id,
    clientNonce: values.client_nonce,
    claimed: values.claimed === 1,
    createdAt: values.created_at,
    expiresAt: values.expires_at,
    ...(values.claimed_at === null ? {} : { claimedAt: values.claimed_at }),
  });
}

/** @param {import("node:sqlite").StatementSync} statement @param {PairingCredentialRecord} record */
function insertCredential(statement, record) {
  statement.run(
    record.installationID,
    record.token,
    record.macName,
    record.createdAt,
    record.updatedAt,
  );
}

/** @param {import("node:sqlite").StatementSync} statement @param {PairingInvitationRecord} record */
function insertInvitation(statement, record) {
  statement.run(
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
function requireTimestamp(value, label) {
  const normalized = requireNonEmptyString(value, label);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) throw new Error(`${label} must be a valid timestamp.`);
  return { value: normalized, time };
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

/** @param {PairingInvitationRecord} left @param {PairingInvitationRecord} right */
function compareInvitationIDs(left, right) {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * @template T
 * @param {readonly T[]} records
 * @param {(record: T) => string} keyFor
 * @param {string} label
 */
function assertUnique(records, keyFor, label) {
  const keys = new Set();
  for (const record of records) {
    const key = keyFor(record);
    if (keys.has(key)) throw new Error(`Duplicate pairing ${label}: ${key}.`);
    keys.add(key);
  }
}

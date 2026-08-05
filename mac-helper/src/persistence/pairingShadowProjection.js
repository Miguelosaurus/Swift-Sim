// @ts-check

import { createHash } from "node:crypto";
import {
  parsePairingCredential,
  parsePairingInvitation,
} from "../contracts/pairing.js";

/** @typedef {import("../contracts/pairing.js").PairingCredentialRecord} PairingCredentialRecord */
/** @typedef {import("../contracts/pairing.js").PairingInvitationRecord} PairingInvitationRecord */

/**
 * @typedef {{
 *   credential: PairingCredentialRecord | null,
 *   invitations: PairingInvitationRecord[],
 * }} PairingShadowProjection
 */

/**
 * @param {{
 *   credential?: unknown,
 *   invitations?: unknown,
 * }} value
 * @returns {PairingShadowProjection}
 */
export function normalizePairingShadowProjection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing shadow projection must be an object.");
  }
  const credential =
    value.credential === undefined || value.credential === null
      ? null
      : parsePairingCredential(value.credential);
  if (!Array.isArray(value.invitations)) {
    throw new Error("Pairing shadow invitations must be an array.");
  }
  const invitations = value.invitations.map((record) => {
    const invitation = parsePairingInvitation(record);
    if (!/^[a-f0-9]{64}$/.test(invitation.inviteHash)) {
      throw new Error("Pairing invitation inviteHash must be a lowercase SHA-256 digest.");
    }
    return invitation;
  });
  invitations.sort((left, right) => left.id.localeCompare(right.id));

  assertUnique(invitations, (record) => record.id, "id");
  assertUnique(invitations, (record) => record.inviteHash, "inviteHash");
  if (!credential && invitations.length > 0) {
    throw new Error("Pairing invitations cannot be imported without a pairing credential.");
  }
  if (
    credential &&
    invitations.some((record) => record.installationID !== credential.installationID)
  ) {
    throw new Error("Pairing invitations must belong to the imported installation.");
  }

  return {
    credential: credential ? canonicalCredential(credential) : null,
    invitations: invitations.map(canonicalInvitation),
  };
}

/** @param {PairingShadowProjection} projection */
export function pairingShadowProjectionHash(projection) {
  const normalized = normalizePairingShadowProjection(projection);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/** @param {PairingShadowProjection} projection */
export function pairingShadowProjectionRecordCount(projection) {
  const normalized = normalizePairingShadowProjection(projection);
  return normalized.invitations.length + (normalized.credential ? 1 : 0);
}

/** @param {PairingCredentialRecord} record @returns {PairingCredentialRecord} */
function canonicalCredential(record) {
  return {
    token: record.token,
    installationID: record.installationID,
    macName: record.macName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** @param {PairingInvitationRecord} record @returns {PairingInvitationRecord} */
function canonicalInvitation(record) {
  return {
    id: record.id,
    inviteHash: record.inviteHash,
    installationID: record.installationID,
    clientNonce: record.clientNonce,
    claimed: record.claimed,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.claimedAt === undefined ? {} : { claimedAt: record.claimedAt }),
  };
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

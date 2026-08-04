import {
  hasBoolean,
  hasOptionalString,
  hasString,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

/** Canonical credential persisted by PairingStore. */
export interface PairingCredentialRecord {
  token: string;
  installationID: string;
  macName: string;
  createdAt: string;
  updatedAt: string;
}

/** One invitation persisted by PairingInviteStore; the secret itself is never persisted. */
export interface PairingInvitationRecord {
  id: string;
  inviteHash: string;
  installationID: string;
  clientNonce: string | null;
  claimed: boolean;
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
}

export interface PairingInviteResult {
  invite: string;
  expiresAt: string;
}

export type PairingClaimResult =
  | { ok: false; code: "malformed" | "expired" | "consumed" }
  | { ok: true; idempotent: boolean; expiresAt: string; pairing: PairingCredentialRecord };

export interface PairingInspection {
  expiresAt: string;
  claimed: boolean;
}

export interface PairingLinks {
  universalLink: string;
  customScheme: string;
}

export const isPairingCredential: Validator<PairingCredentialRecord> = (
  value,
): value is PairingCredentialRecord =>
  isRecord(value) &&
  hasString(value, "token") &&
  hasString(value, "installationID") &&
  hasString(value, "macName") &&
  hasString(value, "createdAt") &&
  hasString(value, "updatedAt");

export const isPairingInvitation: Validator<PairingInvitationRecord> = (
  value,
): value is PairingInvitationRecord =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasString(value, "inviteHash") &&
  hasString(value, "installationID") &&
  (value.clientNonce === null ||
    (typeof value.clientNonce === "string" && value.clientNonce.length > 0)) &&
  hasBoolean(value, "claimed") &&
  hasString(value, "createdAt") &&
  hasString(value, "expiresAt") &&
  hasOptionalString(value, "claimedAt");

export function parsePairingCredential(value: unknown): PairingCredentialRecord {
  return parseContract(value, isPairingCredential, "pairing credential");
}

export function parsePairingInvitation(value: unknown): PairingInvitationRecord {
  return parseContract(value, isPairingInvitation, "pairing invitation");
}

// Compatibility aliases now point to the real, separated records.
export const isPairingRecord = isPairingCredential;
export const parsePairingRecord = parsePairingCredential;

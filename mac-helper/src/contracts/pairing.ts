import {
  hasLiteral,
  hasNumber,
  hasOptionalString,
  hasString,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

export const PAIRING_STATES = ["pending", "claimed", "expired", "revoked"] as const;
export type PairingState = (typeof PAIRING_STATES)[number];

export interface PairingRecord {
  schemaVersion: number;
  installationID: string;
  invitationID: string;
  state: PairingState;
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
  credentialHash?: string;
}

export interface PublicPairingProjection {
  invitationID: string;
  state: PairingState;
  expiresAt: string;
}

export interface PrivatePairingProjection extends PublicPairingProjection {
  installationID: string;
  credentialHash?: string;
}

export const isPairingRecord: Validator<PairingRecord> = (value): value is PairingRecord => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasNumber(value, "schemaVersion") &&
    hasString(value, "installationID") &&
    hasString(value, "invitationID") &&
    hasLiteral(value, "state", PAIRING_STATES) &&
    hasString(value, "createdAt") &&
    hasString(value, "expiresAt") &&
    hasOptionalString(value, "claimedAt") &&
    hasOptionalString(value, "credentialHash")
  );
};

export function parsePairingRecord(value: unknown): PairingRecord {
  return parseContract(value, isPairingRecord, "pairing record");
}

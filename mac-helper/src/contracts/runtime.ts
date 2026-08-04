import {
  hasLiteral,
  hasNumber,
  hasOptionalString,
  hasString,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

export const RUNTIME_LEASE_STATES = ["held", "released", "expired"] as const;
export type RuntimeLeaseState = (typeof RUNTIME_LEASE_STATES)[number];

export interface RuntimeLease {
  schemaVersion: number;
  leaseID: string;
  owner: string;
  target: string;
  state: RuntimeLeaseState;
  acquiredAt: string;
  expiresAt: string;
}

export interface RuntimeJournalEntry {
  sequence: number;
  event: string;
  recordedAt: string;
  detail?: string;
}

export interface RuntimeJournal {
  schemaVersion: number;
  journalID: string;
  process: string;
  entries: readonly RuntimeJournalEntry[];
  closedAt?: string;
}

export interface PublicRuntimeLeaseProjection {
  leaseID: string;
  target: string;
  state: RuntimeLeaseState;
  expiresAt: string;
}

export const isRuntimeLease: Validator<RuntimeLease> = (value): value is RuntimeLease => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasNumber(value, "schemaVersion") &&
    hasString(value, "leaseID") &&
    hasString(value, "owner") &&
    hasString(value, "target") &&
    hasLiteral(value, "state", RUNTIME_LEASE_STATES) &&
    hasString(value, "acquiredAt") &&
    hasString(value, "expiresAt")
  );
};

const isRuntimeJournalEntry: Validator<RuntimeJournalEntry> = (
  value,
): value is RuntimeJournalEntry => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasNumber(value, "sequence") &&
    hasString(value, "event") &&
    hasString(value, "recordedAt") &&
    hasOptionalString(value, "detail")
  );
};

export const isRuntimeJournal: Validator<RuntimeJournal> = (value): value is RuntimeJournal => {
  if (!isRecord(value) || !hasNumber(value, "schemaVersion") || !hasString(value, "journalID")) {
    return false;
  }
  return (
    hasString(value, "process") &&
    Array.isArray(value.entries) &&
    value.entries.every(isRuntimeJournalEntry) &&
    hasOptionalString(value, "closedAt")
  );
};

export function parseRuntimeLease(value: unknown): RuntimeLease {
  return parseContract(value, isRuntimeLease, "runtime lease");
}

export function parseRuntimeJournal(value: unknown): RuntimeJournal {
  return parseContract(value, isRuntimeJournal, "runtime journal");
}

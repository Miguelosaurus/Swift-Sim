import {
  hasOptionalString,
  hasString,
  isInteger,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";
import { isDeliveryProcessIdentity, type DeliveryProcessIdentity } from "./process.js";

export interface DeliveryGenerationState {
  generation: string;
  status: string;
  provider?: string;
  publicBaseUrl?: string;
  createdAt?: string;
  expiresAt?: string;
  localBaseUrl?: string;
  error?: string;
  updatedAt?: string;
  stoppedAt?: string;
  references?: readonly string[];
  managerIdentity?: DeliveryProcessIdentity | null;
  gatewayIdentity?: DeliveryProcessIdentity | null;
  tunnelIdentity?: DeliveryProcessIdentity | null;
  managerPid?: number | null;
  gatewayPid?: number | null;
  tunnelPid?: number | null;
}

export interface ArtifactCleanupJob {
  id: string;
  root: string;
  buildId?: string;
  createdAt: string;
  notBefore?: string;
  nextAttemptAt?: string;
  attempts: number;
  lastError: string;
  updatedAt?: string;
}

export interface DeliveryReferenceCleanupJob {
  id: string;
  generation: string;
  referenceID: string;
  buildId: string;
  createdAt: string;
  nextAttemptAt: string;
  attempts: number;
  lastError: string;
  updatedAt?: string;
}

export interface DeviceBuildCancellationJournal {
  buildId: string;
  reason: string;
  cancelledAt: string;
}

export interface RenewalCancellationJournal extends DeviceBuildCancellationJournal {
  scope: "renewal";
  renewalID: string;
  owner: { pid: number; startedAt: string };
}

export interface LockOwnerRecord {
  pid: number;
  startedAt: string;
  nonce: string;
  createdAt: string;
}

export type RuntimeLease = DeliveryGenerationState;
export type RuntimeJournal = DeviceBuildCancellationJournal | RenewalCancellationJournal;

export const isDeliveryGenerationState: Validator<DeliveryGenerationState> = (
  value,
): value is DeliveryGenerationState => {
  if (!isRecord(value) || !hasString(value, "generation") || !hasString(value, "status"))
    return false;
  if (
    !optionalStrings(value, [
      "provider",
      "publicBaseUrl",
      "createdAt",
      "expiresAt",
      "localBaseUrl",
      "error",
      "updatedAt",
      "stoppedAt",
    ])
  )
    return false;
  if (
    value.references !== undefined &&
    (!Array.isArray(value.references) ||
      !value.references.every((item) => typeof item === "string"))
  )
    return false;
  if (
    !optionalIdentity(value, "managerIdentity") ||
    !optionalIdentity(value, "gatewayIdentity") ||
    !optionalIdentity(value, "tunnelIdentity")
  )
    return false;
  return (
    optionalPid(value, "managerPid") &&
    optionalPid(value, "gatewayPid") &&
    optionalPid(value, "tunnelPid")
  );
};

export const isRuntimeLease = isDeliveryGenerationState;

export const isArtifactCleanupJob: Validator<ArtifactCleanupJob> = (
  value,
): value is ArtifactCleanupJob =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasString(value, "root") &&
  hasString(value, "createdAt") &&
  isInteger(value.attempts) &&
  value.attempts >= 0 &&
  hasString(value, "lastError") &&
  optionalStrings(value, ["buildId", "notBefore", "nextAttemptAt", "updatedAt"]);

export const isDeliveryReferenceCleanupJob: Validator<DeliveryReferenceCleanupJob> = (
  value,
): value is DeliveryReferenceCleanupJob =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasString(value, "generation") &&
  hasString(value, "referenceID") &&
  hasString(value, "buildId") &&
  hasString(value, "createdAt") &&
  hasString(value, "nextAttemptAt") &&
  isInteger(value.attempts) &&
  value.attempts >= 0 &&
  hasString(value, "lastError") &&
  optionalStrings(value, ["updatedAt"]);

export const isRuntimeJournal: Validator<RuntimeJournal> = (value): value is RuntimeJournal =>
  isRecord(value) &&
  hasString(value, "buildId") &&
  hasString(value, "reason") &&
  hasString(value, "cancelledAt") &&
  (value.scope === undefined ||
    (value.scope === "renewal" &&
      hasString(value, "renewalID") &&
      isRecord(value.owner) &&
      isInteger(value.owner.pid) &&
      value.owner.pid > 0 &&
      hasString(value.owner, "startedAt")));

export const isLockOwnerRecord: Validator<LockOwnerRecord> = (value): value is LockOwnerRecord =>
  isRecord(value) &&
  isInteger(value.pid) &&
  value.pid > 0 &&
  hasString(value, "startedAt") &&
  hasString(value, "nonce") &&
  hasString(value, "createdAt");

export function parseRuntimeLease(value: unknown): RuntimeLease {
  return parseContract(value, isRuntimeLease, "delivery generation lease");
}

export function parseRuntimeJournal(value: unknown): RuntimeJournal {
  return parseContract(value, isRuntimeJournal, "runtime cancellation journal");
}

function optionalStrings(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => hasOptionalString(record, key));
}

function optionalIdentity(record: Record<string, unknown>, key: string): boolean {
  return (
    !Object.prototype.hasOwnProperty.call(record, key) ||
    record[key] === null ||
    isDeliveryProcessIdentity(record[key])
  );
}

function optionalPid(record: Record<string, unknown>, key: string): boolean {
  return (
    !Object.prototype.hasOwnProperty.call(record, key) ||
    record[key] === null ||
    (isInteger(record[key]) && Number(record[key]) >= 0)
  );
}

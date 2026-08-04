import { hasString, isInteger, isRecord, parseContract, type Validator } from "./validation.js";

/** Identity persisted for the manager, gateway, and tunnel in delivery state. */
export interface DeliveryProcessIdentity {
  pid: number;
  startedAt: string;
  commandFragments: readonly string[];
}

/** Identity persisted for a detached build or validation worker. */
export interface OwnedWorkerProcessRecord {
  version: 2;
  pid: number;
  processGroup: number;
  startToken: string;
  executable: string;
  command: string;
  createdAt: string;
}

/** Identity persisted for the detached InjectionNext process. */
export interface LiveEngineProcessRecord {
  version: 2;
  pid: number;
  processGroup: number;
  startToken: string;
  executable: string;
  instanceNonce: string;
  recordNonce: string;
  createdAt: string;
}

export type ProcessIdentity = DeliveryProcessIdentity;

export const isDeliveryProcessIdentity: Validator<DeliveryProcessIdentity> = (
  value,
): value is DeliveryProcessIdentity =>
  isRecord(value) &&
  isInteger(value.pid) &&
  value.pid > 0 &&
  hasString(value, "startedAt") &&
  Array.isArray(value.commandFragments) &&
  value.commandFragments.every((fragment) => typeof fragment === "string" && fragment.length > 0) &&
  hasNoExplicitUndefined(value, ["pid", "startedAt", "commandFragments"]);

export const isProcessIdentity = isDeliveryProcessIdentity;

export const isOwnedWorkerProcessRecord: Validator<OwnedWorkerProcessRecord> = (
  value,
): value is OwnedWorkerProcessRecord =>
  isRecord(value) &&
  value.version === 2 &&
  isInteger(value.pid) &&
  value.pid > 1 &&
  isInteger(value.processGroup) &&
  value.processGroup === value.pid &&
  hasString(value, "startToken") &&
  hasString(value, "executable") &&
  hasString(value, "command") &&
  hasString(value, "createdAt");

export const isLiveEngineProcessRecord: Validator<LiveEngineProcessRecord> = (
  value,
): value is LiveEngineProcessRecord =>
  isRecord(value) &&
  value.version === 2 &&
  isInteger(value.pid) &&
  value.pid > 1 &&
  isInteger(value.processGroup) &&
  value.processGroup === value.pid &&
  hasString(value, "startToken") &&
  hasString(value, "executable") &&
  hasString(value, "instanceNonce") &&
  hasString(value, "recordNonce") &&
  hasString(value, "createdAt");

export function parseProcessIdentity(value: unknown): ProcessIdentity {
  return parseContract(value, isProcessIdentity, "delivery process identity");
}

export function parseOwnedWorkerProcessRecord(value: unknown): OwnedWorkerProcessRecord {
  return parseContract(value, isOwnedWorkerProcessRecord, "owned worker process record");
}

export function parseLiveEngineProcessRecord(value: unknown): LiveEngineProcessRecord {
  return parseContract(value, isLiveEngineProcessRecord, "live engine process record");
}

function hasNoExplicitUndefined(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => value[key] !== undefined);
}

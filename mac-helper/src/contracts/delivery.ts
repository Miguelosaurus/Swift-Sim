import * as canonicalDelivery from "../changeDeliveryContract.js";
import {
  hasBoolean,
  hasOptionalString,
  hasStringValue,
  isFiniteNumber,
  isInteger,
  isNonEmptyString,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

export const DELIVERY_SCHEMA_VERSION = 1 as const;
export const DELIVERY_OUTCOMES = [
  "hot-reloaded",
  "install-link-ready",
  "no-change",
  "needs-user-action",
  "failed",
] as const;

export interface LiveDelivery {
  kind: "live";
  revision: number;
}

export interface InstallDelivery {
  kind: "install";
  universalLink: string;
  customScheme?: string;
  state: string;
  expiresAt?: string;
  preserveData: boolean;
}

export interface DeliveryTiming {
  totalMs: number;
  classificationMs?: number;
}

export interface DeliveryNotice {
  code: string;
  message: string;
}

export type DeliveryDiagnostics = Readonly<Record<string, unknown>>;

interface DeliveryEnvelopeCommon {
  schemaVersion: 1;
  message: string;
  reasonCode?: string;
  timing?: DeliveryTiming;
  error?: DeliveryNotice;
  warning?: DeliveryNotice;
  diagnostics?: DeliveryDiagnostics;
}

export type DeliveryEnvelope = DeliveryEnvelopeCommon &
  (
    | { outcome: "hot-reloaded"; delivery: LiveDelivery }
    | { outcome: "install-link-ready"; delivery: InstallDelivery }
    | { outcome: "no-change"; delivery?: never }
    | { outcome: "needs-user-action"; error: DeliveryNotice; delivery?: never }
    | { outcome: "failed"; delivery?: never }
  );

interface DeliveryEnvelopeInputCommon {
  message: string;
  reasonCode?: string;
  timing?: DeliveryTiming;
  error?: DeliveryNotice;
  warning?: DeliveryNotice;
  diagnostics?: DeliveryDiagnostics;
}

export type DeliveryEnvelopeInput = DeliveryEnvelopeInputCommon &
  (
    | { outcome: "hot-reloaded"; delivery: LiveDelivery }
    | { outcome: "install-link-ready"; delivery: InstallDelivery }
    | { outcome: "no-change"; delivery?: never }
    | { outcome: "needs-user-action"; error: DeliveryNotice; delivery?: never }
    | { outcome: "failed"; delivery?: never }
  );

/** Typed boundary around the permissive JavaScript builder. */
export function deliveryEnvelope(input: DeliveryEnvelopeInput): DeliveryEnvelope {
  const value: unknown = Reflect.apply(canonicalDelivery.deliveryEnvelope, undefined, [input]);
  return parseContract(value, isDeliveryEnvelope, "delivery envelope");
}

export function validateDeliveryEnvelope(value: unknown): { valid: boolean; errors: string[] } {
  const canonical = canonicalDelivery.validateDeliveryEnvelope(value);
  const errors = [...canonical.errors];
  if (canonical.valid && !isTypedDeliveryEnvelope(value)) {
    errors.push("Envelope does not satisfy the typed delivery contract.");
  }
  return { valid: errors.length === 0, errors };
}

export type DeliveryOutcome = DeliveryEnvelope["outcome"];

export const isDeliveryEnvelope: Validator<DeliveryEnvelope> = (value): value is DeliveryEnvelope =>
  validateDeliveryEnvelope(value).valid;

export const isDeliveryOutcome = isDeliveryEnvelope;

export function parseDeliveryEnvelope(value: unknown): DeliveryEnvelope {
  return parseContract(value, isDeliveryEnvelope, "delivery envelope");
}

export const parseDeliveryOutcome = parseDeliveryEnvelope;

function isTypedDeliveryEnvelope(value: unknown): value is DeliveryEnvelope {
  if (!isRecord(value) || containsExplicitUndefined(value)) return false;
  if (
    value.schemaVersion !== DELIVERY_SCHEMA_VERSION ||
    !isNonEmptyString(value.message) ||
    !hasOptionalString(value, "reasonCode") ||
    !optionalTiming(value, "timing") ||
    !optionalNotice(value, "error") ||
    !optionalNotice(value, "warning") ||
    !optionalDiagnostics(value, "diagnostics")
  )
    return false;

  switch (value.outcome) {
    case "hot-reloaded":
      return isLiveDelivery(value.delivery);
    case "install-link-ready":
      return isInstallDelivery(value.delivery);
    case "no-change":
      return !hasOwn(value, "delivery");
    case "needs-user-action":
      return !hasOwn(value, "delivery") && isNotice(value.error);
    case "failed":
      return !hasOwn(value, "delivery");
    default:
      return false;
  }
}

function isLiveDelivery(value: unknown): value is LiveDelivery {
  return (
    isRecord(value) && value.kind === "live" && isInteger(value.revision) && value.revision > 0
  );
}

function isInstallDelivery(value: unknown): value is InstallDelivery {
  return (
    isRecord(value) &&
    value.kind === "install" &&
    hasStringValue(value, "universalLink") &&
    isUserFacingLink(value.universalLink) &&
    hasStringValue(value, "state") &&
    hasBoolean(value, "preserveData") &&
    hasOptionalString(value, "customScheme") &&
    (!hasOwn(value, "customScheme") || isUserFacingLink(value.customScheme)) &&
    hasOptionalString(value, "expiresAt")
  );
}

function optionalTiming(record: Record<string, unknown>, key: string): boolean {
  if (!hasOwn(record, key)) return true;
  const value = record[key];
  return (
    isRecord(value) &&
    isNonNegativeNumber(value.totalMs) &&
    (!hasOwn(value, "classificationMs") || isNonNegativeNumber(value.classificationMs))
  );
}

function optionalNotice(record: Record<string, unknown>, key: string): boolean {
  return !hasOwn(record, key) || isNotice(record[key]);
}

function isNotice(value: unknown): value is DeliveryNotice {
  return isRecord(value) && hasStringValue(value, "code") && hasStringValue(value, "message");
}

function optionalDiagnostics(record: Record<string, unknown>, key: string): boolean {
  return !hasOwn(record, key) || (isRecord(record[key]) && !containsExplicitUndefined(record[key]));
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isUserFacingLink(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    (/^https:\/\//.test(value) || /^swift-sim:\/\//.test(value)) &&
    !/[\r\n]/.test(value)
  );
}

function containsExplicitUndefined(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(
    (child) => child === undefined || containsExplicitUndefined(child),
  );
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

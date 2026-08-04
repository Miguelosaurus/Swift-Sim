import * as canonicalDelivery from "../changeDeliveryContract.js";
import { parseContract, type Validator } from "./validation.js";

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

export interface DeliveryEnvelope {
  schemaVersion: 1;
  outcome: (typeof DELIVERY_OUTCOMES)[number];
  message: string;
  reasonCode?: string;
  delivery?: LiveDelivery | InstallDelivery;
  timing?: { totalMs: number };
  error?: { code: string; message: string };
  warning?: { code: string; message: string };
  diagnostics?: unknown;
}

export interface DeliveryEnvelopeInput {
  outcome?: string;
  message?: string;
  reasonCode?: string;
  delivery?: LiveDelivery | InstallDelivery;
  timing?: { totalMs: number };
  error?: { code: string; message: string };
  warning?: { code: string; message: string };
  diagnostics?: unknown;
}

export const deliveryEnvelope = canonicalDelivery.deliveryEnvelope as unknown as (
  input?: DeliveryEnvelopeInput,
) => DeliveryEnvelope;
export const validateDeliveryEnvelope = canonicalDelivery.validateDeliveryEnvelope as unknown as (
  value: unknown,
) => { valid: boolean; errors: string[] };

export type DeliveryOutcome = DeliveryEnvelope["outcome"];

export const isDeliveryEnvelope: Validator<DeliveryEnvelope> = (value): value is DeliveryEnvelope =>
  validateDeliveryEnvelope(value).valid && !containsExplicitUndefined(value);

// Kept as a compatibility name for callers of the Phase 1 scaffolding. The
// runtime implementation is the canonical changeDeliveryContract validator.
export const isDeliveryOutcome = isDeliveryEnvelope;

export function parseDeliveryEnvelope(value: unknown): DeliveryEnvelope {
  return parseContract(value, isDeliveryEnvelope, "delivery envelope");
}

export const parseDeliveryOutcome = parseDeliveryEnvelope;

function containsExplicitUndefined(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([, child]) => child === undefined || containsExplicitUndefined(child),
  );
}

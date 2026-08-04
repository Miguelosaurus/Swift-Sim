import {
  hasBoolean,
  hasLiteral,
  hasString,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

export interface LiveProof {
  sessionID: string;
  rootRevision: string;
  acknowledgedAt: string;
}

export interface DeliverySuccess {
  outcome: "livePatch" | "signedBuild";
  requestID: string;
  proof?: LiveProof;
  fallbackUsed: boolean;
}

export interface DeliveryFailure {
  outcome: "rejected" | "failed";
  requestID: string;
  reason: string;
  fallbackUsed: boolean;
}

export interface DeliveryPartial {
  outcome: "partialApplication";
  requestID: string;
  reason: string;
  fallbackUsed: boolean;
}

export type DeliveryOutcome = DeliverySuccess | DeliveryFailure | DeliveryPartial;

const isLiveProof: Validator<LiveProof> = (value): value is LiveProof => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasString(value, "sessionID") &&
    hasString(value, "rootRevision") &&
    hasString(value, "acknowledgedAt")
  );
};

export const isDeliveryOutcome: Validator<DeliveryOutcome> = (value): value is DeliveryOutcome => {
  if (!isRecord(value) || !hasString(value, "requestID") || !hasBoolean(value, "fallbackUsed")) {
    return false;
  }
  if (hasLiteral(value, "outcome", ["livePatch", "signedBuild"] as const)) {
    return value.proof === undefined || isLiveProof(value.proof);
  }
  return (
    hasString(value, "reason") &&
    (hasLiteral(value, "outcome", ["rejected", "failed"] as const) ||
      hasLiteral(value, "outcome", ["partialApplication"] as const))
  );
};

export function parseDeliveryOutcome(value: unknown): DeliveryOutcome {
  return parseContract(value, isDeliveryOutcome, "delivery outcome");
}

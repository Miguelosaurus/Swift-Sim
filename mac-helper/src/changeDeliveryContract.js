export const DELIVERY_SCHEMA_VERSION = 2;

export const DELIVERY_OUTCOMES = Object.freeze([
  "hot-reloaded",
  "queued",
  "install-link-ready",
  "no-change",
  "needs-user-action",
  "failed",
]);

const FORBIDDEN_KEYS = new Set([
  "archivePath",
  "deviceID",
  "deviceName",
  "deviceUDID",
  "ipaPath",
  "projectPath",
  "sourcePath",
  "teamID",
  "tailnetName",
  "localPort",
  "port",
  "host",
  "rawLog",
]);

export function deliveryEnvelope({
  outcome,
  message,
  reasonCode = "",
  fallbackReasonCode = "",
  rebuildReason = undefined,
  delivery = undefined,
  timing = undefined,
  error = undefined,
  warning = undefined,
  diagnostics = undefined,
} = {}) {
  const envelope = {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    outcome: String(outcome || ""),
    message: String(message || ""),
  };
  if (reasonCode) envelope.reasonCode = String(reasonCode);
  if (fallbackReasonCode) envelope.fallbackReasonCode = String(fallbackReasonCode);
  if (rebuildReason !== undefined) envelope.rebuildReason = rebuildReason;
  if (delivery !== undefined) envelope.delivery = delivery;
  if (timing !== undefined) envelope.timing = timing;
  if (error !== undefined) envelope.error = error;
  if (warning !== undefined) envelope.warning = warning;
  if (diagnostics !== undefined) envelope.diagnostics = diagnostics;
  return envelope;
}

export function validateDeliveryEnvelope(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["Envelope must be an object."] };
  }
  if (containsExplicitUndefined(value)) errors.push("Explicit undefined fields are not allowed.");
  if (value.schemaVersion !== DELIVERY_SCHEMA_VERSION) errors.push("Unsupported schemaVersion.");
  if (!DELIVERY_OUTCOMES.includes(value.outcome)) errors.push("Unsupported outcome.");
  if (typeof value.message !== "string" || value.message.length === 0) errors.push("message is required.");
  if (value.reasonCode !== undefined && typeof value.reasonCode !== "string") errors.push("reasonCode must be a string.");
  if (value.fallbackReasonCode !== undefined && typeof value.fallbackReasonCode !== "string") errors.push("fallbackReasonCode must be a string.");
  if (value.rebuildReason !== undefined && (typeof value.rebuildReason !== "string" || !value.rebuildReason.length || value.rebuildReason.length > 600)) errors.push("rebuildReason must be bounded explanation text.");
  collectForbiddenKeys(value, errors);

  if (value.outcome === "hot-reloaded") {
    if (value.delivery?.kind !== "live") errors.push("hot-reloaded requires live delivery.");
    if (!Number.isInteger(value.delivery?.revision) || value.delivery.revision <= 0) {
      errors.push("hot-reloaded requires a positive revision.");
    }
  }
  if (value.outcome === "install-link-ready") {
    if (value.delivery?.kind !== "install") errors.push("install-link-ready requires install delivery.");
    if (!isUserFacingLink(value.delivery?.universalLink)) errors.push("install delivery requires a universal link.");
    if (typeof value.delivery?.state !== "string") errors.push("install delivery requires state.");
    if (typeof value.delivery?.preserveData !== "boolean") errors.push("install delivery requires preserveData.");
    if (value.delivery?.customScheme !== undefined && !isUserFacingLink(value.delivery.customScheme)) {
      errors.push("install custom scheme must be a user-facing link.");
    }
    if (value.delivery?.expiresAt !== undefined && typeof value.delivery.expiresAt !== "string") {
      errors.push("install delivery expiresAt must be a string.");
    }
  }
  if (value.outcome === "queued") {
    if (value.delivery?.kind !== "pending") errors.push("queued requires pending delivery.");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(value.delivery?.requestId || "")) errors.push("queued requires an opaque request identity.");
    if (!["queued", "waiting-for-device", "waiting-for-foreground", "compiling", "applying", "applied"].includes(value.delivery?.state)) errors.push("queued requires an incomplete delivery state.");
    if (typeof value.delivery?.expiresAt !== "string" || !Number.isFinite(Date.parse(value.delivery.expiresAt))) errors.push("queued requires an expiry.");
    if (value.delivery?.prepared !== undefined && typeof value.delivery.prepared !== "boolean") errors.push("queued prepared must be a boolean.");
    if (value.delivery?.normalWaiting !== undefined && typeof value.delivery.normalWaiting !== "boolean") errors.push("queued normalWaiting must be a boolean.");
    if (value.delivery?.guidanceCode !== undefined && !["OPEN_TARGET_APP", "PREPARING_UPDATE", "WAIT_FOR_APPLICATION", "WAIT_FOR_REFRESH"].includes(value.delivery.guidanceCode)) errors.push("queued guidanceCode is invalid.");
    if (value.delivery?.requiredAppState !== undefined && value.delivery.requiredAppState !== "foreground-ready") errors.push("queued requiredAppState is invalid.");
  }
  if (["no-change", "needs-user-action", "failed"].includes(value.outcome) && value.delivery !== undefined) {
    errors.push(`${value.outcome} must not include delivery.`);
  }
  if (value.outcome === "needs-user-action" && typeof value.error?.code !== "string") {
    errors.push("needs-user-action requires a typed error code.");
  }
  if (value.error !== undefined && !isMessage(value.error)) errors.push("error requires a typed code and message.");
  if (value.warning !== undefined && (
    !isMessage(value.warning)
  )) {
    errors.push("warning requires a typed code and message.");
  }
  if (value.timing !== undefined && (
    !value.timing || typeof value.timing !== "object" || Array.isArray(value.timing)
    || !isNonNegativeNumber(value.timing.totalMs)
    || (value.timing.classificationMs !== undefined && !isNonNegativeNumber(value.timing.classificationMs))
  )) errors.push("timing requires finite non-negative millisecond values.");
  if (value.diagnostics !== undefined && (
    !value.diagnostics || typeof value.diagnostics !== "object" || Array.isArray(value.diagnostics)
  )) errors.push("diagnostics must be an object.");
  return { valid: errors.length === 0, errors };
}

function collectForbiddenKeys(value, errors, path = "envelope") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(`${path}.${key} is not allowed.`);
    collectForbiddenKeys(child, errors, `${path}.${key}`);
  }
}

function isUserFacingLink(value) {
  return typeof value === "string"
    && (/^https:\/\//.test(value) || /^swift-sim:\/\//.test(value))
    && !/[\r\n]/.test(value);
}

function isMessage(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.code === "string"
    && typeof value.message === "string";
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function containsExplicitUndefined(value) {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((child) => child === undefined || containsExplicitUndefined(child));
}

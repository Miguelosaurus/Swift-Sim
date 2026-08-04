export const DELIVERY_SCHEMA_VERSION = 1;

export const DELIVERY_OUTCOMES = Object.freeze([
  "hot-reloaded",
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

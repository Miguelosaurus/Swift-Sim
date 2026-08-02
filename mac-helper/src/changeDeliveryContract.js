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
  return envelope;
}

export function validateDeliveryEnvelope(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["Envelope must be an object."] };
  }
  if (value.schemaVersion !== DELIVERY_SCHEMA_VERSION) errors.push("Unsupported schemaVersion.");
  if (!DELIVERY_OUTCOMES.includes(value.outcome)) errors.push("Unsupported outcome.");
  if (typeof value.message !== "string" || value.message.length === 0) errors.push("message is required.");
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
    if (value.delivery?.customScheme !== undefined && !isUserFacingLink(value.delivery.customScheme)) {
      errors.push("install custom scheme must be a user-facing link.");
    }
  }
  if (value.outcome === "no-change" && value.delivery !== undefined) {
    errors.push("no-change must not include delivery.");
  }
  if (value.outcome === "needs-user-action" && typeof value.error?.code !== "string") {
    errors.push("needs-user-action requires a typed error code.");
  }
  if (value.warning !== undefined && (
    typeof value.warning !== "object"
    || typeof value.warning.code !== "string"
    || typeof value.warning.message !== "string"
  )) {
    errors.push("warning requires a typed code and message.");
  }
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

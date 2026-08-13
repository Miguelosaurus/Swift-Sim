// @ts-check

const COMPATIBILITY_STATES = new Set(["compatible", "transitioning", "incompatible"]);

/** @param {{ available: boolean, failureCategory?: string, value?: unknown }} observation */
export function projectPhase4CompatibilityHealth(observation) {
  if (!observation.available) return empty(observation.failureCategory);
  const value = observation.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return empty("invalid-observation");
  }
  const record = /** @type {Record<string, unknown>} */ (value);

  let state = "unknown";
  if (typeof record.state === "string" && COMPATIBILITY_STATES.has(record.state)) {
    state = record.state;
  }

  let status = "attention";
  if (state === "compatible") status = "healthy";
  if (state === "incompatible") status = "blocked";

  return Object.freeze({
    available: true,
    status,
    state,
    legacyReadable: readable(record.legacyReadable),
    sqliteReadable: readable(record.sqliteReadable),
    rollbackReadable: readable(record.rollbackReadable),
    failureCategory: null,
  });
}

/** @param {string | undefined} failureCategory */
function empty(failureCategory = "unavailable") {
  let status = "unavailable";
  if (failureCategory === "incompatible") status = "blocked";
  return Object.freeze({
    available: false,
    status,
    state: "unknown",
    legacyReadable: null,
    sqliteReadable: null,
    rollbackReadable: null,
    failureCategory,
  });
}

/** @param {unknown} value */
function readable(value) {
  if (typeof value === "boolean") return value;
  return null;
}

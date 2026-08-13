// @ts-check

/** @param {{ available: boolean, failureCategory?: string, value?: unknown }} observation */
export function projectPhase4CompatibilityHealth(observation) {
  if (!observation.available) return empty(observation.failureCategory);
  const value = observation.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return empty("invalid-observation");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const states = ["compatible", "transitioning", "incompatible"];
  const state = typeof record.state === "string" && states.includes(record.state)
    ? record.state
    : "unknown";
  return Object.freeze({
    available: true,
    status: state === "compatible" ? "healthy" : state === "incompatible" ? "blocked" : "attention",
    state,
    legacyReadable: typeof record.legacyReadable === "boolean" ? record.legacyReadable : null,
    sqliteReadable: typeof record.sqliteReadable === "boolean" ? record.sqliteReadable : null,
    rollbackReadable: typeof record.rollbackReadable === "boolean" ? record.rollbackReadable : null,
    failureCategory: null,
  });
}

/** @param {string | undefined} failureCategory */
function empty(failureCategory = "unavailable") {
  return Object.freeze({
    available: false,
    status: failureCategory === "incompatible" ? "blocked" : "unavailable",
    state: "unknown",
    legacyReadable: null,
    sqliteReadable: null,
    rollbackReadable: null,
    failureCategory,
  });
}

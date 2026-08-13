// @ts-check

/** @param {{ available: boolean, failureCategory?: string, value?: unknown }} observation */
export function projectPhase4ShadowHealth(observation) {
  if (!observation.available) return unavailable(observation.failureCategory);
  const value = observation.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unavailable("invalid-observation");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  if (typeof record.enabled !== "boolean") return unavailable("invalid-observation");
  const mismatchCount = count(record.mismatchCount);
  const observationCount = count(record.observationCount);
  if (mismatchCount === undefined || observationCount === undefined) {
    return unavailable("invalid-observation");
  }
  return Object.freeze({
    available: true,
    status:
      record.enabled && (mismatchCount === null || mismatchCount === 0)
        ? "healthy"
        : "attention",
    enabled: record.enabled,
    mismatchCount,
    observationCount,
    failureCategory: null,
  });
}

/** @param {string | undefined} failureCategory */
function unavailable(failureCategory = "unavailable") {
  return Object.freeze({
    available: false,
    status: "unavailable",
    enabled: null,
    mismatchCount: null,
    observationCount: null,
    failureCategory,
  });
}

/** @param {unknown} value @returns {number | null | undefined} */
function count(value) {
  if (value === undefined) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

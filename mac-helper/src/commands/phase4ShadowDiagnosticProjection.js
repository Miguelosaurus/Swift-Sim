// @ts-check

/** @param {{ available: boolean, failureCategory?: string, value?: unknown }} observation */
export function projectPhase4ShadowHealth(observation) {
  if (!observation.available) return unavailable(observation.failureCategory);
  const value = observation.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unavailable("invalid-observation");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  if (typeof record.enabled !== "boolean") {
    return unavailable("invalid-observation");
  }

  const mismatchCount = count(record.mismatchCount);
  const observationCount = count(record.observationCount);
  if (mismatchCount === undefined || observationCount === undefined) {
    return unavailable("invalid-observation");
  }

  let status = "attention";
  const noKnownMismatch = mismatchCount === null || mismatchCount === 0;
  if (record.enabled && noKnownMismatch) status = "healthy";
  return Object.freeze({
    available: true,
    status,
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
  if (typeof value !== "number") return undefined;
  if (!Number.isSafeInteger(value)) return undefined;
  if (value < 0) return undefined;
  return value;
}

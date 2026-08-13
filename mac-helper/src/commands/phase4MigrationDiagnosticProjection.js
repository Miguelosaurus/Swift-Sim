// @ts-check

const OUTCOMES = new Set(["applied", "checkpointed", "already-current"]);

/** @param {{ available: boolean, failureCategory?: string, value?: unknown }} observation */
export function projectPhase4MigrationHealth(observation) {
  if (!observation.available) return unavailable(observation.failureCategory);
  const value = observation.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unavailable("invalid-observation");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const outcome =
    typeof record.status === "string" && OUTCOMES.has(record.status)
      ? record.status
      : "unknown";
  const recordCount = count(record.recordCount);
  if (recordCount === undefined) return unavailable("invalid-observation");
  return Object.freeze({
    available: true,
    status: outcome === "unknown" ? "attention" : "healthy",
    outcome,
    recordCount,
    failureCategory: null,
  });
}

/** @param {string | undefined} failureCategory */
function unavailable(failureCategory = "unavailable") {
  return Object.freeze({
    available: false,
    status: "unavailable",
    outcome: "unknown",
    recordCount: null,
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

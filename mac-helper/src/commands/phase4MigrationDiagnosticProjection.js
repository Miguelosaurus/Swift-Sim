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

  let outcome = "unknown";
  if (typeof record.status === "string" && OUTCOMES.has(record.status)) {
    outcome = record.status;
  }
  const recordCount = count(record.recordCount);
  if (recordCount === undefined) return unavailable("invalid-observation");

  let status = "healthy";
  if (outcome === "unknown") status = "attention";
  return Object.freeze({
    available: true,
    status,
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
  if (typeof value !== "number") return undefined;
  if (!Number.isSafeInteger(value)) return undefined;
  if (value < 0) return undefined;
  return value;
}

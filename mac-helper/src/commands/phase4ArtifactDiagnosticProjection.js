// @ts-check

/** @param {{ available: boolean, failureCategory?: string, value?: unknown }} observation */
export function projectPhase4ArtifactHealth(observation) {
  if (!observation.available) return empty(observation.failureCategory);
  const value = observation.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return empty("invalid-observation");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.readOnly !== true || record.cleanupEnabled !== false) {
    return empty("invalid-observation");
  }

  const totalKiB = count(record.totalKiB);
  const reclaimableKiB = count(record.reclaimableKiB);
  const protectedKiB = count(record.protectedKiB);
  const manualReviewKiB = count(record.manualReviewKiB);
  const orphanRootCount = count(record.orphanRootCount);
  const measurementIssueCount = count(record.measurementIssueCount);
  const numericValues = [
    totalKiB,
    reclaimableKiB,
    protectedKiB,
    manualReviewKiB,
    orphanRootCount,
    measurementIssueCount,
  ];
  if (typeof record.measurementComplete !== "boolean" || numericValues.some(isMissingCount)) {
    return empty("invalid-observation");
  }

  const measurementHealthy =
    record.measurementComplete &&
    measurementIssueCount === 0 &&
    orphanRootCount === 0;
  let status = "attention";
  if (measurementHealthy) status = "healthy";

  return Object.freeze({
    available: true,
    status,
    informational: true,
    cleanupEnabled: false,
    measurementComplete: record.measurementComplete,
    totalKiB,
    reclaimableKiB,
    protectedKiB,
    manualReviewKiB,
    orphanRootCount,
    measurementIssueCount,
    failureCategory: null,
  });
}

/** @param {string | undefined} failureCategory */
function empty(failureCategory = "unavailable") {
  return Object.freeze({
    available: false,
    status: "unavailable",
    informational: true,
    cleanupEnabled: false,
    measurementComplete: null,
    totalKiB: null,
    reclaimableKiB: null,
    protectedKiB: null,
    manualReviewKiB: null,
    orphanRootCount: null,
    measurementIssueCount: null,
    failureCategory,
  });
}

/** @param {unknown} value */
function count(value) {
  if (typeof value !== "number") return null;
  if (!Number.isSafeInteger(value)) return null;
  if (value < 0) return null;
  return value;
}

/** @param {unknown} value */
function isMissingCount(value) {
  return value === null;
}

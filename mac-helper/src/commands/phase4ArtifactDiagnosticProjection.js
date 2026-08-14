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
  if (typeof record.measurementComplete !== "boolean") {
    return empty("invalid-observation");
  }

  const totalKiB = count(record.totalKiB);
  const reclaimableKiB = count(record.reclaimableKiB);
  const protectedKiB = count(record.protectedKiB);
  const manualReviewKiB = count(record.manualReviewKiB);
  const orphanRootCount = count(record.orphanRootCount);
  const measurementIssueCount = count(record.measurementIssueCount);
  if (totalKiB === null) return empty("invalid-observation");
  if (reclaimableKiB === null) return empty("invalid-observation");
  if (protectedKiB === null) return empty("invalid-observation");
  if (manualReviewKiB === null) return empty("invalid-observation");
  if (orphanRootCount === null) return empty("invalid-observation");
  if (measurementIssueCount === null) return empty("invalid-observation");

  const measurementComplete = record.measurementComplete;
  let status = "attention";
  if (measurementComplete && measurementIssueCount === 0 && orphanRootCount === 0) {
    status = "healthy";
  }

  return Object.freeze({
    available: true,
    status,
    informational: true,
    cleanupEnabled: false,
    measurementComplete,
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

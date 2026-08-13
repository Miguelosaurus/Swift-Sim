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
  if (
    typeof record.measurementComplete !== "boolean" ||
    [totalKiB, reclaimableKiB, protectedKiB, manualReviewKiB, orphanRootCount, measurementIssueCount].some(
      (entry) => entry === null,
    )
  ) {
    return empty("invalid-observation");
  }
  return Object.freeze({
    available: true,
    status:
      record.measurementComplete && measurementIssueCount === 0 && orphanRootCount === 0
        ? "healthy"
        : "attention",
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
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

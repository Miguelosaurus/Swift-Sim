// @ts-check

/**
 * @param {unknown} value
 * @returns {{ artifacts: Record<string, unknown> }}
 */
export function deviceBuildArtifactDoctorSection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({
      artifacts: Object.freeze({
        available: false,
        ready: false,
        informational: true,
        cleanupEnabled: false,
        detail: "Read-only device-build artifact audit is unavailable; no cleanup was attempted.",
      }),
    });
  }
  const summary = /** @type {Record<string, unknown>} */ (value);
  if (summary.readOnly !== true || summary.cleanupEnabled !== false) {
    return Object.freeze({
      artifacts: Object.freeze({
        available: false,
        ready: false,
        informational: true,
        cleanupEnabled: false,
        detail: "Device-build artifact audit did not prove read-only mode; no cleanup was attempted.",
      }),
    });
  }

  const totalKiB = finite(summary.totalKiB);
  const reclaimableKiB = finite(summary.reclaimableKiB);
  const protectedKiB = finite(summary.protectedKiB);
  const manualReviewKiB = finite(summary.manualReviewKiB);
  const issueCount = integer(summary.measurementIssueCount);
  const orphanCount = integer(summary.orphanRootCount);
  const measurementComplete = summary.measurementComplete === true;
  const qualifier = measurementComplete
    ? "measurement complete"
    : `${issueCount} measurement ${issueCount === 1 ? "issue" : "issues"}; conservative estimate`;

  return Object.freeze({
    artifacts: Object.freeze({
      ...structuredClone(summary),
      available: true,
      ready: false,
      informational: true,
      cleanupEnabled: false,
      totalKiB,
      reclaimableKiB,
      protectedKiB,
      manualReviewKiB,
      orphanRootCount: orphanCount,
      measurementIssueCount: issueCount,
      measurementComplete,
      detail:
        `${formatGiB(reclaimableKiB)} safely reclaimable under the proven policy; ` +
        `${formatGiB(protectedKiB)} protected; ${orphanCount} orphan ` +
        `${orphanCount === 1 ? "root" : "roots"} for manual review; ${qualifier}.`,
    }),
  });
}

/** @param {number} kib */
function formatGiB(kib) {
  return `${(kib / (1024 * 1024)).toFixed(2)} GiB`;
}

/** @param {unknown} value */
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** @param {unknown} value */
function integer(value) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

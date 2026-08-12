// @ts-check

/**
 * Reduce the internal per-build audit plan to a path-free diagnostic surface
 * suitable for helper CLI and `swift-sim doctor --json` output.
 *
 * @param {Record<string, unknown>} audit
 */
export function summarizeDeviceBuildArtifactAudit(audit) {
  if (!audit || typeof audit !== "object" || audit.readOnly !== true) {
    throw new TypeError("Device-build artifact audit summary requires a read-only audit result.");
  }
  const measurementIssues = arrayValue(audit.measurementIssues);
  const orphanRoots = arrayValue(audit.orphanRoots);
  const unboundInventory = arrayValue(audit.unboundInventory);
  const warnings = arrayValue(audit.warnings).map((value) => String(value));
  return Object.freeze({
    version: finiteNumber(audit.version, "version"),
    readOnly: true,
    cleanupEnabled: false,
    measurementComplete: audit.measurementComplete === true,
    buildCount: finiteNumber(audit.buildCount, "buildCount"),
    measuredBuildCount: finiteNumber(audit.measuredBuildCount, "measuredBuildCount"),
    totalKiB: finiteNumber(audit.totalKiB, "totalKiB"),
    reclaimableKiB: finiteNumber(audit.reclaimableKiB, "reclaimableKiB"),
    protectedKiB: finiteNumber(audit.protectedKiB, "protectedKiB"),
    manualReviewKiB: finiteNumber(audit.manualReviewKiB, "manualReviewKiB"),
    orphanRootCount: orphanRoots.length,
    unboundInventoryCount: unboundInventory.length,
    measurementIssueCount: measurementIssues.length,
    measurementIssueCodes: Object.freeze(issueCounts(measurementIssues)),
    buckets: cloneDiagnosticValue(audit.buckets),
    warnings: Object.freeze(warnings),
  });
}

/** @param {unknown[]} issues */
function issueCounts(issues) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const issue of issues) {
    const code =
      issue && typeof issue === "object" && "code" in issue
        ? String(/** @type {{ code?: unknown }} */ (issue).code || "unknown")
        : "unknown";
    counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

/** @param {unknown} value */
function cloneDiagnosticValue(value) {
  if (value === undefined) return null;
  return structuredClone(value);
}

/** @param {unknown} value */
function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

/** @param {unknown} value @param {string} label */
function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`Device-build artifact audit ${label} must be a nonnegative finite number.`);
  }
  return value;
}

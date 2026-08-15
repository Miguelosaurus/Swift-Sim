// @ts-check

import { collectPhase4OperatorDiagnostics } from "./phase4OperatorDiagnostics.js";

/**
 * @param {unknown} value
 * @returns {{ artifacts: Record<string, unknown>, phase4Support: Readonly<Record<string, unknown>> }}
 */
export function deviceBuildArtifactDoctorSection(value) {
  const phase4Support = collectPhase4OperatorDiagnostics({ artifactAudit: value });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({
      artifacts: Object.freeze({
        available: false,
        ready: false,
        informational: true,
        cleanupEnabled: false,
        detail:
          "Read-only device-build artifact audit is unavailable; no cleanup was attempted. " +
          phase4Summary(phase4Support),
      }),
      phase4Support,
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
        detail:
          "Device-build artifact audit did not prove read-only mode; no cleanup was attempted. " +
          phase4Summary(phase4Support),
      }),
      phase4Support,
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
        `${orphanCount === 1 ? "root" : "roots"} for manual review; ${qualifier}. ` +
        phase4Summary(phase4Support),
    }),
    phase4Support,
  });
}

/** @param {Readonly<Record<string, unknown>>} report */
function phase4Summary(report) {
  const database = record(report.database);
  const migration = record(report.migration);
  const shadow = record(report.shadow);
  const compatibility = record(report.compatibility);
  const authority = record(report.authority);
  const recovery = record(report.recovery);
  const actionCodes = Array.isArray(recovery.actionCodes) ? recovery.actionCodes : [];
  const actions = actionCodes.length > 0 ? actionCodes.join(", ") : "none";
  const rollback = authority.rollbackAvailable === true
    ? `available-until-${String(authority.rollbackExpiresAt || "unknown")}`
    : "unavailable";
  return (
    `Phase-4 support: ${String(report.overall || "unavailable")}; ` +
    `database=${String(database.status || "unavailable")}; ` +
    `migration=${String(migration.status || "unavailable")}; ` +
    `shadow=${String(shadow.status || "unavailable")}; ` +
    `compatibility=${String(compatibility.status || "unavailable")}; ` +
    `authority=${String(authority.mode || "unknown")}; ` +
    `transition=${authority.preparationActive === true ? "preparing" : "idle"}; ` +
    `rollback=${rollback}; recovery=${actions}. ` +
    "Evidence is read-only, redacted, and mutation-disabled."
  );
}

/** @param {unknown} value */
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
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

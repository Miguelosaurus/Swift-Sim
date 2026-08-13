// @ts-check

import { observePhase4DiagnosticProbe } from "./phase4DiagnosticFailure.js";
import { projectPhase4ArtifactHealth } from "./phase4ArtifactDiagnosticProjection.js";
import { projectPhase4CompatibilityHealth } from "./phase4CompatibilityDiagnosticProjection.js";
import { projectPhase4DatabaseHealth } from "./phase4DatabaseDiagnosticProjection.js";
import { projectPhase4MigrationHealth } from "./phase4MigrationDiagnosticProjection.js";
import { projectPhase4ShadowHealth } from "./phase4ShadowDiagnosticProjection.js";

/**
 * Collect path-free Phase 4 support evidence from caller-owned read-only probes.
 * This coordinator owns no database, migration, authority, or cleanup resource.
 *
 * @param {{
 *   repositoryHealth?: () => unknown,
 *   migration?: () => unknown,
 *   shadow?: () => unknown,
 *   compatibility?: () => unknown,
 *   artifactStorage?: () => unknown,
 * }} [probes]
 */
export function collectPhase4SupportDiagnostics(probes = {}) {
  const database = projectPhase4DatabaseHealth(
    observePhase4DiagnosticProbe(probes.repositoryHealth),
  );
  const migration = projectPhase4MigrationHealth(observePhase4DiagnosticProbe(probes.migration));
  const shadow = projectPhase4ShadowHealth(observePhase4DiagnosticProbe(probes.shadow));
  const compatibility = projectPhase4CompatibilityHealth(
    observePhase4DiagnosticProbe(probes.compatibility),
  );
  const artifactStorage = projectPhase4ArtifactHealth(
    observePhase4DiagnosticProbe(probes.artifactStorage),
  );
  const sections = [database, migration, shadow, compatibility, artifactStorage];
  const actionCodes = recoveryActionCodes({
    database,
    migration,
    shadow,
    compatibility,
    artifactStorage,
  });

  return Object.freeze({
    version: 1,
    readOnly: true,
    redacted: true,
    mutationAllowed: false,
    overall: overallStatus(sections),
    database,
    migration,
    shadow,
    compatibility,
    artifactStorage,
    recovery: Object.freeze({
      mutationAllowed: false,
      actionCodes: Object.freeze(actionCodes),
    }),
  });
}

/**
 * Serialize only a freshly collected redacted report. Raw probe values and raw
 * errors never enter the returned JSON support evidence.
 *
 * @param {Parameters<typeof collectPhase4SupportDiagnostics>[0]} [probes]
 */
export function serializePhase4SupportEvidence(probes = {}) {
  return `${JSON.stringify(collectPhase4SupportDiagnostics(probes), null, 2)}\n`;
}

/** @param {readonly { available: boolean, status: string }[]} sections */
function overallStatus(sections) {
  if (sections.some((section) => section.status === "blocked")) return "blocked";
  const availableCount = sections.filter((section) => section.available).length;
  if (availableCount === 0) return "unavailable";
  if (availableCount !== sections.length || sections.some((section) => section.status !== "healthy")) {
    return "attention";
  }
  return "healthy";
}

/** @param {Record<string, Record<string, unknown>>} sections */
function recoveryActionCodes(sections) {
  const actions = new Set();
  const failure = sections.database.failureCategory;
  if (failure === "busy") actions.add("retry-diagnostic-after-current-writer-completes");
  if (failure === "corrupt" || sections.database.integrity === "failed") {
    actions.add("preserve-state-and-restore-verified-backup");
  }
  if (failure === "incompatible" || schemaAhead(sections.database)) {
    actions.add("use-compatible-build-before-migration");
  }
  if (failure === "permission-denied") actions.add("verify-private-state-permissions");
  if (failure === "unavailable") actions.add("verify-state-availability");
  if (sections.database.status === "attention") {
    actions.add("keep-authority-unchanged-and-resume-supported-migration");
  }
  if (
    sections.database.status === "blocked" &&
    failure !== "corrupt" &&
    sections.database.integrity !== "failed"
  ) {
    actions.add("preserve-state-and-review-database-health");
  }
  if (needsGuidance(sections.migration)) {
    actions.add("keep-authority-unchanged-and-review-migration");
  }
  if (typeof sections.shadow.mismatchCount === "number" && sections.shadow.mismatchCount > 0) {
    actions.add("keep-authority-unchanged-and-review-shadow-mismatches");
  } else if (needsGuidance(sections.shadow)) {
    actions.add("keep-authority-unchanged-and-review-shadow-availability");
  }
  if (needsGuidance(sections.compatibility)) {
    actions.add("preserve-compatibility-paths-and-review-cutover-state");
  }
  if (needsGuidance(sections.artifactStorage)) {
    actions.add("review-artifact-measurement-without-cleanup");
  }
  return [...actions].sort();
}

/** @param {Record<string, unknown>} section */
function needsGuidance(section) {
  return section.status !== "healthy" && section.failureCategory !== "not-observed";
}

/** @param {Record<string, unknown>} section */
function schemaAhead(section) {
  return (
    typeof section.schemaVersion === "number" &&
    typeof section.latestSchemaVersion === "number" &&
    section.schemaVersion > section.latestSchemaVersion
  );
}

// @ts-check

import { observePhase4DiagnosticProbe } from "./phase4DiagnosticFailure.js";
import { projectPhase4ArtifactHealth } from "./phase4ArtifactDiagnosticProjection.js";
import { projectPhase4AuthorityHealth } from "./phase4AuthorityDiagnosticProjection.js";
import { projectPhase4CompatibilityHealth } from "./phase4CompatibilityDiagnosticProjection.js";
import { projectPhase4DatabaseHealth } from "./phase4DatabaseDiagnosticProjection.js";
import { projectPhase4MigrationHealth } from "./phase4MigrationDiagnosticProjection.js";
import { projectPhase4ShadowHealth } from "./phase4ShadowDiagnosticProjection.js";
import { phase4SupportRecoveryActions } from "./phase4SupportRecovery.js";

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
 *   authority?: () => unknown,
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
  const authority = projectPhase4AuthorityHealth(observePhase4DiagnosticProbe(probes.authority));
  const sections = {
    database,
    migration,
    shadow,
    compatibility,
    artifactStorage,
    authority,
  };
  const sectionList = Object.values(sections);
  const actionCodes = phase4SupportRecoveryActions(sections);

  return Object.freeze({
    version: 1,
    readOnly: true,
    redacted: true,
    mutationAllowed: false,
    overall: overallStatus(sectionList),
    ...sections,
    recovery: Object.freeze({
      mutationAllowed: false,
      actionCodes: Object.freeze(actionCodes),
    }),
  });
}

/** @param {Parameters<typeof collectPhase4SupportDiagnostics>[0]} [probes] */
export function serializePhase4SupportEvidence(probes = {}) {
  const report = collectPhase4SupportDiagnostics(probes);
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** @param {readonly { available: boolean, status: string, failureCategory?: unknown }[]} sections */
function overallStatus(sections) {
  // `authority` was appended to the accepted v1 support schema. Older callers
  // that omit this optional probe must keep their prior aggregate semantics;
  // a genuinely attempted-but-unavailable authority probe still degrades.
  const observed = sections.filter(hasAttemptedObservation);
  const blocked = observed.some((section) => section.status === "blocked");
  if (blocked) return "blocked";
  const availableCount = observed.filter((section) => section.available).length;
  if (availableCount === 0) {
    if (observed.length > 0) return "attention";
    return "unavailable";
  }
  const degraded = observed.some((section) => section.status !== "healthy");
  if (availableCount !== observed.length || degraded) return "attention";
  return "healthy";
}

/** @param {{ failureCategory?: unknown }} section */
function hasAttemptedObservation(section) {
  return section.failureCategory !== "not-observed";
}

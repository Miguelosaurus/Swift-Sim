// @ts-check

import { validatePhase4MaintenanceEvidence } from "./phase4CutoverPreflight.js";
import {
  expectedPhase4MigrationIdentities,
  inspectPhase4MigrationIdentity,
} from "./phase4MigrationIdentity.js";
import { measurePhase4MaintenanceFacts } from "./phase4MaintenanceObservations.js";

export {
  observePhase4AuthorityState,
  observePhase4ShadowMismatches,
} from "./phase4MaintenanceObservations.js";
export { verifyPhase4PreparationBackups } from "./phase4PreparationBackupProof.js";

/** @typedef {"prepare" | "cancel" | "activate" | "rollback"} MaintenanceStage */

const HUMAN_ONLY_FIELDS = Object.freeze([
  "maintenanceAuthorized",
  "writersQuiesced",
  "cleanupDisabledForCutover",
  "sqliteProcessAuthorityAbsent",
  "unrelatedPhaseWorkAbsent",
]);

const EXTERNAL_CEREMONY_FIELDS = Object.freeze([
  "exactCandidateSHA",
  "hostedVerifyGreen",
  ...HUMAN_ONLY_FIELDS,
]);

const MEASURED_BOOLEAN_FIELDS = Object.freeze([
  "installedProvenanceVerified",
  "exactProcessIdentityVerified",
  "exactDomainLocksAvailable",
  "privatePermissionsVerified",
  "liveSourceHashesCaptured",
  "schemaMigrationsCoherent",
  "databaseIntegrityWalForeignKeysVerified",
  "zeroUnresolvedShadowMismatches",
]);

const DEFERRED_FIELDS = Object.freeze([
  "preMigrationDatabaseSnapshotVerified",
  "legacyBackupsVerified",
  "migrationReopenIdempotencyVerified",
  "installedCandidateHelperHealthy",
  "rollbackReadable",
]);

export const PREPARE_EVIDENCE_FIELDS = Object.freeze([
  ...EXTERNAL_CEREMONY_FIELDS,
  ...MEASURED_BOOLEAN_FIELDS,
]);
export const ACTIVATE_EVIDENCE_FIELDS = Object.freeze([
  ...PREPARE_EVIDENCE_FIELDS,
  "rollbackExecutable",
]);

/**
 * Bind external ceremony/operator evidence to current read-only repository and
 * installed observations. This function never constructs SwiftSimSqliteDatabase
 * and therefore cannot migrate the database.
 *
 * @param {unknown} evidence
 * @param {MaintenanceStage} stage
 * @param {{
 *   stateRoot: string,
 *   spawnSync: (command: string, args: string[], options: { encoding: string }) => unknown,
 *   provenancePath: string,
 * }} options
 */
export function bindPhase4MaintenanceEvidence(evidence, stage, options) {
  const validated = validatePhase4MaintenanceEvidence(evidence, stage);
  const externalEvidence = /** @type {Record<string, unknown>} */ (evidence);
  const measured = measurePhase4MaintenanceFacts({
    ...options,
    stage,
    expectedCandidateSHA: validated.candidateSHA,
    expectedProcessIdentity: validated.processIdentity,
  });
  rejectSubmittedMeasurementContradictions(validated, measured);
  assertStagePreMigrationFacts(stage, measured);

  const sanitized = /** @type {Record<string, unknown>} */ (
    structuredClone(validated)
  );
  for (const field of [...MEASURED_BOOLEAN_FIELDS, ...DEFERRED_FIELDS]) {
    delete sanitized[field];
  }
  delete sanitized.shadowMismatchCount;

  return deepFreeze({
    ...sanitized,
    ceremony: {
      expectedCandidateSHA: validated.candidateSHA,
      verifyRunID: validated.verifyRunID,
      hostedVerifyGreen: externalEvidence.hostedVerifyGreen === true,
    },
    measured,
    binding: {
      version: 2,
      stage,
      stateRoot: options.stateRoot,
      preMigrationComplete: true,
      postMigrationComplete: false,
      expectedCandidateSHA: validated.candidateSHA,
      installedCandidateSHA: measured.installedCandidateSHA,
      preMigrationSchemaVersion: measured.schemaVersion,
      preMigrationHistoryDigest: measured.migration.historyDigest,
    },
  });
}

/**
 * Re-measure after the migration-capable owner has been closed and reopened.
 * Both supplied read-only observations must be exact full v9 and identical;
 * this turns reopen/idempotency into a measured repository fact instead of a
 * caller-authored boolean.
 *
 * @param {unknown} boundEvidence
 * @param {{
 *   stateRoot: string,
 *   spawnSync: (command: string, args: string[], options: { encoding: string }) => unknown,
 *   provenancePath: string,
 *   snapshot: Record<string, unknown>,
 *   firstPostMigration: ReturnType<typeof inspectPhase4MigrationIdentity>,
 *   reopenPostMigration: ReturnType<typeof inspectPhase4MigrationIdentity>,
 * }} options
 */
export function bindPhase4PostMigrationEvidence(boundEvidence, options) {
  const bound = requireBoundEvidence(boundEvidence, "prepare", false);
  requireFullPostMigration(
    options.firstPostMigration,
    "first post-migration close",
  );
  requireFullPostMigration(
    options.reopenPostMigration,
    "post-migration reopen",
  );
  if (
    options.firstPostMigration.historyDigest !==
      options.reopenPostMigration.historyDigest ||
    JSON.stringify(options.firstPostMigration.migrationIdentities) !==
      JSON.stringify(options.reopenPostMigration.migrationIdentities)
  ) {
    throw new Error(
      "Phase-4 migration identity changed across close/reopen; idempotency failed.",
    );
  }

  const current = measurePhase4MaintenanceFacts({
    stateRoot: options.stateRoot,
    spawnSync: options.spawnSync,
    provenancePath: options.provenancePath,
    stage: "prepare",
    expectedCandidateSHA: bound.ceremony.expectedCandidateSHA,
    expectedProcessIdentity: bound.processIdentity,
    allowedSchemaVersions: [9],
    requireFullSchema: true,
  });
  if (!sourceHashesEqual(bound.measured.sourceHashes, current.sourceHashes)) {
    throw new Error(
      "Phase-4 legacy source bytes changed between preflight and post-migration checks.",
    );
  }
  assertStagePreMigrationFacts("prepare", current);
  const snapshot = requireVerifiedSnapshot(options.snapshot, bound);

  return deepFreeze({
    ...bound,
    measured: {
      ...current,
      preMigrationDatabaseSnapshotVerified: true,
      migrationReopenIdempotencyVerified: true,
      snapshot,
    },
    binding: {
      ...bound.binding,
      postMigrationComplete: true,
      postMigrationSchemaVersion: current.schemaVersion,
      postMigrationHistoryDigest: current.migration.historyDigest,
    },
  });
}

/**
 * Assert the bound facts needed before a stage is allowed to construct its
 * migration-capable database owner. Preparation additionally requires the
 * verified snapshot and exact v9 close/reopen/idempotency proof.
 *
 * @param {unknown} evidence
 * @param {MaintenanceStage} stage
 */
export function assertPhase4BoundMaintenanceEvidence(evidence, stage) {
  const bound = requireBoundEvidence(evidence, stage, stage === "prepare");
  const measured = bound.measured;
  for (const field of [
    "installedProvenanceVerified",
    "exactProcessIdentityVerified",
    "helperQuiesced",
    "exactDomainLocksAvailable",
    "privatePermissionsVerified",
    "liveSourceHashesCaptured",
    "schemaMigrationsCoherent",
    "databaseIntegrityWalForeignKeysVerified",
    "zeroUnresolvedShadowMismatches",
  ]) {
    if (measured[field] !== true) {
      throw new Error(
        `Phase-4 bound maintenance condition is not satisfied: ${field}.`,
      );
    }
  }
  if (stage === "prepare") {
    if (bound.binding.postMigrationComplete !== true) {
      throw new Error(
        "Phase-4 preparation requires completed post-migration evidence.",
      );
    }
    if (
      measured.preMigrationDatabaseSnapshotVerified !== true ||
      measured.migrationReopenIdempotencyVerified !== true ||
      measured.schemaVersion !== expectedPhase4MigrationIdentities().length
    ) {
      throw new Error(
        "Phase-4 preparation requires verified snapshot and exact v9 reopen/idempotency.",
      );
    }
  }
  if (stage === "rollback" && measured.rollbackReadable !== true) {
    throw new Error(
      "Phase-4 rollback requires readable, private rollback material.",
    );
  }
  return bound;
}

/** @param {Record<string, unknown>} submitted @param {Record<string, any>} measured */
function rejectSubmittedMeasurementContradictions(submitted, measured) {
  for (const field of MEASURED_BOOLEAN_FIELDS) {
    if (!(field in submitted)) continue;
    if (
      typeof submitted[field] !== "boolean" ||
      submitted[field] !== measured[field]
    ) {
      throw new Error(
        `Phase-4 maintenance condition contradicts measured environment: ${field}.`,
      );
    }
  }
  if (
    "shadowMismatchCount" in submitted &&
    submitted.shadowMismatchCount !== measured.shadow.total
  ) {
    throw new Error(
      "Phase-4 maintenance shadow mismatch count contradicts measured environment.",
    );
  }
}

/** @param {MaintenanceStage} stage @param {Record<string, any>} measured */
function assertStagePreMigrationFacts(stage, measured) {
  for (const field of [
    "installedProvenanceVerified",
    "exactProcessIdentityVerified",
    "helperQuiesced",
    "exactDomainLocksAvailable",
    "privatePermissionsVerified",
    "liveSourceHashesCaptured",
    "schemaMigrationsCoherent",
    "databaseIntegrityWalForeignKeysVerified",
    "zeroUnresolvedShadowMismatches",
  ]) {
    if (measured[field] !== true) {
      throw new Error(
        `Phase-4 pre-migration maintenance condition failed: ${field}.`,
      );
    }
  }
  const mode = measured.authority.mode;
  if (stage === "prepare" && !["legacy", "preparing"].includes(mode)) {
    throw new Error(
      `Phase-4 preparation cannot begin from authority mode ${mode}.`,
    );
  }
  if (stage === "cancel" && !["legacy", "preparing"].includes(mode)) {
    throw new Error(
      `Phase-4 preparation cannot be cancelled from authority mode ${mode}.`,
    );
  }
  if (stage === "activate" && mode !== "preparing") {
    throw new Error(
      `Phase-4 activation requires preparing authority, found ${mode}.`,
    );
  }
  if (
    stage === "rollback" &&
    !["sqlite-rollback", "rollback-preparing"].includes(mode)
  ) {
    throw new Error(
      `Phase-4 rollback requires SQLite rollback authority, found ${mode}.`,
    );
  }
}

/** @param {unknown} value @param {MaintenanceStage} stage @param {boolean} requirePostMigration */
function requireBoundEvidence(value, stage, requirePostMigration) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase-4 bound maintenance evidence must be an object.");
  }
  const bound = /** @type {any} */ (value);
  if (
    bound.binding?.version !== 2 ||
    bound.binding?.preMigrationComplete !== true
  ) {
    throw new Error(
      "Phase-4 maintenance evidence is not bound to a completed pre-migration inspection.",
    );
  }
  if (bound.binding.stage !== stage) {
    throw new Error(
      `Phase-4 maintenance evidence was bound for ${bound.binding.stage}, not ${stage}.`,
    );
  }
  if (requirePostMigration && bound.binding.postMigrationComplete !== true) {
    throw new Error(
      "Phase-4 maintenance evidence is missing post-migration binding.",
    );
  }
  return bound;
}

/** @param {ReturnType<typeof inspectPhase4MigrationIdentity>} facts @param {string} label */
function requireFullPostMigration(facts, label) {
  if (
    !facts?.coherent ||
    !facts.full ||
    facts.schemaVersion !== expectedPhase4MigrationIdentities().length
  ) {
    throw new Error(
      `Phase-4 ${label} did not prove exact full v1-v9 migration identity.`,
    );
  }
}

/** @param {Record<string, unknown>} snapshot @param {any} bound */
function requireVerifiedSnapshot(snapshot, bound) {
  if (
    !snapshot ||
    snapshot.verified !== true ||
    snapshot.schemaVersion !== bound.binding.preMigrationSchemaVersion ||
    snapshot.migrationHistoryDigest !== bound.binding.preMigrationHistoryDigest ||
    typeof snapshot.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256)
  ) {
    throw new Error(
      "Phase-4 pre-migration snapshot is not bound to the verified pre-migration database.",
    );
  }
  return structuredClone(snapshot);
}

/** @param {Record<string, any>} left @param {Record<string, any>} right */
function sourceHashesEqual(left, right) {
  return ["credential", "invitations", "deviceBuilds", "sessions"].every(
    (key) =>
      left?.[key]?.present === true &&
      right?.[key]?.present === true &&
      left[key].sha256 === right[key].sha256 &&
      left[key].byteLength === right[key].byteLength,
  );
}

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(
    /** @type {Record<string, unknown>} */ (value),
  )) {
    deepFreeze(nested);
  }
  Object.freeze(/** @type {object} */ (value));
  return value;
}

// @ts-check

const PREPARE_TRUE_FIELDS = Object.freeze([
  "exactCandidateSHA",
  "hostedVerifyGreen",
  "maintenanceAuthorized",
  "installedProvenanceVerified",
  "exactProcessIdentityVerified",
  "writersQuiesced",
  "exactDomainLocksAvailable",
  "privatePermissionsVerified",
  "liveSourceHashesCaptured",
  "schemaMigrationsCoherent",
  "databaseIntegrityWalForeignKeysVerified",
  "preMigrationDatabaseSnapshotVerified",
  "legacyBackupsVerified",
  "migrationReopenIdempotencyVerified",
  "installedCandidateHelperHealthy",
  "zeroUnresolvedShadowMismatches",
  "rollbackReadable",
  "cleanupDisabledForCutover",
  "sqliteProcessAuthorityAbsent",
  "rollbackExecutable",
  "failClosedAbortClassesVerified",
  "unrelatedPhaseWorkAbsent",
]);

const ACTIVATE_TRUE_FIELDS = Object.freeze([
  ...PREPARE_TRUE_FIELDS,
  "finalLockedProjectionEquality",
  "finalFreshnessRecheck",
  "atomicAuthorityTransitionReady",
]);

export const PHASE4_PREPARE_EVIDENCE_FIELDS = PREPARE_TRUE_FIELDS;
export const PHASE4_ACTIVATE_EVIDENCE_FIELDS = ACTIVATE_TRUE_FIELDS;

/**
 * The operator evidence is intentionally explicit. Repository code validates
 * every PR #151 stop-condition class that can be known before the selector
 * commit; post-switch transaction/read/reopen health is measured by code after
 * activation rather than accepted as a predeclared boolean.
 *
 * @param {unknown} evidence
 * @param {"prepare" | "activate" | "rollback"} stage
 */
export function validatePhase4MaintenanceEvidence(evidence, stage) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Phase-4 maintenance evidence must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (evidence);
  const required = stage === "activate" ? ACTIVATE_TRUE_FIELDS : PREPARE_TRUE_FIELDS;
  for (const field of required) {
    if (values[field] !== true) {
      throw new Error(`Phase-4 maintenance stop condition is not satisfied: ${field}.`);
    }
  }
  const candidateSHA = requireHash(values.candidateSHA, "Phase-4 candidate SHA");
  const verifyRunID = requirePositiveInteger(values.verifyRunID, "Phase-4 Verify run id");
  const processIdentity = requireRecord(values.processIdentity, "Phase-4 process identity");
  const pid = requirePositiveInteger(processIdentity.pid, "Phase-4 process pid");
  const startedAt = requireNonEmptyString(
    processIdentity.startedAt,
    "Phase-4 process start identity",
  );
  if (pid <= 1 || !startedAt) {
    throw new Error(
      "Phase-4 process identity requires PID plus process start identity; PID alone is forbidden.",
    );
  }
  const shadowMismatchCount = requireNonNegativeInteger(
    values.shadowMismatchCount,
    "Phase-4 shadow mismatch count",
  );
  if ((stage === "prepare" || stage === "activate") && shadowMismatchCount !== 0) {
    throw new Error(`Phase-4 ${stage} requires zero unresolved shadow mismatches.`);
  }
  return Object.freeze({
    ...structuredClone(values),
    candidateSHA,
    verifyRunID,
    processIdentity: Object.freeze({ ...processIdentity, pid, startedAt }),
    shadowMismatchCount,
  });
}

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw new Error(`${label} must be a lowercase Git/SHA digest.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} label */
function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty.`);
  return value;
}

/** @param {unknown} value @param {string} label */
function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

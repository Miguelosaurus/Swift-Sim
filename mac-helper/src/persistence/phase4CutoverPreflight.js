// @ts-check

/**
 * External ceremony / operator facts. These are intentionally separate from
 * machine-observable facts measured by phase4MaintenanceEvidence.js. A caller
 * may assert them, but it cannot use them to override a contradictory local
 * measurement.
 */
const PREPARE_TRUE_FIELDS = Object.freeze([
  "exactCandidateSHA",
  "hostedVerifyGreen",
  "maintenanceAuthorized",
  "writersQuiesced",
  "cleanupDisabledForCutover",
  "sqliteProcessAuthorityAbsent",
  "unrelatedPhaseWorkAbsent",
]);

const ACTIVATE_TRUE_FIELDS = Object.freeze([
  ...PREPARE_TRUE_FIELDS,
  // Package/service rollback material is an external maintenance-window fact.
  // SQLite/legacy readability itself is measured at the activation stage.
  "rollbackExecutable",
]);

const ROLLBACK_TRUE_FIELDS = Object.freeze([
  "exactCandidateSHA",
  "hostedVerifyGreen",
  "maintenanceAuthorized",
  "writersQuiesced",
  "cleanupDisabledForCutover",
  "sqliteProcessAuthorityAbsent",
  "unrelatedPhaseWorkAbsent",
]);

export const PHASE4_PREPARE_EVIDENCE_FIELDS = PREPARE_TRUE_FIELDS;
export const PHASE4_ACTIVATE_EVIDENCE_FIELDS = ACTIVATE_TRUE_FIELDS;

/**
 * Validate only facts that legitimately originate outside repository-local
 * observation. Migration identity, permissions, locks, helper state, shadow
 * counts, snapshots, backups, reopen/idempotency, and rollback readability are
 * deliberately NOT accepted here as authoritative booleans; the maintenance
 * binder/executor measures them at the stage where they can exist.
 *
 * @param {unknown} evidence
 * @param {"prepare" | "activate" | "rollback"} stage
 */
export function validatePhase4MaintenanceEvidence(evidence, stage) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Phase-4 maintenance evidence must be an object.");
  }
  if (!["prepare", "activate", "rollback"].includes(stage)) {
    throw new Error(`Unsupported Phase-4 maintenance evidence stage: ${stage}.`);
  }
  const values = /** @type {Record<string, unknown>} */ (evidence);
  const required =
    stage === "activate"
      ? ACTIVATE_TRUE_FIELDS
      : stage === "rollback"
        ? ROLLBACK_TRUE_FIELDS
        : PREPARE_TRUE_FIELDS;
  for (const field of required) {
    if (values[field] !== true) {
      throw new Error(`Phase-4 maintenance stop condition is not satisfied: ${field}.`);
    }
  }

  const candidateSHA = requireGitSHA(values.candidateSHA, "Phase-4 candidate SHA");
  const verifyRunID = requirePositiveInteger(values.verifyRunID, "Phase-4 Verify run id");
  const processIdentity = requireRecord(values.processIdentity, "Phase-4 helper process identity");
  const pid = requirePositiveInteger(processIdentity.pid, "Phase-4 helper process pid");
  const startedAt = requireNonEmptyString(
    processIdentity.startedAt,
    "Phase-4 helper process start identity",
  );
  if (pid <= 1) {
    throw new Error(
      "Phase-4 helper process identity requires PID plus process start identity; PID alone is forbidden.",
    );
  }

  // Submitted machine-observable values are informational only. If supplied,
  // validate their shape so malformed evidence cannot hide in the ceremony
  // object. The binder compares applicable values with independently measured
  // facts and rejects contradictions.
  const shadowMismatchCount =
    values.shadowMismatchCount === undefined
      ? undefined
      : requireNonNegativeInteger(values.shadowMismatchCount, "Phase-4 shadow mismatch count");

  return Object.freeze({
    ...structuredClone(values),
    candidateSHA,
    verifyRunID,
    processIdentity: Object.freeze({ ...processIdentity, pid, startedAt }),
    ...(shadowMismatchCount === undefined ? {} : { shadowMismatchCount }),
  });
}

/** @param {unknown} value @param {string} label */
function requireGitSHA(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA.`);
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
  return value.trim();
}

/** @param {unknown} value @param {string} label */
function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

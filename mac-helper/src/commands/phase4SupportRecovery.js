// @ts-check

/**
 * Build non-mutating operator guidance from redacted diagnostic sections.
 *
 * @param {{
 *   database: Record<string, unknown>,
 *   migration: Record<string, unknown>,
 *   shadow: Record<string, unknown>,
 *   compatibility: Record<string, unknown>,
 *   artifactStorage: Record<string, unknown>,
 *   authority?: Record<string, unknown>,
 * }} sections
 */
export function phase4SupportRecoveryActions(sections) {
  const { database, migration, shadow, compatibility, artifactStorage, authority } = sections;
  const actions = new Set();
  const failure = database.failureCategory;

  if (failure === "busy") actions.add("retry-diagnostic-after-current-writer-completes");
  if (failure === "corrupt" || database.integrity === "failed") {
    actions.add("preserve-state-and-restore-verified-backup");
  }
  if (failure === "incompatible" || schemaAhead(database)) {
    actions.add("use-compatible-build-before-migration");
  }
  if (failure === "permission-denied") actions.add("verify-private-state-permissions");
  if (failure === "unavailable") actions.add("verify-state-availability");
  if (database.status === "attention") {
    actions.add("keep-authority-unchanged-and-resume-supported-migration");
  }
  if (database.status === "blocked" && failure !== "corrupt" && database.integrity !== "failed") {
    actions.add("preserve-state-and-review-database-health");
  }
  if (needsGuidance(migration)) actions.add("keep-authority-unchanged-and-review-migration");
  if (typeof shadow.mismatchCount === "number" && shadow.mismatchCount > 0) {
    actions.add("keep-authority-unchanged-and-review-shadow-mismatches");
  } else if (needsGuidance(shadow)) {
    actions.add("keep-authority-unchanged-and-review-shadow-availability");
  }
  if (needsGuidance(compatibility)) {
    actions.add("preserve-compatibility-paths-and-review-cutover-state");
  }
  if (authority?.mode === "preparing") {
    actions.add("keep-legacy-authority-and-resume-or-cancel-cutover-preparation");
  }
  if (authority?.mode === "rollback-preparing") {
    actions.add("keep-sqlite-authority-and-resume-current-state-rollback-export");
  }
  if (
    ["sqlite-rollback", "rollback-preparing"].includes(String(authority?.mode || "")) &&
    authority?.rollbackAvailable === true
  ) {
    actions.add("preserve-rollback-material-until-separate-finalization-decision");
  }
  if (authority && needsGuidance(authority)) {
    actions.add("keep-authority-unchanged-and-review-cutover-state");
  }
  if (needsGuidance(artifactStorage)) {
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

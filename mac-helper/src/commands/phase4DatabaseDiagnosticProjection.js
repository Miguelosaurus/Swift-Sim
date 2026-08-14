// @ts-check

/**
 * Project the existing repository health snapshot into path-free support data.
 * The repository owner performs the health read; this module only observes.
 *
 * @param {{ available: boolean, failureCategory?: string, value?: unknown }} observation
 */
export function projectPhase4DatabaseHealth(observation) {
  if (!observation.available) return unavailableDatabase(observation.failureCategory);
  const value = observation.value;
  if (!isRecord(value)) return unavailableDatabase("invalid-observation");
  const foreignKeyViolationCount = integer(value.foreignKeyViolations);
  const schemaVersion = integer(value.schemaVersion);
  const latestSchemaVersion = integer(value.latestSchemaVersion);
  const migrationsApplied = integer(value.migrationsApplied);
  if (
    typeof value.ok !== "boolean" ||
    typeof value.integrity !== "string" ||
    typeof value.journalMode !== "string" ||
    typeof value.foreignKeys !== "boolean" ||
    foreignKeyViolationCount === null ||
    !Array.isArray(value.missingTables) ||
    schemaVersion === null ||
    latestSchemaVersion === null ||
    migrationsApplied === null
  ) {
    return unavailableDatabase("invalid-observation");
  }

  const integrity = value.integrity === "ok" ? "ok" : "failed";
  const incompleteCurrentSchema =
    value.missingTables.length > 0 && schemaVersion >= latestSchemaVersion;
  const severe =
    integrity !== "ok" ||
    !value.foreignKeys ||
    foreignKeyViolationCount > 0 ||
    incompleteCurrentSchema ||
    schemaVersion > latestSchemaVersion;
  return Object.freeze({
    available: true,
    status: value.ok ? "healthy" : severe ? "blocked" : "attention",
    integrity,
    journalMode: value.journalMode.toLowerCase() === "wal" ? "wal" : "other",
    foreignKeys: value.foreignKeys,
    foreignKeyViolationCount,
    missingTableCount: value.missingTables.length,
    schemaVersion,
    latestSchemaVersion,
    migrationsApplied,
    failureCategory: null,
  });
}

/** @param {string | undefined} failureCategory */
function unavailableDatabase(failureCategory = "unavailable") {
  return Object.freeze({
    available: false,
    status:
      failureCategory === "corrupt" || failureCategory === "incompatible"
        ? "blocked"
        : "unavailable",
    integrity: "unknown",
    journalMode: "unknown",
    foreignKeys: null,
    foreignKeyViolationCount: null,
    missingTableCount: null,
    schemaVersion: null,
    latestSchemaVersion: null,
    migrationsApplied: null,
    failureCategory,
  });
}

/** @param {unknown} value */
function integer(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

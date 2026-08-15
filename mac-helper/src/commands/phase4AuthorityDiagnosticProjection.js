// @ts-check

/**
 * Project the global Phase-4 authority selector into the accepted path-free
 * support schema. The caller owns the read-only probe.
 *
 * @param {{ available: boolean, failureCategory?: string, value?: unknown }} observation
 */
export function projectPhase4AuthorityHealth(observation) {
  if (!observation.available) return unavailable(observation.failureCategory);
  const values = observation.value;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return unavailable("invalid-observation");
  }
  const record = /** @type {Record<string, unknown>} */ (values);
  const mode = String(record.mode || "");
  if (!["legacy", "preparing", "sqlite-rollback", "sqlite-final"].includes(mode)) {
    return Object.freeze({
      available: true,
      status: "blocked",
      mode: "unknown",
      revision: null,
      cutoverEpoch: null,
      rollbackAvailable: false,
      rollbackExpiresAt: null,
      preparationActive: false,
      blocker: "invalid-authority-state",
      failureCategory: "invalid-observation",
    });
  }
  const revision = safeInteger(record.revision);
  const cutoverEpoch = safeInteger(record.cutoverEpoch);
  if (revision === null || cutoverEpoch === null) return unavailable("invalid-observation");
  return Object.freeze({
    available: true,
    status: mode === "preparing" ? "attention" : "healthy",
    mode,
    revision,
    cutoverEpoch,
    rollbackAvailable: Boolean(record.rollbackAvailable),
    rollbackExpiresAt:
      typeof record.rollbackExpiresAt === "string" ? record.rollbackExpiresAt : null,
    preparationActive: mode === "preparing",
    blocker: mode === "preparing" ? "transition-in-progress" : null,
    failureCategory: null,
  });
}

/** @param {string | undefined} failureCategory */
function unavailable(failureCategory = "unavailable") {
  return Object.freeze({
    available: false,
    status:
      failureCategory === "corrupt" || failureCategory === "incompatible"
        ? "blocked"
        : "unavailable",
    mode: "unknown",
    revision: null,
    cutoverEpoch: null,
    rollbackAvailable: false,
    rollbackExpiresAt: null,
    preparationActive: false,
    blocker: null,
    failureCategory,
  });
}

/** @param {unknown} value */
function safeInteger(value) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

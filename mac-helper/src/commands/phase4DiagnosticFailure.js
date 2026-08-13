// @ts-check

/**
 * Reduce an operational failure to a coarse, redaction-safe support category.
 * Raw error text is intentionally never returned to callers.
 *
 * @param {unknown} error
 * @returns {"busy" | "corrupt" | "incompatible" | "permission-denied" | "unavailable"}
 */
export function classifyPhase4DiagnosticFailure(error) {
  const code = isRecord(error) && typeof error.code === "string" ? error.code.toLowerCase() : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const text = `${code} ${message}`;

  if (/sqlite_busy|sqlite_locked|\bbusy\b|\blocked\b/.test(text)) return "busy";
  if (/sqlite_corrupt|sqlite_notadb|corrupt|malformed|not a database/.test(text)) return "corrupt";
  if (/schema version|newer than|incompatible|checksum|non-contiguous|migration history/.test(text)) {
    return "incompatible";
  }
  if (/eacces|eperm|permission denied|operation not permitted/.test(text)) {
    return "permission-denied";
  }
  return "unavailable";
}

/**
 * Invoke one caller-owned read-only probe exactly once. Diagnostics never own
 * the resource being observed; asynchronous probes are rejected so they cannot
 * escape the synchronous helper support boundary.
 *
 * @param {unknown} probe
 * @returns {{ available: boolean, value?: unknown, failureCategory?: string }}
 */
export function observePhase4DiagnosticProbe(probe) {
  if (typeof probe !== "function") {
    return Object.freeze({ available: false, failureCategory: "not-observed" });
  }
  try {
    const value = probe();
    if (isPromiseLike(value)) {
      void Promise.resolve(value).catch(() => undefined);
      return Object.freeze({ available: false, failureCategory: "invalid-observation" });
    }
    return Object.freeze({ available: true, value });
  } catch (error) {
    return Object.freeze({
      available: false,
      failureCategory: classifyPhase4DiagnosticFailure(error),
    });
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is PromiseLike<unknown>} */
function isPromiseLike(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  return typeof /** @type {{ then?: unknown }} */ (value).then === "function";
}

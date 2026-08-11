// @ts-check

/**
 * @typedef {{ observe(input: unknown): unknown }} ShadowObserver
 * @typedef {{
 *   importLegacy(): unknown,
 *   shadowObserver: ShadowObserver,
 *   health(): { ok: boolean },
 *   close(): void,
 * }} DeviceBuildShadowRuntimeLike
 * @typedef {{
 *   enabled: boolean,
 *   shadowObserver: ShadowObserver | null,
 *   importResult: unknown,
 *   close(): void,
 * }} DeviceBuildShadowStartup
 */

/**
 * Prepare the device-build SQLite shadow as a strictly optional diagnostic.
 *
 * The helper must remain able to start and serve from authoritative JSON when
 * SQLite construction, schema health, import, backup, lock acquisition, or
 * diagnostic reporting fails. This boundary therefore contains every startup
 * failure and returns a disabled no-op owner. A successfully prepared runtime
 * is closed exactly once by its caller's lifecycle owner.
 *
 * `createRuntime` is injected deliberately. The concrete Phase 4M runtime is a
 * compiled persistence graph; keeping this containment boundary generic makes
 * it source-loadable and independently testable without creating a second
 * production composition owner.
 *
 * @param {{
 *   createRuntime(options: unknown): DeviceBuildShadowRuntimeLike,
 *   runtimeOptions: unknown,
 *   reportError?: (message: string) => unknown,
 * }} options
 * @returns {DeviceBuildShadowStartup}
 */
export function prepareDeviceBuildShadowStartup({
  createRuntime,
  runtimeOptions,
  reportError = () => {},
}) {
  if (typeof createRuntime !== "function") {
    throw new TypeError("Device-build shadow startup requires a runtime factory.");
  }
  if (typeof reportError !== "function") {
    throw new TypeError("Device-build shadow startup error reporter must be a function.");
  }

  /** @type {DeviceBuildShadowRuntimeLike | undefined} */
  let runtime;
  try {
    runtime = createRuntime(runtimeOptions);
    validateRuntime(runtime);
    const health = runtime.health();
    if (!health || health.ok !== true) {
      throw new Error("Device-build shadow runtime is unhealthy.");
    }
    const importResult = runtime.importLegacy();
    return enabledStartup(runtime, importResult);
  } catch {
    try {
      runtime?.close();
    } catch {
      // Preserve the original initialization failure and disable the shadow.
    }
    reportStartupFailure(reportError);
    return disabledStartup();
  }
}

/**
 * @param {DeviceBuildShadowRuntimeLike} runtime
 * @param {unknown} importResult
 * @returns {DeviceBuildShadowStartup}
 */
function enabledStartup(runtime, importResult) {
  let closed = false;
  return Object.freeze({
    enabled: true,
    shadowObserver: runtime.shadowObserver,
    importResult,
    close() {
      if (closed) return;
      closed = true;
      runtime.close();
    },
  });
}

/** @returns {DeviceBuildShadowStartup} */
function disabledStartup() {
  return Object.freeze({
    enabled: false,
    shadowObserver: null,
    importResult: null,
    close() {},
  });
}

/** @param {unknown} runtime */
function validateRuntime(runtime) {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new Error("Device-build shadow runtime is invalid.");
  }
  const values = /** @type {Record<string, unknown>} */ (runtime);
  if (typeof values.importLegacy !== "function") {
    throw new Error("Device-build shadow runtime import is unavailable.");
  }
  if (typeof values.health !== "function") {
    throw new Error("Device-build shadow runtime health is unavailable.");
  }
  if (typeof values.close !== "function") {
    throw new Error("Device-build shadow runtime close is unavailable.");
  }
  const observer = values.shadowObserver;
  if (!observer || typeof observer !== "object" || Array.isArray(observer)) {
    throw new Error("Device-build shadow observer is unavailable.");
  }
  if (typeof (/** @type {Record<string, unknown>} */ (observer).observe) !== "function") {
    throw new Error("Device-build shadow observer is unavailable.");
  }
}

/** @param {(message: string) => unknown} reportError */
function reportStartupFailure(reportError) {
  try {
    const result = reportError(
      "Device-build SQLite shadow initialization failed; using JSON only.",
    );
    void Promise.resolve(result).catch(() => {});
  } catch {
    // Reporting failure cannot make an optional diagnostic mandatory.
  }
}

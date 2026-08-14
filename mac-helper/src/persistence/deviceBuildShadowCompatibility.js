// @ts-check

import { dirname, join } from "node:path";

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
 * @typedef {{
 *   createRuntime(options: unknown): DeviceBuildShadowRuntimeLike,
 *   prepareStartup(options: {
 *     createRuntime(options: unknown): DeviceBuildShadowRuntimeLike,
 *     runtimeOptions: unknown,
 *     reportError: (message: string) => unknown,
 *   }): DeviceBuildShadowStartup,
 *   shadowPaths(legacyPath: string): {
 *     databasePath: string,
 *     backupDirectory: string,
 *     source: unknown,
 *   },
 *   observeSessionShadow?: (options: unknown) => unknown,
 *   sessionShadowPaths?: (legacyPath: string) => {
 *     databasePath: string,
 *     backupDirectory: string,
 *     source: unknown,
 *   },
 * }} DeviceBuildShadowCompatibilityComponents
 */

/**
 * Prepare the optional Phase-4 SQLite observers from existing legacy stores
 * while preserving JSON-only startup on every shadow-specific failure.
 *
 * The durable-session observer is a bounded staged import/comparison only. It
 * derives the authoritative sessions.json path from the same private legacy
 * state root, uses the shared state.sqlite migration history, closes its
 * connection before device startup, and never becomes a product read/write
 * authority. The device-build observer remains long-lived for its established
 * shadow hooks.
 *
 * The concrete persistence graph is dynamically imported. That makes module
 * loading itself part of the fail-open boundary rather than a prerequisite for
 * importing the raw helper entrypoint.
 *
 * @param {{
 *   deviceBuildStore: { path: string },
 *   spawnSync: Function,
 *   clock: object,
 *   reportError?: (message: string) => unknown,
 *   loadComponents?: () => Promise<DeviceBuildShadowCompatibilityComponents>,
 * }} options
 * @returns {Promise<DeviceBuildShadowStartup>}
 */
export async function prepareDeviceBuildShadowCompatibility({
  deviceBuildStore,
  spawnSync,
  clock,
  reportError = () => {},
  loadComponents = loadDefaultComponents,
}) {
  if (!deviceBuildStore || typeof deviceBuildStore.path !== "string") {
    throw new TypeError("Device-build shadow compatibility requires the legacy store path.");
  }
  if (typeof spawnSync !== "function") {
    throw new TypeError("Device-build shadow compatibility requires spawnSync.");
  }
  if (!clock || typeof clock !== "object") {
    throw new TypeError("Device-build shadow compatibility requires clock.");
  }
  if (typeof reportError !== "function") {
    throw new TypeError("Device-build shadow compatibility reporter must be a function.");
  }
  if (typeof loadComponents !== "function") {
    throw new TypeError("Device-build shadow compatibility loader must be a function.");
  }

  /** @type {DeviceBuildShadowCompatibilityComponents} */
  let components;
  try {
    components = await loadComponents();
    validateComponents(components);
  } catch {
    reportGeneric(
      reportError,
      "Device-build SQLite shadow initialization failed; using JSON only.",
    );
    return disabledStartup();
  }

  if (
    typeof components.observeSessionShadow === "function" &&
    typeof components.sessionShadowPaths === "function"
  ) {
    try {
      const sessionPath = join(dirname(deviceBuildStore.path), "sessions.json");
      components.observeSessionShadow({
        ...components.sessionShadowPaths(sessionPath),
        spawnSync,
        clock,
      });
    } catch {
      reportGeneric(
        reportError,
        "Session durable SQLite shadow initialization failed; sessions remain JSON-only.",
      );
    }
  }

  return components.prepareStartup({
    createRuntime() {
      const paths = components.shadowPaths(deviceBuildStore.path);
      return components.createRuntime({
        ...paths,
        spawnSync,
        clock,
        reportError() {
          reportGeneric(reportError, "Device-build SQLite shadow observation failed.");
        },
      });
    },
    runtimeOptions: null,
    reportError,
  });
}

/** @returns {Promise<DeviceBuildShadowCompatibilityComponents>} */
async function loadDefaultComponents() {
  const [
    { createDeviceBuildShadowRuntime },
    { prepareDeviceBuildShadowStartup },
    { deviceBuildShadowPaths },
    { observeSessionDurableShadowSnapshot },
    { sessionDurableShadowPaths },
  ] = await Promise.all([
    import("./deviceBuildShadowRuntime.js"),
    import("./deviceBuildShadowStartup.js"),
    import("./deviceBuildShadowPaths.js"),
    import("./sessionDurableShadowRuntime.js"),
    import("./sessionDurableShadowPaths.js"),
  ]);
  return {
    createRuntime: createDeviceBuildShadowRuntime,
    prepareStartup: prepareDeviceBuildShadowStartup,
    shadowPaths: deviceBuildShadowPaths,
    observeSessionShadow: observeSessionDurableShadowSnapshot,
    sessionShadowPaths: sessionDurableShadowPaths,
  };
}

/** @param {unknown} value */
function validateComponents(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Device-build shadow compatibility components are invalid.");
  }
  const components = /** @type {Record<string, unknown>} */ (value);
  for (const key of ["createRuntime", "prepareStartup", "shadowPaths"]) {
    if (typeof components[key] !== "function") {
      throw new Error(`Device-build shadow compatibility component ${key} is unavailable.`);
    }
  }
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

/** @param {(message: string) => unknown} reportError @param {string} message */
function reportGeneric(reportError, message) {
  try {
    const reporting = reportError(message);
    void Promise.resolve(reporting).catch(() => {});
  } catch {
    // Optional shadow reporting must never become a helper dependency.
  }
}

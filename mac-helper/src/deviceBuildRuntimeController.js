// @ts-check

import { normalizeDeviceBuildTTLMinutes } from "./deviceBuildDefaults.js";
import { runDeliveryCleanupSafely } from "./deliveryCleanupScheduler.js";
import { trackDeviceBuildTask as trackRegisteredDeviceBuildTask } from "./deviceBuildTaskTracker.js";

/** @typedef {import("./infrastructure/ports.js").Clock} Clock */
/** @typedef {{ mode?: string, provider?: string | undefined, expiresAt?: string | undefined, generation?: string, referenceID?: string }} BuildDelivery */
/** @typedef {{ cancelPath?: string }} BuildControl */
/** @typedef {{ id?: string }} PendingRenewal */
/** @typedef {{
 *   id: string,
 *   state: string,
 *   project?: unknown,
 *   workspace?: unknown,
 *   scheme?: string,
 *   configuration?: unknown,
 *   remoteBaseUrl?: unknown,
 *   delivery?: BuildDelivery,
 *   exportMethod?: unknown,
 *   installTTLMinutes?: unknown,
 *   ttlMinutes?: unknown,
 *   preserveData?: boolean,
 *   buildSettings?: unknown[],
 *   allowProvisioningUpdates?: boolean,
 *   control?: BuildControl,
 *   pendingRenewal?: PendingRenewal,
 *   expiresAt?: string,
 *   logs?: string[],
 *   app?: unknown,
 *   artifacts?: unknown,
 * }} BuildRecord */
/** @typedef {{ afterTerminalBuild(build: BuildRecord): unknown }} ArtifactRetentionLike */
/** @typedef {{ id: string, generation: string, referenceID: string, nextAttemptAt?: string, createdAt?: string }} DeliveryCleanupJob */
/** @typedef {{ generation?: string, provider?: string, publicBaseUrl?: string, expiresAt?: string, references?: string[] }} DeliveryStatus */
/** @typedef {{ generation?: string, provider?: string, publicBaseUrl: string, expiresAt?: string }} DeliveryResult */
/** @typedef {{
 *   create(input: Record<string, unknown>): BuildRecord,
 *   save(build: BuildRecord): unknown,
 *   list(): BuildRecord[],
 *   nextBuildNumber(app: unknown, current: unknown): string,
 *   listDeliveryReferenceCleanupJobs(): DeliveryCleanupJob[],
 *   completeDeliveryReferenceCleanupJob(jobID: string): unknown,
 *   failDeliveryReferenceCleanupJob(jobID: string, error: unknown): unknown,
 * }} DeviceBuildStoreLike */
/** @typedef {{
 *   ensure(input: { ttlMinutes: number, cancelPath: string, referenceID: string }): Promise<DeliveryResult>,
 *   stopGeneration(generation: string, options: { referenceID: string }): boolean,
 *   statuses(): DeliveryStatus[],
 * }} DeviceDeliveryLike */
/** @typedef {{
 *   once(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown,
 *   off(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown,
 * }} SignalRuntime */
/** @typedef {{
 *   store: DeviceBuildStoreLike,
 *   delivery: DeviceDeliveryLike,
 *   pathExists(path: string): boolean,
 *   clock: Clock,
 *   capabilityExpiresAt(input: { ttlMinutes: number, deliveryExpiresAt: string, now: number }): string,
 *   runBuild(build: BuildRecord, options: { save(next: BuildRecord): unknown, nextBuildNumber(app: unknown, current: unknown): string }): Promise<unknown>,
 *   requestCancellation(build: BuildRecord, reason: string): unknown,
 *   terminateRecordedWorker(build: BuildRecord): Promise<boolean>,
 *   signals: SignalRuntime,
 *   artifactRetention?: ArtifactRetentionLike,
 *   reportRetentionError?(message: string): unknown,
 * }} DeviceBuildRuntimeDependencies */

const ACTIVE_BUILD_STATES = new Set([
  "validating",
  "preparing",
  "archiving",
  "building",
  "exporting",
  "delivering",
]);

/** @param {DeviceBuildRuntimeDependencies} dependencies */
export function createDeviceBuildRuntimeController(dependencies) {
  validateDependencies(dependencies);
  /** @type {Map<string, { build: BuildRecord, promise: Promise<unknown> }>} */
  const activeTasks = new Map();
  let deliveryCleanupRunning = false;

  return Object.freeze({
    createBuild,
    prepareDelivery,
    runCliBuild,
    startBuild,
    trackTask,
    recoverInterruptedBuilds,
    drainDeliveryReferences,
    scheduleDeliveryCleanup,
    activeTasks: () => [...activeTasks.values()],
    cancelBuild,
  });

  /** @param {BuildRecord} build @param {string} reason */
  function cancelBuild(build, reason) {
    return dependencies.requestCancellation(build, reason);
  }

  /** @param {Record<string, unknown>} values */
  async function createBuild(values) {
    const remoteBaseUrl = values["remote-base-url"] || "";
    const delivery = values.delivery || (remoteBaseUrl ? "custom" : "quick-tunnel");
    if (delivery !== "custom" && delivery !== "quick-tunnel") {
      throw new Error("Device delivery must be custom or quick-tunnel.");
    }
    if (delivery === "custom" && !remoteBaseUrl) {
      throw new Error("Custom device delivery requires --remote-base-url.");
    }
    const build = dependencies.store.create({
      project: values.project || "",
      workspace: values.workspace || "",
      scheme: requiredString(values.scheme, "scheme"),
      configuration: values.configuration || "Release",
      remoteBaseUrl,
      delivery,
      exportMethod: values["export-method"] || "development",
      ttlMinutes: values["ttl-minutes"],
      preserveData: !values["replace-app-data"],
    });
    build.buildSettings = Array.isArray(values["build-setting"]) ? values["build-setting"] : [];
    build.allowProvisioningUpdates = Boolean(values["allow-provisioning-updates"]);
    dependencies.store.save(build);
    return build;
  }

  /** @param {BuildRecord} build @param {{ markBuildFailed?: boolean }} [options] */
  async function prepareDelivery(build, { markBuildFailed = true } = {}) {
    let startedGeneration = "";
    let deliveryReferenceID = "";
    try {
      ensureBuildNotCancelled(build);
      const ttlMinutes = normalizeDeviceBuildTTLMinutes(build.installTTLMinutes);
      if (build.remoteBaseUrl || build.delivery?.mode === "custom") {
        build.expiresAt = dependencies.capabilityExpiresAt({
          ttlMinutes,
          deliveryExpiresAt: "",
          now: dependencies.clock.now().getTime(),
        });
        build.delivery = {
          mode: "custom",
          provider: "user-configured",
          expiresAt: build.expiresAt,
        };
        build.state = "ready";
        ensureBuildNotCancelled(build);
        dependencies.store.save(build);
        return build;
      }

      deliveryReferenceID = build.pendingRenewal?.id
        ? `renewal:${build.pendingRenewal.id}`
        : build.delivery?.referenceID || `build:${build.id}`;
      const delivery = await dependencies.delivery.ensure({
        ttlMinutes,
        cancelPath: build.control?.cancelPath || "",
        referenceID: deliveryReferenceID,
      });
      startedGeneration = delivery.generation || "";
      ensureBuildNotCancelled(build);
      build.expiresAt = dependencies.capabilityExpiresAt({
        ttlMinutes,
        deliveryExpiresAt: delivery.expiresAt || "",
        now: dependencies.clock.now().getTime(),
      });
      build.remoteBaseUrl = delivery.publicBaseUrl;
      build.delivery = {
        mode: "quick-tunnel",
        provider: delivery.provider,
        expiresAt: delivery.expiresAt,
        generation: delivery.generation || "",
        referenceID: deliveryReferenceID,
      };
      build.state = "ready";
      buildLogs(build).push("Temporary HTTPS install link is ready. Tailscale is not required.");
      dependencies.store.save(build);
      return build;
    } catch (error) {
      if (startedGeneration && deliveryReferenceID) {
        try {
          dependencies.delivery.stopGeneration(startedGeneration, {
            referenceID: deliveryReferenceID,
          });
        } catch {}
      }
      if (hasErrorCode(error, "SWIFT_SIM_BUILD_CANCELLED")) throw error;
      if (markBuildFailed) build.state = "failed";
      buildLogs(build).push(error instanceof Error ? error.message : String(error));
      try {
        dependencies.store.save(build);
      } catch {}
      throw error;
    }
  }

  /** @param {BuildRecord} build */
  async function runCliBuild(build) {
    const interrupt = () => {
      dependencies.requestCancellation(build, "Swift Sim device build was interrupted.");
    };
    dependencies.signals.once("SIGTERM", interrupt);
    dependencies.signals.once("SIGINT", interrupt);
    try {
      await runBuildPipeline(build);
    } finally {
      dependencies.signals.off("SIGTERM", interrupt);
      dependencies.signals.off("SIGINT", interrupt);
    }
  }

  /** @param {BuildRecord} build */
  function startBuild(build) {
    return trackInternal(`build:${build.id}`, build, async () => {
      try {
        return await runBuildPipeline(build);
      } catch (error) {
        if (hasErrorCode(error, "SWIFT_SIM_BUILD_CANCELLED")) {
          build.state = "failed";
          buildLogs(build).push("Build was interrupted before completion.");
          try {
            dependencies.store.save(build);
          } catch {}
          retainTerminalBuild(build);
        }
        return undefined;
      }
    });
  }

  /**
   * @param {string} key
   * @param {BuildRecord} build
   * @param {() => Promise<BuildRecord>} operation
   * @returns {Promise<BuildRecord>}
   */
  function trackTask(key, build, operation) {
    return /** @type {Promise<BuildRecord>} */ (trackInternal(key, build, operation));
  }

  async function recoverInterruptedBuilds() {
    for (const build of dependencies.store
      .list()
      .filter((candidate) => ACTIVE_BUILD_STATES.has(candidate.state))) {
      dependencies.requestCancellation(build, "Recovering an interrupted Swift Sim helper run.");
      const terminated = await dependencies.terminateRecordedWorker(build);
      for (const delivery of dependencies.delivery.statuses()) {
        for (const referenceID of delivery.references || []) {
          if (
            referenceID === `build:${build.id}` ||
            referenceID === `renewal:${build.pendingRenewal?.id || ""}`
          ) {
            try {
              dependencies.delivery.stopGeneration(delivery.generation || "", { referenceID });
            } catch {}
          }
        }
      }
      build.state = "failed";
      buildLogs(build).push(
        terminated
          ? "A previous helper run ended during this build. Start a new build to continue."
          : "A previous helper run ended during this build, and its worker could not be safely confirmed stopped.",
      );
      try {
        dependencies.store.save(build);
      } catch {}
      retainTerminalBuild(build);
    }
  }

  async function drainDeliveryReferences() {
    if (deliveryCleanupRunning) return;
    deliveryCleanupRunning = true;
    try {
      for (const job of dependencies.store.listDeliveryReferenceCleanupJobs()) {
        const dueAt = Date.parse(job.nextAttemptAt || job.createdAt || "");
        if (Number.isFinite(dueAt) && dueAt > dependencies.clock.now().getTime()) continue;
        try {
          const released = dependencies.delivery.stopGeneration(job.generation, {
            referenceID: job.referenceID,
          });
          if (!released) {
            throw new Error("Delivery generation is still referenced or could not be stopped.");
          }
          dependencies.store.completeDeliveryReferenceCleanupJob(job.id);
        } catch (error) {
          dependencies.store.failDeliveryReferenceCleanupJob(job.id, error);
        }
      }
    } finally {
      deliveryCleanupRunning = false;
    }
  }

  function scheduleDeliveryCleanup() {
    return runDeliveryCleanupSafely(() => drainDeliveryReferences());
  }

  /** @param {BuildRecord} build */
  async function runBuildPipeline(build) {
    try {
      await dependencies.runBuild(build, {
        save: (next) => dependencies.store.save(next),
        nextBuildNumber: (app, current) => dependencies.store.nextBuildNumber(app, current),
      });
      build.state = "delivering";
      buildLogs(build).push("Creating temporary install link.");
      dependencies.store.save(build);
      const readyBuild = await prepareDelivery(build);
      buildLogs(readyBuild).push("Install link is ready.");
      dependencies.store.save(readyBuild);
      retainTerminalBuild(readyBuild);
      return readyBuild;
    } catch (error) {
      if (build.state === "failed") retainTerminalBuild(build);
      throw error;
    }
  }

  /** @param {BuildRecord} build */
  function retainTerminalBuild(build) {
    if (!dependencies.artifactRetention) return;
    try {
      dependencies.artifactRetention.afterTerminalBuild(build);
    } catch {
      try {
        dependencies.reportRetentionError?.(
          "Device-build artifact retention failed; build metadata and install state were preserved.",
        );
      } catch {}
    }
  }

  /**
   * @param {string} key
   * @param {BuildRecord} build
   * @param {() => Promise<unknown> | unknown} operation
   * @returns {Promise<unknown>}
   */
  function trackInternal(key, build, operation) {
    return trackRegisteredDeviceBuildTask(activeTasks, key, build, operation);
  }

  /** @param {BuildRecord} build */
  function ensureBuildNotCancelled(build) {
    const cancelPath = build.control?.cancelPath || "";
    if (!cancelPath || !dependencies.pathExists(cancelPath)) return;
    const error = Object.assign(
      new Error("Device build was cancelled while delivery was starting."),
      { code: "SWIFT_SIM_BUILD_CANCELLED" },
    );
    throw error;
  }
}

/** @param {BuildRecord} build */
function buildLogs(build) {
  if (!Array.isArray(build.logs)) build.logs = [];
  return build.logs;
}

/** @param {unknown} value @param {string} name */
function requiredString(value, name) {
  if (!value || typeof value !== "string") throw new Error(`Missing required ${name}.`);
  return value;
}

/** @param {unknown} error @param {string} expected */
function hasErrorCode(error, expected) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    /** @type {{ code?: unknown }} */ (error).code === expected,
  );
}

/** @param {DeviceBuildRuntimeDependencies} dependencies */
function validateDependencies(dependencies) {
  const required = [
    ["store.create", dependencies?.store?.create],
    ["store.save", dependencies?.store?.save],
    ["store.list", dependencies?.store?.list],
    ["store.nextBuildNumber", dependencies?.store?.nextBuildNumber],
    [
      "store.listDeliveryReferenceCleanupJobs",
      dependencies?.store?.listDeliveryReferenceCleanupJobs,
    ],
    [
      "store.completeDeliveryReferenceCleanupJob",
      dependencies?.store?.completeDeliveryReferenceCleanupJob,
    ],
    ["store.failDeliveryReferenceCleanupJob", dependencies?.store?.failDeliveryReferenceCleanupJob],
    ["delivery.ensure", dependencies?.delivery?.ensure],
    ["delivery.stopGeneration", dependencies?.delivery?.stopGeneration],
    ["delivery.statuses", dependencies?.delivery?.statuses],
    ["pathExists", dependencies?.pathExists],
    ["clock.now", dependencies?.clock?.now],
    ["clock.monotonicMilliseconds", dependencies?.clock?.monotonicMilliseconds],
    ["clock.sleep", dependencies?.clock?.sleep],
    ["capabilityExpiresAt", dependencies?.capabilityExpiresAt],
    ["runBuild", dependencies?.runBuild],
    ["requestCancellation", dependencies?.requestCancellation],
    ["terminateRecordedWorker", dependencies?.terminateRecordedWorker],
    ["signals.once", dependencies?.signals?.once],
    ["signals.off", dependencies?.signals?.off],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Device build runtime controller requires ${name}.`);
    }
  }
  if (
    dependencies.artifactRetention !== undefined &&
    typeof dependencies.artifactRetention?.afterTerminalBuild !== "function"
  ) {
    throw new TypeError(
      "Device build runtime controller artifactRetention requires afterTerminalBuild.",
    );
  }
  if (
    dependencies.reportRetentionError !== undefined &&
    typeof dependencies.reportRetentionError !== "function"
  ) {
    throw new TypeError("Device build runtime controller reportRetentionError must be a function.");
  }
}

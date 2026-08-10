from pathlib import Path

ROOT = Path('.')


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    path.write_text(text.replace(old, new, 1))


controller = r'''// @ts-check

import { normalizeDeviceBuildTTLMinutes } from "./deviceBuildDefaults.js";
import { runDeliveryCleanupSafely } from "./deliveryCleanupScheduler.js";
import { trackDeviceBuildTask as trackRegisteredDeviceBuildTask } from "./deviceBuildTaskTracker.js";

/** @typedef {import("./infrastructure/ports.js").Clock} Clock */
/** @typedef {{ mode?: string, provider?: string, expiresAt?: string, generation?: string, referenceID?: string }} BuildDelivery */
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
 * }} BuildRecord */
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
 * }} DeviceBuildRuntimeDependencies */
 */

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
    cancelBuild: (build, reason) => dependencies.requestCancellation(build, reason),
  });

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
    build.buildSettings = Array.isArray(values["build-setting"])
      ? [...values["build-setting"]]
      : [];
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
          dependencies.delivery.stopGeneration(startedGeneration, { referenceID: deliveryReferenceID });
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
    for (const build of dependencies.store.list().filter((candidate) => ACTIVE_BUILD_STATES.has(candidate.state))) {
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
    return readyBuild;
  }

  /**
   * @template Result
   * @param {string} key
   * @param {BuildRecord} build
   * @param {() => Promise<Result> | Result} operation
   * @returns {Promise<Result>}
   */
  function trackInternal(key, build, operation) {
    return trackRegisteredDeviceBuildTask(
      /** @type {Map<string, { build: BuildRecord, promise: Promise<Result> }>} */ (
        /** @type {unknown} */ (activeTasks)
      ),
      key,
      build,
      operation,
    );
  }

  /** @param {BuildRecord} build */
  function ensureBuildNotCancelled(build) {
    const cancelPath = build.control?.cancelPath || "";
    if (!cancelPath || !dependencies.pathExists(cancelPath)) return;
    const error = new Error("Device build was cancelled while delivery was starting.");
    // @ts-expect-error Compatibility errors carry stable string codes.
    error.code = "SWIFT_SIM_BUILD_CANCELLED";
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
    ["store.listDeliveryReferenceCleanupJobs", dependencies?.store?.listDeliveryReferenceCleanupJobs],
    ["store.completeDeliveryReferenceCleanupJob", dependencies?.store?.completeDeliveryReferenceCleanupJob],
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
}
'''
(ROOT / 'mac-helper/src/deviceBuildRuntimeController.js').write_text(controller)

helper = ROOT / 'mac-helper/bin/swift-sim-helper.js'
text = helper.read_text()
text = text.replace('import { runDeliveryCleanupSafely } from "../src/deliveryCleanupScheduler.js";\n', '', 1)
text = text.replace('import {\n  normalizeDeviceBuildTTLMinutes,\n} from "../src/deviceBuildDefaults.js";\n', '', 1)
text = text.replace('import { trackDeviceBuildTask as trackRegisteredDeviceBuildTask } from "../src/deviceBuildTaskTracker.js";\n', '', 1)
text = text.replace(
    'import { createSessionRuntimeController } from "../src/sessionRuntimeController.js";\n',
    'import { createSessionRuntimeController } from "../src/sessionRuntimeController.js";\nimport { createDeviceBuildRuntimeController } from "../src/deviceBuildRuntimeController.js";\n',
    1,
)
text = text.replace('let activeDeviceBuildTasks;\nlet deliveryReferenceCleanupRunning;\n', '', 1)
text = text.replace('let sessionRuntime;\nlet setupStatusRuntime;\n', 'let sessionRuntime;\nlet deviceBuildRuntime;\nlet setupStatusRuntime;\n', 1)
text = text.replace('  activeDeviceBuildTasks = runtime.activeDeviceBuildTasks;\n', '', 1)
anchor = '''  sessionRuntime = createSessionRuntimeController({\n    store,\n    transports,\n    adapter,\n    defaultTransportPreference,\n    idGenerator: runtime.idGenerator,\n    clock: runtime.clock,\n  });\n'''
replacement = anchor + '''  deviceBuildRuntime = createDeviceBuildRuntimeController({\n    store: deviceBuildStore,\n    delivery: deviceDelivery,\n    pathExists: existsSync,\n    clock: runtime.clock,\n    capabilityExpiresAt: buildCapabilityExpiresAt,\n    runBuild: runDeviceBuild,\n    requestCancellation: requestDeviceBuildCancellation,\n    terminateRecordedWorker: terminateRecordedDeviceBuildWorker,\n    signals: {\n      once: (signal, listener) => process.once(signal, listener),\n      off: (signal, listener) => process.off(signal, listener),\n    },\n  });\n'''
if anchor not in text:
    raise SystemExit('device build controller composition anchor missing')
text = text.replace(anchor, replacement, 1)
text = text.replace('  deliveryReferenceCleanupRunning = false;\n', '', 1)
text = text.replace('''      async buildDevice(values) {\n        const build = await createDeviceBuild(values);\n        await runCLIDeviceBuild(build);\n        return publicDeviceBuild(build);\n      },\n''', '''      async buildDevice(values) {\n        const build = await deviceBuildRuntime.createBuild(values);\n        await deviceBuildRuntime.runCliBuild(build);\n        return publicDeviceBuild(build);\n      },\n''', 1)
text = text.replace('    recoverInterruptedBuilds: recoverInterruptedDeviceBuilds,\n', '    recoverInterruptedBuilds: () => deviceBuildRuntime.recoverInterruptedBuilds(),\n', 1)
text = text.replace('    scheduleDeliveryCleanup: scheduleDeliveryReferenceCleanup,\n', '    scheduleDeliveryCleanup: () => deviceBuildRuntime.scheduleDeliveryCleanup(),\n', 1)
text = text.replace('    activeBuildTasks: () => [...activeDeviceBuildTasks.values()],\n', '    activeBuildTasks: () => deviceBuildRuntime.activeTasks(),\n', 1)
text = text.replace('    cancelBuild: requestDeviceBuildCancellation,\n', '    cancelBuild: (build, reason) => deviceBuildRuntime.cancelBuild(build, reason),\n', 1)
text = text.replace('    startBuild: startManagedDeviceBuild,\n', '    startBuild: (build) => deviceBuildRuntime.startBuild(build),\n', 1)
text = text.replace('    drainDeliveryReferences: drainDeliveryReferenceCleanupJobs,\n', '    drainDeliveryReferences: () => deviceBuildRuntime.drainDeliveryReferences(),\n', 1)
text = text.replace('    createBuild: createDeviceBuild,\n', '    createBuild: (values) => deviceBuildRuntime.createBuild(values),\n', 1)
text = text.replace('    startBuild: startManagedDeviceBuild,\n', '    startBuild: (build) => deviceBuildRuntime.startBuild(build),\n', 1)
text = text.replace('    trackTask: trackDeviceBuildTask,\n', '    trackTask: (key, build, operation) => deviceBuildRuntime.trackTask(key, build, operation),\n', 1)
text = text.replace('    prepareDelivery: prepareDeviceDelivery,\n', '    prepareDelivery: (build, options) => deviceBuildRuntime.prepareDelivery(build, options),\n', 1)
first_start = text.find('async function createDeviceBuild(values) {\n')
secrets_start = text.find('function secretsMatch(expectedValue, actualValue) {\n', first_start)
if first_start < 0 or secrets_start < 0:
    raise SystemExit('device-build first extraction sentinels missing')
text = text[:first_start] + text[secrets_start:]
second_start = text.find('async function drainDeliveryReferenceCleanupJobs() {\n')
ensure_token = text.find('function ensureToken(session, token) {\n', second_start)
if second_start < 0 or ensure_token < 0:
    raise SystemExit('device-build second extraction sentinels missing')
text = text[:second_start] + text[ensure_token:]
helper.write_text(text)

runtime = ROOT / 'mac-helper/src/infrastructure/compatibilityHelperRuntime.js'
replace_once(
    runtime,
    ' *   activeDeviceBuildTasks: Map<string, unknown>,\n',
    '',
    'compatibility runtime task state type',
)
replace_once(
    runtime,
    '    activeDeviceBuildTasks: new Map(),\n',
    '',
    'compatibility runtime task state',
)

runtime_test = ROOT / 'test/compatibilityHelperRuntime.test.js'
replace_once(
    runtime_test,
    '  assert.equal(runtime.activeDeviceBuildTasks.size, 0);\n',
    '',
    'runtime task state assertion',
)
rt = runtime_test.read_text()
start = rt.find('test("compatibility runtime owns fresh task state per composition", () => {\n')
end = rt.find('test("compatibility runtime fails closed when the state-root factory is absent", () => {\n', start)
if start < 0 or end < 0:
    raise SystemExit('runtime fresh task test sentinels missing')
runtime_test.write_text(rt[:start] + rt[end:])

package = ROOT / 'package.json'
replace_once(
    package,
    'mac-helper/src/helperEntrypoint.js mac-helper/src/sessionRuntimeController.js \\"test/**/*.ts\\"',
    'mac-helper/src/helperEntrypoint.js mac-helper/src/sessionRuntimeController.js mac-helper/src/deviceBuildRuntimeController.js \\"test/**/*.ts\\"',
    'format surface',
)
replace_once(
    package,
    'mac-helper/src/helperEntrypoint.js mac-helper/src/sessionRuntimeController.js test --ext .js,.ts',
    'mac-helper/src/helperEntrypoint.js mac-helper/src/sessionRuntimeController.js mac-helper/src/deviceBuildRuntimeController.js test --ext .js,.ts',
    'lint surface',
)


test_source = r'''import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceBuildRuntimeController } from "../mac-helper/src/deviceBuildRuntimeController.js";

const FIXED_NOW = "2026-08-10T22:00:00.000Z";

function build(id = "build-1") {
  return {
    id,
    state: "queued",
    scheme: "App",
    installTTLMinutes: 60,
    control: { cancelPath: `/tmp/${id}.cancelled` },
    delivery: { mode: "quick-tunnel" },
    logs: [],
  };
}

function harness(overrides = {}) {
  const saved = [];
  const cancelled = [];
  const stopped = [];
  const signals = [];
  const builds = [];
  const cleanupJobs = [];
  let counter = 0;
  const store = {
    create(input) {
      const value = { ...build(`build-${++counter}`), ...input, logs: [] };
      builds.push(value);
      return value;
    },
    save(value) {
      saved.push({ id: value.id, state: value.state, logs: [...(value.logs || [])] });
      return value;
    },
    list: () => builds,
    nextBuildNumber: (_app, current) => String(Number(current || 0) + 1),
    listDeliveryReferenceCleanupJobs: () => cleanupJobs,
    completeDeliveryReferenceCleanupJob: (id) => saved.push({ complete: id }),
    failDeliveryReferenceCleanupJob: (id, error) => saved.push({ failed: id, error: String(error) }),
  };
  const delivery = {
    async ensure() {
      return {
        generation: "generation-1",
        provider: "cloudflare-quick-tunnel",
        publicBaseUrl: "https://build.trycloudflare.com",
        expiresAt: "2026-08-10T23:00:00.000Z",
      };
    },
    stopGeneration(generation, options) {
      stopped.push([generation, options.referenceID]);
      return true;
    },
    statuses: () => [],
  };
  const deps = {
    store,
    delivery,
    pathExists: () => false,
    clock: {
      now: () => new Date(FIXED_NOW),
      monotonicMilliseconds: () => 0,
      async sleep() {},
    },
    capabilityExpiresAt: ({ ttlMinutes, deliveryExpiresAt, now }) =>
      `${ttlMinutes}:${deliveryExpiresAt}:${new Date(now).toISOString()}`,
    async runBuild(value) {
      value.state = "exporting";
    },
    requestCancellation(value, reason) {
      cancelled.push([value.id, reason]);
      return true;
    },
    async terminateRecordedWorker() {
      return true;
    },
    signals: {
      once(signal, listener) { signals.push(["once", signal, listener]); },
      off(signal, listener) { signals.push(["off", signal, listener]); },
    },
    ...overrides,
  };
  return { deps, store, delivery, saved, cancelled, stopped, signals, builds, cleanupJobs };
}

test("device build runtime requires explicit persistence, delivery, clock, build, and signal seams", () => {
  assert.throws(() => createDeviceBuildRuntimeController({}), /requires store\.create/);
  const { deps } = harness({ clock: undefined });
  assert.throws(() => createDeviceBuildRuntimeController(deps), /requires clock\.now/);
});

test("createBuild preserves validation, defaults, and build-setting projection", async () => {
  const { deps, builds } = harness();
  const runtime = createDeviceBuildRuntimeController(deps);
  await assert.rejects(runtime.createBuild({}), /Missing required scheme/);
  await assert.rejects(
    runtime.createBuild({ scheme: "App", delivery: "custom" }),
    /requires --remote-base-url/,
  );
  await assert.rejects(
    runtime.createBuild({ scheme: "App", delivery: "invalid" }),
    /must be custom or quick-tunnel/,
  );
  const created = await runtime.createBuild({
    project: "App.xcodeproj",
    scheme: "App",
    "build-setting": ["A=1", "B=2"],
    "allow-provisioning-updates": 1,
    "replace-app-data": true,
  });
  assert.equal(created.scheme, "App");
  assert.deepEqual(created.buildSettings, ["A=1", "B=2"]);
  assert.equal(created.allowProvisioningUpdates, true);
  assert.equal(created.preserveData, false);
  assert.equal(builds.length, 1);
});

test("prepareDelivery preserves custom and quick-tunnel projections with clock-owned expiry", async () => {
  const { deps, saved, stopped } = harness();
  const runtime = createDeviceBuildRuntimeController(deps);
  const custom = { ...build("custom"), remoteBaseUrl: "https://example.test", delivery: { mode: "custom" } };
  await runtime.prepareDelivery(custom);
  assert.equal(custom.state, "ready");
  assert.equal(custom.delivery.provider, "user-configured");
  assert.match(custom.expiresAt, /^60::2026-08-10T22:00:00\.000Z$/);

  const quick = build("quick");
  await runtime.prepareDelivery(quick);
  assert.equal(quick.state, "ready");
  assert.equal(quick.remoteBaseUrl, "https://build.trycloudflare.com");
  assert.equal(quick.delivery.referenceID, "build:quick");
  assert.ok(quick.logs.includes("Temporary HTTPS install link is ready. Tailscale is not required."));
  assert.equal(stopped.length, 0);
  assert.ok(saved.some((entry) => entry.id === "quick" && entry.state === "ready"));
});

test("prepareDelivery releases a started generation when cancellation wins after ensure", async () => {
  let cancelled = false;
  const { deps, stopped } = harness({
    pathExists: () => cancelled,
    delivery: {
      async ensure() {
        cancelled = true;
        return {
          generation: "generation-cancelled",
          provider: "cloudflare-quick-tunnel",
          publicBaseUrl: "https://cancelled.trycloudflare.com",
          expiresAt: "2026-08-10T23:00:00.000Z",
        };
      },
      stopGeneration(generation, options) {
        stopped.push([generation, options.referenceID]);
        return true;
      },
      statuses: () => [],
    },
  });
  const runtime = createDeviceBuildRuntimeController(deps);
  await assert.rejects(runtime.prepareDelivery(build("cancelled")), /cancelled while delivery was starting/);
  assert.deepEqual(stopped, [["generation-cancelled", "build:cancelled"]]);
});

test("managed starts coalesce by build ID and keep detached failure semantics", async () => {
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { deps } = harness({
    async runBuild() {
      runs += 1;
      await gate;
    },
  });
  const runtime = createDeviceBuildRuntimeController(deps);
  const value = build("shared");
  const first = runtime.startBuild(value);
  const second = runtime.startBuild(value);
  await Promise.resolve();
  assert.equal(runs, 1);
  assert.strictEqual(first, second);
  assert.equal(runtime.activeTasks().length, 1);
  release();
  await first;
  assert.equal(runtime.activeTasks().length, 0);
  assert.equal(value.state, "ready");
  assert.ok(value.logs.includes("Install link is ready."));
});

test("managed cancellation records interruption while the detached start resolves", async () => {
  const cancellation = Object.assign(new Error("cancelled"), { code: "SWIFT_SIM_BUILD_CANCELLED" });
  const { deps, saved } = harness({
    async runBuild() { throw cancellation; },
  });
  const runtime = createDeviceBuildRuntimeController(deps);
  const value = build("interrupted");
  await runtime.startBuild(value);
  assert.equal(value.state, "failed");
  assert.ok(value.logs.includes("Build was interrupted before completion."));
  assert.ok(saved.some((entry) => entry.id === "interrupted" && entry.state === "failed"));
});

test("CLI build owns temporary signal listeners and always detaches them", async () => {
  const { deps, signals } = harness();
  const runtime = createDeviceBuildRuntimeController(deps);
  await runtime.runCliBuild(build("cli"));
  assert.deepEqual(signals.map(([kind, signal]) => [kind, signal]), [
    ["once", "SIGTERM"],
    ["once", "SIGINT"],
    ["off", "SIGTERM"],
    ["off", "SIGINT"],
  ]);
  assert.strictEqual(signals[0][2], signals[2][2]);
  assert.strictEqual(signals[1][2], signals[3][2]);
});

test("delivery cleanup uses the injected clock, records outcomes, and prevents overlapping drains", async () => {
  let releases = 0;
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  const { deps, cleanupJobs, saved } = harness({
    delivery: {
      async ensure() { throw new Error("not used"); },
      stopGeneration() {
        releases += 1;
        if (releases === 1) return true;
        return false;
      },
      statuses: () => [],
    },
  });
  cleanupJobs.push(
    { id: "future", generation: "g-future", referenceID: "r-future", nextAttemptAt: "2026-08-10T22:01:00.000Z" },
    { id: "ready", generation: "g-ready", referenceID: "r-ready", nextAttemptAt: "2026-08-10T21:59:00.000Z" },
    { id: "retry", generation: "g-retry", referenceID: "r-retry", createdAt: "2026-08-10T21:00:00.000Z" },
  );
  const runtime = createDeviceBuildRuntimeController(deps);
  await runtime.drainDeliveryReferences();
  assert.equal(releases, 2);
  assert.ok(saved.some((entry) => entry.complete === "ready"));
  assert.ok(saved.some((entry) => entry.failed === "retry"));
  unblock();
  await gate;
});

test("recovery cancels active builds, cleans matching delivery references, and persists failure", async () => {
  const { deps, builds, cancelled, stopped, saved } = harness({
    delivery: {
      async ensure() { throw new Error("not used"); },
      stopGeneration(generation, options) {
        stopped.push([generation, options.referenceID]);
        return true;
      },
      statuses: () => [{ generation: "generation-1", references: ["build:recover", "renewal:lease-1", "other"] }],
    },
  });
  const value = { ...build("recover"), state: "building", pendingRenewal: { id: "lease-1" } };
  builds.push(value);
  const runtime = createDeviceBuildRuntimeController(deps);
  await runtime.recoverInterruptedBuilds();
  assert.deepEqual(cancelled, [["recover", "Recovering an interrupted Swift Sim helper run."]]);
  assert.deepEqual(stopped, [
    ["generation-1", "build:recover"],
    ["generation-1", "renewal:lease-1"],
  ]);
  assert.equal(value.state, "failed");
  assert.ok(value.logs[0].startsWith("A previous helper run ended during this build."));
  assert.ok(saved.some((entry) => entry.id === "recover" && entry.state === "failed"));
});
'''
(ROOT / 'test/deviceBuildRuntimeController.test.js').write_text(test_source)

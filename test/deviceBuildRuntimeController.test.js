import assert from "node:assert/strict";
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

test("delivery cleanup uses the injected clock, skips future jobs, and records outcomes", async () => {
  let releases = 0;
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

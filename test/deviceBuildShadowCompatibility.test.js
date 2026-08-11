import assert from "node:assert/strict";
import test from "node:test";
import { prepareDeviceBuildShadowCompatibility } from "../mac-helper/src/persistence/deviceBuildShadowCompatibility.js";

test("device-build shadow compatibility composes canonical paths and generic diagnostics", async () => {
  const events = [];
  const diagnostics = [];
  const observer = { observe() {} };
  let runtimeOptions;
  let closeCalls = 0;
  const startup = await prepareDeviceBuildShadowCompatibility({
    deviceBuildStore: { path: "/tmp/swift-sim/device-builds.json" },
    spawnSync() {},
    clock: { now: () => new Date("2026-08-11T18:00:00.000Z") },
    reportError(message) {
      diagnostics.push(message);
    },
    async loadComponents() {
      return {
        shadowPaths(path) {
          events.push(["paths", path]);
          return {
            databasePath: "/tmp/swift-sim/state.sqlite",
            backupDirectory: "/tmp/swift-sim/migration-backups/device-builds",
            source: { path },
          };
        },
        createRuntime(options) {
          runtimeOptions = options;
          events.push(["runtime"]);
          return {
            health: () => ({ ok: true }),
            importLegacy: () => ({ status: "already-current" }),
            shadowObserver: observer,
            close() {
              closeCalls += 1;
            },
          };
        },
        prepareStartup({ createRuntime, runtimeOptions: options, reportError }) {
          events.push(["startup"]);
          const runtime = createRuntime(options);
          runtimeOptions.reportError(new Error("private observation detail"));
          return {
            enabled: true,
            shadowObserver: runtime.shadowObserver,
            importResult: runtime.importLegacy(),
            close: () => runtime.close(),
            reportError,
          };
        },
      };
    },
  });

  assert.equal(startup.enabled, true);
  assert.strictEqual(startup.shadowObserver, observer);
  assert.deepEqual(startup.importResult, { status: "already-current" });
  assert.deepEqual(events, [
    ["startup"],
    ["paths", "/tmp/swift-sim/device-builds.json"],
    ["runtime"],
  ]);
  assert.equal(runtimeOptions.databasePath, "/tmp/swift-sim/state.sqlite");
  assert.equal(runtimeOptions.backupDirectory, "/tmp/swift-sim/migration-backups/device-builds");
  assert.strictEqual(typeof runtimeOptions.spawnSync, "function");
  assert.deepEqual(diagnostics, ["Device-build SQLite shadow observation failed."]);
  startup.close();
  assert.equal(closeCalls, 1);
});

test("component-load failures disable the shadow and cannot leak loader details", async () => {
  const diagnostics = [];
  const startup = await prepareDeviceBuildShadowCompatibility({
    deviceBuildStore: { path: "/tmp/swift-sim/device-builds.json" },
    spawnSync() {},
    clock: {},
    reportError(message) {
      diagnostics.push(message);
      return Promise.reject(new Error("private reporter detail"));
    },
    async loadComponents() {
      throw new Error("private module resolution detail");
    },
  });

  assert.equal(startup.enabled, false);
  assert.equal(startup.shadowObserver, null);
  assert.equal(startup.importResult, null);
  assert.doesNotThrow(() => startup.close());
  await Promise.resolve();
  assert.deepEqual(diagnostics, [
    "Device-build SQLite shadow initialization failed; using JSON only.",
  ]);
});

test("path and concrete runtime failures remain inside the startup boundary", async () => {
  for (const mode of ["path", "runtime"]) {
    const diagnostics = [];
    let closeCalls = 0;
    const startup = await prepareDeviceBuildShadowCompatibility({
      deviceBuildStore: { path: "/tmp/swift-sim/device-builds.json" },
      spawnSync() {},
      clock: {},
      reportError(message) {
        diagnostics.push(message);
      },
      async loadComponents() {
        return {
          shadowPaths() {
            if (mode === "path") throw new Error("private path detail");
            return { databasePath: "/tmp/state.sqlite", backupDirectory: "/tmp/backups", source: {} };
          },
          createRuntime() {
            if (mode === "runtime") throw new Error("private sqlite detail");
            return {
              health: () => ({ ok: true }),
              importLegacy: () => ({ status: "checkpointed" }),
              shadowObserver: { observe() {} },
              close() {
                closeCalls += 1;
              },
            };
          },
          prepareStartup({ createRuntime, reportError }) {
            let runtime;
            try {
              runtime = createRuntime(null);
              return {
                enabled: true,
                shadowObserver: runtime.shadowObserver,
                importResult: runtime.importLegacy(),
                close: () => runtime.close(),
              };
            } catch {
              runtime?.close();
              reportError("Device-build SQLite shadow initialization failed; using JSON only.");
              return { enabled: false, shadowObserver: null, importResult: null, close() {} };
            }
          },
        };
      },
    });

    assert.equal(startup.enabled, false);
    assert.equal(closeCalls, 0);
    assert.deepEqual(diagnostics, [
      "Device-build SQLite shadow initialization failed; using JSON only.",
    ]);
  }
});

test("invalid compatibility dependencies fail before attempting module load", async () => {
  let loadCalls = 0;
  const loadComponents = async () => {
    loadCalls += 1;
    return {};
  };

  await assert.rejects(
    prepareDeviceBuildShadowCompatibility({
      deviceBuildStore: { path: "" },
      spawnSync: null,
      clock: {},
      loadComponents,
    }),
    /requires spawnSync/,
  );
  assert.equal(loadCalls, 0);
});

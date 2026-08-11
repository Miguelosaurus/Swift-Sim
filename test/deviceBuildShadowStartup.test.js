import assert from "node:assert/strict";
import test from "node:test";
import { prepareDeviceBuildShadowStartup } from "../mac-helper/src/persistence/deviceBuildShadowStartup.js";

test("device-build shadow startup enables only after health and import succeed", () => {
  const events = [];
  const observer = { observe() {} };
  let closeCalls = 0;
  const startup = prepareDeviceBuildShadowStartup({
    createRuntime(options) {
      events.push(["create", options]);
      return {
        health() {
          events.push(["health"]);
          return { ok: true };
        },
        importLegacy() {
          events.push(["import"]);
          return { status: "already-current" };
        },
        shadowObserver: observer,
        close() {
          closeCalls += 1;
        },
      };
    },
    runtimeOptions: { path: "sandbox.sqlite" },
  });

  assert.equal(startup.enabled, true);
  assert.strictEqual(startup.shadowObserver, observer);
  assert.deepEqual(startup.importResult, { status: "already-current" });
  assert.deepEqual(events, [
    ["create", { path: "sandbox.sqlite" }],
    ["health"],
    ["import"],
  ]);

  startup.close();
  startup.close();
  assert.equal(closeCalls, 1);
});

test("construction, health, and import failures disable the shadow and keep reporting generic", async () => {
  for (const mode of ["construct", "health", "import"]) {
    const diagnostics = [];
    let closeCalls = 0;
    const startup = prepareDeviceBuildShadowStartup({
      createRuntime() {
        if (mode === "construct") throw new Error("private construction detail");
        return {
          health() {
            return { ok: mode !== "health" };
          },
          importLegacy() {
            if (mode === "import") throw new Error("private import detail");
            return { status: "checkpointed" };
          },
          shadowObserver: { observe() {} },
          close() {
            closeCalls += 1;
            if (mode === "import") throw new Error("private close detail");
          },
        };
      },
      runtimeOptions: {},
      reportError(message) {
        diagnostics.push(message);
        return Promise.reject(new Error("private reporter detail"));
      },
    });

    assert.equal(startup.enabled, false);
    assert.equal(startup.shadowObserver, null);
    assert.equal(startup.importResult, null);
    startup.close();
    assert.equal(closeCalls, mode === "construct" ? 0 : 1);
    await Promise.resolve();
    assert.deepEqual(diagnostics, [
      "Device-build SQLite shadow initialization failed; using JSON only.",
    ]);
  }
});

test("malformed runtime and throwing reporter cannot make the optional shadow fatal", () => {
  const startup = prepareDeviceBuildShadowStartup({
    createRuntime() {
      return { health: () => ({ ok: true }) };
    },
    runtimeOptions: {},
    reportError() {
      throw new Error("private reporter detail");
    },
  });

  assert.deepEqual(
    {
      enabled: startup.enabled,
      shadowObserver: startup.shadowObserver,
      importResult: startup.importResult,
    },
    { enabled: false, shadowObserver: null, importResult: null },
  );
  assert.doesNotThrow(() => startup.close());
});

test("enabled resource close propagates once so lifecycle can choose nonzero exit", () => {
  let closeCalls = 0;
  const startup = prepareDeviceBuildShadowStartup({
    createRuntime() {
      return {
        health: () => ({ ok: true }),
        importLegacy: () => ({ status: "applied" }),
        shadowObserver: { observe() {} },
        close() {
          closeCalls += 1;
          throw new Error("close failed");
        },
      };
    },
    runtimeOptions: {},
  });

  assert.throws(() => startup.close(), /close failed/);
  assert.doesNotThrow(() => startup.close());
  assert.equal(closeCalls, 1);
});

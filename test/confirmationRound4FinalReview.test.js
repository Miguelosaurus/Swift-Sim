import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceInventoryAdapter } from "../mac-helper/src/deviceInventory.js";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import * as lifecycleBase from "../mac-helper/src/simulatorLifecycleBase.js";
import { startSimulatorRuntime } from "../mac-helper/src/simulatorLifecycle.js";
import { ServeSimTransport } from "../mac-helper/src/transports/serveSimTransport.js";

function stream(pid, port) {
  return {
    state: "running",
    transport: "serve-sim",
    quality: "fallback",
    localUrl: `http://127.0.0.1:${port}/stream`,
    previewUrl: `http://127.0.0.1:${port}/stream`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    port,
    pid,
    raw: {},
    limitations: [],
  };
}

async function withRuntimeRoots(directory, operation) {
  const runtimePrevious = process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
  const claimPrevious = process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
  process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = join(directory, "runtime");
  process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = join(directory, "claims");
  try {
    return await operation();
  } finally {
    if (runtimePrevious === undefined) delete process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = runtimePrevious;
    if (claimPrevious === undefined) delete process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = claimPrevious;
  }
}

test("a restart replacement remains busy when its private claim evidence disappears", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round4-lost-restart-claim-"));
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const simulatorUDID = "SIM-R4-LOST-RESTART-CLAIM";
      let starts = 0;
      const transport = new ServeSimTransport({
        adapter: {
          async start() {
            starts += 1;
            return stream(49100 + starts, 9610 + starts);
          },
          async kill() {},
        },
      });
      const store = new SessionStore({ path });
      const session = store.create({
        token: "restart-owner-token",
        project: "/tmp/RestartOwner.xcodeproj",
        scheme: "RestartOwner",
        simulatorUDID,
        transport: "serve-sim",
      });
      session.stream = await transport.start({ simulatorUDID });
      store.save(session);
      await transport.restart(session);

      rmSync(join(directory, "claims"), { recursive: true, force: true });
      const restartedStore = new SessionStore({ path });
      const reusable = restartedStore.findReusable({
        project: session.project,
        scheme: session.scheme,
        simulatorUDID,
        transport: "auto",
      });

      assert.equal(reusable, undefined);
      assert.equal(restartedStore.get(session.id).stream.state, "running");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("parseable but invalid session state cannot authorize orphan cleanup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round4-invalid-owner-"));
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const simulatorUDID = "SIM-R4-INVALID-OWNER";
      const original = await lifecycleBase.startSimulatorRuntime({
        simulatorUDID,
        operation: async () => stream(49201, 9621),
      });
      const store = new SessionStore({ path });
      store.create({
        token: "valid-before-corruption",
        project: "/tmp/InvalidOwner.xcodeproj",
        scheme: "InvalidOwner",
        simulatorUDID,
        transport: "serve-sim",
      });

      const state = JSON.parse(readFileSync(path, "utf8"));
      state.sessions[0].token = 42;
      writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
      let recoveries = 0;
      await assert.rejects(
        startSimulatorRuntime({
          simulatorUDID,
          recover: async () => { recoveries += 1; },
          operation: async () => stream(49202, 9622),
        }),
        (error) => error?.code === "SWIFT_SIM_SIMULATOR_RUNTIME_ACTIVE",
      );

      assert.equal(recoveries, 0);
      assert.equal(
        lifecycleBase.readSimulatorRuntimeState(simulatorUDID).nonce,
        original.raw.swiftSimLifecycleNonce,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("all connected devices share one physical-verification deadline", async () => {
  const devices = {
    result: {
      devices: Array.from({ length: 3 }, (_, index) => ({
        hardwareProperties: {
          platform: "iOS",
          reality: "physical",
          udid: `device-${index}`,
          marketingName: "iPhone",
        },
      })),
    },
  };
  let appCalls = 0;
  const adapter = new DeviceInventoryAdapter({
    verificationDeadlineMs: 120,
    run: async (args) => {
      if (args[0] === "list") return devices;
      appCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 70));
      return { result: { apps: [] } };
    },
  });

  const startedAt = Date.now();
  await assert.rejects(
    adapter.verifyApp("com.example.absolute-deadline"),
    (error) => error?.code === "SWIFT_SIM_DEVICE_VERIFICATION_TIMEOUT",
  );
  assert.ok(Date.now() - startedAt < 300);
  assert.ok(appCalls <= 2);
  assert.equal(adapter.verificationCache.size, 0);
});

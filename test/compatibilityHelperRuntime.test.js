import assert from "node:assert/strict";
import test from "node:test";
import { createCompatibilityHelperRuntime } from "../mac-helper/src/infrastructure/compatibilityHelperRuntime.js";

test("compatibility runtime constructs the state-root owner before dependent repositories", () => {
  const calls = [];
  const adapter = { id: "adapter" };
  const values = Object.fromEntries([
    "createSessionStore",
    "createDeviceBuildStore",
    "createDeviceDelivery",
    "createPairingStore",
    "createPairingInviteStore",
    "createSimulatorProfiles",
    "createDeviceInventory",
    "createIdGenerator",
    "createClock",
  ].map((name) => [name, { name }]));
  const factories = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, () => {
      calls.push(name);
      return value;
    }]),
  );
  factories.createServeSimAdapter = () => {
    calls.push("createServeSimAdapter");
    return adapter;
  };
  factories.createServeSimTransport = (input) => {
    calls.push("createServeSimTransport");
    assert.strictEqual(input.adapter, adapter);
    return { kind: "serve", adapter: input.adapter };
  };
  factories.createNativeCompanionTransport = (input) => {
    calls.push("createNativeCompanionTransport");
    assert.strictEqual(input.adapter, adapter);
    return { kind: "native", adapter: input.adapter };
  };

  const runtime = createCompatibilityHelperRuntime({ factories });

  assert.strictEqual(runtime.store, values.createSessionStore);
  assert.strictEqual(runtime.deviceBuildStore, values.createDeviceBuildStore);
  assert.strictEqual(runtime.deviceDelivery, values.createDeviceDelivery);
  assert.strictEqual(runtime.pairingStore, values.createPairingStore);
  assert.strictEqual(runtime.pairingInviteStore, values.createPairingInviteStore);
  assert.strictEqual(runtime.simulatorProfiles, values.createSimulatorProfiles);
  assert.strictEqual(runtime.deviceInventory, values.createDeviceInventory);
  assert.strictEqual(runtime.adapter, adapter);
  assert.strictEqual(runtime.idGenerator, values.createIdGenerator);
  assert.strictEqual(runtime.clock, values.createClock);
  assert.deepEqual(runtime.transports["serve-sim"], { kind: "serve", adapter });
  assert.deepEqual(runtime.transports["native-companion"], { kind: "native", adapter });
  assert.equal(runtime.activeDeviceBuildTasks.size, 0);
  assert.deepEqual(calls, [
    "createPairingStore",
    "createServeSimAdapter",
    "createIdGenerator",
    "createClock",
    "createSessionStore",
    "createDeviceBuildStore",
    "createDeviceDelivery",
    "createPairingInviteStore",
    "createSimulatorProfiles",
    "createDeviceInventory",
    "createServeSimTransport",
    "createNativeCompanionTransport",
  ]);
});

test("compatibility runtime owns fresh task state per composition", () => {
  const factory = () => ({});
  const factories = {
    createSessionStore: factory,
    createDeviceBuildStore: factory,
    createDeviceDelivery: factory,
    createPairingStore: factory,
    createPairingInviteStore: factory,
    createSimulatorProfiles: factory,
    createDeviceInventory: factory,
    createServeSimAdapter: factory,
    createServeSimTransport: factory,
    createNativeCompanionTransport: factory,
    createIdGenerator: factory,
    createClock: factory,
  };
  const first = createCompatibilityHelperRuntime({ factories });
  const second = createCompatibilityHelperRuntime({ factories });
  assert.notStrictEqual(first.activeDeviceBuildTasks, second.activeDeviceBuildTasks);
  assert.equal(first.activeDeviceBuildTasks.size, 0);
  assert.equal(second.activeDeviceBuildTasks.size, 0);
});

test("compatibility runtime fails closed when the state-root factory is absent", () => {
  assert.throws(
    () => createCompatibilityHelperRuntime({ factories: {} }),
    /requires createPairingStore/,
  );
});

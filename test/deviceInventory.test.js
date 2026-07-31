import test from "node:test";
import assert from "node:assert/strict";
import { DeviceInventoryAdapter, physicalIOSDevices } from "../mac-helper/src/deviceInventory.js";

const devicePayload = {
  result: {
    devices: [
      {
        identifier: "core-device-id",
        deviceProperties: { name: "Test iPhone" },
        hardwareProperties: { platform: "iOS", reality: "physical", udid: "private-udid" },
      },
      {
        deviceProperties: { name: "Simulator" },
        hardwareProperties: { platform: "iOS", reality: "simulated", udid: "sim-udid" },
      },
    ],
  },
};

test("physical device parsing excludes simulators", () => {
  assert.deepEqual(physicalIOSDevices(devicePayload), [
    { name: "Test iPhone", udid: "private-udid" },
  ]);
});

test("verification reports the installed version without returning the UDID", async () => {
  const adapter = new DeviceInventoryAdapter({
    run: async (args) => args[0] === "list"
      ? devicePayload
      : { result: { apps: [{ version: "1.2", bundleVersion: "7" }] } },
  });
  const result = await adapter.verifyApp("com.example.app", { version: "1.2", build: "7" });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.devices[0], {
    name: "Test iPhone",
    state: "installed",
    version: "1.2",
    build: "7",
  });
  assert.equal(JSON.stringify(result).includes("private-udid"), false);
});

test("verification does not confirm a different installed version", async () => {
  const adapter = new DeviceInventoryAdapter({
    run: async (args) => args[0] === "list"
      ? devicePayload
      : { result: { apps: [{ version: "1.1", bundleVersion: "6" }] } },
  });
  const result = await adapter.verifyApp("com.example.app", { version: "1.2", build: "7" });
  assert.equal(result.state, "different-version");
  assert.equal(result.devices[0].state, "different-version");
});

test("verification coalesces concurrent requests and caches briefly", async () => {
  let now = 1_000;
  let calls = 0;
  const adapter = new DeviceInventoryAdapter({
    now: () => now,
    verificationCacheMs: 5_000,
    run: async (args) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return args[0] === "list"
        ? devicePayload
        : { result: { apps: [{ version: "1.2", bundleVersion: "7" }] } };
    },
  });

  const [first, second] = await Promise.all([
    adapter.verifyApp("com.example.app", { version: "1.2", build: "7" }),
    adapter.verifyApp("com.example.app", { version: "1.2", build: "7" }),
  ]);
  assert.equal(first.state, "verified");
  assert.deepEqual(second, first);
  assert.equal(calls, 2);

  await adapter.verifyApp("com.example.app", { version: "1.2", build: "7" });
  assert.equal(calls, 2);

  now += 5_001;
  await adapter.verifyApp("com.example.app", { version: "1.2", build: "7" });
  assert.equal(calls, 4);
});

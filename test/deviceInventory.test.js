import test from "node:test";
import assert from "node:assert/strict";
import {
  DeviceInventoryAdapter,
  physicalIOSDevices,
  runCommandWithDeadline,
} from "../mac-helper/src/deviceInventory.js";

const devicePayload = {
  result: {
    devices: [
      {
        identifier: "core-device-id",
        deviceProperties: { name: "Miguel's Private iPhone" },
        hardwareProperties: {
          platform: "iOS",
          reality: "physical",
          udid: "private-udid",
          marketingName: "iPhone 16 Pro",
        },
      },
      {
        deviceProperties: { name: "Simulator" },
        hardwareProperties: { platform: "iOS", reality: "simulated", udid: "sim-udid" },
      },
    ],
  },
};

test("physical device parsing excludes simulators and private device names", () => {
  assert.deepEqual(physicalIOSDevices(devicePayload), [
    { name: "iPhone 16 Pro", udid: "private-udid" },
  ]);
  assert.equal(JSON.stringify(physicalIOSDevices(devicePayload)).includes("Miguel"), false);
});

test("verification reports the installed version without returning the UDID or personal name", async () => {
  const adapter = new DeviceInventoryAdapter({
    run: async (args) => args[0] === "list"
      ? devicePayload
      : { result: { apps: [{ version: "1.2", bundleVersion: "7" }] } },
  });
  const result = await adapter.verifyApp("com.example.app", { version: "1.2", build: "7" });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.devices[0], {
    name: "iPhone 16 Pro",
    state: "installed",
    version: "1.2",
    build: "7",
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private-udid"), false);
  assert.equal(serialized.includes("Miguel"), false);
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

test("identical in-flight verification is coalesced", async () => {
  let resolveInventory;
  let calls = 0;
  const inventoryPromise = new Promise((resolve) => { resolveInventory = resolve; });
  const adapter = new DeviceInventoryAdapter({
    run: async (args) => {
      calls += 1;
      if (args[0] === "list") return inventoryPromise;
      return { result: { apps: [] } };
    },
  });
  const first = adapter.verifyApp("com.example.app");
  const second = adapter.verifyApp("com.example.app");
  assert.equal(calls, 1);
  resolveInventory({ result: { devices: [] } });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("verification cache never evicts in-flight work under unique-key saturation", async () => {
  const resolvers = [];
  let listCalls = 0;
  const adapter = new DeviceInventoryAdapter({
    run: async (args) => {
      if (args[0] !== "list") return { result: { apps: [] } };
      listCalls += 1;
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });

  const pending = Array.from({ length: 64 }, (_, index) =>
    adapter.verifyApp(`com.example.app${index}`)
  );
  await assert.rejects(
    adapter.verifyApp("com.example.overflow"),
    /verification is busy/i
  );
  const duplicate = adapter.verifyApp("com.example.app0");
  assert.equal(listCalls, 64);
  for (const resolve of resolvers) resolve({ result: { devices: [] } });
  await Promise.all([...pending, duplicate]);
  assert.equal(listCalls, 64);
});

test("failed verification is not cached", async () => {
  let calls = 0;
  const adapter = new DeviceInventoryAdapter({
    run: async () => {
      calls += 1;
      throw new Error("inventory failed");
    },
  });
  await assert.rejects(adapter.verifyApp("com.example.failure"), /inventory failed/);
  await assert.rejects(adapter.verifyApp("com.example.failure"), /inventory failed/);
  assert.equal(calls, 2);
});

test("verification cache evicts settled entries before rejecting new work", async () => {
  let calls = 0;
  const adapter = new DeviceInventoryAdapter({
    run: async () => {
      calls += 1;
      return { result: { devices: [] } };
    },
  });
  for (let index = 0; index < 65; index += 1) {
    await adapter.verifyApp(`com.example.settled${index}`);
  }
  assert.equal(calls, 65);
  assert.equal(adapter.verificationCache.size, 64);
});

test("verification caches successful results only for the configured window", async () => {
  let now = 1_000;
  let calls = 0;
  const adapter = new DeviceInventoryAdapter({
    now: () => now,
    verificationCacheMs: 5_000,
    run: async (args) => {
      calls += 1;
      return args[0] === "list"
        ? devicePayload
        : { result: { apps: [{ version: "1.2", bundleVersion: "7" }] } };
    },
  });

  await adapter.verifyApp("com.example.cached", { version: "1.2", build: "7" });
  await adapter.verifyApp("com.example.cached", { version: "1.2", build: "7" });
  assert.equal(calls, 2);

  now += 5_001;
  await adapter.verifyApp("com.example.cached", { version: "1.2", build: "7" });
  assert.equal(calls, 4);
});

test("device command deadline settles even when the child ignores SIGTERM", async () => {
  const startedAt = Date.now();
  const result = await runCommandWithDeadline(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
  ], {
    timeoutMs: 75,
    forceKillDelayMs: 50,
  });
  assert.equal(result.code, null);
  assert.equal(result.timedOut, true);
  assert.match(result.stderr, /exceeded its 75ms deadline/);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("device command deadline settles as soon as SIGTERM closes the child", async () => {
  const startedAt = Date.now();
  const result = await runCommandWithDeadline(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)",
  ], {
    timeoutMs: 75,
    forceKillDelayMs: 2_000,
  });
  assert.equal(result.code, null);
  assert.equal(result.timedOut, true);
  assert.match(result.stderr, /exceeded its 75ms deadline/);
  assert.ok(Date.now() - startedAt < 1_500);
});

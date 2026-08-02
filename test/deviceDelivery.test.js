import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeviceDeliveryAdapter,
  deliveryGenerationLogPath,
  deliveryGenerationStatePath,
  deviceDeliveryRequestAllowed,
  parseQuickTunnelUrl,
} from "../mac-helper/src/deviceDelivery.js";

test("quick tunnel URL parser ignores terminal formatting", () => {
  const output = "\u001b[32mINF\u001b[0m Visit https://quiet-river-example.trycloudflare.com now";
  assert.equal(
    parseQuickTunnelUrl(output),
    "https://quiet-river-example.trycloudflare.com"
  );
});

test("public delivery gateway exposes only token-scoped install routes", () => {
  assert.equal(deviceDeliveryRequestAllowed("GET", "/health"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/d/build-123"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/logs"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/links"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/artifact/manifest"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/artifact/ipa"), true);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123/install-request"), true);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123/verify"), true);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/apps/app-123/build-current-source"), false);

  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123/renew"), false);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/sessions/session-123"), false);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/pairing/status"), false);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/pairing/claim"), false);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds"), false);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123"), false);
  assert.equal(deviceDeliveryRequestAllowed("DELETE", "/api/apps/app-123"), false);
});

test("delivery uses the isolated bearer-only gateway entrypoint", () => {
  const adapter = new DeviceDeliveryAdapter();
  assert.match(adapter.helperPath, /swift-sim-device-gateway\.js$/);
});

test("delivery generations keep independent state files", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-delivery-test-"));
  try {
    const statePath = join(directory, "device-delivery.json");
    const firstPath = deliveryGenerationStatePath(statePath, "generation-one");
    const secondPath = deliveryGenerationStatePath(statePath, "generation-two");
    assert.notEqual(firstPath, secondPath);

    writeFileSync(firstPath, JSON.stringify({
      generation: "generation-one",
      status: "ready",
      publicBaseUrl: "https://first.trycloudflare.com",
      createdAt: "2026-07-29T10:00:00.000Z",
      expiresAt: "2026-07-29T12:00:00.000Z",
    }));
    writeFileSync(secondPath, JSON.stringify({
      generation: "generation-two",
      status: "ready",
      publicBaseUrl: "https://second.trycloudflare.com",
      createdAt: "2026-07-29T10:05:00.000Z",
      expiresAt: "2026-07-29T12:05:00.000Z",
    }));

    const adapter = new DeviceDeliveryAdapter({
      statePath,
      logPath: join(directory, "device-delivery.log"),
    });
    assert.equal(adapter.statuses().length, 2);
    assert.equal(adapter.status().generation, "generation-two");
    assert.equal(adapter.status().activeGenerations, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stop preserves an ownership record for an alive unverified process", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-delivery-stop-test-"));
  try {
    const statePath = join(directory, "device-delivery.json");
    const generationPath = deliveryGenerationStatePath(statePath, "generation-live");
    writeFileSync(generationPath, JSON.stringify({
      generation: "generation-live",
      status: "ready",
      publicBaseUrl: "https://live.trycloudflare.com",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      managerIdentity: {
        pid: process.pid,
        startedAt: "Mon Jan  1 00:00:00 1990",
        commandFragments: ["definitely-not-this-process"],
      },
    }));
    const adapter = new DeviceDeliveryAdapter({
      statePath,
      logPath: join(directory, "device-delivery.log"),
    });
    assert.equal(adapter.stop(), false);
    assert.equal(existsSync(generationPath), true);
    const preserved = JSON.parse(readFileSync(generationPath, "utf8"));
    assert.equal(preserved.status, "failed-shutdown");
    assert.equal(preserved.survivingProcesses[0].pid, process.pid);
    assert.equal(preserved.survivingProcesses[0].ownershipVerified, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reaping a confirmed-dead generation removes its state and log", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-delivery-reap-test-"));
  try {
    const statePath = join(directory, "device-delivery.json");
    const logPath = join(directory, "device-delivery.log");
    const generation = "generation-expired";
    const generationPath = deliveryGenerationStatePath(statePath, generation);
    const generationLog = deliveryGenerationLogPath(logPath, generation);
    writeFileSync(generationPath, JSON.stringify({
      generation,
      status: "expired",
      publicBaseUrl: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T01:00:00.000Z",
    }));
    writeFileSync(generationLog, "old tunnel output");
    const adapter = new DeviceDeliveryAdapter({ statePath, logPath });
    adapter.reapExpiredGenerations();
    assert.equal(existsSync(generationPath), false);
    assert.equal(existsSync(generationLog), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("legacy delivery pids remain recorded instead of being treated as exited", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-delivery-legacy-test-"));
  try {
    const statePath = join(directory, "device-delivery.json");
    writeFileSync(statePath, JSON.stringify({
      generation: "legacy-generation",
      status: "ready",
      publicBaseUrl: "https://legacy.trycloudflare.com",
      managerPid: process.pid,
      gatewayPid: 0,
      tunnelPid: 0,
    }));
    const adapter = new DeviceDeliveryAdapter({ statePath, logPath: join(directory, "delivery.log") });
    assert.equal(adapter.stop(), false);
    const preserved = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(preserved.status, "failed-shutdown");
    assert.equal(preserved.survivingProcesses[0].pid, process.pid);
    assert.equal(preserved.survivingProcesses[0].legacy, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("build capability expiry never inherits the full reusable tunnel lifetime", async () => {
  const { buildCapabilityExpiresAt } = await import("../mac-helper/src/deviceDelivery.js");
  const now = Date.parse("2026-07-29T20:00:00.000Z");
  assert.equal(
    buildCapabilityExpiresAt({
      ttlMinutes: 5,
      deliveryExpiresAt: "2026-07-29T22:00:00.000Z",
      now,
    }),
    "2026-07-29T20:05:00.000Z"
  );
  assert.equal(
    buildCapabilityExpiresAt({
      ttlMinutes: 120,
      deliveryExpiresAt: "2026-07-29T20:20:00.000Z",
      now,
    }),
    "2026-07-29T20:20:00.000Z"
  );
});

test("delivery cancellation is honored before a generation is launched", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-delivery-cancel-test-"));
  try {
    const cancelPath = join(directory, "cancelled");
    writeFileSync(cancelPath, "cancelled");
    const adapter = new DeviceDeliveryAdapter({
      statePath: join(directory, "delivery.json"),
      logPath: join(directory, "delivery.log"),
      managerPath: join(directory, "missing-manager.js"),
    });
    await assert.rejects(
      adapter.ensure({ ttlMinutes: 5, cancelPath }),
      (error) => error?.code === "SWIFT_SIM_BUILD_CANCELLED"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an old PID-only delivery lock is reclaimed after its migration grace", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-delivery-lock-test-"));
  try {
    const statePath = join(directory, "delivery.json");
    const lockPath = `${statePath}.lifecycle.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
      pid: process.pid,
      nonce: "legacy",
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const adapter = new DeviceDeliveryAdapter({ statePath, logPath: join(directory, "delivery.log") });
    assert.equal(adapter.stop(), false);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("releasing one reference cannot stop a generation still used by another capability", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-delivery-reference-test-"));
  try {
    const statePath = join(directory, "device-delivery.json");
    const generation = "shared-generation";
    const generationPath = deliveryGenerationStatePath(statePath, generation);
    writeFileSync(generationPath, JSON.stringify({
      generation,
      status: "ready",
      publicBaseUrl: "https://shared.trycloudflare.com",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      references: ["build:first", "build:second"],
    }));
    const adapter = new DeviceDeliveryAdapter({ statePath, logPath: join(directory, "delivery.log") });
    assert.equal(adapter.stopGeneration(generation, { referenceID: "build:first" }), true);
    const preserved = JSON.parse(readFileSync(generationPath, "utf8"));
    assert.deepEqual(preserved.references, ["build:second"]);
    assert.equal(existsSync(generationPath), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

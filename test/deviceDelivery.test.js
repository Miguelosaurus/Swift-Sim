import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeviceDeliveryAdapter,
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
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/links"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/artifact/manifest"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/artifact/ipa"), true);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123/install-request"), true);

  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/logs"), false);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123/verify"), false);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123/renew"), false);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/sessions/session-123"), false);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/pairing/status"), false);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds"), false);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123"), false);
  assert.equal(deviceDeliveryRequestAllowed("DELETE", "/api/apps/app-123"), false);
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

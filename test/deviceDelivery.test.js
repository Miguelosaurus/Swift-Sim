import test from "node:test";
import assert from "node:assert/strict";
import {
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

test("public delivery gateway exposes only token-scoped device build routes", () => {
  assert.equal(deviceDeliveryRequestAllowed("GET", "/health"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/d/build-123"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/logs"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/artifact/manifest"), true);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds/build-123/artifact/ipa"), true);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123/install-request"), true);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123/verify"), true);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123/renew"), false);

  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/sessions/session-123"), false);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/pairing/status"), false);
  assert.equal(deviceDeliveryRequestAllowed("GET", "/api/device-builds"), false);
  assert.equal(deviceDeliveryRequestAllowed("POST", "/api/device-builds/build-123"), false);
  assert.equal(deviceDeliveryRequestAllowed("DELETE", "/api/apps/app-123"), false);
});

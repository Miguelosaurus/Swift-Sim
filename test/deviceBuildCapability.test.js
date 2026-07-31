import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_CAPABILITY_LIFETIME_MS,
  FAILED_CAPABILITY_GRACE_MS,
  capabilityForTokens,
  deviceBuildCapabilityExpired,
  publicCapabilityDeviceBuild,
} from "../mac-helper/src/deviceBuildCapability.js";

const now = Date.parse("2026-07-31T12:00:00.000Z");

function build(overrides = {}) {
  return {
    id: "build-1",
    token: "current-token",
    createdAt: new Date(now - 60_000).toISOString(),
    updatedAt: new Date(now - 30_000).toISOString(),
    expiresAt: "",
    state: "queued",
    configuration: "Debug",
    app: {
      identity: "opaque-app-id",
      name: "Private App",
      bundleIdentifier: "com.example.private",
      version: "1.2",
      build: "34",
      teamID: "SECRETTEAM",
    },
    signing: { method: "development", deviceInstallable: true, updateSafe: "same-bundle-update", warnings: [] },
    delivery: {
      mode: "quick-tunnel",
      provider: "cloudflare-quick-tunnel",
      expiresAt: "",
      generation: "private-generation",
      referenceID: "build:private",
    },
    preserveData: true,
    installation: {
      state: "verified",
      requestedAt: "2026-07-31T11:50:00.000Z",
      verifiedAt: "2026-07-31T11:51:00.000Z",
      devices: [{ name: "iPhone 17 Pro", state: "installed", version: "1.2", build: "34" }],
    },
    liveReload: { eligible: true, engineReady: false, compilerReady: false, error: "/Users/miguel/private/path" },
    remoteBaseUrl: "https://build.example",
    installTTLMinutes: 120,
    capabilities: [],
    ...overrides,
  };
}

test("active root capabilities have a bounded pre-delivery lifetime", () => {
  const fresh = build();
  assert.equal(deviceBuildCapabilityExpired(fresh, fresh, now), false);
  const stale = build({ createdAt: new Date(now - ACTIVE_CAPABILITY_LIFETIME_MS - 1).toISOString() });
  assert.equal(deviceBuildCapabilityExpired(stale, stale, now), true);
});

test("failed root capabilities expire after a short diagnostic grace period", () => {
  const fresh = build({ state: "failed", updatedAt: new Date(now - FAILED_CAPABILITY_GRACE_MS + 1).toISOString() });
  assert.equal(deviceBuildCapabilityExpired(fresh, fresh, now), false);
  const stale = build({ state: "failed", updatedAt: new Date(now - FAILED_CAPABILITY_GRACE_MS - 1).toISOString() });
  assert.equal(deviceBuildCapabilityExpired(stale, stale, now), true);
});

test("terminal and historical capabilities fail closed without a valid explicit expiry", () => {
  const ready = build({ state: "ready" });
  assert.equal(deviceBuildCapabilityExpired(ready, ready, now), true);
  const historical = { token: "old-token", expiresAt: "" };
  assert.equal(deviceBuildCapabilityExpired(ready, historical, now), true);
});

test("capability lookup accepts either bearer or query candidates without precedence bugs", () => {
  const value = build({ capabilities: [{ token: "old-token", expiresAt: new Date(now + 60_000).toISOString() }] });
  assert.equal(capabilityForTokens(value, ["invalid", "old-token"]).token, "old-token");
});

test("bearer projection removes device, developer-team, lifecycle, and raw error details", () => {
  const value = build();
  const projected = publicCapabilityDeviceBuild(value, value);
  assert.equal(projected.app.identity, "opaque-app-id");
  assert.equal(projected.app.teamID, "");
  assert.deepEqual(projected.installation.devices, []);
  assert.equal(projected.delivery.generation, undefined);
  assert.equal(projected.delivery.referenceID, undefined);
  assert.equal(projected.liveReload.error, "Live patch preparation was unavailable.");
  assert.doesNotMatch(JSON.stringify(projected), /SECRETTEAM|private-generation|iPhone 17 Pro|\/Users\/miguel/);
  assert.ok(Date.parse(projected.expiresAt) > now);
});

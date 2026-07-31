import test from "node:test";
import assert from "node:assert/strict";
import { handlePublicDeviceBuildCapability } from "../mac-helper/src/deviceBuildCapabilityBoundaryPreload.js";
import { FAILED_CAPABILITY_GRACE_MS } from "../mac-helper/src/deviceBuildCapability.js";

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body += body; },
    destroy() {},
  };
}

function readyBuild(overrides = {}) {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return {
    id: "build-1",
    token: "cap-token",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt,
    state: "ready",
    configuration: "Release",
    app: { identity: "app-id", name: "App", bundleIdentifier: "com.example", version: "1", build: "2", teamID: "TEAM" },
    signing: { method: "development", deviceInstallable: true, updateSafe: "same-bundle-update", warnings: [] },
    delivery: { mode: "custom", provider: "user-configured", expiresAt, generation: "secret" },
    preserveData: true,
    installation: { state: "unknown", requestedAt: "", verifiedAt: "", devices: [] },
    liveReload: {},
    remoteBaseUrl: "https://example.test",
    installTTLMinutes: 120,
    artifacts: { ipaPath: "/tmp/App.ipa" },
    logs: ["Build is ready to install."],
    capabilities: [],
    ...overrides,
  };
}

function dependencies(build, { claim = () => false, verify = async () => ({ state: "verified", devices: [] }) } = {}) {
  let current = structuredClone(build);
  return {
    pairingStore: { tokenMatches: (token) => token === "pair-token" },
    deviceBuildStore: {
      get: (id) => id === current.id ? structuredClone(current) : null,
      markInstallRequested: () => structuredClone(current),
      saveVerification: (_id, verification) => {
        current.installation = { ...current.installation, ...verification };
        return structuredClone(current);
      },
    },
    deviceInventory: { verifyApp: verify },
    claimVerification: claim,
  };
}

test("expired failed root capability is rejected instead of remaining valid forever", async () => {
  const now = Date.now();
  const build = readyBuild({
    state: "failed",
    expiresAt: "",
    updatedAt: new Date(now - FAILED_CAPABILITY_GRACE_MS - 1).toISOString(),
    artifacts: { ipaPath: "" },
  });
  const response = responseRecorder();
  assert.equal(await handlePublicDeviceBuildCapability({
    method: "GET",
    url: "/api/device-builds/build-1?token=cap-token",
    headers: { host: "example.test" },
  }, response, { ...dependencies(build), now }), true);
  assert.equal(response.status, 410);
});

test("unknown build IDs do not reveal existence to unauthenticated capability callers", async () => {
  const response = responseRecorder();
  const deps = dependencies(readyBuild());
  deps.deviceBuildStore.get = () => null;
  assert.equal(await handlePublicDeviceBuildCapability({
    method: "GET",
    url: "/api/device-builds/unknown?token=wrong",
    headers: { host: "example.test" },
  }, response, deps), true);
  assert.equal(response.status, 401);
});

test("public status is redacted while paired-Mac authorization falls through", async () => {
  const build = readyBuild({ installation: { state: "verified", devices: [{ name: "iPhone 17 Pro" }] } });
  const publicResponse = responseRecorder();
  assert.equal(await handlePublicDeviceBuildCapability({
    method: "GET",
    url: "/api/device-builds/build-1?token=cap-token",
    headers: { host: "example.test" },
  }, publicResponse, dependencies(build)), true);
  assert.equal(publicResponse.status, 200);
  assert.doesNotMatch(publicResponse.body, /TEAM|iPhone 17 Pro|secret/);

  const pairedResponse = responseRecorder();
  assert.equal(await handlePublicDeviceBuildCapability({
    method: "GET",
    url: "/api/device-builds/build-1?token=pair-token",
    headers: { host: "example.test" },
  }, pairedResponse, dependencies(build)), false);
  assert.equal(pairedResponse.status, 0);
});

test("verification is ready-only and obeys the persisted cadence", async () => {
  let calls = 0;
  const build = readyBuild();
  const blocked = responseRecorder();
  assert.equal(await handlePublicDeviceBuildCapability({
    method: "POST",
    url: "/api/device-builds/build-1/verify?token=cap-token",
    headers: { host: "example.test" },
  }, blocked, dependencies(build, {
    claim: () => false,
    verify: async () => { calls += 1; return { state: "verified", devices: [] }; },
  })), true);
  assert.equal(blocked.status, 200);
  assert.equal(calls, 0);

  const allowed = responseRecorder();
  assert.equal(await handlePublicDeviceBuildCapability({
    method: "POST",
    url: "/api/device-builds/build-1/verify?token=cap-token",
    headers: { host: "example.test" },
  }, allowed, dependencies(build, {
    claim: () => true,
    verify: async () => { calls += 1; return { state: "verified", verifiedAt: new Date().toISOString(), devices: [] }; },
  })), true);
  assert.equal(allowed.status, 200);
  assert.equal(calls, 1);

  const failed = responseRecorder();
  assert.equal(await handlePublicDeviceBuildCapability({
    method: "POST",
    url: "/api/device-builds/build-1/verify?token=cap-token",
    headers: { host: "example.test" },
  }, failed, dependencies(readyBuild({ state: "failed", expiresAt: new Date(Date.now() + 60_000).toISOString() }))), true);
  assert.equal(failed.status, 409);
});

test("validated bearer replaces a stale query token before artifact dispatch", async () => {
  const build = readyBuild();
  const request = {
    method: "GET",
    url: "/api/device-builds/build-1/artifact/ipa?token=stale",
    headers: { host: "example.test", authorization: "Bearer cap-token" },
  };
  const response = responseRecorder();
  assert.equal(await handlePublicDeviceBuildCapability(
    request, response, dependencies(build)
  ), false);
  assert.match(request.url, /token=cap-token/);
  assert.doesNotMatch(request.url, /token=stale/);
  assert.equal(response.swiftSimPublicCapability, true);
});

test("paired-Mac query authorization replaces an unrelated bearer for downstream routes", async () => {
  const build = readyBuild();
  const request = {
    method: "GET",
    url: "/api/device-builds/build-1/logs?token=pair-token",
    headers: { host: "example.test", authorization: "Bearer unrelated" },
  };
  const response = responseRecorder();
  assert.equal(await handlePublicDeviceBuildCapability(
    request, response, dependencies(build)
  ), false);
  assert.equal(request.headers.authorization, "Bearer pair-token");
  assert.match(request.url, /token=pair-token/);
});

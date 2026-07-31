import test from "node:test";
import assert from "node:assert/strict";
import {
  drainDeliveryReferenceCleanupJobsOnce,
  handlePairingFallback,
  handlePublicBuildExpiry,
  handlePublicBuildLogs,
  reconcileDeliveryReferencesOnce,
} from "../mac-helper/src/helperHttpBoundaryPreload.js";

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body += body; },
  };
}

const pairing = {
  token: "pair-token",
  installationID: "stable-helper-id",
  macName: "Test Mac",
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
};
const store = {
  tokenMatches: (token) => token === pairing.token,
  current: () => pairing,
};

test("pairing fallback rejects arbitrary query tokens", () => {
  const response = responseRecorder();
  assert.equal(handlePairingFallback({
    method: "GET",
    url: "/pair?token=attacker",
    headers: { host: "mac.example.test" },
  }, response, store), true);
  assert.equal(response.status, 401);
});

test("pairing fallback preserves helper identity and proxy-authorized HTTPS origin", () => {
  const response = responseRecorder();
  assert.equal(handlePairingFallback({
    method: "GET",
    url: "/pair?token=pair-token&macID=ignored-input&base=https%3A%2F%2Fmac.example.test",
    headers: {
      host: "127.0.0.1:47217",
      "x-forwarded-host": "mac.example.test",
      "x-forwarded-proto": "https",
    },
    socket: { remoteAddress: "127.0.0.1" },
  }, response, store), true);
  assert.equal(response.status, 200);
  assert.match(response.body, /macID=stable-helper-id/);
  assert.match(response.body, /base=https%3A%2F%2Fmac\.example\.test/);
  assert.doesNotMatch(response.body, /ignored-input/);
  assert.equal(response.headers["referrer-policy"], "no-referrer");
});

test("pairing fallback rejects a base origin on another host", () => {
  const response = responseRecorder();
  assert.equal(handlePairingFallback({
    method: "GET",
    url: "/pair?token=pair-token&base=https%3A%2F%2Fevil.example",
    headers: { host: "mac.example.test" },
  }, response, store), true);
  assert.equal(response.status, 200);
  assert.match(response.body, /base=http%3A%2F%2Fmac\.example\.test/);
  assert.doesNotMatch(response.body, /evil\.example/);
});

test("legacy pairing links honor a trusted forwarded HTTPS protocol", () => {
  const response = responseRecorder();
  assert.equal(handlePairingFallback({
    method: "GET",
    url: "/pair?token=pair-token",
    headers: {
      host: "mac.example.test",
      "x-forwarded-proto": "https",
    },
    socket: { remoteAddress: "::1" },
  }, response, store), true);
  assert.match(response.body, /base=https%3A%2F%2Fmac\.example\.test/);
});

test("pairing fallback ignores forwarded origin headers from a remote peer", () => {
  const response = responseRecorder();
  assert.equal(handlePairingFallback({
    method: "GET",
    url: "/pair?token=pair-token&base=https%3A%2F%2Fevil.example",
    headers: {
      host: "mac.example.test",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    },
    socket: { remoteAddress: "100.64.0.10" },
  }, response, store), true);
  assert.match(response.body, /base=http%3A%2F%2Fmac\.example\.test/);
  assert.doesNotMatch(response.body, /evil\.example/);
});

test("ready public capabilities with missing expiry fail closed", () => {
  const ready = { id: "ready", token: "ready-token", state: "ready", expiresAt: "" };
  const queued = { id: "queued", token: "queued-token", state: "queued", expiresAt: "" };
  const builds = { get: (id) => id === ready.id ? ready : id === queued.id ? queued : null };
  const pairings = { tokenMatches: () => false };

  const expired = responseRecorder();
  assert.equal(handlePublicBuildExpiry({
    method: "GET",
    url: "/api/device-builds/ready?token=ready-token",
    headers: { host: "mac.example.test" },
  }, expired, { pairingStore: pairings, deviceBuildStore: builds }), true);
  assert.equal(expired.status, 410);

  const active = responseRecorder();
  assert.equal(handlePublicBuildExpiry({
    method: "GET",
    url: "/api/device-builds/queued?token=queued-token",
    headers: { host: "mac.example.test" },
  }, active, { pairingStore: pairings, deviceBuildStore: builds }), false);
  assert.equal(active.status, 0);
});

test("public capability logs are allowlisted while paired-Mac logs pass through", () => {
  const build = {
    id: "build-1",
    token: "capability-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    logs: ["API_KEY=secret", "Build is ready to install."],
  };
  const builds = { get: (id) => id === build.id ? build : null };
  const pairings = { tokenMatches: (token) => token === "paired-token" };

  const publicResponse = responseRecorder();
  assert.equal(handlePublicBuildLogs({
    method: "GET",
    url: "/api/device-builds/build-1/logs?token=capability-token",
    headers: { host: "mac.example.test" },
  }, publicResponse, { pairingStore: pairings, deviceBuildStore: builds }), true);
  assert.equal(publicResponse.status, 200);
  assert.match(publicResponse.body, /build output redacted/);
  assert.doesNotMatch(publicResponse.body, /API_KEY|secret/);

  const pairedResponse = responseRecorder();
  assert.equal(handlePublicBuildLogs({
    method: "GET",
    url: "/api/device-builds/build-1/logs?token=paired-token",
    headers: { host: "mac.example.test" },
  }, pairedResponse, { pairingStore: pairings, deviceBuildStore: builds }), false);
});

test("delivery reference cleanup retries due jobs and skips future jobs", async () => {
  const completed = [];
  const failed = [];
  const builds = {
    listDeliveryReferenceCleanupJobs: () => [
      { id: "due-ok", generation: "g1", referenceID: "r1", nextAttemptAt: "2026-07-31T00:00:00.000Z" },
      { id: "due-fail", generation: "g2", referenceID: "r2", nextAttemptAt: "2026-07-31T00:00:00.000Z" },
      { id: "future", generation: "g3", referenceID: "r3", nextAttemptAt: "2026-08-01T00:00:00.000Z" },
    ],
    completeDeliveryReferenceCleanupJob: (id) => completed.push(id),
    failDeliveryReferenceCleanupJob: (id, error) => failed.push([id, error.message]),
  };
  const delivery = {
    stopGeneration: (generation) => generation === "g1",
  };
  await drainDeliveryReferenceCleanupJobsOnce({
    deviceBuildStore: builds,
    deviceDelivery: delivery,
    now: Date.parse("2026-07-31T01:00:00.000Z"),
  });
  assert.deepEqual(completed, ["due-ok"]);
  assert.equal(failed.length, 1);
  assert.equal(failed[0][0], "due-fail");
});

test("orphan delivery references are released without touching live capabilities", async () => {
  const now = Date.parse("2026-07-31T01:00:00.000Z");
  const stopped = [];
  const builds = {
    list: () => [
      {
        id: "active",
        state: "delivering",
        expiresAt: "",
        delivery: null,
        capabilities: [],
      },
      {
        id: "saved",
        state: "ready",
        expiresAt: "2026-07-31T02:00:00.000Z",
        delivery: { referenceID: "build:saved" },
        pendingRenewal: { id: "pending-live" },
        capabilities: [
          {
            expiresAt: "2026-07-31T02:00:00.000Z",
            delivery: { referenceID: "build:historical" },
          },
        ],
      },
    ],
  };
  const delivery = {
    statuses: () => [{
      generation: "generation-1",
      references: [
        "build:active",
        "build:saved",
        "build:historical",
        "renewal:pending-live",
        "renewal:orphan",
        "build:expired",
        "external:leave-alone",
      ],
    }],
    stopGeneration: (generation, { referenceID }) => {
      stopped.push([generation, referenceID]);
      return true;
    },
  };
  await reconcileDeliveryReferencesOnce({ deviceBuildStore: builds, deviceDelivery: delivery, now });
  assert.deepEqual(stopped, [
    ["generation-1", "renewal:orphan"],
    ["generation-1", "build:expired"],
  ]);
});

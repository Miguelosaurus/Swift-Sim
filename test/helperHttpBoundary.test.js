import test from "node:test";
import assert from "node:assert/strict";
import {
  drainDeliveryReferenceCleanupJobsOnce,
  handlePairingFallback,
  handlePublicBuildLogs,
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

test("pairing fallback preserves helper identity and explicit HTTPS origin", () => {
  const response = responseRecorder();
  assert.equal(handlePairingFallback({
    method: "GET",
    url: "/pair?token=pair-token&macID=ignored-input&base=https%3A%2F%2Fmac.example.test",
    headers: { host: "127.0.0.1:47217" },
  }, response, store), true);
  assert.equal(response.status, 200);
  assert.match(response.body, /macID=stable-helper-id/);
  assert.match(response.body, /base=https%3A%2F%2Fmac\.example\.test/);
  assert.doesNotMatch(response.body, /ignored-input/);
  assert.equal(response.headers["referrer-policy"], "no-referrer");
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
  }, response, store), true);
  assert.match(response.body, /base=https%3A%2F%2Fmac\.example\.test/);
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

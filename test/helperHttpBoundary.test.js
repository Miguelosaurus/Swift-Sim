import test from "node:test";
import assert from "node:assert/strict";
import { handlePairingFallback, handlePublicBuildLogs } from "../mac-helper/src/helperHttpBoundaryPreload.js";

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

test("pairing fallback preserves stable helper identity in the custom scheme", () => {
  const response = responseRecorder();
  assert.equal(handlePairingFallback({
    method: "GET",
    url: "/pair?token=pair-token&macID=ignored-input",
    headers: { host: "mac.example.test" },
  }, response, store), true);
  assert.equal(response.status, 200);
  assert.match(response.body, /macID=stable-helper-id/);
  assert.doesNotMatch(response.body, /ignored-input/);
  assert.equal(response.headers["referrer-policy"], "no-referrer");
});

test("public capability logs are sanitized while paired-Mac logs pass through", () => {
  const build = {
    id: "build-1",
    token: "capability-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    logs: ["CompileSwift /Users/Miguel/Secret Project/App.swift", "Build is ready."],
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
  assert.match(publicResponse.body, /local build detail redacted/);
  assert.doesNotMatch(publicResponse.body, /Secret Project/);

  const pairedResponse = responseRecorder();
  assert.equal(handlePublicBuildLogs({
    method: "GET",
    url: "/api/device-builds/build-1/logs?token=paired-token",
    headers: { host: "mac.example.test" },
  }, pairedResponse, { pairingStore: pairings, deviceBuildStore: builds }), false);
});

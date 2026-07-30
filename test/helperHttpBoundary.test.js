import test from "node:test";
import assert from "node:assert/strict";
import { handlePairingFallback } from "../mac-helper/src/helperHttpBoundaryPreload.js";

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

import assert from "node:assert/strict";
import test from "node:test";
import {
  handlePairingFallback,
  handlePublicBuildLogs,
} from "../mac-helper/src/helperHttpBoundaryPreload.js";

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body += body;
    },
  };
}

test("pairing fallback does not broaden query-token authorization to bearer credentials", () => {
  const response = responseRecorder();
  const pairing = {
    token: "pair-token",
    installationID: "installation",
    macName: "Test Mac",
  };
  const store = {
    current: () => pairing,
    tokenMatches: (token) => token === pairing.token,
  };

  assert.equal(
    handlePairingFallback(
      {
        method: "GET",
        url: "/pair",
        headers: {
          host: "mac.example.test",
          authorization: "Bearer pair-token",
        },
      },
      response,
      store,
    ),
    true,
  );
  assert.equal(response.status, 401);
});

test("public build capability authorization preserves bearer precedence over query tokens", () => {
  const response = responseRecorder();
  const build = {
    id: "build-1",
    token: "capability-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    logs: ["Build is ready to install."],
  };
  const builds = {
    get: (id) => (id === build.id ? build : null),
  };
  const pairings = {
    tokenMatches: (token) => token === "paired-token",
  };

  assert.equal(
    handlePublicBuildLogs(
      {
        method: "GET",
        url: "/api/device-builds/build-1/logs?token=paired-token",
        headers: {
          host: "mac.example.test",
          authorization: "Bearer capability-token",
        },
      },
      response,
      { pairingStore: pairings, deviceBuildStore: builds },
    ),
    true,
  );
  assert.equal(response.status, 200);
  assert.match(response.body, /build-1/);
});

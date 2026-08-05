import assert from "node:assert/strict";
import test from "node:test";
import { handlePairingFallbackRequest } from "../mac-helper/src/http/pairingFallbackHandler.js";
import {
  handlePublicBuildExpiryRequest,
  handlePublicBuildLogsRequest,
} from "../mac-helper/src/http/publicBuildCapabilityHandlers.js";

class ResponseRecorder {
  status = 0;
  headers: Record<string, string> = {};
  body = "";

  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
  }

  end(body = "") {
    this.body += body;
  }
}

test("pairing handler preserves query authorization, origin inputs, and HTML policy", () => {
  const response = new ResponseRecorder();
  const originInputs: unknown[] = [];
  const pairing = {
    token: "pair-token",
    installationID: "installation",
    macName: "Test Mac",
  };

  assert.equal(
    handlePairingFallbackRequest(
      {
        method: "GET",
        url: "/pair?token=pair-token&base=https%3A%2F%2Fpublic.example",
        headers: {
          host: "127.0.0.1:47217",
          "x-forwarded-host": "public.example",
          "x-forwarded-proto": "https",
        },
        socket: { remoteAddress: "127.0.0.1" },
      },
      response,
      {
        current: () => pairing,
        tokenMatches: (token: string) => token === pairing.token,
      },
      { inspect: () => null },
      {
        evaluate(input: unknown) {
          originInputs.push(input);
          return { valid: true, externalBaseURL: "https://public.example" };
        },
      },
    ),
    true,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.headers["content-security-policy"] || "", /default-src 'none'/);
  assert.match(response.body, /Connect to Test Mac/);
  assert.match(response.body, /swift-sim:\/\/pair/);
  assert.deepEqual(originInputs, [
    {
      socketRemoteAddress: "127.0.0.1",
      requestProtocol: "http:",
      hostHeader: "127.0.0.1:47217",
      forwardedHostHeader: "public.example",
      forwardedProtoHeader: "https",
      requestedExternalBaseURL: "https://public.example",
    },
  ]);
});

test("pairing handler keeps bearer credentials unauthorized", () => {
  const response = new ResponseRecorder();
  const pairing = {
    token: "pair-token",
    installationID: "installation",
    macName: "Test Mac",
  };

  assert.equal(
    handlePairingFallbackRequest(
      {
        method: "GET",
        url: "/pair",
        headers: {
          host: "mac.example",
          authorization: "Bearer pair-token",
        },
      },
      response,
      {
        current: () => pairing,
        tokenMatches: (token: string) => token === pairing.token,
      },
      { inspect: () => null },
      {
        evaluate: () => ({ valid: true, externalBaseURL: "https://mac.example" }),
      },
    ),
    true,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized." });
});

test("public build expiry handler preserves capability expiration semantics", () => {
  const response = new ResponseRecorder();
  const expiredBuild = {
    id: "build-1",
    token: "expired-token",
    expiresAt: "2020-01-01T00:00:00.000Z",
    state: "ready",
    logs: [],
    capabilities: [],
  };

  assert.equal(
    handlePublicBuildExpiryRequest(
      {
        method: "GET",
        url: "/d/build-1?token=expired-token",
        headers: { host: "mac.example" },
      },
      response,
      {
        pairingStore: { tokenMatches: () => false },
        deviceBuildStore: {
          get: (buildID: string) => (buildID === expiredBuild.id ? expiredBuild : null),
        },
      },
    ),
    true,
  );
  assert.equal(response.status, 410);
  assert.deepEqual(JSON.parse(response.body), { error: "This install link has expired." });
});

test("public build logs handler preserves bearer precedence and sanitization", () => {
  const response = new ResponseRecorder();
  const build = {
    id: "build-1",
    token: "capability-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    state: "ready",
    logs: ["Build is ready to install.", "/Users/private/project secret"],
    capabilities: [],
  };

  assert.equal(
    handlePublicBuildLogsRequest(
      {
        method: "GET",
        url: "/api/device-builds/build-1/logs?token=paired-token",
        headers: {
          host: "mac.example",
          authorization: "Bearer capability-token",
        },
      },
      response,
      {
        pairingStore: { tokenMatches: (token: string) => token === "paired-token" },
        deviceBuildStore: {
          get: (buildID: string) => (buildID === build.id ? build : null),
        },
      },
    ),
    true,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    buildId: "build-1",
    logs: ["Build is ready to install.", "[build output redacted]"],
  });
});

test("non-GET extracted handlers preserve request-metadata short circuit", () => {
  const request: {
    method: string;
    readonly url: string;
    readonly headers: Record<string, unknown>;
  } = {
    method: "POST",
    get url(): string {
      throw new Error("URL must not be read");
    },
    get headers(): Record<string, unknown> {
      throw new Error("headers must not be read");
    },
  };
  const response = new ResponseRecorder();

  assert.equal(
    handlePairingFallbackRequest(
      request,
      response,
      {
        current: () => {
          throw new Error("pairing state must not be read");
        },
        tokenMatches: () => false,
      },
      { inspect: () => null },
      {
        evaluate: () => ({ valid: false, externalBaseURL: "" }),
      },
    ),
    false,
  );
  assert.equal(
    handlePublicBuildLogsRequest(request, response, {
      pairingStore: { tokenMatches: () => false },
      deviceBuildStore: {
        get: () => {
          throw new Error("build state must not be read");
        },
      },
    }),
    false,
  );
  assert.equal(response.status, 0);
});

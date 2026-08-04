import assert from "node:assert/strict";
import test from "node:test";
import { handlePairingFallback } from "../mac-helper/src/helperHttpBoundaryPreload.js";
import type {
  RequestOriginInput,
  RequestOriginPolicy,
} from "../mac-helper/src/infrastructure/ports.js";

test("pairing fallback delegates origin derivation to RequestOriginPolicy", () => {
  const inputs: RequestOriginInput[] = [];
  const originPolicy: RequestOriginPolicy = {
    evaluate(input) {
      inputs.push(input);
      return {
        valid: true,
        requestIsLoopback: true,
        forwardedHeadersTrusted: true,
        externalBaseURL: "https://delegated.example",
        source: "trusted-proxy",
      };
    },
  };
  const pairing = {
    token: "pair-token",
    installationID: "stable-helper-id",
    macName: "Test Mac",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
  const store = {
    current: () => pairing,
    tokenMatches: (token: string) => token === pairing.token,
  };
  const invites = {
    inspect: () => {
      throw new Error("Invitation store must not be used for token pairing.");
    },
  };
  const response = {
    status: 0,
    headers: {} as Record<string, string>,
    body: "",
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body += body;
    },
  };

  assert.equal(
    handlePairingFallback(
      {
        method: "GET",
        url: "/pair?token=pair-token&base=https%3A%2F%2Fignored.example",
        headers: {
          host: "127.0.0.1:47217",
          "x-forwarded-host": "mac.example.test",
          "x-forwarded-proto": "https",
        },
        socket: { remoteAddress: "127.0.0.1" },
      },
      response,
      store,
      invites,
      originPolicy,
    ),
    true,
  );

  assert.deepEqual(inputs, [
    {
      socketRemoteAddress: "127.0.0.1",
      requestProtocol: "http:",
      hostHeader: "127.0.0.1:47217",
      forwardedHostHeader: "mac.example.test",
      forwardedProtoHeader: "https",
      requestedExternalBaseURL: "https://ignored.example",
    },
  ]);
  assert.equal(response.status, 200);
  assert.match(response.body, /base=https%3A%2F%2Fdelegated\.example/);
  assert.doesNotMatch(response.body, /ignored\.example/);
});

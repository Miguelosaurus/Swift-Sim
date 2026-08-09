import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  handleHelperControlRoutes,
  helperControlAuthorizationMatrix,
} from "../mac-helper/src/http/helperControlRoutes.js";

const routes = [
  ["GET", "/health", "health"],
  ["GET", "/.well-known/apple-app-site-association", "association"],
  ["GET", "/api/serve-sim", "serve-sim"],
  ["GET", "/api/transports", "transports"],
  ["GET", "/api/pairing/status", "pairing-status"],
  ["POST", "/api/pairing/claim", "pairing-claim"],
  ["POST", "/api/pairing/rotate", "pairing-rotate"],
];

test("helper control matrix declares all seven stable boundaries", () => {
  assert.deepEqual(helperControlAuthorizationMatrix, [
    { route: "GET /health", exposure: "helper-and-public-gateway", authorization: "none" },
    {
      route: "GET /.well-known/apple-app-site-association",
      exposure: "helper",
      authorization: "none",
    },
    { route: "GET /api/serve-sim", exposure: "private-helper", authorization: "paired-mac" },
    { route: "GET /api/transports", exposure: "private-helper", authorization: "paired-mac" },
    {
      route: "GET /api/pairing/status",
      exposure: "pairing",
      authorization: "pairing-query-token",
    },
    {
      route: "POST /api/pairing/claim",
      exposure: "pairing",
      authorization: "one-time-invite",
    },
    {
      route: "POST /api/pairing/rotate",
      exposure: "pairing",
      authorization: "pairing-query-token",
    },
  ]);
});

for (const [method, pathname, operation] of routes) {
  test(`${method} ${pathname} delegates once and completes its response`, async () => {
    const response = responseRecorder();
    let received;
    let calls = 0;
    assert.equal(
      await handleHelperControlRoutes({
        req: request(method, {}),
        res: response,
        url: new URL(`http://127.0.0.1${pathname}?token=secret`),
        service: {
          execute: async (input) => {
            calls += 1;
            received = input;
            return { kind: "ok", status: 200, body: { operation } };
          },
        },
      }),
      true,
    );
    assert.equal(received.operation, operation);
    assert.equal(calls, 1);
    assert.equal(
      typeof received.readInput,
      operation === "pairing-claim" ? "function" : "undefined",
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.ended, true);
  });
}

test("helper control routes preserve unauthorized and fallthrough behavior", async () => {
  const response = responseRecorder();
  assert.equal(
    await handleHelperControlRoutes({
      req: request("GET"),
      res: response,
      url: new URL("http://127.0.0.1/api/pairing/status?token=wrong"),
      service: { execute: async () => ({ kind: "unauthorized" }) },
    }),
    true,
  );
  assert.equal(response.statusCode, 401);
  assert.equal(
    await handleHelperControlRoutes({
      req: request("DELETE"),
      res: responseRecorder(),
      url: new URL("http://127.0.0.1/api/pairing/status"),
      service: {
        execute: async () => {
          throw new Error("service touched");
        },
      },
    }),
    false,
  );
});

test("pairing claim surfaces malformed JSON without writing a response", async () => {
  const response = responseRecorder();
  const req = Object.assign(Readable.from(["{"]), { method: "POST", headers: {} });
  await assert.rejects(
    handleHelperControlRoutes({
      req,
      res: response,
      url: new URL("http://127.0.0.1/api/pairing/claim"),
      service: {
        execute: async (input) => {
          await input.readInput();
          throw new Error("unreachable");
        },
      },
    }),
    SyntaxError,
  );
  assert.equal(response.ended, false);
});

function request(method, body = undefined) {
  return Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {
    method,
    headers: {},
  });
}

function responseRecorder() {
  return {
    statusCode: null,
    body: "",
    ended: false,
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body = "") {
      this.body = String(body);
      this.ended = true;
    },
  };
}

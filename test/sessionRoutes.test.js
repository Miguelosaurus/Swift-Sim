import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  handleSessionRoutes,
  sessionRouteAuthorizationMatrix,
} from "../mac-helper/src/http/sessionRoutes.js";

test("session route matrix declares every route authorization boundary", () => {
  assert.equal(sessionRouteAuthorizationMatrix.length, 14);
  assert.deepEqual(
    new Set(sessionRouteAuthorizationMatrix.map((item) => item.authorization)),
    new Set(["paired-mac", "session-token"]),
  );
  assert.equal(
    sessionRouteAuthorizationMatrix.filter((item) => item.authorization === "paired-mac").length,
    1,
  );
  assert.equal(sessionRouteAuthorizationMatrix.at(-1).route, "ANY /s/:id");
});

const routeCases = [
  ["POST", "/api/sessions/start", "start", undefined],
  ["GET", "/api/sessions/session-1", "get", "session-1"],
  ["GET", "/api/sessions/session-1/logs", "logs", "session-1"],
  ["POST", "/api/sessions/session-1/stop", "stop", "session-1"],
  ["GET", "/api/sessions/session-1/links", "links", "session-1"],
  ["GET", "/api/sessions/session-1/stream", "stream", "session-1"],
  ["GET", "/api/sessions/session-1/frame-mask", "frame-mask", "session-1"],
  ["POST", "/api/sessions/session-1/type", "type", "session-1"],
  ["POST", "/api/sessions/session-1/key", "key", "session-1"],
  ["POST", "/api/sessions/session-1/tap", "tap", "session-1"],
  ["POST", "/api/sessions/session-1/gesture", "gesture", "session-1"],
  ["POST", "/api/sessions/session-1/multitouch", "multitouch", "session-1"],
  ["POST", "/api/sessions/session-1/control/home", "control", "session-1"],
  ["POST", "/s/session-1", "web", "session-1"],
];

for (const [method, pathname, operation, sessionID] of routeCases) {
  test(`${method} ${pathname} delegates once through the application-service boundary`, async () => {
    const response = responseRecorder();
    let received;
    const handled = await handleSessionRoutes({
      req: request(method, {}),
      res: response,
      url: new URL(`http://127.0.0.1${pathname}?token=secret`),
      service: {
        execute: async (input) => {
          received = input;
          return { kind: "unauthorized" };
        },
      },
    });

    assert.equal(handled, true);
    assert.equal(received.operation, operation);
    assert.equal(received.sessionID, sessionID);
    assert.equal(response.statusCode, 401);
    assert.equal(response.ended, true);
  });
}

test("session frame-mask outcome preserves headers and binary body", async () => {
  const response = responseRecorder();
  const data = Buffer.from("mask");
  const handled = await handleSessionRoutes({
    req: request("GET"),
    res: response,
    url: new URL("http://127.0.0.1/api/sessions/session-1/frame-mask?token=secret"),
    service: {
      execute: async () => ({
        kind: "mask",
        mask: { contentType: "image/png", data, width: 10, height: 20 },
      }),
    },
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "image/png");
  assert.equal(response.headers["x-swift-sim-frame-width"], 10);
  assert.deepEqual(response.body, data);
  assert.equal(response.ended, true);
});

test("session route projects JSON, not-found, HTML, and streamed outcomes", async () => {
  for (const [outcome, expected] of [
    [
      { kind: "ok", status: 201, body: { id: "session-1" } },
      { status: 201, ended: true },
    ],
    [
      { kind: "not-found", message: "Unknown session." },
      { status: 404, ended: true },
    ],
    [
      { kind: "html", body: "<html>session</html>" },
      { status: 200, ended: true },
    ],
    [{ kind: "streamed" }, { status: null, ended: false }],
  ]) {
    const response = responseRecorder();
    assert.equal(
      await handleSessionRoutes({
        req: request("GET"),
        res: response,
        url: new URL("http://127.0.0.1/s/session-1?token=secret"),
        service: { execute: async () => outcome },
      }),
      true,
    );
    assert.equal(response.statusCode, expected.status);
    assert.equal(response.ended, expected.ended);
  }
});

test("session route rejects malformed input and unknown service outcomes", async () => {
  const malformed = Object.assign(Readable.from(["{"]), { method: "POST", headers: {} });
  await assert.rejects(
    handleSessionRoutes({
      req: malformed,
      res: responseRecorder(),
      url: new URL("http://127.0.0.1/api/sessions/start?token=secret"),
      service: {
        execute: async (input) => ({ kind: "ok", status: 201, body: await input.readInput() }),
      },
    }),
    SyntaxError,
  );

  await assert.rejects(
    handleSessionRoutes({
      req: request("GET"),
      res: responseRecorder(),
      url: new URL("http://127.0.0.1/s/session-1?token=secret"),
      service: { execute: async () => ({ kind: "unexpected" }) },
    }),
    /Unknown session route outcome/,
  );
});

test("unsupported base-session methods preserve authorization before fallthrough", async () => {
  for (const [token, outcome, expectedHandled, expectedStatus] of [
    ["wrong", { kind: "unauthorized" }, true, 401],
    ["secret", { kind: "unhandled" }, false, null],
  ]) {
    const response = responseRecorder();
    assert.equal(
      await handleSessionRoutes({
        req: request("PUT"),
        res: response,
        url: new URL(`http://127.0.0.1/api/sessions/session-1?token=${token}`),
        service: {
          execute: async (input) => {
            assert.equal(input.operation, "unhandled");
            return outcome;
          },
        },
      }),
      expectedHandled,
    );
    assert.equal(response.statusCode, expectedStatus);
  }
});

test("session route failures preserve pre-header handling and destroy post-header streams", async () => {
  const failure = new Error("stream failed");
  const beforeHeaders = responseRecorder();
  await assert.rejects(
    handleSessionRoutes({
      req: request("GET"),
      res: beforeHeaders,
      url: new URL("http://127.0.0.1/api/sessions/session-1/stream?token=secret"),
      service: {
        execute: async () => {
          throw failure;
        },
      },
    }),
    failure,
  );
  assert.equal(beforeHeaders.destroyed, false);

  const afterHeaders = responseRecorder();
  afterHeaders.headersSent = true;
  assert.equal(
    await handleSessionRoutes({
      req: request("GET"),
      res: afterHeaders,
      url: new URL("http://127.0.0.1/api/sessions/session-1/stream?token=secret"),
      service: {
        execute: async () => {
          throw failure;
        },
      },
    }),
    true,
  );
  assert.equal(afterHeaders.destroyed, true);
  assert.equal(afterHeaders.destroyError, failure);
});

test("unknown routes fall through without touching the application service", async () => {
  const handled = await handleSessionRoutes({
    req: request("GET"),
    res: responseRecorder(),
    url: new URL("http://127.0.0.1/api/apps"),
    service: {
      execute: async () => {
        throw new Error("service touched");
      },
    },
  });
  assert.equal(handled, false);
});

function responseRecorder() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    ended: false,
    headersSent: false,
    destroyed: false,
    destroyError: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      this.ended = true;
    },
    destroy(error) {
      this.destroyed = true;
      this.destroyError = error;
    },
  };
}

function request(method, body = undefined) {
  return Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {
    method,
    headers: {},
  });
}

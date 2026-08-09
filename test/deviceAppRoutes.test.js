import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  deviceAppAuthorizationMatrix,
  handleDeviceAppRoutes,
} from "../mac-helper/src/http/deviceAppRoutes.js";

const routes = [
  ["GET", "/api/device-builds", "list-builds", undefined],
  ["GET", "/api/apps", "list-apps", undefined],
  ["GET", "/api/apps/app-1", "get-app", "app-1"],
  ["POST", "/api/apps/app-1/archive", "archive-app", "app-1"],
  ["POST", "/api/apps/app-1/build-current-source", "rebuild-app", "app-1"],
  ["DELETE", "/api/apps/app-1", "delete-app", "app-1"],
];

test("device app matrix declares every paired-Mac route", () => {
  assert.deepEqual(
    deviceAppAuthorizationMatrix,
    routes.map(([method, pathname]) => ({
      route: `${method} ${pathname.replace("app-1", ":id")}`,
      exposure: "private-helper",
      authorization: "paired-mac",
    })),
  );
});

for (const [method, pathname, operation, appID] of routes) {
  test(`${method} ${pathname} delegates exactly once`, async () => {
    let calls = 0;
    let received;
    const response = responseRecorder();
    assert.equal(
      await handleDeviceAppRoutes({
        req: request(method, {}),
        res: response,
        url: new URL(`http://127.0.0.1${pathname}`),
        service: {
          execute: async (input) => {
            calls += 1;
            received = input;
            return { kind: "json", status: 200, body: { ok: true } };
          },
        },
      }),
      true,
    );
    assert.equal(calls, 1);
    assert.equal(received.operation, operation);
    assert.equal(received.appID, appID);
    assert.equal(
      typeof received.readInput,
      operation === "archive-app" || operation === "rebuild-app" ? "function" : "undefined",
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.ended, true);
  });
}

test("device app routes project all outcome kinds and reject unknown outcomes", async () => {
  for (const [outcome, status] of [
    [{ kind: "unauthorized" }, 401],
    [{ kind: "not-found", message: "missing" }, 404],
    [{ kind: "bad-request", status: 409, message: "invalid" }, 409],
  ]) {
    const response = responseRecorder();
    await handleDeviceAppRoutes({
      req: request("GET"),
      res: response,
      url: new URL("http://127.0.0.1/api/apps"),
      service: { execute: async () => outcome },
    });
    assert.equal(response.statusCode, status);
    assert.equal(response.ended, true);
  }
  await assert.rejects(
    handleDeviceAppRoutes({
      req: request("GET"),
      res: responseRecorder(),
      url: new URL("http://127.0.0.1/api/apps"),
      service: { execute: async () => ({ kind: "unexpected" }) },
    }),
    /Unknown device app outcome/,
  );
});

test("unsupported methods and malformed input preserve fallthrough and failure behavior", async () => {
  assert.equal(
    await handleDeviceAppRoutes({
      req: request("PATCH"),
      res: responseRecorder(),
      url: new URL("http://127.0.0.1/api/apps/app-1"),
      service: {
        execute: async () => {
          throw new Error("touched");
        },
      },
    }),
    false,
  );
  const req = Object.assign(Readable.from(["{"]), { method: "POST", headers: {} });
  const response = responseRecorder();
  await assert.rejects(
    handleDeviceAppRoutes({
      req,
      res: response,
      url: new URL("http://127.0.0.1/api/apps/app-1/archive"),
      service: { execute: async (input) => input.readInput() },
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
    ended: false,
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end() {
      this.ended = true;
    },
  };
}

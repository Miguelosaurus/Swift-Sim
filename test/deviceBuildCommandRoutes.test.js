import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  deviceBuildCommandAuthorizationMatrix,
  handleDeviceBuildCommandRoutes,
} from "../mac-helper/src/http/deviceBuildCommandRoutes.js";

test("device build command matrix declares both paired-Mac routes", () => {
  assert.deepEqual(deviceBuildCommandAuthorizationMatrix, [
    {
      route: "POST /api/device-builds/start",
      exposure: "private-helper",
      authorization: "paired-mac",
    },
    {
      route: "POST /api/device-builds/:id/renew",
      exposure: "private-helper",
      authorization: "paired-mac",
    },
  ]);
});

for (const [pathname, operation, buildID] of [
  ["/api/device-builds/start", "start-build", undefined],
  ["/api/device-builds/build-1/renew", "renew-build", "build-1"],
]) {
  test(`${pathname} delegates once and completes`, async () => {
    let calls = 0;
    let received;
    const response = recorder();
    assert.equal(
      await handleDeviceBuildCommandRoutes({
        req: request("POST", {}),
        res: response,
        url: new URL(`http://127.0.0.1${pathname}`),
        service: {
          execute: async (input) => {
            calls += 1;
            received = input;
            return { kind: "json", status: 202, body: {} };
          },
        },
      }),
      true,
    );
    assert.equal(calls, 1);
    assert.equal(received.operation, operation);
    assert.equal(received.buildID, buildID);
    assert.equal(typeof received.readInput, operation === "start-build" ? "function" : "undefined");
    assert.equal(response.statusCode, 202);
    assert.equal(response.ended, true);
  });
}

test("command routes project failures, preserve fallthrough, and surface malformed JSON", async () => {
  for (const [outcome, status] of [
    [{ kind: "unauthorized" }, 401],
    [{ kind: "not-found", message: "missing" }, 404],
    [{ kind: "bad-request", status: 409, message: "invalid" }, 409],
  ]) {
    const response = recorder();
    await handleDeviceBuildCommandRoutes({
      req: request("POST"),
      res: response,
      url: new URL("http://127.0.0.1/api/device-builds/build-1/renew"),
      service: { execute: async () => outcome },
    });
    assert.equal(response.statusCode, status);
    assert.equal(response.ended, true);
  }
  assert.equal(
    await handleDeviceBuildCommandRoutes({
      req: request("GET"),
      res: recorder(),
      url: new URL("http://127.0.0.1/api/device-builds/start"),
      service: {
        execute: async () => {
          throw new Error("touched");
        },
      },
    }),
    false,
  );
  const response = recorder();
  await assert.rejects(
    handleDeviceBuildCommandRoutes({
      req: Object.assign(Readable.from(["{"]), { method: "POST", headers: {} }),
      res: response,
      url: new URL("http://127.0.0.1/api/device-builds/start"),
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

function recorder() {
  return {
    statusCode: null,
    ended: false,
    writeHead(status) {
      this.statusCode = status;
    },
    end() {
      this.ended = true;
    },
  };
}

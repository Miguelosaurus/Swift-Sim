import assert from "node:assert/strict";
import test from "node:test";
import {
  deviceBuildCapabilityAuthorizationMatrix,
  handleDeviceBuildCapabilityRoutes,
} from "../mac-helper/src/http/deviceBuildCapabilityRoutes.js";

test("device build capability matrix declares mixed and capability-only routes", () => {
  assert.deepEqual(deviceBuildCapabilityAuthorizationMatrix, [
    {
      route: "GET /api/device-builds/:id",
      exposure: "public-delivery-or-private-helper",
      authorization: "build-capability-or-paired-mac",
    },
    {
      route: "GET /api/device-builds/:id/logs",
      exposure: "public-delivery-or-private-helper",
      authorization: "build-capability-or-paired-mac",
    },
    {
      route: "GET /api/device-builds/:id/links",
      exposure: "public-delivery-or-private-helper",
      authorization: "build-capability-or-paired-mac",
    },
    {
      route: "POST /api/device-builds/:id/install-request",
      exposure: "public-delivery-or-private-helper",
      authorization: "build-capability-or-paired-mac",
    },
    {
      route: "POST /api/device-builds/:id/verify",
      exposure: "public-delivery-or-private-helper",
      authorization: "build-capability-or-paired-mac",
    },
    {
      route: "GET /api/device-builds/:id/artifact/ipa",
      exposure: "public-delivery",
      authorization: "build-capability",
    },
    {
      route: "GET /api/device-builds/:id/artifact/manifest",
      exposure: "public-delivery",
      authorization: "build-capability",
    },
    { route: "GET /d/:id", exposure: "public-delivery", authorization: "build-capability" },
  ]);
});

for (const [method, pathname, operation, artifact] of [
  ["GET", "/api/device-builds/build-1", "status", undefined],
  ["GET", "/api/device-builds/build-1/logs", "logs", undefined],
  ["GET", "/api/device-builds/build-1/links", "links", undefined],
  ["POST", "/api/device-builds/build-1/install-request", "install-request", undefined],
  ["POST", "/api/device-builds/build-1/verify", "verify", undefined],
  ["GET", "/api/device-builds/build-1/artifact/ipa", "artifact", "ipa"],
  ["GET", "/api/device-builds/build-1/artifact/manifest", "artifact", "manifest"],
  ["GET", "/d/build-1", "install-page", undefined],
]) {
  test(`${method} ${pathname} delegates once and completes`, async () => {
    let calls = 0;
    let received;
    const response = recorder();
    assert.equal(await handleDeviceBuildCapabilityRoutes({
      req: request(method),
      res: response,
      url: new URL(`http://127.0.0.1${pathname}`),
      service: {
        execute: async (input) => {
          calls += 1;
          received = input;
          return { kind: "json", status: 200, body: {} };
        },
      },
    }), true);
    assert.equal(calls, 1);
    assert.equal(received.operation, operation);
    assert.equal(received.buildID, "build-1");
    assert.equal(received.artifact, artifact);
    assert.equal(response.statusCode, 200);
    assert.equal(response.ended, true);
  });
}

test("private start route and unsupported methods fall through without service access", async () => {
  for (const [method, pathname] of [
    ["POST", "/api/device-builds/start"],
    ["GET", "/api/device-builds/start"],
    ["DELETE", "/api/device-builds/build-1"],
    ["POST", "/d/build-1"],
    ["POST", "/api/device-builds/build-1/artifact/ipa"],
  ]) {
    assert.equal(await handleDeviceBuildCapabilityRoutes({
      req: request(method),
      res: recorder(),
      url: new URL(`http://127.0.0.1${pathname}`),
      service: { execute: async () => { throw new Error("touched"); } },
    }), false, `${method} ${pathname}`);
  }
});

test("route adapter projects stable failure and text outcomes", async () => {
  for (const [outcome, status] of [
    [{ kind: "unauthorized" }, 401],
    [{ kind: "not-found", message: "missing" }, 404],
    [{ kind: "bad-request", status: 410, message: "expired" }, 410],
  ]) {
    const response = recorder();
    await handleDeviceBuildCapabilityRoutes({
      req: request("GET"),
      res: response,
      url: new URL("http://127.0.0.1/api/device-builds/build-1"),
      service: { execute: async () => outcome },
    });
    assert.equal(response.statusCode, status);
    assert.equal(response.ended, true);
  }

  const response = recorder();
  await handleDeviceBuildCapabilityRoutes({
    req: request("GET"),
    res: response,
    url: new URL("http://127.0.0.1/d/build-1"),
    service: {
      execute: async () => ({
        kind: "text",
        status: 200,
        body: "page",
        contentType: "text/html; charset=utf-8",
        headers: { "x-test": "yes" },
      }),
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(response.headers["x-test"], "yes");
  assert.equal(response.body, "page");
});

function request(method) {
  return { method, headers: {} };
}

function recorder() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    ended: false,
    headersSent: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body = "") {
      this.body += String(body || "");
      this.ended = true;
    },
    once() {},
    destroy() {},
  };
}

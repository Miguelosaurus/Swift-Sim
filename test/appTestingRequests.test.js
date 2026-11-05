import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  createTestingRequests,
  handleTestingRequestRoutes,
} from "../mac-helper/optional/app-control/requests.js";

const ID = "00000000-0000-4000-8000-000000000001";
const APP = "dev.fixture.app";
const EPOCH = "a".repeat(64);
function fixture() {
  const calls = [];
  const devices = [
    {
      id: ID,
      token: "PRIVATE-PHONE-TOKEN",
      environment: "production",
      enabled: true,
      epoch: EPOCH,
    },
  ];
  let epoch = EPOCH;
  const service = createTestingRequests({
    authority: () => ({ epoch, installationId: "mac-one" }),
    builds: () => [
      { state: "ready", createdAt: "2026-11-05", app: { name: "Fixture", bundleIdentifier: APP } },
    ],
    notificationStore: { snapshot: () => ({ devices }) },
    provider: {
      status: () => ({ generation: "provider-one" }),
      send: async (args) => {
        calls.push({ push: args });
        assert.equal(await args.isCurrent(), true);
        return { state: "accepted" };
      },
    },
    run: async (request) => {
      const args = JSON.parse(request.input).args;
      calls.push({ args, executable: request.executable });
      return {
        code: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          outcome: args[0] === "open" ? "session-open" : "request-pending",
          request: {
            id: ID,
            name: "Fixture",
            app: APP,
            expiresAt: Date.now() / 1000 + 300,
            state: "pending",
          },
        }),
      };
    },
  });
  return {
    service,
    calls,
    devices,
    rotate: () => {
      epoch = "b".repeat(64);
    },
  };
}

test("a testing push requests approval without authorizing input or exposing registration", async () => {
  const f = fixture();
  const result = await f.service.command(["request", "--app", APP]);
  assert.equal(result.outcome, "waiting-for-phone");
  assert.equal(result.notificationState, "accepted");
  assert.equal(result.request, ID);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-PHONE-TOKEN/);
  assert.equal(
    f.calls.find((call) => call.push).push.payload.aps.category,
    "SWIFT_SIM_APP_TESTING",
  );
  assert.equal(f.calls.find((call) => call.push).push.payload.macID, "mac-one");
  assert.equal(f.calls.find((call) => call.push).push.payload.appTestingRequestId, ID);
  assert.ok(
    f.calls
      .filter((call) => call.args)
      .every((call) => !["open", "request-approve"].includes(call.args[0])),
  );
});

test("ambiguous notification devices and unknown apps never send a request", async () => {
  const f = fixture();
  f.devices.push({ ...f.devices[0], id: "other-phone" });
  const refused = await f.service.command(["request", "--app", APP]);
  assert.equal(refused.code, "APP_CONTROL_NOTIFICATION_DEVICE_REQUIRED");
  assert.equal(f.calls.length, 0);
  await assert.rejects(() => f.service.command(["request", "--app", "dev.unknown.app"]));
  assert.equal(f.calls.length, 0);
});

test("approved open goes directly to Python once and carries current authority", async () => {
  const f = fixture();
  const result = await f.service.command(["open", "--app", APP, "--request", ID]);
  assert.equal(result.outcome, "session-open");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].executable, "/usr/bin/env");
  assert.deepEqual(f.calls[0].args, ["open", "--app", APP, "--request", ID, "--authority", EPOCH]);
});

function response() {
  let body = "";
  return {
    statusCode: 0,
    setHeader() {},
    writeHead(code) {
      this.statusCode = code;
    },
    end(value = "") {
      body += value;
    },
    get body() {
      return body;
    },
  };
}
test("testing routes reject public, unauthorized and invalid approval bodies before effects", async () => {
  for (const [privateHelper, authorized, expected] of [
    [false, true, 404],
    [true, false, 401],
    [true, true, 400],
  ]) {
    let effects = 0;
    const req = Readable.from([
      JSON.stringify({ deviceId: ID, action: "approve", extra: "not allowed" }),
    ]);
    req.method = "POST";
    req.headers = { "content-type": "application/json" };
    const res = response();
    await handleTestingRequestRoutes({
      req,
      res,
      url: new URL(`http://private/api/app-testing/${ID}`),
      privateHelper,
      authorize: async () => authorized,
      service: {
        approve: async () => {
          effects++;
        },
      },
      installationId: () => "mac-one",
    });
    assert.equal(res.statusCode, expected);
    assert.equal(effects, 0);
  }
});

test("pairing rotation during asynchronous body receipt refuses approval", async () => {
  let authorized = true;
  let effects = 0;
  const req = Readable.from(
    (async function* () {
      yield JSON.stringify({ deviceId: ID, action: "approve" });
      authorized = false;
    })(),
  );
  req.method = "POST";
  req.headers = {};
  const res = response();
  await handleTestingRequestRoutes({
    req,
    res,
    url: new URL(`http://private/api/app-testing/${ID}`),
    privateHelper: true,
    authorize: async () => authorized,
    service: {
      approve: async () => {
        effects++;
      },
    },
    installationId: () => "mac-one",
  });
  assert.equal(res.statusCode, 401);
  assert.equal(effects, 0);
});

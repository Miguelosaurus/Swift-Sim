import assert from "node:assert/strict";
import test from "node:test";
import { createSessionHttpApplicationService } from "../mac-helper/src/http/sessionHttpApplicationService.js";

test("session application service rejects an incomplete dependency surface", () => {
  assert.throws(() => createSessionHttpApplicationService({}), /requires pairingTokenMatches/);
});

test("session start authorizes before reading input and preserves the request projection", async () => {
  let inputRead = false;
  const denied = createSessionHttpApplicationService(
    dependencies({
      pairingTokenMatches: () => false,
    }),
  );
  assert.deepEqual(
    await denied.execute({
      operation: "start",
      request: {},
      url: url(),
      readInput: async () => {
        inputRead = true;
        return {};
      },
    }),
    { kind: "unauthorized" },
  );
  assert.equal(inputRead, false);

  let received;
  const service = createSessionHttpApplicationService(
    dependencies({
      startSession: async (input) => {
        received = input;
        return { id: "session-1" };
      },
    }),
  );
  const body = {
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "SIM-1",
    remoteBaseUrl: "https://mac.example",
    port: 5000,
    transport: "native-companion",
  };
  assert.deepEqual(
    await service.execute({
      operation: "start",
      request: {},
      url: url(),
      readInput: async () => body,
    }),
    { kind: "ok", status: 201, body: { id: "session-1" } },
  );
  assert.deepEqual(received, {
    project: body.project,
    scheme: body.scheme,
    simulator: body.simulatorUDID,
    remoteBaseUrl: body.remoteBaseUrl,
    port: body.port,
    transport: body.transport,
  });
});

for (const operation of [
  "get",
  "logs",
  "stop",
  "links",
  "stream",
  "frame-mask",
  "type",
  "key",
  "tap",
  "gesture",
  "multitouch",
  "control",
  "web",
]) {
  test(`${operation} authorizes before reading input or invoking its dependency`, async () => {
    let operationInvoked = false;
    let inputRead = false;
    const service = createSessionHttpApplicationService(
      dependencies({
        tokenMatches: () => false,
        stopSession: async () => {
          operationInvoked = true;
        },
        streamSession: async () => {
          operationInvoked = true;
        },
        frameMask: () => {
          operationInvoked = true;
          return null;
        },
        typeText: async () => {
          operationInvoked = true;
        },
        sendKey: async () => {
          operationInvoked = true;
        },
        tap: async () => {
          operationInvoked = true;
        },
        gesture: async () => {
          operationInvoked = true;
        },
        multitouch: async () => {
          operationInvoked = true;
        },
        control: async () => {
          operationInvoked = true;
        },
      }),
    );
    const outcome = await service.execute({
      operation,
      sessionID: "session-1",
      url: url("wrong"),
      readInput: async () => {
        inputRead = true;
        return {};
      },
    });
    assert.deepEqual(outcome, { kind: "unauthorized" });
    assert.equal(operationInvoked, false);
    assert.equal(inputRead, false);
  });
}

test("session operations preserve dependency signatures and projections", async () => {
  const calls = [];
  const service = createSessionHttpApplicationService(
    dependencies({
      stopSession: async (...args) => {
        calls.push(["stop", ...args]);
      },
      streamSession: async (...args) => {
        calls.push(["stream", ...args]);
      },
      typeText: async (...args) => {
        calls.push(["type", ...args]);
        return { typed: true };
      },
      sendKey: async (...args) => {
        calls.push(["key", ...args]);
        return { keyed: true };
      },
      tap: async (...args) => {
        calls.push(["tap", ...args]);
        return { tapped: true };
      },
      gesture: async (...args) => {
        calls.push(["gesture", ...args]);
        return { gestured: true };
      },
      multitouch: async (...args) => {
        calls.push(["multitouch", ...args]);
        return { touched: true };
      },
      control: async (...args) => {
        calls.push(["control", ...args]);
        return { controlled: true };
      },
    }),
  );
  const requestURL = url("secret");
  const input = { text: "hello", key: "return", x: 12, y: 34, points: [1] };

  assert.equal(
    (await service.execute({ operation: "get", sessionID: "session-1", url: requestURL })).kind,
    "ok",
  );
  assert.equal(
    (await service.execute({ operation: "logs", sessionID: "session-1", url: requestURL })).kind,
    "ok",
  );
  assert.equal(
    (await service.execute({ operation: "stop", sessionID: "session-1", url: requestURL })).kind,
    "ok",
  );
  assert.equal(
    (await service.execute({ operation: "links", sessionID: "session-1", url: requestURL })).kind,
    "ok",
  );
  assert.deepEqual(
    await service.execute({
      operation: "stream",
      sessionID: "session-1",
      url: requestURL,
      response: "response",
    }),
    { kind: "streamed" },
  );
  assert.equal(
    (await service.execute({ operation: "frame-mask", sessionID: "session-1", url: requestURL }))
      .kind,
    "mask",
  );
  for (const operation of ["type", "key", "tap", "gesture", "multitouch"]) {
    assert.equal(
      (
        await service.execute({
          operation,
          sessionID: "session-1",
          url: requestURL,
          readInput: async () => input,
        })
      ).kind,
      "ok",
    );
  }
  assert.equal(
    (
      await service.execute({
        operation: "control",
        sessionID: "session-1",
        control: "home",
        url: requestURL,
      })
    ).kind,
    "ok",
  );
  assert.equal(
    (await service.execute({ operation: "web", sessionID: "session-1", url: requestURL })).kind,
    "html",
  );

  const session = dependencies().getSession("session-1");
  assert.deepEqual(calls, [
    ["stop", "session-1"],
    ["stream", "response", session],
    ["type", session, "hello"],
    ["key", session, "return"],
    ["tap", session, 12, 34],
    ["gesture", session, input],
    ["multitouch", session, input],
    ["control", session, "home"],
  ]);
});

function dependencies(overrides = {}) {
  const session = {
    id: "session-1",
    logs: Array.from({ length: 205 }, (_, index) => `log-${index}`),
    remoteBaseUrl: "https://mac.example",
    simulatorUDID: "SIM-1",
  };
  return {
    pairingTokenMatches: () => true,
    getSession: () => session,
    tokenMatches: (_session, token) => token === "secret",
    startSession: async () => ({ id: "session-1" }),
    projectSession: (value) => ({ id: value.id }),
    stopSession: async () => {},
    sessionLinks: () => ({ universalLink: "https://mac.example/s/session-1" }),
    streamSession: async () => {},
    frameMask: () => ({
      contentType: "image/png",
      data: Buffer.from("mask"),
      width: 10,
      height: 20,
    }),
    typeText: async () => ({ typed: true }),
    sendKey: async () => ({ keyed: true }),
    tap: async () => ({ tapped: true }),
    gesture: async () => ({ gestured: true }),
    multitouch: async () => ({ touched: true }),
    control: async () => ({ controlled: true }),
    sessionPage: () => "<html></html>",
    ...overrides,
  };
}

function url(token = "secret") {
  return new URL(`http://127.0.0.1/api/sessions/session-1?token=${token}`);
}

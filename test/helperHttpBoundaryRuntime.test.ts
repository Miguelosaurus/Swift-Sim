import assert from "node:assert/strict";
import test from "node:test";
import { HelperHttpBoundaryRuntime } from "../mac-helper/src/http/helperServerRuntime.js";

type HelperResponse = {
  headersSent?: boolean;
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body?: string): unknown;
  destroy(error?: Error): unknown;
};
type RequestListener = (request: unknown, response: HelperResponse) => unknown;
type CreateServerInput = object | RequestListener | undefined;
type CreateServer = (
  optionsOrListener?: CreateServerInput,
  listener?: RequestListener,
) => unknown;

class ResponseRecorder implements HelperResponse {
  headersSent = false;
  status = 0;
  headers: Record<string, string> = {};
  body = "";
  destroyedWith: Error | undefined;

  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
    this.headersSent = true;
  }

  end(body = "") {
    this.body += body;
  }

  destroy(error?: Error) {
    this.destroyedWith = error;
  }
}

test("runtime preserves createServer overloads, dynamic this, and one maintenance timer", async () => {
  const originalCalls: Array<{ thisArg: unknown; args: unknown[] }> = [];
  const fallbackCalls: unknown[] = [];
  const scheduled: Array<{ callback: () => void; intervalMs: number }> = [];
  let syncCalls = 0;
  let replacementCalls = 0;
  let maintenanceCalls = 0;
  let unrefCalls = 0;
  const originalCreateServer: CreateServer = function (
    this: unknown,
    optionsOrListener?: CreateServerInput,
    listener?: RequestListener,
  ) {
    originalCalls.push({ thisArg: this, args: [...arguments] });
    return { call: originalCalls.length, optionsOrListener, listener };
  };
  let installedCreateServer: CreateServer = originalCreateServer;
  const runtime = new HelperHttpBoundaryRuntime({
    originalCreateServer,
    replaceCreateServer: (createServer: CreateServer) => {
      replacementCalls += 1;
      installedCreateServer = createServer;
    },
    syncBuiltinExports: () => {
      syncCalls += 1;
    },
    dispatchRequest: () => false,
    writeUnavailable: () => {
      throw new Error("unavailable response must not be written");
    },
    reportError: () => {
      throw new Error("error reporter must not run");
    },
    runMaintenance: async () => {
      maintenanceCalls += 1;
    },
    scheduleInterval: (callback: () => void, intervalMs: number) => {
      scheduled.push({ callback, intervalMs });
      return {
        unref() {
          unrefCalls += 1;
        },
      };
    },
    maintenanceIntervalMs: 30_000,
  });

  runtime.install();
  const firstInstalledCreateServer = installedCreateServer;
  runtime.install();
  assert.strictEqual(installedCreateServer, firstInstalledCreateServer);
  assert.equal(replacementCalls, 1);
  assert.equal(syncCalls, 1);

  const firstContext = { id: "listener-overload" };
  const firstServer = installedCreateServer.call(
    firstContext,
    (request: unknown, response: HelperResponse) => {
      fallbackCalls.push([request, response]);
      return "fallback-result";
    },
  );
  assert.deepEqual(firstServer, {
    call: 1,
    optionsOrListener: originalCalls[0]?.args[0],
    listener: undefined,
  });
  assert.strictEqual(originalCalls[0]?.thisArg, firstContext);
  assert.equal(originalCalls[0]?.args.length, 1);
  const guardedFirst = originalCalls[0]?.args[0];
  assert.equal(typeof guardedFirst, "function");
  const firstRequest = { path: "/fallback" };
  const firstResponse = new ResponseRecorder();
  assert.equal(
    (guardedFirst as RequestListener)(firstRequest, firstResponse),
    "fallback-result",
  );
  assert.deepEqual(fallbackCalls, [[firstRequest, firstResponse]]);
  assert.equal(maintenanceCalls, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.intervalMs, 30_000);
  assert.equal(unrefCalls, 1);

  scheduled[0]?.callback();
  await Promise.resolve();
  assert.equal(maintenanceCalls, 2);

  const secondContext = { id: "options-overload" };
  const options = { keepAlive: true };
  const secondServer = installedCreateServer.call(
    secondContext,
    options,
    (_request: unknown, _response: HelperResponse) => "second-fallback",
  );
  assert.deepEqual(secondServer, {
    call: 2,
    optionsOrListener: options,
    listener: originalCalls[1]?.args[1],
  });
  assert.strictEqual(originalCalls[1]?.thisArg, secondContext);
  assert.strictEqual(originalCalls[1]?.args[0], options);
  assert.equal(typeof originalCalls[1]?.args[1], "function");
  assert.equal(maintenanceCalls, 2);
  assert.equal(scheduled.length, 1);
});

test("runtime short-circuits handled requests before the compatibility listener", () => {
  let guardedListener: RequestListener | undefined;
  let fallbackCalls = 0;
  const originalCreateServer: CreateServer = (listener?: CreateServerInput) => {
    guardedListener = typeof listener === "function" ? listener : undefined;
    return {};
  };
  let installedCreateServer: CreateServer = originalCreateServer;
  new HelperHttpBoundaryRuntime({
    originalCreateServer,
    replaceCreateServer: (createServer: CreateServer) => {
      installedCreateServer = createServer;
    },
    syncBuiltinExports: () => {},
    dispatchRequest: () => true,
    writeUnavailable: () => {},
    reportError: () => {},
    runMaintenance: async () => {},
    scheduleInterval: () => ({}),
    maintenanceIntervalMs: 30_000,
  }).install();

  installedCreateServer(() => {
    fallbackCalls += 1;
  });
  guardedListener?.({}, new ResponseRecorder());
  assert.equal(fallbackCalls, 0);
});

test("runtime preserves pre-header 503 and post-header destroy behavior", () => {
  const guardedListeners: RequestListener[] = [];
  const reported: unknown[] = [];
  const unavailableResponses: HelperResponse[] = [];
  const originalCreateServer: CreateServer = (listener?: CreateServerInput) => {
    if (typeof listener === "function") guardedListeners.push(listener);
    return {};
  };
  let installedCreateServer: CreateServer = originalCreateServer;
  new HelperHttpBoundaryRuntime({
    originalCreateServer,
    replaceCreateServer: (createServer: CreateServer) => {
      installedCreateServer = createServer;
    },
    syncBuiltinExports: () => {},
    dispatchRequest: () => {
      throw new Error("dispatch failed");
    },
    writeUnavailable: (response: HelperResponse) => {
      unavailableResponses.push(response);
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"error":"unavailable"}');
    },
    reportError: (error: unknown) => reported.push(error),
    runMaintenance: async () => {},
    scheduleInterval: () => ({}),
    maintenanceIntervalMs: 30_000,
  }).install();

  installedCreateServer(() => {
    throw new Error("fallback must not run after dispatch failure");
  });
  const guarded = guardedListeners[0];
  assert.ok(guarded);

  const beforeHeaders = new ResponseRecorder();
  guarded({}, beforeHeaders);
  assert.equal(beforeHeaders.status, 503);
  assert.equal(beforeHeaders.body, '{"error":"unavailable"}');
  assert.deepEqual(unavailableResponses, [beforeHeaders]);

  const afterHeaders = new ResponseRecorder();
  afterHeaders.headersSent = true;
  guarded({}, afterHeaders);
  assert.equal(afterHeaders.status, 0);
  assert.match(afterHeaders.destroyedWith?.message || "", /dispatch failed/);
  assert.equal(unavailableResponses.length, 1);
  assert.equal(reported.length, 2);
});

test("runtime does not start maintenance when original createServer throws", () => {
  let maintenanceCalls = 0;
  let scheduleCalls = 0;
  const originalCreateServer: CreateServer = () => {
    throw new Error("server construction failed");
  };
  let installedCreateServer: CreateServer = originalCreateServer;
  new HelperHttpBoundaryRuntime({
    originalCreateServer,
    replaceCreateServer: (createServer: CreateServer) => {
      installedCreateServer = createServer;
    },
    syncBuiltinExports: () => {},
    dispatchRequest: () => false,
    writeUnavailable: () => {},
    reportError: () => {},
    runMaintenance: async () => {
      maintenanceCalls += 1;
    },
    scheduleInterval: () => {
      scheduleCalls += 1;
      return {};
    },
    maintenanceIntervalMs: 30_000,
  }).install();

  assert.throws(() => installedCreateServer(() => {}), /server construction failed/);
  assert.equal(maintenanceCalls, 0);
  assert.equal(scheduleCalls, 0);
});

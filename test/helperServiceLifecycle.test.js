import assert from "node:assert/strict";
import test from "node:test";
import { createHelperServiceLifecycle } from "../mac-helper/src/http/helperServiceLifecycle.js";

test("helper service lifecycle preserves private-helper startup order and scheduling", async () => {
  const harness = createHarness();
  const lifecycle = harness.lifecycle();

  await lifecycle.prepare();
  await lifecycle.prepare();
  assert.deepEqual(harness.events, ["recover", "immediate:scheduled"]);
  assert.equal(harness.immediates.length, 1);

  const requestListener = () => {};
  await lifecycle.start(requestListener);

  assert.strictEqual(harness.requestListener, requestListener);
  assert.deepEqual(harness.events.slice(2), [
    "create-server",
    "listen:127.0.0.1:47217",
    "log:swift-sim-helper listening at http://127.0.0.1:47217",
    "log:Expose simulator sessions privately with: tailscale serve 47217",
    "reconcile",
    "interval:15000",
    "interval:30000",
    "interval:3600000",
    "signal:SIGTERM",
    "signal:SIGINT",
  ]);
  assert.deepEqual(
    harness.intervals.map(({ intervalMs }) => intervalMs),
    [15_000, 30_000, 60 * 60 * 1_000],
  );
  assert.equal(harness.intervals[0].unrefCalls, 0);
  assert.equal(harness.intervals[1].unrefCalls, 1);
  assert.equal(harness.intervals[2].unrefCalls, 0);

  harness.immediates[0]();
  assert.equal(harness.cleanupCalls, 1);
  harness.intervals[0].callback();
  harness.intervals[1].callback();
  await Promise.resolve();
  assert.equal(harness.reconcileCalls, 2);
  assert.equal(harness.cleanupCalls, 2);
  assert.equal(typeof harness.signals.SIGTERM, "function");
  assert.equal(typeof harness.signals.SIGINT, "function");
});

test("device-build-only lifecycle skips installation reconciliation but keeps cleanup", async () => {
  const harness = createHarness({ deviceBuildsOnly: true });
  const lifecycle = harness.lifecycle();
  await lifecycle.prepare();
  await lifecycle.start(() => {});

  assert.equal(harness.reconcileCalls, 0);
  assert.deepEqual(
    harness.intervals.map(({ intervalMs }) => intervalMs),
    [30_000, 60 * 60 * 1_000],
  );
  assert.deepEqual(harness.logs, [
    "swift-sim-helper listening at http://127.0.0.1:47217",
    "Device-build-only gateway ready.",
  ]);
  assert.equal(harness.intervals[0].unrefCalls, 1);
});

test("reconciliation failures are reported without rejecting service startup", async () => {
  const harness = createHarness({
    reconcileRequestedBuilds: async () => {
      throw new Error("inventory unavailable");
    },
  });
  const lifecycle = harness.lifecycle();
  await lifecycle.prepare();
  await lifecycle.start(() => {});
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(harness.errors, [
    "Device installation reconciliation failed: inventory unavailable",
  ]);
});

test("listen failure rejects before timers, signals, or startup logging", async () => {
  const harness = createHarness({ listenError: new Error("address in use") });
  const lifecycle = harness.lifecycle();
  await lifecycle.prepare();

  await assert.rejects(lifecycle.start(() => {}), /address in use/);
  assert.equal(harness.intervals.length, 0);
  assert.deepEqual(harness.signals, {});
  assert.deepEqual(harness.logs, []);
  assert.deepEqual(harness.events.slice(2), ["create-server", "listen:127.0.0.1:47217"]);
});

test("shutdown is idempotent, closes resources once, and exits only after server and work drain", async () => {
  const sessionDrain = deferred();
  const buildDrain = deferred();
  const firstBuild = { id: "build-1" };
  const secondBuild = { id: "build-2" };
  const harness = createHarness({
    activeBuildTasks: () => [
      { build: firstBuild, promise: buildDrain.promise },
      { build: secondBuild, promise: Promise.resolve("done") },
    ],
    sessions: [{ id: "session-1" }],
    stopSession: () => sessionDrain.promise,
  });
  const lifecycle = harness.lifecycle();
  await lifecycle.prepare();
  await lifecycle.start(() => {});

  const liveSocket = harness.connectSocket();
  const closedSocket = harness.connectSocket();
  closedSocket.close();

  harness.signals.SIGTERM();
  harness.signals.SIGINT();

  assert.deepEqual(harness.cancellations, [
    [firstBuild, "Swift Sim helper is shutting down."],
    [secondBuild, "Swift Sim helper is shutting down."],
  ]);
  assert.equal(harness.closeIdleCalls, 1);
  assert.equal(harness.serverCloseCalls, 1);
  assert.deepEqual(
    harness.clearedIntervals.map((timer) => timer.intervalMs),
    [15_000, 30_000, 60 * 60 * 1_000],
  );
  assert.deepEqual(harness.stopSessionCalls, ["session-1"]);
  assert.deepEqual(
    harness.timeouts.map(({ delayMs }) => delayMs),
    [1_000, 8_000],
  );
  assert.deepEqual(
    harness.timeouts.map(({ unrefCalls }) => unrefCalls),
    [1, 1],
  );
  assert.deepEqual(harness.exits, []);
  assert.equal(harness.resourceCloseCalls, 0);

  harness.finishServerClose();
  await Promise.resolve();
  assert.deepEqual(harness.exits, []);
  assert.equal(harness.resourceCloseCalls, 0);

  harness.timeouts[0].callback();
  assert.equal(liveSocket.destroyCalls, 1);
  assert.equal(closedSocket.destroyCalls, 0);
  assert.equal(harness.closeAllCalls, 1);

  sessionDrain.resolve();
  buildDrain.resolve();
  await tick();
  assert.equal(harness.resourceCloseCalls, 1);
  assert.deepEqual(harness.exits, [0]);
});

test("resource-close failure is generic and changes graceful shutdown to nonzero", async () => {
  const harness = createHarness({
    closeResources() {
      throw new Error("private sqlite path");
    },
  });
  const lifecycle = harness.lifecycle();
  await lifecycle.prepare();
  await lifecycle.start(() => {});

  lifecycle.shutdown();
  harness.finishServerClose();
  await tick();

  assert.equal(harness.resourceCloseCalls, 1);
  assert.deepEqual(harness.errors, ["Helper resource close failed."]);
  assert.deepEqual(harness.exits, [1]);
});

test("shutdown force timer preserves nonzero exit when work does not drain", async () => {
  const never = deferred();
  const harness = createHarness({
    activeBuildTasks: () => [{ build: { id: "slow" }, promise: never.promise }],
  });
  const lifecycle = harness.lifecycle();
  await lifecycle.prepare();
  await lifecycle.start(() => {});
  lifecycle.shutdown();
  harness.finishServerClose();
  await Promise.resolve();

  assert.deepEqual(harness.exits, []);
  harness.timeouts.find(({ delayMs }) => delayMs === 8_000).callback();
  assert.deepEqual(harness.exits, [1]);
  assert.equal(harness.resourceCloseCalls, 0);
});

test("lifecycle enforces preparation and one start", async () => {
  const harness = createHarness();
  const lifecycle = harness.lifecycle();

  await assert.rejects(lifecycle.start(() => {}), /must be prepared/);
  await lifecycle.prepare();
  await assert.rejects(lifecycle.start(null), /request listener/);

  const fresh = harness.lifecycle();
  await fresh.prepare();
  await fresh.start(() => {});
  await assert.rejects(fresh.start(() => {}), /already started/);
});

function createHarness({
  deviceBuildsOnly = false,
  listenError = null,
  reconcileRequestedBuilds = null,
  activeBuildTasks = () => [],
  sessions = [],
  stopSession = async () => {},
  closeResources = null,
} = {}) {
  const events = [];
  const logs = [];
  const errors = [];
  const immediates = [];
  const intervals = [];
  const timeouts = [];
  const clearedIntervals = [];
  const signals = {};
  const exits = [];
  const cancellations = [];
  const stopSessionCalls = [];
  let cleanupCalls = 0;
  let reconcileCalls = 0;
  let closeIdleCalls = 0;
  let closeAllCalls = 0;
  let serverCloseCalls = 0;
  let resourceCloseCalls = 0;
  let requestListener;
  let connectionListener;
  let listenErrorListener;
  let serverCloseListener;

  const server = {
    on(event, listener) {
      assert.equal(event, "connection");
      connectionListener = listener;
    },
    once(event, listener) {
      assert.equal(event, "error");
      listenErrorListener = listener;
    },
    off(event, listener) {
      assert.equal(event, "error");
      assert.strictEqual(listener, listenErrorListener);
      listenErrorListener = null;
    },
    listen(port, host, listener) {
      events.push(`listen:${host}:${port}`);
      if (listenError) {
        const errorListener = listenErrorListener;
        listenErrorListener = null;
        errorListener(listenError);
        return;
      }
      listener();
    },
    close(listener) {
      serverCloseCalls += 1;
      serverCloseListener = listener;
    },
    closeIdleConnections() {
      closeIdleCalls += 1;
    },
    closeAllConnections() {
      closeAllCalls += 1;
    },
  };

  const runtime = {
    scheduleImmediate(callback) {
      events.push("immediate:scheduled");
      immediates.push(callback);
      return {};
    },
    scheduleInterval(callback, intervalMs) {
      events.push(`interval:${intervalMs}`);
      const timer = timerHandle({ callback, intervalMs });
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) {
      clearedIntervals.push(timer);
    },
    scheduleTimeout(callback, delayMs) {
      const timer = timerHandle({ callback, delayMs });
      timeouts.push(timer);
      return timer;
    },
    onceSignal(signal, listener) {
      events.push(`signal:${signal}`);
      signals[signal] = listener;
    },
    exit(code) {
      exits.push(code);
    },
  };

  const harness = {
    lifecycle() {
      return createHelperServiceLifecycle({
        createServer(listener) {
          events.push("create-server");
          requestListener = listener;
          return server;
        },
        host: "127.0.0.1",
        port: 47217,
        deviceBuildsOnly,
        async recoverInterruptedBuilds() {
          events.push("recover");
        },
        scheduleDeliveryCleanup() {
          cleanupCalls += 1;
        },
        reconcileRequestedBuilds:
          reconcileRequestedBuilds ||
          (async () => {
            reconcileCalls += 1;
            events.push("reconcile");
          }),
        activeBuildTasks,
        cancelBuild(build, reason) {
          cancellations.push([build, reason]);
        },
        listSessions() {
          return sessions;
        },
        async stopSession(sessionID) {
          stopSessionCalls.push(sessionID);
          return stopSession(sessionID);
        },
        closeResources() {
          resourceCloseCalls += 1;
          return closeResources?.();
        },
        log(message) {
          logs.push(message);
          events.push(`log:${message}`);
        },
        reportError(message) {
          errors.push(message);
        },
        runtime,
      });
    },
    events,
    logs,
    errors,
    immediates,
    intervals,
    timeouts,
    clearedIntervals,
    signals,
    exits,
    cancellations,
    stopSessionCalls,
    get cleanupCalls() {
      return cleanupCalls;
    },
    get reconcileCalls() {
      return reconcileCalls;
    },
    get closeIdleCalls() {
      return closeIdleCalls;
    },
    get closeAllCalls() {
      return closeAllCalls;
    },
    get serverCloseCalls() {
      return serverCloseCalls;
    },
    get resourceCloseCalls() {
      return resourceCloseCalls;
    },
    get requestListener() {
      return requestListener;
    },
    finishServerClose() {
      assert.ok(serverCloseListener);
      const listener = serverCloseListener;
      serverCloseListener = null;
      listener();
    },
    connectSocket() {
      assert.ok(connectionListener);
      const socket = fakeSocket();
      connectionListener(socket);
      return socket;
    },
  };
  return harness;
}

function timerHandle(fields) {
  return {
    ...fields,
    unrefCalls: 0,
    unref() {
      this.unrefCalls += 1;
    },
  };
}

function fakeSocket() {
  let closeListener;
  return {
    destroyCalls: 0,
    once(event, listener) {
      assert.equal(event, "close");
      closeListener = listener;
    },
    destroy() {
      this.destroyCalls += 1;
    },
    close() {
      assert.ok(closeListener);
      const listener = closeListener;
      closeListener = null;
      listener();
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

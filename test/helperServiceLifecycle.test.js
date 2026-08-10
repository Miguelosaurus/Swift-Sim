import assert from "node:assert/strict";
import test from "node:test";
import { createHelperServiceLifecycle } from "../mac-helper/src/http/helperServiceLifecycle.js";

class FakeSocket {
  closeListener;
  destroyCalls = 0;

  once(event, listener) {
    assert.equal(event, "close");
    this.closeListener = listener;
  }

  close() {
    this.closeListener?.();
  }

  destroy() {
    this.destroyCalls += 1;
  }
}

class FakeServer {
  connectionListener;
  errorListener;
  closeListener;
  listenError;
  listenCalls = [];
  offCalls = 0;
  closeCalls = 0;
  closeIdleCalls = 0;
  closeAllCalls = 0;

  on(event, listener) {
    assert.equal(event, "connection");
    this.connectionListener = listener;
  }

  once(event, listener) {
    assert.equal(event, "error");
    this.errorListener = listener;
  }

  off(event, listener) {
    assert.equal(event, "error");
    assert.strictEqual(listener, this.errorListener);
    this.offCalls += 1;
  }

  listen(port, host, listener) {
    this.listenCalls.push([port, host]);
    if (this.listenError) {
      const errorListener = this.errorListener;
      this.errorListener = undefined;
      errorListener?.(this.listenError);
      return;
    }
    listener();
  }

  close(listener) {
    this.closeCalls += 1;
    this.closeListener = listener;
  }

  closeIdleConnections() {
    this.closeIdleCalls += 1;
  }

  closeAllConnections() {
    this.closeAllCalls += 1;
  }

  connect(socket) {
    this.connectionListener?.(socket);
  }

  finishClose() {
    this.closeListener?.();
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function harness(overrides = {}) {
  const intervals = [];
  const cancelledIntervals = [];
  const timeouts = [];
  const signals = new Map();
  const exits = [];
  const cancellations = [];
  const stoppedSessions = [];
  let reconciliationCalls = 0;
  let deliveryCleanupCalls = 0;

  const activeBuildTasks = overrides.activeBuildTasks || [];
  const sessions = overrides.sessions || [];
  const stopSession = overrides.stopSession || (async (sessionID) => {
    stoppedSessions.push(sessionID);
  });

  const lifecycle = createHelperServiceLifecycle({
    scheduleReconciliation: () => {
      reconciliationCalls += 1;
    },
    scheduleDeliveryCleanup: () => {
      deliveryCleanupCalls += 1;
    },
    listActiveBuildTasks: () => activeBuildTasks,
    requestBuildCancellation: (build, reason) => {
      cancellations.push([build, reason]);
    },
    listSessions: () => sessions,
    stopSession,
    registerSignal: (signal, listener) => {
      signals.set(signal, listener);
    },
    exit: (code) => {
      exits.push(code);
    },
    scheduleInterval: (callback, intervalMs) => {
      const timer = {
        callback,
        intervalMs,
        unrefCalls: 0,
        unref() {
          this.unrefCalls += 1;
        },
      };
      intervals.push(timer);
      return timer;
    },
    cancelInterval: (timer) => {
      cancelledIntervals.push(timer);
    },
    scheduleTimeout: (callback, delayMs) => {
      const timer = {
        callback,
        delayMs,
        unrefCalls: 0,
        unref() {
          this.unrefCalls += 1;
        },
      };
      timeouts.push(timer);
      return timer;
    },
    waitForExit: async () => {},
  });

  return {
    lifecycle,
    intervals,
    cancelledIntervals,
    timeouts,
    signals,
    exits,
    cancellations,
    stoppedSessions,
    reconciliationCalls: () => reconciliationCalls,
    deliveryCleanupCalls: () => deliveryCleanupCalls,
  };
}

async function runLifecycle(harnessResult, server, options = {}) {
  const listening = [];
  await harnessResult.lifecycle.run({
    server,
    host: "127.0.0.1",
    port: 47217,
    deviceBuildsOnly: Boolean(options.deviceBuildsOnly),
    onListening: () => listening.push("ready"),
  });
  return listening;
}

test("owns listen, periodic work, signal registration, and delivery timer unref semantics", async () => {
  const result = harness();
  const server = new FakeServer();

  const listening = await runLifecycle(result, server);

  assert.deepEqual(server.listenCalls, [[47217, "127.0.0.1"]]);
  assert.equal(server.offCalls, 1);
  assert.deepEqual(listening, ["ready"]);
  assert.equal(result.reconciliationCalls(), 1);
  assert.deepEqual(result.intervals.map((timer) => timer.intervalMs), [15_000, 30_000, 3_600_000]);
  assert.deepEqual(result.intervals.map((timer) => timer.unrefCalls), [0, 1, 0]);
  assert.deepEqual([...result.signals.keys()], ["SIGTERM", "SIGINT"]);

  result.intervals[0].callback();
  result.intervals[1].callback();
  assert.equal(result.reconciliationCalls(), 2);
  assert.equal(result.deliveryCleanupCalls(), 1);
});

test("device-build-only gateway suppresses installation reconciliation but keeps cleanup and keepalive", async () => {
  const result = harness();
  const server = new FakeServer();

  await runLifecycle(result, server, { deviceBuildsOnly: true });

  assert.equal(result.reconciliationCalls(), 0);
  assert.deepEqual(result.intervals.map((timer) => timer.intervalMs), [30_000, 3_600_000]);
  result.intervals[0].callback();
  assert.equal(result.deliveryCleanupCalls(), 1);
});

test("listen failure rejects before timers, signals, or ready projection are installed", async () => {
  const result = harness();
  const server = new FakeServer();
  server.listenError = new Error("address in use");
  const listening = [];

  await assert.rejects(
    result.lifecycle.run({
      server,
      host: "127.0.0.1",
      port: 47217,
      onListening: () => listening.push("ready"),
    }),
    /address in use/,
  );

  assert.deepEqual(listening, []);
  assert.equal(result.intervals.length, 0);
  assert.equal(result.signals.size, 0);
  assert.equal(result.reconciliationCalls(), 0);
});

test("graceful shutdown is idempotent, drains sessions and build tasks, then exits zero", async () => {
  const firstBuild = deferred();
  const secondBuild = deferred();
  const firstSession = deferred();
  const secondSession = deferred();
  const sessionPromises = new Map([
    ["session-1", firstSession.promise],
    ["session-2", secondSession.promise],
  ]);
  const result = harness({
    activeBuildTasks: [
      { build: { id: "build-1" }, promise: firstBuild.promise },
      { build: { id: "build-2" }, promise: secondBuild.promise },
    ],
    sessions: [{ id: "session-1" }, { id: "session-2" }],
    stopSession: async (sessionID) => {
      result.stoppedSessions.push(sessionID);
      await sessionPromises.get(sessionID);
    },
  });
  const server = new FakeServer();
  await runLifecycle(result, server);
  const closedSocket = new FakeSocket();
  const activeSocket = new FakeSocket();
  server.connect(closedSocket);
  server.connect(activeSocket);
  closedSocket.close();

  result.signals.get("SIGTERM")();
  result.signals.get("SIGINT")();

  assert.equal(server.closeIdleCalls, 1);
  assert.equal(server.closeCalls, 1);
  assert.deepEqual(
    result.cancellations,
    [
      [{ id: "build-1" }, "Swift Sim helper is shutting down."],
      [{ id: "build-2" }, "Swift Sim helper is shutting down."],
    ],
  );
  assert.deepEqual(result.stoppedSessions, ["session-1", "session-2"]);
  assert.equal(result.cancelledIntervals.length, 3);
  assert.deepEqual(result.timeouts.map((timer) => timer.delayMs), [1_000, 8_000]);
  assert.deepEqual(result.timeouts.map((timer) => timer.unrefCalls), [1, 1]);
  assert.deepEqual(result.exits, []);

  result.timeouts[0].callback();
  assert.equal(closedSocket.destroyCalls, 0);
  assert.equal(activeSocket.destroyCalls, 1);
  assert.equal(server.closeAllCalls, 1);

  server.finishClose();
  assert.deepEqual(result.exits, []);
  firstSession.resolve();
  secondSession.resolve();
  firstBuild.resolve();
  secondBuild.resolve();
  await Promise.all([firstSession.promise, secondSession.promise, firstBuild.promise, secondBuild.promise]);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(result.exits, [0]);
});

test("force-exit deadline preserves the existing nonzero shutdown escape hatch", async () => {
  const build = deferred();
  const session = deferred();
  const result = harness({
    activeBuildTasks: [{ build: { id: "build-1" }, promise: build.promise }],
    sessions: [{ id: "session-1" }],
    stopSession: async () => {
      await session.promise;
    },
  });
  const server = new FakeServer();
  await runLifecycle(result, server);

  result.signals.get("SIGTERM")();
  result.timeouts[1].callback();

  assert.deepEqual(result.exits, [1]);
  build.resolve();
  session.resolve();
});

test("rejects duplicate starts instead of registering a second lifecycle", async () => {
  const result = harness();
  const server = new FakeServer();
  await runLifecycle(result, server);

  await assert.rejects(
    result.lifecycle.run({
      server,
      host: "127.0.0.1",
      port: 47217,
      onListening: () => {},
    }),
    /only be started once/,
  );
});

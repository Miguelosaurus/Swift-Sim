import assert from "node:assert/strict";
import test from "node:test";
import { createHelperShutdownCoordinator } from "../mac-helper/src/http/helperShutdownCoordinator.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(overrides = {}) {
  const calls = [];
  const timers = [];
  let closeCallback;
  const buildTask = deferred();
  const sessionTask = deferred();
  const dependencies = {
    clearPeriodicWork: () => calls.push(["clearPeriodicWork"]),
    listBuildTasks: () => [{ build: { id: "build-1" }, promise: buildTask.promise }],
    cancelBuild: (build, message) => calls.push(["cancelBuild", build.id, message]),
    closeIdleConnections: () => calls.push(["closeIdleConnections"]),
    closeServer: (callback) => {
      calls.push(["closeServer"]);
      closeCallback = callback;
    },
    closeAllConnections: () => calls.push(["closeAllConnections"]),
    listSessions: () => [{ id: "session-1" }],
    stopSession: (sessionID) => {
      calls.push(["stopSession", sessionID]);
      return sessionTask.promise;
    },
    exit: (code) => calls.push(["exit", code]),
    setTimeoutFn: (callback, delayMs) => {
      const timer = {
        callback,
        delayMs,
        unrefCalls: 0,
        unref() {
          this.unrefCalls += 1;
        },
      };
      timers.push(timer);
      return timer;
    },
    ...overrides,
  };
  const coordinator = createHelperShutdownCoordinator(dependencies);
  return {
    coordinator,
    calls,
    timers,
    buildTask,
    sessionTask,
    closeServer: () => closeCallback(),
  };
}

function socketRecorder(name) {
  let closeListener;
  return {
    name,
    destroyed: 0,
    once(event, listener) {
      assert.equal(event, "close");
      closeListener = listener;
    },
    destroy() {
      this.destroyed += 1;
    },
    close() {
      closeListener?.();
    },
  };
}

test("tracks sockets and removes closed sockets before forced connection draining", async () => {
  const { coordinator, timers, buildTask, sessionTask } = harness();
  const retained = socketRecorder("retained");
  const closed = socketRecorder("closed");
  coordinator.trackSocket(retained);
  coordinator.trackSocket(closed);
  closed.close();

  coordinator.shutdown();
  timers.find((timer) => timer.delayMs === 1_000).callback();

  assert.equal(retained.destroyed, 1);
  assert.equal(closed.destroyed, 0);
  buildTask.resolve();
  sessionTask.resolve();
  await Promise.resolve();
});

test("shutdown is idempotent and clears periodic work before build cancellation", () => {
  const { coordinator, calls } = harness();
  coordinator.shutdown();
  coordinator.shutdown();

  assert.deepEqual(calls.slice(0, 4), [
    ["clearPeriodicWork"],
    ["cancelBuild", "build-1", "Swift Sim helper is shutting down."],
    ["closeIdleConnections"],
    ["closeServer"],
  ]);
  assert.equal(calls.filter(([name]) => name === "clearPeriodicWork").length, 1);
});

test("snapshots build tasks again after cancellation like the legacy shutdown path", async () => {
  const first = deferred();
  const second = deferred();
  let listCalls = 0;
  const calls = [];
  const { coordinator, closeServer } = harness({
    listBuildTasks: () => {
      listCalls += 1;
      return listCalls === 1
        ? [{ build: { id: "first" }, promise: first.promise }]
        : [{ build: { id: "second" }, promise: second.promise }];
    },
    cancelBuild: (build, message) => calls.push([build.id, message]),
    listSessions: () => [],
    exit: (code) => calls.push(["exit", code]),
  });

  coordinator.shutdown();
  closeServer();
  first.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [["first", "Swift Sim helper is shutting down."]]);

  second.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ["exit", 0]);
});

test("graceful exit waits for both server close and all session/build work", async () => {
  const { coordinator, calls, buildTask, sessionTask, closeServer } = harness();
  coordinator.shutdown();

  closeServer();
  assert.equal(calls.some(([name]) => name === "exit"), false);
  buildTask.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some(([name]) => name === "exit"), false);
  sessionTask.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ["exit", 0]);
});

test("graceful exit also works when work settles before the server closes", async () => {
  const { coordinator, calls, buildTask, sessionTask, closeServer } = harness();
  coordinator.shutdown();

  buildTask.resolve();
  sessionTask.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some(([name]) => name === "exit"), false);
  closeServer();
  assert.deepEqual(calls.at(-1), ["exit", 0]);
});

test("rejected session and build work still counts as settled", async () => {
  const { coordinator, calls, buildTask, sessionTask, closeServer } = harness();
  coordinator.shutdown();
  closeServer();
  buildTask.reject(new Error("build failed"));
  sessionTask.reject(new Error("session failed"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ["exit", 0]);
});

test("the one-second drain timer destroys currently tracked sockets and closes all connections", () => {
  const { coordinator, calls, timers } = harness();
  const first = socketRecorder("first");
  coordinator.trackSocket(first);
  coordinator.shutdown();
  const late = socketRecorder("late");
  coordinator.trackSocket(late);

  timers.find((timer) => timer.delayMs === 1_000).callback();

  assert.equal(first.destroyed, 1);
  assert.equal(late.destroyed, 1);
  assert.equal(calls.filter(([name]) => name === "closeAllConnections").length, 1);
});

test("schedules unrefed one-second drain and eight-second force-exit timers", () => {
  const { coordinator, calls, timers } = harness();
  coordinator.shutdown();

  assert.deepEqual(timers.map(({ delayMs, unrefCalls }) => [delayMs, unrefCalls]), [
    [1_000, 1],
    [8_000, 1],
  ]);
  timers.find((timer) => timer.delayMs === 8_000).callback();
  assert.deepEqual(calls.at(-1), ["exit", 1]);
});

test("an empty session/build snapshot can complete as soon as server close also completes", async () => {
  const { coordinator, calls, closeServer } = harness({
    listBuildTasks: () => [],
    listSessions: () => [],
  });
  coordinator.shutdown();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some(([name]) => name === "exit"), false);
  closeServer();
  assert.deepEqual(calls.at(-1), ["exit", 0]);
});

test("validates every dependency at construction", () => {
  const dependencies = {
    clearPeriodicWork: () => {},
    listBuildTasks: () => [],
    cancelBuild: () => {},
    closeIdleConnections: () => {},
    closeServer: () => {},
    closeAllConnections: () => {},
    listSessions: () => [],
    stopSession: async () => {},
    exit: () => {},
    setTimeoutFn: () => ({}),
  };
  for (const name of Object.keys(dependencies)) {
    assert.throws(
      () => createHelperShutdownCoordinator({ ...dependencies, [name]: undefined }),
      new RegExp(`requires ${name}`),
    );
  }
});

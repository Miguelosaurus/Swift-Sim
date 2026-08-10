import assert from "node:assert/strict";
import test from "node:test";
import { createSessionRuntimeController } from "../mac-helper/src/sessionRuntimeController.js";

const FIXED_NOW = "2026-08-10T21:00:00.000Z";

function session(overrides = {}) {
  return {
    id: "session-1",
    token: "token-1",
    project: "/tmp/Demo.xcodeproj",
    scheme: "Demo",
    simulatorUDID: "SIM-1",
    remoteBaseUrl: "https://old.example",
    createdAt: "2026-08-10T20:00:00.000Z",
    updatedAt: "2026-08-10T20:00:00.000Z",
    build: { state: "external-or-not-run" },
    orientation: "portrait",
    stream: {
      state: "running",
      transport: "serve-sim",
      quality: "high",
      localUrl: "http://127.0.0.1:48000/stream",
      previewUrl: "http://127.0.0.1:48000/stream",
      wsUrl: "ws://127.0.0.1:48000/ws",
      port: 48000,
      raw: {},
      limitations: [],
    },
    logs: [],
    ...overrides,
  };
}

function createStore({ reusable = null, initial = [] } = {}) {
  const records = new Map(initial.map((value) => [value.id, value]));
  const saves = [];
  const creates = [];
  return {
    records,
    saves,
    creates,
    findReusable() {
      return reusable;
    },
    create(input) {
      creates.push(input);
      const value = session({
        id: "session-new",
        token: input.token,
        project: input.project,
        scheme: input.scheme,
        simulatorUDID: input.simulatorUDID,
        remoteBaseUrl: input.remoteBaseUrl,
        stream: {
          state: "starting",
          transport: input.transport,
          quality: "fallback",
          localUrl: "",
          previewUrl: "",
          wsUrl: "",
          raw: {},
          limitations: [],
        },
        logs: [],
      });
      records.set(value.id, value);
      return value;
    },
    save(value) {
      saves.push(structuredClone(value));
      records.set(value.id, value);
      return value;
    },
    get(id) {
      return records.get(id);
    },
  };
}

function controllerHarness({ store = createStore(), nativeStart, serveStart, restart } = {}) {
  const calls = [];
  const uiCalls = [];
  const clock = {
    now: () => new Date(FIXED_NOW),
    monotonicMilliseconds: () => 0,
    async sleep() {},
  };
  const transports = {
    "native-companion": {
      async start(input) {
        calls.push(["native-start", input]);
        if (nativeStart) return nativeStart(input);
        return {
          state: "running",
          transport: "native-companion",
          quality: "native",
          localUrl: "http://native/stream",
          previewUrl: "http://native/stream",
          wsUrl: "ws://native/ws",
          raw: {},
          limitations: [],
        };
      },
      async restart(value) {
        calls.push(["native-restart", value.id]);
        return restart ? restart(value) : value.stream;
      },
      async stop(value) {
        calls.push(["native-stop", value.id]);
      },
    },
    "serve-sim": {
      async start(input) {
        calls.push(["serve-start", input]);
        if (serveStart) return serveStart(input);
        return {
          state: "running",
          transport: "serve-sim",
          quality: "high",
          localUrl: "http://serve/stream",
          previewUrl: "http://serve/stream",
          wsUrl: "ws://serve/ws",
          raw: {},
          limitations: [],
        };
      },
      async restart(value) {
        calls.push(["serve-restart", value.id]);
        return restart
          ? restart(value)
          : {
              state: "running",
              transport: "serve-sim",
              quality: "high",
              localUrl: "http://serve/restarted",
              previewUrl: "http://serve/restarted",
              wsUrl: "ws://serve/restarted",
              raw: {},
              limitations: [],
            };
      },
      async stop(value) {
        calls.push(["serve-stop", value.id]);
      },
    },
  };
  const adapter = {
    async ui(input) {
      uiCalls.push(input);
      return { stdout: "off\n" };
    },
  };
  return {
    store,
    calls,
    uiCalls,
    controller: createSessionRuntimeController({
      store,
      transports,
      adapter,
      defaultTransportPreference: () => "auto",
      idGenerator: { randomUUID: () => "uuid-1", randomToken: (bytes) => `token-${bytes}` },
      clock,
    }),
  };
}

test("validates the explicit session runtime dependency graph", () => {
  assert.throws(() => createSessionRuntimeController({}), /store\.findReusable/);
  const store = createStore();
  assert.throws(
    () =>
      createSessionRuntimeController({
        store,
        transports: {},
        adapter: {},
        defaultTransportPreference: () => "auto",
        idGenerator: { randomUUID: () => "uuid-1", randomToken: () => "token" },
      }),
    /adapter\.ui/,
  );
  assert.throws(
    () => createSessionRuntimeController({ store, transports: {}, adapter: { ui() {} } }),
    /defaultTransportPreference/,
  );
  assert.throws(
    () =>
      createSessionRuntimeController({
        store,
        transports: {},
        adapter: { async ui() {} },
        defaultTransportPreference: () => "auto",
      }),
    /idGenerator\.randomToken/,
  );
  assert.throws(
    () =>
      createSessionRuntimeController({
        store,
        transports: {},
        adapter: { async ui() {} },
        defaultTransportPreference: () => "auto",
        idGenerator: { randomUUID: () => "uuid-1", randomToken: () => "token" },
      }),
    /clock\.now/,
  );
});

test("reuses a compatible running session without restarting transport", async () => {
  const existing = session();
  const store = createStore({ reusable: existing, initial: [existing] });
  const { controller, calls } = controllerHarness({ store });

  const result = await controller.startOrReuseSession({
    project: existing.project,
    scheme: existing.scheme,
    simulator: existing.simulatorUDID,
    transport: "serve-sim",
    "remote-base-url": "https://new.example",
  });

  assert.equal(result.id, existing.id);
  assert.equal(result.stream.transport, "serve-sim");
  assert.equal(existing.remoteBaseUrl, "https://new.example");
  assert.equal(existing.updatedAt, FIXED_NOW);
  assert.deepEqual(calls, []);
  assert.equal(store.saves.length, 1);
});

test("auto transport falls back from native companion to serve-sim and persists the public stream", async () => {
  const store = createStore();
  const { controller, calls } = controllerHarness({
    store,
    nativeStart: async () => {
      throw new Error("native unavailable");
    },
  });

  const result = await controller.startOrReuseSession(
    {
      project: "/tmp/Demo.xcodeproj",
      scheme: "Demo",
      simulator: "SIM-1",
      transport: "auto",
      "remote-base-url": "https://phone.example",
    },
    { includeCodexMetadata: true },
  );

  assert.deepEqual(
    calls.map(([name]) => name),
    ["native-start", "serve-start"],
  );
  assert.equal(store.creates[0].transport, "native-companion");
  assert.equal(store.saves.at(-1).stream.transport, "serve-sim");
  assert.match(store.saves.at(-1).logs.join("\n"), /native companion unavailable/);
  assert.equal(result.codex.simulatorUDID, "SIM-1");
});

test("start failure persists failed state while a post-start save failure stops the transport", async () => {
  const failingStore = createStore();
  const first = controllerHarness({
    store: failingStore,
    serveStart: async () => {
      throw new Error("serve failed");
    },
  });
  await assert.rejects(
    first.controller.startOrReuseSession({ simulator: "SIM-1", transport: "serve-sim" }),
    /serve failed/,
  );
  assert.equal(failingStore.saves.at(-1).stream.state, "failed");

  const saveFailureStore = createStore();
  let saveCalls = 0;
  saveFailureStore.save = (value) => {
    saveCalls += 1;
    if (saveCalls === 1) throw new Error("persist failed");
    return value;
  };
  const second = controllerHarness({ store: saveFailureStore });
  await assert.rejects(
    second.controller.startOrReuseSession({ simulator: "SIM-2", transport: "serve-sim" }),
    /persist failed/,
  );
  assert.deepEqual(
    second.calls.map(([name]) => name),
    ["serve-start", "serve-stop"],
  );
});

test("stop and UI controls mutate session state through the controller", async () => {
  const value = session();
  const store = createStore({ initial: [value] });
  const { controller, calls, uiCalls } = controllerHarness({ store });

  const control = await controller.sendControl(value, "appearance-dark");
  assert.deepEqual(control, { ok: true, control: "appearance-dark" });
  assert.deepEqual(uiCalls, [{ simulatorUDID: "SIM-1", args: ["appearance", "dark"] }]);
  assert.match(store.saves.at(-1).logs.at(-1), /control: appearance-dark/);

  await controller.stopSession(value.id);
  assert.equal(value.stream.state, "stopped");
  assert.equal(value.updatedAt, FIXED_NOW);
  assert.deepEqual(calls.at(-1), ["serve-stop", value.id]);
});

test("stream recovery is single-controller state and preserves response semantics", async () => {
  const value = session({
    stream: {
      state: "running",
      transport: "serve-sim",
      quality: "high",
      localUrl: "http://stream/initial",
      previewUrl: "http://stream/initial",
      wsUrl: "ws://stream/initial",
      raw: {},
      limitations: [],
    },
  });
  const store = createStore({ initial: [value] });
  const { controller, calls } = controllerHarness({ store });
  const initialReader = {
    reads: 0,
    async read() {
      this.reads += 1;
      if (this.reads === 1) return { done: false, value: Uint8Array.of(1) };
      throw new Error("stalled");
    },
    async cancel() {},
  };
  const recoveredReader = {
    async read() {
      return { done: false, value: Uint8Array.of(2) };
    },
    async cancel() {},
  };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    const reader = fetchCalls === 1 ? initialReader : recoveredReader;
    return {
      ok: true,
      status: 200,
      body: { getReader: () => reader },
      headers: { get: () => "application/octet-stream" },
    };
  };
  const writes = [];
  const closeListeners = new Set();
  const res = {
    destroyed: false,
    writableEnded: false,
    socket: { setNoDelay() {} },
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk) {
      writes.push([...chunk]);
      if (writes.length === 2) this.writableEnded = true;
      return true;
    },
    once(event, listener) {
      if (event === "close") closeListeners.add(listener);
    },
    off(event, listener) {
      if (event === "close") closeListeners.delete(listener);
    },
    destroy(error) {
      this.destroyed = true;
      this.error = error;
    },
  };
  try {
    await controller.proxyStream(res, value);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(res.status, 200);
  assert.deepEqual(writes, [[1], [2]]);
  assert.equal(fetchCalls, 2);
  assert.deepEqual(calls.filter(([name]) => name === "serve-restart").length, 1);
  assert.match(value.logs.join("\n"), /stream stalled; recovering tracked simulator/);
  assert.equal(closeListeners.size, 0);
});

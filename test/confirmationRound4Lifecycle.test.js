import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import {
  readSimulatorRuntimeState,
  reserveSimulatorLifecycleClaim,
  simulatorRuntimeStatePath,
} from "../mac-helper/src/simulatorLifecycle.js";
import { ServeSimTransport } from "../mac-helper/src/transports/serveSimTransport.js";

function temporaryDirectory(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function withRuntimeRoots(directory, operation) {
  const runtimePrevious = process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
  const claimPrevious = process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
  process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = join(directory, "runtime");
  process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = join(directory, "claims");
  return Promise.resolve().then(operation).finally(() => {
    if (runtimePrevious === undefined) delete process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = runtimePrevious;
    if (claimPrevious === undefined) delete process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = claimPrevious;
  });
}

function adapterSequence() {
  let starts = 0;
  let kills = 0;
  return {
    get starts() { return starts; },
    get kills() { return kills; },
    async start() {
      starts += 1;
      const port = 9100 + starts;
      return {
        previewUrl: `http://127.0.0.1:${port}/stream`,
        wsUrl: `ws://127.0.0.1:${port}/ws`,
        port,
        pid: 44000 + starts,
        raw: {},
        logs: [],
      };
    },
    async kill() { kills += 1; },
  };
}

function createSession(store, simulatorUDID, suffix = "") {
  return store.create({
    token: `token-${suffix || simulatorUDID}`,
    project: `/tmp/App${suffix}.xcodeproj`,
    scheme: `App${suffix}`,
    simulatorUDID,
    transport: "serve-sim",
  });
}

function target(session) {
  return {
    project: session.project,
    scheme: session.scheme,
    simulatorUDID: session.simulatorUDID,
    transport: "auto",
  };
}

test("a durable start claim recovers a stream when the helper dies before session save", async () => {
  const directory = temporaryDirectory("swift-sim-round4-start-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const store = new SessionStore({ path });
      const session = createSession(store, "SIM-R4-START");
      const claimID = session.stream.raw.swiftSimLifecycleClaimID;
      const adapter = adapterSequence();
      const transport = new ServeSimTransport({ adapter });
      const started = await transport.start({ simulatorUDID: session.simulatorUDID });
      const runtimeNonce = started.raw.swiftSimLifecycleNonce;

      assert.ok(claimID);
      assert.equal(store.get(session.id).stream.state, "starting");
      const restartedStore = new SessionStore({ path });
      const recovered = restartedStore.findReusable(target(session));
      assert.equal(recovered.id, session.id);
      assert.equal(recovered.stream.state, "running");
      assert.equal(recovered.stream.localUrl, started.localUrl);
      assert.equal(recovered.stream.pid, started.pid);
      assert.equal(recovered.stream.raw.swiftSimLifecycleNonce, runtimeNonce);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("restart handoff is promoted before the old session may stop the replacement", async () => {
  const directory = temporaryDirectory("swift-sim-round4-restart-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const store = new SessionStore({ path });
      const session = createSession(store, "SIM-R4-RESTART");
      const adapter = adapterSequence();
      const transport = new ServeSimTransport({ adapter });
      session.stream = await transport.start({ simulatorUDID: session.simulatorUDID });
      store.save(session);
      const oldNonce = session.stream.raw.swiftSimLifecycleNonce;

      const replacement = await transport.restart(session);
      const runtime = readSimulatorRuntimeState(session.simulatorUDID);
      assert.notEqual(runtime.nonce, oldNonce);
      await assert.rejects(
        transport.stop(session),
        (error) => error?.code === "SWIFT_SIM_SIMULATOR_STREAM_SUPERSEDED",
      );
      assert.equal(adapter.kills, 1);

      const recovered = new SessionStore({ path }).findReusable(target(session));
      assert.equal(recovered.stream.raw.swiftSimLifecycleNonce, runtime.nonce);
      assert.equal(recovered.stream.localUrl, replacement.localUrl);
      await transport.stop(recovered);
      assert.equal(adapter.kills, 2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("a stored running session is retired after the runtime durably stopped", async () => {
  const directory = temporaryDirectory("swift-sim-round4-stop-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const store = new SessionStore({ path });
      const session = createSession(store, "SIM-R4-STOP");
      const adapter = adapterSequence();
      const transport = new ServeSimTransport({ adapter });
      session.stream = await transport.start({ simulatorUDID: session.simulatorUDID });
      store.save(session);
      await transport.stop(session);

      const restartedStore = new SessionStore({ path });
      assert.equal(restartedStore.findReusable(target(session)), undefined);
      assert.equal(restartedStore.get(session.id).stream.state, "stopped");
      assert.equal(createSession(restartedStore, session.simulatorUDID, "Replacement").stream.state, "starting");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("a new durable claim reclaims a legacy running runtime with no owner", async () => {
  const directory = temporaryDirectory("swift-sim-round4-orphan-");
  await withRuntimeRoots(directory, async () => {
    try {
      const simulatorUDID = "SIM-R4-ORPHAN";
      const runtimePath = simulatorRuntimeStatePath(simulatorUDID);
      mkdirSync(dirname(runtimePath), { recursive: true });
      writeFileSync(runtimePath, JSON.stringify({
        simulatorUDID,
        nonce: "legacy-unowned-runtime",
        status: "running",
        pid: 44999,
        transport: "serve-sim",
        updatedAt: new Date().toISOString(),
      }));
      const store = new SessionStore({ path: join(directory, "sessions.json") });
      const session = createSession(store, simulatorUDID);
      const adapter = adapterSequence();
      const started = await new ServeSimTransport({ adapter }).start({ simulatorUDID });
      assert.equal(adapter.kills, 1);
      assert.equal(adapter.starts, 1);
      assert.ok(started.raw.swiftSimLifecycleNonce);
      assert.notEqual(readSimulatorRuntimeState(simulatorUDID).nonce, "legacy-unowned-runtime");
      assert.equal(store.get(session.id).stream.state, "starting");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("an unreadable session store never authorizes orphan-runtime cleanup", async () => {
  const directory = temporaryDirectory("swift-sim-round4-unreadable-");
  await withRuntimeRoots(directory, async () => {
    try {
      const simulatorUDID = "SIM-R4-UNREADABLE";
      const runtimePath = simulatorRuntimeStatePath(simulatorUDID);
      mkdirSync(dirname(runtimePath), { recursive: true });
      writeFileSync(runtimePath, JSON.stringify({
        simulatorUDID,
        nonce: "possibly-owned-runtime",
        status: "running",
        pid: 44998,
        transport: "serve-sim",
        updatedAt: new Date().toISOString(),
      }));
      const storePath = join(directory, "sessions.json");
      writeFileSync(storePath, "{malformed");
      new SessionStore({ path: storePath });
      const claimSession = {
        id: "claim-session",
        simulatorUDID,
        stream: {
          state: "starting",
          raw: { swiftSimLifecycleClaimID: "claim-unreadable" },
        },
      };
      reserveSimulatorLifecycleClaim(claimSession, { storeID: storePath });
      const adapter = adapterSequence();
      await assert.rejects(
        new ServeSimTransport({ adapter }).start({ simulatorUDID }),
        (error) => error?.code === "SWIFT_SIM_SIMULATOR_RUNTIME_ACTIVE",
      );
      assert.equal(adapter.kills, 0);
      assert.equal(readFileSync(storePath, "utf8"), "{malformed");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("claim stream projections contain no session bearer token", async () => {
  const directory = temporaryDirectory("swift-sim-round4-projection-");
  await withRuntimeRoots(directory, async () => {
    try {
      const store = new SessionStore({ path: join(directory, "sessions.json") });
      const session = createSession(store, "SIM-R4-PROJECTION");
      await new ServeSimTransport({ adapter: adapterSequence() })
        .start({ simulatorUDID: session.simulatorUDID });
      const claimFiles = findJSONFiles(join(directory, "claims"));
      assert.equal(claimFiles.length, 1);
      const serialized = readFileSync(claimFiles[0], "utf8");
      const claim = JSON.parse(serialized);
      assert.equal(serialized.includes(session.token), false);
      assert.deepEqual(Object.keys(claim.projection).sort(), [
        "limitations", "localUrl", "pid", "port", "previewUrl",
        "quality", "state", "transport", "wsUrl",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function findJSONFiles(root) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return findJSONFiles(path);
    return entry.name.endsWith(".json") ? [path] : [];
  });
}

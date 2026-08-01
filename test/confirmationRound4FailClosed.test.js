import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import { simulatorRuntimeStatePath } from "../mac-helper/src/simulatorLifecycle.js";
import { ServeSimTransport } from "../mac-helper/src/transports/serveSimTransport.js";

function temporaryDirectory(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function withRuntimeRoots(directory, operation) {
  const runtimePrevious = process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
  const claimPrevious = process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
  process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = join(directory, "runtime");
  process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = join(directory, "claims");
  try {
    return await operation();
  } finally {
    if (runtimePrevious === undefined) delete process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = runtimePrevious;
    if (claimPrevious === undefined) delete process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = claimPrevious;
  }
}

function target(session) {
  return {
    project: session.project,
    scheme: session.scheme,
    simulatorUDID: session.simulatorUDID,
    transport: "auto",
  };
}

function adapter() {
  return {
    async start() {
      return {
        previewUrl: "http://127.0.0.1:9191/stream",
        wsUrl: "ws://127.0.0.1:9191/ws",
        port: 9191,
        pid: 45919,
        raw: {},
        logs: [],
      };
    },
    async kill() {},
  };
}

function createSession(store, simulatorUDID) {
  return store.create({
    token: "private-session-token",
    project: "/tmp/ExactOwner.xcodeproj",
    scheme: "ExactOwner",
    simulatorUDID,
    transport: "serve-sim",
  });
}

test("exact-owner reuse preserves the complete persisted stream after claim cleanup", async () => {
  const directory = temporaryDirectory("swift-sim-round4-exact-owner-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const store = new SessionStore({ path });
      const session = createSession(store, "SIM-R4-EXACT-OWNER");
      session.stream = await new ServeSimTransport({ adapter: adapter() })
        .start({ simulatorUDID: session.simulatorUDID });
      store.save(session);

      const first = new SessionStore({ path }).findReusable(target(session));
      assert.equal(first.stream.localUrl, "http://127.0.0.1:9191/stream");
      assert.equal(first.stream.wsUrl, "ws://127.0.0.1:9191/ws");

      const second = new SessionStore({ path }).findReusable(target(session));
      assert.equal(second.stream.localUrl, "http://127.0.0.1:9191/stream");
      assert.equal(second.stream.wsUrl, "ws://127.0.0.1:9191/ws");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("missing nonce-owned runtime state fails closed instead of authorizing replacement", async () => {
  const directory = temporaryDirectory("swift-sim-round4-missing-runtime-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const store = new SessionStore({ path });
      const session = createSession(store, "SIM-R4-MISSING-RUNTIME");
      session.stream = await new ServeSimTransport({ adapter: adapter() })
        .start({ simulatorUDID: session.simulatorUDID });
      store.save(session);
      rmSync(simulatorRuntimeStatePath(session.simulatorUDID), { force: true });

      const restartedStore = new SessionStore({ path });
      assert.equal(restartedStore.findReusable(target(session)), undefined);
      assert.equal(restartedStore.get(session.id).stream.state, "running");
      assert.throws(
        () => createSession(restartedStore, session.simulatorUDID),
        /already starting/i,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

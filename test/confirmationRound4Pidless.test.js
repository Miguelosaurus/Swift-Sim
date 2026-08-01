import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import {
  readSimulatorRuntimeState,
  startSimulatorRuntime,
} from "../mac-helper/src/simulatorLifecycle.js";

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

test("a PID-less stream is recovered through its durable runtime claim identity", async () => {
  const directory = temporaryDirectory("swift-sim-round4-pidless-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const store = new SessionStore({ path });
      const session = store.create({
        token: "private-token",
        project: "/tmp/Pidless.xcodeproj",
        scheme: "Pidless",
        simulatorUDID: "SIM-R4-PIDLESS",
        transport: "serve-sim",
      });
      const claimID = session.stream.raw.swiftSimLifecycleClaimID;

      const stream = await startSimulatorRuntime({
        simulatorUDID: session.simulatorUDID,
        recover: async () => {},
        operation: async () => ({
          state: "running",
          transport: "serve-sim",
          quality: "fallback",
          localUrl: "http://127.0.0.1:9292/stream",
          previewUrl: "http://127.0.0.1:9292/stream",
          wsUrl: "ws://127.0.0.1:9292/ws",
          port: 9292,
          pid: undefined,
          raw: {},
          limitations: [],
        }),
      });

      assert.equal(stream.transport, "serve-sim");
      assert.equal(stream.pid, undefined);
      assert.equal(stream.raw.swiftSimLifecycleClaimID, claimID);
      const runtime = readSimulatorRuntimeState(session.simulatorUDID);
      assert.equal(runtime.transport, "serve-sim");
      assert.equal(runtime.claimID, claimID);
      assert.equal(runtime.pid, undefined);

      const recovered = new SessionStore({ path }).findReusable({
        project: session.project,
        scheme: session.scheme,
        simulatorUDID: session.simulatorUDID,
        transport: "auto",
      });
      assert.equal(recovered.id, session.id);
      assert.equal(recovered.stream.localUrl, stream.localUrl);
      assert.equal(recovered.stream.pid, undefined);
      assert.equal(recovered.stream.raw.swiftSimLifecycleNonce, runtime.nonce);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

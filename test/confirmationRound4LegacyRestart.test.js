import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import { readSimulatorRuntimeState } from "../mac-helper/src/simulatorLifecycle.js";
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

test("a nonce-less upgraded session recovers its replacement through the restart claim", async () => {
  const directory = temporaryDirectory("swift-sim-round4-legacy-restart-");
  await withRuntimeRoots(directory, async () => {
    try {
      let starts = 0;
      const adapter = {
        async start() {
          starts += 1;
          const port = 9300 + starts;
          return {
            previewUrl: `http://127.0.0.1:${port}/stream`,
            wsUrl: `ws://127.0.0.1:${port}/ws`,
            port,
            pid: 46300 + starts,
            raw: {},
            logs: [],
          };
        },
        async kill() {},
      };
      const transport = new ServeSimTransport({ adapter });
      const simulatorUDID = "SIM-R4-LEGACY-RESTART";
      const initial = await transport.start({ simulatorUDID });

      const path = join(directory, "sessions.json");
      const store = new SessionStore({ path });
      const session = store.create({
        token: "private-token",
        project: "/tmp/LegacyRestart.xcodeproj",
        scheme: "LegacyRestart",
        simulatorUDID,
        transport: "serve-sim",
      });
      session.stream = {
        ...initial,
        raw: {},
      };
      store.save(session);

      const replacement = await transport.restart(session);
      const runtime = readSimulatorRuntimeState(simulatorUDID);
      assert.equal(runtime.status, "running");
      assert.ok(runtime.claimID);
      assert.notEqual(runtime.pid, initial.pid);

      const recovered = new SessionStore({ path }).findReusable({
        project: session.project,
        scheme: session.scheme,
        simulatorUDID,
        transport: "auto",
      });
      assert.equal(recovered.id, session.id);
      assert.equal(recovered.stream.localUrl, replacement.localUrl);
      assert.equal(recovered.stream.pid, replacement.pid);
      assert.equal(recovered.stream.raw.swiftSimLifecycleNonce, runtime.nonce);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServeSimTransport } from "../mac-helper/src/transports/serveSimTransport.js";

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test("an upgraded nonce-less session cannot recover after a concurrent stop", async () => {
  const rootPath = mkdtempSync(join(tmpdir(), "swift-sim-legacy-runtime-"));
  const previousRoot = process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
  process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = rootPath;
  const stopEntered = deferred();
  const releaseStop = deferred();
  let starts = 0;
  let kills = 0;
  const adapter = {
    async start() {
      starts += 1;
      return {
        previewUrl: "http://127.0.0.1:9010/stream",
        wsUrl: "ws://127.0.0.1:9010/ws",
        port: 9010,
        pid: 43220,
        raw: {},
        logs: [],
      };
    },
    async kill() {
      kills += 1;
      stopEntered.resolve();
      await releaseStop.promise;
    },
  };
  try {
    const transport = new ServeSimTransport({ adapter });
    const stream = await transport.start({ simulatorUDID: "SIM-LEGACY" });
    const session = { simulatorUDID: "SIM-LEGACY", stream: structuredClone(stream) };
    delete session.stream.raw.swiftSimLifecycleNonce;

    const stopping = transport.stop(session);
    await stopEntered.promise;
    const recovering = transport.restart(session);
    releaseStop.resolve();
    await stopping;
    await assert.rejects(
      recovering,
      (error) => error?.code === "SWIFT_SIM_SIMULATOR_STREAM_SUPERSEDED",
    );
    assert.equal(starts, 1);
    assert.equal(kills, 1);
  } finally {
    if (previousRoot === undefined) delete process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = previousRoot;
    rmSync(rootPath, { recursive: true, force: true });
  }
});

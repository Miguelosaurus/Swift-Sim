import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  readSimulatorRuntimeState,
  simulatorRuntimeStatePath,
} from "../mac-helper/src/simulatorLifecycle.js";
import { ServeSimTransport } from "../mac-helper/src/transports/serveSimTransport.js";

function withRuntimeRoot(run) {
  const rootPath = mkdtempSync(join(tmpdir(), "swift-sim-runtime-owner-"));
  const previousRoot = process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
  process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = rootPath;
  return Promise.resolve()
    .then(() => run(rootPath))
    .finally(() => {
      if (previousRoot === undefined) delete process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
      else process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = previousRoot;
      rmSync(rootPath, { recursive: true, force: true });
    });
}

test("a second start cannot replace an active Simulator runtime", async () => withRuntimeRoot(async () => {
  let starts = 0;
  const transport = new ServeSimTransport({
    adapter: {
      async start() {
        starts += 1;
        return {
          previewUrl: `http://127.0.0.1:${9100 + starts}/stream`,
          wsUrl: `ws://127.0.0.1:${9100 + starts}/ws`,
          port: 9100 + starts,
          pid: 44000 + starts,
          raw: {},
          logs: [],
        };
      },
      async kill() {},
    },
  });

  const first = await transport.start({ simulatorUDID: "SIM-ACTIVE" });
  const firstNonce = first.raw.swiftSimLifecycleNonce;
  await assert.rejects(
    transport.start({ simulatorUDID: "SIM-ACTIVE" }),
    (error) => error?.code === "SWIFT_SIM_SIMULATOR_RUNTIME_ACTIVE",
  );

  assert.equal(starts, 1);
  assert.equal(readSimulatorRuntimeState("SIM-ACTIVE").nonce, firstNonce);
  assert.equal(readSimulatorRuntimeState("SIM-ACTIVE").status, "running");
}));

test("a stale session cannot stop a newer Simulator runtime", async () => withRuntimeRoot(async () => {
  let starts = 0;
  let kills = 0;
  const transport = new ServeSimTransport({
    adapter: {
      async start() {
        starts += 1;
        return {
          previewUrl: `http://127.0.0.1:${9200 + starts}/stream`,
          wsUrl: `ws://127.0.0.1:${9200 + starts}/ws`,
          port: 9200 + starts,
          pid: 45000 + starts,
          raw: {},
          logs: [],
        };
      },
      async kill() {
        kills += 1;
      },
    },
  });

  const firstStream = await transport.start({ simulatorUDID: "SIM-STALE-STOP" });
  const firstSession = { simulatorUDID: "SIM-STALE-STOP", stream: firstStream };
  await transport.stop(firstSession);

  const secondStream = await transport.start({ simulatorUDID: "SIM-STALE-STOP" });
  const secondNonce = secondStream.raw.swiftSimLifecycleNonce;
  await assert.rejects(
    transport.stop(firstSession),
    (error) => error?.code === "SWIFT_SIM_SIMULATOR_STREAM_SUPERSEDED",
  );

  assert.equal(starts, 2);
  assert.equal(kills, 1);
  assert.equal(readSimulatorRuntimeState("SIM-STALE-STOP").nonce, secondNonce);
  assert.equal(readSimulatorRuntimeState("SIM-STALE-STOP").status, "running");
}));

test("a fresh start cleans up stale non-running lifecycle state before relaunch", async () => withRuntimeRoot(async (rootPath) => {
  const simulatorUDID = "SIM-STALE-OPERATION";
  const statePath = simulatorRuntimeStatePath(simulatorUDID, { rootPath });
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    simulatorUDID,
    nonce: "abandoned-operation",
    status: "starting",
    previousNonce: "",
    updatedAt: new Date().toISOString(),
  }));

  let starts = 0;
  let kills = 0;
  const transport = new ServeSimTransport({
    adapter: {
      async kill(udid) {
        assert.equal(udid, simulatorUDID);
        kills += 1;
      },
      async start() {
        starts += 1;
        return {
          previewUrl: "http://127.0.0.1:9301/stream",
          wsUrl: "ws://127.0.0.1:9301/ws",
          port: 9301,
          pid: 46001,
          raw: {},
          logs: [],
        };
      },
    },
  });

  const stream = await transport.start({ simulatorUDID });
  assert.equal(kills, 1);
  assert.equal(starts, 1);
  assert.equal(readSimulatorRuntimeState(simulatorUDID).status, "running");
  assert.equal(readSimulatorRuntimeState(simulatorUDID).nonce, stream.raw.swiftSimLifecycleNonce);
}));

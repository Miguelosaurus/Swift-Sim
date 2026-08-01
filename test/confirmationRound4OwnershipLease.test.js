import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import * as lifecycleBase from "../mac-helper/src/simulatorLifecycleBase.js";
import { startSimulatorRuntime } from "../mac-helper/src/simulatorLifecycle.js";

function stream(pid, port) {
  return {
    state: "running",
    transport: "serve-sim",
    quality: "fallback",
    localUrl: `http://127.0.0.1:${port}/stream`,
    previewUrl: `http://127.0.0.1:${port}/stream`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    port,
    pid,
    raw: {},
    limitations: [],
  };
}

test("orphan recovery holds both Simulator and session ownership locks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round4-owner-lease-"));
  const runtimeRoot = join(directory, "runtime");
  const claimRoot = join(directory, "claims");
  const storePath = join(directory, "sessions.json");
  const simulatorUDID = "SIM-R4-OWNER-LEASE";
  const previousRuntimeRoot = process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
  const previousClaimRoot = process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
  process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = runtimeRoot;
  process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = claimRoot;
  try {
    await lifecycleBase.startSimulatorRuntime({
      simulatorUDID,
      rootPath: runtimeRoot,
      operation: async () => stream(48201, 9521),
    });

    const store = new SessionStore({ path: storePath });
    store.create({
      token: "owner-lease-token",
      project: "/tmp/OwnerLease.xcodeproj",
      scheme: "OwnerLease",
      simulatorUDID,
      transport: "serve-sim",
    });

    let recoveries = 0;
    await startSimulatorRuntime({
      simulatorUDID,
      rootPath: runtimeRoot,
      recover: async () => {
        recoveries += 1;
        assert.equal(existsSync(`${storePath}.lock`), true);
        assert.equal(lifecycleBase.simulatorLifecycleIsActive(simulatorUDID, { rootPath: runtimeRoot }), true);
      },
      operation: async () => stream(48202, 9522),
    });

    assert.equal(recoveries, 1);
    assert.equal(existsSync(`${storePath}.lock`), false);
    assert.equal(lifecycleBase.simulatorLifecycleIsActive(simulatorUDID, { rootPath: runtimeRoot }), false);
  } finally {
    if (previousRuntimeRoot === undefined) delete process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = previousRuntimeRoot;
    if (previousClaimRoot === undefined) delete process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = previousClaimRoot;
    rmSync(directory, { recursive: true, force: true });
  }
});

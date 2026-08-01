import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as lifecycle from "../mac-helper/src/simulatorLifecycleBase.js";

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

test("active runtime authorization and recovery share one Simulator lifecycle lock", async () => {
  const rootPath = mkdtempSync(join(tmpdir(), "swift-sim-round4-atomic-auth-"));
  const simulatorUDID = "SIM-R4-ATOMIC-AUTH";
  try {
    const first = await lifecycle.startSimulatorRuntime({
      simulatorUDID,
      rootPath,
      operation: async () => stream(48101, 9511),
    });
    const firstNonce = first.raw.swiftSimLifecycleNonce;
    let deniedAuthorizations = 0;
    let deniedRecoveries = 0;
    let deniedStarts = 0;

    await assert.rejects(
      lifecycle.startSimulatorRuntime({
        simulatorUDID,
        rootPath,
        authorizeRunningRecovery: async (runtime) => {
          deniedAuthorizations += 1;
          assert.equal(runtime.nonce, firstNonce);
          assert.equal(lifecycle.simulatorLifecycleIsActive(simulatorUDID, { rootPath }), true);
          return false;
        },
        recover: async () => { deniedRecoveries += 1; },
        operation: async () => {
          deniedStarts += 1;
          return stream(48102, 9512);
        },
      }),
      (error) => error?.code === "SWIFT_SIM_SIMULATOR_RUNTIME_ACTIVE",
    );

    assert.equal(deniedAuthorizations, 1);
    assert.equal(deniedRecoveries, 0);
    assert.equal(deniedStarts, 0);
    assert.equal(lifecycle.readSimulatorRuntimeState(simulatorUDID, { rootPath }).nonce, firstNonce);

    let allowedAuthorizations = 0;
    let allowedRecoveries = 0;
    const replacement = await lifecycle.startSimulatorRuntime({
      simulatorUDID,
      rootPath,
      authorizeRunningRecovery: async (runtime) => {
        allowedAuthorizations += 1;
        assert.equal(runtime.nonce, firstNonce);
        assert.equal(lifecycle.simulatorLifecycleIsActive(simulatorUDID, { rootPath }), true);
        return true;
      },
      recover: async () => { allowedRecoveries += 1; },
      operation: async () => stream(48103, 9513),
    });

    assert.equal(allowedAuthorizations, 1);
    assert.equal(allowedRecoveries, 1);
    assert.notEqual(replacement.raw.swiftSimLifecycleNonce, firstNonce);
    assert.equal(
      lifecycle.readSimulatorRuntimeState(simulatorUDID, { rootPath }).nonce,
      replacement.raw.swiftSimLifecycleNonce,
    );
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

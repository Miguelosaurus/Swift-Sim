import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  simulatorRuntimeStatePath,
  simulatorSessionIsReusable,
  stopSimulatorRuntime,
} from "../mac-helper/src/simulatorLifecycle.js";

function temporaryRuntimeRoot() {
  return mkdtempSync(join(tmpdir(), "swift-sim-runtime-malformed-"));
}

test("malformed Simulator runtime state is non-reusable and cannot authorize a kill", async () => {
  const rootPath = temporaryRuntimeRoot();
  const simulatorUDID = "SIM-MALFORMED";
  const statePath = simulatorRuntimeStatePath(simulatorUDID, { rootPath });
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, "{malformed");
  const session = {
    simulatorUDID,
    stream: {
      state: "running",
      pid: 46001,
      raw: { swiftSimLifecycleNonce: "old-nonce" },
    },
  };
  let killed = false;
  try {
    assert.equal(simulatorSessionIsReusable(session, { rootPath }), false);
    await assert.rejects(
      stopSimulatorRuntime({
        session,
        rootPath,
        operation: async () => { killed = true; },
      }),
      (error) => error?.code === "SWIFT_SIM_SIMULATOR_RUNTIME_STATE_INVALID",
    );
    assert.equal(killed, false);
    assert.equal(readFileSync(statePath, "utf8"), "{malformed");
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("delivery manager durably publishes each child identity before waiting for readiness", () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(testDirectory, "..", "mac-helper", "bin", "swift-sim-device-delivery.js"), "utf8");

  const gatewayIdentity = source.indexOf("gatewayIdentity = processIdentity");
  const gatewayPublication = source.indexOf("writeState({ status: \"starting\"", gatewayIdentity);
  const gatewayHealth = source.indexOf("await waitForHealth", gatewayIdentity);
  assert.ok(gatewayIdentity >= 0 && gatewayPublication > gatewayIdentity && gatewayPublication < gatewayHealth);

  const tunnelIdentity = source.indexOf("tunnelIdentity = processIdentity");
  const tunnelPublication = source.indexOf("writeState({ status: \"starting\"", tunnelIdentity);
  const tunnelCapture = source.indexOf("const capture =", tunnelIdentity);
  assert.ok(tunnelIdentity >= 0 && tunnelPublication > tunnelIdentity && tunnelPublication < tunnelCapture);
});

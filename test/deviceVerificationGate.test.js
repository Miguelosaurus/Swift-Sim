import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimDeviceVerification } from "../mac-helper/src/deviceVerificationGate.js";

test("verification gate enforces a cross-process-style persisted cadence", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-verification-gate-"));
  const path = join(directory, "build.json");
  try {
    const build = { id: "build-1" };
    assert.equal(claimDeviceVerification(build, { path, now: 1_000_000, minimumIntervalMs: 15_000 }), true);
    assert.equal(claimDeviceVerification(build, { path, now: 1_005_000, minimumIntervalMs: 15_000 }), false);
    assert.equal(claimDeviceVerification(build, { path, now: 1_015_001, minimumIntervalMs: 15_000 }), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

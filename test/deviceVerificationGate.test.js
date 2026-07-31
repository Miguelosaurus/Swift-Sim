import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimDeviceVerification } from "../mac-helper/src/deviceVerificationGate.js";

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return String(result.stdout || "").trim();
}

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

test("a live cross-process verification claim prevents duplicate work", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-verification-claim-"));
  const path = join(directory, "build.json");
  const lockPath = `${path}.lock`;
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
      nonce: "live",
      createdAt: new Date().toISOString(),
    }));
    assert.equal(claimDeviceVerification({ id: "build-1" }, { path }), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

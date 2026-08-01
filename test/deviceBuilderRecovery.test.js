import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { terminateRecordedDeviceBuildWorker } from "../mac-helper/src/deviceBuilder.js";

test("recovery accepts an absent journal because the owned worker was never released", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-recovery-no-journal-"));
  try {
    const build = {
      id: "delivery-crash",
      control: { cancelPath: join(directory, ".cancelled") },
    };
    assert.equal(await terminateRecordedDeviceBuildWorker(build), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recovery still fails closed for an existing incomplete journal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-recovery-bad-journal-"));
  try {
    const cancelPath = join(directory, "build", ".cancelled");
    mkdirSync(dirname(cancelPath), { recursive: true });
    writeFileSync(`${cancelPath}.worker.json`, JSON.stringify({ pid: 123 }));
    await assert.rejects(
      terminateRecordedDeviceBuildWorker({ id: "bad-journal", control: { cancelPath } }),
      (error) => error?.code === "SWIFT_SIM_UNSAFE_BUILD_RECOVERY"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a reused worker pid is cleared by start identity before command inspection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-recovery-reused-pid-"));
  try {
    const cancelPath = join(directory, "build", ".cancelled");
    const workerPath = `${cancelPath}.worker.json`;
    mkdirSync(dirname(cancelPath), { recursive: true });
    writeFileSync(workerPath, JSON.stringify({
      pid: process.pid,
      startedAt: "Mon Jan  1 00:00:00 1990",
      command: "xcodebuild",
    }));
    assert.equal(await terminateRecordedDeviceBuildWorker({
      id: "reused-pid",
      control: { cancelPath },
    }), true);
    assert.equal(existsSync(workerPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

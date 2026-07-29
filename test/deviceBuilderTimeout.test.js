import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBuffered } from "../mac-helper/src/deviceBuilderCore.js";

test("a timed out build waits for the complete process group to exit", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-timeout-test-"));
  const pidPath = join(directory, "descendant.pid");
  try {
    const fixture = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      writeFileSync(${JSON.stringify(pidPath)}, String(descendant.pid));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    `;
    const startedAt = Date.now();
    const result = await runBuffered(process.execPath, ["-e", fixture], { timeoutMs: 100 });
    const elapsed = Date.now() - startedAt;
    assert.match(result.error, /timed out/);
    assert.ok(elapsed >= 2_000, `expected SIGKILL escalation, completed in ${elapsed}ms`);
    assert.ok(elapsed < 7_000, `timeout fencing took too long: ${elapsed}ms`);
    const descendantPID = Number(readFileSync(pidPath, "utf8"));
    assert.equal(processIsAlive(descendantPID), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const status = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  if (status.status !== 0) return false;
  return !String(status.stdout || "").trim().startsWith("Z");
}


test("a cancellation marker terminates the complete process group", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-cancel-test-"));
  const pidPath = join(directory, "descendant.pid");
  const cancelPath = join(directory, ".cancelled");
  try {
    const fixture = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      writeFileSync(${JSON.stringify(pidPath)}, String(descendant.pid));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    `;
    const cancellation = setTimeout(() => writeFileSync(cancelPath, "cancel"), 100);
    const result = await runBuffered(process.execPath, ["-e", fixture], {
      timeoutMs: 8_000,
      cancelPath,
    });
    clearTimeout(cancellation);
    assert.equal(result.cancellationError?.code, "SWIFT_SIM_BUILD_CANCELLED");
    const descendantPID = Number(readFileSync(pidPath, "utf8"));
    assert.equal(processIsAlive(descendantPID), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an output callback failure terminates the detached process group", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-callback-failure-test-"));
  const pidPath = join(directory, "callback-descendant.pid");
  try {
    const fixture = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      writeFileSync(${JSON.stringify(pidPath)}, String(descendant.pid));
      console.log("trigger");
      setInterval(() => {}, 1000);
    `;
    const result = await runBuffered(process.execPath, ["-e", fixture], {
      timeoutMs: 8_000,
      onLine: () => { throw new Error("state write failed"); },
    });
    assert.match(result.error, /Output handler failed: state write failed/);
    const descendantPID = Number(readFileSync(pidPath, "utf8"));
    assert.equal(processIsAlive(descendantPID), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

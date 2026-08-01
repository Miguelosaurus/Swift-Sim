import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseBuildSettings,
  runBuffered,
  terminateRecordedDeviceBuildWorker,
} from "../mac-helper/src/deviceBuilderCore.js";

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


test("multi-target settings select the scheme application instead of an extension", () => {
  const settings = parseBuildSettings(`
Build settings for action build and target Example:
    TARGET_NAME = Example
    PRODUCT_NAME = Example
    PRODUCT_TYPE = com.apple.product-type.application
    WRAPPER_EXTENSION = app
    PRODUCT_BUNDLE_IDENTIFIER = com.example.app
    DEVELOPMENT_TEAM = TEAMAPP

Build settings for action build and target ExampleWidget:
    TARGET_NAME = ExampleWidget
    PRODUCT_NAME = ExampleWidget
    PRODUCT_TYPE = com.apple.product-type.app-extension
    WRAPPER_EXTENSION = appex
    PRODUCT_BUNDLE_IDENTIFIER = com.example.app.widget
    DEVELOPMENT_TEAM = TEAMEXT
`, "Example");
  assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, "com.example.app");
  assert.equal(settings.DEVELOPMENT_TEAM, "TEAMAPP");
});

test("a differently named multi-app scheme selects its host application", () => {
  const settings = parseBuildSettings(`
Build settings for action build and target ExampleHost:
    TARGET_NAME = ExampleHost
    PRODUCT_NAME = ExampleHost
    PRODUCT_TYPE = com.apple.product-type.application
    WRAPPER_EXTENSION = app
    SKIP_INSTALL = NO
    SUPPORTED_PLATFORMS = iphoneos iphonesimulator
    PRODUCT_BUNDLE_IDENTIFIER = com.example.host
    DEVELOPMENT_TEAM = TEAMHOST

Build settings for action build and target ExampleClip:
    TARGET_NAME = ExampleClip
    PRODUCT_NAME = ExampleClip
    PRODUCT_TYPE = com.apple.product-type.application.on-demand-install-capable
    WRAPPER_EXTENSION = app
    SKIP_INSTALL = NO
    SUPPORTED_PLATFORMS = iphoneos iphonesimulator
    PRODUCT_BUNDLE_IDENTIFIER = com.example.host.Clip
    DEVELOPMENT_TEAM = TEAMCLIP
`, "Production");
  assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, "com.example.host");
  assert.equal(settings.DEVELOPMENT_TEAM, "TEAMHOST");
});

test("buffered process output preserves UTF-8 split across chunks", async () => {
  const lines = [];
  const fixture = `
    const value = Buffer.from("Café 🚀\\n");
    const rocket = value.indexOf(Buffer.from("🚀"));
    process.stdout.write(value.subarray(0, rocket + 1));
    setTimeout(() => process.stdout.write(value.subarray(rocket + 1)), 25);
  `;
  const result = await runBuffered(process.execPath, ["-e", fixture], {
    onLine: (line) => lines.push(line),
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "Café 🚀\n");
  assert.deepEqual(lines, ["Café 🚀"]);
});

test("a persisted interrupted worker identity can be terminated after restart", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-worker-recovery-"));
  const cancelPath = join(directory, ".cancelled");
  const workerPath = `${cancelPath}.worker.json`;
  const child = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  try {
    const identity = spawnSync("/bin/ps", ["-p", String(child.pid), "-o", "lstart="], { encoding: "utf8" });
    writeFileSync(workerPath, JSON.stringify({
      pid: child.pid,
      startedAt: String(identity.stdout || "").trim(),
    }));
    const terminated = await terminateRecordedDeviceBuildWorker({
      id: "build-id",
      control: { cancelPath },
    });
    assert.equal(terminated, true);
    assert.equal(processIsAlive(child.pid), false);
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});


test("a successful buffered command rejects surviving descendants", {
  skip: process.platform === "win32",
  timeout: 15_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-success-descendant-"));
  const pidPath = join(directory, "descendant.pid");
  try {
    const fixture = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", "process.on('SIGHUP', () => {}); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      writeFileSync(${JSON.stringify(pidPath)}, String(descendant.pid));
      descendant.unref();
      process.exit(0);
    `;
    const result = await runBuffered(process.execPath, ["-e", fixture], { timeoutMs: 8_000 });
    assert.match(result.error, /descendant processes were still running/);
    const descendantPID = Number(readFileSync(pidPath, "utf8"));
    assert.equal(processIsAlive(descendantPID), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

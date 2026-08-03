import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import "../mac-helper/src/commandDeadlinePreload.js";
import {
  reconcileHelperRuntime,
  rememberHelperStateForUpdate,
} from "../mac-helper/src/cliRuntimeBoundary.js";
import {
  HELPER_RUNTIME_ROLE,
  runtimeHealthPayload,
} from "../mac-helper/src/runtimeHealth.js";

test("update remembers an owned helper listener even when HTTP health hangs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round5-hung-helper-"));
  const port = await availablePort();
  const helperPath = join(directory, "mac-helper", "bin", "swift-sim-helper-entry.js");
  mkdirSync(dirname(helperPath), { recursive: true });
  writeFileSync(helperPath, `
    const { createServer } = require('node:net');
    createServer(() => {}).listen(${port}, '127.0.0.1', () => console.log('ready'));
  `);
  const child = spawn(process.execPath, [helperPath, "serve"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const previousPort = process.env.SWIFT_SIM_PORT;
  const previousFlag = process.env.SWIFT_SIM_HELPER_WAS_RUNNING;
  try {
    await waitForReady(child);
    process.env.SWIFT_SIM_PORT = String(port);
    delete process.env.SWIFT_SIM_HELPER_WAS_RUNNING;
    const result = await rememberHelperStateForUpdate();
    assert.equal(result.reachable, false);
    assert.equal(result.ownedListener, true);
    assert.equal(process.env.SWIFT_SIM_HELPER_WAS_RUNNING, "1");
  } finally {
    child.kill("SIGKILL");
    if (child.exitCode === null) await once(child, "exit").catch(() => {});
    restoreEnvironment("SWIFT_SIM_PORT", previousPort);
    restoreEnvironment("SWIFT_SIM_HELPER_WAS_RUNNING", previousFlag);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preserved pre-upgrade state forces Homebrew service restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round5-brew-restart-"));
  const port = await availablePort();
  const brewPath = join(directory, "brew");
  const serverPath = join(directory, "health-server.mjs");
  const recordPath = join(directory, "brew-args.txt");
  const pidPath = join(directory, "health-server.pid");
  const payload = JSON.stringify(runtimeHealthPayload(HELPER_RUNTIME_ROLE));
  writeFileSync(serverPath, `
    import { createServer } from 'node:http';
    import { writeFileSync } from 'node:fs';
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(${JSON.stringify(payload)});
    });
    server.listen(${port}, '127.0.0.1', () => writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)));
  `);
  writeFileSync(brewPath, `#!/usr/bin/env node
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(recordPath)}, process.argv.slice(2).join(' '));
    if (process.argv.slice(2).join(' ') !== 'services restart swift-sim') process.exit(2);
    const child = spawn(process.execPath, [${JSON.stringify(serverPath)}], { detached: true, stdio: 'ignore' });
    child.unref();
  `);
  chmodSync(brewPath, 0o755);

  const previous = snapshotEnvironment([
    "PATH",
    "SWIFT_SIM_PORT",
    "SWIFT_SIM_MARKETPLACE_ROOT",
    "SWIFT_SIM_HELPER_WAS_RUNNING",
  ]);
  try {
    process.env.PATH = `${directory}:${previous.PATH || ""}`;
    process.env.SWIFT_SIM_PORT = String(port);
    process.env.SWIFT_SIM_MARKETPLACE_ROOT = directory;
    process.env.SWIFT_SIM_HELPER_WAS_RUNNING = "1";
    const result = await reconcileHelperRuntime({ startIfStopped: true });
    assert.equal(result.state, "restarted");
    assert.equal(readFileSync(recordPath, "utf8"), "services restart swift-sim");
  } finally {
    if (existsSync(pidPath)) {
      const pid = Number(readFileSync(pidPath, "utf8"));
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
    restoreEnvironmentSnapshot(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Homebrew setup replaces an owned stale listener after an address-in-use failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round5-stale-listener-"));
  const port = await availablePort();
  const oldHelperPath = join(directory, "mac-helper", "bin", "swift-sim-helper-entry.js");
  const oldPidPath = join(directory, "old-helper.pid");
  const newServerPath = join(directory, "new-helper-server.js");
  const newPidPath = join(directory, "new-helper.pid");
  const brewPath = join(directory, "brew");
  const failureMarkerPath = join(directory, "brew-failed-once");
  const attemptsPath = join(directory, "brew-attempts.txt");
  mkdirSync(dirname(oldHelperPath), { recursive: true });
  const oldPayload = JSON.stringify({ ok: true, helper: "swift-sim-helper", version: "0.6.0", protocol: 1 });
  const currentPayload = JSON.stringify(runtimeHealthPayload(HELPER_RUNTIME_ROLE));
  writeFileSync(oldHelperPath, `
    const { createServer } = require('node:http');
    const { writeFileSync } = require('node:fs');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(${JSON.stringify(oldPayload)});
    });
    server.listen(${port}, '127.0.0.1', () => writeFileSync(${JSON.stringify(oldPidPath)}, String(process.pid)));
    setInterval(() => {}, 1000);
  `);
  writeFileSync(newServerPath, `
    const { createServer } = require('node:http');
    const { writeFileSync } = require('node:fs');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(${JSON.stringify(currentPayload)});
    });
    server.listen(${port}, '127.0.0.1', () => writeFileSync(${JSON.stringify(newPidPath)}, String(process.pid)));
    setInterval(() => {}, 1000);
  `);
  writeFileSync(brewPath, `#!/usr/bin/env node
    const { spawn } = require('node:child_process');
    const { existsSync, appendFileSync, writeFileSync } = require('node:fs');
    const args = process.argv.slice(2).join(' ');
    appendFileSync(${JSON.stringify(attemptsPath)}, args + '\\n');
    if (!existsSync(${JSON.stringify(failureMarkerPath)})) {
      writeFileSync(${JSON.stringify(failureMarkerPath)}, 'failed once');
      process.stderr.write('Address already in use\\n');
      process.exit(1);
    }
    const child = spawn(process.execPath, [${JSON.stringify(newServerPath)}], { detached: true, stdio: 'ignore' });
    child.unref();
  `);
  chmodSync(brewPath, 0o755);

  const oldHelper = spawn(process.execPath, [oldHelperPath, "serve"], { stdio: "ignore" });
  const previous = snapshotEnvironment([
    "PATH",
    "SWIFT_SIM_PORT",
    "SWIFT_SIM_MARKETPLACE_ROOT",
    "SWIFT_SIM_HELPER_WAS_RUNNING",
  ]);
  try {
    await waitForPath(oldPidPath);
    process.env.PATH = `${directory}:${previous.PATH || ""}`;
    process.env.SWIFT_SIM_PORT = String(port);
    process.env.SWIFT_SIM_MARKETPLACE_ROOT = directory;
    process.env.SWIFT_SIM_HELPER_WAS_RUNNING = "1";

    const result = await reconcileHelperRuntime({ startIfStopped: true });

    assert.equal(result.state, "restarted");
    assert.equal(readFileSync(attemptsPath, "utf8"), "services restart swift-sim\nservices restart swift-sim\n");
    assert.equal(runtimeHealthPayload(HELPER_RUNTIME_ROLE).version, JSON.parse(currentPayload).version);
  } finally {
    if (existsSync(newPidPath)) {
      try { process.kill(Number(readFileSync(newPidPath, "utf8")), "SIGKILL"); } catch {}
    }
    if (oldHelper.exitCode === null) oldHelper.kill("SIGKILL");
    restoreEnvironmentSnapshot(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child) {
  child.stdout.setEncoding("utf8");
  let output = "";
  while (!output.includes("ready")) {
    const event = await Promise.race([
      once(child.stdout, "data").then(([chunk]) => ({ type: "data", chunk })),
      once(child, "exit").then(([code, signal]) => ({ type: "exit", code, signal })),
    ]);
    if (event.type === "exit") {
      throw new Error(`helper fixture exited before listening (${event.signal || event.code})`);
    }
    output += event.chunk;
  }
}

async function waitForPath(path) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function snapshotEnvironment(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvironmentSnapshot(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) restoreEnvironment(key, value);
}

function restoreEnvironment(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

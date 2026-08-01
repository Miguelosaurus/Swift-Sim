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
    import { createServer } from 'node:net';
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
    await once(child, "exit").catch(() => {});
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
    const [chunk] = await once(child.stdout, "data");
    output += chunk;
  }
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

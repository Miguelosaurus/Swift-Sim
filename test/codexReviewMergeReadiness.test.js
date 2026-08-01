import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { helperRunsAsService } from "../mac-helper/src/helperShutdownScope.js";

const hardenedPreload = resolve("mac-helper/src/hardenedRuntimePreload.js");

test("only the serving helper is classified for graceful shutdown", () => {
  assert.equal(helperRunsAsService([process.execPath, "/tmp/swift-sim-helper.js", "serve"]), true);
  assert.equal(helperRunsAsService([process.execPath, "/tmp/swift-sim-helper.js", "start-session"]), false);
  assert.equal(helperRunsAsService([process.execPath, "/tmp/swift-sim-helper.js"]), false);
});

test("raw one-shot helper commands preserve default SIGTERM termination", async () => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    process.argv[1] = '/tmp/swift-sim-helper.js';
    process.argv[2] = 'start-session';
    await import(${JSON.stringify(hardenedPreload)});
    console.log('ready');
    setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForReady(child);
    const startedAt = Date.now();
    child.kill("SIGTERM");
    const [code, signal] = await once(child, "exit");
    const elapsed = Date.now() - startedAt;
    assert.equal(code, null);
    assert.equal(signal, "SIGTERM");
    assert.ok(elapsed < 1_000, `one-shot helper did not terminate promptly after ${elapsed}ms`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

test("raw serving helper still installs the hard shutdown deadline", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    process.argv[1] = '/tmp/swift-sim-helper.js';
    process.argv[2] = 'serve';
    const originalExit = process.exit;
    await import(${JSON.stringify(hardenedPreload)});
    console.log(JSON.stringify({
      exitGuarded: process.exit !== originalExit,
      termListeners: process.listenerCount('SIGTERM'),
      intListeners: process.listenerCount('SIGINT'),
    }));
  `], { encoding: "utf8", timeout: 3_000 });

  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.trim());
  assert.equal(observed.exitGuarded, true);
  assert.ok(observed.termListeners >= 2);
  assert.ok(observed.intListeners >= 2);
});

async function waitForReady(child) {
  child.stdout.setEncoding("utf8");
  let output = "";
  while (!output.includes("ready")) {
    const event = await Promise.race([
      once(child.stdout, "data").then(([chunk]) => ({ type: "data", chunk })),
      once(child, "exit").then(([code, signal]) => ({ type: "exit", code, signal })),
    ]);
    if (event.type === "exit") {
      throw new Error(`one-shot helper fixture exited before readiness (${event.signal || event.code})`);
    }
    output += event.chunk;
  }
}

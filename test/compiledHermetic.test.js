import assert from "node:assert/strict";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const compiledOrSourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// The source suite intentionally leaves this compiled-only gate to the
// isolated extraction script.
const isSourceTree = existsSync(join(compiledOrSourceRoot, "mac-helper", "src", "contracts", "build.ts"));
const packageRoot = isSourceTree ? compiledOrSourceRoot : dirname(compiledOrSourceRoot);
const distRoot = isSourceTree ? join(packageRoot, "dist") : compiledOrSourceRoot;
const cli = join(distRoot, "mac-helper", "bin", "swift-sim-entry.js");
const helper = join(distRoot, "mac-helper", "bin", "swift-sim-helper-entry.js");

test("compiled runtime works without the source tree", async () => {
  if (isSourceTree) return;
  assert.equal(existsSync(join(packageRoot, "test")), false);
  assert.ok(existsSync(join(packageRoot, "plugins", "swift-sim-companion", "skills", "remote-simulator-companion", "SKILL.md")));

  assert.equal(run(cli, ["version"]).stdout.trim(), "0.6.1");
  assert.match(run(cli, ["help"]).stdout, /Usage:\s+swift-sim setup/);

  const home = mkdtempSync(join(tmpdir(), "swift-sim-hermetic-home-"));
  const port = await availablePort();
  const env = { ...process.env, HOME: home, SWIFT_SIM_HOST: "127.0.0.1", SWIFT_SIM_PORT: String(port) };
  mkdirSync(join(home, ".swift-sim"), { recursive: true });
  const engine = join(home, ".swift-sim", "engine");
  const executable = join(engine, "InjectionNext.app", "Contents", "MacOS", "InjectionNext");
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(engine, "manifest.json"), JSON.stringify({
    version: "0.4.0",
    sha256: "17932eb4d59d8c5d97f76bc46a97898997c96e2efbd740e045ea65c0e2b01696",
  }));

  let first = await startHelper(env, port);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).ok, true);
    const setup = run(cli, ["setup", "--skip-service", "--skip-agents", "--skip-plugin", "--json"], env);
    assert.equal(setup.status, 0, setup.stderr);
    assert.equal(JSON.parse(setup.stdout).version, "0.6.1");
    const doctor = run(cli, ["doctor", "--json"], env);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).version, "0.6.1");

    const stateModule = await import(new URL("../mac-helper/src/deviceDeliveryState.js", import.meta.url).href);
    const statePath = join(home, ".swift-sim", "generation.json");
    const state = stateModule.publishDeliveryGenerationState(statePath, {
      generation: "generation-1",
      status: "ready",
      managerIdentity: { pid: process.pid, startedAt: "hermetic", commandFragments: ["node"] },
    });
    assert.equal(stateModule.readDeliveryGenerationState(statePath).generation, state.generation);
  } finally {
    await stopHelper(first);
  }

  first = await startHelper(env, port);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).ok, true);
  } finally {
    await stopHelper(first);
  }

});

function run(script, args, env = process.env) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

async function startHelper(env, port) {
  const child = spawn(process.execPath, [helper, "serve", "--host", "127.0.0.1", "--port", String(port)], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errorOutput = "";
  child.stderr.on("data", (chunk) => { errorOutput += String(chunk); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGKILL");
  throw new Error(`Hermetic compiled helper did not become healthy: ${errorOutput}`);
}

async function stopHelper(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2_000)),
  ]);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const commandPreload = resolve("mac-helper/src/commandDeadlinePreload.js");
const shutdownPreload = resolve("mac-helper/src/helperShutdownDeadlinePreload.js");

test("synchronous command preload terminates the entire hung process group", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round5-command-"));
  const descendantPath = join(directory, "descendant.pid");
  const startedAt = Date.now();
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      process.env.SWIFT_SIM_SYNC_COMMAND_TIMEOUT_MS = '100';
      await import(${JSON.stringify(commandPreload)});
      const { spawnSync } = await import('node:child_process');
      const fs = await import('node:fs');
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', \`
        const { spawn } = await import('node:child_process');
        const fs = await import('node:fs');
        const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        fs.writeFileSync(${JSON.stringify(descendantPath)}, String(descendant.pid));
        setInterval(() => {}, 1000);
      \`], { encoding: 'utf8' });
      const descendantPID = Number(fs.readFileSync(${JSON.stringify(descendantPath)}, 'utf8'));
      let descendantAlive = false;
      try { process.kill(descendantPID, 0); descendantAlive = true; } catch {}
      console.log(JSON.stringify({
        code: child.error?.code || '',
        signal: child.signal || '',
        descendantAlive,
      }));
    `], { encoding: "utf8", timeout: 3_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(Date.now() - startedAt < 2_000);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      code: "ETIMEDOUT",
      signal: "SIGKILL",
      descendantAlive: false,
    });
  } finally {
    if (readFileSyncSafe(descendantPath)) {
      const pid = Number(readFileSync(descendantPath, "utf8"));
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("synchronous command preload preserves an explicit caller timeout", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    process.env.SWIFT_SIM_SYNC_COMMAND_TIMEOUT_MS = '50';
    await import(${JSON.stringify(commandPreload)});
    const { spawnSync } = await import('node:child_process');
    const child = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], {
      encoding: 'utf8',
      timeout: 500,
    });
    console.log(JSON.stringify({ status: child.status, error: child.error?.code || '' }));
  `], { encoding: "utf8", timeout: 2_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { status: 0, error: "" });
});

test("helper cleanup can complete after an earlier forced failure exit request", async () => {
  const child = helperShutdownChild(`
    process.on('SIGTERM', () => {
      setTimeout(() => process.exit(1), 20);
      setTimeout(() => process.exit(0), 120);
    });
  `, 250);
  await waitForReady(child);
  const startedAt = Date.now();
  child.kill("SIGTERM");
  const [code, signal] = await once(child, "exit");
  const elapsed = Date.now() - startedAt;
  assert.equal(signal, null);
  assert.equal(code, 0);
  assert.ok(elapsed >= 90, `cleanup exited too early after ${elapsed}ms`);
  assert.ok(elapsed < 1_000, `cleanup did not settle promptly after ${elapsed}ms`);
});

test("helper shutdown still has a final hard failure deadline", async () => {
  const child = helperShutdownChild(`
    process.on('SIGTERM', () => {
      setTimeout(() => process.exit(1), 20);
    });
  `, 180);
  await waitForReady(child);
  const startedAt = Date.now();
  child.kill("SIGTERM");
  const [code, signal] = await once(child, "exit");
  const elapsed = Date.now() - startedAt;
  assert.equal(signal, null);
  assert.equal(code, 1);
  assert.ok(elapsed >= 140, `hard deadline fired too early after ${elapsed}ms`);
  assert.ok(elapsed < 1_000, `hard deadline did not fire after ${elapsed}ms`);
});

function helperShutdownChild(listenerSource, deadlineMs) {
  return spawn(process.execPath, ["--input-type=module", "-e", `
    process.env.SWIFT_SIM_HELPER_SHUTDOWN_DEADLINE_MS = ${JSON.stringify(String(deadlineMs))};
    await import(${JSON.stringify(shutdownPreload)});
    ${listenerSource}
    console.log('ready');
    setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "pipe", "pipe"] });
}

async function waitForReady(child) {
  child.stdout.setEncoding("utf8");
  let output = "";
  while (!output.includes("ready")) {
    const [chunk] = await once(child.stdout, "data");
    output += chunk;
  }
}

function readFileSyncSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

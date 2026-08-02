import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  liveEngineProcessRecordIsCurrent,
  parseLiveEngineProcessRecord,
} from "../mac-helper/src/liveEngineOwnershipPreload.js";

const preloadURL = pathToFileURL(resolve("mac-helper/src/liveEngineOwnershipPreload.js")).href;

test("live engine records require the exact kernel start, executable, group, and nonce", () => {
  const executable = resolve(process.execPath);
  const record = {
    version: 2,
    pid: 321,
    processGroup: 321,
    startToken: "darwin:1780000000.123456",
    executable,
    instanceNonce: "11111111-1111-4111-8111-111111111111",
  };
  const identity = {
    startToken: record.startToken,
    processGroup: record.processGroup,
    executable,
    instanceNonce: record.instanceNonce,
  };
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: executable,
    identity,
  }), true);
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: executable,
    identity: { ...identity, startToken: "darwin:1780000000.123457" },
  }), false);
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: executable,
    identity: { ...identity, executable: "/bin/sleep" },
  }), false);
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: executable,
    identity: { ...identity, instanceNonce: "22222222-2222-4222-8222-222222222222" },
  }), false);
  assert.equal(liveEngineProcessRecordIsCurrent({
    version: 1,
    pid: 321,
    processGroup: 321,
    startedAt: "Sat Aug  1 23:00:00 2026",
    executable,
  }, { engineExecutable: executable, identity }), false);
  assert.equal(parseLiveEngineProcessRecord("321"), null);
  assert.equal(parseLiveEngineProcessRecord("not-json"), null);
});

test("the live engine boundary kills the exact detached process group", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-live-owner-"));
  const pidPath = join(directory, "engine.pid");
  const descendantPath = join(directory, "descendant.pid");
  const script = `
    import { spawn } from 'node:child_process';
    import { readFileSync, writeFileSync } from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    import { installLiveEngineOwnershipBoundary, readPublishedLiveEngineRecord } from ${JSON.stringify(preloadURL)};
    const pidPath = ${JSON.stringify(pidPath)};
    const descendantPath = ${JSON.stringify(descendantPath)};
    installLiveEngineOwnershipBoundary({ engineExecutable: process.execPath, pidPath });
    const engine = spawn(process.execPath, ['-e', ${JSON.stringify(`
      const { spawn } = require('node:child_process');
      const { writeFileSync } = require('node:fs');
      const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
      writeFileSync(${JSON.stringify(descendantPath)}, String(descendant.pid));
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `)}], { detached: true, stdio: 'ignore' });
    writeFileSync(pidPath, String(engine.pid), { mode: 0o600 });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { readFileSync(descendantPath, 'utf8'); break; } catch { await delay(10); }
    }
    const record = readPublishedLiveEngineRecord(pidPath);
    const authorizedPID = Number(readFileSync(pidPath, 'utf8').trim());
    process.kill(authorizedPID, 'SIGTERM');
    await delay(100);
    const descendantPID = Number(readFileSync(descendantPath, 'utf8').trim());
    console.log(JSON.stringify({
      record,
      engineAlive: alive(engine.pid),
      descendantAlive: alive(descendantPID),
    }));
    function alive(pid) {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }
  `;

  try {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const { stdout, stderr, code } = await collect(child);
    assert.equal(code, 0, stderr);
    const observed = JSON.parse(stdout.trim());
    assert.equal(observed.record.version, 2);
    assert.match(observed.record.startToken, /^(?:darwin|linux):/);
    assert.match(observed.record.instanceNonce, /^[0-9a-f-]{36}$/i);
    assert.equal(observed.record.pid, observed.record.processGroup);
    assert.equal(observed.engineAlive, false);
    assert.equal(observed.descendantAlive, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a stale live engine record cannot authorize a reused PID", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-live-stale-"));
  const pidPath = join(directory, "engine.pid");
  const sleeper = spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
  try {
    const stale = JSON.stringify({
      version: 2,
      pid: sleeper.pid,
      processGroup: sleeper.pid,
      startToken: "darwin:stale-start-identity",
      executable: process.execPath,
      instanceNonce: "33333333-3333-4333-8333-333333333333",
    });
    const writer = spawnSync("/bin/sh", ["-c", "printf '%s' \"$1\" > \"$2\"", "sh", stale, pidPath]);
    assert.equal(writer.status, 0, writer.stderr?.toString());

    const script = `
      import { readFileSync } from 'node:fs';
      import { installLiveEngineOwnershipBoundary } from ${JSON.stringify(preloadURL)};
      installLiveEngineOwnershipBoundary({ engineExecutable: process.execPath, pidPath: ${JSON.stringify(pidPath)} });
      const presented = readFileSync(${JSON.stringify(pidPath)}, 'utf8');
      console.log(JSON.stringify({ presented }));
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).presented, "");
    assert.equal(processIsAlive(sleeper.pid), true);
  } finally {
    try { process.kill(-sleeper.pid, "SIGKILL"); } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function collect(child) {
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolveExit) => child.once("exit", resolveExit));
  return { stdout, stderr, code };
}


test("identity failure never authorizes an unverified cleanup signal", () => {
  const source = readFileSync("mac-helper/src/liveEngineOwnershipPreload.js", "utf8");
  const failureBranch = source.slice(
    source.indexOf("if (!identity || identity.processGroup !== pid"),
    source.indexOf("pendingRecords.set(pid", source.indexOf("if (!identity || identity.processGroup !== pid")),
  );
  assert.doesNotMatch(failureBranch, /kill|terminate/);
  assert.match(source, /process\.platform === "darwin" && !identityHelperExecutable\(\)/);
});

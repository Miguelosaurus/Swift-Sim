import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const preload = resolve("mac-helper/src/asyncCommandGroupPreload.js");

test("timed-out Tailscale cleanup kills descendants after the leader exits", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round5-async-group-"));
  const tailscale = join(directory, "tailscale");
  const descendantPath = join(directory, "descendant.pid");
  const readyPath = join(directory, "ready");
  writeFileSync(tailscale, `#!/usr/bin/env node
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const descendant = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], {
      stdio: 'ignore',
    });
    fs.writeFileSync(${JSON.stringify(descendantPath)}, String(descendant.pid));
    fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');
    process.on('SIGTERM', () => process.exit(0));
    setInterval(() => {}, 1000);
  `);
  chmodSync(tailscale, 0o755);

  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      process.env.SWIFT_SIM_ASYNC_FORCE_KILL_DELAY_MS = '75';
      await import(${JSON.stringify(preload)});
      const { spawn, spawnSync } = await import('node:child_process');
      const fs = await import('node:fs');
      const child = spawn(${JSON.stringify(tailscale)}, [], { stdio: 'ignore' });
      const deadline = Date.now() + 1000;
      while (!fs.existsSync(${JSON.stringify(readyPath)}) && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      if (!fs.existsSync(${JSON.stringify(readyPath)})) process.exit(2);
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const descendantPID = Number(fs.readFileSync(${JSON.stringify(descendantPath)}, 'utf8'));
      const probe = spawnSync('/bin/ps', ['-p', String(descendantPID), '-o', 'stat='], {
        encoding: 'utf8',
        timeout: 500,
      });
      const state = String(probe.stdout || '').trim();
      console.log(JSON.stringify({ executing: Boolean(state) && !state.startsWith('Z') }));
    `], { encoding: "utf8", timeout: 3_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { executing: false });
  } finally {
    try {
      const pid = Number(readFileSync(descendantPath, "utf8"));
      process.kill(pid, "SIGKILL");
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});

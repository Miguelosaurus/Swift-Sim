import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const preload = resolve("mac-helper/src/lockOwnershipPreload.js");

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return String(result.stdout || "").trim();
}

test("lock guard refuses to delete another live owner's directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-guard-"));
  const lock = join(directory, "state.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({
    pid: process.pid,
    startedAt: processStartedAt(process.pid),
  }));
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import ${JSON.stringify(preload)};
      const fs = await import('node:fs');
      fs.rmSync(${JSON.stringify(lock)}, { recursive: true, force: true });
    `], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(lock), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("lock guard permits deletion of a stale owner's directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-guard-stale-"));
  const lock = join(directory, "state.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: 99999999, startedAt: "never" }));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import ${JSON.stringify(preload)};
    const fs = await import('node:fs');
    fs.rmSync(${JSON.stringify(lock)}, { recursive: true, force: true });
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(lock), false);
  rmSync(directory, { recursive: true, force: true });
});

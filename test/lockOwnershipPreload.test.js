import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renewalCancellationPath } from "../mac-helper/src/renewalCancellation.js";

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

test("a live reclaim claim blocks a competing owner write", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-reclaim-"));
  const lock = join(directory, "state.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, ".swift-sim-reclaim.json"), JSON.stringify({
    pid: process.pid,
    startedAt: processStartedAt(process.pid),
    nonce: "live-reclaim",
    createdAt: new Date().toISOString(),
  }));
  try {
    const ownerPath = join(lock, "owner.json");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import ${JSON.stringify(preload)};
      const fs = await import('node:fs');
      try {
        fs.writeFileSync(${JSON.stringify(ownerPath)}, '{}', { flag: 'wx' });
        process.exit(2);
      } catch (error) {
        if (error?.code !== 'EBUSY') process.exit(3);
      }
    `], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(ownerPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a live reclaim claim blocks competing stale-lock deletion", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-reclaim-delete-"));
  const lock = join(directory, "state.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: 99999999, startedAt: "never" }));
  writeFileSync(join(lock, ".swift-sim-reclaim.json"), JSON.stringify({
    pid: process.pid,
    startedAt: processStartedAt(process.pid),
    nonce: "live-reclaim",
    createdAt: new Date().toISOString(),
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

test("stale renewal cancellation markers self-heal without clearing build cancellation", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-renewal-cancel-guard-"));
  const renewal = join(directory, "renewal.cancelled");
  const build = join(directory, "build.cancelled");
  writeFileSync(renewal, JSON.stringify({
    scope: "renewal",
    owner: { pid: 99999999, startedAt: "never" },
  }));
  writeFileSync(build, JSON.stringify({
    scope: "build",
    owner: { pid: 99999999, startedAt: "never" },
  }));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import ${JSON.stringify(preload)};
    const fs = await import('node:fs');
    if (fs.existsSync(${JSON.stringify(renewal)})) process.exit(2);
    if (!fs.existsSync(${JSON.stringify(build)})) process.exit(3);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(renewal), false);
  assert.equal(existsSync(build), true);
  rmSync(directory, { recursive: true, force: true });
});

test("a process-scoped renewal marker from a reused pid self-heals", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-renewal-pid-reuse-"));
  const base = join(directory, "build.cancelled");
  const marker = renewalCancellationPath(base);
  writeFileSync(marker, JSON.stringify({
    scope: "renewal",
    owner: { pid: process.pid, startedAt: "Mon Jan  1 00:00:00 1990" },
    cancelledAt: new Date().toISOString(),
  }));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import ${JSON.stringify(preload)};
    const fs = await import('node:fs');
    if (fs.existsSync(${JSON.stringify(base)})) process.exit(2);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(marker), false);
  rmSync(directory, { recursive: true, force: true });
});

test("worker journals are atomically published without temporary residue", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-worker-journal-atomic-"));
  const journal = join(directory, ".cancelled.worker.json");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import ${JSON.stringify(preload)};
    const fs = await import('node:fs');
    fs.writeFileSync(${JSON.stringify(journal)}, JSON.stringify({ pid: 123 }), { mode: 0o600 });
  `], { encoding: "utf8" });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(journal, "utf8")), { pid: 123 });
    assert.deepEqual(readdirSync(directory), [".cancelled.worker.json"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

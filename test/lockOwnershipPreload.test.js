import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
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

test("a parseable malformed owner cannot permanently block lock reclamation", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-malformed-owner-"));
  const lock = join(directory, "state.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({}));
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      await import(${JSON.stringify(resolve("mac-helper/src/atomicLockRemovalPreload.js"))});
      await import(${JSON.stringify(preload)});
      const fs = await import('node:fs');
      fs.rmSync(${JSON.stringify(lock)}, { recursive: true, force: true });
    `], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a reclaimer cannot delete after its exact claim is replaced", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-replaced-claim-"));
  const lock = join(directory, "state.lock");
  const claimPath = join(lock, ".swift-sim-reclaim.json");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({
    pid: 99_999_999,
    startedAt: "never",
    nonce: "stale-owner",
    createdAt: new Date(0).toISOString(),
  }));

  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    process.env.SWIFT_SIM_LOCK_CLAIM_PAUSE_MS = '300';
    await import(${JSON.stringify(resolve("mac-helper/src/atomicLockRemovalPreload.js"))});
    await import(${JSON.stringify(preload)});
    const fs = await import('node:fs');
    fs.rmSync(${JSON.stringify(lock)}, { recursive: true, force: true });
  `], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForPath(claimPath);
    const replacementClaim = {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
      nonce: "replacement-claim",
      createdAt: new Date().toISOString(),
    };
    writeFileSync(claimPath, JSON.stringify(replacementClaim));
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(existsSync(lock), true);
    assert.deepEqual(JSON.parse(readFileSync(claimPath, "utf8")), replacementClaim);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a displaced owner writer cannot claim a replacement lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-displaced-writer-"));
  const lock = join(directory, "state.lock");
  const displaced = join(directory, "displaced.lock");
  const ownerPath = join(lock, "owner.json");
  mkdirSync(lock);

  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    process.env.SWIFT_SIM_LOCK_OWNER_PAUSE_MS = '300';
    await import(${JSON.stringify(preload)});
    const { spawnSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const startedAt = String(spawnSync('/bin/ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).stdout || '').trim();
    try {
      fs.writeFileSync(${JSON.stringify(ownerPath)}, JSON.stringify({
        pid: process.pid,
        startedAt,
        nonce: 'displaced-writer',
        createdAt: new Date().toISOString(),
      }), { flag: 'wx', mode: 0o600 });
      process.exit(2);
    } catch (error) {
      if (error?.code !== 'EBUSY') process.exit(3);
    }
  `], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForPath(ownerPath);
    renameSync(lock, displaced);
    mkdirSync(lock);
    const replacementOwner = {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
      nonce: "replacement-owner",
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(lock, "owner.json"), JSON.stringify(replacementOwner));
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(existsSync(lock), true);
    assert.deepEqual(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")), replacementOwner);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitForPath(path) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

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

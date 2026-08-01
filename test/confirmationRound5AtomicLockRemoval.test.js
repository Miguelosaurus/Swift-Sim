import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
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

const atomicPreload = resolve("mac-helper/src/atomicLockRemovalPreload.js");
const ownershipPreload = resolve("mac-helper/src/lockOwnershipPreload.js");

test("stale lock deletion cannot remove a replacement owner at the original path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round5-lock-"));
  const lock = join(directory, "sessions.json.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({
    pid: 99_999_999,
    startedAt: "never",
    nonce: "stale-owner",
    createdAt: new Date(0).toISOString(),
  }));

  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    process.env.SWIFT_SIM_LOCK_RECLAIM_PAUSE_MS = '300';
    await import(${JSON.stringify(atomicPreload)});
    await import(${JSON.stringify(ownershipPreload)});
    const fs = await import('node:fs');
    fs.rmSync(${JSON.stringify(lock)}, { recursive: true, force: true });
  `], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForQuarantine(directory, lock);
    mkdirSync(lock);
    const replacement = {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
      nonce: "replacement-owner",
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(lock, "owner.json"), JSON.stringify(replacement));

    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(existsSync(lock), true);
    assert.deepEqual(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")), replacement);
    assert.equal(readdirSync(directory).some((name) => name.includes("swift-sim-reclaimed")), false);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitForQuarantine(directory, originalPath) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const quarantined = readdirSync(directory).some((name) => name.includes("swift-sim-reclaimed"));
    if (!existsSync(originalPath) && quarantined) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The stale lock was not atomically quarantined.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return String(result.stdout || "").trim();
}

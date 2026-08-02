import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cleanupCreatedLockDirectory, lockOwnerIsAlive, withLiveEngineLifecycleLock } from "../mac-helper/src/liveEngineLifecycleLock.js";

test("live engine lifecycle operations are serialized within one process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-lock-"));
  const lockPath = join(directory, "lifecycle.lock");
  let active = 0;
  let maximum = 0;
  try {
    await Promise.all(Array.from({ length: 4 }, (_, index) =>
      withLiveEngineLifecycleLock(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await delay(20 + index);
        active -= 1;
      }, { lockPath, waitMs: 2_000 })
    ));
    assert.equal(maximum, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a stale lock is quarantined before replacement ownership", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-stale-lock-"));
  const lockPath = join(directory, "lifecycle.lock");
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    pid: 999_999,
    startedAt: "stale",
    nonce: "stale",
  }));
  try {
    const result = await withLiveEngineLifecycleLock(async () => "acquired", {
      lockPath,
      waitMs: 2_000,
    });
    assert.equal(result, "acquired");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an ownerless stale lock remains reclaimable after the claim file updates its mtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-ownerless-lock-"));
  const lockPath = join(directory, "lifecycle.lock");
  mkdirSync(lockPath, { recursive: true });
  const staleTime = new Date(Date.now() - 5_000);
  utimesSync(lockPath, staleTime, staleTime);
  try {
    const result = await withLiveEngineLifecycleLock(async () => "acquired", {
      lockPath,
      waitMs: 2_000,
    });
    assert.equal(result, "acquired");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an abandoned reclaim claim cannot permanently block a stale lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-abandoned-reclaim-"));
  const lockPath = join(directory, "lifecycle.lock");
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    pid: 999_998,
    startedAt: "stale-owner",
    nonce: "stale-owner",
  }));
  writeFileSync(join(lockPath, "reclaim.json"), JSON.stringify({
    pid: 999_997,
    startedAt: "stale-claimant",
    nonce: "stale-claimant",
  }));
  try {
    const result = await withLiveEngineLifecycleLock(async () => "acquired", {
      lockPath,
      waitMs: 2_000,
    });
    assert.equal(result, "acquired");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an old malformed reclaim claim is quarantined fail-closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-malformed-reclaim-"));
  const lockPath = join(directory, "lifecycle.lock");
  const claimPath = join(lockPath, "reclaim.json");
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    pid: 999_996,
    startedAt: "stale-owner",
    nonce: "stale-owner",
  }));
  writeFileSync(claimPath, "{partial");
  const staleTime = new Date(Date.now() - 5_000);
  utimesSync(claimPath, staleTime, staleTime);
  try {
    const result = await withLiveEngineLifecycleLock(async () => "acquired", {
      lockPath,
      waitMs: 2_000,
    });
    assert.equal(result, "acquired");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("failed creator cleanup never deletes a replacement lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-replacement-lock-"));
  const lockPath = join(directory, "lifecycle.lock");
  const displacedPath = join(directory, "displaced.lock");
  mkdirSync(lockPath, { recursive: true });
  const stat = statSync(lockPath);
  const originalObservation = { device: String(stat.dev), inode: String(stat.ino), mtimeMs: stat.mtimeMs };
  renameSync(lockPath, displacedPath);
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, "sentinel"), "replacement");
  try {
    assert.equal(cleanupCreatedLockDirectory(lockPath, originalObservation), false);
    assert.equal(existsSync(join(lockPath, "sentinel")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed creator cleanup removes only its unchanged ownerless directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-created-lock-"));
  const lockPath = join(directory, "lifecycle.lock");
  mkdirSync(lockPath, { recursive: true });
  const stat = statSync(lockPath);
  const observation = { device: String(stat.dev), inode: String(stat.ino), mtimeMs: stat.mtimeMs };
  try {
    assert.equal(cleanupCreatedLockDirectory(lockPath, observation), true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("lifecycle owners require the exact kernel start token", () => {
  const owner = {
    version: 2,
    pid: process.pid,
    startToken: "darwin:1780000000.123456",
    nonce: "owner",
  };
  assert.equal(lockOwnerIsAlive(owner, {
    identity: { startToken: owner.startToken },
  }), true);
  assert.equal(lockOwnerIsAlive(owner, {
    identity: { startToken: "darwin:1780000000.123457" },
  }), false);
  assert.equal(lockOwnerIsAlive({
    pid: process.pid,
    startedAt: "Sat Aug  1 23:00:00 2026",
    nonce: "legacy",
  }, {
    identity: { startToken: owner.startToken },
  }), false);
});

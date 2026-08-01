import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withLiveEngineLifecycleLock } from "../mac-helper/src/liveEngineLifecycleLock.js";

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

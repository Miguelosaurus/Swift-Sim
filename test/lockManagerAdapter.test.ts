import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";

const currentStartToken = "test-current-process-start";
const identity = (pid: number) => (pid === process.pid ? { startToken: currentStartToken } : null);
const requestFor = (path: string) => ({
  path,
  waitMs: 2_000,
  staleAfterMs: 10,
  ownerMode: 0o600,
});

test("NodeLockManager serializes async operations and releases idempotently", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-node-lock-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, "state.lock");
  const manager = new NodeLockManager({ identity });
  let active = 0;
  let maximum = 0;

  await Promise.all(
    Array.from({ length: 3 }, (_, index) =>
      manager.withLock(requestFor(lockPath), async (lease) => {
        assert.equal(lease.path, lockPath);
        assert.match(lease.ownerNonce, /^[0-9a-f-]{36}$/i);
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 10 + index));
        active -= 1;
      }),
    ),
  );
  assert.equal(maximum, 1);

  const lease = manager.acquireSync(requestFor(lockPath));
  lease.releaseSync();
  lease.releaseSync();
  await lease.release();
});

test("NodeLockManager reclaims dead owners but fails closed for a live owner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-node-lock-owner-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const manager = new NodeLockManager({ identity });
  const stalePath = join(root, "stale.lock");
  await mkdir(stalePath, { recursive: true, mode: 0o700 });
  await writeFile(
    join(stalePath, "owner.json"),
    JSON.stringify({
      version: 2,
      pid: 999_999,
      startToken: "dead",
      nonce: "stale-owner",
      createdAt: "2026-08-04T20:00:00.000Z",
    }),
    { mode: 0o600 },
  );
  const reclaimed = await manager.acquire(requestFor(stalePath));
  await reclaimed.release();

  const livePath = join(root, "live.lock");
  await mkdir(livePath, { recursive: true, mode: 0o700 });
  await writeFile(
    join(livePath, "owner.json"),
    JSON.stringify({
      version: 2,
      pid: process.pid,
      startToken: currentStartToken,
      nonce: "live-owner",
      createdAt: "2026-08-04T20:00:00.000Z",
    }),
    { mode: 0o600 },
  );
  assert.throws(
    () => manager.acquireSync({ ...requestFor(livePath), waitMs: 0 }),
    (error: unknown) => hasCode(error, "SWIFT_SIM_LOCK_BUSY"),
  );
});

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

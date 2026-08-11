import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDarwinLegacyProcessIdentity } from "../mac-helper/src/infrastructure/darwinLegacyProcessIdentity.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";

const CURRENT_START = "Mon Aug 11 12:34:56 2026";

function requestFor(path: string) {
  return {
    path,
    waitMs: 500,
    staleAfterMs: 0,
    ownerMode: 0o600,
  };
}

test("Darwin legacy identity reproduces the DeviceBuildStore ps contract exactly", () => {
  const calls: Array<{ command: string; args: string[]; options: { encoding: string } }> = [];
  const identity = createDarwinLegacyProcessIdentity({
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: `  ${CURRENT_START}\n` };
    },
  });

  assert.deepEqual(identity(321), { startToken: CURRENT_START });
  assert.deepEqual(calls, [
    {
      command: "/bin/ps",
      args: ["-p", "321", "-o", "lstart="],
      options: { encoding: "utf8" },
    },
  ]);
});

test("Darwin legacy identity fails closed without executing invalid PIDs", () => {
  let calls = 0;
  const identity = createDarwinLegacyProcessIdentity({
    spawnSync() {
      calls += 1;
      throw new Error("ps unavailable");
    },
  });

  assert.equal(identity(0), null);
  assert.equal(identity(1), null);
  assert.equal(identity(-1), null);
  assert.equal(identity(Number.NaN), null);
  assert.equal(calls, 0);
  assert.equal(identity(999), null);
  assert.equal(calls, 1);

  const nonzero = createDarwinLegacyProcessIdentity({
    spawnSync: () => ({ status: 1, stdout: CURRENT_START }),
  });
  assert.equal(nonzero(999), null);

  const empty = createDarwinLegacyProcessIdentity({
    spawnSync: () => ({ status: 0, stdout: "   \n" }),
  });
  assert.equal(empty(999), null);
});

test("NodeLockManager recognizes an exact legacy startedAt owner as live", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-device-build-legacy-lock-live-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, "device-builds.lock");
  await mkdir(lockPath, { mode: 0o700 });
  await writeFile(
    join(lockPath, "owner.json"),
    JSON.stringify({
      pid: process.pid,
      startedAt: CURRENT_START,
      nonce: "legacy-live-owner",
      createdAt: "2026-08-11T12:00:00.000Z",
    }),
    { mode: 0o600 },
  );

  const manager = new NodeLockManager({
    identity: createDarwinLegacyProcessIdentity({
      spawnSync: () => ({ status: 0, stdout: `${CURRENT_START}\n` }),
    }),
  });

  assert.throws(
    () => manager.acquireSync({ ...requestFor(lockPath), waitMs: 0 }),
    (error: unknown) => hasCode(error, "SWIFT_SIM_LOCK_BUSY"),
  );
});

test("NodeLockManager reclaims a reused PID when legacy startedAt no longer matches", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-device-build-legacy-lock-reuse-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, "device-builds.lock");
  await mkdir(lockPath, { mode: 0o700 });
  await writeFile(
    join(lockPath, "owner.json"),
    JSON.stringify({
      pid: process.pid,
      startedAt: "Sun Aug 10 10:00:00 2026",
      nonce: "legacy-reused-pid-owner",
      createdAt: "2026-08-10T10:00:00.000Z",
    }),
    { mode: 0o600 },
  );

  const manager = new NodeLockManager({
    identity: createDarwinLegacyProcessIdentity({
      spawnSync: () => ({ status: 0, stdout: `${CURRENT_START}\n` }),
    }),
  });
  const lease = manager.acquireSync(requestFor(lockPath));
  const owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as Record<
    string,
    unknown
  >;

  assert.equal(owner.pid, process.pid);
  assert.equal(owner.startToken, CURRENT_START);
  assert.equal(Object.prototype.hasOwnProperty.call(owner, "startedAt"), false);
  lease.releaseSync();
});

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

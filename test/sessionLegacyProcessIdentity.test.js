import assert from "node:assert/strict";
import test from "node:test";
import { createSessionLegacyProcessIdentity } from "../mac-helper/src/infrastructure/sessionLegacyProcessIdentity.js";
import { lockOwnerIsAlive } from "../mac-helper/src/infrastructure/nodeLockManager.js";

const START_TOKEN = "Thu Aug 13 18:00:00 2026";

test("session legacy identity reuses exact Darwin lstart representation", () => {
  const calls = [];
  const identity = createSessionLegacyProcessIdentity({
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: `  ${START_TOKEN}  \n` };
    },
  });

  assert.deepEqual(identity(4242), { startToken: START_TOKEN });
  assert.deepEqual(calls, [
    {
      command: "/bin/ps",
      args: ["-p", "4242", "-o", "lstart="],
      options: { encoding: "utf8" },
    },
  ]);
});

test("same PID requires matching start identity and rejects PID reuse", () => {
  const owner = {
    pid: process.pid,
    startToken: START_TOKEN,
    nonce: "session-lock-owner",
    createdAt: "2026-08-13T18:00:01.000Z",
  };

  assert.equal(lockOwnerIsAlive(owner, { identity: { startToken: START_TOKEN } }), true);
  assert.equal(
    lockOwnerIsAlive(owner, { identity: { startToken: "different-start-token" } }),
    false,
  );
});

test("generic lock compatibility refuses legacy owners that have no start identity", () => {
  const ownerWithoutStartIdentity = {
    pid: process.pid,
    nonce: "old-session-lock-owner",
    createdAt: "2026-08-13T18:00:01.000Z",
  };

  assert.equal(lockOwnerIsAlive(ownerWithoutStartIdentity, { identity: null }), false);
});

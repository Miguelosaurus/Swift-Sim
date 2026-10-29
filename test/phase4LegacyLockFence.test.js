import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";
import { createSessionLegacyProcessIdentity } from "../mac-helper/src/infrastructure/sessionLegacyProcessIdentity.js";
import { PairingStore } from "../mac-helper/src/pairingStore.js";
import { PairingInviteStore } from "../mac-helper/src/pairingInviteStore.js";
import { SessionStore } from "../mac-helper/src/sessionStoreBase.js";
import { readStateBytes } from "./fixtures/state-bytes.js";

for (const [label, Store] of [["pairing", PairingStore], ["invitations", PairingInviteStore], ["sessions", SessionStore]]) {
  test(`aged live maintenance lease fences the real legacy ${label} writer`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), "swift-sim-aged-lease-"));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    const path = join(directory, `${label}.json`);
    const identity = createSessionLegacyProcessIdentity({spawnSync});
    const manager = new NodeLockManager({identity, clock: {
      now: () => new Date("2020-01-01T00:00:00.000Z"), sleep: async () => {},
    }});
    const lease = manager.acquireSync({path: `${path}.lock`, waitMs: 0, staleAfterMs: 30000, ownerMode: 0o600});
    try {
      const before = readStateBytes(lease.ownerPath);
      const owner = JSON.parse(before.toString());
      assert.equal(owner.startedAt, identity(process.pid).startToken);
      assert.equal(owner.startToken, owner.startedAt);
      const store = Object.create(Store.prototype);
      store.path = path;
      store.lockPath = `${path}.lock`;
      let entered = false;
      // Bound the wait without sleeping for the normal lock timeout. Production
      // process liveness/start-token inspection still runs unmodified.
      let tick = Date.now();
      t.mock.method(Date, "now", () => tick += 1000);
      assert.throws(() => store.withLock(() => { entered = true; }), /Timed out waiting/);
      assert.equal(entered, false);
      assert.deepEqual(readStateBytes(lease.ownerPath), before);
    } finally {
      lease.releaseSync();
    }
  });
}

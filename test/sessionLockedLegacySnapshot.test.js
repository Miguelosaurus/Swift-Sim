import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";
import { SessionLockedLegacySnapshotReader } from "../mac-helper/src/persistence/sessionLockedLegacySnapshot.js";

test("session locked snapshot handles missing and malformed legacy sources safely", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-session-legacy-"));
  const path = join(root, "sessions.json");
  const backups = join(root, "backups");
  const files = new NodeAtomicFileStore();
  const locks = new NodeLockManager({ identity: (pid) => ({ startToken: `test-${pid}` }), fileStore: files });
  const reader = new SessionLockedLegacySnapshotReader({ fileStore: files, lockManager: locks, source: { name: "sessions.json", path, lockRequest: { path: `${path}.lock`, waitMs: 0, staleAfterMs: 60_000, ownerMode: 0o600 } }, backupDirectory: backups });
  t.after(async () => rm(root, { recursive: true, force: true }));
  const empty = reader.withLockedSnapshot((snapshot) => snapshot);
  assert.equal(empty.recordCount, 0);
  assert.deepEqual(empty.backups, []);
  await writeFile(path, "{ invalid");
  assert.throws(() => reader.withLockedSnapshot(() => null), /Invalid JSON in session legacy source/);
  assert.equal((await readdir(backups)).length, 1);
});

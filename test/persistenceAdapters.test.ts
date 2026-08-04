import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeRuntimeJournalStore } from "../mac-helper/src/infrastructure/nodeRuntimeJournalStore.js";

const writeOptions = Object.freeze({
  mode: 0o600,
  createParentMode: 0o700,
  replace: false,
  syncDirectory: true,
});

test("atomic file store preserves no-replace, replacement, modes, and cleanup", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-atomic-store-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new NodeAtomicFileStore();
  const textPath = join(root, "nested", "state.txt");

  store.writeTextSync(textPath, "first", writeOptions);
  assert.equal(store.readTextSync(textPath), "first");
  assert.equal((await stat(textPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, "nested"))).mode & 0o777, 0o700);

  assert.throws(
    () => store.writeTextSync(textPath, "must-not-replace", writeOptions),
    (error: unknown) => hasCode(error, "EEXIST"),
  );
  assert.equal(await store.readText(textPath), "first");

  await store.writeText(textPath, "second", { ...writeOptions, replace: true });
  assert.equal(await store.readText(textPath), "second");

  const jsonPath = join(root, "nested", "state.json");
  await store.writeJSON(jsonPath, { ok: true, revision: 2 }, writeOptions);
  assert.deepEqual(store.readJSONSync(jsonPath), { ok: true, revision: 2 });
  assert.throws(() => store.writeJSONSync(join(root, "invalid.json"), undefined, writeOptions));

  const entries = await readdir(join(root, "nested"));
  assert.deepEqual(entries.sort(), ["state.json", "state.txt"]);

  store.removeSync(textPath);
  store.removeSync(textPath);
  await store.remove(jsonPath);
  await store.remove(jsonPath);
});

test("runtime journal store publishes owner-only JSON through the atomic store", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-runtime-journal-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const journalPath = join(root, "runtime", "cancel.json");
  const journals = new NodeRuntimeJournalStore();
  const first = {
    buildId: "build-1",
    cancelledAt: "2026-08-04T20:00:00.000Z",
  };
  const second = {
    buildId: "build-2",
    reason: "Renewal cancelled.",
    scope: "renewal" as const,
    renewalID: "renewal-1",
    owner: { pid: 42, startedAt: "2026-08-04T19:59:00.000Z" },
    cancelledAt: "2026-08-04T20:01:00.000Z",
  };

  journals.publishSync(journalPath, first);
  assert.deepEqual(journals.readSync(journalPath), first);
  assert.equal((await stat(journalPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, "runtime"))).mode & 0o777, 0o700);

  await journals.publish(journalPath, second);
  assert.deepEqual(await journals.read(journalPath), second);

  journals.removeSync(journalPath);
  journals.removeSync(journalPath);
  await assert.rejects(journals.read(journalPath), (error: unknown) => hasCode(error, "ENOENT"));
});

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retainSourceSnapshots, sourceSnapshot } from "../mac-helper/src/liveReload.js";

const sha = value => createHash("sha256").update(value).digest("hex");

test("registered sources are retained by hash so an uncommitted file has a verified before", t => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-snapshots-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = join(root, "store");
  const one = join(root, "One.swift"); writeFileSync(one, "struct One {}\n");
  const two = join(root, "Two.swift"); writeFileSync(two, "struct Two {}\n");
  retainSourceSnapshots([{ path: one, hash: sha("struct One {}\n") }, { path: two, hash: sha("struct Two {}\n") }], store);
  assert.equal(sourceSnapshot(sha("struct One {}\n"), store), "struct One {}\n");

  // A file that changed after compilation is never recorded under the old hash.
  writeFileSync(two, "struct Two { let x = 1 }\n");
  retainSourceSnapshots([{ path: one, hash: sha("struct One {}\n") }, { path: two, hash: sha("struct Other {}\n") }], store);
  assert.equal(sourceSnapshot(sha("struct Other {}\n"), store), undefined);

  // Only the current registration's set is kept.
  assert.deepEqual(readdirSync(store), [`${sha("struct One {}\n")}.swift`]);
  assert.equal(sourceSnapshot("not-a-hash", store), undefined);
});

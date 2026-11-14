import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("P7 differential corpus verifies the legacy oracle and proof gates", (t) => {
  // A private HOME keeps the classifier's compiler cache out of ~/.swift-sim;
  // its first compile takes ~25s on a cold cache.
  const home = mkdtempSync(join(tmpdir(), "swift-sim-p7-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "analyzer-prep", "diff.mjs"), "--json"],
    { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, HOME: home } },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.summary, {
    corpusSchemaVersion: 2,
    corpusCases: 69,
    // The SwiftSyntax classifier matches the oracle on every case, including
    // eleven structural edits the earlier lexical classifier admitted.
    equivalent: 69,
    stricter: 0,
    potentiallyMorePermissive: 0,
    differences: 0,
  });
  assert.deepEqual(payload.rows.filter((row) => row.legacyRoute !== row.dispatchRoute).map((row) => row.id).sort(), [
    "access-modifier", "malformed-missing-brace", "static-modifier", "unterminated-block-comment", "unterminated-string",
  ]);
});

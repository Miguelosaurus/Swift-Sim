import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureSwiftSimStateDirectory } from "../mac-helper/src/infrastructure/nodeStateDirectory.js";

test("state directory owner creates an idempotent private root", () => {
  const home = mkdtempSync(join(tmpdir(), "swift-sim-state-directory-"));
  try {
    const expected = join(home, ".swift-sim");
    assert.equal(ensureSwiftSimStateDirectory({ home }), expected);
    assert.equal(ensureSwiftSimStateDirectory({ home }), expected);
    assert.equal(statSync(expected).isDirectory(), true);
    assert.equal(statSync(expected).mode & 0o777, 0o700);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("state directory owner rejects an empty home path", () => {
  assert.throws(
    () => ensureSwiftSimStateDirectory({ home: "" }),
    /requires a non-empty home path/,
  );
});

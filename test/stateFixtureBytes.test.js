import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readStateBytes } from "./fixtures/state-bytes.js";

test("state-byte fixtures read disposable binary data and reject implementation files", () => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-state-bytes-"));
  try {
    const bytes = Buffer.from([0x00, 0xff, 0x80, 0x42]);
    for (const name of ["state.sqlite", "state.sqlite-wal", "state.json", "sentinel"]) {
      const path = join(root, name);
      writeFileSync(path, bytes);
      assert.deepEqual(readStateBytes(path), bytes);
    }
    for (const name of ["source.js", "source.ts", "source.swift", "source.m", "source.js.json"] ) {
      const path = join(root, name);
      writeFileSync(path, "export const source = true;\n");
      assert.throws(() => readStateBytes(path), /JSON, SQLite, or sentinel/);
    }
    const disguised = join(root, "alias.json");
    symlinkSync(join(root, "source.js"), disguised);
    assert.throws(() => readStateBytes(disguised), /source targets/);
    assert.throws(() => readStateBytes("relative.json"), /absolute/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

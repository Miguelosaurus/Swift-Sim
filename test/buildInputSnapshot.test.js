import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotBuildInputs } from "../mac-helper/src/buildInputSnapshot.js";
test("automatic builds reject parallel source changes, additions and removals", t => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-build-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "App.swift"); writeFileSync(file, "old");
  let verify = snapshotBuildInputs(root); verify();
  writeFileSync(file, "new"); assert.throws(verify, { code: "BUILD_INPUTS_CHANGED" });
  verify = snapshotBuildInputs(root); writeFileSync(join(root, "Added.swift"), "new");
  assert.throws(verify, { code: "BUILD_INPUTS_CHANGED" });
  verify = snapshotBuildInputs(root); rmSync(file);
  assert.throws(verify, { code: "BUILD_INPUTS_CHANGED" });
});
test("generated build output is excluded; identical rewritten source is accepted; links refuse", t => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-build-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "App.swift"); writeFileSync(file, "same");
  const verify = snapshotBuildInputs(root);
  mkdirSync(join(root, "build")); writeFileSync(join(root, "build", "output"), "generated");
  writeFileSync(file, "same"); verify();
  symlinkSync(file, join(root, "Other.swift"));
  assert.throws(() => snapshotBuildInputs(root), /external link/);
});

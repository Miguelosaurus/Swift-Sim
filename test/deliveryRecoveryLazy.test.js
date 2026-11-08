import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const entry = fileURLToPath(new URL("../mac-helper/bin/swift-sim-entry.js", import.meta.url));
const trace = fileURLToPath(new URL("./fixtures/recovery-import-trace.js", import.meta.url));
test("normal CLI and no-change delivery never load the recovery modules", (t) => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-recovery-lazy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "Card.swift");
  writeFileSync(path, 'struct Card { var label: String { "same" } }');
  for (const args of [
    ["version"],
    ["help"],
    ["deliver-change", "--before", path, "--after", path, "--live-only"],
  ]) {
    const result = spawnSync(process.execPath, ["--import", trace, entry, ...args], {
      env: { ...process.env, HOME: root },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /RECOVERY_MODULE_LOADED/);
  }
});

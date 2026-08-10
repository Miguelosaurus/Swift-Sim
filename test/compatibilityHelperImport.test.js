import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const helper = new URL("../mac-helper/bin/swift-sim-helper.js", import.meta.url);
const helperEntry = new URL("../mac-helper/bin/swift-sim-helper-entry.js", import.meta.url);

test("importing the compatibility helper is inert", () => {
  const home = mkdtempSync(join(tmpdir(), "swift-sim-helper-import-"));
  try {
    const script = `const mod = await import(${JSON.stringify(helper.href)}); console.log(typeof mod.runCompatibilityHelper);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "function");
    assert.equal(existsSync(join(home, ".swift-sim")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("direct compatibility execution still runs the command loop from an empty home", () => {
  const home = mkdtempSync(join(tmpdir(), "swift-sim-helper-direct-"));
  try {
    const result = spawnSync(process.execPath, [helper.pathname, "not-a-command"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command: not-a-command/);
    assert.equal(existsSync(join(home, ".swift-sim")), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("official helper entry explicitly runs the compatibility command loop from an empty home", () => {
  const home = mkdtempSync(join(tmpdir(), "swift-sim-helper-entry-"));
  try {
    const result = spawnSync(process.execPath, [helperEntry.pathname, "not-a-command"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command: not-a-command/);
    assert.equal(existsSync(join(home, ".swift-sim")), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

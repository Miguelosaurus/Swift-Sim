import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Xcode inspector, hooks and export preserve original files and clean temporary work", () => {
  const result = spawnSync("python3", ["-m", "unittest", "discover", "-s",
    fileURLToPath(new URL("./xcode-import-python/", import.meta.url)), "-v"],
    { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

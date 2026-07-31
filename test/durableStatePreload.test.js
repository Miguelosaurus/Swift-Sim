import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const preload = resolve("mac-helper/src/lockOwnershipPreload.js");

test("state renames fsync the source before atomic publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-state-fsync-"));
  const temporary = join(directory, "state.json.tmp");
  const destination = join(directory, "state.json");
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const fs = require('node:fs');
      const originalFsyncSync = fs.fsyncSync;
      let fsyncCalls = 0;
      fs.fsyncSync = function countedFsyncSync(descriptor) {
        fsyncCalls += 1;
        return originalFsyncSync.call(this, descriptor);
      };
      await import(${JSON.stringify(preload)});
      const esmFS = await import('node:fs');
      esmFS.writeFileSync(${JSON.stringify(temporary)}, '{"ok":true}', { mode: 0o600 });
      esmFS.renameSync(${JSON.stringify(temporary)}, ${JSON.stringify(destination)});
      if (fsyncCalls < 1) process.exit(2);
    `], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(destination), true);
    assert.equal(existsSync(temporary), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

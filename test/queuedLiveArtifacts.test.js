import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupQueuedLiveArtifacts } from "../mac-helper/src/liveReload.js";

test("legacy artifact cleanup retains live requests and never follows symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-cleanup-"));
  try {
    const artifactRoot = join(root, "artifacts"); const patchRoot = join(root, "patches");
    mkdirSync(artifactRoot, { mode: 0o700 }); mkdirSync(patchRoot, { mode: 0o700 });
    const key = "a".repeat(64); const path = join(artifactRoot, `eval_injection_swift_sim_dynamic_${key}.dylib`);
    const marker = { version: 1, key, requestId: "fixture", expiresAt: 1000 };
    writeFileSync(path, "fixture", { mode: 0o600 });
    writeFileSync(`${path}.json`, JSON.stringify(marker), { mode: 0o600 });
    cleanupQueuedLiveArtifacts([{ requestId: "fixture", expiresAt: 10000 }], { artifactRoot, patchRoot, now: 2000 });
    assert.equal(existsSync(path), true);
    const outside = join(root, "outside"); writeFileSync(outside, "keep");
    rmSync(path); symlinkSync(outside, path);
    cleanupQueuedLiveArtifacts([], { artifactRoot, patchRoot, now: 2000 });
    assert.equal(existsSync(outside), true); assert.equal(existsSync(`${path}.json`), true);
    rmSync(path); writeFileSync(path, "fixture", { mode: 0o600 });
    cleanupQueuedLiveArtifacts([], { artifactRoot, patchRoot, now: 2000 });
    assert.equal(existsSync(path), false); assert.equal(existsSync(`${path}.json`), false);
    assert.equal(existsSync(outside), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

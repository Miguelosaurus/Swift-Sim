import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  installSwiftSimChildRuntimeBoundary,
  runtimeChildOptions,
  swiftSimRuntimeChild,
} from "../mac-helper/src/swiftSimChildRuntimeBoundary.js";

const preloadURL = pathToFileURL(fileURLToPath(
  new URL("../mac-helper/src/hardenedRuntimePreload.js", import.meta.url)
)).href;

test("child boundary targets only raw Swift Sim Node runtimes", () => {
  assert.equal(swiftSimRuntimeChild(process.execPath, ["/tmp/mac-helper/bin/swift-sim-helper.js"]), true);
  assert.equal(swiftSimRuntimeChild(process.execPath, ["/tmp/mac-helper/bin/swift-sim-device-delivery.js"]), true);
  assert.equal(swiftSimRuntimeChild(process.execPath, ["/tmp/mac-helper/bin/swift-sim-device-gateway.js"]), true);
  assert.equal(swiftSimRuntimeChild(process.execPath, ["/tmp/unrelated.js"]), false);
  assert.equal(swiftSimRuntimeChild("/usr/bin/python3", ["/tmp/mac-helper/bin/swift-sim-helper.js"]), false);
});

test("child options replace stale Swift Sim imports without mutating unrelated children", () => {
  const stale = "file:///old/mac-helper/src/hardenedRuntimePreload.js";
  const original = { env: { NODE_OPTIONS: `--trace-warnings --import=${stale}` } };
  const guarded = runtimeChildOptions(
    process.execPath,
    ["/tmp/mac-helper/bin/swift-sim-helper.js"],
    original,
    { preloadURL }
  );
  assert.match(guarded.env.NODE_OPTIONS, /--trace-warnings/);
  assert.match(guarded.env.NODE_OPTIONS, new RegExp(`--import=${escapeRegex(preloadURL)}`));
  assert.doesNotMatch(guarded.env.NODE_OPTIONS, /file:\/\/\/old\//);
  assert.equal(runtimeChildOptions(process.execPath, ["/tmp/unrelated.js"], original, { preloadURL }), original);
});

test("spawnSync replaces a deleted old preload before raw helper startup", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-child-boundary-"));
  const script = join(directory, "swift-sim-helper.js");
  writeFileSync(script, "console.log(process.env.NODE_OPTIONS || '');\n", "utf8");
  installSwiftSimChildRuntimeBoundary({ preloadURL });
  try {
    const stale = "file:///deleted/mac-helper/src/hardenedRuntimePreload.js";
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        HOME: directory,
        NODE_OPTIONS: `--import=${stale}`,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`--import=${escapeRegex(preloadURL)}`));
    assert.doesNotMatch(result.stdout, /file:\/\/\/deleted\//);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

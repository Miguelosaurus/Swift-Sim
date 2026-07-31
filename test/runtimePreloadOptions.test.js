import test from "node:test";
import assert from "node:assert/strict";
import {
  appendNodeImport,
  replaceSwiftSimNodeImport,
} from "../mac-helper/src/runtimePreloadOptions.js";

test("runtime preload option preserves existing Node options and is idempotent", () => {
  const url = "file:///tmp/swift-sim-preload.js";
  const first = appendNodeImport("--trace-warnings", url);
  assert.equal(first, `--trace-warnings --import=${url}`);
  assert.equal(appendNodeImport(first, url), first);
  assert.equal(appendNodeImport("", url), `--import=${url}`);
  assert.equal(appendNodeImport("--trace-warnings", ""), "--trace-warnings");
});

test("upgrade replaces stale Swift Sim preload paths without removing unrelated imports", () => {
  const old = "file:///opt/homebrew/Cellar/swift-sim/0.4.0/libexec/mac-helper/src/hardenedRuntimePreload.js";
  const current = "file:///opt/homebrew/Cellar/swift-sim/0.5.0/libexec/mac-helper/src/hardenedRuntimePreload.js";
  const other = "file:///tmp/other-preload.js";
  assert.equal(
    replaceSwiftSimNodeImport(
      `--trace-warnings --import=${old} --import=${other}`,
      current
    ),
    `--trace-warnings --import=${other} --import=${current}`
  );
});

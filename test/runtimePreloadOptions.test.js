import test from "node:test";
import assert from "node:assert/strict";
import { appendNodeImport } from "../mac-helper/src/runtimePreloadOptions.js";

test("runtime preload option preserves existing Node options and is idempotent", () => {
  const url = "file:///tmp/swift-sim-preload.js";
  const first = appendNodeImport("--trace-warnings", url);
  assert.equal(first, `--trace-warnings --import=${url}`);
  assert.equal(appendNodeImport(first, url), first);
  assert.equal(appendNodeImport("", url), `--import=${url}`);
  assert.equal(appendNodeImport("--trace-warnings", ""), "--trace-warnings");
});

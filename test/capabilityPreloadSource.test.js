import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("capability boundary loads before the legacy helper HTTP boundary", () => {
  const source = readFileSync("mac-helper/bin/swift-sim-helper-entry.js", "utf8");
  assert.ok(source.indexOf("deviceBuildCapabilityBoundaryPreload") < source.indexOf("helperHttpBoundaryPreload"));
});

test("isolated public gateway loads the capability boundary before createServer", () => {
  const source = readFileSync("mac-helper/bin/swift-sim-device-gateway.js", "utf8");
  assert.ok(source.indexOf("deviceBuildCapabilityBoundaryPreload") < source.indexOf('from "node:http"'));
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("capability boundary loads before explicit helper HTTP boundary installation", () => {
  const source = readFileSync("mac-helper/bin/swift-sim-helper-entry.js", "utf8");
  const capabilityIndex = source.indexOf("deviceBuildCapabilityBoundaryPreload");
  const boundaryImportIndex = source.indexOf("helperHttpBoundaryPreload");
  const boundaryInstallIndex = source.indexOf("installHelperHttpBoundary();");
  assert.ok(capabilityIndex >= 0);
  assert.ok(boundaryImportIndex > capabilityIndex);
  assert.ok(boundaryInstallIndex > boundaryImportIndex);
});

test("legacy helper preload installs the HTTP boundary immediately after capability setup", () => {
  const source = readFileSync("mac-helper/src/hardenedRuntimePreload.js", "utf8");
  const capabilityIndex = source.indexOf("deviceBuildCapabilityBoundaryPreload");
  const boundaryImportIndex = source.indexOf("helperHttpBoundaryPreload");
  const boundaryInstallIndex = source.indexOf("installHelperHttpBoundary();");
  const artifactImportIndex = source.indexOf("artifactCleanupBoundaryPreload");
  assert.ok(capabilityIndex >= 0);
  assert.ok(boundaryImportIndex > capabilityIndex);
  assert.ok(boundaryInstallIndex > boundaryImportIndex);
  assert.ok(artifactImportIndex > boundaryInstallIndex);
});

test("isolated public gateway loads the capability boundary before createServer", () => {
  const source = readFileSync("mac-helper/bin/swift-sim-device-gateway.js", "utf8");
  assert.ok(source.indexOf("deviceBuildCapabilityBoundaryPreload") < source.indexOf('from "node:http"'));
});

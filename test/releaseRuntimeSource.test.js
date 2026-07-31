import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cliEntry = readFileSync(new URL("../mac-helper/bin/swift-sim-entry.js", import.meta.url), "utf8");
const helperEntry = readFileSync(new URL("../mac-helper/bin/swift-sim-helper-entry.js", import.meta.url), "utf8");
const preload = readFileSync(new URL("../mac-helper/src/hardenedRuntimePreload.js", import.meta.url), "utf8");
const packageJSON = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("CLI installs child-only hardening before loading the implementation", () => {
  const workerIndex = cliEntry.indexOf("ownedWorkerPreload.js");
  const boundaryIndex = cliEntry.indexOf("installSwiftSimChildRuntimeBoundary()");
  const importIndex = cliEntry.indexOf('await import("./swift-sim.js")');
  assert.ok(workerIndex >= 0);
  assert.ok(boundaryIndex > workerIndex);
  assert.ok(importIndex > boundaryIndex);
  assert.doesNotMatch(cliEntry, /process\.env\.NODE_OPTIONS/);
  assert.match(cliEntry, /rememberHelperStateForUpdate/);
  assert.match(cliEntry, /reconcileHelperRuntime/);
  assert.match(cliEntry, /if \(!skipService \|\| wasRunningBeforeUpdate\)/);
  assert.match(cliEntry, /installCompatibleHelperHealthFetchBoundary/);
});

test("helper entrypoint composes child hardening after owned-worker supervision", () => {
  const workerIndex = helperEntry.indexOf("ownedWorkerPreload.js");
  const boundaryIndex = helperEntry.indexOf("installSwiftSimChildRuntimeBoundary()");
  assert.ok(workerIndex >= 0);
  assert.ok(boundaryIndex > workerIndex);
  assert.match(helperEntry, /runtimeHealthPreload\.js/);
  assert.doesNotMatch(helperEntry, /process\.env\.NODE_OPTIONS/);

  const preloadWorkerIndex = preload.indexOf("ownedWorkerPreload.js");
  const preloadBoundaryIndex = preload.indexOf("installSwiftSimChildRuntimeBoundary()");
  assert.ok(preloadWorkerIndex >= 0);
  assert.ok(preloadBoundaryIndex > preloadWorkerIndex);
  assert.match(preload, /script === "swift-sim-helper\.js"/);
  assert.match(preload, /script === "swift-sim-device-gateway\.js"/);
  assert.match(preload, /script === "swift-sim-device-delivery\.js"/);
  assert.match(preload, /installGatewayHealthFetchBoundary/);
});

test("release check syntax-validates the complete JavaScript tree", () => {
  assert.equal(
    packageJSON.scripts.check,
    "node scripts/check-js-syntax.js && npm run check:docs && npm test"
  );
});

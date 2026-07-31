import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cliEntry = readFileSync(new URL("../mac-helper/bin/swift-sim-entry.js", import.meta.url), "utf8");
const helperEntry = readFileSync(new URL("../mac-helper/bin/swift-sim-helper-entry.js", import.meta.url), "utf8");
const preload = readFileSync(new URL("../mac-helper/src/hardenedRuntimePreload.js", import.meta.url), "utf8");
const packageJSON = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("CLI installs child hardening before loading the implementation", () => {
  const optionsIndex = cliEntry.indexOf("process.env.NODE_OPTIONS = appendNodeImport");
  const importIndex = cliEntry.indexOf('await import("./swift-sim.js")');
  assert.ok(optionsIndex >= 0);
  assert.ok(importIndex > optionsIndex);
  assert.match(cliEntry, /rememberHelperStateForUpdate/);
  assert.match(cliEntry, /reconcileHelperRuntime/);
  assert.match(cliEntry, /installCompatibleHelperHealthFetchBoundary/);
});

test("helper entrypoint propagates hardening to delivery and gateway children", () => {
  assert.match(helperEntry, /runtimeHealthPreload\.js/);
  assert.match(helperEntry, /hardenedRuntimePreload\.js/);
  assert.match(helperEntry, /process\.env\.NODE_OPTIONS = appendNodeImport/);
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

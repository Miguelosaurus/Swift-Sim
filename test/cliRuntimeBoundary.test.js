import test from "node:test";
import assert from "node:assert/strict";
import { helperCommandLooksOwned } from "../mac-helper/src/cliRuntimeBoundary.js";

test("standalone helper migration only recognizes direct Swift Sim serve processes", () => {
  assert.equal(helperCommandLooksOwned(
    "/opt/homebrew/opt/node/bin/node /tmp/Swift-Sim/mac-helper/bin/swift-sim-helper.js serve"
  ), true);
  assert.equal(helperCommandLooksOwned(
    "/opt/homebrew/opt/node/bin/node /tmp/Swift-Sim/mac-helper/bin/swift-sim-helper-entry.js serve --port 47217"
  ), true);
  assert.equal(helperCommandLooksOwned(
    '"/opt/homebrew/opt/node/bin/node" "/tmp/Swift Sim/mac-helper/bin/swift-sim-helper-entry.js" serve'
  ), true);
  assert.equal(helperCommandLooksOwned(
    "/usr/bin/python3 unrelated.py swift-sim-helper.js serve"
  ), false);
  assert.equal(helperCommandLooksOwned(
    "/opt/homebrew/opt/node/bin/node unrelated.js /tmp/mac-helper/bin/swift-sim-helper.js serve"
  ), false);
  assert.equal(helperCommandLooksOwned(
    "/opt/homebrew/opt/node/bin/node /tmp/Swift-Sim/mac-helper/bin/swift-sim-helper.js setup-status"
  ), false);
});

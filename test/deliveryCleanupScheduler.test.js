import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILD_STATE_LOCK_TIMEOUT_CODE } from "../mac-helper/src/deviceBuildStoreCore.js";
import { runDeliveryCleanupSafely } from "../mac-helper/src/deliveryCleanupScheduler.js";

test("delivery cleanup defers build-state lock contention without rejecting", async () => {
  const errors = [];
  const timeout = new Error("Timed out waiting for the Swift Sim build-state lock.");
  timeout.code = BUILD_STATE_LOCK_TIMEOUT_CODE;

  const result = await runDeliveryCleanupSafely(
    async () => { throw timeout; },
    { onError: (message) => errors.push(message) },
  );

  assert.deepEqual(result, { deferred: true });
  assert.deepEqual(errors, []);
});

test("delivery cleanup contains unexpected timer failures and keeps retry state alive", async () => {
  const errors = [];
  const result = await runDeliveryCleanupSafely(
    async () => { throw new Error("delivery backend unavailable"); },
    { onError: (message) => errors.push(message) },
  );

  assert.deepEqual(result, { deferred: false, failed: true });
  assert.deepEqual(errors, ["Swift Sim delivery-reference cleanup failed: delivery backend unavailable"]);
});

test("helper maintenance routes startup and interval cleanup through the safe scheduler", () => {
  const source = readFileSync("mac-helper/bin/swift-sim-helper.js", "utf8");
  assert.match(source, /setImmediate\(\(\) => \{\n\s+void scheduleDeliveryReferenceCleanup\(\);/);
  assert.match(source, /deliveryCleanupTimer = setInterval\(\(\) => \{\n\s+void scheduleDeliveryReferenceCleanup\(\);/);
});

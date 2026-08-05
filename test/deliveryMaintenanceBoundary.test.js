import assert from "node:assert/strict";
import test from "node:test";
import { runBoundaryMaintenanceOnce } from "../mac-helper/src/helperHttpBoundaryPreload.js";

test("boundary wrapper preserves injected ordering, timestamps, and coalescing", async () => {
  const order = [];
  const now = Date.parse("2026-07-31T01:00:00.000Z");
  const options = {
    deviceBuildStore: {
      list: () => {
        order.push("list-builds");
        return [];
      },
      listDeliveryReferenceCleanupJobs: () => {
        order.push("list-cleanup-jobs");
        return [];
      },
      completeDeliveryReferenceCleanupJob: () => {},
      failDeliveryReferenceCleanupJob: () => {},
    },
    deviceDelivery: {
      statuses: () => {
        order.push("list-delivery-statuses");
        return [];
      },
      stopGeneration: () => true,
    },
    now,
  };

  const first = runBoundaryMaintenanceOnce(options);
  const second = runBoundaryMaintenanceOnce({
    get deviceBuildStore() {
      throw new Error("coalesced build store must not be resolved");
    },
    get deviceDelivery() {
      throw new Error("coalesced delivery adapter must not be resolved");
    },
  });

  assert.strictEqual(second, first);
  await first;
  assert.deepEqual(order, ["list-builds", "list-delivery-statuses", "list-cleanup-jobs"]);
});

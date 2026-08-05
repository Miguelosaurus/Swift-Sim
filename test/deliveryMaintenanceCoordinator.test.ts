import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryMaintenanceCoordinator } from "../mac-helper/src/http/deliveryMaintenanceCoordinator.js";

function emptyBuildStore() {
  return {
    listDeliveryReferenceCleanupJobs: () => [],
    completeDeliveryReferenceCleanupJob: (_jobID: string) => {},
    failDeliveryReferenceCleanupJob: (_jobID: string, _error: unknown) => {},
    list: () => [],
  };
}

function emptyDeliveryAdapter() {
  return {
    stopGeneration: (_generation: string, _options: { referenceID: string }) => true,
    statuses: () => [],
  };
}

test("cleanup drains due jobs, skips future jobs, and records failed releases", async () => {
  const coordinator = new DeliveryMaintenanceCoordinator();
  const completed: string[] = [];
  const failed: Array<[string, string]> = [];
  const releases: Array<[string, string]> = [];

  await coordinator.drainCleanupJobsOnce({
    deviceBuildStore: {
      listDeliveryReferenceCleanupJobs: () => [
        {
          id: "due-ok",
          generation: "generation-ok",
          referenceID: "build:ok",
          nextAttemptAt: "2026-07-31T00:00:00.000Z",
        },
        {
          id: "due-fail",
          generation: "generation-fail",
          referenceID: "build:fail",
          createdAt: "2026-07-31T00:00:00.000Z",
        },
        {
          id: "future",
          generation: "generation-future",
          referenceID: "build:future",
          nextAttemptAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      completeDeliveryReferenceCleanupJob: (jobID: string) => completed.push(jobID),
      failDeliveryReferenceCleanupJob: (jobID: string, error: unknown) => {
        failed.push([jobID, error instanceof Error ? error.message : String(error)]);
      },
      list: () => [],
    },
    deviceDelivery: {
      stopGeneration: (generation: string, { referenceID }: { referenceID: string }) => {
        releases.push([generation, referenceID]);
        return generation === "generation-ok";
      },
      statuses: () => [],
    },
    now: Date.parse("2026-07-31T01:00:00.000Z"),
  });

  assert.deepEqual(releases, [
    ["generation-ok", "build:ok"],
    ["generation-fail", "build:fail"],
  ]);
  assert.deepEqual(completed, ["due-ok"]);
  assert.deepEqual(failed, [
    ["due-fail", "Delivery generation is still referenced or could not be stopped."],
  ]);
});

test("reconciliation releases only managed orphan references and survives individual failures", async () => {
  const coordinator = new DeliveryMaintenanceCoordinator();
  const attempts: Array<[string, string]> = [];
  const now = Date.parse("2026-07-31T01:00:00.000Z");

  await coordinator.reconcileReferencesOnce({
    deviceBuildStore: {
      ...emptyBuildStore(),
      list: () => [
        {
          id: "active",
          state: "delivering",
          expiresAt: "",
          delivery: null,
          capabilities: [],
          pendingRenewal: null,
        },
        {
          id: "saved",
          state: "ready",
          expiresAt: "2026-07-31T02:00:00.000Z",
          delivery: { referenceID: "build:saved" },
          capabilities: [
            {
              expiresAt: "2026-07-31T02:00:00.000Z",
              delivery: { referenceID: "build:historical" },
            },
          ],
          pendingRenewal: { id: "pending-live" },
        },
      ],
    },
    deviceDelivery: {
      statuses: () => [
        {
          generation: "generation-1",
          references: [
            "build:active",
            "build:saved",
            "build:historical",
            "renewal:pending-live",
            "renewal:throws",
            "build:expired",
            "external:leave-alone",
          ],
        },
      ],
      stopGeneration: (generation: string, { referenceID }: { referenceID: string }) => {
        attempts.push([generation, referenceID]);
        if (referenceID === "renewal:throws") throw new Error("temporary delivery failure");
        return true;
      },
    },
    now,
  });

  assert.deepEqual(attempts, [
    ["generation-1", "renewal:throws"],
    ["generation-1", "build:expired"],
  ]);
});

test("cleanup promise coalescing ignores later injected dependencies until the pass settles", async () => {
  const coordinator = new DeliveryMaintenanceCoordinator();
  let firstReads = 0;
  let secondReads = 0;
  const first = coordinator.drainCleanupJobsOnce({
    deviceBuildStore: {
      ...emptyBuildStore(),
      listDeliveryReferenceCleanupJobs: () => {
        firstReads += 1;
        return [];
      },
    },
    deviceDelivery: emptyDeliveryAdapter(),
  });
  const second = coordinator.drainCleanupJobsOnce({
    deviceBuildStore: {
      ...emptyBuildStore(),
      listDeliveryReferenceCleanupJobs: () => {
        secondReads += 1;
        return [];
      },
    },
    deviceDelivery: emptyDeliveryAdapter(),
  });

  assert.strictEqual(second, first);
  await first;
  assert.equal(firstReads, 1);
  assert.equal(secondReads, 0);

  await coordinator.drainCleanupJobsOnce({
    deviceBuildStore: {
      ...emptyBuildStore(),
      listDeliveryReferenceCleanupJobs: () => {
        secondReads += 1;
        return [];
      },
    },
    deviceDelivery: emptyDeliveryAdapter(),
  });
  assert.equal(secondReads, 1);
});

test("boundary pass resolves dependencies per stage, runs reconciliation first, and coalesces", async () => {
  const coordinator = new DeliveryMaintenanceCoordinator();
  const order: string[] = [];
  const options = () => {
    order.push("resolve");
    return {
      deviceBuildStore: {
        list: () => {
          order.push("list-builds");
          return [];
        },
        listDeliveryReferenceCleanupJobs: () => {
          order.push("list-cleanup-jobs");
          return [];
        },
        completeDeliveryReferenceCleanupJob: (_jobID: string) => {},
        failDeliveryReferenceCleanupJob: (_jobID: string, _error: unknown) => {},
      },
      deviceDelivery: {
        statuses: () => {
          order.push("list-delivery-statuses");
          return [];
        },
        stopGeneration: (_generation: string, _options: { referenceID: string }) => true,
      },
      now: 1,
    };
  };

  const first = coordinator.runOnce(options);
  const second = coordinator.runOnce(() => {
    throw new Error("coalesced input must not be resolved");
  });
  assert.strictEqual(second, first);
  await first;

  assert.deepEqual(order, [
    "resolve",
    "list-builds",
    "list-delivery-statuses",
    "resolve",
    "list-cleanup-jobs",
  ]);
});

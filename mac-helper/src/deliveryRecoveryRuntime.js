import { ensureDirectoryModeSync } from "./infrastructure/nodeAtomicFileStore.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLiveDeliveryQueue } from "./liveDeliveryQueue.js";
import { createLiveDeliveryRuntime } from "./liveDeliveryRuntime.js";
import { createLiveDeliveryAdapter } from "./liveDeliveryAdapter.js";
import { liveRuntimeLockManager } from "./liveEngineLifecycleLock.js";
import { inspectRuntimeHealth } from "./runtimeHealth.js";
import { createPhase4ProductionStoreFactories } from "./persistence/phase4ProductionStores.js";
import { restoreStoppedLiveEngine } from "./liveReload.js";

// Loaded only by recover-delivery, never imported by the normal helper loop.
export function createDeliveryRecoveryPorts({ repairHelper } = {}) {
  if (typeof repairHelper !== "function")
    throw new TypeError("Recovery requires the CLI lifecycle adapter.");
  const queue = createLiveDeliveryQueue({ lockManager: liveRuntimeLockManager });
  const service = createLiveDeliveryRuntime({ queue, adapter: createLiveDeliveryAdapter() });
  let stores;
  const root = join(homedir(), ".swift-sim");
  return {
    queue,
    status: (id) => service.status(id),
    exclusive: (operation) => {
      ensureDirectoryModeSync(root, 0o700);
      return liveRuntimeLockManager.withLock(
        {
          path: join(root, "delivery-recovery.lock"),
          waitMs: 0,
          staleAfterMs: 1000,
          ownerMode: 0o600,
        },
        operation,
      );
    },
    buildsBusy: () =>
      (stores ||= createPhase4ProductionStoreFactories({ deviceMaintenance: false }))
        .createDeviceBuildStore()
        .list()
        .some((b) =>
          [
            "queued",
            "validating",
            "preparing",
            "archiving",
            "building",
            "exporting",
            "delivering",
          ].includes(b.state),
        ),
    health: () =>
      inspectRuntimeHealth(
        `http://127.0.0.1:${Number(process.env.SWIFT_SIM_PORT || 47217)}/health`,
      ),
    repairHelper,
    restoreStoppedEngine: (record, guard) => restoreStoppedLiveEngine(
      { project: record.scope.project, scheme: record.scope.scheme }, guard,
    ),
  };
}

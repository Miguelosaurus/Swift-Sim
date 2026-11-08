import { ensureDirectoryModeSync } from "./infrastructure/nodeAtomicFileStore.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLiveDeliveryQueue } from "./liveDeliveryQueue.js";
import { createLiveDeliveryRuntime } from "./liveDeliveryRuntime.js";
import { createLiveDeliveryAdapter } from "./liveDeliveryAdapter.js";
import { liveRuntimeLockManager, withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";
import { inspectRuntimeHealth } from "./runtimeHealth.js";
import { createPhase4ProductionStoreFactories } from "./persistence/phase4ProductionStores.js";
import {
  inspectInstalledEngineForSetup,
  withLiveBuildSession,
  inspectLiveReload,
  assertStoppedLiveEngineForRecovery,
} from "./liveReload.js";
import { engineMatchesContract } from "./componentCompatibility.js";
import { readLiveSessionDescriptor } from "./liveSessionDescriptor.js";

// Loaded only by recover-delivery, never imported by the normal helper loop.
export function createDeliveryRecoveryPorts({ reconcileHelper } = {}) {
  if (typeof reconcileHelper !== "function")
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
    async repairHelper({ restart, guard }) {
      await withLiveEngineLifecycleLock(
        async () => {
          guard();
          await reconcileHelper({ startIfStopped: true, restart });
        },
        { waitMs: 1500 },
      );
    },
    async restoreStoppedEngine(record, guard) {
      const options = { project: record.scope.project, scheme: record.scope.scheme };
      const check = async () => {
        guard();
        const descriptor = readLiveSessionDescriptor({
          projectPath: options.project,
          scheme: options.scheme,
        });
        if (!descriptor.valid) throw fail("RECOVERY_BUILD_CONTEXT_REQUIRED");
        if (!engineMatchesContract(inspectInstalledEngineForSetup()))
          throw fail("RECOVERY_COMPONENT_REQUIRED");
        assertStoppedLiveEngineForRecovery();
      };
      await check();
      const before = await inspectLiveReload(options);
      if (!before.tailnet.detected || !before.tailnet.privateForwardConfigured)
        throw fail("RECOVERY_NETWORK_REQUIRED");
      if (before.engine.running) throw fail("RECOVERY_ENGINE_ACTIVE");
      await withLiveBuildSession(
        options,
        async ({ liveSession }) => {
          if (!liveSession.started) throw fail("RECOVERY_ENGINE_UNCONFIRMED");
        },
        {
          beforeStart: check,
          lock: (operation) => withLiveEngineLifecycleLock(operation, { waitMs: 1500 }),
        },
      );
    },
  };
}
function fail(code) {
  return Object.assign(new Error(code), { code });
}

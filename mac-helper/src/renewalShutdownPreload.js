import { requestDeviceBuildCancellation } from "./deviceBuilder.js";
import {
  createBoundaryProductionStoreFactory,
  defaultBoundaryStateRoot,
} from "./http/phase4BoundaryStoreFactory.js";
import { setHelperHttpBoundaryMaintenanceForShutdown } from "./helperHttpBoundaryPreload.js";

let installed = false;
let shuttingDown = false;
let defaultDeviceBuildStore;

export function installRenewalShutdownGuard() {
  if (installed) return;
  installed = true;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      cancelPersistedRenewalsForShutdown();
    } catch {}
  };
  process.prependOnceListener("SIGTERM", shutdown);
  process.prependOnceListener("SIGINT", shutdown);
}

export function cancelPersistedRenewalsForShutdown({
  deviceBuildStore = boundaryBuildStore(),
  cancelBuild = requestDeviceBuildCancellation,
  reason = "Swift Sim helper is shutting down during install-link renewal.",
} = {}) {
  let cancelled = 0;
  for (const build of deviceBuildStore.list()) {
    if (!build?.pendingRenewal?.id) continue;
    if (cancelBuild(build, reason)) cancelled += 1;
  }
  try {
    const currentBuilds =
      typeof deviceBuildStore?.listDeliveryReferenceCleanupJobs === "function"
        ? deviceBuildStore
        : undefined;
    if (currentBuilds) {
      setHelperHttpBoundaryMaintenanceForShutdown({ deviceBuildStore });
    }
  } catch {
    // Shutdown maintenance is best-effort. A failed delivery cleanup must not
    // mask the renewal cancellation result or block process exit.
  }
  return { cancelled };
}

function boundaryBuildStore() {
  defaultDeviceBuildStore ??= createBoundaryProductionStoreFactory({
    stateRoot: defaultBoundaryStateRoot(),
  }).createDeviceBuildStore();
  return defaultDeviceBuildStore;
}

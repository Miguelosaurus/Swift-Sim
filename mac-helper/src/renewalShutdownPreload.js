import { DeviceBuildStore } from "./deviceBuildStore.js";
import { requestDeviceBuildCancellation } from "./deviceBuilder.js";

let installed = false;
let shuttingDown = false;

export function installRenewalShutdownGuard() {
  if (installed) return;
  installed = true;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { cancelPersistedRenewalsForShutdown(); } catch {}
  };
  process.prependOnceListener("SIGTERM", shutdown);
  process.prependOnceListener("SIGINT", shutdown);
}

export function cancelPersistedRenewalsForShutdown({
  deviceBuildStore = new DeviceBuildStore({ maintenance: false }),
  cancelBuild = requestDeviceBuildCancellation,
  reason = "Swift Sim helper is shutting down during install-link renewal.",
} = {}) {
  let cancelled = 0;
  for (const build of deviceBuildStore.list()) {
    if (!build?.pendingRenewal?.id) continue;
    if (cancelBuild(build, reason)) cancelled += 1;
  }
  return { cancelled };
}

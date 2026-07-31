import { DeviceBuildStore } from "./deviceBuildStore.js";
import { DeviceDeliveryAdapter } from "./deviceDelivery.js";
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
  deviceDelivery = new DeviceDeliveryAdapter(),
  cancelBuild = requestDeviceBuildCancellation,
  reason = "Swift Sim helper is shutting down during install-link renewal.",
} = {}) {
  const renewalReferences = new Set();
  let cancelled = 0;
  for (const build of deviceBuildStore.list()) {
    const renewalID = String(build?.pendingRenewal?.id || "");
    if (!renewalID) continue;
    renewalReferences.add(`renewal:${renewalID}`);
    if (cancelBuild(build, reason)) cancelled += 1;
  }

  let released = 0;
  for (const status of deviceDelivery.statuses()) {
    for (const referenceID of Array.isArray(status.references) ? status.references : []) {
      if (!renewalReferences.has(referenceID)) continue;
      try {
        if (deviceDelivery.stopGeneration(status.generation, { referenceID })) released += 1;
      } catch {
        // The durable reference remains for startup reconciliation if ownership
        // cannot be safely resolved during signal handling.
      }
    }
  }
  return { cancelled, released };
}

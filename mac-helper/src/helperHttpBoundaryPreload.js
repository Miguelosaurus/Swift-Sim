import { createRequire, syncBuiltinESMExports } from "node:module";
import { DeviceBuildStore } from "./deviceBuildStore.js";
import { DeviceDeliveryAdapter } from "./deviceDelivery.js";
import { writeHelperJson } from "./http/helperHttpResponses.js";
import { handlePairingFallbackRequest } from "./http/pairingFallbackHandler.js";
import {
  handlePublicBuildExpiryRequest,
  handlePublicBuildLogsRequest,
} from "./http/publicBuildCapabilityHandlers.js";
import { LoopbackRequestOriginPolicy } from "./infrastructure/loopbackRequestOriginPolicy.js";
import { PairingInviteStore } from "./pairingInviteStore.js";
import { PairingStore } from "./pairingStore.js";

const require = createRequire(import.meta.url);
const http = require("node:http");
const originalCreateServer = http.createServer;
const DELIVERY_CLEANUP_INTERVAL_MS = 30_000;
const ACTIVE_BUILD_STATES = new Set([
  "queued",
  "validating",
  "preparing",
  "archiving",
  "building",
  "exporting",
  "delivering",
]);
let defaultPairingStore;
let defaultPairingInviteStore;
let defaultDeviceBuildStore;
let defaultDeviceDelivery;
let defaultRequestOriginPolicy;
let deliveryCleanupPromise;
let deliveryReconciliationPromise;
let boundaryMaintenancePromise;
let maintenanceTimer;
let installed = false;

export function installHelperHttpBoundary() {
  if (installed) return;
  installed = true;
  http.createServer = function guardedCreateServer(options, listener) {
    let resolvedOptions = options;
    let resolvedListener = listener;
    if (typeof options === "function") {
      resolvedListener = options;
      resolvedOptions = undefined;
    }
    const guardedListener = typeof resolvedListener === "function"
      ? (req, res) => {
          try {
            if (handlePairingFallback(req, res)) return;
            if (handlePublicBuildExpiry(req, res)) return;
            if (handlePublicBuildLogs(req, res)) return;
          } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            if (!res.headersSent) {
              writeHelperJson(res, 503, { error: "Swift Sim is temporarily unavailable." });
            } else {
              res.destroy(error instanceof Error ? error : undefined);
            }
            return;
          }
          return resolvedListener(req, res);
        }
      : resolvedListener;
    const server = resolvedOptions === undefined
      ? originalCreateServer.call(this, guardedListener)
      : originalCreateServer.call(this, resolvedOptions, guardedListener);
    startBoundaryMaintenance();
    return server;
  };
  syncBuiltinESMExports();
}

export function handlePairingFallback(
  req,
  res,
  store = pairingStore(),
  invites = pairingInviteStore(),
  originPolicy = requestOriginPolicy(),
) {
  return handlePairingFallbackRequest(req, res, store, invites, originPolicy);
}

export function handlePublicBuildExpiry(req, res, {
  pairingStore: pairings = pairingStore(),
  deviceBuildStore: builds = buildStore(),
} = {}) {
  return handlePublicBuildExpiryRequest(req, res, {
    pairingStore: pairings,
    deviceBuildStore: builds,
  });
}

export function handlePublicBuildLogs(req, res, {
  pairingStore: pairings = pairingStore(),
  deviceBuildStore: builds = buildStore(),
} = {}) {
  return handlePublicBuildLogsRequest(req, res, {
    pairingStore: pairings,
    deviceBuildStore: builds,
  });
}

export function drainDeliveryReferenceCleanupJobsOnce({
  deviceBuildStore: builds = buildStore(),
  deviceDelivery: delivery = deliveryStore(),
  now = Date.now(),
} = {}) {
  if (deliveryCleanupPromise) return deliveryCleanupPromise;
  deliveryCleanupPromise = Promise.resolve().then(() => {
    for (const job of builds.listDeliveryReferenceCleanupJobs()) {
      const dueAt = Date.parse(job.nextAttemptAt || job.createdAt || "");
      if (Number.isFinite(dueAt) && dueAt > now) continue;
      try {
        const released = delivery.stopGeneration(job.generation, { referenceID: job.referenceID });
        if (!released) throw new Error("Delivery generation is still referenced or could not be stopped.");
        builds.completeDeliveryReferenceCleanupJob(job.id);
      } catch (error) {
        builds.failDeliveryReferenceCleanupJob(job.id, error);
      }
    }
  }).finally(() => {
    deliveryCleanupPromise = undefined;
  });
  return deliveryCleanupPromise;
}

export function reconcileDeliveryReferencesOnce({
  deviceBuildStore: builds = buildStore(),
  deviceDelivery: delivery = deliveryStore(),
  now = Date.now(),
} = {}) {
  if (deliveryReconciliationPromise) return deliveryReconciliationPromise;
  deliveryReconciliationPromise = Promise.resolve().then(() => {
    const liveReferences = new Set();
    for (const build of builds.list()) {
      const currentExpiresAt = Date.parse(build.expiresAt || "");
      if (Number.isFinite(currentExpiresAt) && currentExpiresAt > now) {
        addDeliveryReference(liveReferences, build.delivery);
      }
      for (const capability of Array.isArray(build.capabilities) ? build.capabilities : []) {
        const expiresAt = Date.parse(capability?.expiresAt || "");
        if (Number.isFinite(expiresAt) && expiresAt > now) {
          addDeliveryReference(liveReferences, capability.delivery);
        }
      }
      if (build.pendingRenewal?.id) {
        liveReferences.add(`renewal:${build.pendingRenewal.id}`);
      }
      if (ACTIVE_BUILD_STATES.has(build.state)) {
        liveReferences.add(`build:${build.id}`);
      }
    }

    for (const status of delivery.statuses()) {
      for (const referenceID of Array.isArray(status.references) ? status.references : []) {
        if (!isManagedReference(referenceID) || liveReferences.has(referenceID)) continue;
        try {
          delivery.stopGeneration(status.generation, { referenceID });
        } catch {
          // A later maintenance pass retries surviving state. Never make helper
          // startup depend on a best-effort orphan reconciliation.
        }
      }
    }
  }).finally(() => {
    deliveryReconciliationPromise = undefined;
  });
  return deliveryReconciliationPromise;
}

export function runBoundaryMaintenanceOnce(options = {}) {
  if (boundaryMaintenancePromise) return boundaryMaintenancePromise;
  boundaryMaintenancePromise = Promise.resolve()
    .then(() => reconcileDeliveryReferencesOnce(options))
    .then(() => drainDeliveryReferenceCleanupJobsOnce(options))
    .finally(() => {
      boundaryMaintenancePromise = undefined;
    });
  return boundaryMaintenancePromise;
}

function startBoundaryMaintenance() {
  if (maintenanceTimer) return;
  void runBoundaryMaintenanceOnce().catch(() => {});
  maintenanceTimer = setInterval(() => {
    void runBoundaryMaintenanceOnce().catch(() => {});
  }, DELIVERY_CLEANUP_INTERVAL_MS);
  maintenanceTimer.unref?.();
}

function addDeliveryReference(set, delivery) {
  if (delivery?.referenceID) set.add(String(delivery.referenceID));
}

function isManagedReference(referenceID) {
  return /^(?:build|renewal):/.test(String(referenceID || ""));
}

function pairingStore() {
  defaultPairingStore ||= new PairingStore();
  return defaultPairingStore;
}

function pairingInviteStore() {
  defaultPairingInviteStore ||= new PairingInviteStore();
  return defaultPairingInviteStore;
}

function requestOriginPolicy() {
  defaultRequestOriginPolicy ||= new LoopbackRequestOriginPolicy();
  return defaultRequestOriginPolicy;
}

function buildStore() {
  defaultDeviceBuildStore ||= new DeviceBuildStore({ maintenance: false });
  return defaultDeviceBuildStore;
}

function deliveryStore() {
  defaultDeviceDelivery ||= new DeviceDeliveryAdapter();
  return defaultDeviceDelivery;
}

installHelperHttpBoundary();

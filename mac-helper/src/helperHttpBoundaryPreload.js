import { createRequire, syncBuiltinESMExports } from "node:module";
import { DeviceBuildStore } from "./deviceBuildStore.js";
import { DeviceDeliveryAdapter } from "./deviceDelivery.js";
import { DeliveryMaintenanceCoordinator } from "./http/deliveryMaintenanceCoordinator.js";
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
let defaultPairingStore;
let defaultPairingInviteStore;
let defaultDeviceBuildStore;
let defaultDeviceDelivery;
let defaultRequestOriginPolicy;
let defaultDeliveryMaintenance;
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
  return deliveryMaintenance().drainCleanupJobsOnce({
    deviceBuildStore: builds,
    deviceDelivery: delivery,
    now,
  });
}

export function reconcileDeliveryReferencesOnce({
  deviceBuildStore: builds = buildStore(),
  deviceDelivery: delivery = deliveryStore(),
  now = Date.now(),
} = {}) {
  return deliveryMaintenance().reconcileReferencesOnce({
    deviceBuildStore: builds,
    deviceDelivery: delivery,
    now,
  });
}

export function runBoundaryMaintenanceOnce(options = {}) {
  return deliveryMaintenance().runOnce(() => resolveDeliveryMaintenanceOptions(options));
}

function resolveDeliveryMaintenanceOptions({
  deviceBuildStore: builds = buildStore(),
  deviceDelivery: delivery = deliveryStore(),
  now = Date.now(),
} = {}) {
  return {
    deviceBuildStore: builds,
    deviceDelivery: delivery,
    now,
  };
}

function startBoundaryMaintenance() {
  if (maintenanceTimer) return;
  void runBoundaryMaintenanceOnce().catch(() => {});
  maintenanceTimer = setInterval(() => {
    void runBoundaryMaintenanceOnce().catch(() => {});
  }, DELIVERY_CLEANUP_INTERVAL_MS);
  maintenanceTimer.unref?.();
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

function deliveryMaintenance() {
  defaultDeliveryMaintenance ||= new DeliveryMaintenanceCoordinator();
  return defaultDeliveryMaintenance;
}

installHelperHttpBoundary();

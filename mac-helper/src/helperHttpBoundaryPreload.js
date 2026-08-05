import { createRequire, syncBuiltinESMExports } from "node:module";
import { DeviceBuildStore } from "./deviceBuildStore.js";
import { DeviceDeliveryAdapter } from "./deviceDelivery.js";
import { DeliveryMaintenanceCoordinator } from "./http/deliveryMaintenanceCoordinator.js";
import { HelperHttpBoundaryRuntime } from "./http/helperHttpBoundaryRuntime.js";
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
let defaultHttpRuntime;

export function installHelperHttpBoundary() {
  return httpBoundaryRuntime().install();
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

function dispatchHelperHttpRequest(req, res) {
  if (handlePairingFallback(req, res)) return true;
  if (handlePublicBuildExpiry(req, res)) return true;
  if (handlePublicBuildLogs(req, res)) return true;
  return false;
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

function httpBoundaryRuntime() {
  defaultHttpRuntime ||= new HelperHttpBoundaryRuntime({
    httpModule: http,
    originalCreateServer,
    syncBuiltinExports: syncBuiltinESMExports,
    dispatchRequest: dispatchHelperHttpRequest,
    writeUnavailable(response) {
      writeHelperJson(response, 503, { error: "Swift Sim is temporarily unavailable." });
    },
    reportError(error) {
      console.error(error instanceof Error ? error.message : String(error));
    },
    runMaintenance: () => runBoundaryMaintenanceOnce(),
    scheduleInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
    maintenanceIntervalMs: DELIVERY_CLEANUP_INTERVAL_MS,
  });
  return defaultHttpRuntime;
}

installHelperHttpBoundary();

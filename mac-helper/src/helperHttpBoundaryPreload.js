import { createRequire, syncBuiltinESMExports } from "node:module";
import { DeviceBuildStore } from "./deviceBuildStore.js";
import { DeviceDeliveryAdapter } from "./deviceDelivery.js";
import { DeliveryMaintenanceCoordinator } from "./http/deliveryMaintenanceCoordinator.js";
import { HelperHttpBoundaryRuntime } from "./http/helperServerRuntime.js";
import { writeHelperJson } from "./http/helperHttpResponses.js";
import { handlePairingFallbackRequest } from "./http/pairingFallbackHandler.js";
import {
  handlePublicBuildExpiryRequest,
  handlePublicBuildLogsRequest,
} from "./http/publicBuildCapabilityHandlers.js";
import { LoopbackRequestOriginPolicy } from "./infrastructure/loopbackRequestOriginPolicy.js";
import { PairingInviteStore } from "./pairingInviteStore.js";
import { PairingStore } from "./pairingStore.js";
import {
  createBoundaryProductionStoreFactory,
  defaultBoundaryStateRoot,
} from "./http/phase4BoundaryStoreFactory.js";

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
let productionStoreFactory;

/**
 * Route every helper HTTP pairing/invitation/device-build boundary through the
 * one product-global Phase-4 selector. The factory is resolved at first
 * request; importing this module never opens state.sqlite or constructs a
 * legacy store. Tests may inject a disposable state root or factory.
 */
export function setHelperHttpBoundaryFactories({ factory, stateRoot } = {}) {
  if (factory) {
    if (typeof factory !== "function") {
      throw new TypeError("Helper HTTP boundary factory must be a function.");
    }
    productionStoreFactory = factory;
  } else if (stateRoot) {
    productionStoreFactory = () =>
      createBoundaryProductionStoreFactory({ stateRoot: String(stateRoot) });
  } else {
    productionStoreFactory = () => createBoundaryProductionStoreFactory();
  }
  defaultPairingStore = undefined;
  defaultPairingInviteStore = undefined;
  defaultDeviceBuildStore = undefined;
}

export function installHelperHttpBoundary() {
  return httpBoundaryRuntime().install();
}

export function handlePairingFallback(
  req,
  res,
  suppliedStore,
  suppliedInvites,
  suppliedOriginPolicy,
) {
  const store = suppliedStore ?? pairingStore();
  const invites =
    suppliedInvites ??
    (String(req?.url || "").includes("invite=") ? pairingInviteStore() : undefined);
  const originPolicy = suppliedOriginPolicy ?? requestOriginPolicy();
  return handlePairingFallbackRequest(req, res, store, invites, originPolicy);
}

export function handlePublicBuildExpiry(
  req,
  res,
  { pairingStore: suppliedPairings, deviceBuildStore: suppliedBuilds } = {},
) {
  const pairings = suppliedPairings ?? pairingStore();
  const builds = suppliedBuilds ?? buildStore();
  return handlePublicBuildExpiryRequest(req, res, {
    pairingStore: pairings,
    deviceBuildStore: builds,
  });
}

export function handlePublicBuildLogs(
  req,
  res,
  { pairingStore: suppliedPairings, deviceBuildStore: suppliedBuilds } = {},
) {
  const pairings = suppliedPairings ?? pairingStore();
  const builds = suppliedBuilds ?? buildStore();
  return handlePublicBuildLogsRequest(req, res, {
    pairingStore: pairings,
    deviceBuildStore: builds,
  });
}

export function drainDeliveryReferenceCleanupJobsOnce({
  deviceBuildStore: suppliedBuilds,
  deviceDelivery: suppliedDelivery,
  now = Date.now(),
} = {}) {
  const builds = suppliedBuilds ?? buildStore();
  const delivery = suppliedDelivery ?? deliveryStore();
  return deliveryMaintenance().drainCleanupJobsOnce({
    deviceBuildStore: builds,
    deviceDelivery: delivery,
    now,
  });
}

export function reconcileDeliveryReferencesOnce({
  deviceBuildStore: suppliedBuilds,
  deviceDelivery: suppliedDelivery,
  now = Date.now(),
} = {}) {
  const builds = suppliedBuilds ?? buildStore();
  const delivery = suppliedDelivery ?? deliveryStore();
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
  deviceBuildStore: suppliedBuilds,
  deviceDelivery: suppliedDelivery,
  now = Date.now(),
} = {}) {
  const builds = suppliedBuilds ?? buildStore();
  const delivery = suppliedDelivery ?? deliveryStore();
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
  defaultPairingStore ||= resolvedBoundaryFactory().createPairingStore();
  return defaultPairingStore;
}

function pairingInviteStore() {
  defaultPairingInviteStore ||= resolvedBoundaryFactory().createPairingInviteStore();
  return defaultPairingInviteStore;
}

function requestOriginPolicy() {
  defaultRequestOriginPolicy ||= new LoopbackRequestOriginPolicy();
  return defaultRequestOriginPolicy;
}

function buildStore() {
  defaultDeviceBuildStore ||= resolvedBoundaryFactory().createDeviceBuildStore();
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

function resolvedBoundaryFactory() {
  productionStoreFactory ||= () =>
    createBoundaryProductionStoreFactory({ stateRoot: defaultBoundaryStateRoot() });
  return productionStoreFactory();
}

function httpBoundaryRuntime() {
  defaultHttpRuntime ||= new HelperHttpBoundaryRuntime({
    originalCreateServer,
    replaceCreateServer(createServer) {
      http.createServer = createServer;
    },
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

export function setHelperHttpBoundaryMaintenanceForShutdown({
  deviceBuildStore: builds = buildStore(),
  deviceDelivery: delivery = deliveryStore(),
  now = Date.now(),
} = {}) {
  return deliveryMaintenance().runOnce({
    deviceBuildStore: builds,
    deviceDelivery: delivery,
    now,
  });
}

// @ts-check

import { DeviceDeliveryAdapter } from "../deviceDelivery.js";
import { DeviceInventoryAdapter } from "../deviceInventory.js";
import { ServeSimAdapter } from "../serveSimAdapter.js";
import { SimulatorProfileResolver } from "../simulatorProfile.js";
import { NativeCompanionTransport } from "../transports/nativeCompanionTransport.js";
import { SystemIdGenerator } from "./systemIdGenerator.js";
import { SystemClock } from "./systemClock.js";
import { ServeSimTransport } from "../transports/serveSimTransport.js";
import { createPhase4ProductionStoreFactories } from "../persistence/phase4ProductionStores.js";

/**
 * @typedef {{
 *   createSessionStore(): import("../sessionStore.js").SessionStore,
 *   createDeviceBuildStore(): import("../deviceBuildStore.js").DeviceBuildStore,
 *   createDeviceDelivery(): DeviceDeliveryAdapter,
 *   createPairingStore(): import("../pairingStore.js").PairingStore,
 *   createPairingInviteStore(): import("../pairingInviteStore.js").PairingInviteStore,
 *   createSimulatorProfiles(): SimulatorProfileResolver,
 *   createDeviceInventory(): DeviceInventoryAdapter,
 *   createServeSimAdapter(): ServeSimAdapter,
 *   createServeSimTransport(input: { adapter: ServeSimAdapter }): ServeSimTransport,
 *   createNativeCompanionTransport(input: { adapter: ServeSimAdapter }): NativeCompanionTransport,
 *   createIdGenerator(): SystemIdGenerator,
 *   createClock(): SystemClock,
 * }} CompatibilityHelperFactories
 * @typedef {{
 *   store: import("../sessionStore.js").SessionStore,
 *   deviceBuildStore: import("../deviceBuildStore.js").DeviceBuildStore,
 *   deviceDelivery: DeviceDeliveryAdapter,
 *   pairingStore: import("../pairingStore.js").PairingStore,
 *   pairingInviteStore: import("../pairingInviteStore.js").PairingInviteStore,
 *   simulatorProfiles: SimulatorProfileResolver,
 *   deviceInventory: DeviceInventoryAdapter,
 *   adapter: ServeSimAdapter,
 *   idGenerator: SystemIdGenerator,
 *   clock: SystemClock,
 *   transports: {
 *     "serve-sim": ServeSimTransport,
 *     "native-companion": NativeCompanionTransport,
 *   },
 * }} CompatibilityHelperRuntime
 */

/** @returns {CompatibilityHelperFactories} */
function defaultFactories() {
  const phase4 = createPhase4ProductionStoreFactories();
  return {
    createSessionStore: phase4.createSessionStore,
    createDeviceBuildStore: phase4.createDeviceBuildStore,
    createDeviceDelivery: () => new DeviceDeliveryAdapter(),
    createPairingStore: phase4.createPairingStore,
    createPairingInviteStore: phase4.createPairingInviteStore,
    createSimulatorProfiles: () => new SimulatorProfileResolver(),
    createDeviceInventory: () => new DeviceInventoryAdapter(),
    createServeSimAdapter: () => new ServeSimAdapter(),
    createServeSimTransport: ({ adapter }) => new ServeSimTransport({ adapter }),
    createNativeCompanionTransport: ({ adapter }) => new NativeCompanionTransport({ adapter }),
    createIdGenerator: () => new SystemIdGenerator(),
    createClock: () => new SystemClock(),
  };
}

/**
 * @param {{ factories?: Partial<CompatibilityHelperFactories> }} [options]
 * @returns {CompatibilityHelperRuntime}
 */
export function createCompatibilityHelperRuntime({ factories = defaultFactories() } = {}) {
  const resolved = requireFactories(factories);
  const pairingStore = resolved.createPairingStore();
  const adapter = resolved.createServeSimAdapter();
  const idGenerator = resolved.createIdGenerator();
  const clock = resolved.createClock();
  return {
    store: resolved.createSessionStore(),
    deviceBuildStore: resolved.createDeviceBuildStore(),
    deviceDelivery: resolved.createDeviceDelivery(),
    pairingStore,
    pairingInviteStore: resolved.createPairingInviteStore(),
    simulatorProfiles: resolved.createSimulatorProfiles(),
    deviceInventory: resolved.createDeviceInventory(),
    adapter,
    idGenerator,
    clock,
    transports: {
      "serve-sim": resolved.createServeSimTransport({ adapter }),
      "native-companion": resolved.createNativeCompanionTransport({ adapter }),
    },
  };
}

/**
 * @param {Partial<CompatibilityHelperFactories>} factories
 * @returns {CompatibilityHelperFactories}
 */
function requireFactories(factories) {
  /** @type {(keyof CompatibilityHelperFactories)[]} */
  const required = [
    "createPairingStore",
    "createServeSimAdapter",
    "createIdGenerator",
    "createClock",
    "createSessionStore",
    "createDeviceBuildStore",
    "createDeviceDelivery",
    "createPairingInviteStore",
    "createSimulatorProfiles",
    "createDeviceInventory",
    "createServeSimTransport",
    "createNativeCompanionTransport",
  ];
  for (const name of required) {
    if (typeof factories?.[name] !== "function") {
      throw new TypeError(`Compatibility helper runtime requires ${name}.`);
    }
  }
  return /** @type {CompatibilityHelperFactories} */ (/** @type {unknown} */ (factories));
}

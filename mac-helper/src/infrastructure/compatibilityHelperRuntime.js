// @ts-check

import { DeviceBuildStore } from "../deviceBuildStore.js";
import { DeviceDeliveryAdapter } from "../deviceDelivery.js";
import { DeviceInventoryAdapter } from "../deviceInventory.js";
import { PairingInviteStore } from "../pairingInviteStore.js";
import { PairingStore } from "../pairingStore.js";
import { ServeSimAdapter } from "../serveSimAdapter.js";
import { SessionStore } from "../sessionStore.js";
import { SimulatorProfileResolver } from "../simulatorProfile.js";
import { NativeCompanionTransport } from "../transports/nativeCompanionTransport.js";
import { SystemIdGenerator } from "./systemIdGenerator.js";
import { SystemClock } from "./systemClock.js";
import { ServeSimTransport } from "../transports/serveSimTransport.js";

/**
 * @typedef {{
 *   createSessionStore(): SessionStore,
 *   createDeviceBuildStore(): DeviceBuildStore,
 *   createDeviceDelivery(): DeviceDeliveryAdapter,
 *   createPairingStore(): PairingStore,
 *   createPairingInviteStore(): PairingInviteStore,
 *   createSimulatorProfiles(): SimulatorProfileResolver,
 *   createDeviceInventory(): DeviceInventoryAdapter,
 *   createServeSimAdapter(): ServeSimAdapter,
 *   createServeSimTransport(input: { adapter: ServeSimAdapter }): ServeSimTransport,
 *   createNativeCompanionTransport(input: { adapter: ServeSimAdapter }): NativeCompanionTransport,
 *   createIdGenerator(): SystemIdGenerator,
 *   createClock(): SystemClock,
 * }} CompatibilityHelperFactories
 * @typedef {{
 *   store: SessionStore,
 *   deviceBuildStore: DeviceBuildStore,
 *   deviceDelivery: DeviceDeliveryAdapter,
 *   pairingStore: PairingStore,
 *   pairingInviteStore: PairingInviteStore,
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
  return {
    createSessionStore: () => new SessionStore(),
    createDeviceBuildStore: () => new DeviceBuildStore(),
    createDeviceDelivery: () => new DeviceDeliveryAdapter(),
    createPairingStore: () => new PairingStore(),
    createPairingInviteStore: () => new PairingInviteStore(),
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
  // PairingStore is the compatibility owner of the shared private state root.
  // Construct it before repositories that acquire files/locks beneath that root.
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

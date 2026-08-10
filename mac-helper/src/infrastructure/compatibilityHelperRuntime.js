import { DeviceBuildStore } from "../deviceBuildStore.js";
import { DeviceDeliveryAdapter } from "../deviceDelivery.js";
import { DeviceInventoryAdapter } from "../deviceInventory.js";
import { PairingInviteStore } from "../pairingInviteStore.js";
import { PairingStore } from "../pairingStore.js";
import { ServeSimAdapter } from "../serveSimAdapter.js";
import { SessionStore } from "../sessionStore.js";
import { SimulatorProfileResolver } from "../simulatorProfile.js";
import { NativeCompanionTransport } from "../transports/nativeCompanionTransport.js";
import { ServeSimTransport } from "../transports/serveSimTransport.js";

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
  };
}

export function createCompatibilityHelperRuntime({ factories = defaultFactories() } = {}) {
  // PairingStore is the compatibility owner of the shared private state root.
  // Construct it before repositories that acquire files/locks beneath that root.
  const pairingStore = callFactory(factories, "createPairingStore");
  const adapter = callFactory(factories, "createServeSimAdapter");
  return {
    store: callFactory(factories, "createSessionStore"),
    deviceBuildStore: callFactory(factories, "createDeviceBuildStore"),
    deviceDelivery: callFactory(factories, "createDeviceDelivery"),
    pairingStore,
    pairingInviteStore: callFactory(factories, "createPairingInviteStore"),
    simulatorProfiles: callFactory(factories, "createSimulatorProfiles"),
    deviceInventory: callFactory(factories, "createDeviceInventory"),
    adapter,
    activeDeviceBuildTasks: new Map(),
    transports: {
      "serve-sim": callFactory(factories, "createServeSimTransport", { adapter }),
      "native-companion": callFactory(factories, "createNativeCompanionTransport", { adapter }),
    },
  };
}

function callFactory(factories, name, input) {
  const factory = factories?.[name];
  if (typeof factory !== "function") {
    throw new TypeError(`Compatibility helper runtime requires ${name}.`);
  }
  return input === undefined ? factory() : factory(input);
}

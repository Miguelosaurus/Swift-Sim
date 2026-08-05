// @ts-check

import { DeviceBuildStore } from "./deviceBuildStore.js";
import { DeviceDeliveryAdapter } from "./deviceDelivery.js";
import { DeviceInventoryAdapter } from "./deviceInventory.js";
import { publicDeviceApp, publicDeviceBuild } from "./deviceBuilder.js";
import { PairingStore } from "./pairingStore.js";
import { PairingInviteStore } from "./pairingInviteStore.js";
import { buildPairingLinks } from "./links.js";
import { ServeSimAdapter } from "./serveSimAdapter.js";
import { printQRCode } from "./terminalQRCode.js";
import { dispatchHelperCliCommand, helperCliCommandIsExtracted } from "./helperCliDispatcher.js";

/**
 * @typedef {{ token: string, installationID: string, macName: string }} PairingState
 * @typedef {{
 *   current(): PairingState,
 *   rotate(): PairingState,
 *   updateMacName(macName?: string): PairingState,
 * }} PairingStorePort
 * @typedef {{
 *   create(input: { pairing: PairingState, ttlMs?: number }): {
 *     invite: string,
 *     expiresAt: string,
 *   },
 * }} PairingInviteWriter
 * @typedef {{
 *   listApps(input: { includeArchived: boolean }): unknown[],
 *   setAppArchived(appID: string, archived: boolean): unknown | null,
 *   get(buildID: string): {
 *     id: string,
 *     app: { bundleIdentifier: string, version: string, build: string },
 *   } | null,
 *   saveVerification(buildID: string, verification: unknown): unknown,
 * }} DeviceBuildStorePort
 * @typedef {{
 *   verifyApp(bundleIdentifier: string, version: { version: string, build: string }): Promise<unknown>,
 * }} DeviceInventoryPort
 * @typedef {{ status(): unknown, stop(): boolean }} DeviceDeliveryPort
 * @typedef {{ inspect(): Promise<unknown> }} ServeSimPort
 */

const DEFAULT_FACTORIES = Object.freeze({
  createStateRootStore: () => new PairingStore(),
  createPairingInviteStore: () => new PairingInviteStore(),
  createDeviceBuildStore: () => new DeviceBuildStore(),
  createDeviceInventory: () => new DeviceInventoryAdapter(),
  createDeviceDelivery: () => new DeviceDeliveryAdapter(),
  createServeSim: () => new ServeSimAdapter(),
});

/**
 * Compose only the services required by the selected one-shot command.
 *
 * Current filesystem repositories assume the shared private root already
 * exists. PairingStore remains the explicit compatibility owner of that root
 * until Phase 4 replaces the legacy repositories.
 *
 * @param {string} command
 * @param {{
 *   factories?: Record<string, unknown>,
 *   printQRCode?: (value: string) => void,
 * }} [options]
 * @returns {Record<string, unknown>}
 */
export function createExtractedHelperServices(command, options = {}) {
  const factories = options.factories || DEFAULT_FACTORIES;
  const qrPrinter = options.printQRCode || printQRCode;
  if (typeof qrPrinter !== "function") {
    throw new TypeError("Extracted helper services require a QR printer.");
  }

  if (command === "pair") {
    return createPairingServices(factories, stateRootStore(factories), qrPrinter);
  }
  if (command === "list-apps" || command === "archive-app") {
    stateRootStore(factories);
    return createDeviceAppServices(factories);
  }
  if (command === "verify-device-build") {
    stateRootStore(factories);
    return createDeviceBuildVerificationServices(factories);
  }
  if (command === "device-delivery-status" || command === "device-delivery-stop") {
    stateRootStore(factories);
    return createDeviceDeliveryServices(factories);
  }
  if (command === "serve-sim-info") {
    return createServeSimServices(factories);
  }
  throw new Error(`Unknown extracted helper command: ${command}`);
}

/**
 * Commands outside the extracted set return false before any compatibility
 * root owner, store, or adapter is constructed.
 *
 * @param {string[]} argv
 * @param {{
 *   writeLine?: (line: string) => void,
 *   printQRCode?: (value: string) => void,
 *   factories?: Record<string, unknown>,
 * }} [options]
 */
export async function runExtractedHelperCommand(argv, options = {}) {
  const command = argv[0];
  if (!helperCliCommandIsExtracted(command)) return false;
  return dispatchHelperCliCommand({
    argv,
    services: createExtractedHelperServices(command, options),
    ...(options.writeLine === undefined ? {} : { writeLine: options.writeLine }),
  });
}

/**
 * @param {Record<string, unknown>} factories
 * @param {PairingStorePort} pairingStore
 * @param {(value: string) => void} qrPrinter
 */
function createPairingServices(factories, pairingStore, qrPrinter) {
  const pairingInvites = /** @type {PairingInviteWriter} */ (
    /** @type {unknown} */ (requiredFactory(factories, "createPairingInviteStore")())
  );
  return {
    pair({ rotate, macName, qr, ttlMs, remoteBaseUrl }) {
      let pairing = rotate ? pairingStore.rotate() : pairingStore.current();
      pairing = pairingStore.updateMacName(macName);
      const invite = qr
        ? pairingInvites.create({
            pairing,
            ...(ttlMs === undefined ? {} : { ttlMs }),
          })
        : null;
      const links = buildPairingLinks(
        invite ? { ...pairing, invite: invite.invite, expiresAt: invite.expiresAt } : pairing,
        remoteBaseUrl,
      );
      return {
        macName: pairing.macName,
        links,
        ...(invite ? { expiresAt: invite.expiresAt } : {}),
      };
    },
    printQRCode: qrPrinter,
  };
}

/** @param {Record<string, unknown>} factories */
function createDeviceAppServices(factories) {
  const deviceBuildStore = deviceBuildStore(factories);
  return {
    listApps({ includeArchived }) {
      return deviceBuildStore.listApps({ includeArchived }).map(publicDeviceApp);
    },
    archiveApp({ appID, archived }) {
      const app = deviceBuildStore.setAppArchived(appID, archived);
      return app ? publicDeviceApp(app) : null;
    },
  };
}

/** @param {Record<string, unknown>} factories */
function createDeviceBuildVerificationServices(factories) {
  const deviceBuildStore = deviceBuildStore(factories);
  const deviceInventory = /** @type {DeviceInventoryPort} */ (
    /** @type {unknown} */ (requiredFactory(factories, "createDeviceInventory")())
  );
  return {
    async verifyDeviceBuild(buildID) {
      const build = deviceBuildStore.get(buildID);
      if (!build) throw new Error("Unknown device build.");
      const verification = await deviceInventory.verifyApp(build.app.bundleIdentifier, {
        version: build.app.version,
        build: build.app.build,
      });
      return publicDeviceBuild(deviceBuildStore.saveVerification(build.id, verification));
    },
  };
}

/** @param {Record<string, unknown>} factories */
function createDeviceDeliveryServices(factories) {
  const deviceDelivery = /** @type {DeviceDeliveryPort} */ (
    /** @type {unknown} */ (requiredFactory(factories, "createDeviceDelivery")())
  );
  return {
    deviceDeliveryStatus: () => deviceDelivery.status(),
    stopDeviceDelivery: () => deviceDelivery.stop(),
  };
}

/** @param {Record<string, unknown>} factories */
function createServeSimServices(factories) {
  const serveSim = /** @type {ServeSimPort} */ (
    /** @type {unknown} */ (requiredFactory(factories, "createServeSim")())
  );
  return {
    inspectServeSim: () => serveSim.inspect(),
  };
}

/** @param {Record<string, unknown>} factories */
function stateRootStore(factories) {
  return /** @type {PairingStorePort} */ (
    /** @type {unknown} */ (requiredFactory(factories, "createStateRootStore")())
  );
}

/** @param {Record<string, unknown>} factories */
function deviceBuildStore(factories) {
  return /** @type {DeviceBuildStorePort} */ (
    /** @type {unknown} */ (requiredFactory(factories, "createDeviceBuildStore")())
  );
}

/** @param {Record<string, unknown>} factories @param {string} name */
function requiredFactory(factories, name) {
  const candidate = factories?.[name];
  if (typeof candidate !== "function") {
    throw new TypeError(`Extracted helper factories must provide ${name}.`);
  }
  return /** @type {() => unknown} */ (candidate);
}

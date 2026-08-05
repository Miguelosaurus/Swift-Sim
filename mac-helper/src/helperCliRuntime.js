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
 *   create(input: { pairing: PairingState, ttlMs?: number }): {
 *     invite: string,
 *     expiresAt: string,
 *   },
 * }} PairingInviteWriter
 */

/**
 * Compose only the services required by the extracted one-shot helper command.
 * Commands outside this bounded set return false before any store or adapter is
 * constructed, leaving the compatibility runtime as their sole owner.
 *
 * @param {string[]} argv
 * @param {{ writeLine?: (line: string) => void, printQRCode?: (value: string) => void }} [options]
 */
export async function runExtractedHelperCommand(argv, options = {}) {
  if (!helperCliCommandIsExtracted(argv[0])) return false;

  // The legacy helper constructs a state-root-owning store before
  // DeviceBuildStore. Preserve that fresh-HOME prerequisite explicitly at this
  // composition boundary until the stores move behind repositories.
  const pairingStore = new PairingStore();
  const deviceBuildStore = new DeviceBuildStore();
  const deviceDelivery = new DeviceDeliveryAdapter();
  const deviceInventory = new DeviceInventoryAdapter();
  const pairingInviteStore = new PairingInviteStore();
  const pairingInvites = /** @type {PairingInviteWriter} */ (
    /** @type {unknown} */ (pairingInviteStore)
  );
  const serveSim = new ServeSimAdapter();

  return dispatchHelperCliCommand({
    argv,
    ...(options.writeLine === undefined ? {} : { writeLine: options.writeLine }),
    services: {
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
      listApps({ includeArchived }) {
        return deviceBuildStore.listApps({ includeArchived }).map(publicDeviceApp);
      },
      archiveApp({ appID, archived }) {
        const app = deviceBuildStore.setAppArchived(appID, archived);
        return app ? publicDeviceApp(app) : null;
      },
      async verifyDeviceBuild(buildID) {
        const build = deviceBuildStore.get(buildID);
        if (!build) throw new Error("Unknown device build.");
        const verification = await deviceInventory.verifyApp(build.app.bundleIdentifier, {
          version: build.app.version,
          build: build.app.build,
        });
        return publicDeviceBuild(deviceBuildStore.saveVerification(build.id, verification));
      },
      deviceDeliveryStatus() {
        return deviceDelivery.status();
      },
      stopDeviceDelivery() {
        return deviceDelivery.stop();
      },
      inspectServeSim() {
        return serveSim.inspect();
      },
      printQRCode: options.printQRCode || printQRCode,
    },
  });
}

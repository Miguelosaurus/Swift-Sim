// @ts-check

import {
  deviceAppCommandIsSupported,
  dispatchDeviceAppCommand,
} from "./commands/deviceAppCommands.js";
import {
  deviceDeliveryCommandIsSupported,
  dispatchDeviceDeliveryCommand,
} from "./commands/deviceDeliveryCommands.js";
import { dispatchPairingCommand, pairingCommandIsSupported } from "./commands/pairingCommands.js";
import {
  dispatchServeSimCommand,
  serveSimCommandIsSupported,
} from "./commands/serveSimCommands.js";

/** @param {string | undefined} command */
export function helperCliCommandIsExtracted(command) {
  return (
    pairingCommandIsSupported(command) ||
    deviceAppCommandIsSupported(command) ||
    deviceDeliveryCommandIsSupported(command) ||
    serveSimCommandIsSupported(command)
  );
}

/**
 * Dispatch one bounded one-shot helper command.
 *
 * Returns false without touching services when the command remains on the
 * compatibility path.
 *
 * @param {{
 *   argv: string[],
 *   services: Record<string, unknown>,
 *   writeLine?: (line: string) => void,
 * }} options
 */
export async function dispatchHelperCliCommand({
  argv,
  services,
  writeLine = (line) => console.log(line),
}) {
  const [command = "serve", ...args] = argv;
  if (!helperCliCommandIsExtracted(command)) return false;
  if (!services || typeof services !== "object") {
    throw new TypeError("Helper CLI services are required.");
  }
  if (typeof writeLine !== "function") {
    throw new TypeError("Helper CLI writeLine must be a function.");
  }

  if (pairingCommandIsSupported(command)) {
    return dispatchPairingCommand({ command, args, services, writeLine });
  }
  if (deviceAppCommandIsSupported(command)) {
    return dispatchDeviceAppCommand({ command, args, services, writeLine });
  }
  if (deviceDeliveryCommandIsSupported(command)) {
    return dispatchDeviceDeliveryCommand({ command, services, writeLine });
  }
  return dispatchServeSimCommand({ command, services, writeLine });
}

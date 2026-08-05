// @ts-check

/** @param {string | undefined} command */
export function deviceDeliveryCommandIsSupported(command) {
  return command === "device-delivery-status" || command === "device-delivery-stop";
}

/**
 * @param {{
 *   command: string,
 *   services: Record<string, unknown>,
 *   writeLine(line: string): void,
 * }} options
 */
export async function dispatchDeviceDeliveryCommand({ command, services, writeLine }) {
  if (!deviceDeliveryCommandIsSupported(command)) return false;

  if (command === "device-delivery-status") {
    const status = requiredStatusMethod(services);
    writeLine(JSON.stringify(status(), null, 2));
    return true;
  }

  const stop = requiredStopMethod(services);
  writeLine(JSON.stringify({ stopped: stop() }, null, 2));
  return true;
}

/** @param {Record<string, unknown>} services */
function requiredStatusMethod(services) {
  const candidate = services?.deviceDeliveryStatus;
  if (typeof candidate !== "function") {
    throw new TypeError("Device delivery command services must provide deviceDeliveryStatus.");
  }
  return /** @type {() => unknown} */ (candidate);
}

/** @param {Record<string, unknown>} services */
function requiredStopMethod(services) {
  const candidate = services?.stopDeviceDelivery;
  if (typeof candidate !== "function") {
    throw new TypeError("Device delivery command services must provide stopDeviceDelivery.");
  }
  return /** @type {() => boolean} */ (candidate);
}

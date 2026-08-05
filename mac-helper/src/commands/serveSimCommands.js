// @ts-check

/** @param {string | undefined} command */
export function serveSimCommandIsSupported(command) {
  return command === "serve-sim-info";
}

/**
 * @param {{
 *   command: string,
 *   services: Record<string, unknown>,
 *   writeLine(line: string): void,
 * }} options
 */
export async function dispatchServeSimCommand({ command, services, writeLine }) {
  if (!serveSimCommandIsSupported(command)) return false;
  const inspect = requiredInspectMethod(services);
  writeLine(JSON.stringify(await inspect(), null, 2));
  return true;
}

/** @param {Record<string, unknown>} services */
function requiredInspectMethod(services) {
  const candidate = services?.inspectServeSim;
  if (typeof candidate !== "function") {
    throw new TypeError("Serve-sim command services must provide inspectServeSim.");
  }
  return /** @type {() => Promise<unknown>} */ (candidate);
}

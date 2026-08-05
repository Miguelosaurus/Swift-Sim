// @ts-check

import { parseArgs } from "node:util";

const EXTRACTED_COMMANDS = new Set([
  "pair",
  "list-apps",
  "archive-app",
  "verify-device-build",
  "device-delivery-status",
  "device-delivery-stop",
  "serve-sim-info",
]);

/**
 * @typedef {{ universalLink?: string, customScheme: string }} HelperLinks
 * @typedef {{ macName: string, links: HelperLinks, expiresAt?: string }} PairCommandResult
 * @typedef {{
 *   pair(input: {
 *     rotate: boolean,
 *     macName?: string,
 *     qr: boolean,
 *     ttlMs?: number,
 *     remoteBaseUrl?: string,
 *   }): PairCommandResult,
 *   listApps(input: { includeArchived: boolean }): unknown[],
 *   archiveApp(input: { appID: string, archived: boolean }): unknown | null,
 *   verifyDeviceBuild(buildID: string): Promise<unknown>,
 *   deviceDeliveryStatus(): unknown,
 *   stopDeviceDelivery(): boolean,
 *   inspectServeSim(): Promise<unknown>,
 *   printQRCode(value: string): void,
 * }} HelperCliServices
 */

/** @param {string | undefined} command */
export function helperCliCommandIsExtracted(command) {
  return typeof command === "string" && EXTRACTED_COMMANDS.has(command);
}

/**
 * Dispatch one bounded one-shot helper command.
 *
 * Returns false without touching services when the command remains on the
 * compatibility path.
 *
 * @param {{
 *   argv: string[],
 *   services: HelperCliServices,
 *   writeLine?: (line: string) => void,
 * }} options
 */
export async function dispatchHelperCliCommand({
  argv,
  services,
  writeLine = (line) => console.log(line),
}) {
  const [command = "serve", ...rest] = argv;
  if (!helperCliCommandIsExtracted(command)) return false;
  assertServices(services);
  if (typeof writeLine !== "function") {
    throw new TypeError("Helper CLI writeLine must be a function.");
  }

  if (command === "pair") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "remote-base-url": { type: "string" },
        "mac-name": { type: "string" },
        rotate: { type: "boolean" },
        qr: { type: "boolean" },
        "ttl-minutes": { type: "string" },
      },
    });
    const ttlValue = optionString(values, "ttl-minutes");
    const ttlMinutes = ttlValue === undefined ? undefined : Number(ttlValue);
    if (
      ttlMinutes !== undefined &&
      (!Number.isFinite(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 15)
    ) {
      throw new Error("Pairing invite TTL must be between 1 and 15 minutes.");
    }
    const qr = optionBoolean(values, "qr");
    if (ttlMinutes !== undefined && !qr) {
      throw new Error("--ttl-minutes requires --qr.");
    }
    const macName = optionString(values, "mac-name");
    const remoteBaseUrl = optionString(values, "remote-base-url");
    const result = services.pair({
      rotate: optionBoolean(values, "rotate"),
      qr,
      ...(macName === undefined ? {} : { macName }),
      ...(remoteBaseUrl === undefined ? {} : { remoteBaseUrl }),
      ...(ttlMinutes === undefined ? {} : { ttlMs: ttlMinutes * 60 * 1000 }),
    });
    if (qr) {
      if (!result.expiresAt) {
        throw new Error("Pairing invite did not publish an expiry.");
      }
      const pairingURL = result.links.universalLink || result.links.customScheme;
      writeLine(`Pair with ${result.macName}`);
      writeLine(`Expires: ${result.expiresAt}`);
      services.printQRCode(pairingURL);
      writeLine(`Pairing URL: ${pairingURL}`);
    } else {
      writeLine(JSON.stringify({ macName: result.macName, links: result.links }, null, 2));
    }
    return true;
  }

  if (command === "list-apps") {
    const { values } = parseArgs({
      args: rest,
      options: { archived: { type: "boolean" } },
    });
    writeLine(
      JSON.stringify(
        {
          apps: services.listApps({ includeArchived: optionBoolean(values, "archived") }),
        },
        null,
        2,
      ),
    );
    return true;
  }

  if (command === "archive-app") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "app-id": { type: "string" },
        restore: { type: "boolean" },
      },
    });
    const app = services.archiveApp({
      appID: required(optionString(values, "app-id"), "app-id"),
      archived: !optionBoolean(values, "restore"),
    });
    if (!app) throw new Error("Unknown app id.");
    writeLine(JSON.stringify(app, null, 2));
    return true;
  }

  if (command === "verify-device-build") {
    const { values } = parseArgs({
      args: rest,
      options: { "build-id": { type: "string" } },
    });
    const build = await services.verifyDeviceBuild(
      required(optionString(values, "build-id"), "build-id"),
    );
    writeLine(JSON.stringify(build, null, 2));
    return true;
  }

  if (command === "device-delivery-status") {
    writeLine(JSON.stringify(services.deviceDeliveryStatus(), null, 2));
    return true;
  }

  if (command === "device-delivery-stop") {
    writeLine(JSON.stringify({ stopped: services.stopDeviceDelivery() }, null, 2));
    return true;
  }

  writeLine(JSON.stringify(await services.inspectServeSim(), null, 2));
  return true;
}

/** @param {Record<string, string | boolean | undefined>} values @param {string} key */
function optionString(values, key) {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/** @param {Record<string, string | boolean | undefined>} values @param {string} key */
function optionBoolean(values, key) {
  return values[key] === true;
}

/** @param {string | undefined} value @param {string} name */
function required(value, name) {
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}

/** @param {HelperCliServices} services */
function assertServices(services) {
  if (!services || typeof services !== "object") {
    throw new TypeError("Helper CLI services are required.");
  }
  for (const method of /** @type {const} */ ([
    "pair",
    "listApps",
    "archiveApp",
    "verifyDeviceBuild",
    "deviceDeliveryStatus",
    "stopDeviceDelivery",
    "inspectServeSim",
    "printQRCode",
  ])) {
    if (typeof services[method] !== "function") {
      throw new TypeError(`Helper CLI services must provide ${method}.`);
    }
  }
}

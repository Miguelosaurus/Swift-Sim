// @ts-check

import { parseArgs } from "node:util";

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
 *   printQRCode(value: string): void,
 * }} PairingCommandServices
 */

/** @param {string | undefined} command */
export function pairingCommandIsSupported(command) {
  return command === "pair";
}

/**
 * @param {{
 *   command: string,
 *   args: string[],
 *   services: Record<string, unknown>,
 *   writeLine(line: string): void,
 * }} options
 */
export async function dispatchPairingCommand({ command, args, services, writeLine }) {
  if (!pairingCommandIsSupported(command)) return false;
  const pairingServices = pairingCommandServices(services);
  const { values } = parseArgs({
    args,
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
  const result = pairingServices.pair({
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
    pairingServices.printQRCode(pairingURL);
    writeLine(`Pairing URL: ${pairingURL}`);
  } else {
    writeLine(JSON.stringify({ macName: result.macName, links: result.links }, null, 2));
  }
  return true;
}

/** @param {Record<string, unknown>} services */
function pairingCommandServices(services) {
  assertMethod(services, "pair");
  assertMethod(services, "printQRCode");
  return /** @type {unknown as PairingCommandServices} */ (services);
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

/** @param {Record<string, unknown>} services @param {string} method */
function assertMethod(services, method) {
  if (!services || typeof services !== "object" || typeof services[method] !== "function") {
    throw new TypeError(`Pairing command services must provide ${method}.`);
  }
}

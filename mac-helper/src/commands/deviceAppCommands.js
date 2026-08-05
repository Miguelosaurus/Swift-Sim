// @ts-check

import { parseArgs } from "node:util";

/** @param {string | undefined} command */
export function deviceAppCommandIsSupported(command) {
  return command === "list-apps" || command === "archive-app" || command === "verify-device-build";
}

/**
 * @param {{
 *   command: string,
 *   args: string[],
 *   services: Record<string, unknown>,
 *   writeLine(line: string): void,
 * }} options
 */
export async function dispatchDeviceAppCommand({ command, args, services, writeLine }) {
  if (!deviceAppCommandIsSupported(command)) return false;

  if (command === "list-apps") {
    const listApps = requiredMethod(services, "listApps");
    const { values } = parseArgs({
      args,
      options: { archived: { type: "boolean" } },
    });
    writeLine(
      JSON.stringify(
        {
          apps: listApps({ includeArchived: optionBoolean(values, "archived") }),
        },
        null,
        2,
      ),
    );
    return true;
  }

  if (command === "archive-app") {
    const archiveApp = requiredMethod(services, "archiveApp");
    const { values } = parseArgs({
      args,
      options: {
        "app-id": { type: "string" },
        restore: { type: "boolean" },
      },
    });
    const app = archiveApp({
      appID: required(optionString(values, "app-id"), "app-id"),
      archived: !optionBoolean(values, "restore"),
    });
    if (!app) throw new Error("Unknown app id.");
    writeLine(JSON.stringify(app, null, 2));
    return true;
  }

  const verifyDeviceBuild = requiredMethod(services, "verifyDeviceBuild");
  const { values } = parseArgs({
    args,
    options: { "build-id": { type: "string" } },
  });
  const build = await verifyDeviceBuild(
    required(optionString(values, "build-id"), "build-id"),
  );
  writeLine(JSON.stringify(build, null, 2));
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

/** @param {Record<string, unknown>} services @param {string} method */
function requiredMethod(services, method) {
  const candidate = services?.[method];
  if (typeof candidate !== "function") {
    throw new TypeError(`Device app command services must provide ${method}.`);
  }
  return /** @type {(...args: any[]) => any} */ (candidate);
}

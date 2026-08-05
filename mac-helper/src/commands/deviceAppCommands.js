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
    const listApps = requiredListAppsMethod(services);
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
    const archiveApp = requiredArchiveAppMethod(services);
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

  const verifyDeviceBuild = requiredVerifyDeviceBuildMethod(services);
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

/** @param {Record<string, unknown>} services */
function requiredListAppsMethod(services) {
  const candidate = services?.listApps;
  if (typeof candidate !== "function") {
    throw new TypeError("Device app command services must provide listApps.");
  }
  return /** @type {(input: { includeArchived: boolean }) => unknown[]} */ (candidate);
}

/** @param {Record<string, unknown>} services */
function requiredArchiveAppMethod(services) {
  const candidate = services?.archiveApp;
  if (typeof candidate !== "function") {
    throw new TypeError("Device app command services must provide archiveApp.");
  }
  return /** @type {(input: { appID: string, archived: boolean }) => unknown | null} */ (
    candidate
  );
}

/** @param {Record<string, unknown>} services */
function requiredVerifyDeviceBuildMethod(services) {
  const candidate = services?.verifyDeviceBuild;
  if (typeof candidate !== "function") {
    throw new TypeError("Device app command services must provide verifyDeviceBuild.");
  }
  return /** @type {(buildID: string) => Promise<unknown>} */ (candidate);
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

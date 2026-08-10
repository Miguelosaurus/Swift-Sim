// @ts-check

import { parseArgs } from "node:util";

/** @typedef {{ type: "string" | "boolean", short?: string, multiple?: boolean }} CompatibilityParseOption */

const COMMANDS = new Set([
  "serve",
  "start-session",
  "companion-link",
  "setup-status",
  "build-device",
  "stop-session",
]);

/** @param {string | undefined} command */
export function compatibilityCommandIsSupported(command) {
  return command === undefined || COMMANDS.has(command);
}

/**
 * Own the remaining compatibility CLI parsing and output contracts.
 * Domain/runtime behavior remains behind the injected operations.
 *
 * @param {{
 *   argv: string[],
 *   services: Record<string, unknown>,
 *   defaultHost: string,
 *   defaultPort: number,
 *   writeLine?: (line: string) => void,
 * }} options
 */
export async function dispatchCompatibilityCommand({
  argv,
  services,
  defaultHost,
  defaultPort,
  writeLine = (line) => console.log(line),
}) {
  const [command = "serve", ...args] = argv;
  if (!compatibilityCommandIsSupported(command)) return false;
  if (!services || typeof services !== "object") {
    throw new TypeError("Compatibility command services are required.");
  }
  if (typeof writeLine !== "function") {
    throw new TypeError("Compatibility command writeLine must be a function.");
  }

  if (command === "serve") {
    const serve = requiredServeMethod(services);
    const { values } = parseArgs({
      args,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string" },
        "device-builds-only": { type: "boolean" },
      },
    });
    const port = optionString(values, "port");
    await serve({
      port: port ? Number(port) : defaultPort,
      host: optionString(values, "host") || defaultHost,
      deviceBuildsOnly: optionBoolean(values, "device-builds-only"),
    });
    return true;
  }

  if (command === "start-session") {
    const startSession = requiredStartSessionMethod(services);
    const { values } = parseArgs({ args, options: sessionOptions() });
    writeLine(JSON.stringify(await startSession(valuesRecord(values)), null, 2));
    return true;
  }

  if (command === "companion-link") {
    const companionLink = requiredCompanionLinkMethod(services);
    const { values } = parseArgs({
      args,
      options: {
        "session-id": { type: "string" },
        token: { type: "string" },
        "remote-base-url": { type: "string" },
      },
    });
    writeLine(
      JSON.stringify(
        await companionLink({
          sessionId: optionString(values, "session-id"),
          token: optionString(values, "token"),
          remoteBaseUrl: optionString(values, "remote-base-url"),
        }),
        null,
        2,
      ),
    );
    return true;
  }

  if (command === "setup-status") {
    const setupStatus = requiredSetupStatusMethod(services);
    const { values } = parseArgs({
      args,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string" },
      },
    });
    const port = optionString(values, "port");
    writeLine(
      JSON.stringify(
        await setupStatus({
          host: optionString(values, "host") || defaultHost,
          port: port ? Number(port) : defaultPort,
        }),
        null,
        2,
      ),
    );
    return true;
  }

  if (command === "build-device") {
    const buildDevice = requiredBuildDeviceMethod(services);
    const { values } = parseArgs({ args, options: deviceBuildOptions() });
    writeLine(JSON.stringify(await buildDevice(valuesRecord(values)), null, 2));
    return true;
  }

  const stopSession = requiredStopSessionMethod(services);
  const { values } = parseArgs({
    args,
    options: {
      "session-id": { type: "string" },
      token: { type: "string" },
    },
  });
  writeLine(
    JSON.stringify(
      await stopSession({
        sessionId: optionString(values, "session-id"),
        token: optionString(values, "token"),
      }),
    ),
  );
  return true;
}

/** @returns {Record<string, CompatibilityParseOption>} */
function sessionOptions() {
  return {
    project: { type: "string" },
    scheme: { type: "string" },
    simulator: { type: "string" },
    "remote-base-url": { type: "string" },
    port: { type: "string" },
    transport: { type: "string" },
  };
}

/** @returns {Record<string, CompatibilityParseOption>} */
function deviceBuildOptions() {
  return {
    project: { type: "string" },
    workspace: { type: "string" },
    scheme: { type: "string" },
    configuration: { type: "string" },
    "remote-base-url": { type: "string" },
    delivery: { type: "string" },
    "export-method": { type: "string" },
    "ttl-minutes": { type: "string" },
    "build-setting": { type: "string", multiple: true },
    "allow-provisioning-updates": { type: "boolean" },
    "replace-app-data": { type: "boolean" },
  };
}

/** @param {Record<string, unknown>} services */
function requiredServeMethod(services) {
  const candidate = services.serve;
  if (typeof candidate !== "function")
    throw new TypeError("Compatibility command services must provide serve.");
  return /** @type {(input: { host: string, port: number, deviceBuildsOnly: boolean }) => Promise<unknown>} */ (
    candidate
  );
}

/** @param {Record<string, unknown>} services */
function requiredStartSessionMethod(services) {
  const candidate = services.startSession;
  if (typeof candidate !== "function")
    throw new TypeError("Compatibility command services must provide startSession.");
  return /** @type {(values: Record<string, unknown>) => Promise<unknown>} */ (candidate);
}

/** @param {Record<string, unknown>} services */
function requiredCompanionLinkMethod(services) {
  const candidate = services.companionLink;
  if (typeof candidate !== "function")
    throw new TypeError("Compatibility command services must provide companionLink.");
  return /** @type {(input: { sessionId?: string | undefined, token?: string | undefined, remoteBaseUrl?: string | undefined }) => Promise<unknown> | unknown} */ (
    candidate
  );
}

/** @param {Record<string, unknown>} services */
function requiredSetupStatusMethod(services) {
  const candidate = services.setupStatus;
  if (typeof candidate !== "function")
    throw new TypeError("Compatibility command services must provide setupStatus.");
  return /** @type {(input: { host: string, port: number }) => Promise<unknown>} */ (candidate);
}

/** @param {Record<string, unknown>} services */
function requiredBuildDeviceMethod(services) {
  const candidate = services.buildDevice;
  if (typeof candidate !== "function")
    throw new TypeError("Compatibility command services must provide buildDevice.");
  return /** @type {(values: Record<string, unknown>) => Promise<unknown>} */ (candidate);
}

/** @param {Record<string, unknown>} services */
function requiredStopSessionMethod(services) {
  const candidate = services.stopSession;
  if (typeof candidate !== "function")
    throw new TypeError("Compatibility command services must provide stopSession.");
  return /** @type {(input: { sessionId?: string | undefined, token?: string | undefined }) => Promise<unknown>} */ (
    candidate
  );
}

/** @param {Record<string, unknown>} values @param {string} key */
function optionString(values, key) {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/** @param {Record<string, unknown>} values @param {string} key */
function optionBoolean(values, key) {
  return values[key] === true;
}

/** @param {unknown} values */
function valuesRecord(values) {
  return /** @type {Record<string, unknown>} */ (values);
}

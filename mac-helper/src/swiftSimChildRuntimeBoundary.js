import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { replaceSwiftSimNodeImport } from "./runtimePreloadOptions.js";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const originalSpawn = childProcess.spawn;
const originalSpawnSync = childProcess.spawnSync;
const SWIFT_SIM_RAW_CHILDREN = new Set([
  "swift-sim-helper.js",
  "swift-sim-device-delivery.js",
  "swift-sim-device-gateway.js",
]);
let installed = false;
let installedPreloadURL = "";

export function installSwiftSimChildRuntimeBoundary({
  preloadURL = new URL("./hardenedRuntimePreload.js", import.meta.url).href,
} = {}) {
  installedPreloadURL = String(preloadURL || installedPreloadURL || "");
  if (installed) return;
  installed = true;

  childProcess.spawn = function guardedSpawn(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    return originalSpawn.call(
      this,
      command,
      normalized.args,
      guardedOptions(command, normalized.args, normalized.options)
    );
  };
  childProcess.spawnSync = function guardedSpawnSync(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    return originalSpawnSync.call(
      this,
      command,
      normalized.args,
      guardedOptions(command, normalized.args, normalized.options)
    );
  };
  syncBuiltinESMExports();
}

export function swiftSimRuntimeChild(command, args) {
  if (String(command || "") !== String(process.execPath)) return false;
  const script = Array.isArray(args) ? String(args[0] || "") : "";
  return SWIFT_SIM_RAW_CHILDREN.has(basename(script));
}

export function runtimeChildOptions(command, args, options = {}, {
  preloadURL = installedPreloadURL,
} = {}) {
  if (!swiftSimRuntimeChild(command, args) || !preloadURL) return options;
  const sourceEnvironment = options?.env || process.env;
  return {
    ...(options || {}),
    env: {
      ...sourceEnvironment,
      NODE_OPTIONS: replaceSwiftSimNodeImport(sourceEnvironment.NODE_OPTIONS, preloadURL),
    },
  };
}

function guardedOptions(command, args, options) {
  return runtimeChildOptions(command, args, options || {});
}

function normalizeInvocation(args, options) {
  if (Array.isArray(args)) return { args, options: options || {} };
  return { args: [], options: args || {} };
}

import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { URL } from "node:url";
import {
  GATEWAY_RUNTIME_ROLE,
  HELPER_RUNTIME_ROLE,
  runtimeHealthPayload,
} from "./runtimeHealth.js";

const require = createRequire(import.meta.url);
const http = require("node:http");
const originalCreateServer = http.createServer;
let installed = false;

export function installRuntimeHealthBoundary() {
  if (installed) return;
  installed = true;
  http.createServer = function runtimeHealthCreateServer(options, listener) {
    let resolvedOptions = options;
    let resolvedListener = listener;
    if (typeof options === "function") {
      resolvedListener = options;
      resolvedOptions = undefined;
    }
    const guardedListener = typeof resolvedListener === "function"
      ? (req, res) => {
          if (handleRuntimeHealth(req, res)) return;
          return resolvedListener(req, res);
        }
      : resolvedListener;
    return resolvedOptions === undefined
      ? originalCreateServer.call(this, guardedListener)
      : originalCreateServer.call(this, resolvedOptions, guardedListener);
  };
  syncBuiltinESMExports();
}

export function handleRuntimeHealth(req, res, { role = runtimeRole() } = {}) {
  if (req?.method !== "GET") return false;
  let url;
  try {
    url = new URL(req.url || "/", "http://127.0.0.1");
  } catch {
    return false;
  }
  if (url.pathname !== "/health") return false;
  const payload = JSON.stringify(runtimeHealthPayload(role));
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
  return true;
}

function runtimeRole() {
  const explicit = String(process.env.SWIFT_SIM_RUNTIME_ROLE || "");
  if ([HELPER_RUNTIME_ROLE, GATEWAY_RUNTIME_ROLE].includes(explicit)) return explicit;
  return basename(String(process.argv[1] || "")) === "swift-sim-device-gateway.js"
    ? GATEWAY_RUNTIME_ROLE
    : HELPER_RUNTIME_ROLE;
}

installRuntimeHealthBoundary();

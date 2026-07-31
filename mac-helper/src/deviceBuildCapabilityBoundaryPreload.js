import { createRequire, syncBuiltinESMExports } from "node:module";
import { URL } from "node:url";
import { PairingStore } from "./pairingStore.js";
import { DeviceBuildStore } from "./deviceBuildStore.js";
import { DeviceInventoryAdapter } from "./deviceInventory.js";
import {
  capabilityForTokens,
  deviceBuildCapabilityExpired,
  publicCapabilityDeviceBuild,
} from "./deviceBuildCapability.js";
import { claimDeviceVerification } from "./deviceVerificationGate.js";
import { sanitizePublicBuildLogs } from "./publicBuildLogs.js";

const require = createRequire(import.meta.url);
const http = require("node:http");
const originalCreateServer = http.createServer;
let defaultPairingStore;
let defaultDeviceBuildStore;
let defaultDeviceInventory;
let installed = false;

export function installDeviceBuildCapabilityBoundary() {
  if (installed) return;
  installed = true;
  http.createServer = function capabilityGuardedCreateServer(options, listener) {
    let resolvedOptions = options;
    let resolvedListener = listener;
    if (typeof options === "function") {
      resolvedListener = options;
      resolvedOptions = undefined;
    }
    const guardedListener = typeof resolvedListener === "function"
      ? async (req, res) => {
          try {
            if (await handlePublicDeviceBuildCapability(req, res)) return;
            return await resolvedListener(req, res);
          } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            if (!res.headersSent) {
              writeJson(res, 503, { error: "Swift Sim is temporarily unavailable." });
            } else {
              res.destroy(error instanceof Error ? error : undefined);
            }
          }
        }
      : resolvedListener;
    return resolvedOptions === undefined
      ? originalCreateServer.call(this, guardedListener)
      : originalCreateServer.call(this, resolvedOptions, guardedListener);
  };
  syncBuiltinESMExports();
}

export async function handlePublicDeviceBuildCapability(req, res, {
  pairingStore: pairings = pairingStore(),
  deviceBuildStore: builds = buildStore(),
  deviceInventory: inventory = inventoryStore(),
  claimVerification = claimDeviceVerification,
  now = Date.now(),
} = {}) {
  const route = parseBuildRoute(req);
  if (!route) return false;
  const tokens = requestTokens(req, route.url);
  if (tokens.some((token) => pairings.tokenMatches(token))) return false;

  const build = builds.get(route.buildID);
  if (!build) {
    writeJson(res, 401, { error: "Unauthorized." });
    return true;
  }
  const capability = capabilityForTokens(build, tokens);
  if (!capability) {
    writeJson(res, 401, { error: "Unauthorized." });
    return true;
  }

  res.swiftSimPublicCapability = true;
  if (deviceBuildCapabilityExpired(build, capability, now)) {
    writeJson(res, 410, { error: "This install link has expired." });
    return true;
  }

  if (route.kind === "page" || route.kind === "artifact") {
    if (capability?.token) {
      route.url.searchParams.set("token", capability.token);
      req.url = `${route.url.pathname}${route.url.search}`;
    }
    return false;
  }
  if (route.kind === "logs" && req.method === "GET") {
    writeJson(res, 200, { buildId: build.id, logs: sanitizePublicBuildLogs(build) });
    return true;
  }
  if (route.kind === "status" && req.method === "GET") {
    writeJson(res, 200, publicCapabilityDeviceBuild(build, capability));
    return true;
  }
  if (route.kind === "links" && req.method === "GET") {
    writeJson(res, 200, publicCapabilityDeviceBuild(build, capability).links);
    return true;
  }
  if ((route.kind === "install-request" || route.kind === "verify") && req.method === "POST") {
    if (build.state !== "ready" || !build.artifacts?.ipaPath) {
      writeJson(res, 409, { error: "This build is not ready or is no longer available." });
      return true;
    }
    if (route.kind === "install-request") {
      const requested = builds.markInstallRequested(build.id);
      if (!requested) {
        writeJson(res, 404, { error: "This build is no longer available." });
        return true;
      }
      writeJson(res, 200, publicCapabilityDeviceBuild(requested, capability));
      return true;
    }

    let verified = builds.get(build.id);
    if (claimVerification(build, { now })) {
      const verification = await inventory.verifyApp(build.app?.bundleIdentifier || "", {
        version: build.app?.version || "",
        build: build.app?.build || "",
      });
      verified = builds.saveVerification(build.id, verification);
    }
    if (!verified) {
      writeJson(res, 404, { error: "This build is no longer available." });
      return true;
    }
    writeJson(res, 200, publicCapabilityDeviceBuild(verified, capability));
    return true;
  }

  writeJson(res, 405, { error: "Method not allowed." });
  return true;
}

function parseBuildRoute(req) {
  let url;
  try {
    url = new URL(req?.url || "/", `http://${req?.headers?.host || "127.0.0.1"}`);
  } catch {
    return null;
  }
  let match = url.pathname.match(/^\/d\/([^/]+)$/);
  if (match) return { url, buildID: match[1], kind: "page" };
  match = url.pathname.match(/^\/api\/device-builds\/([^/]+)\/artifact\/(ipa|manifest)$/);
  if (match) return { url, buildID: match[1], kind: "artifact" };
  match = url.pathname.match(/^\/api\/device-builds\/([^/]+)(?:\/(logs|links|install-request|verify))?$/);
  if (!match) return null;
  return {
    url,
    buildID: match[1],
    kind: match[2] || "status",
  };
}

function requestTokens(req, url) {
  const header = String(req?.headers?.authorization || "");
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return [...new Set([bearer, url.searchParams.get("token") || ""].filter(Boolean))];
}

function pairingStore() {
  defaultPairingStore ||= new PairingStore();
  return defaultPairingStore;
}

function buildStore() {
  defaultDeviceBuildStore ||= new DeviceBuildStore({ maintenance: false });
  return defaultDeviceBuildStore;
}

function inventoryStore() {
  defaultDeviceInventory ||= new DeviceInventoryAdapter();
  return defaultDeviceInventory;
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

installDeviceBuildCapabilityBoundary();

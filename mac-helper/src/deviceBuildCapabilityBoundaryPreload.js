import { createRequire, syncBuiltinESMExports } from "node:module";
import { URL } from "node:url";
import { PairingStore } from "./pairingStore.js";
import { DeviceBuildStore } from "./deviceBuildStore.js";
import { DeviceInventoryAdapter } from "./deviceInventory.js";
import {
  createBoundaryProductionStoreFactory,
  defaultBoundaryStateRoot,
} from "./http/phase4BoundaryStoreFactory.js";
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
let productionStoreFactory;
let installed = false;

/**
 * Route this preload's durable stores through the one product-global Phase-4
 * selector. The factory is resolved at first request, never at import time.
 * Tests may inject an explicit factory or a disposable state root so
 * post-switch HTTP reads/writes can be proven without touching a live root.
 */
export function setDeviceBuildCapabilityBoundaryFactories({ factory, stateRoot } = {}) {
  if (factory) {
    if (typeof factory !== "function") {
      throw new TypeError("Device-build boundary factory must be a function.");
    }
    productionStoreFactory = factory;
  } else if (stateRoot) {
    productionStoreFactory = () =>
      createBoundaryProductionStoreFactory({ stateRoot: String(stateRoot) });
  } else {
    productionStoreFactory = () => createBoundaryProductionStoreFactory();
  }
  defaultPairingStore = undefined;
  defaultDeviceBuildStore = undefined;
}

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
    const guardedListener =
      typeof resolvedListener === "function"
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

export async function handlePublicDeviceBuildCapability(
  req,
  res,
  {
    pairingStore: suppliedPairings,
    deviceBuildStore: suppliedBuilds,
    deviceInventory: suppliedInventory,
    claimVerification = claimDeviceVerification,
    now = Date.now(),
  } = {},
) {
  const pairings = suppliedPairings ?? pairingStore();
  const builds = suppliedBuilds ?? buildStore();
  const route = parseBuildRoute(req);
  if (!route) return false;
  const tokens = requestTokens(req, route.url);
  const pairedToken = tokens.find((token) => pairings.tokenMatches(token));
  if (pairedToken) {
    normalizeDownstreamToken(req, route.url, pairedToken);
    return false;
  }

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
    if (capability?.token) normalizeDownstreamToken(req, route.url, capability.token);
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
      const inventory = suppliedInventory ?? inventoryStore();
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
  match = url.pathname.match(
    /^\/api\/device-builds\/([^/]+)(?:\/(logs|links|install-request|verify))?$/,
  );
  if (!match || match[1] === "start") return null;
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

function normalizeDownstreamToken(req, url, token) {
  url.searchParams.set("token", token);
  req.url = `${url.pathname}${url.search}`;
  req.headers ||= {};
  req.headers.authorization = `Bearer ${token}`;
}

function pairingStore() {
  defaultPairingStore ||= resolvedBoundaryFactory().createPairingStore();
  return defaultPairingStore;
}

function buildStore() {
  defaultDeviceBuildStore ||= resolvedBoundaryFactory().createDeviceBuildStore();
  return defaultDeviceBuildStore;
}

function inventoryStore() {
  defaultDeviceInventory ||= new DeviceInventoryAdapter();
  return defaultDeviceInventory;
}

function resolvedBoundaryFactory() {
  productionStoreFactory ||= () =>
    createBoundaryProductionStoreFactory({ stateRoot: defaultBoundaryStateRoot() });
  return productionStoreFactory();
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

import { createRequire, syncBuiltinESMExports } from "node:module";
import { timingSafeEqual } from "node:crypto";
import { URL } from "node:url";
import { PairingStore } from "./pairingStore.js";
import { buildPairingLinks } from "./links.js";
import { DeviceBuildStore } from "./deviceBuildStore.js";
import { DeviceDeliveryAdapter } from "./deviceDelivery.js";
import { sanitizePublicBuildLogs } from "./publicBuildLogs.js";

const require = createRequire(import.meta.url);
const http = require("node:http");
const originalCreateServer = http.createServer;
const DELIVERY_CLEANUP_INTERVAL_MS = 30_000;
const ACTIVE_BUILD_STATES = new Set([
  "queued",
  "validating",
  "preparing",
  "archiving",
  "building",
  "exporting",
  "delivering",
]);
let defaultPairingStore;
let defaultDeviceBuildStore;
let defaultDeviceDelivery;
let deliveryCleanupPromise;
let deliveryReconciliationPromise;
let boundaryMaintenancePromise;
let maintenanceTimer;
let installed = false;

export function installHelperHttpBoundary() {
  if (installed) return;
  installed = true;
  http.createServer = function guardedCreateServer(options, listener) {
    let resolvedOptions = options;
    let resolvedListener = listener;
    if (typeof options === "function") {
      resolvedListener = options;
      resolvedOptions = undefined;
    }
    const guardedListener = typeof resolvedListener === "function"
      ? (req, res) => {
          try {
            if (handlePairingFallback(req, res)) return;
            if (handlePublicBuildLogs(req, res)) return;
          } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            if (!res.headersSent) writeJson(res, 503, { error: "Swift Sim is temporarily unavailable." });
            else res.destroy(error instanceof Error ? error : undefined);
            return;
          }
          return resolvedListener(req, res);
        }
      : resolvedListener;
    const server = resolvedOptions === undefined
      ? originalCreateServer.call(this, guardedListener)
      : originalCreateServer.call(this, resolvedOptions, guardedListener);
    startBoundaryMaintenance();
    return server;
  };
  syncBuiltinESMExports();
}

export function handlePairingFallback(req, res, store = pairingStore()) {
  if (req?.method !== "GET") return false;
  let url;
  try {
    url = new URL(req.url || "/", `http://${req.headers?.host || "127.0.0.1"}`);
  } catch {
    return false;
  }
  if (url.pathname !== "/pair") return false;

  const token = url.searchParams.get("token") || "";
  if (!store.tokenMatches(token)) {
    writeJson(res, 401, { error: "Unauthorized." });
    return true;
  }
  const pairing = store.current();
  const base = externalBaseURL(req, url);
  const customScheme = buildPairingLinks(pairing, base).customScheme;
  writeHtml(res, pairingPage(customScheme));
  return true;
}

export function handlePublicBuildLogs(req, res, {
  pairingStore: pairings = pairingStore(),
  deviceBuildStore: builds = buildStore(),
} = {}) {
  if (req?.method !== "GET") return false;
  let url;
  try {
    url = new URL(req.url || "/", `http://${req.headers?.host || "127.0.0.1"}`);
  } catch {
    return false;
  }
  const match = url.pathname.match(/^\/api\/device-builds\/([^/]+)\/logs$/);
  if (!match) return false;
  const header = String(req.headers?.authorization || "");
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const token = bearer || url.searchParams.get("token") || "";
  if (pairings.tokenMatches(token)) return false;

  const build = builds.get(match[1]);
  const capability = build && capabilityForToken(build, token);
  if (!capability) {
    writeJson(res, 401, { error: "Unauthorized." });
    return true;
  }
  const expiresAt = Date.parse(capability.expiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    writeJson(res, 410, { error: "This install link has expired." });
    return true;
  }
  writeJson(res, 200, { buildId: build.id, logs: sanitizePublicBuildLogs(build) });
  return true;
}

export function drainDeliveryReferenceCleanupJobsOnce({
  deviceBuildStore: builds = buildStore(),
  deviceDelivery: delivery = deliveryStore(),
  now = Date.now(),
} = {}) {
  if (deliveryCleanupPromise) return deliveryCleanupPromise;
  deliveryCleanupPromise = Promise.resolve().then(() => {
    for (const job of builds.listDeliveryReferenceCleanupJobs()) {
      const dueAt = Date.parse(job.nextAttemptAt || job.createdAt || "");
      if (Number.isFinite(dueAt) && dueAt > now) continue;
      try {
        const released = delivery.stopGeneration(job.generation, { referenceID: job.referenceID });
        if (!released) throw new Error("Delivery generation is still referenced or could not be stopped.");
        builds.completeDeliveryReferenceCleanupJob(job.id);
      } catch (error) {
        builds.failDeliveryReferenceCleanupJob(job.id, error);
      }
    }
  }).finally(() => {
    deliveryCleanupPromise = undefined;
  });
  return deliveryCleanupPromise;
}

export function reconcileDeliveryReferencesOnce({
  deviceBuildStore: builds = buildStore(),
  deviceDelivery: delivery = deliveryStore(),
  now = Date.now(),
} = {}) {
  if (deliveryReconciliationPromise) return deliveryReconciliationPromise;
  deliveryReconciliationPromise = Promise.resolve().then(() => {
    const liveReferences = new Set();
    for (const build of builds.list()) {
      const currentExpiresAt = Date.parse(build.expiresAt || "");
      if (Number.isFinite(currentExpiresAt) && currentExpiresAt > now) {
        addDeliveryReference(liveReferences, build.delivery);
      }
      for (const capability of Array.isArray(build.capabilities) ? build.capabilities : []) {
        const expiresAt = Date.parse(capability?.expiresAt || "");
        if (Number.isFinite(expiresAt) && expiresAt > now) {
          addDeliveryReference(liveReferences, capability.delivery);
        }
      }
      if (build.pendingRenewal?.id) {
        liveReferences.add(`renewal:${build.pendingRenewal.id}`);
      }
      if (ACTIVE_BUILD_STATES.has(build.state)) {
        liveReferences.add(`build:${build.id}`);
      }
    }

    for (const status of delivery.statuses()) {
      for (const referenceID of Array.isArray(status.references) ? status.references : []) {
        if (!isManagedReference(referenceID) || liveReferences.has(referenceID)) continue;
        try {
          delivery.stopGeneration(status.generation, { referenceID });
        } catch {
          // A later maintenance pass retries surviving state. Never make helper
          // startup depend on a best-effort orphan reconciliation.
        }
      }
    }
  }).finally(() => {
    deliveryReconciliationPromise = undefined;
  });
  return deliveryReconciliationPromise;
}

export function runBoundaryMaintenanceOnce(options = {}) {
  if (boundaryMaintenancePromise) return boundaryMaintenancePromise;
  boundaryMaintenancePromise = Promise.resolve()
    .then(() => reconcileDeliveryReferencesOnce(options))
    .then(() => drainDeliveryReferenceCleanupJobsOnce(options))
    .finally(() => {
      boundaryMaintenancePromise = undefined;
    });
  return boundaryMaintenancePromise;
}

function startBoundaryMaintenance() {
  if (maintenanceTimer) return;
  void runBoundaryMaintenanceOnce().catch(() => {});
  maintenanceTimer = setInterval(() => {
    void runBoundaryMaintenanceOnce().catch(() => {});
  }, DELIVERY_CLEANUP_INTERVAL_MS);
  maintenanceTimer.unref?.();
}

function addDeliveryReference(set, delivery) {
  if (delivery?.referenceID) set.add(String(delivery.referenceID));
}

function isManagedReference(referenceID) {
  return /^(?:build|renewal):/.test(String(referenceID || ""));
}

function capabilityForToken(build, token) {
  if (secretsMatch(build?.token, token)) return build;
  return (Array.isArray(build?.capabilities) ? build.capabilities : [])
    .find((item) => secretsMatch(item?.token, token)) || null;
}

function secretsMatch(expected, actual) {
  if (!expected || !actual) return false;
  const expectedBuffer = Buffer.from(String(expected));
  const actualBuffer = Buffer.from(String(actual));
  return expectedBuffer.length === actualBuffer.length
    && timingSafeEqual(expectedBuffer, actualBuffer);
}

function pairingStore() {
  defaultPairingStore ||= new PairingStore();
  return defaultPairingStore;
}

function buildStore() {
  defaultDeviceBuildStore ||= new DeviceBuildStore({ maintenance: false });
  return defaultDeviceBuildStore;
}

function deliveryStore() {
  defaultDeviceDelivery ||= new DeviceDeliveryAdapter();
  return defaultDeviceDelivery;
}

function externalBaseURL(req, url) {
  const requestHost = normalizedHost(req.headers?.host || url.host);
  const proxyHost = normalizedForwardedHost(req.headers?.["x-forwarded-host"]);
  const allowedHosts = new Set([requestHost, proxyHost].filter(Boolean));
  const explicit = normalizedExternalOrigin(url.searchParams.get("base"));
  if (explicit && allowedHosts.has(normalizedHost(new URL(explicit).host))) return explicit;

  const forwarded = String(req.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const protocol = forwarded === "https" || forwarded === "http"
    ? `${forwarded}:`
    : url.protocol;
  const host = proxyHost || requestHost || normalizedHost(url.host);
  return normalizedExternalOrigin(`${protocol}//${host}`)
    || `${url.protocol}//${url.host}`;
}

function normalizedForwardedHost(value) {
  const candidate = String(value || "").split(",")[0].trim();
  return normalizedHost(candidate);
}

function normalizedHost(value) {
  const candidate = String(value || "").trim();
  if (!candidate || /[\s/@\\]/.test(candidate)) return "";
  try {
    return new URL(`http://${candidate}`).host.toLowerCase();
  } catch {
    return "";
  }
}

function normalizedExternalOrigin(value) {
  if (!value) return "";
  try {
    const parsed = new URL(String(value));
    if (!["http:", "https:"].includes(parsed.protocol)
        || !parsed.host
        || parsed.username
        || parsed.password) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

installHelperHttpBoundary();

function writeJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function writeHtml(res, body) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function pairingPage(customScheme) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Swift Sim</title><style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f8fbff;color:#121417}main{max-width:560px;margin:0 auto;padding:40px 22px}a{display:inline-block;margin-top:18px;padding:14px 18px;border-radius:999px;color:white;background:#1677ff;text-decoration:none;font-weight:700}code{display:block;margin-top:18px;padding:14px;border-radius:14px;background:white;word-break:break-all}
</style></head><body><main><h1>Connect Swift Sim</h1><p>Open Swift Sim on your iPhone and connect it to this Mac over Tailscale.</p><a href="${escapeHTML(customScheme)}">Open Swift Sim</a><code>${escapeHTML(customScheme)}</code></main></body></html>`;
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

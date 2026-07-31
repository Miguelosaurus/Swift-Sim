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
let defaultPairingStore;
let defaultDeviceBuildStore;
let defaultDeviceDelivery;
let deliveryCleanupPromise;
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
    return resolvedOptions === undefined
      ? originalCreateServer.call(this, guardedListener)
      : originalCreateServer.call(this, resolvedOptions, guardedListener);
  };
  syncBuiltinESMExports();
  startBoundaryMaintenance();
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

export function handlePublicBuildLogs(req, res, { pairingStore: pairings = pairingStore(), deviceBuildStore: builds = buildStore() } = {}) {
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

function startBoundaryMaintenance() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    void drainDeliveryReferenceCleanupJobsOnce().catch(() => {});
  }, DELIVERY_CLEANUP_INTERVAL_MS);
  maintenanceTimer.unref?.();
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
  const explicit = normalizedExternalOrigin(url.searchParams.get("base"));
  if (explicit) return explicit;
  const forwarded = String(req.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const protocol = forwarded === "https" || forwarded === "http"
    ? `${forwarded}:`
    : url.protocol;
  return normalizedExternalOrigin(`${protocol}//${url.host}`)
    || `${url.protocol}//${url.host}`;
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

#!/usr/bin/env node
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import { parseArgs } from "node:util";
import { DeviceBuildStore } from "../src/deviceBuildStore.js";
import { DeviceInventoryAdapter } from "../src/deviceInventory.js";
import {
  buildManifest,
  deviceBuildLinks,
  publicDeviceBuild,
} from "../src/deviceBuilder.js";
import { serveFile } from "../src/fileServer.js";
import { badRequest, json, notFound, text, unauthorized } from "../src/http.js";
import { sanitizePublicBuildLogs } from "../src/publicBuildLogs.js";

const { values } = parseArgs({
  options: {
    host: { type: "string" },
    port: { type: "string", short: "p" },
  },
});
const host = values.host || "127.0.0.1";
const port = Number(values.port || 47218);
const store = new DeviceBuildStore({ maintenance: false });
const inventory = new DeviceInventoryAdapter();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, helper: "swift-sim-device-gateway" });
    }

    const pageMatch = url.pathname.match(/^\/d\/([^/]+)$/);
    if (pageMatch && req.method === "GET") {
      const resolved = authorizedBuild(pageMatch[1], url.searchParams.get("token"));
      if (!resolved) return unauthorized(res);
      if (deviceBuildExpired(resolved.capability)) {
        return badRequest(res, 410, "This install link has expired.");
      }
      return text(res, 200, installPage(resolved.capability), "text/html; charset=utf-8", {
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
    }

    const buildMatch = url.pathname.match(/^\/api\/device-builds\/([^/]+)(?:\/(logs|links|install-request|verify))?$/);
    if (buildMatch) {
      const [, buildID, action] = buildMatch;
      const resolved = authorizedBuild(buildID, url.searchParams.get("token"));
      if (!resolved) return unauthorized(res);
      if (deviceBuildExpired(resolved.capability)) {
        return badRequest(res, 410, "This install link has expired.");
      }
      if (req.method === "GET" && !action) {
        return json(res, 200, publicDeviceBuild(resolved.capability));
      }
      if (req.method === "GET" && action === "logs") {
        return json(res, 200, {
          buildId: buildID,
          logs: sanitizePublicBuildLogs(resolved.build),
        });
      }
      if (req.method === "GET" && action === "links") {
        const remoteBaseURL = resolved.capability.remoteBaseUrl || `${url.protocol}//${url.host}`;
        return json(res, 200, deviceBuildLinks(resolved.capability, remoteBaseURL));
      }
      if (req.method === "POST" && action === "install-request") {
        const requested = store.markInstallRequested(buildID);
        if (!requested) return notFound(res, "Unknown device build.");
        return json(res, 200, publicDeviceBuild(projectCapability(requested, resolved.capability)));
      }
      if (req.method === "POST" && action === "verify") {
        const verification = await inventory.verifyApp(resolved.build.app.bundleIdentifier, {
          version: resolved.build.app.version,
          build: resolved.build.app.build,
        });
        const verified = store.saveVerification(buildID, verification);
        if (!verified) return notFound(res, "Unknown device build.");
        return json(res, 200, publicDeviceBuild(projectCapability(verified, resolved.capability)));
      }
    }

    const artifactMatch = url.pathname.match(/^\/api\/device-builds\/([^/]+)\/artifact\/(ipa|manifest)$/);
    if (artifactMatch && req.method === "GET") {
      const [, buildID, artifact] = artifactMatch;
      const resolved = authorizedBuild(buildID, url.searchParams.get("token"));
      if (!resolved) return unauthorized(res);
      if (deviceBuildExpired(resolved.capability)) {
        return badRequest(res, 410, "This install link has expired.");
      }
      if (resolved.build.state !== "ready") {
        return badRequest(res, 409, "This build is not ready or is no longer available.");
      }
      const remoteBaseURL = resolved.capability.remoteBaseUrl || `${url.protocol}//${url.host}`;
      if (artifact === "manifest") {
        return text(res, 200, buildManifest(resolved.capability, remoteBaseURL), "text/xml; charset=utf-8");
      }
      if (!existsSync(resolved.build.artifacts?.ipaPath || "")) {
        return notFound(res, "Artifact is unavailable.");
      }
      return serveFile(res, resolved.build.artifacts.ipaPath, {
        contentType: "application/octet-stream",
        filename: `${resolved.build.app.name || resolved.build.scheme || "App"}.ipa`,
        notFound,
      });
    }

    return notFound(res, "Not found.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (!res.headersSent) return json(res, 500, { error: "The request could not be completed." });
    res.destroy(error instanceof Error ? error : undefined);
  }
});

server.listen(port, host, () => {
  console.log(`Swift Sim device gateway listening on http://${host}:${port}`);
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => { process.exitCode = 0; });
  setTimeout(() => {
    server.closeAllConnections?.();
    process.exitCode = 1;
  }, 2_000).unref?.();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

function authorizedBuild(id, token) {
  if (!token) return null;
  const build = store.get(id);
  if (!build) return null;
  if (secretsMatch(build.token, token)) return { build, capability: build };
  for (const capability of Array.isArray(build.capabilities) ? build.capabilities : []) {
    if (secretsMatch(capability?.token, token)) {
      return { build, capability: projectCapability(build, capability) };
    }
  }
  return null;
}

function projectCapability(build, capability) {
  return {
    ...build,
    token: capability.token,
    expiresAt: capability.expiresAt,
    remoteBaseUrl: capability.remoteBaseUrl || "",
    delivery: capability.delivery ? structuredClone(capability.delivery) : null,
    installTTLMinutes: capability.installTTLMinutes || build.installTTLMinutes,
  };
}

function secretsMatch(expectedValue, actualValue) {
  if (!expectedValue || !actualValue) return false;
  const expected = Buffer.from(String(expectedValue));
  const actual = Buffer.from(String(actualValue));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function deviceBuildExpired(build) {
  const expiresAt = Date.parse(build.expiresAt || "");
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function installPage(build) {
  const links = deviceBuildLinks(build, build.remoteBaseUrl);
  const scheme = JSON.stringify(links.customScheme);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install with Swift Sim</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fb;color:#111}
main{width:min(460px,calc(100vw - 36px));padding:28px;border-radius:28px;background:white;box-shadow:0 20px 70px rgba(0,0,0,.12)}
h1{margin:0 0 10px}p{color:#5f6772;line-height:1.45}.button{display:block;margin-top:18px;padding:15px;border-radius:999px;text-align:center;background:#1677ff;color:white;text-decoration:none;font-weight:750}
</style><script>addEventListener("load",()=>setTimeout(()=>{location.href=${scheme}},250))</script></head>
<body><main><h1>Open in Swift Sim</h1><p>Swift Sim will show this saved build and guide installation.</p><a class="button" href="${escapeHTML(links.customScheme)}">Open Swift Sim</a></main></body></html>`;
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

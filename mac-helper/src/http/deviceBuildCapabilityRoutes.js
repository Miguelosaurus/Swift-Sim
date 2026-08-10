// @ts-check

import { badRequest, json, notFound, text, unauthorized } from "../http.js";
import { serveFile } from "../fileServer.js";

export const deviceBuildCapabilityAuthorizationMatrix = Object.freeze([
  route(
    "GET /api/device-builds/:id",
    "public-delivery-or-private-helper",
    "build-capability-or-paired-mac",
  ),
  route(
    "GET /api/device-builds/:id/logs",
    "public-delivery-or-private-helper",
    "build-capability-or-paired-mac",
  ),
  route(
    "GET /api/device-builds/:id/links",
    "public-delivery-or-private-helper",
    "build-capability-or-paired-mac",
  ),
  route(
    "POST /api/device-builds/:id/install-request",
    "public-delivery-or-private-helper",
    "build-capability-or-paired-mac",
  ),
  route(
    "POST /api/device-builds/:id/verify",
    "public-delivery-or-private-helper",
    "build-capability-or-paired-mac",
  ),
  route("GET /api/device-builds/:id/artifact/ipa", "public-delivery", "build-capability"),
  route("GET /api/device-builds/:id/artifact/manifest", "public-delivery", "build-capability"),
  route("GET /d/:id", "public-delivery", "build-capability"),
]);

/**
 * @param {{
 *   req: import("node:http").IncomingMessage,
 *   res: import("node:http").ServerResponse,
 *   url: URL,
 *   service: { execute(input: { operation: string, buildID: string, request: unknown, url: URL, artifact?: string }): Promise<{ kind: string, status?: number, body?: unknown, message?: string, contentType?: string, headers?: Record<string, string>, path?: string, filename?: string }> },
 * }} input
 */
export async function handleDeviceBuildCapabilityRoutes({ req, res, url, service }) {
  const match = matchRoute(req.method || "", url.pathname);
  if (!match) return false;
  const outcome = await service.execute({ ...match, request: req, url });
  if (outcome.kind === "unauthorized") unauthorized(res);
  else if (outcome.kind === "not-found") notFound(res, outcome.message || "Not found.");
  else if (outcome.kind === "bad-request") {
    badRequest(res, outcome.status || 400, outcome.message || "Bad request.");
  } else if (outcome.kind === "json") json(res, outcome.status || 200, outcome.body);
  else if (outcome.kind === "text") {
    text(
      res,
      outcome.status || 200,
      String(outcome.body || ""),
      outcome.contentType || "text/plain; charset=utf-8",
      outcome.headers || {},
    );
  } else if (outcome.kind === "file") {
    serveFile(res, outcome.path || "", {
      contentType: outcome.contentType || "application/octet-stream",
      filename: outcome.filename || "download",
      notFound,
    });
  } else {
    throw new TypeError(`Unknown device build capability outcome: ${outcome.kind}`);
  }
  return true;
}

/** @param {string} method @param {string} pathname */
function matchRoute(method, pathname) {
  if (method === "GET") {
    const page = pathname.match(/^\/d\/([^/]+)$/);
    if (page?.[1]) return { operation: "install-page", buildID: page[1] };
    const artifact = pathname.match(/^\/api\/device-builds\/([^/]+)\/artifact\/(ipa|manifest)$/);
    if (artifact?.[1] && artifact[2]) {
      return { operation: "artifact", buildID: artifact[1], artifact: artifact[2] };
    }
  }
  const build = pathname.match(
    /^\/api\/device-builds\/([^/]+)(?:\/(logs|links|install-request|verify))?$/,
  );
  if (!build?.[1] || build[1] === "start") return null;
  const action = build[2] || "";
  if (method === "GET" && !action) return { operation: "status", buildID: build[1] };
  if (method === "GET" && action === "logs") return { operation: "logs", buildID: build[1] };
  if (method === "GET" && action === "links") return { operation: "links", buildID: build[1] };
  if (method === "POST" && action === "install-request") {
    return { operation: "install-request", buildID: build[1] };
  }
  if (method === "POST" && action === "verify") {
    return { operation: "verify", buildID: build[1] };
  }
  return null;
}

/** @param {string} path @param {string} exposure @param {string} authorization */
function route(path, exposure, authorization) {
  return Object.freeze({ route: path, exposure, authorization });
}

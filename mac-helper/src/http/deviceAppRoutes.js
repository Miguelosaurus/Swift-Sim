// @ts-check

import { badRequest, json, notFound, readJson, unauthorized } from "../http.js";

export const deviceAppAuthorizationMatrix = Object.freeze([
  route("GET /api/device-builds", "private-helper", "paired-mac"),
  route("GET /api/apps", "private-helper", "paired-mac"),
  route("GET /api/apps/:id", "private-helper", "paired-mac"),
  route("POST /api/apps/:id/archive", "private-helper", "paired-mac"),
  route("POST /api/apps/:id/build-current-source", "private-helper", "paired-mac"),
  route("DELETE /api/apps/:id", "private-helper", "paired-mac"),
]);

/**
 * @param {{ req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL, service: { execute(input: { appID?: string, operation: string, request: unknown, url: URL, readInput?: () => Promise<Record<string, unknown>> }): Promise<{ kind: string, status?: number, body?: unknown, message?: string }> } }} input
 */
export async function handleDeviceAppRoutes({ req, res, url, service }) {
  const match = matchRoute(req.method || "", url.pathname);
  if (!match) return false;
  const outcome = await service.execute({
    ...match,
    request: req,
    url,
    ...(match.operation === "archive-app" || match.operation === "rebuild-app"
      ? { readInput: () => readJson(req) }
      : {}),
  });
  if (outcome.kind === "unauthorized") unauthorized(res);
  else if (outcome.kind === "not-found") notFound(res, outcome.message || "Not found.");
  else if (outcome.kind === "bad-request") {
    badRequest(res, outcome.status || 400, outcome.message || "Bad request.");
  } else if (outcome.kind === "json") json(res, outcome.status || 200, outcome.body);
  else throw new TypeError(`Unknown device app outcome: ${outcome.kind}`);
  return true;
}

/** @param {string} method @param {string} pathname */
function matchRoute(method, pathname) {
  if (method === "GET" && pathname === "/api/device-builds") return { operation: "list-builds" };
  if (method === "GET" && pathname === "/api/apps") return { operation: "list-apps" };
  const match = pathname.match(/^\/api\/apps\/([^/]+)(?:\/(archive|build-current-source))?$/);
  if (!match) return null;
  const appID = match[1];
  const action = match[2];
  if (!appID) return null;
  if (method === "GET" && !action) return { operation: "get-app", appID };
  if (method === "POST" && action === "archive") return { operation: "archive-app", appID };
  if (method === "POST" && action === "build-current-source") {
    return { operation: "rebuild-app", appID };
  }
  if (method === "DELETE" && !action) return { operation: "delete-app", appID };
  return null;
}

/** @param {string} name @param {string} exposure @param {string} authorization */
function route(name, exposure, authorization) {
  return Object.freeze({ route: name, exposure, authorization });
}

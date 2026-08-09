// @ts-check

import { badRequest, json, notFound, readJson, unauthorized } from "../http.js";

export const deviceBuildCommandAuthorizationMatrix = Object.freeze([
  Object.freeze({
    route: "POST /api/device-builds/start",
    exposure: "private-helper",
    authorization: "paired-mac",
  }),
  Object.freeze({
    route: "POST /api/device-builds/:id/renew",
    exposure: "private-helper",
    authorization: "paired-mac",
  }),
]);

/** @param {{ req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL, service: { execute(input: { operation: string, buildID?: string, request: unknown, url: URL, readInput?: () => Promise<Record<string, unknown>> }): Promise<{ kind: string, status?: number, body?: unknown, message?: string }> } }} input */
export async function handleDeviceBuildCommandRoutes({ req, res, url, service }) {
  const match = matchRoute(req.method || "", url.pathname);
  if (!match) return false;
  const outcome = await service.execute({
    ...match,
    request: req,
    url,
    ...(match.operation === "start-build" ? { readInput: () => readJson(req) } : {}),
  });
  if (outcome.kind === "unauthorized") unauthorized(res);
  else if (outcome.kind === "not-found") notFound(res, outcome.message || "Not found.");
  else if (outcome.kind === "bad-request")
    badRequest(res, outcome.status || 400, outcome.message || "Bad request.");
  else if (outcome.kind === "json") json(res, outcome.status || 200, outcome.body);
  else throw new TypeError(`Unknown device build command outcome: ${outcome.kind}`);
  return true;
}

/** @param {string} method @param {string} pathname */
function matchRoute(method, pathname) {
  if (method !== "POST") return null;
  if (pathname === "/api/device-builds/start") return { operation: "start-build" };
  const match = pathname.match(/^\/api\/device-builds\/([^/]+)\/renew$/);
  return match?.[1] ? { operation: "renew-build", buildID: match[1] } : null;
}

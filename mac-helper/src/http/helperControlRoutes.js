// @ts-check

import { json, readJson, unauthorized } from "../http.js";

export const helperControlAuthorizationMatrix = Object.freeze([
  route("GET /health", "helper-and-public-gateway", "none"),
  route("GET /.well-known/apple-app-site-association", "helper", "none"),
  route("GET /api/serve-sim", "private-helper", "paired-mac"),
  route("GET /api/transports", "private-helper", "paired-mac"),
  route("GET /api/pairing/status", "pairing", "pairing-query-token"),
  route("POST /api/pairing/claim", "pairing", "one-time-invite"),
  route("POST /api/pairing/rotate", "pairing", "pairing-query-token"),
]);

/**
 * @param {{
 *   req: import("node:http").IncomingMessage,
 *   res: import("node:http").ServerResponse,
 *   url: URL,
 *   service: { execute(input: { operation: string, request: unknown, url: URL, readInput?: () => Promise<Record<string, unknown>> }): Promise<{ kind: "ok" | "unauthorized", status?: number, body?: unknown }> },
 * }} input
 */
export async function handleHelperControlRoutes({ req, res, url, service }) {
  const operation = matchOperation(req.method || "", url.pathname);
  if (!operation) return false;
  const outcome = await service.execute({
    operation,
    request: req,
    url,
    ...(operation === "pairing-claim" ? { readInput: () => readJson(req) } : {}),
  });
  if (outcome.kind === "unauthorized") {
    unauthorized(res);
    return true;
  }
  json(res, outcome.status || 200, outcome.body);
  return true;
}

/** @param {string} method @param {string} pathname */
function matchOperation(method, pathname) {
  if (method === "GET" && pathname === "/health") return "health";
  if (method === "GET" && pathname === "/.well-known/apple-app-site-association") {
    return "association";
  }
  if (method === "GET" && pathname === "/api/serve-sim") return "serve-sim";
  if (method === "GET" && pathname === "/api/transports") return "transports";
  if (method === "GET" && pathname === "/api/pairing/status") return "pairing-status";
  if (method === "POST" && pathname === "/api/pairing/claim") return "pairing-claim";
  if (method === "POST" && pathname === "/api/pairing/rotate") return "pairing-rotate";
  return null;
}

/** @param {string} name @param {string} exposure @param {string} authorization */
function route(name, exposure, authorization) {
  return Object.freeze({ route: name, exposure, authorization });
}

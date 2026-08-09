// @ts-check

import { json, notFound, readJson, text, unauthorized } from "../http.js";

export const sessionRouteAuthorizationMatrix = Object.freeze([
  route("POST /api/sessions/start", "private-helper", "paired-mac"),
  route("GET /api/sessions/:id", "session-capability", "session-token"),
  route("GET /api/sessions/:id/logs", "session-capability", "session-token"),
  route("POST /api/sessions/:id/stop", "session-capability", "session-token"),
  route("GET /api/sessions/:id/links", "session-capability", "session-token"),
  route("GET /api/sessions/:id/stream", "session-capability", "session-token"),
  route("GET /api/sessions/:id/frame-mask", "session-capability", "session-token"),
  route("POST /api/sessions/:id/type", "session-capability", "session-token"),
  route("POST /api/sessions/:id/key", "session-capability", "session-token"),
  route("POST /api/sessions/:id/tap", "session-capability", "session-token"),
  route("POST /api/sessions/:id/gesture", "session-capability", "session-token"),
  route("POST /api/sessions/:id/multitouch", "session-capability", "session-token"),
  route("POST /api/sessions/:id/control/:control", "session-capability", "session-token"),
  route("ANY /s/:id", "session-capability", "session-token"),
]);

/**
 * @typedef {{
 *   kind: "ok" | "unauthorized" | "not-found" | "mask" | "html" | "streamed" | "unhandled",
 *   status?: number,
 *   body?: unknown,
 *   message?: string,
 *   mask?: { contentType: string, data: Buffer, width: number, height: number },
 * }} SessionRouteOutcome
 * @typedef {{ execute(input: {
 *   operation: string,
 *   request?: unknown,
 *   response?: unknown,
 *   url: URL,
 *   sessionID?: string,
 *   control?: string,
 *   readInput?: () => Promise<Record<string, unknown>>,
 * }): Promise<SessionRouteOutcome> }} SessionHttpApplicationService
 */

/**
 * Route the complete Simulator-session surface through one application
 * service call. The route owns matching and stable HTTP projection only.
 *
 * @param {{req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL, service: SessionHttpApplicationService}} input
 * @returns {Promise<boolean>}
 */
export async function handleSessionRoutes({ req, res, url, service }) {
  const match = matchSessionRoute(req.method || "", url.pathname);
  if (!match) return false;

  let outcome;
  try {
    outcome = await service.execute({
      operation: match.operation,
      request: req,
      response: res,
      url,
      ...(match.sessionID === undefined ? {} : { sessionID: match.sessionID }),
      ...(match.control === undefined ? {} : { control: match.control }),
      ...(match.readsInput ? { readInput: () => readJson(req) } : {}),
    });
  } catch (error) {
    if (!res.headersSent) throw error;
    res.destroy(error instanceof Error ? error : undefined);
    return true;
  }
  return writeOutcome(res, outcome);
}

/** @param {string} method @param {string} pathname */
function matchSessionRoute(method, pathname) {
  if (method === "POST" && pathname === "/api/sessions/start") {
    return { operation: "start", readsInput: true };
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(logs|stop|links))?$/);
  if (sessionMatch) {
    const [, sessionID, action] = sessionMatch;
    const operation =
      method === "GET" && !action
        ? "get"
        : method === "GET" && action === "logs"
          ? "logs"
          : method === "POST" && action === "stop"
            ? "stop"
            : method === "GET" && action === "links"
              ? "links"
              : "unhandled";
    return { operation, sessionID, readsInput: false };
  }

  /** @type {Array<[string, RegExp, string, boolean]>} */
  const operationDefinitions = [
    ["GET", /^\/api\/sessions\/([^/]+)\/stream$/, "stream", false],
    ["GET", /^\/api\/sessions\/([^/]+)\/frame-mask$/, "frame-mask", false],
    ["POST", /^\/api\/sessions\/([^/]+)\/type$/, "type", true],
    ["POST", /^\/api\/sessions\/([^/]+)\/key$/, "key", true],
    ["POST", /^\/api\/sessions\/([^/]+)\/tap$/, "tap", true],
    ["POST", /^\/api\/sessions\/([^/]+)\/gesture$/, "gesture", true],
    ["POST", /^\/api\/sessions\/([^/]+)\/multitouch$/, "multitouch", true],
  ];
  for (const definition of operationDefinitions) {
    const [expectedMethod, pattern, operation, readsInput] = definition;
    if (method !== expectedMethod) continue;
    const operationMatch = pathname.match(/** @type {RegExp} */ (pattern));
    if (operationMatch) return { operation, sessionID: operationMatch[1], readsInput };
  }

  const controlMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/control\/([a-z-]+)$/);
  if (method === "POST" && controlMatch) {
    return {
      operation: "control",
      sessionID: controlMatch[1],
      control: controlMatch[2],
      readsInput: false,
    };
  }

  const webMatch = pathname.match(/^\/s\/([^/]+)$/);
  return webMatch ? { operation: "web", sessionID: webMatch[1], readsInput: false } : null;
}

/** @param {import("node:http").ServerResponse} res @param {SessionRouteOutcome} outcome */
function writeOutcome(res, outcome) {
  if (outcome.kind === "unhandled") return false;
  if (outcome.kind === "streamed") return true;
  if (outcome.kind === "unauthorized") {
    unauthorized(res);
    return true;
  }
  if (outcome.kind === "not-found") {
    notFound(res, outcome.message || "Unknown session.");
    return true;
  }
  if (outcome.kind === "ok") {
    json(res, outcome.status || 200, outcome.body);
    return true;
  }
  if (outcome.kind === "html") {
    text(res, 200, String(outcome.body || ""), "text/html; charset=utf-8");
    return true;
  }
  if (outcome.kind === "mask" && outcome.mask) {
    const { mask } = outcome;
    res.writeHead(200, {
      "content-type": mask.contentType,
      "content-length": mask.data.length,
      "cache-control": "private, max-age=86400",
      "x-swift-sim-frame-width": mask.width,
      "x-swift-sim-frame-height": mask.height,
    });
    res.end(mask.data);
    return true;
  }
  throw new TypeError(`Unknown session route outcome: ${outcome.kind}`);
}

/** @param {string} name @param {string} exposure @param {string} authorization */
function route(name, exposure, authorization) {
  return Object.freeze({ route: name, exposure, authorization });
}

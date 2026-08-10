// @ts-check

import { badRequest, text, unauthorized } from "../http.js";

export const pairingPageAuthorizationMatrix = Object.freeze([
  Object.freeze({
    route: "GET /pair",
    exposure: "private-helper",
    authorization: "pairing-token-or-one-time-invite",
  }),
]);

/**
 * @param {{
 *   req: import("node:http").IncomingMessage,
 *   res: import("node:http").ServerResponse,
 *   url: URL,
 *   service: { execute(input: { request: unknown, url: URL }): Promise<{ kind: string, status?: number, body?: unknown, message?: string, contentType?: string, headers?: Record<string, string> }> },
 * }} input
 */
export async function handlePairingPageRoutes({ req, res, url, service }) {
  if (req.method !== "GET" || url.pathname !== "/pair") return false;
  const outcome = await service.execute({ request: req, url });
  if (outcome.kind === "unauthorized") unauthorized(res);
  else if (outcome.kind === "bad-request") {
    badRequest(res, outcome.status || 400, outcome.message || "Bad request.");
  } else if (outcome.kind === "text") {
    text(
      res,
      outcome.status || 200,
      String(outcome.body || ""),
      outcome.contentType || "text/plain; charset=utf-8",
      outcome.headers || {},
    );
  } else {
    throw new TypeError(`Unknown pairing page outcome: ${outcome.kind}`);
  }
  return true;
}

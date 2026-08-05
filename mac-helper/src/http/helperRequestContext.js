// @ts-check

import { URL } from "node:url";

/**
 * @typedef {{
 *   method?: unknown,
 *   url?: unknown,
 *   headers?: {
 *     host?: unknown,
 *     authorization?: unknown,
 *     "x-forwarded-host"?: unknown,
 *     "x-forwarded-proto"?: unknown,
 *   },
 *   socket?: { remoteAddress?: unknown },
 * }} HelperRequestLike
 * @typedef {{
 *   method: string,
 *   url: URL,
 *   pathname: string,
 *   bearerToken: string,
 *   socketRemoteAddress: string,
 *   hostHeader: string,
 *   forwardedHostHeader?: string,
 *   forwardedProtoHeader?: string,
 * }} HelperRequestContext
 */

/**
 * Parse the stable request metadata used by the helper compatibility boundary.
 * Invalid request URLs return null so callers can preserve their current
 * fall-through behavior.
 *
 * @param {HelperRequestLike | null | undefined} request
 * @param {{ defaultHost?: string }} [options]
 * @returns {HelperRequestContext | null}
 */
export function createHelperRequestContext(request, { defaultHost = "127.0.0.1" } = {}) {
  if (typeof defaultHost !== "string" || defaultHost.length === 0) {
    throw new TypeError("Helper request context requires a non-empty default host.");
  }
  const hostHeader = normalizedRequestHeader(request?.headers?.host) || defaultHost;
  let url;
  try {
    url = new URL(typeof request?.url === "string" && request.url ? request.url : "/", `http://${hostHeader}`);
  } catch {
    return null;
  }

  const authorization = normalizedRequestHeader(request?.headers?.authorization) || "";
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  return {
    method: typeof request?.method === "string" ? request.method : "",
    url,
    pathname: url.pathname,
    bearerToken,
    socketRemoteAddress: String(request?.socket?.remoteAddress || ""),
    hostHeader,
    forwardedHostHeader: normalizedRequestHeader(request?.headers?.["x-forwarded-host"]),
    forwardedProtoHeader: normalizedRequestHeader(request?.headers?.["x-forwarded-proto"]),
  };
}

/**
 * Preserve bearer-token precedence over a query-string capability token.
 *
 * @param {HelperRequestContext} context
 * @param {string} [queryName]
 */
export function helperRequestToken(context, queryName = "token") {
  if (!context || !(context.url instanceof URL)) {
    throw new TypeError("Helper request token requires a valid request context.");
  }
  if (typeof queryName !== "string" || queryName.length === 0) {
    throw new TypeError("Helper request token requires a non-empty query name.");
  }
  return context.bearerToken || context.url.searchParams.get(queryName) || "";
}

/** @param {unknown} value */
export function normalizedRequestHeader(value) {
  if (Array.isArray(value)) return value.join(",");
  return value == null ? undefined : String(value);
}

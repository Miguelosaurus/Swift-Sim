// @ts-check

import { timingSafeEqual } from "node:crypto";
import { sanitizePublicBuildLogs } from "../publicBuildLogs.js";
import { createHelperRequestContext, helperRequestToken } from "./helperRequestContext.js";
import { writeHelperJson } from "./helperHttpResponses.js";

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
 *   writeHead(status: number, headers: Record<string, string>): unknown,
 *   end(body?: string): unknown,
 * }} HelperResponseLike
 * @typedef {{ token?: unknown, expiresAt?: unknown }} PublicCapability
 * @typedef {{
 *   id: string,
 *   token?: unknown,
 *   expiresAt?: unknown,
 *   state?: unknown,
 *   logs?: unknown[],
 *   capabilities?: PublicCapability[],
 * }} PublicBuild
 * @typedef {{ tokenMatches(token: string): boolean }} PairingStorePort
 * @typedef {{ get(buildID: string): PublicBuild | null }} DeviceBuildStorePort
 */

/**
 * @param {HelperRequestLike} request
 * @param {HelperResponseLike} response
 * @param {{ pairingStore: PairingStorePort, deviceBuildStore: DeviceBuildStorePort }} stores
 */
export function handlePublicBuildExpiryRequest(
  request,
  response,
  { pairingStore, deviceBuildStore },
) {
  const context = createHelperRequestContext(request);
  if (!context) return false;
  const match = context.pathname.match(
    /^\/(?:d\/([^/]+)|api\/device-builds\/([^/]+)(?:\/(?:logs|links|install-request|verify|artifact\/(?:ipa|manifest)))?)$/,
  );
  if (!match) return false;
  const token = helperRequestToken(context);
  if (pairingStore.tokenMatches(token)) return false;

  const buildID = match[1] || match[2];
  if (!buildID) return false;
  const build = deviceBuildStore.get(buildID);
  const capability = build && capabilityForToken(build, token);
  if (!build || !capability) return false;
  const mustHaveExpiry = capability !== build || build.state === "ready";
  if (!mustHaveExpiry) return false;
  const expiresAt = Date.parse(String(capability.expiresAt || ""));
  if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return false;
  writeHelperJson(response, 410, { error: "This install link has expired." });
  return true;
}

/**
 * @param {HelperRequestLike} request
 * @param {HelperResponseLike} response
 * @param {{ pairingStore: PairingStorePort, deviceBuildStore: DeviceBuildStorePort }} stores
 */
export function handlePublicBuildLogsRequest(
  request,
  response,
  { pairingStore, deviceBuildStore },
) {
  if (request?.method !== "GET") return false;
  const context = createHelperRequestContext(request);
  if (!context) return false;
  const match = context.pathname.match(/^\/api\/device-builds\/([^/]+)\/logs$/);
  if (!match?.[1]) return false;
  const token = helperRequestToken(context);
  if (pairingStore.tokenMatches(token)) return false;

  const build = deviceBuildStore.get(match[1]);
  const capability = build && capabilityForToken(build, token);
  if (!build || !capability) {
    writeHelperJson(response, 401, { error: "Unauthorized." });
    return true;
  }
  const expiresAt = Date.parse(String(capability.expiresAt || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    writeHelperJson(response, 410, { error: "This install link has expired." });
    return true;
  }
  writeHelperJson(response, 200, {
    buildId: build.id,
    logs: sanitizePublicBuildLogs(build),
  });
  return true;
}

/**
 * @param {PublicBuild} build
 * @param {string} token
 * @returns {PublicBuild | PublicCapability | null}
 */
function capabilityForToken(build, token) {
  if (secretsMatch(build?.token, token)) return build;
  return (
    (Array.isArray(build?.capabilities) ? build.capabilities : []).find((item) =>
      secretsMatch(item?.token, token),
    ) || null
  );
}

/** @param {unknown} expected @param {unknown} actual */
function secretsMatch(expected, actual) {
  if (!expected || !actual) return false;
  const expectedBuffer = Buffer.from(String(expected));
  const actualBuffer = Buffer.from(String(actual));
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

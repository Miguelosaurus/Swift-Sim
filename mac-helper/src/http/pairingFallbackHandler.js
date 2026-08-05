// @ts-check

import { buildPairingLinks } from "../links.js";
import { createHelperRequestContext } from "./helperRequestContext.js";
import { writeHelperHtml, writeHelperJson } from "./helperHttpResponses.js";

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
 * @typedef {{ token: string, installationID: string, macName: string }} PairingState
 * @typedef {{
 *   current(): PairingState,
 *   tokenMatches(token: string): boolean,
 * }} PairingStorePort
 * @typedef {{
 *   inspect(invite: string, pairing: PairingState): {
 *     claimed?: boolean,
 *     expiresAt: string,
 *   } | null,
 * }} PairingInviteStorePort
 * @typedef {{
 *   evaluate(input: {
 *     socketRemoteAddress: string,
 *     requestProtocol: string,
 *     hostHeader: string,
 *     forwardedHostHeader?: string,
 *     forwardedProtoHeader?: string,
 *     requestedExternalBaseURL?: string,
 *   }): { valid: boolean, externalBaseURL: string },
 * }} RequestOriginPolicyPort
 * @typedef {{ observeCredential(pairing: unknown): unknown }} PairingShadowObserverPort
 */

/**
 * Handle the compatibility pairing page without constructing stores or policy.
 *
 * @param {HelperRequestLike} request
 * @param {HelperResponseLike} response
 * @param {PairingStorePort} pairingStore
 * @param {PairingInviteStorePort} pairingInvites
 * @param {RequestOriginPolicyPort} originPolicy
 * @param {PairingShadowObserverPort} [shadowObserver]
 */
export function handlePairingFallbackRequest(
  request,
  response,
  pairingStore,
  pairingInvites,
  originPolicy,
  shadowObserver = undefined,
) {
  if (request?.method !== "GET") return false;
  const context = createHelperRequestContext(request);
  if (!context || context.pathname !== "/pair") return false;

  const pairing = pairingStore.current();
  const invite = context.url.searchParams.get("invite") || "";
  if (invite) {
    const invitation = pairingInvites.inspect(invite, pairing);
    if (!invitation || invitation.claimed) {
      writeHelperJson(response, 410, { error: "Pairing invitation expired or already used." });
      return true;
    }
    const base = externalBaseURL(context, originPolicy);
    const customScheme = buildPairingLinks(
      {
        ...pairing,
        invite,
        expiresAt: invitation.expiresAt,
      },
      base,
    ).customScheme;
    writeHelperHtml(response, pairingPage(customScheme, pairing.macName, invitation.expiresAt));
    deferCredentialObservation(shadowObserver, pairing);
    return true;
  }

  const token = context.url.searchParams.get("token") || "";
  if (!pairingStore.tokenMatches(token)) {
    writeHelperJson(response, 401, { error: "Unauthorized." });
    return true;
  }
  const base = externalBaseURL(context, originPolicy);
  const customScheme = buildPairingLinks(pairing, base).customScheme;
  writeHelperHtml(response, pairingPage(customScheme, pairing.macName));
  deferCredentialObservation(shadowObserver, pairing);
  return true;
}

/**
 * @param {PairingShadowObserverPort | undefined} shadowObserver
 * @param {PairingState} pairing
 */
function deferCredentialObservation(shadowObserver, pairing) {
  if (!shadowObserver || typeof shadowObserver.observeCredential !== "function") return;
  try {
    const snapshot = { ...pairing };
    setImmediate(() => {
      try {
        const result = shadowObserver.observeCredential(snapshot);
        void Promise.resolve(result).catch(() => {});
      } catch {
        // Shadow diagnostics never affect JSON authorization or HTTP responses.
      }
    });
  } catch {
    // Snapshot or scheduling failures are also best-effort diagnostics only.
  }
}

/**
 * @param {NonNullable<ReturnType<typeof createHelperRequestContext>>} context
 * @param {RequestOriginPolicyPort} originPolicy
 */
function externalBaseURL(context, originPolicy) {
  const { url } = context;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `${url.protocol}//${url.host}`;
  }
  const requestedExternalBaseURL = url.searchParams.get("base") || undefined;
  const decision = originPolicy.evaluate({
    socketRemoteAddress: context.socketRemoteAddress,
    requestProtocol: url.protocol,
    hostHeader: context.hostHeader || url.host || "",
    ...(context.forwardedHostHeader === undefined
      ? {}
      : { forwardedHostHeader: context.forwardedHostHeader }),
    ...(context.forwardedProtoHeader === undefined
      ? {}
      : { forwardedProtoHeader: context.forwardedProtoHeader }),
    ...(requestedExternalBaseURL === undefined ? {} : { requestedExternalBaseURL }),
  });
  return decision.valid ? decision.externalBaseURL : `${url.protocol}//${url.host}`;
}

/** @param {string} customScheme @param {string} macName @param {string} [expiresAt] */
function pairingPage(customScheme, macName = "this Mac", expiresAt = "") {
  const expiry = expiresAt ? `<p>This invitation expires at ${escapeHTML(expiresAt)}.</p>` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Swift Sim</title><style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f8fbff;color:#121417}main{max-width:560px;margin:0 auto;padding:40px 22px}a{display:inline-block;margin-top:18px;padding:14px 18px;border-radius:999px;color:white;background:#1677ff;text-decoration:none;font-weight:700}code{display:block;margin-top:18px;padding:14px;border-radius:14px;background:white;word-break:break-all}
</style></head><body><main><h1>Connect to ${escapeHTML(macName)}</h1><p>Open Swift Sim on your iPhone and connect it to this Mac over Tailscale.</p>${expiry}<a href="${escapeHTML(customScheme)}">Open Swift Sim</a><code>${escapeHTML(customScheme)}</code></main></body></html>`;
}

/** @param {unknown} value */
function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

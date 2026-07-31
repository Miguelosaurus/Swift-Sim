import {
  GATEWAY_RUNTIME_ROLE,
  runtimeHealthMatches,
} from "./runtimeHealth.js";

let installed = false;

export function installGatewayHealthFetchBoundary() {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function guardedGatewayFetch(input, init) {
    const response = await originalFetch.call(this, input, init);
    if (!isGatewayHealthRequest(input)) return response;
    let payload = null;
    try { payload = await response.clone().json(); } catch {}
    if (response.ok && runtimeHealthMatches(payload, GATEWAY_RUNTIME_ROLE)) return response;
    return new Response(JSON.stringify({ error: "The Swift Sim device gateway is not ready." }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  };
}

export function isGatewayHealthRequest(input) {
  let value = "";
  if (typeof input === "string" || input instanceof URL) value = String(input);
  else value = String(input?.url || "");
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "http:"
      && url.pathname === "/health"
      && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(host);
  } catch {
    return false;
  }
}

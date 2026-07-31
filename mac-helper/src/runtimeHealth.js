import packageJSON from "../../package.json" with { type: "json" };

export const SWIFT_SIM_VERSION = String(packageJSON.version || "");
export const SWIFT_SIM_RUNTIME_PROTOCOL = 1;
export const HELPER_RUNTIME_ROLE = "swift-sim-helper";
export const GATEWAY_RUNTIME_ROLE = "swift-sim-device-gateway";

export function runtimeHealthPayload(role, { nonce = runtimeHealthNonce(role) } = {}) {
  return {
    ok: true,
    helper: String(role || ""),
    version: SWIFT_SIM_VERSION,
    protocol: SWIFT_SIM_RUNTIME_PROTOCOL,
    ...(nonce ? { nonce: String(nonce) } : {}),
  };
}

export function runtimeHealthMatches(payload, expectedRole, {
  version = SWIFT_SIM_VERSION,
  protocol = SWIFT_SIM_RUNTIME_PROTOCOL,
  nonce = "",
} = {}) {
  return Boolean(
    payload
      && payload.ok === true
      && String(payload.helper || "") === String(expectedRole || "")
      && String(payload.version || "") === String(version || "")
      && Number(payload.protocol) === Number(protocol)
      && (!nonce || String(payload.nonce || "") === String(nonce))
  );
}

export async function inspectRuntimeHealth(url, {
  expectedRole = HELPER_RUNTIME_ROLE,
  version = SWIFT_SIM_VERSION,
  protocol = SWIFT_SIM_RUNTIME_PROTOCOL,
  nonce = "",
  timeoutMs = 1_200,
  fetchImpl = globalThis.fetch,
} = {}) {
  try {
    const options = { cache: "no-store" };
    if (timeoutMs > 0 && typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      options.signal = AbortSignal.timeout(timeoutMs);
    }
    const response = await fetchImpl(url, options);
    let payload = null;
    try { payload = await response.json(); } catch {}
    return {
      reachable: true,
      ok: response.ok && runtimeHealthMatches(payload, expectedRole, { version, protocol, nonce }),
      status: Number(response.status || 0),
      helper: String(payload?.helper || ""),
      version: String(payload?.version || ""),
      protocol: Number(payload?.protocol || 0),
      payload,
    };
  } catch (error) {
    return {
      reachable: false,
      ok: false,
      status: 0,
      helper: "",
      version: "",
      protocol: 0,
      error: error instanceof Error ? error.message : String(error),
      payload: null,
    };
  }
}

function runtimeHealthNonce(role) {
  return role === GATEWAY_RUNTIME_ROLE
    ? String(process.env.SWIFT_SIM_GATEWAY_HEALTH_NONCE || "")
    : "";
}

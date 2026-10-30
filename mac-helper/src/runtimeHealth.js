import packageJSON from "../../package.json" with { type: "json" };

const originalHealthFetch = globalThis.fetch;

// Capture transport before compatibility wrappers so typed health consumers
// can inspect the original status and identity without a synthetic 503.
export function fetchRuntimeHealth(input, init) {
  return originalHealthFetch(input, init);
}

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
    ...(role === HELPER_RUNTIME_ROLE ? { capabilities: ["durable-live-delivery-v1", "durable-desired-state-v1"] } : {}),
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

// Health is tiny and local. Bound both the request and body; a listener that
// sends headers and stalls must not turn a warm edit into an unbounded wait.
export async function inspectRuntimeHealth(url, {
  expectedRole = HELPER_RUNTIME_ROLE,
  version = SWIFT_SIM_VERSION,
  protocol = SWIFT_SIM_RUNTIME_PROTOCOL,
  nonce = "",
  timeoutMs = 1_200,
  fetchImpl = fetchRuntimeHealth,
} = {}) {
  const controller = new AbortController();
  let deadline;
  const timeout = timeoutMs > 0 ? new Promise((_, reject) => {
    deadline = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("Helper health deadline exceeded."), { name: "TimeoutError" }));
    }, timeoutMs);
  }) : null;
  let response;
  try {
    const inspect = async () => {
      response = await fetchImpl(url, { cache: "no-store", redirect: "error", signal: controller.signal });
      const status = Number(response.status || 0);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return healthFailure("HELPER_HTTP_ERROR", { category: "http", httpStatus: status }, { reachable: true, status });
      }
      let payload;
      try {
        payload = JSON.parse(await boundedHealthBody(response, controller.signal));
      } catch (error) {
        if (controller.signal.aborted || (!(error instanceof SyntaxError) && error?.code !== "HEALTH_BODY_TOO_LARGE")) throw error;
        return healthFailure("HELPER_RESPONSE_INVALID", { category: error?.code === "HEALTH_BODY_TOO_LARGE" ? "body-too-large" : "invalid-json" }, { reachable: true, status });
      }
      const details = {
        reachable: true, status,
        helper: typeof payload?.helper === "string" ? payload.helper : "",
        version: typeof payload?.version === "string" ? payload.version : "",
        protocol: Number(payload?.protocol || 0), payload,
      };
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
        || typeof payload.ok !== "boolean" || typeof payload.helper !== "string"
        || typeof payload.version !== "string" || !Number.isInteger(payload.protocol)) {
        return healthFailure("HELPER_RESPONSE_INVALID", { category: "invalid-envelope" }, details);
      }
      if (payload.helper !== expectedRole) return healthFailure("HELPER_IDENTITY_MISMATCH", { category: "identity" }, details);
      if (payload.version !== version) return healthFailure("HELPER_VERSION_MISMATCH", { category: "version" }, details);
      if (payload.protocol !== protocol) return healthFailure("PROTOCOL_MISMATCH", { category: "protocol" }, details);
      if (!payload.ok) return healthFailure("HELPER_UNHEALTHY", { category: "not-ready" }, details);
      if (nonce && String(payload.nonce || "") !== String(nonce)) return healthFailure("HELPER_IDENTITY_MISMATCH", { category: "nonce" }, details);
      return { ...details, ok: true };
    };
    return await (timeout ? Promise.race([inspect(), timeout]) : inspect());
  } catch (error) {
    if (controller.signal.aborted || error?.name === "TimeoutError") {
      return healthFailure("HELPER_TIMEOUT", { category: "timeout" });
    }
    const transportCode = safeTransportCode(error);
    return healthFailure(transportCode === "ECONNREFUSED" ? "HELPER_CONNECTION_REFUSED" : "HELPER_TRANSPORT_ERROR", {
      category: "transport", ...(transportCode ? { transportCode } : {}),
    });
  } finally {
    clearTimeout(deadline);
  }
}

function healthFailure(code, cause, details = {}) {
  return {
    reachable: false, status: 0, helper: "", version: "", protocol: 0,
    payload: null, ...details, ok: false, failureCode: code, cause,
    // Never surface Error.message from an HTTP client: it can include private
    // endpoints, filesystem paths, bearer strings or an arbitrary server body.
    error: code,
  };
}

async function boundedHealthBody(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8");
      length += value.byteLength;
      if (length > 16_384) {
        await reader.cancel();
        throw Object.assign(new Error("Helper health response exceeded its limit."), { code: "HEALTH_BODY_TOO_LARGE" });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function safeTransportCode(error) {
  const codes = [error?.code, error?.cause?.code,
    ...(Array.isArray(error?.cause?.errors) ? error.cause.errors.map((item) => item?.code) : [])];
  const allowed = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);
  return codes.find((code) => allowed.has(code)) || "";
}

function runtimeHealthNonce(role) {
  return role === GATEWAY_RUNTIME_ROLE
    ? String(process.env.SWIFT_SIM_GATEWAY_HEALTH_NONCE || "")
    : "";
}

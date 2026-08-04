// @ts-check
import { URL } from "node:url";

/** @typedef {import("./ports.js").RequestOriginPolicy} RequestOriginPolicy */
/** @typedef {import("./ports.js").RequestOriginInput} RequestOriginInput */
/** @typedef {import("./ports.js").RequestOriginDecision} RequestOriginDecision */

/** @implements {RequestOriginPolicy} */
export class LoopbackRequestOriginPolicy {
  /**
   * @param {RequestOriginInput} input
   * @returns {RequestOriginDecision}
   */
  evaluate(input) {
    const requestIsLoopback = isLoopbackAddress(input.socketRemoteAddress);
    const forwardedHeadersTrusted = requestIsLoopback;
    const requestHost = normalizeHost(input.hostHeader);
    if (!requestHost) {
      return {
        valid: false,
        requestIsLoopback,
        forwardedHeadersTrusted,
        reason: "invalid-host",
      };
    }

    const proxyHost = forwardedHeadersTrusted
      ? normalizeHost(firstForwardedValue(input.forwardedHostHeader))
      : "";
    const allowedHosts = new Set([requestHost, proxyHost].filter(Boolean));
    const requested = normalizeExternalOrigin(input.requestedExternalBaseURL);
    if (requested && allowedHosts.has(normalizeHost(new URL(requested).host))) {
      return {
        valid: true,
        requestIsLoopback,
        forwardedHeadersTrusted,
        externalBaseURL: requested,
        source: "requested",
      };
    }

    const forwardedProtocol = forwardedHeadersTrusted
      ? normalizeForwardedProtocol(input.forwardedProtoHeader)
      : "";
    const protocol = forwardedProtocol || input.requestProtocol;
    const host = proxyHost || requestHost;
    const externalBaseURL = normalizeExternalOrigin(`${protocol}//${host}`);
    if (!externalBaseURL) {
      return {
        valid: false,
        requestIsLoopback,
        forwardedHeadersTrusted,
        reason: "invalid-host",
      };
    }

    return {
      valid: true,
      requestIsLoopback,
      forwardedHeadersTrusted,
      externalBaseURL,
      source: proxyHost ? "trusted-proxy" : "direct",
    };
  }
}

/** @param {string} value */
export function isLoopbackAddress(value) {
  const address = String(value || "").toLowerCase();
  return (
    address === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(address) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(address)
  );
}

/** @param {string | undefined} value */
function firstForwardedValue(value) {
  return (
    String(value || "")
      .split(",")[0]
      ?.trim() || ""
  );
}

/**
 * @param {string | undefined} value
 * @returns {"http:" | "https:" | ""}
 */
function normalizeForwardedProtocol(value) {
  const protocol = firstForwardedValue(value).toLowerCase();
  if (protocol === "http") return "http:";
  if (protocol === "https") return "https:";
  return "";
}

/** @param {string} value */
function normalizeHost(value) {
  const candidate = String(value || "").trim();
  if (!candidate || /[\s/@\\]/.test(candidate)) return "";
  try {
    return new URL(`http://${candidate}`).host.toLowerCase();
  } catch {
    return "";
  }
}

/** @param {string | undefined} value */
function normalizeExternalOrigin(value) {
  if (!value) return "";
  try {
    const parsed = new URL(String(value));
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !parsed.host ||
      parsed.username ||
      parsed.password
    ) {
      return "";
    }
    return parsed.origin;
  } catch {
    return "";
  }
}

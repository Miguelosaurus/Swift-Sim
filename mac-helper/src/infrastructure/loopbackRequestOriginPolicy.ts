import { URL } from "node:url";
import type { RequestOriginDecision, RequestOriginInput, RequestOriginPolicy } from "./ports.js";

export class LoopbackRequestOriginPolicy implements RequestOriginPolicy {
  evaluate(input: RequestOriginInput): RequestOriginDecision {
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
      ? normalizeForwardedHost(input.forwardedHostHeader)
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

export function isLoopbackAddress(value: string): boolean {
  const address = String(value || "").toLowerCase();
  return (
    address === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(address) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(address)
  );
}

function normalizeForwardedHost(value: string | undefined): string {
  return normalizeHost(String(value || "").split(",")[0]?.trim() || "");
}

function normalizeForwardedProtocol(value: string | undefined): "http:" | "https:" | "" {
  const protocol = String(value || "").split(",")[0]?.trim().toLowerCase();
  if (protocol === "http" || protocol === "https") return `${protocol}:`;
  return "";
}

function normalizeHost(value: string): string {
  const candidate = String(value || "").trim();
  if (!candidate || /[\s/@\\]/.test(candidate)) return "";
  try {
    return new URL(`http://${candidate}`).host.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeExternalOrigin(value: string | undefined): string {
  if (!value) return "";
  try {
    const parsed = new URL(String(value));
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
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

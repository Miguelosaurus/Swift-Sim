import { timingSafeEqual } from "node:crypto";
import { publicDeviceBuild } from "./deviceBuilder.js";

export const ACTIVE_CAPABILITY_LIFETIME_MS = 4 * 60 * 60 * 1000;
export const FAILED_CAPABILITY_GRACE_MS = 30 * 60 * 1000;
const ACTIVE_BUILD_STATES = new Set([
  "queued",
  "validating",
  "preparing",
  "archiving",
  "building",
  "exporting",
  "delivering",
]);

export function capabilityForTokens(build, tokens = []) {
  if (!build) return null;
  for (const token of uniqueTokens(tokens)) {
    if (secretsMatch(build.token, token)) return build;
    const historical = (Array.isArray(build.capabilities) ? build.capabilities : [])
      .find((item) => secretsMatch(item?.token, token));
    if (historical) return historical;
  }
  return null;
}

export function effectiveCapabilityExpiry(build, capability = build) {
  const explicitValue = String(capability?.expiresAt || "").trim();
  const explicit = explicitValue ? Date.parse(explicitValue) : Number.NaN;
  if (explicitValue && !Number.isFinite(explicit)) return Number.NaN;

  const isCurrent = Boolean(build && capability && secretsMatch(build.token, capability.token));
  if (!isCurrent) return Number.isFinite(explicit) ? explicit : Number.NaN;

  if (ACTIVE_BUILD_STATES.has(build.state)) {
    const createdAt = Date.parse(build.createdAt || "");
    if (!Number.isFinite(createdAt)) return Number.NaN;
    const activeExpiry = createdAt + ACTIVE_CAPABILITY_LIFETIME_MS;
    return Number.isFinite(explicit) ? Math.min(explicit, activeExpiry) : activeExpiry;
  }

  if (build.state === "failed") {
    const failedAt = Date.parse(build.updatedAt || build.createdAt || "");
    if (!Number.isFinite(failedAt)) return Number.NaN;
    const diagnosticExpiry = failedAt + FAILED_CAPABILITY_GRACE_MS;
    const createdAt = Date.parse(build.createdAt || "");
    const boundedExpiry = Number.isFinite(createdAt)
      ? Math.min(diagnosticExpiry, createdAt + ACTIVE_CAPABILITY_LIFETIME_MS)
      : diagnosticExpiry;
    return Number.isFinite(explicit) ? Math.min(explicit, boundedExpiry) : boundedExpiry;
  }

  return Number.isFinite(explicit) ? explicit : Number.NaN;
}

export function deviceBuildCapabilityExpired(build, capability = build, now = Date.now()) {
  const expiresAt = effectiveCapabilityExpiry(build, capability);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function projectCapabilityBuild(build, capability = build) {
  if (!build || !capability) return null;
  if (capability === build) return structuredClone(build);
  return {
    ...structuredClone(build),
    token: capability.token,
    expiresAt: capability.expiresAt || "",
    remoteBaseUrl: capability.remoteBaseUrl || "",
    delivery: capability.delivery ? structuredClone(capability.delivery) : null,
    installTTLMinutes: capability.installTTLMinutes || build.installTTLMinutes,
  };
}

export function publicCapabilityDeviceBuild(build, capability = build) {
  const scoped = projectCapabilityBuild(build, capability);
  if (!scoped) return null;
  const response = publicDeviceBuild(scoped);
  const effectiveExpiry = effectiveCapabilityExpiry(build, capability);
  const delivery = response.delivery || {};
  const installation = response.installation || {};
  const liveReload = response.liveReload || {};
  return {
    ...response,
    expiresAt: Number.isFinite(effectiveExpiry)
      ? new Date(effectiveExpiry).toISOString()
      : "",
    liveReload: {
      ...liveReload,
      error: liveReload.error ? "Live patch preparation was unavailable." : "",
    },
    app: {
      ...response.app,
      teamID: "",
    },
    delivery: {
      mode: delivery.mode || "",
      provider: delivery.provider || "",
      expiresAt: delivery.expiresAt || response.expiresAt || "",
    },
    installation: {
      state: installation.state || "unknown",
      requestedAt: installation.requestedAt || "",
      verifiedAt: installation.verifiedAt || "",
      devices: [],
    },
  };
}

function uniqueTokens(tokens) {
  return [...new Set((Array.isArray(tokens) ? tokens : [tokens])
    .map((token) => String(token || "").trim())
    .filter(Boolean))];
}

function secretsMatch(expectedValue, actualValue) {
  if (!expectedValue || !actualValue) return false;
  const expected = Buffer.from(String(expectedValue));
  const actual = Buffer.from(String(actualValue));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

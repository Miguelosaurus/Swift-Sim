const KNOWN_TRANSPORTS = new Set(["native-companion", "serve-sim"]);

export function sessionTransportCandidates(preference = "", {
  nativeDisabled = process.env.SWIFT_SIM_DISABLE_NATIVE_TRANSPORT === "1",
} = {}) {
  const value = String(preference || "").trim();
  if (!value) return [];
  if (value === "auto") {
    return nativeDisabled
      ? ["serve-sim"]
      : ["native-companion", "serve-sim"];
  }
  return [value];
}

export function sessionTransportMatches(activeTransport, preference, options = {}) {
  const active = String(activeTransport || "serve-sim");
  return sessionTransportCandidates(preference, options).includes(active);
}

export function resolvedSessionTransport(preference = "auto", options = {}) {
  const candidates = sessionTransportCandidates(preference, options);
  const selected = candidates[0] || "";
  if (!KNOWN_TRANSPORTS.has(selected)) {
    throw new Error(`Unknown transport: ${preference}`);
  }
  return selected;
}

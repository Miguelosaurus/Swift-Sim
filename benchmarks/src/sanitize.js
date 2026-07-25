const HOME_PATH = /\/Users\/[^/\s]+/g;
const TMP_PATH = /\/(?:private\/)?(?:var\/folders|tmp|var\/tmp)\/[^\s"']+/g;
const SWIFT_SIM_PATH = /(?:~|\/Users\/[^/\s]+)\/\.swift-sim(?:\/[^\s"']*)?/g;
const TOKEN = /([?&](?:token|auth|key)=)[^&\s"']+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const UDID = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g;
const TEAM_ID = /\b[A-Z0-9]{10}\b/g;
const TAILNET_HOST = /\b[a-z0-9-]+\.(?:ts|tailscale)\.net\b/gi;

export function sanitizeString(value) {
  return String(value)
    .replace(SWIFT_SIM_PATH, "<swift-sim-state>")
    .replace(TMP_PATH, "<temporary-path>")
    .replace(HOME_PATH, "<home>")
    .replace(TOKEN, "$1<redacted>")
    .replace(BEARER, "Bearer <redacted>")
    .replace(UDID, "<device-id>")
    .replace(TAILNET_HOST, "<tailnet-host>")
    .replace(TEAM_ID, "<team-id>");
}

export function sanitizeValue(value, key = "") {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [name, nested] of Object.entries(value)) {
    if (["source", "before", "after", "patch", "diff", "stdout", "stderr"].includes(name)) {
      result[name] = "<omitted>";
      continue;
    }
    result[name] = sanitizeValue(nested, name);
  }
  return result;
}

export function sanitizeError(error) {
  return sanitizeString(error instanceof Error ? error.message : String(error || ""));
}

const LOCAL_PATH_MARKERS = [
  "/Users/",
  "/home/",
  "/private/var/folders/",
  "/tmp/",
  "/Volumes/",
  "file://",
];
const SENSITIVE_BUILD_DETAIL = /(?:DEVELOPMENT_TEAM|PROVISIONING_PROFILE|CODE_SIGN_IDENTITY|EXPANDED_CODE_SIGN_IDENTITY|Apple (?:Development|Distribution):|security find-identity|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

export function sanitizePublicBuildLogs(build, { limit = 300 } = {}) {
  const secrets = [
    build?.token,
    ...(Array.isArray(build?.capabilities)
      ? build.capabilities.map((item) => item?.token)
      : []),
  ].filter(Boolean).map(String);

  return (Array.isArray(build?.logs) ? build.logs : [])
    .slice(-Math.max(0, Number(limit) || 0))
    .map((line) => sanitizeLine(line, secrets));
}

function sanitizeLine(line, secrets) {
  let sanitized = String(line ?? "").replace(/[\r\n]+/g, " ");
  for (const secret of secrets) {
    sanitized = sanitized.replaceAll(secret, "<redacted>");
  }
  sanitized = sanitized.replace(/([?&]token=)[^&\s"']+/gi, "$1<redacted>");
  if (LOCAL_PATH_MARKERS.some((marker) => sanitized.includes(marker))) {
    return "[local build detail redacted]";
  }
  if (SENSITIVE_BUILD_DETAIL.test(sanitized)) {
    return "[signing detail redacted]";
  }
  return sanitized.length <= 500 ? sanitized : `${sanitized.slice(0, 497)}...`;
}

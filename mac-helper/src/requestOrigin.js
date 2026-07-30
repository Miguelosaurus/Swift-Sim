export function externalRequestBase(req, url) {
  const forwarded = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const scheme = forwarded === "http" || forwarded === "https"
    ? forwarded
    : isLoopbackHost(url.hostname)
      ? url.protocol.replace(/:$/, "")
      : "https";
  return `${scheme}://${url.host}`;
}

function firstHeaderValue(value) {
  const text = Array.isArray(value) ? value[0] : value;
  return String(text || "").split(",")[0].trim().toLowerCase();
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

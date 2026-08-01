export function externalRequestBase(req, url) {
  const forwarded = forwardedHeadersAreTrusted(req)
    ? firstHeaderValue(req.headers["x-forwarded-proto"])
    : "";
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

function forwardedHeadersAreTrusted(req) {
  const address = String(req?.socket?.remoteAddress || "").toLowerCase();
  return address === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(address)
    || /^::ffff:127(?:\.\d{1,3}){3}$/.test(address);
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

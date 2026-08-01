import { enterSessionRequestContext } from "./sessionRequestContext.js";

const DEFAULT_MAX_JSON_BYTES = 64 * 1024;

export async function readJson(req, { maxBytes = DEFAULT_MAX_JSON_BYTES } = {}) {
  const sessionRequestContext = req.method === "POST"
      && /^\/api\/sessions\/start(?:\?|$)/.test(String(req.url || ""))
    ? enterSessionRequestContext({
        transport: process.env.SWIFT_SIM_TRANSPORT || "auto",
      })
    : null;
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Request body is too large.");
  }

  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maxBytes) {
      req.destroy();
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks, received).toString("utf8");
  if (!body.trim()) return {};
  const parsed = JSON.parse(body);
  if (sessionRequestContext) {
    sessionRequestContext.transport = String(
      parsed?.transport || process.env.SWIFT_SIM_TRANSPORT || "auto",
    );
  }
  return parsed;
}

export function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

export function text(res, status, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}

export function badRequest(res, status, message) {
  const publicMessage = process.env.SWIFT_SIM_PUBLIC_GATEWAY === "1"
    || res?.swiftSimPublicCapability === true
    ? publicErrorMessage(status)
    : message;
  return json(res, status, { error: publicMessage });
}

export function unauthorized(res) {
  return json(res, 401, { error: "Unauthorized." });
}

export function notFound(res, message) {
  const publicMessage = res?.swiftSimPublicCapability === true
    ? "This build resource is unavailable."
    : message;
  return json(res, 404, { error: publicMessage });
}

function publicErrorMessage(status) {
  if (status === 410) return "This install link has expired.";
  if (status === 409) return "This build is not ready or is no longer available.";
  return "The request could not be completed.";
}

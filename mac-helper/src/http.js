const DEFAULT_MAX_JSON_BYTES = 64 * 1024;

export async function readJson(req, { maxBytes = DEFAULT_MAX_JSON_BYTES } = {}) {
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Request body is too large.");
  }

  let body = "";
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > maxBytes) {
      req.destroy();
      throw new Error("Request body is too large.");
    }
    body += chunk;
  }
  if (!body.trim()) return {};
  return JSON.parse(body);
}

export function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

export function text(res, status, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(body);
}

export function badRequest(res, status, message) {
  const publicMessage = process.env.SWIFT_SIM_PUBLIC_GATEWAY === "1"
    ? publicErrorMessage(status)
    : message;
  return json(res, status, { error: publicMessage });
}

export function unauthorized(res) {
  return json(res, 401, { error: "Unauthorized." });
}

export function notFound(res, message) {
  return json(res, 404, { error: message });
}

function publicErrorMessage(status) {
  if (status === 410) return "This install link has expired.";
  if (status === 409) return "This build is not ready or is no longer available.";
  return "The request could not be completed.";
}

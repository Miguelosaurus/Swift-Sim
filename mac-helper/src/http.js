export async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
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

export function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

export function badRequest(res, status, message) {
  return json(res, status, { error: message });
}

export function unauthorized(res) {
  return json(res, 401, { error: "Unauthorized." });
}

export function notFound(res, message) {
  return json(res, 404, { error: message });
}

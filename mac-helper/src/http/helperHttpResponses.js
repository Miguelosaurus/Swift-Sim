// @ts-check

/**
 * @typedef {{
 *   writeHead(status: number, headers: Record<string, string>): unknown,
 *   end(body?: string): unknown,
 * }} HelperResponseLike
 */

/**
 * @param {HelperResponseLike} response
 * @param {number} status
 * @param {unknown} body
 */
export function writeHelperJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

/**
 * @param {HelperResponseLike} response
 * @param {string} body
 */
export function writeHelperHtml(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

// @ts-check

/**
 * @typedef {{
 *   currentPairing(): Record<string, unknown>,
 *   inspectInvite(invite: string, pairing: Record<string, unknown>): { claimed?: unknown, expiresAt?: unknown } | null | undefined,
 *   tokenMatches(token: string): boolean,
 *   requestBase(request: unknown, url: URL): string,
 *   renderPage(input: { pairing: Record<string, unknown>, base: string }): string,
 * }} PairingPageDependencies
 */

const PAGE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

/** @param {PairingPageDependencies} dependencies */
export function createPairingPageApplicationService(dependencies) {
  validateDependencies(dependencies);
  return Object.freeze({
    /** @param {{ request: unknown, url: URL }} input */
    async execute(input) {
      const token = input.url.searchParams.get("token") || "";
      const invite = input.url.searchParams.get("invite") || "";
      const pairing = dependencies.currentPairing();

      if (invite) {
        const invitation = dependencies.inspectInvite(invite, pairing);
        if (!invitation || invitation.claimed) {
          return badRequest(410, "Pairing invitation expired or already used.");
        }
        return page(
          dependencies.renderPage({
            pairing: { ...pairing, invite, expiresAt: invitation.expiresAt },
            base: dependencies.requestBase(input.request, input.url),
          }),
        );
      }

      if (!dependencies.tokenMatches(token)) return unauthorized();
      return page(
        dependencies.renderPage({
          pairing: { ...pairing, token },
          base: dependencies.requestBase(input.request, input.url),
        }),
      );
    },
  });
}

/** @param {string} body */
function page(body) {
  return /** @type {const} */ ({
    kind: "text",
    status: 200,
    body,
    contentType: "text/html; charset=utf-8",
    headers: PAGE_HEADERS,
  });
}

/** @param {number} status @param {string} message */
function badRequest(status, message) {
  return /** @type {const} */ ({ kind: "bad-request", status, message });
}

function unauthorized() {
  return /** @type {const} */ ({ kind: "unauthorized" });
}

/** @param {PairingPageDependencies} dependencies */
function validateDependencies(dependencies) {
  const required = [
    ["currentPairing", dependencies?.currentPairing],
    ["inspectInvite", dependencies?.inspectInvite],
    ["tokenMatches", dependencies?.tokenMatches],
    ["requestBase", dependencies?.requestBase],
    ["renderPage", dependencies?.renderPage],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Pairing page application service requires ${name}.`);
    }
  }
}

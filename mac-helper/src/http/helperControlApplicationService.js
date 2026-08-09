// @ts-check

/**
 * @typedef {{ kind: "ok", status: number, body: unknown } | { kind: "unauthorized" }} HelperControlOutcome
 * @typedef {{
 *   pairingTokenMatches(request: unknown, url: URL): boolean,
 *   association(): unknown,
 *   inspectServeSim(): Promise<unknown>,
 *   defaultTransport(): unknown,
 *   inspectTransports(): Promise<unknown>,
 *   pairingTokenMatchesQuery(token: string | null): boolean,
 *   pairingStatus(): unknown,
 *   currentPairing(): unknown,
 *   claimToken(request: unknown): string,
 *   claimInvite(invite: unknown, clientNonce: unknown, pairing: unknown): { ok: boolean, code?: string, pairing?: { token: string, installationID: string, macName: string }, expiresAt?: string },
 *   rotatePairing(): unknown,
 *   pairingLinks(pairing: unknown, remoteBaseURL: string): unknown,
 * }} HelperControlDependencies
 */

/** @param {HelperControlDependencies} dependencies */
export function createHelperControlApplicationService(dependencies) {
  validateDependencies(dependencies);
  return Object.freeze({
    /**
     * @param {{ operation: string, request?: unknown, url: URL, readInput?: () => Promise<Record<string, unknown>> }} input
     * @returns {Promise<HelperControlOutcome>}
     */
    async execute(input) {
      switch (input.operation) {
        case "health":
          return { kind: "ok", status: 200, body: { ok: true, helper: "swift-sim-helper" } };
        case "association":
          return { kind: "ok", status: 200, body: dependencies.association() };
        case "serve-sim":
          if (!dependencies.pairingTokenMatches(input.request, input.url)) return unauthorized();
          return { kind: "ok", status: 200, body: await dependencies.inspectServeSim() };
        case "transports":
          if (!dependencies.pairingTokenMatches(input.request, input.url)) return unauthorized();
          return {
            kind: "ok",
            status: 200,
            body: {
              default: dependencies.defaultTransport(),
              transports: await dependencies.inspectTransports(),
            },
          };
        case "pairing-status":
          if (!dependencies.pairingTokenMatchesQuery(input.url.searchParams.get("token"))) {
            return unauthorized();
          }
          return { kind: "ok", status: 200, body: dependencies.pairingStatus() };
        case "pairing-claim": {
          const body = await requiredInput(input.readInput);
          const invite = dependencies.claimToken(input.request) || body.invite || "";
          const clientNonce = body.clientNonce || "";
          const result = dependencies.claimInvite(
            invite,
            clientNonce,
            dependencies.currentPairing(),
          );
          if (!result.ok) {
            const status =
              result.code === "malformed" ? 400 : result.code === "consumed" ? 409 : 410;
            return {
              kind: "ok",
              status,
              body: { error: `Pairing invitation ${result.code}.` },
            };
          }
          if (!result.pairing)
            throw new TypeError("Successful pairing claim requires pairing state.");
          return {
            kind: "ok",
            status: 200,
            body: {
              token: result.pairing.token,
              installationID: result.pairing.installationID,
              macName: result.pairing.macName,
              expiresAt: result.expiresAt,
            },
          };
        }
        case "pairing-rotate": {
          if (!dependencies.pairingTokenMatchesQuery(input.url.searchParams.get("token"))) {
            return unauthorized();
          }
          const pairing = dependencies.rotatePairing();
          return {
            kind: "ok",
            status: 200,
            body: {
              macName: /** @type {{ macName?: unknown }} */ (pairing).macName,
              links: dependencies.pairingLinks(
                pairing,
                input.url.searchParams.get("remoteBaseUrl") || "",
              ),
            },
          };
        }
        default:
          throw new TypeError(`Unknown helper control operation: ${input.operation}`);
      }
    },
  });
}

function unauthorized() {
  return /** @type {const} */ ({ kind: "unauthorized" });
}

/** @param {(() => Promise<Record<string, unknown>>) | undefined} readInput */
async function requiredInput(readInput) {
  if (typeof readInput !== "function")
    throw new TypeError("Helper control operation requires input.");
  return readInput();
}

/** @param {HelperControlDependencies} dependencies */
function validateDependencies(dependencies) {
  const required = [
    ["pairingTokenMatches", dependencies?.pairingTokenMatches],
    ["association", dependencies?.association],
    ["inspectServeSim", dependencies?.inspectServeSim],
    ["defaultTransport", dependencies?.defaultTransport],
    ["inspectTransports", dependencies?.inspectTransports],
    ["pairingTokenMatchesQuery", dependencies?.pairingTokenMatchesQuery],
    ["pairingStatus", dependencies?.pairingStatus],
    ["currentPairing", dependencies?.currentPairing],
    ["claimToken", dependencies?.claimToken],
    ["claimInvite", dependencies?.claimInvite],
    ["rotatePairing", dependencies?.rotatePairing],
    ["pairingLinks", dependencies?.pairingLinks],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Helper control application service requires ${name}.`);
    }
  }
}

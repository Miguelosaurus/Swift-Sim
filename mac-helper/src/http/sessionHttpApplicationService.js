// @ts-check

/**
 * @typedef {{ id: string, logs: unknown[], remoteBaseUrl?: string, simulatorUDID?: string }} Session
 * @typedef {{ kind: "ok", status: number, body: unknown }} OkOutcome
 * @typedef {{ kind: "unauthorized" }} UnauthorizedOutcome
 * @typedef {{ kind: "not-found", message: string }} NotFoundOutcome
 * @typedef {{ kind: "mask", mask: { contentType: string, data: Buffer, width: number, height: number } }} MaskOutcome
 * @typedef {{ kind: "html", body: string }} HtmlOutcome
 * @typedef {{ kind: "streamed" }} StreamedOutcome
 * @typedef {{ kind: "unhandled" }} UnhandledOutcome
 * @typedef {OkOutcome | UnauthorizedOutcome | NotFoundOutcome | MaskOutcome | HtmlOutcome | StreamedOutcome | UnhandledOutcome} SessionHttpOutcome
 * @typedef {{
 *   pairingTokenMatches(request: unknown, url: URL): boolean,
 *   getSession(sessionID: string): Session | null,
 *   tokenMatches(session: Session, token: string | null): boolean,
 *   startSession(input: object): Promise<unknown>,
 *   projectSession(session: Session): unknown,
 *   stopSession(sessionID: string): Promise<void>,
 *   sessionLinks(session: Session): unknown,
 *   streamSession(response: unknown, session: Session): Promise<unknown>,
 *   frameMask(session: Session): { contentType: string, data: Buffer, width: number, height: number } | null,
 *   typeText(session: Session, text: unknown): Promise<unknown>,
 *   sendKey(session: Session, key: unknown): Promise<unknown>,
 *   tap(session: Session, x: unknown, y: unknown): Promise<unknown>,
 *   gesture(session: Session, input: unknown): Promise<unknown>,
 *   multitouch(session: Session, input: unknown): Promise<unknown>,
 *   control(session: Session, control: string): Promise<unknown>,
 *   sessionPage(session: Session): string,
 * }} SessionHttpDependencies
 */

/**
 * Build the single application-service boundary used by session routes. Store
 * access, authorization, operation orchestration, and persisted-session
 * projections remain behind this boundary.
 *
 * @param {SessionHttpDependencies} dependencies
 */
export function createSessionHttpApplicationService(dependencies) {
  validateDependencies(dependencies);

  return Object.freeze({
    /**
     * @param {{
     *   operation: string,
     *   request?: unknown,
     *   response?: unknown,
     *   url: URL,
     *   sessionID?: string,
     *   control?: string,
     *   readInput?: () => Promise<Record<string, unknown>>,
     * }} input
     * @returns {Promise<SessionHttpOutcome>}
     */
    async execute(input) {
      if (input.operation === "start") {
        if (!dependencies.pairingTokenMatches(input.request, input.url)) {
          return { kind: "unauthorized" };
        }
        const body = await requiredInput(input.readInput);
        return {
          kind: "ok",
          status: 201,
          body: await dependencies.startSession({
            project: body.project,
            scheme: body.scheme,
            simulator: body.simulatorUDID || body.simulator,
            remoteBaseUrl: body.remoteBaseUrl,
            port: body.port,
            transport: body.transport,
          }),
        };
      }

      const sessionID = input.sessionID || "";
      const session = dependencies.getSession(sessionID);
      if (!session) return { kind: "not-found", message: "Unknown session." };
      if (!dependencies.tokenMatches(session, input.url.searchParams.get("token"))) {
        return { kind: "unauthorized" };
      }

      switch (input.operation) {
        case "get":
          return { kind: "ok", status: 200, body: dependencies.projectSession(session) };
        case "logs":
          return {
            kind: "ok",
            status: 200,
            body: { sessionId: sessionID, logs: session.logs.slice(-200) },
          };
        case "stop":
          await dependencies.stopSession(sessionID);
          return { kind: "ok", status: 200, body: { stopped: true, sessionId: sessionID } };
        case "links":
          return { kind: "ok", status: 200, body: dependencies.sessionLinks(session) };
        case "stream":
          await dependencies.streamSession(input.response, session);
          return { kind: "streamed" };
        case "frame-mask": {
          const mask = dependencies.frameMask(session);
          return mask
            ? { kind: "mask", mask }
            : { kind: "not-found", message: "Simulator frame mask is unavailable." };
        }
        case "type": {
          const body = await requiredInput(input.readInput);
          return {
            kind: "ok",
            status: 200,
            body: await dependencies.typeText(session, body.text || ""),
          };
        }
        case "key": {
          const body = await requiredInput(input.readInput);
          return {
            kind: "ok",
            status: 200,
            body: await dependencies.sendKey(session, body.key || ""),
          };
        }
        case "tap": {
          const body = await requiredInput(input.readInput);
          return { kind: "ok", status: 200, body: await dependencies.tap(session, body.x, body.y) };
        }
        case "gesture":
          return {
            kind: "ok",
            status: 200,
            body: await dependencies.gesture(session, await requiredInput(input.readInput)),
          };
        case "multitouch":
          return {
            kind: "ok",
            status: 200,
            body: await dependencies.multitouch(session, await requiredInput(input.readInput)),
          };
        case "control":
          return {
            kind: "ok",
            status: 200,
            body: await dependencies.control(session, input.control || ""),
          };
        case "web":
          return { kind: "html", body: dependencies.sessionPage(session) };
        default:
          return { kind: "unhandled" };
      }
    },
  });
}

/** @param {(() => Promise<Record<string, unknown>>) | undefined} readInput */
async function requiredInput(readInput) {
  if (typeof readInput !== "function") throw new TypeError("Session operation requires input.");
  return readInput();
}

/** @param {SessionHttpDependencies} dependencies */
function validateDependencies(dependencies) {
  const required = [
    ["pairingTokenMatches", dependencies?.pairingTokenMatches],
    ["getSession", dependencies?.getSession],
    ["tokenMatches", dependencies?.tokenMatches],
    ["startSession", dependencies?.startSession],
    ["projectSession", dependencies?.projectSession],
    ["stopSession", dependencies?.stopSession],
    ["sessionLinks", dependencies?.sessionLinks],
    ["streamSession", dependencies?.streamSession],
    ["frameMask", dependencies?.frameMask],
    ["typeText", dependencies?.typeText],
    ["sendKey", dependencies?.sendKey],
    ["tap", dependencies?.tap],
    ["gesture", dependencies?.gesture],
    ["multitouch", dependencies?.multitouch],
    ["control", dependencies?.control],
    ["sessionPage", dependencies?.sessionPage],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Session HTTP application service requires ${name}.`);
    }
  }
}

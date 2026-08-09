// @ts-check

/**
 * @typedef {{ kind: "json", status: number, body: unknown } | { kind: "not-found", message: string } | { kind: "bad-request", status: number, message: string } | { kind: "unauthorized" }} DeviceAppOutcome
 * @typedef {{ appID?: string, operation: string, request: unknown, url: URL, readInput?: () => Promise<Record<string, unknown>> }} DeviceAppInput
 * @typedef {{ id?: string, workspace?: unknown, project?: unknown }} BuildRecord
 * @typedef {{
 *   pairingTokenMatches(request: unknown, url: URL): boolean,
 *   listBuilds(): unknown[],
 *   projectBuild(build: unknown): unknown,
 *   listApps(options: { includeArchived: boolean }): unknown[],
 *   projectApp(app: unknown): unknown,
 *   getApp(appID: string): unknown,
 *   setAppArchived(appID: string, archived: boolean): unknown,
 *   findRebuild(options: Record<string, unknown>): unknown,
 *   latestReusableBuildForApp(appID: string): BuildRecord | null | undefined,
 *   pathExists(path: unknown): boolean,
 *   createRebuild(source: BuildRecord, options: { appID: string, idempotencyKey: string }): unknown,
 *   startBuild(build: unknown): void,
 *   deleteApp(appID: string, options: { deleteArtifacts: boolean }): boolean,
 *   drainDeliveryReferences(): unknown,
 * }} DeviceAppDependencies
 */

/** @param {DeviceAppDependencies} dependencies */
export function createDeviceAppApplicationService(dependencies) {
  validateDependencies(dependencies);
  return Object.freeze({
    /** @param {DeviceAppInput} input @returns {Promise<DeviceAppOutcome>} */
    async execute(input) {
      if (!dependencies.pairingTokenMatches(input.request, input.url)) return unauthorized();
      switch (input.operation) {
        case "list-builds":
          return json(200, {
            builds: dependencies.listBuilds().slice(0, 20).map(dependencies.projectBuild),
          });
        case "list-apps":
          return json(200, {
            apps: dependencies
              .listApps({ includeArchived: input.url.searchParams.get("archived") === "true" })
              .map(dependencies.projectApp),
          });
        case "get-app": {
          const app = dependencies.getApp(requiredAppID(input));
          return app ? json(200, dependencies.projectApp(app)) : notFound("Unknown app.");
        }
        case "archive-app": {
          const body = await requiredInput(input.readInput);
          const app = dependencies.setAppArchived(requiredAppID(input), body.archived !== false);
          return app ? json(200, dependencies.projectApp(app)) : notFound("Unknown app.");
        }
        case "rebuild-app":
          return rebuildApp(dependencies, input, await requiredInput(input.readInput));
        case "delete-app": {
          const appID = requiredAppID(input);
          const deleted = dependencies.deleteApp(appID, {
            deleteArtifacts: input.url.searchParams.get("keepArtifacts") !== "true",
          });
          if (deleted) void dependencies.drainDeliveryReferences();
          return deleted ? json(200, { deleted: true, appId: appID }) : notFound("Unknown app.");
        }
        default:
          throw new TypeError(`Unknown device app operation: ${input.operation}`);
      }
    },
  });
}

/** @param {DeviceAppDependencies} dependencies @param {DeviceAppInput} input @param {Record<string, unknown>} body */
function rebuildApp(dependencies, input, body) {
  const appID = requiredAppID(input);
  const idempotencyKey = String(body.idempotencyKey || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
    return badRequest(400, "A valid idempotency key is required.");
  }
  const existing = dependencies.findRebuild({ appID, idempotencyKey });
  if (existing) return json(200, dependencies.projectBuild(existing));
  const active = dependencies.findRebuild({ appID, activeOnly: true });
  if (active) return json(200, dependencies.projectBuild(active));
  const source = dependencies.latestReusableBuildForApp(appID);
  if (!source) {
    return badRequest(
      409,
      "No successful device build is available as a trusted build recipe. Create one from the Mac first.",
    );
  }
  if (!dependencies.pathExists(source.workspace || source.project)) {
    return badRequest(
      409,
      "The saved Xcode project is no longer available at its original location on this Mac.",
    );
  }
  const build = dependencies.createRebuild(source, { appID, idempotencyKey });
  dependencies.startBuild(build);
  return json(202, dependencies.projectBuild(build));
}

/** @param {DeviceAppInput} input */
function requiredAppID(input) {
  if (!input.appID) throw new TypeError("Device app operation requires an app ID.");
  return input.appID;
}

/** @param {DeviceAppInput["readInput"]} readInput */
async function requiredInput(readInput) {
  if (typeof readInput !== "function") throw new TypeError("Device app operation requires input.");
  return readInput();
}

/** @param {number} status @param {unknown} body */
function json(status, body) {
  return /** @type {const} */ ({ kind: "json", status, body });
}

/** @param {string} message */
function notFound(message) {
  return /** @type {const} */ ({ kind: "not-found", message });
}

/** @param {number} status @param {string} message */
function badRequest(status, message) {
  return /** @type {const} */ ({ kind: "bad-request", status, message });
}

function unauthorized() {
  return /** @type {const} */ ({ kind: "unauthorized" });
}

/** @param {DeviceAppDependencies} dependencies */
function validateDependencies(dependencies) {
  const required = [
    ["pairingTokenMatches", dependencies?.pairingTokenMatches],
    ["listBuilds", dependencies?.listBuilds],
    ["projectBuild", dependencies?.projectBuild],
    ["listApps", dependencies?.listApps],
    ["projectApp", dependencies?.projectApp],
    ["getApp", dependencies?.getApp],
    ["setAppArchived", dependencies?.setAppArchived],
    ["findRebuild", dependencies?.findRebuild],
    ["latestReusableBuildForApp", dependencies?.latestReusableBuildForApp],
    ["pathExists", dependencies?.pathExists],
    ["createRebuild", dependencies?.createRebuild],
    ["startBuild", dependencies?.startBuild],
    ["deleteApp", dependencies?.deleteApp],
    ["drainDeliveryReferences", dependencies?.drainDeliveryReferences],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Device app application service requires ${name}.`);
    }
  }
}

// @ts-check

/**
 * @typedef {Record<string, unknown> & {
 *   id: string,
 *   state?: unknown,
 *   artifacts?: { ipaPath?: string },
 *   installTTLMinutes?: unknown,
 *   expiresAt?: unknown,
 *   remoteBaseUrl?: unknown,
 *   delivery?: Record<string, unknown> | null,
 *   pendingRenewal?: { id?: string },
 *   logs?: string[],
 * }} BuildRecord
 */
/**
 * @typedef {{
 *   pairingTokenMatches(request: unknown, url: URL): boolean,
 *   createBuild(values: Record<string, unknown>): Promise<BuildRecord>,
 *   startBuild(build: BuildRecord): unknown,
 *   getBuild(buildID: string): BuildRecord | null | undefined,
 *   pathExists(path: unknown): boolean,
 *   renewInstallLink(buildID: string, options: { ttlMinutes: unknown }): BuildRecord,
 *   trackTask(key: string, build: BuildRecord, operation: () => Promise<BuildRecord>): Promise<BuildRecord>,
 *   prepareDelivery(build: BuildRecord, options: { markBuildFailed: boolean }): Promise<unknown>,
 *   saveBuild(build: BuildRecord): unknown,
 *   projectBuild(build: BuildRecord): unknown,
 * }} DeviceBuildCommandDependencies
 */

/** @param {DeviceBuildCommandDependencies} dependencies */
export function createDeviceBuildCommandApplicationService(dependencies) {
  validateDependencies(dependencies);
  return Object.freeze({
    /**
     * @param {{ operation: string, buildID?: string, request: unknown, url: URL, readInput?: () => Promise<Record<string, unknown>> }} input
     */
    async execute(input) {
      if (!dependencies.pairingTokenMatches(input.request, input.url)) return unauthorized();
      if (input.operation === "start-build") {
        const body = await requiredInput(input.readInput);
        const build = await dependencies.createBuild({
          project: body.project,
          workspace: body.workspace,
          scheme: body.scheme,
          configuration: body.configuration,
          "remote-base-url": body.remoteBaseUrl,
          delivery: body.delivery,
          "export-method": body.exportMethod,
          "ttl-minutes": body.ttlMinutes,
          "build-setting": body.buildSettings,
          "allow-provisioning-updates": Boolean(body.allowProvisioningUpdates),
          "replace-app-data": Boolean(body.replaceAppData),
        });
        dependencies.startBuild(build);
        return json(202, dependencies.projectBuild(build));
      }
      if (input.operation === "renew-build") {
        return renewBuild(dependencies, requiredBuildID(input));
      }
      throw new TypeError(`Unknown device build command operation: ${input.operation}`);
    },
  });
}

/** @param {DeviceBuildCommandDependencies} dependencies @param {string} buildID */
async function renewBuild(dependencies, buildID) {
  const build = dependencies.getBuild(buildID);
  if (!build) return notFound("That saved app is no longer available on this Mac.");
  if (
    build.state !== "ready" ||
    !build.artifacts?.ipaPath ||
    !dependencies.pathExists(build.artifacts.ipaPath)
  ) {
    return badRequest(
      409,
      "The saved app is no longer available. Build it again to create a new link.",
    );
  }
  const previousDelivery = {
    expiresAt: build.expiresAt,
    remoteBaseUrl: build.remoteBaseUrl,
    delivery: build.delivery ? { ...build.delivery } : null,
  };
  const renewedBuild = dependencies.renewInstallLink(build.id, {
    ttlMinutes: build.installTTLMinutes,
  });
  const renewalKey = `renewal:${build.id}:${renewedBuild.pendingRenewal?.id || "unknown"}`;
  const deliveredBuild = await dependencies.trackTask(renewalKey, renewedBuild, async () => {
    try {
      await dependencies.prepareDelivery(renewedBuild, { markBuildFailed: false });
    } catch (error) {
      renewedBuild.expiresAt = previousDelivery.expiresAt;
      renewedBuild.remoteBaseUrl = previousDelivery.remoteBaseUrl;
      renewedBuild.delivery = previousDelivery.delivery;
      dependencies.saveBuild(renewedBuild);
      throw error;
    }
    renewedBuild.logs ||= [];
    renewedBuild.logs.push("A new install link was generated from the saved app.");
    dependencies.saveBuild(renewedBuild);
    return renewedBuild;
  });
  return json(200, dependencies.projectBuild(deliveredBuild));
}

/** @param {{ buildID?: string }} input */
function requiredBuildID(input) {
  if (!input.buildID) throw new TypeError("Device build command requires a build ID.");
  return input.buildID;
}

/** @param {(() => Promise<Record<string, unknown>>) | undefined} readInput */
async function requiredInput(readInput) {
  if (typeof readInput !== "function") throw new TypeError("Device build command requires input.");
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

/** @param {DeviceBuildCommandDependencies} dependencies */
function validateDependencies(dependencies) {
  const required = [
    ["pairingTokenMatches", dependencies?.pairingTokenMatches],
    ["createBuild", dependencies?.createBuild],
    ["startBuild", dependencies?.startBuild],
    ["getBuild", dependencies?.getBuild],
    ["pathExists", dependencies?.pathExists],
    ["renewInstallLink", dependencies?.renewInstallLink],
    ["trackTask", dependencies?.trackTask],
    ["prepareDelivery", dependencies?.prepareDelivery],
    ["saveBuild", dependencies?.saveBuild],
    ["projectBuild", dependencies?.projectBuild],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Device build command application service requires ${name}.`);
    }
  }
}

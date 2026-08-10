// @ts-check

/**
 * @typedef {Record<string, unknown> & {
 *   id: string,
 *   state?: unknown,
 *   installation?: {
 *     state?: unknown,
 *     verificationDeadlineAt?: unknown,
 *     requestedAt?: unknown,
 *   },
 *   app?: { bundleIdentifier?: unknown },
 * }} DeviceBuildRecord
 */
/**
 * @typedef {{
 *   listBuilds(): DeviceBuildRecord[],
 *   verifyBuild(build: DeviceBuildRecord): Promise<unknown>,
 *   saveVerification(buildID: string, verification: unknown): unknown,
 *   nowMs(): number,
 *   nowIso(): string,
 * }} DeviceInstallationReconciliationDependencies
 */

/** @param {DeviceInstallationReconciliationDependencies} dependencies */
export function createDeviceInstallationReconciliationCoordinator(
  dependencies,
) {
  validateDependencies(dependencies);
  let running = false;

  return Object.freeze({
    async runOnce() {
      if (running) return;
      running = true;
      try {
        const requested = dependencies.listBuilds().filter((build) => {
          return (
            build.state === "ready" &&
            installationVerificationIsActive(
              build.installation,
              dependencies.nowMs,
            ) &&
            Boolean(build.app?.bundleIdentifier)
          );
        });
        for (const build of requested) {
          try {
            const verification = await dependencies.verifyBuild(build);
            dependencies.saveVerification(build.id, verification);
          } catch (error) {
            dependencies.saveVerification(build.id, {
              state: "unknown",
              verifiedAt: dependencies.nowIso(),
              devices: [],
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } finally {
        running = false;
      }
    },
  });
}

/**
 * @param {DeviceBuildRecord["installation"]} installation
 * @param {() => number} nowMs
 */
function installationVerificationIsActive(installation = {}, nowMs) {
  const state = installation.state || "unknown";
  if (
    !["requested", "not-installed", "different-version"].includes(String(state))
  ) {
    return false;
  }
  const deadline = Date.parse(stringValue(installation.verificationDeadlineAt));
  if (Number.isFinite(deadline)) return deadline > nowMs();
  const requestedAt = Date.parse(stringValue(installation.requestedAt));
  return Number.isFinite(requestedAt) && requestedAt + 15 * 60 * 1000 > nowMs();
}

/** @param {unknown} value */
function stringValue(value) {
  return typeof value === "string" ? value : "";
}

/** @param {DeviceInstallationReconciliationDependencies} dependencies */
function validateDependencies(dependencies) {
  const required = [
    ["listBuilds", dependencies?.listBuilds],
    ["verifyBuild", dependencies?.verifyBuild],
    ["saveVerification", dependencies?.saveVerification],
    ["nowMs", dependencies?.nowMs],
    ["nowIso", dependencies?.nowIso],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(
        `Device installation reconciliation coordinator requires ${name}.`,
      );
    }
  }
}

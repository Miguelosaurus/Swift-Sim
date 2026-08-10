// @ts-check

import {
  capabilityForTokens,
  deviceBuildCapabilityExpired,
  projectCapabilityBuild,
  publicCapabilityDeviceBuild,
} from "../deviceBuildCapability.js";
import { sanitizePublicBuildLogs } from "../publicBuildLogs.js";

/**
 * @typedef {Record<string, unknown> & {
 *   id: string,
 *   token?: unknown,
 *   state?: unknown,
 *   scheme?: unknown,
 *   remoteBaseUrl?: unknown,
 *   capabilities?: unknown[],
 *   logs?: unknown[],
 *   artifacts?: { ipaPath?: string },
 *   app?: { name?: unknown, bundleIdentifier?: unknown, version?: unknown, build?: unknown },
 * }} BuildRecord
 */
/**
 * @typedef {{
 *   pairedMacEnabled: boolean,
 *   pairingTokenMatches(request: unknown, url: URL): boolean,
 *   getBuild(buildID: string): BuildRecord | null | undefined,
 *   saveBuild(build: BuildRecord): unknown,
 *   markInstallRequested(buildID: string): BuildRecord | null | undefined,
 *   saveVerification(buildID: string, verification: unknown): BuildRecord | null | undefined,
 *   verifyBuild(build: BuildRecord): Promise<unknown>,
 *   claimVerification(build: BuildRecord, options: { now: number }): boolean,
 *   projectBuild(build: BuildRecord): unknown,
 *   buildLinks(build: BuildRecord, remoteBaseUrl: string): unknown,
 *   buildManifest(build: BuildRecord, remoteBaseUrl: string): string,
 *   renderInstallPage(build: BuildRecord): string,
 *   now(): number,
 * }} DeviceBuildCapabilityDependencies
 */

/** @param {DeviceBuildCapabilityDependencies} dependencies */
export function createDeviceBuildCapabilityApplicationService(dependencies) {
  validateDependencies(dependencies);
  return Object.freeze({
    /**
     * @param {{ operation: string, buildID: string, request: unknown, url: URL, artifact?: string }} input
     */
    async execute(input) {
      const pairedMac =
        dependencies.pairedMacEnabled &&
        dependencies.pairingTokenMatches(input.request, input.url);
      const build = dependencies.getBuild(input.buildID);
      if (!build) return pairedMac ? notFound("Unknown device build.") : unauthorized();

      const capability = capabilityForTokens(build, requestTokens(input.request, input.url));
      const capabilityOnly = input.operation === "artifact" || input.operation === "install-page";
      const usePairedMac = pairedMac && !capabilityOnly;
      if (!usePairedMac && !capability) return unauthorized();

      const now = dependencies.now();
      if (!usePairedMac && deviceBuildCapabilityExpired(build, capability, now)) {
        return badRequest(410, "This install link has expired.");
      }

      if (input.operation === "status") {
        return json(
          200,
          usePairedMac
            ? dependencies.projectBuild(build)
            : publicCapabilityDeviceBuild(build, capability),
        );
      }
      if (input.operation === "logs") {
        return json(200, {
          buildId: build.id,
          logs: usePairedMac
            ? Array.isArray(build.logs)
              ? build.logs.slice(-300)
              : []
            : sanitizePublicBuildLogs(build),
        });
      }
      if (input.operation === "links") {
        if (!usePairedMac) {
          return json(200, publicCapabilityDeviceBuild(build, capability)?.links || {});
        }
        const remoteBaseUrl = stringValue(build.remoteBaseUrl) || requestBase(input.url);
        if (!stringValue(build.remoteBaseUrl)) {
          build.remoteBaseUrl = remoteBaseUrl;
          dependencies.saveBuild(build);
        }
        return json(200, dependencies.buildLinks(build, remoteBaseUrl));
      }
      if (input.operation === "install-request") {
        if (!usePairedMac && !capabilityMutationReady(build)) return unavailableBuild();
        const requested = dependencies.markInstallRequested(build.id);
        if (!requested) return notFound("This build is no longer available.");
        return json(
          200,
          usePairedMac
            ? dependencies.projectBuild(requested)
            : publicCapabilityDeviceBuild(requested, capability),
        );
      }
      if (input.operation === "verify") {
        if (!usePairedMac && !capabilityMutationReady(build)) return unavailableBuild();
        if (!usePairedMac && !dependencies.claimVerification(build, { now })) {
          const current = dependencies.getBuild(build.id);
          if (!current) return notFound("This build is no longer available.");
          return json(200, publicCapabilityDeviceBuild(current, capability));
        }
        const verification = await dependencies.verifyBuild(build);
        const verified = dependencies.saveVerification(build.id, verification);
        if (!verified) return notFound("This build is no longer available.");
        return json(
          200,
          usePairedMac
            ? dependencies.projectBuild(verified)
            : publicCapabilityDeviceBuild(verified, capability),
        );
      }
      if (input.operation === "artifact") {
        if (build.state !== "ready") {
          return badRequest(409, "Device build is not ready yet.");
        }
        const scoped = projectCapabilityBuild(build, capability);
        if (!scoped) return unauthorized();
        const remoteBaseUrl = stringValue(scoped.remoteBaseUrl) || requestBase(input.url);
        if (input.artifact === "manifest") {
          return text(
            200,
            dependencies.buildManifest(scoped, remoteBaseUrl),
            "text/xml; charset=utf-8",
          );
        }
        if (input.artifact === "ipa") {
          return file(
            stringValue(build.artifacts?.ipaPath),
            "application/octet-stream",
            `${stringValue(build.app?.name) || stringValue(build.scheme) || "App"}.ipa`,
          );
        }
        throw new TypeError(`Unknown device build artifact: ${input.artifact}`);
      }
      if (input.operation === "install-page") {
        const scoped = projectCapabilityBuild(build, capability);
        if (!scoped) return unauthorized();
        const responseBuild = stringValue(scoped.remoteBaseUrl)
          ? scoped
          : { ...scoped, remoteBaseUrl: requestBase(input.url) };
        return text(
          200,
          dependencies.renderInstallPage(responseBuild),
          "text/html; charset=utf-8",
          {
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
          },
        );
      }
      throw new TypeError(`Unknown device build capability operation: ${input.operation}`);
    },
  });
}

/** @param {BuildRecord} build */
function capabilityMutationReady(build) {
  return build.state === "ready" && Boolean(build.artifacts?.ipaPath);
}

function unavailableBuild() {
  return badRequest(409, "This build is not ready or is no longer available.");
}

/** @param {unknown} request @param {URL} url */
function requestTokens(request, url) {
  const headerValue =
    request && typeof request === "object" && "headers" in request
      ? /** @type {{ headers?: { authorization?: unknown } }} */ (request).headers?.authorization
      : "";
  const header = String(headerValue || "");
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return [...new Set([bearer, url.searchParams.get("token") || ""].filter(Boolean))];
}

/** @param {URL} url */
function requestBase(url) {
  return `${url.protocol}//${url.host}`;
}

/** @param {unknown} value */
function stringValue(value) {
  return typeof value === "string" ? value : "";
}

/** @param {number} status @param {unknown} body */
function json(status, body) {
  return /** @type {const} */ ({ kind: "json", status, body });
}
/** @param {number} status @param {string} body @param {string} contentType @param {Record<string, string>} [headers] */
function text(status, body, contentType, headers = {}) {
  return /** @type {const} */ ({ kind: "text", status, body, contentType, headers });
}
/** @param {string} path @param {string} contentType @param {string} filename */
function file(path, contentType, filename) {
  return /** @type {const} */ ({ kind: "file", path, contentType, filename });
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

/** @param {DeviceBuildCapabilityDependencies} dependencies */
function validateDependencies(dependencies) {
  if (typeof dependencies?.pairedMacEnabled !== "boolean") {
    throw new TypeError("Device build capability application service requires pairedMacEnabled.");
  }
  const required = [
    ["pairingTokenMatches", dependencies?.pairingTokenMatches],
    ["getBuild", dependencies?.getBuild],
    ["saveBuild", dependencies?.saveBuild],
    ["markInstallRequested", dependencies?.markInstallRequested],
    ["saveVerification", dependencies?.saveVerification],
    ["verifyBuild", dependencies?.verifyBuild],
    ["claimVerification", dependencies?.claimVerification],
    ["projectBuild", dependencies?.projectBuild],
    ["buildLinks", dependencies?.buildLinks],
    ["buildManifest", dependencies?.buildManifest],
    ["renderInstallPage", dependencies?.renderInstallPage],
    ["now", dependencies?.now],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Device build capability application service requires ${name}.`);
    }
  }
}

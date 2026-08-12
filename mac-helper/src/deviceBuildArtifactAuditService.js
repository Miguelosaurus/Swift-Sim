// @ts-check

import { planDeviceBuildArtifactAudit } from "./deviceBuildArtifactAuditPlan.js";

/**
 * @typedef {{ id: string, state: string, liveReload?: { compilerReady?: boolean }, artifacts?: { root?: unknown } }} BuildRecord
 * @typedef {{ inventory: unknown[], orphanRoots: unknown[], issues: unknown[] }} MeasurementResult
 */

/**
 * Compose the pure historical-retention planner with a read-only filesystem
 * measurement adapter. No cleanup operation is exposed from this service.
 *
 * @param {{
 *   listBuilds(): BuildRecord[],
 *   artifactDirectory(): string,
 *   usage: { measure(input: { builds: BuildRecord[], artifactDirectory: string }): Promise<MeasurementResult> },
 * }} dependencies
 */
export function createDeviceBuildArtifactAuditService(dependencies) {
  validateDependencies(dependencies);
  return Object.freeze({ inspect });

  async function inspect() {
    const builds = dependencies.listBuilds();
    if (!Array.isArray(builds)) {
      throw new TypeError("Device-build artifact audit listBuilds must return an array.");
    }
    const artifactDirectory = dependencies.artifactDirectory();
    const measurement = await dependencies.usage.measure({ builds, artifactDirectory });
    if (!measurement || typeof measurement !== "object") {
      throw new TypeError("Device-build artifact usage returned an invalid measurement.");
    }
    const inventory = Array.isArray(measurement.inventory) ? measurement.inventory : [];
    const orphanRoots = Array.isArray(measurement.orphanRoots) ? measurement.orphanRoots : [];
    const measurementIssues = Array.isArray(measurement.issues) ? measurement.issues : [];
    const plan = planDeviceBuildArtifactAudit({
      builds,
      inventory: /** @type {Parameters<typeof planDeviceBuildArtifactAudit>[0]["inventory"]} */ (inventory),
      orphanRoots: /** @type {Parameters<typeof planDeviceBuildArtifactAudit>[0]["orphanRoots"]} */ (orphanRoots),
    });
    return Object.freeze({
      ...plan,
      artifactDirectory,
      measurementComplete: plan.measuredBuildCount === builds.length
        && measurementIssues.length === 0,
      measurementIssues: Object.freeze([...measurementIssues]),
    });
  }
}

/** @param {Parameters<typeof createDeviceBuildArtifactAuditService>[0]} dependencies */
function validateDependencies(dependencies) {
  if (!dependencies || typeof dependencies !== "object") {
    throw new TypeError("Device-build artifact audit service dependencies are required.");
  }
  if (typeof dependencies.listBuilds !== "function") {
    throw new TypeError("Device-build artifact audit service requires listBuilds.");
  }
  if (typeof dependencies.artifactDirectory !== "function") {
    throw new TypeError("Device-build artifact audit service requires artifactDirectory.");
  }
  if (!dependencies.usage || typeof dependencies.usage.measure !== "function") {
    throw new TypeError("Device-build artifact audit service requires read-only usage measurement.");
  }
}

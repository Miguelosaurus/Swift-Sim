// @ts-check

import { dirname, join } from "node:path";
import { NodeAtomicFileStore } from "./infrastructure/nodeAtomicFileStore.js";
import { NodeDeviceBuildArtifactUsage } from "./infrastructure/nodeDeviceBuildArtifactUsage.js";
import { createDeviceBuildArtifactAuditService } from "./deviceBuildArtifactAuditService.js";
import { parseDeviceBuildLegacySnapshot } from "./persistence/deviceBuildLockedLegacySnapshot.js";

/** @typedef {import("./infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("./infrastructure/ports.js").CommandRunner} CommandRunner */

/**
 * Compose the historical artifact audit without constructing DeviceBuildStore.
 *
 * Device-build JSON is atomically published. A single read therefore observes
 * one complete old-or-new generation and is sufficient for a diagnostic-only
 * projection. Deliberately avoid the legacy lock and migration snapshot reader:
 * those primitives write lock-owner/backup state, while doctor must not drain
 * cleanup jobs, publish backups, or mutate authoritative state.
 *
 * @param {{
 *   legacyPath: string,
 *   commandRunner: CommandRunner,
 *   environmentNames(): string[],
 *   fileStore?: AtomicFileStore,
 *   usage?: { measure(input: { builds: readonly object[], artifactDirectory: string }): Promise<{ inventory: unknown[], orphanRoots: unknown[], issues: unknown[] }> },
 * }} options
 */
export function createDeviceBuildArtifactAuditCompatibility({
  legacyPath,
  commandRunner,
  environmentNames,
  fileStore = new NodeAtomicFileStore(),
  usage,
}) {
  if (typeof legacyPath !== "string" || legacyPath.length === 0) {
    throw new TypeError("Device-build artifact audit compatibility requires legacyPath.");
  }
  if (!fileStore || typeof fileStore.readTextSync !== "function") {
    throw new TypeError("Device-build artifact audit compatibility requires readTextSync.");
  }
  if (!usage && (!commandRunner || typeof commandRunner.run !== "function")) {
    throw new TypeError("Device-build artifact audit compatibility requires commandRunner.");
  }
  if (!usage && typeof environmentNames !== "function") {
    throw new TypeError("Device-build artifact audit compatibility requires environmentNames.");
  }

  const artifactDirectory = join(dirname(legacyPath), "device-builds");
  const usageAdapter = usage || new NodeDeviceBuildArtifactUsage({ commandRunner, environmentNames });
  return createDeviceBuildArtifactAuditService({
    listBuilds: () => readLegacyBuilds(fileStore, legacyPath),
    artifactDirectory: () => artifactDirectory,
    usage: usageAdapter,
  });
}

/** @param {AtomicFileStore} fileStore @param {string} legacyPath */
function readLegacyBuilds(fileStore, legacyPath) {
  let raw;
  try {
    raw = fileStore.readTextSync(legacyPath);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }
  return parseDeviceBuildLegacySnapshot(raw, legacyPath).snapshot.builds;
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      /** @type {{ code?: unknown }} */ (error).code === code,
  );
}

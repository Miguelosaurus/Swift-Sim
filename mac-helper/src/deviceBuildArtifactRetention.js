// @ts-check

import { isAbsolute, relative, resolve, sep, join } from "node:path";

/** @typedef {import("./infrastructure/ports.js").ArtifactStore} ArtifactStore */
/**
 * @typedef {{
 *   root?: unknown,
 *   archivePath?: unknown,
 *   exportPath?: unknown,
 *   ipaPath?: unknown,
 *   resultBundlePath?: unknown,
 * }} BuildArtifacts
 * @typedef {{ compilerReady?: boolean }} BuildLiveReload
 * @typedef {{
 *   id: string,
 *   state: string,
 *   artifacts?: BuildArtifacts,
 *   liveReload?: BuildLiveReload,
 * }} BuildRecord
 * @typedef {{ buildID: string, root: string, notBefore: string }} FailedCleanupRequest
 */

export const FAILED_BUILD_ARTIFACT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Build-history metadata is durable, but heavyweight Xcode intermediates are
 * cache-like. Ready builds retain their export directory/IPA so install-link
 * renewal remains possible. A live-reload-ready build also retains DerivedData
 * because the captured patch-compiler context may contain search paths into it.
 * Failed builds are handed to the durable whole-root cleanup queue after a
 * short diagnostic grace period.
 *
 * This service intentionally has no startup reconciliation. Historical cleanup
 * is a separate migration decision; wiring this service prevents future growth
 * without silently deleting pre-existing user artifacts.
 *
 * @param {{
 *   artifactStore: ArtifactStore,
 *   scheduleFailedCleanup(request: FailedCleanupRequest): unknown,
 *   now?(): number,
 * }} dependencies
 */
export function createDeviceBuildArtifactRetention(dependencies) {
  validateDependencies(dependencies);
  const now = dependencies.now || Date.now;

  return Object.freeze({
    /** @param {BuildRecord} build */
    afterTerminalBuild(build) {
      if (!build || typeof build !== "object") return { action: "none" };
      if (build.state === "ready") {
        return pruneReadyIntermediates(build, dependencies.artifactStore);
      }
      if (build.state === "failed") {
        return scheduleFailedBuildCleanup(build, dependencies.scheduleFailedCleanup, now());
      }
      return { action: "none" };
    },
  });
}

/** @param {BuildRecord} build @param {ArtifactStore} artifactStore */
export function pruneReadyIntermediates(build, artifactStore) {
  const root = stringValue(build.artifacts?.root);
  const ipaPath = stringValue(build.artifacts?.ipaPath);
  if (!root || !ipaPath) return { action: "none" };

  const approvedIpa = artifactStore.resolveContained(root, ipaPath);
  const derivedDataPath = join(root, "DerivedData");
  const preserveLiveDerivedData = build.liveReload?.compilerReady === true;
  const candidates = uniqueStrings([
    preserveLiveDerivedData ? "" : derivedDataPath,
    stringValue(build.artifacts?.archivePath),
    stringValue(build.artifacts?.resultBundlePath),
    join(root, "ExportOptions.plist"),
  ]);
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const preserved = [approvedIpa];
  if (preserveLiveDerivedData) {
    preserved.push(artifactStore.resolveContained(root, derivedDataPath));
  }

  for (const candidate of candidates) {
    const approved = artifactStore.resolveContained(root, candidate);
    if (samePath(approved, root) || containsPath(approved, approvedIpa)) {
      preserved.push(approved);
      continue;
    }
    artifactStore.removeTreeSync(approved);
    removed.push(approved);
  }

  return {
    action: "pruned-ready",
    removed: Object.freeze(removed),
    preserved: Object.freeze(uniqueStrings(preserved)),
  };
}

/**
 * @param {BuildRecord} build
 * @param {(request: FailedCleanupRequest) => unknown} scheduleFailedCleanup
 * @param {number} nowMs
 */
export function scheduleFailedBuildCleanup(build, scheduleFailedCleanup, nowMs) {
  const root = stringValue(build.artifacts?.root);
  if (!root || !Number.isFinite(nowMs)) return { action: "none" };
  const request = Object.freeze({
    buildID: build.id,
    root,
    notBefore: new Date(nowMs + FAILED_BUILD_ARTIFACT_RETENTION_MS).toISOString(),
  });
  scheduleFailedCleanup(request);
  return { action: "scheduled-failed", request };
}

/** @param {unknown[]} values @returns {string[]} */
function uniqueStrings(values) {
  /** @type {string[]} */
  const strings = [];
  for (const value of values) {
    if (typeof value === "string" && value.length > 0 && !strings.includes(value)) {
      strings.push(value);
    }
  }
  return strings;
}

/** @param {string} parent @param {string} child */
function containsPath(parent, child) {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  if (resolvedParent === resolvedChild) return true;
  const nested = relative(resolvedParent, resolvedChild);
  return Boolean(
    nested && !isAbsolute(nested) && nested !== ".." && !nested.startsWith(`..${sep}`),
  );
}

/** @param {string} first @param {string} second */
function samePath(first, second) {
  return resolve(first) === resolve(second);
}

/** @param {unknown} value */
function stringValue(value) {
  return typeof value === "string" ? value : "";
}

/** @param {Parameters<typeof createDeviceBuildArtifactRetention>[0]} dependencies */
function validateDependencies(dependencies) {
  if (!dependencies || typeof dependencies !== "object") {
    throw new TypeError("Device-build artifact retention dependencies are required.");
  }
  const artifactStore = dependencies.artifactStore;
  if (
    !artifactStore ||
    typeof artifactStore.resolveContained !== "function" ||
    typeof artifactStore.removeTreeSync !== "function"
  ) {
    throw new TypeError("Device-build artifact retention requires an artifact store.");
  }
  if (typeof dependencies.scheduleFailedCleanup !== "function") {
    throw new TypeError("Device-build artifact retention requires durable failed-build cleanup.");
  }
  if (dependencies.now !== undefined && typeof dependencies.now !== "function") {
    throw new TypeError("Device-build artifact retention now must be a function.");
  }
}

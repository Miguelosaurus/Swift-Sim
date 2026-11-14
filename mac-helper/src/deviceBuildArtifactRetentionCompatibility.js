// @ts-check

import { createDeviceBuildArtifactRetention } from "./deviceBuildArtifactRetention.js";
import { NodeArtifactStore } from "./infrastructure/nodeArtifactStore.js";
import { createCompilerCacheRetention } from "./deviceBuildCompilerCacheRetention.js";
import { createNodeCompilerCacheReferences, createNodeCompilerCacheStorage } from "./infrastructure/nodeCompilerCacheRetention.js";
import { createLiveDeliveryQueue } from "./liveDeliveryQueue.js";
import { liveRuntimeLockManager, withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * @typedef {{
 *   scheduleArtifactCleanup(input: { buildID: string, root: string, notBefore: string }): unknown,
 * }} DeviceBuildCleanupStore
 * @typedef {{ now(): Date }} RetentionClock
 */

/**
 * Compose the compatibility helper's future-build artifact retention from the
 * existing artifact-store owner and durable device-build cleanup queue.
 *
 * Compiler cache reconciliation runs only after a ready build or an explicit
 * operator request. Ordinary construction/startup/diagnostics remain inert.
 *
 * @param {{ deviceBuildStore: import("./deviceBuildStore.js").DeviceBuildStore, clock: RetentionClock, commandRunner: import("./infrastructure/ports.js").CommandRunner }} options
 */
export function createDeviceBuildArtifactRetentionCompatibility({ deviceBuildStore, clock, commandRunner }) {
  if (!deviceBuildStore || typeof deviceBuildStore.scheduleArtifactCleanup !== "function") {
    throw new TypeError(
      "Device-build retention compatibility requires durable cleanup scheduling.",
    );
  }
  if (!clock || typeof clock.now !== "function") {
    throw new TypeError("Device-build retention compatibility requires a clock.");
  }
  const artifactStore = new NodeArtifactStore();
  const terminalRetention = createDeviceBuildArtifactRetention({
    artifactStore,
    scheduleFailedCleanup: (request) => deviceBuildStore.scheduleArtifactCleanup(request),
    now: () => clock.now().getTime(),
  });
  const stateRoot = dirname(deviceBuildStore.path);
  const queueOptions = { rootPath: join(stateRoot, "live", "deliveries"), lockManager: liveRuntimeLockManager };
  const compilerCaches = createCompilerCacheRetention({
    store: deviceBuildStore,
    artifactDirectory: join(stateRoot, "device-builds"),
    queue: createLiveDeliveryQueue(queueOptions),
    references: createNodeCompilerCacheReferences({ manifestPath: join(stateRoot, "live", "compilations.json"), commandRunner, environmentNames: () => Object.keys(process.env) }),
    storage: createNodeCompilerCacheStorage(artifactStore),
    // Do not wait behind a real hot reload just to reclaim cache space.
    withEngineLock: (/** @type {() => unknown} */ operation) => withLiveEngineLifecycleLock(operation, { waitMs: 0 }),
    rollbackProtectedBuildIDs: () => legacyBuildIDs(join(stateRoot, "device-builds.json")),
    now: () => clock.now().toISOString(),
  });
  return Object.freeze({
    compilerCaches,
    /** @param {Parameters<typeof terminalRetention.afterTerminalBuild>[0]} build */
    async afterTerminalBuild(build) {
      const result = terminalRetention.afterTerminalBuild(build);
      if (build?.state === "ready") await compilerCaches.reconcile();
      return result;
    },
  });
}

// The untouched pre-migration build list. Unreadable means unknown, so the
// caller stays paused rather than guessing.
/** @param {string} path @returns {Set<string>} */
function legacyBuildIDs(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  const builds = Array.isArray(value) ? value : value?.builds;
  if (!Array.isArray(builds)) throw new Error("The legacy build snapshot is unreadable.");
  return new Set(builds.map((build) => String(build?.id || "")));
}

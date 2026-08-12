// @ts-check

import { createDeviceBuildArtifactRetention } from "./deviceBuildArtifactRetention.js";
import { NodeArtifactStore } from "./infrastructure/nodeArtifactStore.js";

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
 * This intentionally performs no historical scan. Existing artifacts remain
 * untouched until an explicit reconciliation/cutover step is separately proven.
 *
 * @param {{ deviceBuildStore: DeviceBuildCleanupStore, clock: RetentionClock }} options
 */
export function createDeviceBuildArtifactRetentionCompatibility({ deviceBuildStore, clock }) {
  if (!deviceBuildStore || typeof deviceBuildStore.scheduleArtifactCleanup !== "function") {
    throw new TypeError("Device-build retention compatibility requires durable cleanup scheduling.");
  }
  if (!clock || typeof clock.now !== "function") {
    throw new TypeError("Device-build retention compatibility requires a clock.");
  }
  const artifactStore = new NodeArtifactStore();
  return createDeviceBuildArtifactRetention({
    artifactStore,
    scheduleFailedCleanup: (request) => deviceBuildStore.scheduleArtifactCleanup(request),
    now: () => clock.now().getTime(),
  });
}

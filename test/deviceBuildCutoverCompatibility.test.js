import assert from "node:assert/strict";
import test from "node:test";
import {
  DeviceBuildCompatibilityReader,
  assertDeviceBuildCompatibilityAuthority,
} from "../mac-helper/src/persistence/deviceBuildCutoverCompatibility.js";
import { parseDeviceBuildLegacySnapshot } from "../mac-helper/src/persistence/deviceBuildLockedLegacySnapshot.js";
import { DEVICE_BUILD_CUTOVER_LEGACY_RAW } from "./fixtures/deviceBuildCutoverFixtures.js";

const empty = { builds: [], apps: [], artifactCleanupJobs: [], deliveryReferenceCleanupJobs: [] };

test("device-build compatibility returns legacy state while SQLite remains diagnostic", () => {
  const legacy = parseDeviceBuildLegacySnapshot(DEVICE_BUILD_CUTOVER_LEGACY_RAW, "/fixture/state").snapshot;
  const reader = new DeviceBuildCompatibilityReader({
    legacyReader: { read: () => legacy },
    sqliteReader: { read: () => empty },
  });
  const result = reader.inspect();
  assert.equal(result.authority, "legacy");
  assert.equal(result.matched, false);
  assert.deepEqual(result.snapshot, legacy);
  assert.equal(assertDeviceBuildCompatibilityAuthority("legacy"), "legacy");
  assert.throws(() => assertDeviceBuildCompatibilityAuthority("sqlite"), /not authoritative/);
});

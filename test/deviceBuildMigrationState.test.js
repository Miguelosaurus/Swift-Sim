import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeviceBuildMigrationState,
  parseDeviceBuildMigrationState,
  serializeDeviceBuildMigrationState,
} from "../mac-helper/src/persistence/deviceBuildMigrationState.js";
import {
  deviceBuildProjectionHash,
  parseDeviceBuildLegacySnapshot,
} from "../mac-helper/src/persistence/deviceBuildLockedLegacySnapshot.js";
import {
  DEVICE_BUILD_CUTOVER_LEGACY_RAW,
  DEVICE_BUILD_CUTOVER_SOURCE_REVISION,
} from "./fixtures/deviceBuildCutoverFixtures.js";

function fixture() {
  const parsed = parseDeviceBuildLegacySnapshot(DEVICE_BUILD_CUTOVER_LEGACY_RAW, "/fixture/state");
  const snapshot = parsed.snapshot;
  return {
    snapshot,
    sourceRevision: DEVICE_BUILD_CUTOVER_SOURCE_REVISION,
    projectionHash: deviceBuildProjectionHash(snapshot),
    recordCount: 4,
    sourceVersion: parsed.sourceVersion,
  };
}

test("device-build migration state is deterministic, serializable, and legacy-only", () => {
  const state = createDeviceBuildMigrationState(fixture());
  assert.equal(state.authority, "legacy");
  assert.equal(state.cursor, 0);
  assert.deepEqual(parseDeviceBuildMigrationState(serializeDeviceBuildMigrationState(state)), state);
  assert.throws(() => parseDeviceBuildMigrationState({ ...state, authority: "sqlite" }));
  assert.throws(() => parseDeviceBuildMigrationState({ ...state, version: 2 }));
  assert.throws(() => parseDeviceBuildMigrationState({ ...state, cursor: 5 }));
});

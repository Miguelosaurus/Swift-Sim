import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceBuildMigrationState } from "../mac-helper/src/persistence/deviceBuildMigrationState.js";
import {
  acknowledgeDeviceBuildExportBatch,
  createDeviceBuildExportBatch,
} from "../mac-helper/src/persistence/deviceBuildMigrationExport.js";
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
  return {
    snapshot: parsed.snapshot,
    sourceRevision: DEVICE_BUILD_CUTOVER_SOURCE_REVISION,
    projectionHash: deviceBuildProjectionHash(parsed.snapshot),
    recordCount: 4,
    sourceVersion: parsed.sourceVersion,
  };
}

test("device-build export rejects inconsistent completion and changed source evidence", () => {
  const source = fixture();
  const state = createDeviceBuildMigrationState(source);
  const batch = createDeviceBuildExportBatch(source.snapshot, state, {
    maxRecords: 2,
    maxBytes: 1_000_000,
  });
  assert.throws(
    () => acknowledgeDeviceBuildExportBatch(state, { ...batch, complete: true }),
    /completion marker is inconsistent/,
  );
  const changed = structuredClone(source.snapshot);
  changed.apps[0].archivedAt = "2026-08-13T00:00:00.000Z";
  assert.throws(
    () => createDeviceBuildExportBatch(changed, state),
    /does not match migration projectionHash/,
  );
  assert.throws(
    () => createDeviceBuildExportBatch(source.snapshot, state, { maxBytes: 1 }),
    /exceeds maxBytes/,
  );
  assert.equal(state.cursor, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeviceBuildMigrationState,
  parseDeviceBuildMigrationState,
  serializeDeviceBuildMigrationState,
} from "../mac-helper/src/persistence/deviceBuildMigrationState.js";
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

function apply(target, batch, limit = batch.records.length) {
  for (const record of batch.records.slice(0, limit)) {
    const key = `${record.surface}:${record.key}`;
    const prior = target.get(key);
    if (prior) assert.equal(prior, record.idempotencyKey);
    target.set(key, record.idempotencyKey);
  }
}

test("device-build export resumes the same batch after interruption and replays idempotently", () => {
  const source = fixture();
  const target = new Map();
  let state = createDeviceBuildMigrationState(source);
  const first = createDeviceBuildExportBatch(source.snapshot, state, {
    maxRecords: 2,
    maxBytes: 1_000_000,
  });

  apply(target, first, 1);
  const restarted = parseDeviceBuildMigrationState(serializeDeviceBuildMigrationState(state));
  const replay = createDeviceBuildExportBatch(source.snapshot, restarted, {
    maxRecords: 2,
    maxBytes: 1_000_000,
  });
  assert.deepEqual(replay, first);

  apply(target, replay);
  state = acknowledgeDeviceBuildExportBatch(restarted, replay);
  assert.equal(state.cursor, 2);
  assert.deepEqual(acknowledgeDeviceBuildExportBatch(state, replay), state);

  const second = createDeviceBuildExportBatch(source.snapshot, state, {
    maxRecords: 2,
    maxBytes: 1_000_000,
  });
  assert.equal(second.complete, true);
  apply(target, second);
  state = acknowledgeDeviceBuildExportBatch(state, second);

  assert.equal(state.cursor, source.recordCount);
  assert.equal(target.size, source.recordCount);
  assert.deepEqual(acknowledgeDeviceBuildExportBatch(state, first), state);
});

import assert from "node:assert/strict";
import test from "node:test";
import { verifyDeviceBuildLegacyRollbackReadability } from "../mac-helper/src/persistence/deviceBuildCutoverCompatibility.js";
import {
  deviceBuildProjectionHash,
  parseDeviceBuildLegacySnapshot,
} from "../mac-helper/src/persistence/deviceBuildLockedLegacySnapshot.js";
import {
  DEVICE_BUILD_CUTOVER_LEGACY_RAW,
  DEVICE_BUILD_CUTOVER_MALFORMED_RAW,
  DEVICE_BUILD_CUTOVER_OLDER_UNRELATED_RAW,
} from "./fixtures/deviceBuildCutoverFixtures.js";

function expected(raw) {
  return deviceBuildProjectionHash(parseDeviceBuildLegacySnapshot(raw, "/fixture/state").snapshot);
}

test("device-build rollback readability preserves current and older legacy bytes", () => {
  const current = verifyDeviceBuildLegacyRollbackReadability({
    raw: DEVICE_BUILD_CUTOVER_LEGACY_RAW,
    expectedProjectionHash: expected(DEVICE_BUILD_CUTOVER_LEGACY_RAW),
    expectedSourceVersion: 6,
  });
  const older = verifyDeviceBuildLegacyRollbackReadability({
    raw: DEVICE_BUILD_CUTOVER_OLDER_UNRELATED_RAW,
    expectedProjectionHash: expected(DEVICE_BUILD_CUTOVER_OLDER_UNRELATED_RAW),
    expectedSourceVersion: 5,
  });
  assert.equal(current.authority, "legacy");
  assert.equal(older.authority, "legacy");
  assert.equal(current.recordCount, older.recordCount);
  assert.throws(
    () => verifyDeviceBuildLegacyRollbackReadability({ raw: DEVICE_BUILD_CUTOVER_MALFORMED_RAW }),
    /Invalid JSON/,
  );
});

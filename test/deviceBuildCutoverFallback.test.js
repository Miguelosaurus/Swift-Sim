import assert from "node:assert/strict";
import test from "node:test";
import { DeviceBuildCompatibilityReader } from "../mac-helper/src/persistence/deviceBuildCutoverCompatibility.js";

const empty = { builds: [], apps: [], artifactCleanupJobs: [], deliveryReferenceCleanupJobs: [] };

test("device-build compatibility does not use SQLite when the legacy read is invalid", () => {
  let sqliteReads = 0;
  const reader = new DeviceBuildCompatibilityReader({
    legacyReader: { read: () => null },
    sqliteReader: { read: () => (sqliteReads += 1, empty) },
  });
  assert.throws(() => reader.inspect(), /snapshot must be an object/);
  assert.equal(sqliteReads, 0);
});

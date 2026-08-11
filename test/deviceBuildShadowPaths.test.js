import assert from "node:assert/strict";
import test from "node:test";
import { deviceBuildShadowPaths } from "../mac-helper/src/persistence/deviceBuildShadowPaths.js";

test("device-build shadow paths stay inside the authoritative state root", () => {
  const paths = deviceBuildShadowPaths("/Users/example/.swift-sim/device-builds.json");

  assert.deepEqual(paths, {
    databasePath: "/Users/example/.swift-sim/state.sqlite",
    backupDirectory: "/Users/example/.swift-sim/migration-backups/device-builds",
    source: {
      name: "device-builds.json",
      path: "/Users/example/.swift-sim/device-builds.json",
      lockRequest: {
        path: "/Users/example/.swift-sim/device-builds.json.lock",
        waitMs: 5_000,
        staleAfterMs: 250,
        ownerMode: 0o600,
      },
    },
  });
  assert.equal(Object.isFrozen(paths), true);
  assert.equal(Object.isFrozen(paths.source), true);
  assert.equal(Object.isFrozen(paths.source.lockRequest), true);
});

test("custom authoritative JSON filenames still share state.sqlite and get domain-scoped backups", () => {
  const paths = deviceBuildShadowPaths("/tmp/swift-sim-sandbox/build-state.json");

  assert.equal(paths.databasePath, "/tmp/swift-sim-sandbox/state.sqlite");
  assert.equal(paths.backupDirectory, "/tmp/swift-sim-sandbox/migration-backups/device-builds");
  assert.equal(paths.source.name, "build-state.json");
  assert.equal(paths.source.path, "/tmp/swift-sim-sandbox/build-state.json");
  assert.equal(paths.source.lockRequest.path, "/tmp/swift-sim-sandbox/build-state.json.lock");
});

test("device-build shadow paths reject empty or relative state locations", () => {
  for (const value of ["", "device-builds.json", "./device-builds.json"]) {
    assert.throws(() => deviceBuildShadowPaths(value), /must be an absolute path/);
  }
});

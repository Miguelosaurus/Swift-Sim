import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";
import { DeviceBuildLegacyImportCoordinator } from "../mac-helper/src/persistence/deviceBuildLegacyImport.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import { SqliteDeviceBuildStateRepository } from "../mac-helper/src/persistence/sqliteDeviceBuildStateRepository.js";
import { SqliteLegacyImportCheckpointRepository } from "../mac-helper/src/persistence/sqliteLegacyImportCheckpointRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const FIXTURE_ROOT = resolve("test/fixtures/upgrade-evidence/v0.6.1");
const IMPORTED_AT = "2026-08-13T23:45:00.000Z";

test("v0.6.1 device state uses the normal legacy import evidence vocabulary", (t) => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-v061-device-"));
  const sourcePath = join(root, "device-builds.json");
  const backupDirectory = join(root, "backups");
  const fileStore = new NodeAtomicFileStore();
  const lockManager = new NodeLockManager({
    identity: (pid) => ({ startToken: `upgrade-fixture-${pid}` }),
    fileStore,
  });
  const raw = readFileSync(join(FIXTURE_ROOT, "home/.swift-sim/device-builds.json"), "utf8");
  fileStore.writeTextSync(sourcePath, raw, {
    mode: 0o600,
    createParentMode: 0o700,
    replace: true,
    syncDirectory: true,
  });
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "swift-sim.sqlite"),
    migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
  });
  const repository = new SqliteDeviceBuildStateRepository(database);
  const checkpoints = new SqliteLegacyImportCheckpointRepository(database);
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const coordinator = new DeviceBuildLegacyImportCoordinator({
    deviceBuildRepository: repository,
    checkpointRepository: checkpoints,
    fileStore,
    lockManager,
    source: {
      name: "device-builds.json",
      path: sourcePath,
      lockRequest: { path: `${sourcePath}.lock`, waitMs: 0, staleAfterMs: 60_000, ownerMode: 0o600 },
    },
    backupDirectory,
    checkpointSource: "device-build-state-v1",
    clock: {
      now: () => new Date(IMPORTED_AT),
      monotonicMilliseconds: () => 0,
      async sleep() {},
    },
  });

  const first = coordinator.run();
  assert.equal(first.status, "applied");
  assert.equal(first.sourceVersion, 5);
  assert.equal(first.recordCount, 1);
  assert.equal(repository.read().apps[0]?.id, "app-v061");
  const checkpoint = checkpoints.get("device-build-state-v1");
  assert.equal(checkpoint?.sourceRevision, first.sourceRevision);
  assert.equal(checkpoint?.projectionHash, first.projectionHash);
  assert.equal(checkpoint?.recordCount, first.recordCount);
  assert.equal(coordinator.run().status, "already-current");
  assert.equal(readdirSync(backupDirectory).length, 1);
});

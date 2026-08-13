import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";
import { DeviceBuildLegacyImportCoordinator } from "../mac-helper/src/persistence/deviceBuildLegacyImport.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import { PairingLegacyImportCoordinator } from "../mac-helper/src/persistence/pairingLegacyImport.js";
import { PAIRING_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import { SqliteDeviceBuildStateRepository } from "../mac-helper/src/persistence/sqliteDeviceBuildStateRepository.js";
import { SqliteLegacyImportCheckpointRepository } from "../mac-helper/src/persistence/sqliteLegacyImportCheckpointRepository.js";
import { SqlitePairingStateRepository } from "../mac-helper/src/persistence/sqlitePairingStateRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const FIXTURE_ROOT = resolve("test/fixtures/upgrade-evidence/v0.6.1");
const FIXTURE_STATE_ROOT = join(FIXTURE_ROOT, "home", ".swift-sim");
const IMPORTED_AT = "2026-08-13T20:00:00.000Z";
const STATE_FILES = ["pairing.json", "pairing-invites.json", "device-builds.json"] as const;
const clock = {
  now: () => new Date(IMPORTED_AT),
  monotonicMilliseconds: () => 0,
  async sleep() {},
};

test("published v0.6.1 state upgrades repeatably across fresh migration graphs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-v061-upgrade-"));
  const stateRoot = join(root, ".swift-sim");
  assert.notEqual(resolve(stateRoot), resolve(homedir(), ".swift-sim"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const fileStore = new NodeAtomicFileStore();
  const manifest = JSON.parse(fileStore.readTextSync(join(FIXTURE_ROOT, "manifest.json"))) as {
    sourceRelease: { tag: string; commit: string; asset: string; assetSha256: string };
    historicalContract: { state: { deviceBuildVersion: number } };
  };
  assert.equal(manifest.sourceRelease.tag, "v0.6.1");
  assert.equal(manifest.sourceRelease.commit, "23d671bdb7c712d1680a06e8fec9e9e973038b8a");
  assert.equal(manifest.sourceRelease.asset, "swift-sim-0.6.1.tar.gz");
  assert.equal(manifest.sourceRelease.assetSha256, "c8edc4c7efac93d161540d9b34ca762856875929351de2b7975e5923784307aa");
  assert.equal(manifest.historicalContract.state.deviceBuildVersion, 5);

  for (const name of STATE_FILES) {
    const destination = join(stateRoot, name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(FIXTURE_STATE_ROOT, name), destination);
  }
  const originalLegacyBytes = Object.fromEntries(
    STATE_FILES.map((name) => [name, fileStore.readTextSync(join(stateRoot, name))]),
  );

  const firstPairing = pairingGraph(root, fileStore);
  assert.equal(firstPairing.coordinator.run().status, "applied");
  assert.equal(firstPairing.repository.read().credential?.installationID, "installation-v061");
  assert.equal(firstPairing.repository.read().invitations[0]?.id, "upgrade-invite-v061");
  firstPairing.database.close();

  const restartedPairing = pairingGraph(root, fileStore);
  assert.equal(restartedPairing.coordinator.run().status, "already-current");
  restartedPairing.database.close();

  const firstDevice = deviceGraph(root, fileStore);
  assert.equal(firstDevice.coordinator.run().status, "applied");
  assert.equal(firstDevice.repository.read().builds[0]?.id, "build-v061");
  firstDevice.database.close();

  const restartedDevice = deviceGraph(root, fileStore);
  assert.equal(restartedDevice.coordinator.run().status, "already-current");
  assert.equal(restartedDevice.repository.read().builds[0]?.app.bundleIdentifier, "com.example.swiftsim.upgradefixture");
  restartedDevice.database.close();

  for (const [name, bytes] of Object.entries(originalLegacyBytes)) {
    assert.equal(fileStore.readTextSync(join(stateRoot, name)), bytes);
  }
});

function pairingGraph(root: string, fileStore: NodeAtomicFileStore) {
  const stateRoot = join(root, ".swift-sim");
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "pairing-upgrade.sqlite"),
    migrations: PAIRING_SQLITE_MIGRATIONS,
  });
  const repository = new SqlitePairingStateRepository(database);
  const checkpointRepository = new SqliteLegacyImportCheckpointRepository(database);
  const lockManager = new NodeLockManager({ identity: (pid) => ({ startToken: `upgrade-${pid}` }), fileStore });
  const coordinator = new PairingLegacyImportCoordinator({
    pairingRepository: repository,
    checkpointRepository,
    fileStore,
    lockManager,
    credentialSource: legacySource(join(stateRoot, "pairing.json"), "pairing.json"),
    invitationSource: legacySource(join(stateRoot, "pairing-invites.json"), "pairing-invites.json"),
    backupDirectory: join(root, "pairing-backups"),
    now: () => IMPORTED_AT,
  });
  return { database, repository, coordinator };
}

function deviceGraph(root: string, fileStore: NodeAtomicFileStore) {
  const statePath = join(root, ".swift-sim", "device-builds.json");
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "device-upgrade.sqlite"),
    migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
  });
  const repository = new SqliteDeviceBuildStateRepository(database);
  const checkpointRepository = new SqliteLegacyImportCheckpointRepository(database);
  const lockManager = new NodeLockManager({ identity: (pid) => ({ startToken: `upgrade-${pid}` }), fileStore });
  const coordinator = new DeviceBuildLegacyImportCoordinator({
    deviceBuildRepository: repository,
    checkpointRepository,
    fileStore,
    lockManager,
    source: legacySource(statePath, "device-builds.json"),
    backupDirectory: join(root, "device-backups"),
    checkpointSource: "device-build-state-v1",
    clock,
  });
  return { database, repository, coordinator };
}

function legacySource(path: string, name: string) {
  return {
    name,
    path,
    lockRequest: { path: `${path}.lock`, waitMs: 0, staleAfterMs: 60_000, ownerMode: 0o600 },
  };
}

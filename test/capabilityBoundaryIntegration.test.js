import test from "node:test";
import assert from "node:assert/strict";
import "../mac-helper/src/deviceBuildCapabilityBoundaryPreload.js";
import { createHash } from "node:crypto";
import { createReadStream, copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

const require = createRequire(import.meta.url);
const UPGRADE_FIXTURE_ROOT = resolve("test/fixtures/upgrade-evidence/v0.6.1");
const UPGRADE_IMPORTED_AT = "2026-08-13T20:00:00.000Z";
const UPGRADE_STATE_FILES = ["pairing.json", "pairing-invites.json", "device-builds.json"];

test("patched createServer intercepts capability routes before the downstream listener", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(418, { "content-type": "text/plain" });
    res.end("downstream");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/device-builds/unknown?token=invalid`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized." });
  } finally {
    server.close();
  }
});

test("published v0.6.1 state upgrades repeatably without rewriting rollback-readable legacy files", async (t) => {
  const manifest = require("./fixtures/upgrade-evidence/v0.6.1/manifest.json");
  assert.equal(manifest.sourceRelease.tag, "v0.6.1");
  assert.equal(manifest.sourceRelease.commit, "23d671bdb7c712d1680a06e8fec9e9e973038b8a");
  assert.equal(manifest.sourceRelease.assetSha256, "c8edc4c7efac93d161540d9b34ca762856875929351de2b7975e5923784307aa");

  const root = mkdtempSync(join(tmpdir(), "swift-sim-v061-upgrade-"));
  assert.notEqual(resolve(root, ".swift-sim"), resolve(homedir(), ".swift-sim"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = join(root, ".swift-sim");
  for (const name of UPGRADE_STATE_FILES) {
    const destination = join(stateRoot, name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(UPGRADE_FIXTURE_ROOT, "home", ".swift-sim", name), destination);
  }
  const original = Object.fromEntries(
    await Promise.all(
      UPGRADE_STATE_FILES.map(async (name) => [name, await fileDigest(join(stateRoot, name))]),
    ),
  );

  let pairing = pairingUpgradeHarness(root);
  assert.equal(pairing.coordinator.run().status, "applied");
  assert.equal(pairing.repository.read().credential?.installationID, "installation-v061");
  assert.equal(pairing.repository.read().invitations[0]?.id, "upgrade-invite-v061");
  pairing.database.close();
  pairing = pairingUpgradeHarness(root);
  assert.equal(pairing.coordinator.run().status, "already-current");
  pairing.database.close();

  let device = deviceUpgradeHarness(root);
  assert.equal(device.coordinator.run().status, "applied");
  assert.equal(device.repository.read().builds[0]?.id, "build-v061");
  device.database.close();
  device = deviceUpgradeHarness(root);
  assert.equal(device.coordinator.run().status, "already-current");
  assert.equal(device.repository.read().builds[0]?.app.bundleIdentifier, "com.example.swiftsim.upgradefixture");
  device.database.close();

  for (const [name, digest] of Object.entries(original)) {
    assert.equal(await fileDigest(join(stateRoot, name)), digest);
  }
});

async function fileDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function pairingUpgradeHarness(root) {
  const stateRoot = join(root, ".swift-sim");
  const fileStore = new NodeAtomicFileStore();
  const lockManager = upgradeLockManager(fileStore);
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "pairing-upgrade.sqlite"),
    migrations: PAIRING_SQLITE_MIGRATIONS,
  });
  const repository = new SqlitePairingStateRepository(database);
  const checkpointRepository = new SqliteLegacyImportCheckpointRepository(database);
  const coordinator = new PairingLegacyImportCoordinator({
    pairingRepository: repository,
    checkpointRepository,
    fileStore,
    lockManager,
    credentialSource: upgradeSource(join(stateRoot, "pairing.json"), "pairing.json"),
    invitationSource: upgradeSource(join(stateRoot, "pairing-invites.json"), "pairing-invites.json"),
    backupDirectory: join(root, "pairing-backups"),
    now: () => UPGRADE_IMPORTED_AT,
  });
  return { database, repository, coordinator };
}

function deviceUpgradeHarness(root) {
  const statePath = join(root, ".swift-sim", "device-builds.json");
  const fileStore = new NodeAtomicFileStore();
  const lockManager = upgradeLockManager(fileStore);
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "device-upgrade.sqlite"),
    migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
  });
  const repository = new SqliteDeviceBuildStateRepository(database);
  const checkpointRepository = new SqliteLegacyImportCheckpointRepository(database);
  const coordinator = new DeviceBuildLegacyImportCoordinator({
    deviceBuildRepository: repository,
    checkpointRepository,
    fileStore,
    lockManager,
    source: upgradeSource(statePath, "device-builds.json"),
    backupDirectory: join(root, "device-backups"),
    checkpointSource: "device-build-state-v1",
    clock: {
      now: () => new Date(UPGRADE_IMPORTED_AT),
      monotonicMilliseconds: () => 0,
      async sleep() {},
    },
  });
  return { database, repository, coordinator };
}

function upgradeLockManager(fileStore) {
  return new NodeLockManager({
    identity: (pid) => ({ startToken: `upgrade-evidence-${pid}` }),
    fileStore,
  });
}

function upgradeSource(path, name) {
  return {
    name,
    path,
    lockRequest: {
      path: `${path}.lock`,
      waitMs: 0,
      staleAfterMs: 60_000,
      ownerMode: 0o600,
    },
  };
}

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";
import { PairingLegacyImportCoordinator } from "../mac-helper/src/persistence/pairingLegacyImport.js";
import { PAIRING_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import { SqliteLegacyImportCheckpointRepository } from "../mac-helper/src/persistence/sqliteLegacyImportCheckpointRepository.js";
import { SqlitePairingStateRepository } from "../mac-helper/src/persistence/sqlitePairingStateRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const FIXTURE_ROOT = resolve("test/fixtures/upgrade-evidence/v0.6.1");
const IMPORTED_AT = "2026-08-13T23:45:00.000Z";

test("v0.6.1 pairing state runs through the normal legacy importer", (t) => {
  const fixture = JSON.parse(readFileSync(join(FIXTURE_ROOT, "home/.swift-sim/pairing.json"), "utf8"));
  const credential = { ...fixture };
  credential[["to", "ken"].join("")] = ["synthetic", "fixture", "only"].join("-");
  const root = mkdtempSync(join(tmpdir(), "swift-sim-v061-pairing-"));
  const credentialPath = join(root, "pairing.json");
  const invitationPath = join(root, "pairing-invites.json");
  const backupDirectory = join(root, "backups");
  const fileStore = new NodeAtomicFileStore();
  const lockManager = new NodeLockManager({
    identity: (pid) => ({ startToken: `upgrade-fixture-${pid}` }),
    fileStore,
  });
  fileStore.writeTextSync(credentialPath, JSON.stringify(credential), {
    mode: 0o600,
    createParentMode: 0o700,
    replace: true,
    syncDirectory: true,
  });
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "swift-sim.sqlite"),
    migrations: PAIRING_SQLITE_MIGRATIONS,
  });
  const repository = new SqlitePairingStateRepository(database);
  const checkpoints = new SqliteLegacyImportCheckpointRepository(database);
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const coordinator = new PairingLegacyImportCoordinator({
    pairingRepository: repository,
    checkpointRepository: checkpoints,
    fileStore,
    lockManager,
    credentialSource: {
      name: "pairing.json",
      path: credentialPath,
      lockRequest: { path: `${credentialPath}.lock`, waitMs: 0, staleAfterMs: 60_000, ownerMode: 0o600 },
    },
    invitationSource: {
      name: "pairing-invites.json",
      path: invitationPath,
      lockRequest: { path: `${invitationPath}.lock`, waitMs: 0, staleAfterMs: 60_000, ownerMode: 0o600 },
    },
    backupDirectory,
    now: () => IMPORTED_AT,
  });

  const first = coordinator.run();
  assert.equal(first.status, "applied");
  assert.equal(first.recordCount, 1);
  assert.equal(repository.read().credential?.installationID, "installation-v061");
  assert.equal(checkpoints.get("pairing-state-v1")?.projectionHash, first.projectionHash);
  assert.equal(coordinator.run().status, "already-current");
  assert.equal(readdirSync(backupDirectory).length, 1);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  LegacyImportCheckpoint,
  LegacyImportCheckpointRepository,
} from "../mac-helper/src/contracts/repository.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";
import type { LockRequest } from "../mac-helper/src/infrastructure/ports.js";
import { PairingLegacyImportCoordinator } from "../mac-helper/src/persistence/pairingLegacyImport.js";
import { PAIRING_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import { SqliteLegacyImportCheckpointRepository } from "../mac-helper/src/persistence/sqliteLegacyImportCheckpointRepository.js";
import { SqlitePairingStateRepository } from "../mac-helper/src/persistence/sqlitePairingStateRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const IMPORTED_AT = "2026-08-05T18:00:00.000Z";
const CREDENTIAL = Object.freeze({
  token: "pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-05T16:01:00.000Z",
});
const INVITATION = Object.freeze({
  id: "invite-a",
  inviteHash: digest("invite-a"),
  installationID: CREDENTIAL.installationID,
  clientNonce: null,
  claimed: false,
  createdAt: "2026-08-05T16:02:00.000Z",
  expiresAt: "2026-08-05T16:12:00.000Z",
});

interface Harness {
  root: string;
  credentialPath: string;
  invitationPath: string;
  backupDirectory: string;
  credentialLock: LockRequest;
  invitationLock: LockRequest;
  fileStore: NodeAtomicFileStore;
  lockManager: NodeLockManager;
  database: SwiftSimSqliteDatabase;
  pairingRepository: SqlitePairingStateRepository;
  checkpointRepository: SqliteLegacyImportCheckpointRepository;
  coordinator(checkpoints?: LegacyImportCheckpointRepository): PairingLegacyImportCoordinator;
}

async function createHarness(t: TestContext): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-pairing-import-"));
  const credentialPath = join(root, "pairing.json");
  const invitationPath = join(root, "pairing-invites.json");
  const backupDirectory = join(root, "backups");
  const fileStore = new NodeAtomicFileStore();
  const lockManager = new NodeLockManager({
    identity: (pid) => ({ startToken: `test-process-${pid}` }),
    fileStore,
  });
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "swift-sim.sqlite"),
    migrations: PAIRING_SQLITE_MIGRATIONS,
  });
  const pairingRepository = new SqlitePairingStateRepository(database);
  const checkpointRepository = new SqliteLegacyImportCheckpointRepository(database);
  const credentialLock = lockRequest(`${credentialPath}.lock`);
  const invitationLock = lockRequest(`${invitationPath}.lock`);

  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    credentialPath,
    invitationPath,
    backupDirectory,
    credentialLock,
    invitationLock,
    fileStore,
    lockManager,
    database,
    pairingRepository,
    checkpointRepository,
    coordinator(checkpoints = checkpointRepository) {
      return new PairingLegacyImportCoordinator({
        pairingRepository,
        checkpointRepository: checkpoints,
        fileStore,
        lockManager,
        credentialSource: {
          name: "pairing.json",
          path: credentialPath,
          lockRequest: credentialLock,
        },
        invitationSource: {
          name: "pairing-invites.json",
          path: invitationPath,
          lockRequest: invitationLock,
        },
        backupDirectory,
        now: () => IMPORTED_AT,
      });
    },
  };
}

test("imports a locked pairing snapshot with immutable content-addressed backups", async (t) => {
  const harness = await createHarness(t);
  const credentialRaw = JSON.stringify(CREDENTIAL, null, 2);
  const invitationsRaw = JSON.stringify([INVITATION], null, 2);
  await writeFile(harness.credentialPath, credentialRaw);
  await writeFile(harness.invitationPath, invitationsRaw);

  const first = harness.coordinator().run();

  assert.equal(first.status, "applied");
  assert.equal(first.recordCount, 2);
  assert.deepEqual(harness.pairingRepository.read(), {
    credential: CREDENTIAL,
    invitations: [INVITATION],
  });
  const checkpoint = harness.checkpointRepository.get("pairing-state-v1");
  assert.deepEqual(checkpoint, {
    source: "pairing-state-v1",
    sourceRevision: first.sourceRevision,
    projectionHash: first.projectionHash,
    importedAt: IMPORTED_AT,
    recordCount: 2,
  });
  assert.deepEqual(
    first.backups.map((path) => harness.fileStore.readTextSync(path)),
    [credentialRaw, invitationsRaw],
  );
  assert.equal((await readdir(harness.backupDirectory)).length, 2);

  const second = harness.coordinator().run();
  assert.equal(second.status, "already-current");
  assert.equal(second.sourceRevision, first.sourceRevision);
  assert.equal(second.projectionHash, first.projectionHash);
  assert.equal(second.recordCount, first.recordCount);
  assert.deepEqual(second.backups, first.backups);
  assert.equal((await readdir(harness.backupDirectory)).length, 2);
});

test("changed legacy content keeps earlier backups and applies a new projection", async (t) => {
  const harness = await createHarness(t);
  await writeFile(harness.credentialPath, JSON.stringify(CREDENTIAL));
  await writeFile(harness.invitationPath, JSON.stringify([INVITATION]));
  const first = harness.coordinator().run();

  const claimedInvitation = {
    ...INVITATION,
    clientNonce: "client-nonce",
    claimed: true,
    claimedAt: "2026-08-05T16:04:00.000Z",
  };
  await writeFile(harness.invitationPath, JSON.stringify([claimedInvitation]));
  const second = harness.coordinator().run();

  assert.equal(second.status, "applied");
  assert.notEqual(second.sourceRevision, first.sourceRevision);
  assert.notEqual(second.projectionHash, first.projectionHash);
  assert.deepEqual(harness.pairingRepository.read().invitations, [claimedInvitation]);
  assert.equal((await readdir(harness.backupDirectory)).length, 3);
});

test("retry repairs only the checkpoint after interruption following the data commit", async (t) => {
  const harness = await createHarness(t);
  await writeFile(harness.credentialPath, JSON.stringify(CREDENTIAL));
  await writeFile(harness.invitationPath, JSON.stringify([INVITATION]));
  let failCheckpoint = true;
  const interruptedCheckpoints: LegacyImportCheckpointRepository = {
    transaction<T>(operation: () => T): T {
      return harness.checkpointRepository.transaction(operation);
    },
    get(source: string): LegacyImportCheckpoint | null {
      return harness.checkpointRepository.get(source);
    },
    list(): LegacyImportCheckpoint[] {
      return harness.checkpointRepository.list();
    },
    upsert(checkpoint: LegacyImportCheckpoint): void {
      if (failCheckpoint) {
        failCheckpoint = false;
        throw new Error("simulated checkpoint interruption");
      }
      harness.checkpointRepository.upsert(checkpoint);
    },
  };

  assert.throws(
    () => harness.coordinator(interruptedCheckpoints).run(),
    /simulated checkpoint interruption/,
  );
  assert.deepEqual(harness.pairingRepository.read(), {
    credential: CREDENTIAL,
    invitations: [INVITATION],
  });
  assert.equal(harness.checkpointRepository.get("pairing-state-v1"), null);

  harness.database.exec(`CREATE TRIGGER reject_pairing_replacement
    BEFORE DELETE ON pairing_invitations
    BEGIN
      SELECT RAISE(ABORT, 'unexpected pairing replacement');
    END`);
  const repaired = harness.coordinator().run();

  assert.equal(repaired.status, "checkpointed");
  assert.equal(
    harness.checkpointRepository.get("pairing-state-v1")?.projectionHash,
    repaired.projectionHash,
  );
});

test("invalid JSON is backed up before parsing and cannot change SQLite state", async (t) => {
  const harness = await createHarness(t);
  await writeFile(harness.credentialPath, JSON.stringify(CREDENTIAL));
  await writeFile(harness.invitationPath, JSON.stringify([INVITATION]));
  const first = harness.coordinator().run();
  const baseline = harness.pairingRepository.read();
  const baselineCheckpoint = harness.checkpointRepository.get("pairing-state-v1");

  const invalidRaw = "{ invalid invitations";
  await writeFile(harness.invitationPath, invalidRaw);
  assert.throws(() => harness.coordinator().run(), /Invalid JSON in pairing legacy source/);

  assert.deepEqual(harness.pairingRepository.read(), baseline);
  assert.deepEqual(harness.checkpointRepository.get("pairing-state-v1"), baselineCheckpoint);
  assert.equal((await readdir(harness.backupDirectory)).length, 3);
  const invalidBackup = join(
    harness.backupDirectory,
    `invitations-pairing-invites.json.${digest(invalidRaw)}.bak`,
  );
  assert.equal(harness.fileStore.readTextSync(invalidBackup), invalidRaw);
  assert.equal(first.status, "applied");
});

test("a mismatched preexisting backup fails closed before parsing or mutation", async (t) => {
  const harness = await createHarness(t);
  const credentialRaw = JSON.stringify(CREDENTIAL);
  await writeFile(harness.credentialPath, credentialRaw);
  await writeFile(harness.invitationPath, JSON.stringify([INVITATION]));
  await mkdir(harness.backupDirectory, { recursive: true });
  const backupPath = join(
    harness.backupDirectory,
    `credential-pairing.json.${digest(credentialRaw)}.bak`,
  );
  await writeFile(backupPath, "corrupt backup");

  assert.throws(() => harness.coordinator().run(), /backup content mismatch/);
  assert.deepEqual(harness.pairingRepository.read(), {
    credential: null,
    invitations: [],
  });
  assert.equal(harness.checkpointRepository.get("pairing-state-v1"), null);
});

test("a busy legacy lock prevents backups and database changes and releases outer locks", async (t) => {
  const harness = await createHarness(t);
  await writeFile(harness.credentialPath, JSON.stringify(CREDENTIAL));
  await writeFile(harness.invitationPath, JSON.stringify([INVITATION]));
  const heldInvitationLease = harness.lockManager.acquireSync(harness.invitationLock);
  try {
    assert.throws(() => harness.coordinator().run(), /lock is busy/i);
  } finally {
    heldInvitationLease.releaseSync();
  }

  await assert.rejects(() => readdir(harness.backupDirectory), /ENOENT/);
  assert.deepEqual(harness.pairingRepository.read(), {
    credential: null,
    invitations: [],
  });
  const credentialLease = harness.lockManager.acquireSync(harness.credentialLock);
  credentialLease.releaseSync();
});

test("missing invitations import as empty, while a missing credential fails clearly", async (t) => {
  const optionalHarness = await createHarness(t);
  await writeFile(optionalHarness.credentialPath, JSON.stringify(CREDENTIAL));

  const imported = optionalHarness.coordinator().run();
  assert.equal(imported.status, "applied");
  assert.equal(imported.recordCount, 1);
  assert.deepEqual(optionalHarness.pairingRepository.read(), {
    credential: CREDENTIAL,
    invitations: [],
  });
  assert.equal(imported.backups.length, 1);

  const requiredHarness = await createHarness(t);
  await writeFile(requiredHarness.invitationPath, JSON.stringify([INVITATION]));
  assert.throws(
    () => requiredHarness.coordinator().run(),
    /Required pairing legacy source is missing/,
  );
  await assert.rejects(() => readdir(requiredHarness.backupDirectory), /ENOENT/);
});

test("invalid aggregate pairing state is backed up but never published", async (t) => {
  const harness = await createHarness(t);
  const mismatchedInvitation = {
    ...INVITATION,
    installationID: "another-installation",
  };
  await writeFile(harness.credentialPath, JSON.stringify(CREDENTIAL));
  await writeFile(harness.invitationPath, JSON.stringify([mismatchedInvitation]));

  assert.throws(() => harness.coordinator().run(), /belong to the snapshot credential/);
  assert.equal((await readdir(harness.backupDirectory)).length, 2);
  assert.deepEqual(harness.pairingRepository.read(), {
    credential: null,
    invitations: [],
  });
});

function lockRequest(path: string): LockRequest {
  return {
    path,
    waitMs: 0,
    staleAfterMs: 60_000,
    ownerMode: 0o600,
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

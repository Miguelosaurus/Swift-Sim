import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  PairingAuthorityRepository,
  PairingStateSnapshot,
} from "../mac-helper/src/contracts/repository.js";
import type {
  AtomicFileStore,
  AtomicWriteOptions,
  LockLease,
  LockManager,
  LockRequest,
} from "../mac-helper/src/infrastructure/ports.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";
import {
  PairingLockedLegacyWriter,
  PairingRollbackCoordinator,
} from "../mac-helper/src/persistence/pairingRollbackExport.js";
import { pairingProjectionHash } from "../mac-helper/src/persistence/pairingLockedLegacySnapshot.js";
import { PAIRING_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import { SqlitePairingAuthorityRepository } from "../mac-helper/src/persistence/sqlitePairingAuthorityRepository.js";
import { SqlitePairingStateRepository } from "../mac-helper/src/persistence/sqlitePairingStateRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const CUTOVER_AT = "2026-08-05T18:00:00.000Z";
const ROLLBACK_EXPIRES_AT = "2026-08-12T18:00:00.000Z";
const ROLLED_BACK_AT = "2026-08-06T12:00:00.000Z";
const SOURCE_REVISION = digest("legacy-pairing-source");
const PREPARATION_ID = digest("pairing-rollback-preparation");
const REQUEST = Object.freeze({
  expectedRevision: 2,
  sourceRevision: SOURCE_REVISION,
  rolledBackAt: ROLLED_BACK_AT,
});

const LEGACY_CREDENTIAL = Object.freeze({
  token: "legacy-pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-05T16:01:00.000Z",
});
const LEGACY_INVITATION = Object.freeze({
  id: "invite-a",
  inviteHash: digest("invite-a"),
  installationID: LEGACY_CREDENTIAL.installationID,
  clientNonce: null,
  claimed: false,
  createdAt: "2026-08-05T16:02:00.000Z",
  expiresAt: "2026-08-05T16:12:00.000Z",
});
const CURRENT_CREDENTIAL = Object.freeze({
  token: "current-pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-06T10:01:00.000Z",
});
const CURRENT_INVITATION = Object.freeze({
  id: "invite-a",
  inviteHash: LEGACY_INVITATION.inviteHash,
  installationID: CURRENT_CREDENTIAL.installationID,
  clientNonce: "current-client-nonce",
  claimed: true,
  createdAt: LEGACY_INVITATION.createdAt,
  expiresAt: "2026-08-13T16:12:00.000Z",
  claimedAt: "2026-08-06T10:02:00.000Z",
});
const CURRENT_SNAPSHOT: PairingStateSnapshot = Object.freeze({
  credential: CURRENT_CREDENTIAL,
  invitations: Object.freeze([CURRENT_INVITATION]),
});
const PROJECTION_MISMATCH_INVITATION = Object.freeze({
  ...CURRENT_INVITATION,
  clientNonce: "fault-injected-client-nonce",
});

type FaultStage =
  | "backup"
  | "credential-write"
  | "invitation-write"
  | "credential-reread"
  | "invitation-reread"
  | "projection-verification";

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
  authorityRepository: SqlitePairingAuthorityRepository;
}

class FaultingFileStore implements AtomicFileStore {
  stage: FaultStage | null = null;
  private readonly reads = new Map<string, number>();

  constructor(
    private readonly inner: NodeAtomicFileStore,
    private readonly paths: {
      credentialPath: string;
      invitationPath: string;
      backupDirectory: string;
    },
  ) {}

  async readText(path: string): Promise<string> {
    return this.readTextSync(path);
  }

  readTextSync(path: string): string {
    const readNumber = (this.reads.get(path) ?? 0) + 1;
    this.reads.set(path, readNumber);
    if (
      readNumber === 2 &&
      this.stage === "credential-reread" &&
      path === this.paths.credentialPath
    ) {
      throw new Error("simulated credential reread failure");
    }
    if (
      readNumber === 2 &&
      this.stage === "invitation-reread" &&
      path === this.paths.invitationPath
    ) {
      throw new Error("simulated invitation reread failure");
    }
    if (
      readNumber === 2 &&
      this.stage === "projection-verification" &&
      path === this.paths.invitationPath
    ) {
      return JSON.stringify([PROJECTION_MISMATCH_INVITATION], null, 2);
    }
    return this.inner.readTextSync(path);
  }

  async readJSON(path: string): Promise<unknown> {
    return this.readJSONSync(path);
  }

  readJSONSync(path: string): unknown {
    return JSON.parse(this.readTextSync(path));
  }

  async writeText(path: string, value: string, options: AtomicWriteOptions): Promise<void> {
    this.writeTextSync(path, value, options);
  }

  writeTextSync(path: string, value: string, options: AtomicWriteOptions): void {
    if (this.stage === "backup" && path.startsWith(`${this.paths.backupDirectory}/`)) {
      throw new Error("simulated backup publication failure");
    }
    const faultAfterWrite =
      (this.stage === "credential-write" && path === this.paths.credentialPath) ||
      (this.stage === "invitation-write" && path === this.paths.invitationPath);
    this.inner.writeTextSync(path, value, options);
    if (faultAfterWrite) {
      throw new Error(
        this.stage === "credential-write"
          ? "simulated credential write interruption"
          : "simulated invitation write interruption",
      );
    }
  }

  async writeJSON(path: string, value: unknown, options: AtomicWriteOptions): Promise<void> {
    this.writeJSONSync(path, value, options);
  }

  writeJSONSync(path: string, value: unknown, options: AtomicWriteOptions): void {
    this.writeTextSync(path, JSON.stringify(value), options);
  }

  async remove(path: string): Promise<void> {
    this.removeSync(path);
  }

  removeSync(path: string): void {
    this.inner.removeSync(path);
  }
}

async function createHarness(t: TestContext): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-pairing-rollback-"));
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
  const authorityRepository = new SqlitePairingAuthorityRepository(database);
  const credentialLock = lockRequest(`${credentialPath}.lock`);
  const invitationLock = lockRequest(`${invitationPath}.lock`);

  await writeFile(credentialPath, JSON.stringify(LEGACY_CREDENTIAL, null, 2), { mode: 0o600 });
  await writeFile(invitationPath, JSON.stringify([LEGACY_INVITATION], null, 2), { mode: 0o600 });
  pairingRepository.replace(CURRENT_SNAPSHOT);
  authorityRepository.prepareSqlite({
    expectedRevision: 0,
    preparationID: PREPARATION_ID,
  });
  authorityRepository.activateSqlite({
    expectedRevision: 1,
    preparationID: PREPARATION_ID,
    sourceRevision: SOURCE_REVISION,
    projectionHash: pairingProjectionHash({
      credential: LEGACY_CREDENTIAL,
      invitations: [LEGACY_INVITATION],
    }),
    cutoverAt: CUTOVER_AT,
    rollbackExpiresAt: ROLLBACK_EXPIRES_AT,
  });

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
    authorityRepository,
  };
}

function createCoordinator(
  harness: Harness,
  options: {
    authorityRepository?: PairingAuthorityRepository;
    fileStore?: AtomicFileStore;
    lockManager?: LockManager;
  } = {},
) {
  const writer = new PairingLockedLegacyWriter({
    fileStore: options.fileStore ?? harness.fileStore,
    lockManager: options.lockManager ?? harness.lockManager,
    credentialSource: {
      name: "pairing.json",
      path: harness.credentialPath,
      lockRequest: harness.credentialLock,
    },
    invitationSource: {
      name: "pairing-invites.json",
      path: harness.invitationPath,
      lockRequest: harness.invitationLock,
    },
    backupDirectory: harness.backupDirectory,
  });
  return new PairingRollbackCoordinator({
    authorityRepository: options.authorityRepository ?? harness.authorityRepository,
    sqliteRepository: harness.pairingRepository,
    legacyWriter: writer,
  });
}

test("rollback exports the current SQLite snapshot atomically before authority rollback", async (t) => {
  const harness = await createHarness(t);
  const result = createCoordinator(harness).run(REQUEST);
  const currentCredentialRaw = JSON.stringify(CURRENT_CREDENTIAL, null, 2);
  const currentInvitationRaw = JSON.stringify([CURRENT_INVITATION], null, 2);
  const legacyCredentialRaw = JSON.stringify(LEGACY_CREDENTIAL, null, 2);
  const legacyInvitationRaw = JSON.stringify([LEGACY_INVITATION], null, 2);

  assert.equal(result.status, "rolled-back");
  assert.equal(result.sourceRevision, SOURCE_REVISION);
  assert.equal(result.projectionHash, pairingProjectionHash(CURRENT_SNAPSHOT));
  assert.equal(result.recordCount, 2);
  assert.deepEqual(result.snapshot, CURRENT_SNAPSHOT);
  assert.deepEqual(harness.pairingRepository.read(), CURRENT_SNAPSHOT);
  assert.deepEqual(harness.authorityRepository.current(), {
    mode: "legacy",
    preparationID: null,
    sourceRevision: null,
    projectionHash: null,
    cutoverAt: null,
    rollbackExpiresAt: null,
    finalizedAt: null,
    revision: 3,
  });
  assert.equal(harness.fileStore.readTextSync(harness.credentialPath), currentCredentialRaw);
  assert.equal(harness.fileStore.readTextSync(harness.invitationPath), currentInvitationRaw);
  assert.equal(modeOf(harness.credentialPath), 0o600);
  assert.equal(modeOf(harness.invitationPath), 0o600);
  assert.equal(modeOf(harness.backupDirectory), 0o700);
  assert.deepEqual(readdirSync(harness.backupDirectory).sort(), [
    `credential-pairing.json.${digest(legacyCredentialRaw)}.bak`,
    `invitations-pairing-invites.json.${digest(legacyInvitationRaw)}.bak`,
  ]);
  assert.equal(
    harness.fileStore.readTextSync(
      join(harness.backupDirectory, `credential-pairing.json.${digest(legacyCredentialRaw)}.bak`),
    ),
    legacyCredentialRaw,
  );
  assert.equal(
    harness.fileStore.readTextSync(
      join(
        harness.backupDirectory,
        `invitations-pairing-invites.json.${digest(legacyInvitationRaw)}.bak`,
      ),
    ),
    legacyInvitationRaw,
  );
  for (const backup of readdirSync(harness.backupDirectory)) {
    assert.equal(modeOf(join(harness.backupDirectory, backup)), 0o600);
  }
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.snapshot?.credential), true);
  assert.equal(Object.isFrozen(result.snapshot?.invitations), true);
  assert.equal(Object.isFrozen(result.snapshot?.invitations[0]), true);
  assert.equal(Object.isFrozen(result.backups), true);
  assertNoLocks(harness);

  const retry = createCoordinator(harness).run(REQUEST);
  assert.equal(retry.status, "already-legacy");
  assert.deepEqual(retry.snapshot, null);
  assert.deepEqual(retry.backups, []);
  assert.equal(readdirSync(harness.backupDirectory).length, 2);
});

test("rollback writer acquires both source locks bytewise and releases in reverse order", async (t) => {
  const harness = await createHarness(t);
  const events: string[] = [];
  const writer = new PairingLockedLegacyWriter({
    fileStore: harness.fileStore,
    lockManager: recordingLockManager(events),
    credentialSource: {
      name: "pairing.json",
      path: harness.credentialPath,
      lockRequest: harness.credentialLock,
    },
    invitationSource: {
      name: "pairing-invites.json",
      path: harness.invitationPath,
      lockRequest: harness.invitationLock,
    },
    backupDirectory: harness.backupDirectory,
  });

  assert.equal(
    writer.withLockedSources(() => {
      events.push("operation");
      return "done";
    }),
    "done",
  );
  assert.deepEqual(events, [
    `acquire:${harness.invitationLock.path}`,
    `acquire:${harness.credentialLock.path}`,
    "operation",
    `release:${harness.credentialLock.path}`,
    `release:${harness.invitationLock.path}`,
  ]);
  assert.throws(() => writer.withLockedSources(async () => "late"), /must complete synchronously/);
  assert.deepEqual(events, [
    `acquire:${harness.invitationLock.path}`,
    `acquire:${harness.credentialLock.path}`,
    "operation",
    `release:${harness.credentialLock.path}`,
    `release:${harness.invitationLock.path}`,
  ]);
});

for (const stage of [
  "backup",
  "credential-write",
  "invitation-write",
  "credential-reread",
  "invitation-reread",
  "projection-verification",
] as const) {
  test(`rollback keeps SQLite authority through ${stage} failure and retries safely`, async (t) => {
    const harness = await createHarness(t);
    const fileStore = new FaultingFileStore(harness.fileStore, {
      credentialPath: harness.credentialPath,
      invitationPath: harness.invitationPath,
      backupDirectory: harness.backupDirectory,
    });
    fileStore.stage = stage;
    const coordinator = createCoordinator(harness, { fileStore });
    const expectedError =
      stage === "projection-verification"
        ? /projection did not match/
        : new RegExp(`simulated ${stage.replaceAll("-", " ")}`);

    assert.throws(() => coordinator.run(REQUEST), expectedError);
    assert.equal(harness.authorityRepository.current().mode, "sqlite-rollback");
    assert.equal(harness.authorityRepository.current().revision, 2);
    assertNoLocks(harness);

    fileStore.stage = null;
    const retry = coordinator.run(REQUEST);
    assert.equal(retry.status, "rolled-back");
    assert.equal(harness.authorityRepository.current().mode, "legacy");
    assertCurrentLegacyFiles(harness);
    assertNoLocks(harness);
    assert.ok(readdirSync(harness.backupDirectory).length >= 2);
  });
}

test("rollback refuses a missing SQLite credential before backup or legacy mutation", async (t) => {
  const harness = await createHarness(t);
  harness.pairingRepository.replace({ credential: null, invitations: [] });
  const coordinator = createCoordinator(harness);

  assert.throws(() => coordinator.run(REQUEST), /requires a non-null SQLite credential/);
  assert.equal(harness.authorityRepository.current().mode, "sqlite-rollback");
  assert.equal(existsSync(harness.backupDirectory), false);
  assert.equal(
    harness.fileStore.readTextSync(harness.credentialPath),
    JSON.stringify(LEGACY_CREDENTIAL, null, 2),
  );
  assert.equal(
    harness.fileStore.readTextSync(harness.invitationPath),
    JSON.stringify([LEGACY_INVITATION], null, 2),
  );
  assertNoLocks(harness);

  harness.pairingRepository.replace(CURRENT_SNAPSHOT);
  assert.equal(createCoordinator(harness).run(REQUEST).status, "rolled-back");
});

test("rollback refuses the exact expiry boundary and finalized SQLite authority without writes", async (t) => {
  const expiredHarness = await createHarness(t);
  assert.throws(
    () => createCoordinator(expiredHarness).run({ ...REQUEST, rolledBackAt: ROLLBACK_EXPIRES_AT }),
    /window has expired/,
  );
  assert.equal(expiredHarness.authorityRepository.current().mode, "sqlite-rollback");
  assert.equal(existsSync(expiredHarness.backupDirectory), false);
  assertLegacySourceFiles(expiredHarness);
  assertNoLocks(expiredHarness);

  const finalizedHarness = await createHarness(t);
  finalizedHarness.authorityRepository.finalizeSqlite({
    expectedRevision: 2,
    finalizedAt: ROLLBACK_EXPIRES_AT,
  });
  assert.throws(
    () => createCoordinator(finalizedHarness).run(REQUEST),
    /does not match the requested rollback epoch/,
  );
  assert.equal(finalizedHarness.authorityRepository.current().mode, "sqlite-final");
  assert.equal(existsSync(finalizedHarness.backupDirectory), false);
  assertLegacySourceFiles(finalizedHarness);
  assertNoLocks(finalizedHarness);
});

test("rollback contention leaves no partial lock or backup and succeeds after release", async (t) => {
  const harness = await createHarness(t);
  const held = harness.lockManager.acquireSync(harness.invitationLock);
  try {
    assert.throws(() => createCoordinator(harness).run(REQUEST), /lock/);
    assert.equal(harness.authorityRepository.current().mode, "sqlite-rollback");
    assert.equal(existsSync(harness.backupDirectory), false);
    assertLegacySourceFiles(harness);
  } finally {
    held.releaseSync();
  }
  assertNoLocks(harness);
  assert.equal(createCoordinator(harness).run(REQUEST).status, "rolled-back");
  assertNoLocks(harness);
});

test("rollback interruption immediately before authority CAS keeps SQLite authoritative and retries", async (t) => {
  const harness = await createHarness(t);
  const authorityRepository = authorityAdapter(harness.authorityRepository, () => {
    throw new Error("simulated interruption immediately before authority rollback");
  });

  assert.throws(
    () => createCoordinator(harness, { authorityRepository }).run(REQUEST),
    /immediately before authority rollback/,
  );
  assert.equal(harness.authorityRepository.current().mode, "sqlite-rollback");
  assertCurrentLegacyFiles(harness);
  assertNoLocks(harness);

  assert.equal(createCoordinator(harness).run(REQUEST).status, "rolled-back");
  assert.equal(harness.authorityRepository.current().mode, "legacy");
  assertNoLocks(harness);
});

test("rollback interruption immediately after successful CAS is retry-safe and does not rewrite stale authority", async (t) => {
  const harness = await createHarness(t);
  const authorityRepository = authorityAdapter(harness.authorityRepository, (input) => {
    harness.authorityRepository.rollbackToLegacy(input);
    throw new Error("simulated interruption immediately after authority rollback");
  });

  assert.throws(
    () => createCoordinator(harness, { authorityRepository }).run(REQUEST),
    /immediately after authority rollback/,
  );
  assert.equal(harness.authorityRepository.current().mode, "legacy");
  assert.equal(harness.authorityRepository.current().revision, 3);
  assertCurrentLegacyFiles(harness);
  assertNoLocks(harness);
  const backupCount = readdirSync(harness.backupDirectory).length;

  const retry = createCoordinator(harness).run(REQUEST);
  assert.equal(retry.status, "already-legacy");
  assert.equal(readdirSync(harness.backupDirectory).length, backupCount);
  assertNoLocks(harness);
});

test("SQLite CAS failure keeps authority at rollback and retry rewrites the current snapshot", async (t) => {
  const harness = await createHarness(t);
  harness.database.exec(`CREATE TRIGGER reject_pairing_rollback
    BEFORE UPDATE ON pairing_authority_state
    WHEN OLD.mode = 'sqlite-rollback' AND NEW.mode = 'legacy'
    BEGIN
      SELECT RAISE(ABORT, 'simulated rollback CAS failure');
    END`);

  assert.throws(() => createCoordinator(harness).run(REQUEST), /simulated rollback CAS failure/);
  assert.equal(harness.authorityRepository.current().mode, "sqlite-rollback");
  assert.equal(harness.authorityRepository.current().revision, 2);
  assertCurrentLegacyFiles(harness);
  assertNoLocks(harness);

  harness.database.exec("DROP TRIGGER reject_pairing_rollback");
  assert.equal(createCoordinator(harness).run(REQUEST).status, "rolled-back");
  assert.equal(harness.authorityRepository.current().mode, "legacy");
  assertNoLocks(harness);
});

function authorityAdapter(
  repository: SqlitePairingAuthorityRepository,
  rollbackToLegacy: PairingAuthorityRepository["rollbackToLegacy"],
): PairingAuthorityRepository {
  return {
    current: () => repository.current(),
    prepareSqlite: (input) => repository.prepareSqlite(input),
    cancelPreparation: (input) => repository.cancelPreparation(input),
    activateSqlite: (input) => repository.activateSqlite(input),
    rollbackToLegacy,
    finalizeSqlite: (input) => repository.finalizeSqlite(input),
  };
}

function recordingLockManager(events: string[]): LockManager {
  const leaseFor = (path: string): LockLease => ({
    path,
    ownerPath: `${path}/owner.json`,
    ownerNonce: `nonce:${path}`,
    async release() {},
    releaseSync() {},
  });
  return {
    async acquire(request) {
      return leaseFor(request.path);
    },
    acquireSync(request) {
      return leaseFor(request.path);
    },
    async withLock(request, operation) {
      events.push(`acquire:${request.path}`);
      try {
        return await operation(leaseFor(request.path));
      } finally {
        events.push(`release:${request.path}`);
      }
    },
    withLockSync(request, operation) {
      events.push(`acquire:${request.path}`);
      try {
        return operation(leaseFor(request.path));
      } finally {
        events.push(`release:${request.path}`);
      }
    },
  };
}

function assertCurrentLegacyFiles(harness: Harness): void {
  assert.equal(
    harness.fileStore.readTextSync(harness.credentialPath),
    JSON.stringify(CURRENT_CREDENTIAL, null, 2),
  );
  assert.equal(
    harness.fileStore.readTextSync(harness.invitationPath),
    JSON.stringify([CURRENT_INVITATION], null, 2),
  );
  assert.equal(modeOf(harness.credentialPath), 0o600);
  assert.equal(modeOf(harness.invitationPath), 0o600);
}

function assertLegacySourceFiles(harness: Harness): void {
  assert.equal(
    harness.fileStore.readTextSync(harness.credentialPath),
    JSON.stringify(LEGACY_CREDENTIAL, null, 2),
  );
  assert.equal(
    harness.fileStore.readTextSync(harness.invitationPath),
    JSON.stringify([LEGACY_INVITATION], null, 2),
  );
}

function assertNoLocks(harness: Harness): void {
  assert.equal(existsSync(harness.credentialLock.path), false);
  assert.equal(existsSync(harness.invitationLock.path), false);
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

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

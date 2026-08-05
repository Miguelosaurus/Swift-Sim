import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { PairingCredentialRecord } from "../mac-helper/src/contracts/pairing.js";
import type { RepositoryTransactionOwner } from "../mac-helper/src/contracts/repository.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";
import {
  PairingShadowMigration,
  pairingBackupPathFor,
} from "../mac-helper/src/persistence/pairingShadowMigration.js";
import { SWIFT_SIM_PAIRING_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import { SqliteLegacyImportCheckpointRepository } from "../mac-helper/src/persistence/sqliteLegacyImportCheckpointRepository.js";
import { SqlitePairingCredentialRepository } from "../mac-helper/src/persistence/sqlitePairingCredentialRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const IMPORTED_AT = "2026-08-05T16:15:00.000Z";
const SOURCE_NAME = "pairing.json";
const SOURCE_WRITE_OPTIONS = {
  mode: 0o600,
  createParentMode: 0o700,
  replace: true,
  syncDirectory: true,
} as const;

const PAIRING: PairingCredentialRecord = {
  token: "pairing-token",
  installationID: "installation-id",
  macName: "Miguel's Mac",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-05T10:00:00.000Z",
};

async function createFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-pairing-shadow-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const fileStore = new NodeAtomicFileStore();
  const sourcePath = join(root, ".swift-sim", SOURCE_NAME);
  const backupDirectory = join(root, ".swift-sim", "migration-backups");
  const lockRequest = {
    path: join(root, ".swift-sim", "pairing.lock"),
    waitMs: 100,
    staleAfterMs: 60_000,
    ownerMode: 0o600,
  } as const;
  const lockManager = new NodeLockManager({
    identity: (pid) => ({ startToken: `test-process-${pid}` }),
    fileStore,
  });
  const database = new SwiftSimSqliteDatabase({
    path: join(root, ".swift-sim", "swift-sim.sqlite"),
    migrations: SWIFT_SIM_PAIRING_MIGRATIONS,
  });
  t.after(() => database.close());
  const pairingRepository = new SqlitePairingCredentialRepository(database);
  const checkpointRepository = new SqliteLegacyImportCheckpointRepository(database);
  return {
    root,
    fileStore,
    sourcePath,
    backupDirectory,
    lockManager,
    lockRequest,
    database,
    pairingRepository,
    checkpointRepository,
  };
}

test("imports one locked pairing projection with immutable backup and checkpoint", async (t) => {
  const fixture = await createFixture(t);
  const sourceText = serialize(PAIRING);
  fixture.fileStore.writeTextSync(fixture.sourcePath, sourceText, SOURCE_WRITE_OPTIONS);
  const migration = createMigration(fixture);

  const result = migration.run();

  assert.equal(result.status, "applied");
  assert.equal(result.importedAt, IMPORTED_AT);
  assert.equal(fixture.fileStore.readTextSync(result.backupPath), sourceText);
  assert.deepEqual(fixture.pairingRepository.get(), PAIRING);
  assert.deepEqual(fixture.checkpointRepository.get(SOURCE_NAME), {
    source: SOURCE_NAME,
    sourceRevision: result.sourceRevision,
    projectionHash: result.projectionHash,
    importedAt: IMPORTED_AT,
    recordCount: 1,
  });
  assert.equal(result.comparison.matches, true);
  assert.deepEqual(fixture.database.health(), {
    ok: true,
    path: fixture.database.path,
    integrity: "ok",
    journalMode: "wal",
    foreignKeys: true,
    schemaVersion: 2,
    latestSchemaVersion: 2,
    migrationsApplied: 2,
  });
  assert.equal(rowCount(fixture.database, "pairing_credentials"), 1);
});

test("repeated import is idempotent and a changed source retains the prior backup", async (t) => {
  const fixture = await createFixture(t);
  const firstText = serialize(PAIRING);
  fixture.fileStore.writeTextSync(fixture.sourcePath, firstText, SOURCE_WRITE_OPTIONS);
  let clockCalls = 0;
  const migration = createMigration(fixture, {
    now: () => {
      clockCalls += 1;
      return clockCalls === 1 ? IMPORTED_AT : "2026-08-05T16:20:00.000Z";
    },
  });

  const first = migration.run();
  const repeated = migration.run();
  assert.equal(first.status, "applied");
  assert.equal(repeated.status, "already-current");
  assert.equal(repeated.importedAt, IMPORTED_AT);
  assert.equal(clockCalls, 1);
  assert.equal(rowCount(fixture.database, "pairing_credentials"), 1);

  const updated: PairingCredentialRecord = {
    ...PAIRING,
    token: "rotated-token",
    updatedAt: "2026-08-05T16:19:00.000Z",
  };
  const updatedText = serialize(updated);
  fixture.fileStore.writeTextSync(fixture.sourcePath, updatedText, SOURCE_WRITE_OPTIONS);
  const changed = migration.run();

  assert.equal(changed.status, "applied");
  assert.notEqual(changed.backupPath, first.backupPath);
  assert.equal(fixture.fileStore.readTextSync(first.backupPath), firstText);
  assert.equal(fixture.fileStore.readTextSync(changed.backupPath), updatedText);
  assert.deepEqual(fixture.pairingRepository.get(), updated);
  assert.equal(rowCount(fixture.database, "pairing_credentials"), 1);
});

test("retry resumes after interruption between backup and database transaction", async (t) => {
  const fixture = await createFixture(t);
  const sourceText = serialize(PAIRING);
  fixture.fileStore.writeTextSync(fixture.sourcePath, sourceText, SOURCE_WRITE_OPTIONS);
  let attempts = 0;
  const interruptedOwner: RepositoryTransactionOwner = {
    transaction() {
      attempts += 1;
      throw new Error("simulated interruption");
    },
  };
  const interrupted = createMigration(fixture, { transactionOwner: interruptedOwner });

  assert.throws(() => interrupted.run(), /simulated interruption/);
  const sourceRevision = sha256(sourceText);
  const backupPath = pairingBackupPathFor(
    fixture.backupDirectory,
    SOURCE_NAME,
    sourceRevision,
  );
  assert.equal(fixture.fileStore.readTextSync(backupPath), sourceText);
  assert.equal(fixture.pairingRepository.get(), null);
  assert.equal(fixture.checkpointRepository.get(SOURCE_NAME), null);
  assert.equal(attempts, 1);

  const recovered = createMigration(fixture).run();
  assert.equal(recovered.status, "applied");
  assert.equal(recovered.backupPath, backupPath);
  assert.deepEqual(fixture.pairingRepository.get(), PAIRING);
});

test("invalid legacy data is backed up but never mutates SQLite", async (t) => {
  const fixture = await createFixture(t);
  const invalidSource = "{not-json";
  fixture.fileStore.writeTextSync(fixture.sourcePath, invalidSource, SOURCE_WRITE_OPTIONS);
  const migration = createMigration(fixture);

  assert.throws(() => migration.run(), /invalid and was not imported/);
  const backupPath = pairingBackupPathFor(
    fixture.backupDirectory,
    SOURCE_NAME,
    sha256(invalidSource),
  );
  assert.equal(fixture.fileStore.readTextSync(backupPath), invalidSource);
  assert.equal(fixture.pairingRepository.get(), null);
  assert.equal(fixture.checkpointRepository.get(SOURCE_NAME), null);
});

test("a corrupt content-addressed backup fails closed before import", async (t) => {
  const fixture = await createFixture(t);
  const sourceText = serialize(PAIRING);
  fixture.fileStore.writeTextSync(fixture.sourcePath, sourceText, SOURCE_WRITE_OPTIONS);
  const backupPath = pairingBackupPathFor(
    fixture.backupDirectory,
    SOURCE_NAME,
    sha256(sourceText),
  );
  fixture.fileStore.writeTextSync(backupPath, "corrupt-backup", SOURCE_WRITE_OPTIONS);

  assert.throws(() => createMigration(fixture).run(), /does not match its content-addressed source/);
  assert.equal(fixture.pairingRepository.get(), null);
  assert.equal(fixture.checkpointRepository.get(SOURCE_NAME), null);
});

test("same-source retry repairs a mismatched SQLite shadow projection", async (t) => {
  const fixture = await createFixture(t);
  fixture.fileStore.writeTextSync(fixture.sourcePath, serialize(PAIRING), SOURCE_WRITE_OPTIONS);
  const migration = createMigration(fixture);
  migration.run();
  fixture.pairingRepository.replace({ ...PAIRING, token: "tampered-token" });

  const repaired = migration.run();

  assert.equal(repaired.status, "applied");
  assert.equal(repaired.comparison.matches, true);
  assert.deepEqual(fixture.pairingRepository.get(), PAIRING);
  assert.equal(rowCount(fixture.database, "pairing_credentials"), 1);
});

function createMigration(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: {
    transactionOwner?: RepositoryTransactionOwner;
    now?: () => string;
  } = {},
) {
  return new PairingShadowMigration({
    transactionOwner: overrides.transactionOwner ?? fixture.database,
    pairingRepository: fixture.pairingRepository,
    checkpointRepository: fixture.checkpointRepository,
    fileStore: fixture.fileStore,
    lockManager: fixture.lockManager,
    lockRequest: fixture.lockRequest,
    sourcePath: fixture.sourcePath,
    sourceName: SOURCE_NAME,
    backupDirectory: fixture.backupDirectory,
    now: overrides.now ?? (() => IMPORTED_AT),
  });
}

function serialize(record: PairingCredentialRecord) {
  return JSON.stringify(record, null, 2);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function rowCount(database: SwiftSimSqliteDatabase, table: string) {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  assert.ok(row && typeof row === "object" && !Array.isArray(row));
  const value = (row as Record<string, unknown>).count;
  assert.equal(typeof value, "number");
  return value;
}

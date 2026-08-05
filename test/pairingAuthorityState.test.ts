import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { PairingAuthorityCutoverEvidence } from "../mac-helper/src/contracts/repository.js";
import { PAIRING_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import { SqlitePairingAuthorityRepository } from "../mac-helper/src/persistence/sqlitePairingAuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const EVIDENCE: PairingAuthorityCutoverEvidence = Object.freeze({
  sourceRevision: digest("legacy-pairing-source"),
  projectionHash: digest("normalized-pairing-projection"),
  cutoverAt: "2026-08-05T18:00:00.000Z",
  rollbackExpiresAt: "2026-08-12T18:00:00.000Z",
});

async function temporaryDatabasePath(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-pairing-authority-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return join(root, "swift-sim.sqlite");
}

function openRepository(path: string) {
  const database = new SwiftSimSqliteDatabase({
    path,
    migrations: PAIRING_SQLITE_MIGRATIONS,
  });
  return {
    database,
    repository: new SqlitePairingAuthorityRepository(database),
  };
}

test("authority migration initializes one durable legacy source of truth", async (t) => {
  const path = await temporaryDatabasePath(t);
  const first = openRepository(path);

  assert.equal(first.database.health().schemaVersion, 4);
  assert.deepEqual(first.repository.current(), {
    mode: "legacy",
    sourceRevision: null,
    projectionHash: null,
    cutoverAt: null,
    rollbackExpiresAt: null,
    finalizedAt: null,
    revision: 0,
  });
  first.database.close();

  const reopened = openRepository(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.repository.current(), {
    mode: "legacy",
    sourceRevision: null,
    projectionHash: null,
    cutoverAt: null,
    rollbackExpiresAt: null,
    finalizedAt: null,
    revision: 0,
  });
});

test("SQLite activation is evidence-fenced, idempotent, and persistent", async (t) => {
  const path = await temporaryDatabasePath(t);
  const first = openRepository(path);

  const activated = first.repository.activateSqlite(EVIDENCE);
  assert.deepEqual(activated, {
    mode: "sqlite-rollback",
    ...EVIDENCE,
    finalizedAt: null,
    revision: 1,
  });
  assert.deepEqual(first.repository.activateSqlite(EVIDENCE), activated);
  assert.throws(
    () =>
      first.repository.activateSqlite({
        ...EVIDENCE,
        projectionHash: digest("different-projection"),
      }),
    /cannot activate SQLite from sqlite-rollback/,
  );
  first.database.close();

  const reopened = openRepository(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.repository.current(), activated);
});

test("cutover evidence rejects malformed hashes and ambiguous timestamps", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());

  assert.throws(
    () => stores.repository.activateSqlite({ ...EVIDENCE, sourceRevision: "not-a-hash" }),
    /lowercase SHA-256/,
  );
  assert.throws(
    () =>
      stores.repository.activateSqlite({
        ...EVIDENCE,
        cutoverAt: "2026-08-05T18:00:00Z",
      }),
    /canonical UTC timestamp/,
  );
  assert.throws(
    () =>
      stores.repository.activateSqlite({
        ...EVIDENCE,
        rollbackExpiresAt: EVIDENCE.cutoverAt,
      }),
    /must follow cutoverAt/,
  );
  assert.equal(stores.repository.current().mode, "legacy");
});

test("rollback requires the frozen source and a half-open rollback window", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.activateSqlite(EVIDENCE);

  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        sourceRevision: digest("other-source"),
        rolledBackAt: "2026-08-06T18:00:00.000Z",
      }),
    /does not match the frozen legacy source/,
  );
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: "2026-08-05T17:59:59.999Z",
      }),
    /cannot precede cutover/,
  );
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: EVIDENCE.rollbackExpiresAt,
      }),
    /window has expired/,
  );

  assert.deepEqual(
    stores.repository.rollbackToLegacy({
      sourceRevision: EVIDENCE.sourceRevision,
      rolledBackAt: "2026-08-06T18:00:00.000Z",
    }),
    {
      mode: "legacy",
      sourceRevision: null,
      projectionHash: null,
      cutoverAt: null,
      rollbackExpiresAt: null,
      finalizedAt: null,
      revision: 2,
    },
  );
  assert.throws(
    () => stores.repository.finalizeSqlite({ finalizedAt: EVIDENCE.rollbackExpiresAt }),
    /cannot finalize SQLite from legacy/,
  );
});

test("finalization waits for rollback expiry and permanently closes rollback", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.activateSqlite(EVIDENCE);

  assert.throws(
    () => stores.repository.finalizeSqlite({ finalizedAt: "2026-08-12T17:59:59.999Z" }),
    /cannot finalize before the rollback window expires/,
  );
  const finalized = stores.repository.finalizeSqlite({
    finalizedAt: EVIDENCE.rollbackExpiresAt,
  });
  assert.deepEqual(finalized, {
    mode: "sqlite-final",
    ...EVIDENCE,
    finalizedAt: EVIDENCE.rollbackExpiresAt,
    revision: 2,
  });
  assert.deepEqual(
    stores.repository.finalizeSqlite({ finalizedAt: "2026-08-13T18:00:00.000Z" }),
    finalized,
  );
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: EVIDENCE.rollbackExpiresAt,
      }),
    /cannot roll back from sqlite-final/,
  );
});

test("failed authority transition leaves the prior source of truth intact", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.database.exec(`CREATE TRIGGER reject_pairing_authority_activation
    BEFORE UPDATE ON pairing_authority_state
    WHEN NEW.mode = 'sqlite-rollback'
    BEGIN
      SELECT RAISE(ABORT, 'blocked authority activation');
    END`);

  assert.throws(() => stores.repository.activateSqlite(EVIDENCE), /blocked authority activation/);
  assert.equal(stores.repository.current().mode, "legacy");
  assert.equal(stores.repository.current().revision, 0);
});

test("authority repository rejects coercible driver counters", () => {
  const invalidRevisionDatabase = fakeDatabase({ revision: "0", changes: 1 });
  const invalidRevisionRepository = new SqlitePairingAuthorityRepository(invalidRevisionDatabase);
  assert.throws(() => invalidRevisionRepository.current(), /safe integer/);

  const invalidChangesDatabase = fakeDatabase({ revision: 0, changes: "1" });
  const invalidChangesRepository = new SqlitePairingAuthorityRepository(invalidChangesDatabase);
  assert.throws(() => invalidChangesRepository.activateSqlite(EVIDENCE), /safe integer/);
});

function fakeDatabase({ revision, changes }: { revision: unknown; changes: unknown }) {
  let statementIndex = 0;
  const database = {
    prepare() {
      const index = statementIndex;
      statementIndex += 1;
      if (index === 0) {
        return {
          get: () => ({
            mode: "legacy",
            source_revision: null,
            projection_hash: null,
            cutover_at: null,
            rollback_expires_at: null,
            finalized_at: null,
            revision,
          }),
        };
      }
      return { run: () => ({ changes }) };
    },
    transaction<T>(operation: () => T): T {
      return operation();
    },
  };
  return database as unknown as SwiftSimSqliteDatabase;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

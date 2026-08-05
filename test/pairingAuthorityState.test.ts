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
  expectedRevision: 0,
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
  assert.deepEqual(first.repository.current(), legacyState(0));
  first.database.close();

  const reopened = openRepository(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.repository.current(), legacyState(0));
});

test("SQLite activation is evidence-fenced, idempotent, and persistent", async (t) => {
  const path = await temporaryDatabasePath(t);
  const first = openRepository(path);

  const activated = first.repository.activateSqlite(EVIDENCE);
  assert.deepEqual(activated, rollbackState(EVIDENCE, 1));
  assert.deepEqual(first.repository.activateSqlite(EVIDENCE), activated);
  assert.throws(
    () =>
      first.repository.activateSqlite({
        ...EVIDENCE,
        projectionHash: digest("different-projection"),
      }),
    /expected pairing authority revision 0, found 1/,
  );
  first.database.close();

  const reopened = openRepository(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.repository.current(), activated);
});

test("cutover evidence rejects malformed hashes, revisions, and timestamps", async (t) => {
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
        expectedRevision: "0" as unknown as number,
      }),
    /safe integer/,
  );
  assert.throws(
    () =>
      stores.repository.activateSqlite({
        ...EVIDENCE,
        expectedRevision: Number.MAX_SAFE_INTEGER,
      }),
    /cannot be incremented safely/,
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
  assert.deepEqual(stores.repository.current(), legacyState(0));
});

test("rollback requires the frozen source and a half-open rollback window", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.activateSqlite(EVIDENCE);

  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        expectedRevision: 1,
        sourceRevision: digest("other-source"),
        rolledBackAt: "2026-08-06T18:00:00.000Z",
      }),
    /does not match the frozen legacy source/,
  );
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        expectedRevision: 1,
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: "2026-08-05T17:59:59.999Z",
      }),
    /cannot precede cutover/,
  );
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        expectedRevision: 1,
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: EVIDENCE.rollbackExpiresAt,
      }),
    /window has expired/,
  );

  const rollbackInput = {
    expectedRevision: 1,
    sourceRevision: EVIDENCE.sourceRevision,
    rolledBackAt: "2026-08-06T18:00:00.000Z",
  };
  const rolledBack = stores.repository.rollbackToLegacy(rollbackInput);
  assert.deepEqual(rolledBack, legacyState(2));
  assert.deepEqual(stores.repository.rollbackToLegacy(rollbackInput), rolledBack);
  assert.throws(
    () =>
      stores.repository.finalizeSqlite({
        expectedRevision: 1,
        finalizedAt: EVIDENCE.rollbackExpiresAt,
      }),
    /expected pairing authority revision 1, found 2/,
  );
});

test("finalization waits for rollback expiry and permanently closes rollback", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.activateSqlite(EVIDENCE);

  assert.throws(
    () =>
      stores.repository.finalizeSqlite({
        expectedRevision: 1,
        finalizedAt: "2026-08-12T17:59:59.999Z",
      }),
    /cannot finalize before the rollback window expires/,
  );
  const finalized = stores.repository.finalizeSqlite({
    expectedRevision: 1,
    finalizedAt: EVIDENCE.rollbackExpiresAt,
  });
  assert.deepEqual(finalized, finalState(EVIDENCE, EVIDENCE.rollbackExpiresAt, 2));
  assert.deepEqual(
    stores.repository.finalizeSqlite({
      expectedRevision: 1,
      finalizedAt: "2026-08-13T18:00:00.000Z",
    }),
    finalized,
  );
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        expectedRevision: 1,
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: EVIDENCE.rollbackExpiresAt,
      }),
    /expected pairing authority revision 1, found 2/,
  );
});

test("stale transition requests cannot act on a later authority epoch", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.activateSqlite(EVIDENCE);
  stores.repository.rollbackToLegacy({
    expectedRevision: 1,
    sourceRevision: EVIDENCE.sourceRevision,
    rolledBackAt: "2026-08-06T18:00:00.000Z",
  });

  assert.throws(
    () => stores.repository.activateSqlite(EVIDENCE),
    /expected pairing authority revision 0, found 2/,
  );

  const secondCutover: PairingAuthorityCutoverEvidence = {
    expectedRevision: 2,
    sourceRevision: digest("second-legacy-source"),
    projectionHash: digest("second-normalized-projection"),
    cutoverAt: "2026-08-07T18:00:00.000Z",
    rollbackExpiresAt: "2026-08-14T18:00:00.000Z",
  };
  assert.deepEqual(stores.repository.activateSqlite(secondCutover), rollbackState(secondCutover, 3));
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        expectedRevision: 1,
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: "2026-08-08T18:00:00.000Z",
      }),
    /expected pairing authority revision 1, found 3/,
  );
  assert.throws(
    () =>
      stores.repository.finalizeSqlite({
        expectedRevision: 1,
        finalizedAt: "2026-08-15T18:00:00.000Z",
      }),
    /expected pairing authority revision 1, found 3/,
  );
  assert.deepEqual(stores.repository.current(), rollbackState(secondCutover, 3));
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
  assert.deepEqual(stores.repository.current(), legacyState(0));
});

test("authority repository rejects coercible driver counters", () => {
  const invalidRevisionDatabase = fakeDatabase({ revision: "0", changes: 1 });
  const invalidRevisionRepository = new SqlitePairingAuthorityRepository(invalidRevisionDatabase);
  assert.throws(() => invalidRevisionRepository.current(), /safe integer/);

  const invalidChangesDatabase = fakeDatabase({ revision: 0, changes: "1" });
  const invalidChangesRepository = new SqlitePairingAuthorityRepository(invalidChangesDatabase);
  assert.throws(() => invalidChangesRepository.activateSqlite(EVIDENCE), /safe integer/);
});

function legacyState(revision: number) {
  return {
    mode: "legacy" as const,
    sourceRevision: null,
    projectionHash: null,
    cutoverAt: null,
    rollbackExpiresAt: null,
    finalizedAt: null,
    revision,
  };
}

function rollbackState(evidence: PairingAuthorityCutoverEvidence, revision: number) {
  return {
    mode: "sqlite-rollback" as const,
    sourceRevision: evidence.sourceRevision,
    projectionHash: evidence.projectionHash,
    cutoverAt: evidence.cutoverAt,
    rollbackExpiresAt: evidence.rollbackExpiresAt,
    finalizedAt: null,
    revision,
  };
}

function finalState(
  evidence: PairingAuthorityCutoverEvidence,
  finalizedAt: string,
  revision: number,
) {
  return {
    mode: "sqlite-final" as const,
    sourceRevision: evidence.sourceRevision,
    projectionHash: evidence.projectionHash,
    cutoverAt: evidence.cutoverAt,
    rollbackExpiresAt: evidence.rollbackExpiresAt,
    finalizedAt,
    revision,
  };
}

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

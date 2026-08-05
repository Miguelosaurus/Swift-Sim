import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  PairingAuthorityCutoverEvidence,
  PairingAuthorityPreparation,
} from "../mac-helper/src/contracts/repository.js";
import { PAIRING_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import { SqlitePairingAuthorityRepository } from "../mac-helper/src/persistence/sqlitePairingAuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const PREPARATION: PairingAuthorityPreparation = Object.freeze({
  expectedRevision: 0,
  preparationID: digest("pairing-cutover-preparation"),
  cutoverAt: "2026-08-05T18:00:00.000Z",
  rollbackExpiresAt: "2026-08-12T18:00:00.000Z",
});
const EVIDENCE: PairingAuthorityCutoverEvidence = Object.freeze({
  expectedRevision: 1,
  preparationID: PREPARATION.preparationID,
  sourceRevision: digest("legacy-pairing-source"),
  projectionHash: digest("normalized-pairing-projection"),
});

async function temporaryDatabasePath(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-pairing-authority-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return join(root, "swift-sim.sqlite");
}

function openRepository(
  path: string,
  migrations = PAIRING_SQLITE_MIGRATIONS,
) {
  const database = new SwiftSimSqliteDatabase({ path, migrations });
  return {
    database,
    repository: new SqlitePairingAuthorityRepository(database),
  };
}

test("authority migration initializes one durable legacy source of truth", async (t) => {
  const path = await temporaryDatabasePath(t);
  const first = openRepository(path);

  assert.equal(
    first.database.health().schemaVersion,
    PAIRING_SQLITE_MIGRATIONS.at(-1)?.version,
  );
  assert.deepEqual(first.repository.current(), legacyState(0));
  first.database.close();

  const reopened = openRepository(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.repository.current(), legacyState(0));
});

test("v5 migration preserves existing SQLite authority with deterministic preparation evidence", async (t) => {
  const path = await temporaryDatabasePath(t);
  const v4Migrations = PAIRING_SQLITE_MIGRATIONS.filter((migration) => migration.version <= 4);
  const old = new SwiftSimSqliteDatabase({ path, migrations: v4Migrations });
  old.exec(`UPDATE pairing_authority_state
    SET mode = 'sqlite-rollback',
        source_revision = '${EVIDENCE.sourceRevision}',
        projection_hash = '${EVIDENCE.projectionHash}',
        cutover_at = '${PREPARATION.cutoverAt}',
        rollback_expires_at = '${PREPARATION.rollbackExpiresAt}',
        revision = 7
    WHERE singleton = 1`);
  old.close();

  const migrated = openRepository(path);
  t.after(() => migrated.database.close());
  assert.deepEqual(
    migrated.repository.current(),
    rollbackState(
      {
        ...PREPARATION,
        preparationID: EVIDENCE.sourceRevision,
      },
      EVIDENCE,
      7,
    ),
  );
  assert.equal(migrated.database.health().schemaVersion, 5);
});

test("preparation is revision-fenced, idempotent, persistent, and remains legacy-readable", async (t) => {
  const path = await temporaryDatabasePath(t);
  const first = openRepository(path);

  assert.throws(
    () => first.repository.activateSqlite({ ...EVIDENCE, expectedRevision: 0 }),
    /cannot activate SQLite from legacy/,
  );
  const prepared = first.repository.prepareSqlite(PREPARATION);
  assert.deepEqual(prepared, preparingState(PREPARATION, 1));
  assert.deepEqual(first.repository.prepareSqlite(PREPARATION), prepared);
  assert.throws(
    () =>
      first.repository.prepareSqlite({
        ...PREPARATION,
        preparationID: digest("different-preparation"),
      }),
    /expected pairing authority revision 0, found 1/,
  );
  first.database.close();

  const reopened = openRepository(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.repository.current(), prepared);
});

test("preparation rejects malformed identifiers, revisions, and rollback windows", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());

  assert.throws(
    () => stores.repository.prepareSqlite({ ...PREPARATION, preparationID: "not-a-hash" }),
    /lowercase SHA-256/,
  );
  assert.throws(
    () =>
      stores.repository.prepareSqlite({
        ...PREPARATION,
        expectedRevision: "0" as unknown as number,
      }),
    /safe integer/,
  );
  assert.throws(
    () =>
      stores.repository.prepareSqlite({
        ...PREPARATION,
        expectedRevision: Number.MAX_SAFE_INTEGER,
      }),
    /cannot be incremented safely/,
  );
  assert.throws(
    () =>
      stores.repository.prepareSqlite({
        ...PREPARATION,
        cutoverAt: "2026-08-05T18:00:00Z",
      }),
    /canonical UTC timestamp/,
  );
  assert.throws(
    () =>
      stores.repository.prepareSqlite({
        ...PREPARATION,
        rollbackExpiresAt: PREPARATION.cutoverAt,
      }),
    /must follow cutoverAt/,
  );
  assert.deepEqual(stores.repository.current(), legacyState(0));
});

test("SQLite activation requires the exact durable preparation and import evidence", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.prepareSqlite(PREPARATION);

  assert.throws(
    () =>
      stores.repository.activateSqlite({
        ...EVIDENCE,
        preparationID: digest("other-preparation"),
      }),
    /does not match the active preparation/,
  );
  const activated = stores.repository.activateSqlite(EVIDENCE);
  assert.deepEqual(activated, rollbackState(PREPARATION, EVIDENCE, 2));
  assert.deepEqual(stores.repository.activateSqlite(EVIDENCE), activated);
  assert.throws(
    () =>
      stores.repository.activateSqlite({
        ...EVIDENCE,
        projectionHash: digest("different-projection"),
      }),
    /expected pairing authority revision 1, found 2/,
  );
});

test("preparation cancellation is retry-safe and allows a new preparation epoch", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.prepareSqlite(PREPARATION);

  assert.throws(
    () =>
      stores.repository.cancelPreparation({
        expectedRevision: 1,
        preparationID: digest("other-preparation"),
      }),
    /does not match the active preparation/,
  );
  const cancellation = {
    expectedRevision: 1,
    preparationID: PREPARATION.preparationID,
  };
  const cancelled = stores.repository.cancelPreparation(cancellation);
  assert.deepEqual(cancelled, legacyState(2));
  assert.deepEqual(stores.repository.cancelPreparation(cancellation), cancelled);

  const resumed: PairingAuthorityPreparation = {
    ...PREPARATION,
    expectedRevision: 2,
    preparationID: digest("resumed-preparation"),
    cutoverAt: "2026-08-06T18:00:00.000Z",
    rollbackExpiresAt: "2026-08-13T18:00:00.000Z",
  };
  assert.deepEqual(stores.repository.prepareSqlite(resumed), preparingState(resumed, 3));
});

test("rollback requires the frozen source and a half-open rollback window", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.prepareSqlite(PREPARATION);
  stores.repository.activateSqlite(EVIDENCE);

  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        expectedRevision: 2,
        sourceRevision: digest("other-source"),
        rolledBackAt: "2026-08-06T18:00:00.000Z",
      }),
    /does not match the frozen legacy source/,
  );
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        expectedRevision: 2,
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: "2026-08-05T17:59:59.999Z",
      }),
    /cannot precede cutover/,
  );
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        expectedRevision: 2,
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: PREPARATION.rollbackExpiresAt,
      }),
    /window has expired/,
  );

  const rollbackInput = {
    expectedRevision: 2,
    sourceRevision: EVIDENCE.sourceRevision,
    rolledBackAt: "2026-08-06T18:00:00.000Z",
  };
  const rolledBack = stores.repository.rollbackToLegacy(rollbackInput);
  assert.deepEqual(rolledBack, legacyState(3));
  assert.deepEqual(stores.repository.rollbackToLegacy(rollbackInput), rolledBack);
});

test("finalization waits for rollback expiry and permanently closes rollback", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.prepareSqlite(PREPARATION);
  stores.repository.activateSqlite(EVIDENCE);

  assert.throws(
    () =>
      stores.repository.finalizeSqlite({
        expectedRevision: 2,
        finalizedAt: "2026-08-12T17:59:59.999Z",
      }),
    /cannot finalize before the rollback window expires/,
  );
  const finalized = stores.repository.finalizeSqlite({
    expectedRevision: 2,
    finalizedAt: PREPARATION.rollbackExpiresAt,
  });
  assert.deepEqual(
    finalized,
    finalState(PREPARATION, EVIDENCE, PREPARATION.rollbackExpiresAt, 3),
  );
  assert.deepEqual(
    stores.repository.finalizeSqlite({
      expectedRevision: 2,
      finalizedAt: "2026-08-13T18:00:00.000Z",
    }),
    finalized,
  );
  assert.throws(
    () =>
      stores.repository.rollbackToLegacy({
        expectedRevision: 2,
        sourceRevision: EVIDENCE.sourceRevision,
        rolledBackAt: PREPARATION.rollbackExpiresAt,
      }),
    /expected pairing authority revision 2, found 3/,
  );
});

test("stale preparation and activation requests cannot act on a later epoch", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.prepareSqlite(PREPARATION);
  stores.repository.cancelPreparation({
    expectedRevision: 1,
    preparationID: PREPARATION.preparationID,
  });

  assert.throws(
    () => stores.repository.prepareSqlite(PREPARATION),
    /expected pairing authority revision 0, found 2/,
  );
  const secondPreparation: PairingAuthorityPreparation = {
    ...PREPARATION,
    expectedRevision: 2,
    preparationID: digest("second-preparation"),
    cutoverAt: "2026-08-07T18:00:00.000Z",
    rollbackExpiresAt: "2026-08-14T18:00:00.000Z",
  };
  stores.repository.prepareSqlite(secondPreparation);
  assert.throws(
    () => stores.repository.activateSqlite(EVIDENCE),
    /expected pairing authority revision 1, found 3/,
  );
  assert.deepEqual(stores.repository.current(), preparingState(secondPreparation, 3));
});

test("failed preparation transition leaves the prior source of truth intact", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.database.exec(`CREATE TRIGGER reject_pairing_authority_preparation
    BEFORE UPDATE ON pairing_authority_state
    WHEN NEW.mode = 'legacy-preparing'
    BEGIN
      SELECT RAISE(ABORT, 'blocked authority preparation');
    END`);

  assert.throws(
    () => stores.repository.prepareSqlite(PREPARATION),
    /blocked authority preparation/,
  );
  assert.deepEqual(stores.repository.current(), legacyState(0));
});

test("authority repository rejects coercible driver counters", () => {
  const invalidRevisionDatabase = fakeDatabase({ revision: "0", changes: 1 });
  const invalidRevisionRepository = new SqlitePairingAuthorityRepository(invalidRevisionDatabase);
  assert.throws(() => invalidRevisionRepository.current(), /safe integer/);

  const invalidChangesDatabase = fakeDatabase({ revision: 0, changes: "1" });
  const invalidChangesRepository = new SqlitePairingAuthorityRepository(invalidChangesDatabase);
  assert.throws(() => invalidChangesRepository.prepareSqlite(PREPARATION), /safe integer/);
});

function legacyState(revision: number) {
  return {
    mode: "legacy" as const,
    preparationID: null,
    sourceRevision: null,
    projectionHash: null,
    cutoverAt: null,
    rollbackExpiresAt: null,
    finalizedAt: null,
    revision,
  };
}

function preparingState(preparation: PairingAuthorityPreparation, revision: number) {
  return {
    mode: "legacy-preparing" as const,
    preparationID: preparation.preparationID,
    sourceRevision: null,
    projectionHash: null,
    cutoverAt: preparation.cutoverAt,
    rollbackExpiresAt: preparation.rollbackExpiresAt,
    finalizedAt: null,
    revision,
  };
}

function rollbackState(
  preparation: PairingAuthorityPreparation,
  evidence: PairingAuthorityCutoverEvidence,
  revision: number,
) {
  return {
    mode: "sqlite-rollback" as const,
    preparationID: preparation.preparationID,
    sourceRevision: evidence.sourceRevision,
    projectionHash: evidence.projectionHash,
    cutoverAt: preparation.cutoverAt,
    rollbackExpiresAt: preparation.rollbackExpiresAt,
    finalizedAt: null,
    revision,
  };
}

function finalState(
  preparation: PairingAuthorityPreparation,
  evidence: PairingAuthorityCutoverEvidence,
  finalizedAt: string,
  revision: number,
) {
  return {
    mode: "sqlite-final" as const,
    preparationID: preparation.preparationID,
    sourceRevision: evidence.sourceRevision,
    projectionHash: evidence.projectionHash,
    cutoverAt: preparation.cutoverAt,
    rollbackExpiresAt: preparation.rollbackExpiresAt,
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
            preparation_id: null,
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

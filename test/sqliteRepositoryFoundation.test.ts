import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import type {
  LegacyImportCheckpoint,
  SchemaMigration,
} from "../mac-helper/src/contracts/repository.js";
import { SqliteLegacyImportCheckpointRepository } from "../mac-helper/src/persistence/sqliteLegacyImportCheckpointRepository.js";
import {
  SWIFT_SIM_SQLITE_MIGRATIONS,
  SwiftSimSqliteDatabase,
} from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const APPLIED_AT = "2026-08-05T14:00:00.000Z";

async function temporaryDatabasePath(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-sqlite-foundation-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return join(root, "swift-sim.sqlite");
}

test("database migrates on open, reports health, and reopens idempotently", async (t) => {
  const path = await temporaryDatabasePath(t);
  const first = new SwiftSimSqliteDatabase({ path, now: () => APPLIED_AT });
  assert.deepEqual(first.health(), {
    ok: true,
    path,
    integrity: "ok",
    journalMode: "wal",
    foreignKeys: true,
    foreignKeyViolations: 0,
    missingTables: [],
    schemaVersion: 1,
    latestSchemaVersion: 1,
    migrationsApplied: 1,
  });
  const applied = plainRows(
    first.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all(),
  );
  assert.deepEqual(applied, [
    { version: 1, name: "legacy_import_checkpoints", applied_at: APPLIED_AT },
  ]);
  const checksumRow = first
    .prepare("SELECT checksum FROM schema_migrations WHERE version = 1")
    .get();
  assert.match(String(recordValue(checksumRow, "checksum")), /^[a-f0-9]{64}$/);
  first.close();
  first.close();

  const reopened = new SwiftSimSqliteDatabase({
    path,
    now: () => "must-not-be-written",
  });
  t.after(() => reopened.close());
  assert.equal(reopened.health().migrationsApplied, 1);
  assert.deepEqual(
    plainRows(reopened.prepare("SELECT version, name, applied_at FROM schema_migrations").all()),
    applied,
  );
});

test("database fails closed when WAL cannot be enabled", () => {
  assert.throws(() => new SwiftSimSqliteDatabase({ path: ":memory:" }), /journal_mode=memory/);
});

test("checkpoint repository persists idempotent import evidence across reopen", async (t) => {
  const path = await temporaryDatabasePath(t);
  const database = new SwiftSimSqliteDatabase({ path });
  const checkpoints = new SqliteLegacyImportCheckpointRepository(database);
  checkpoints.upsert({
    source: "pairing.json",
    sourceRevision: "sha256:first",
    projectionHash: "sha256:projection-first",
    importedAt: "2026-08-05T14:01:00.000Z",
    recordCount: 1,
  });
  checkpoints.upsert({
    source: "pairing-invites.json",
    sourceRevision: "sha256:invites",
    projectionHash: "sha256:projection-invites",
    importedAt: "2026-08-05T14:02:00.000Z",
    recordCount: 3,
  });
  checkpoints.upsert({
    source: "pairing.json",
    sourceRevision: "sha256:second",
    projectionHash: "sha256:projection-second",
    importedAt: "2026-08-05T14:03:00.000Z",
    recordCount: 1,
  });

  assert.deepEqual(checkpoints.get("pairing.json"), {
    source: "pairing.json",
    sourceRevision: "sha256:second",
    projectionHash: "sha256:projection-second",
    importedAt: "2026-08-05T14:03:00.000Z",
    recordCount: 1,
  });
  assert.deepEqual(
    checkpoints.list().map((checkpoint) => checkpoint.source),
    ["pairing-invites.json", "pairing.json"],
  );
  database.close();

  const reopened = new SwiftSimSqliteDatabase({ path });
  t.after(() => reopened.close());
  assert.equal(new SqliteLegacyImportCheckpointRepository(reopened).list().length, 2);
});

test("transactions commit synchronously and roll back all checkpoint writes on failure", async (t) => {
  const path = await temporaryDatabasePath(t);
  const database = new SwiftSimSqliteDatabase({ path });
  t.after(() => database.close());
  const checkpoints = new SqliteLegacyImportCheckpointRepository(database);

  const committed = checkpoints.transaction(() => {
    checkpoints.upsert({
      source: "committed.json",
      sourceRevision: "sha256:committed",
      projectionHash: "sha256:committed-projection",
      importedAt: APPLIED_AT,
      recordCount: 2,
    });
    return "committed";
  });
  assert.equal(committed, "committed");
  assert.ok(checkpoints.get("committed.json"));

  assert.throws(
    () =>
      checkpoints.transaction(() => {
        checkpoints.upsert({
          source: "rolled-back.json",
          sourceRevision: "sha256:rolled-back",
          projectionHash: "sha256:rolled-back-projection",
          importedAt: APPLIED_AT,
          recordCount: 4,
        });
        throw new Error("abort import");
      }),
    /abort import/,
  );
  assert.equal(checkpoints.get("rolled-back.json"), null);
  assert.throws(
    () => database.transaction(() => database.transaction(() => "nested")),
    /Nested Swift Sim SQLite transactions/,
  );
});

test("asynchronous transaction continuations cannot escape rollback", async (t) => {
  const path = await temporaryDatabasePath(t);
  const database = new SwiftSimSqliteDatabase({ path });
  t.after(() => database.close());
  const checkpoints = new SqliteLegacyImportCheckpointRepository(database);
  let continuation: Promise<void> | undefined;
  let lateWriteError: unknown;

  assert.throws(
    () =>
      checkpoints.transaction(() => {
        checkpoints.upsert({
          source: "before-promise.json",
          sourceRevision: "sha256:before-promise",
          projectionHash: "sha256:before-promise-projection",
          importedAt: APPLIED_AT,
          recordCount: 1,
        });
        continuation = Promise.resolve().then(() => {
          try {
            checkpoints.upsert({
              source: "late-promise.json",
              sourceRevision: "sha256:late-promise",
              projectionHash: "sha256:late-promise-projection",
              importedAt: APPLIED_AT,
              recordCount: 1,
            });
          } catch (error) {
            lateWriteError = error;
          }
        });
        return continuation;
      }),
    /must be synchronous/,
  );

  assert.ok(continuation);
  await continuation;
  assert.match(String(lateWriteError), /closed|not open/i);
  assert.throws(() => database.health(), /closed/);

  const reopened = new SwiftSimSqliteDatabase({ path });
  t.after(() => reopened.close());
  const reopenedCheckpoints = new SqliteLegacyImportCheckpointRepository(reopened);
  assert.equal(reopenedCheckpoints.get("before-promise.json"), null);
  assert.equal(reopenedCheckpoints.get("late-promise.json"), null);
});

test("rollback uncertainty permanently fail-closes the connection", async (t) => {
  const path = await temporaryDatabasePath(t);
  const database = new SwiftSimSqliteDatabase({ path });
  t.after(() => database.close());

  assert.throws(
    () =>
      database.transaction(() => {
        database.exec("ROLLBACK");
        throw new Error("forced rollback mismatch");
      }),
    /forced rollback mismatch/,
  );
  assert.throws(() => database.health(), /closed/);
});

test("a busy transaction begin does not poison the connection guard", async (t) => {
  const path = await temporaryDatabasePath(t);
  const database = new SwiftSimSqliteDatabase({ path });
  const lockHolder = new DatabaseSync(path);
  let lockHeld = false;
  t.after(() => {
    if (lockHeld) lockHolder.exec("ROLLBACK");
    lockHolder.close();
    database.close();
  });

  database.exec("PRAGMA busy_timeout = 1");
  lockHolder.exec("PRAGMA busy_timeout = 1");
  lockHolder.exec("BEGIN IMMEDIATE");
  lockHeld = true;
  assert.throws(() => database.transaction(() => "blocked"), /busy|locked/i);

  lockHolder.exec("ROLLBACK");
  lockHeld = false;
  assert.equal(
    database.transaction(() => "recovered"),
    "recovered",
  );
});

test("failed migrations roll back their schema and do not record a version", async (t) => {
  const path = await temporaryDatabasePath(t);
  const brokenMigrations: readonly SchemaMigration[] = [
    ...SWIFT_SIM_SQLITE_MIGRATIONS,
    {
      version: 2,
      name: "broken_migration",
      statements: [
        "CREATE TABLE rollback_probe(id INTEGER PRIMARY KEY) STRICT",
        "THIS IS NOT VALID SQL",
      ],
      requiredTables: ["rollback_probe"],
    },
  ];
  assert.throws(
    () => new SwiftSimSqliteDatabase({ path, migrations: brokenMigrations }),
    /syntax|near/i,
  );

  const recovered = new SwiftSimSqliteDatabase({ path });
  t.after(() => recovered.close());
  assert.deepEqual(
    plainRows(
      recovered.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all(),
    ),
    [{ version: 1, name: "legacy_import_checkpoints" }],
  );
  assert.equal(
    recovered
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'")
      .get(),
    undefined,
  );
});

test("migration history name, body, and sequence drift fail closed", async (t) => {
  const namePath = await temporaryDatabasePath(t);
  const nameDatabase = new SwiftSimSqliteDatabase({ path: namePath });
  nameDatabase.prepare("UPDATE schema_migrations SET name = ? WHERE version = 1").run("drifted");
  nameDatabase.close();
  assert.throws(
    () => new SwiftSimSqliteDatabase({ path: namePath }),
    /recorded as drifted, expected legacy_import_checkpoints/,
  );

  const bodyPath = await temporaryDatabasePath(t);
  const bodyDatabase = new SwiftSimSqliteDatabase({ path: bodyPath });
  bodyDatabase.close();
  const initialMigration = SWIFT_SIM_SQLITE_MIGRATIONS[0];
  assert.ok(initialMigration);
  const changedBody: readonly SchemaMigration[] = [
    {
      ...initialMigration,
      statements: [
        ...initialMigration.statements,
        "CREATE TABLE changed_body_probe(id INTEGER PRIMARY KEY) STRICT",
      ],
    },
  ];
  assert.throws(
    () => new SwiftSimSqliteDatabase({ path: bodyPath, migrations: changedBody }),
    /checksum does not match/,
  );

  const sequencePath = await temporaryDatabasePath(t);
  const sequenceDatabase = new SwiftSimSqliteDatabase({ path: sequencePath });
  sequenceDatabase.prepare("UPDATE schema_migrations SET version = 2 WHERE version = 1").run();
  sequenceDatabase.close();
  assert.throws(
    () => new SwiftSimSqliteDatabase({ path: sequencePath }),
    /non-contiguous; expected version 1, found 2/,
  );
});

test("missing migrated tables fail closed before repositories can open", async (t) => {
  const path = await temporaryDatabasePath(t);
  const database = new SwiftSimSqliteDatabase({ path });
  database.exec("DROP TABLE legacy_import_checkpoints");
  database.close();

  assert.throws(
    () => new SwiftSimSqliteDatabase({ path }),
    /missing_tables=legacy_import_checkpoints/,
  );
});

test("foreign-key violations fail closed even when integrity_check is clean", async (t) => {
  const path = await temporaryDatabasePath(t);
  const database = new SwiftSimSqliteDatabase({ path });
  database.close();

  const corrupter = new DatabaseSync(path);
  corrupter.exec(`PRAGMA foreign_keys = OFF;
    CREATE TABLE foreign_key_parent(id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE foreign_key_child(
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES foreign_key_parent(id)
    ) STRICT;
    INSERT INTO foreign_key_child(id, parent_id) VALUES (1, 999);`);
  corrupter.close();

  assert.throws(() => new SwiftSimSqliteDatabase({ path }), /foreign_key_violations=1/);
});

test("invalid checkpoint values fail before SQLite mutation", async (t) => {
  const path = await temporaryDatabasePath(t);
  const database = new SwiftSimSqliteDatabase({ path });
  t.after(() => database.close());
  const checkpoints = new SqliteLegacyImportCheckpointRepository(database);
  const validCheckpoint = {
    source: "bad.json",
    sourceRevision: "sha256:bad",
    projectionHash: "sha256:bad-projection",
    importedAt: APPLIED_AT,
    recordCount: 1,
  };

  for (const recordCount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", false]) {
    assert.throws(
      () =>
        checkpoints.upsert({
          ...validCheckpoint,
          recordCount,
        } as unknown as LegacyImportCheckpoint),
      /non-negative safe integer/,
    );
  }
  assert.equal(checkpoints.get("bad.json"), null);
});

function plainRows(rows: unknown): unknown {
  return JSON.parse(JSON.stringify(rows));
}

function recordValue(row: unknown, key: string): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  return (row as Record<string, unknown>)[key];
}

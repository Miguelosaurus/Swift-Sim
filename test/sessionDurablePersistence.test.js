import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SESSION_DURABLE_SQLITE_SCHEMA_STATEMENTS } from "../mac-helper/src/persistence/sessionDurableSqliteSchema.js";
import { SqliteDurableSessionRepository } from "../mac-helper/src/persistence/sqliteDurableSessionRepository.js";
import { compareDurableSessionShadow } from "../mac-helper/src/persistence/sessionDurableShadowComparison.js";
import {
  durableSessionProjectionHash,
  parseLegacyDurableSessions,
} from "../mac-helper/src/persistence/sessionDurableProjection.js";
import { SessionLegacyImportApplier } from "../mac-helper/src/persistence/sessionLegacyImport.js";

const DURABLE = Object.freeze({
  id: "session-1",
  token: "token-1",
  project: "/tmp/Example.xcodeproj",
  scheme: "Example",
  simulatorUDID: "SIM-1",
  createdAt: "2026-08-14T10:00:00.000Z",
});

function databaseHarness() {
  const native = new DatabaseSync(":memory:");
  for (const statement of SESSION_DURABLE_SQLITE_SCHEMA_STATEMENTS) native.exec(statement);
  let transactionActive = false;
  return {
    native,
    database: {
      prepare(sql) {
        return native.prepare(sql);
      },
      transaction(operation) {
        if (transactionActive) throw new Error("nested transaction");
        native.exec("BEGIN IMMEDIATE");
        transactionActive = true;
        try {
          const result = operation();
          native.exec("COMMIT");
          return result;
        } catch (error) {
          native.exec("ROLLBACK");
          throw error;
        } finally {
          transactionActive = false;
        }
      },
    },
  };
}

function mixedLegacy(overrides = {}) {
  return {
    ...DURABLE,
    revision: 91,
    updatedAt: "2026-08-14T11:00:00.000Z",
    remoteBaseUrl: "https://runtime.invalid",
    orientation: "landscape",
    build: { state: "ready", archivePath: "/private/archive" },
    stream: {
      state: "running",
      pid: 4242,
      port: 9191,
      localUrl: "http://127.0.0.1:9191",
      raw: { runtimeClaim: "claim-1" },
    },
    logs: ["runtime-only"],
    ...overrides,
  };
}

test("durable session repository round-trips exactly the frozen six fields", () => {
  const { native, database } = databaseHarness();
  const repository = new SqliteDurableSessionRepository(database);
  repository.replace([DURABLE]);
  assert.deepEqual(repository.list(), [DURABLE]);
  assert.deepEqual(repository.get(DURABLE.id), DURABLE);

  const columns = native.prepare("PRAGMA table_info(session_records)").all().map((row) => row.name);
  assert.deepEqual(columns, ["id", "token", "project", "scheme", "simulator_udid", "created_at"]);
  native.close();
});

test("mixed legacy record projects to durable-only SQLite data", () => {
  const { native, database } = databaseHarness();
  const repository = new SqliteDurableSessionRepository(database);
  const projected = parseLegacyDurableSessions(JSON.stringify({ sessions: [mixedLegacy()] }));
  repository.replace(projected);

  assert.deepEqual(repository.list(), [DURABLE]);
  const row = native.prepare("SELECT * FROM session_records").get();
  assert.equal(Object.keys(row).length, 6);
  for (const forbidden of [
    "revision",
    "updated_at",
    "stream",
    "build",
    "logs",
    "orientation",
    "remoteBaseUrl",
    "pid",
    "port",
    "record_json",
    "stream_state",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, forbidden), false, forbidden);
  }
  native.close();
});

test("runtime-only legacy mutations do not create durable shadow mismatches", () => {
  const baseline = mixedLegacy();
  const runtimeChanged = mixedLegacy({
    revision: 999,
    updatedAt: "2026-08-14T12:00:00.000Z",
    remoteBaseUrl: "https://different.invalid",
    orientation: "portrait",
    build: { state: "failed" },
    stream: {
      state: "stopped",
      pid: 7777,
      port: 3333,
      raw: { runtimeClaim: "claim-2" },
    },
    logs: ["changed", "again"],
  });

  assert.deepEqual(compareDurableSessionShadow(baseline, DURABLE), {
    matched: true,
    mismatch: null,
  });
  assert.deepEqual(compareDurableSessionShadow(runtimeChanged, DURABLE), {
    matched: true,
    mismatch: null,
  });
});

test("durable field changes produce a stable mismatch", () => {
  const result = compareDurableSessionShadow(mixedLegacy({ scheme: "Other" }), DURABLE);
  assert.equal(result.matched, false);
  assert.match(result.mismatch.mismatchID, /^[a-f0-9]{64}$/);
  assert.notEqual(result.mismatch.legacyProjectionHash, result.mismatch.sqliteProjectionHash);
});

test("malformed durable repository input fails before replacing existing state", () => {
  const { native, database } = databaseHarness();
  const repository = new SqliteDurableSessionRepository(database);
  repository.replace([DURABLE]);
  assert.throws(
    () => repository.replace([{ ...DURABLE, stream: { state: "running" } }]),
    /outside the frozen boundary/,
  );
  assert.throws(() => repository.replace([{ ...DURABLE, token: "" }]), /session token/);
  assert.deepEqual(repository.list(), [DURABLE]);
  native.close();
});

test("repeated legacy import and restart are idempotent", () => {
  const { native, database } = databaseHarness();
  const repository = new SqliteDurableSessionRepository(database);
  const checkpointState = new Map();
  const checkpointRepository = {
    get(source) {
      return checkpointState.get(source) || null;
    },
    upsert(record) {
      checkpointState.set(record.source, structuredClone(record));
    },
  };
  let now = "2026-08-14T12:00:00.000Z";
  const clock = {
    now() {
      return new Date(now);
    },
  };
  const projectionHash = durableSessionProjectionHash([DURABLE]);
  const locked = {
    snapshot: [DURABLE],
    sourceRevision: "a".repeat(64),
    projectionHash,
    recordCount: 1,
    backups: ["/tmp/session-backup"],
  };

  const first = new SessionLegacyImportApplier({
    sessionRepository: repository,
    checkpointRepository,
    clock,
  });
  assert.equal(first.apply(locked).status, "applied");
  now = "2026-08-14T12:01:00.000Z";
  const restarted = new SessionLegacyImportApplier({
    sessionRepository: repository,
    checkpointRepository,
    clock,
  });
  assert.equal(restarted.apply(locked).status, "already-current");
  assert.deepEqual(repository.list(), [DURABLE]);
  assert.equal(native.prepare("SELECT COUNT(*) AS count FROM session_records").get().count, 1);
  native.close();
});

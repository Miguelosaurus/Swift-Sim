import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SqlitePhase4AuthorityRepository } from "../mac-helper/src/persistence/sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const PREPARATION_ID = "a".repeat(64);
const EVIDENCE_HASH = "b".repeat(64);
const EVIDENCE_JSON = JSON.stringify({ candidateSHA: "c".repeat(40) });
const PREPARED_AT = "2026-08-15T00:00:00.000Z";
const CUTOVER_AT = "2026-08-15T01:00:00.000Z";
const EXPIRES_AT = "2026-08-15T02:00:00.000Z";
const FINALIZED_AT = "2026-08-15T03:00:00.000Z";

function withDatabase(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-adversarial-"));
  const databasePath = join(directory, "state.sqlite");
  try {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    return operation({ database, databasePath });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** @param {SwiftSimSqliteDatabase} database */
function forceInsert(database, row) {
  database.exec("PRAGMA ignore_check_constraints = ON");
  database.prepare("DELETE FROM phase4_authority_state").run();
  database
    .prepare(
      `INSERT INTO phase4_authority_state(
      singleton, storage_version, mode, revision, cutover_epoch,
      preparation_id, evidence_hash, evidence_json, prepared_at,
      cutover_at, rollback_expires_at, finalized_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      1,
      1,
      row.mode,
      row.revision ?? 0,
      row.cutoverEpoch ?? 0,
      row.preparationID ?? null,
      row.evidenceHash ?? null,
      row.evidenceJSON ?? null,
      row.preparedAt ?? null,
      row.cutoverAt ?? null,
      row.rollbackExpiresAt ?? null,
      row.finalizedAt ?? null,
      row.updatedAt ?? "2026-08-15T00:00:00.000Z",
    );
}

function sqliteAuthoritativeRow(overrides = {}) {
  return {
    mode: "sqlite-rollback",
    cutoverEpoch: 1,
    preparationID: PREPARATION_ID,
    evidenceHash: EVIDENCE_HASH,
    evidenceJSON: EVIDENCE_JSON,
    preparedAt: PREPARED_AT,
    cutoverAt: CUTOVER_AT,
    rollbackExpiresAt: EXPIRES_AT,
    ...overrides,
  };
}

test("durable v9 schema rejects impossible mode/epoch authority rows", () => {
  withDatabase(({ database }) => {
    const insert = (row) =>
      database
        .prepare(
          `INSERT INTO phase4_authority_state(
          singleton, storage_version, mode, revision, cutover_epoch,
          preparation_id, evidence_hash, evidence_json, prepared_at,
          cutover_at, rollback_expires_at, finalized_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          1,
          1,
          row.mode,
          row.revision ?? 0,
          row.cutoverEpoch ?? 0,
          row.preparationID ?? null,
          row.evidenceHash ?? null,
          row.evidenceJSON ?? null,
          row.preparedAt ?? null,
          row.cutoverAt ?? null,
          row.rollbackExpiresAt ?? null,
          row.finalizedAt ?? null,
          row.updatedAt ?? "2026-08-15T00:00:00.000Z",
        );
    assert.throws(() => insert(sqliteAuthoritativeRow({ cutoverEpoch: 0 })), /CHECK/i);
    assert.throws(
      () =>
        insert({
          mode: "legacy",
          cutoverEpoch: 1,
        }),
      /CHECK/i,
    );
    assert.throws(
      () =>
        insert({
          mode: "preparing",
          cutoverEpoch: 1,
          preparationID: PREPARATION_ID,
          evidenceHash: EVIDENCE_HASH,
          evidenceJSON: EVIDENCE_JSON,
          preparedAt: PREPARED_AT,
        }),
      /CHECK/i,
    );
    const authority = new SqlitePhase4AuthorityRepository(database).getState();
    assert.equal(authority.mode, "legacy");
    assert.equal(authority.cutoverEpoch, 0);
    database.close();
  });
});

test("repository parser rejects contradictory mode/epoch rows even if constraints are bypassed", () => {
  withDatabase(({ database }) => {
    forceInsert(database, sqliteAuthoritativeRow({ cutoverEpoch: 0 }));
    assert.throws(
      () => new SqlitePhase4AuthorityRepository(database).getState(),
      /positive cutover epoch/i,
    );
    database.close();
  });
});

test("repository parser rejects contradictory mode/timestamp layouts", () => {
  withDatabase(({ database }) => {
    forceInsert(database, { mode: "legacy", cutoverEpoch: 0, cutoverAt: CUTOVER_AT });
    assert.throws(
      () => new SqlitePhase4AuthorityRepository(database).getState(),
      /legacy authority row contains transition evidence/i,
    );
    database.close();
  });

  withDatabase(({ database }) => {
    forceInsert(database, {
      mode: "preparing",
      cutoverEpoch: 0,
      preparationID: PREPARATION_ID,
      evidenceHash: EVIDENCE_HASH,
      evidenceJSON: EVIDENCE_JSON,
      preparedAt: PREPARED_AT,
      cutoverAt: CUTOVER_AT,
    });
    assert.throws(
      () => new SqlitePhase4AuthorityRepository(database).getState(),
      /invalid transition layout/i,
    );
    database.close();
  });

  withDatabase(({ database }) => {
    forceInsert(database, sqliteAuthoritativeRow({ rollbackExpiresAt: CUTOVER_AT }));
    assert.throws(
      () => new SqlitePhase4AuthorityRepository(database).getState(),
      /invalid rollback layout/i,
    );
    database.close();
  });

  withDatabase(({ database }) => {
    forceInsert(
      database,
      sqliteAuthoritativeRow({
        mode: "sqlite-final",
        finalizedAt: FINALIZED_AT,
      }),
    );
    const state = new SqlitePhase4AuthorityRepository(database).getState();
    assert.equal(state.mode, "sqlite-final");
    assert.equal(state.cutoverEpoch, 1);
    database.close();
  });
});

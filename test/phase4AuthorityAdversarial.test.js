import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Phase4AuthorityRouter } from "../mac-helper/src/persistence/phase4AuthorityRouter.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SqlitePhase4AuthorityRepository } from "../mac-helper/src/persistence/sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const PREPARATION_ID = "a".repeat(64);
const EVIDENCE_JSON = JSON.stringify({ candidateSHA: "c".repeat(40) });
const EVIDENCE_HASH = hashEvidence(EVIDENCE_JSON);
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
      row.storageVersion ?? 1,
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
    updatedAt: CUTOVER_AT,
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
        updatedAt: FINALIZED_AT,
      }),
    );
    const state = new SqlitePhase4AuthorityRepository(database).getState();
    assert.equal(state.mode, "sqlite-final");
    assert.equal(state.cutoverEpoch, 1);
    database.close();
  });
});

function hashEvidence(value) {
  return createHash("sha256").update(value).digest("hex");
}

function preparingRow(overrides = {}) {
  return sqliteAuthoritativeRow({
    mode: "preparing",
    cutoverEpoch: 0,
    cutoverAt: null,
    rollbackExpiresAt: null,
    updatedAt: PREPARED_AT,
    ...overrides,
  });
}

test("repository parser accepts canonical rows in every representable authority mode", () => {
  withDatabase(({ database }) => {
    for (const row of [
      { mode: "legacy", cutoverEpoch: 0 },
      preparingRow(),
      sqliteAuthoritativeRow(),
      sqliteAuthoritativeRow({ mode: "rollback-preparing" }),
      sqliteAuthoritativeRow({
        mode: "sqlite-final",
        finalizedAt: FINALIZED_AT,
        updatedAt: FINALIZED_AT,
      }),
    ]) {
      forceInsert(database, row);
      assert.equal(new SqlitePhase4AuthorityRepository(database).getState().mode, row.mode);
    }
    database.close();
  });
});

test("repository parser rejects each partial legacy transition field under CHECK bypass", () => {
  withDatabase(({ database }) => {
    for (const [field, value] of Object.entries({
      preparationID: PREPARATION_ID,
      evidenceHash: EVIDENCE_HASH,
      evidenceJSON: EVIDENCE_JSON,
      preparedAt: PREPARED_AT,
      cutoverAt: CUTOVER_AT,
      rollbackExpiresAt: EXPIRES_AT,
      finalizedAt: FINALIZED_AT,
    })) {
      forceInsert(database, { mode: "legacy", [field]: value });
      assert.throws(
        () => new SqlitePhase4AuthorityRepository(database).getState(),
        /legacy authority row contains transition evidence/i,
        field,
      );
    }
    database.close();
  });
});

test("repository parser requires every preparation field and mode-specific transition layout", () => {
  withDatabase(({ database }) => {
    const modes = ["preparing", "sqlite-rollback", "rollback-preparing", "sqlite-final"];
    for (const mode of modes) {
      const row =
        mode === "preparing"
          ? preparingRow()
          : sqliteAuthoritativeRow({
              mode,
              ...(mode === "sqlite-final"
                ? { finalizedAt: FINALIZED_AT, updatedAt: FINALIZED_AT }
                : {}),
            });
      const requiredFields = ["preparationID", "evidenceHash", "evidenceJSON", "preparedAt"];
      if (mode !== "preparing") requiredFields.push("cutoverAt", "rollbackExpiresAt");
      if (mode === "sqlite-final") requiredFields.push("finalizedAt");
      for (const field of requiredFields) {
        forceInsert(database, { ...row, [field]: null });
        assert.throws(
          () => new SqlitePhase4AuthorityRepository(database).getState(),
          /invalid .*layout/i,
          `${mode}: ${field}`,
        );
      }
    }
    for (const [field, value] of Object.entries({
      cutoverAt: CUTOVER_AT,
      rollbackExpiresAt: EXPIRES_AT,
      finalizedAt: FINALIZED_AT,
    })) {
      forceInsert(database, preparingRow({ [field]: value }));
      assert.throws(
        () => new SqlitePhase4AuthorityRepository(database).getState(),
        /invalid transition layout/i,
        field,
      );
    }
    for (const mode of ["sqlite-rollback", "rollback-preparing"]) {
      forceInsert(database, sqliteAuthoritativeRow({ mode, finalizedAt: FINALIZED_AT }));
      assert.throws(
        () => new SqlitePhase4AuthorityRepository(database).getState(),
        /invalid rollback layout/i,
        mode,
      );
    }
    database.close();
  });
});

test("repository parser requires the exact storage version and canonical digest syntax", () => {
  withDatabase(({ database }) => {
    for (const storageVersion of [0, 2, -1]) {
      forceInsert(database, { mode: "legacy", storageVersion });
      assert.throws(
        () => new SqlitePhase4AuthorityRepository(database).getState(),
        /storage version must be exactly 1/i,
      );
    }
    for (const field of ["preparationID", "evidenceHash"]) {
      for (const value of [
        "",
        "a".repeat(63),
        "a".repeat(65),
        "A".repeat(64),
        "g".repeat(64),
        `${"a".repeat(64)}\n`,
      ]) {
        forceInsert(database, preparingRow({ [field]: value }));
        assert.throws(
          () => new SqlitePhase4AuthorityRepository(database).getState(),
          /lowercase SHA-256 digest/i,
          field,
        );
      }
    }
    database.close();
  });
});

test("repository parser binds canonical evidence bytes to the persisted digest", () => {
  withDatabase(({ database }) => {
    for (const evidenceJSON of ["{", '{"candidateSHA":"changed"}']) {
      forceInsert(database, preparingRow({ evidenceJSON }));
      assert.throws(
        () => new SqlitePhase4AuthorityRepository(database).getState(),
        /evidence.*(malformed|hash)/i,
      );
    }
    for (const evidenceJSON of [
      '{ "candidateSHA": "c" }',
      '{"z":1,"a":2}',
      '{"a":1,"a":2}',
      "1e1000",
    ]) {
      forceInsert(
        database,
        preparingRow({ evidenceJSON, evidenceHash: hashEvidence(evidenceJSON) }),
      );
      assert.throws(
        () => new SqlitePhase4AuthorityRepository(database).getState(),
        /canonical SHA-256 hash/i,
      );
    }
    const evidenceJSON = '{"a":[null,{"b":false,"c":1}],"z":"last"}';
    forceInsert(database, preparingRow({ evidenceJSON, evidenceHash: hashEvidence(evidenceJSON) }));
    assert.deepEqual(
      new SqlitePhase4AuthorityRepository(database).getState().evidence,
      JSON.parse(evidenceJSON),
    );
    database.close();
  });
});

test("repository parser strictly validates every timestamp before comparing its ordering", () => {
  withDatabase(({ database }) => {
    for (const field of [
      "preparedAt",
      "cutoverAt",
      "rollbackExpiresAt",
      "finalizedAt",
      "updatedAt",
    ]) {
      for (const value of [
        "",
        "not-a-date",
        "2026-02-30T00:00:00.000Z",
        "2026-08-15",
        "2026-08-15T01:00:00Z",
        "2026-08-15T01:00:00.000+00:00",
        "2026-08-15T25:00:00.000Z",
      ]) {
        forceInsert(
          database,
          sqliteAuthoritativeRow({
            mode: "sqlite-final",
            finalizedAt: FINALIZED_AT,
            updatedAt: FINALIZED_AT,
            [field]: value,
          }),
        );
        assert.throws(
          () => new SqlitePhase4AuthorityRepository(database).getState(),
          /timestamp/i,
          `${field}: ${value}`,
        );
      }
    }
    database.close();
  });
});

test("repository parser rejects impossible canonical timestamp ordering", () => {
  withDatabase(({ database }) => {
    for (const row of [
      preparingRow({ updatedAt: "2026-08-14T23:59:59.999Z" }),
      sqliteAuthoritativeRow({ preparedAt: EXPIRES_AT, updatedAt: EXPIRES_AT }),
      sqliteAuthoritativeRow({ updatedAt: PREPARED_AT }),
      sqliteAuthoritativeRow({ updatedAt: EXPIRES_AT }),
      sqliteAuthoritativeRow({ rollbackExpiresAt: CUTOVER_AT }),
      sqliteAuthoritativeRow({
        mode: "sqlite-final",
        finalizedAt: CUTOVER_AT,
        updatedAt: FINALIZED_AT,
      }),
      sqliteAuthoritativeRow({
        mode: "sqlite-final",
        finalizedAt: FINALIZED_AT,
        updatedAt: EXPIRES_AT,
      }),
    ]) {
      forceInsert(database, row);
      assert.throws(
        () => new SqlitePhase4AuthorityRepository(database).getState(),
        /precedes preparation|invalid .*layout/i,
      );
    }
    database.close();
  });
});

test("corrupted authority blocks reads and writes before either backend is selected", () => {
  withDatabase(({ database }) => {
    const router = new Phase4AuthorityRouter(new SqlitePhase4AuthorityRepository(database));
    let calls = 0;
    const backends = { legacy: () => ++calls, sqlite: () => ++calls };
    for (const row of [
      { mode: "legacy", preparationID: PREPARATION_ID },
      preparingRow({ evidenceHash: "b".repeat(64) }),
      sqliteAuthoritativeRow({ rollbackExpiresAt: "not-a-date" }),
    ]) {
      forceInsert(database, row);
      assert.throws(() => router.read(backends));
      assert.throws(() => router.write(backends));
      assert.equal(calls, 0);
    }
    database.close();
  });
});

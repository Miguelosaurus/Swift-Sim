import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

function withTempDirectory(operation) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-phase4-integration-"));
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    return operation(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Phase-4 global SQLite history appends global authority as v9 without changing v1-v8", () => {
  assert.equal(PHASE4_SQLITE_MIGRATIONS.length, 9);
  for (let index = 0; index < DEVICE_BUILD_SQLITE_MIGRATIONS.length; index += 1) {
    assert.strictEqual(PHASE4_SQLITE_MIGRATIONS[index], DEVICE_BUILD_SQLITE_MIGRATIONS[index]);
  }
  assert.deepEqual(
    PHASE4_SQLITE_MIGRATIONS.map(({ version, name }) => ({ version, name })),
    [
      { version: 1, name: "legacy_import_checkpoints" },
      { version: 2, name: "pairing_state" },
      { version: 3, name: "pairing_shadow_mismatch_evidence" },
      { version: 4, name: "pairing_authority_state" },
      { version: 5, name: "pairing_cutover_preparation" },
      { version: 6, name: "device_build_domain_state" },
      { version: 7, name: "device_build_shadow_mismatch_evidence" },
      { version: 8, name: "durable_session_domain_state" },
      { version: 9, name: "phase4_global_authority_epoch" },
    ],
  );
});

test("schema v7 upgrades through frozen v8 to v9, preserves six session columns, and reopens", () => {
  withTempDirectory((root) => {
    const databasePath = join(root, "state.sqlite");
    const v7 = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
    });
    assert.equal(v7.health().schemaVersion, 7);
    v7.close();

    const upgraded = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    assert.equal(upgraded.health().schemaVersion, 9);
    const sessionColumns = upgraded
      .prepare("PRAGMA table_info(session_records)")
      .all()
      .map((row) => String(row.name));
    assert.deepEqual(sessionColumns, [
      "id",
      "token",
      "project",
      "scheme",
      "simulator_udid",
      "created_at",
    ]);
    const authorityColumns = upgraded
      .prepare("PRAGMA table_info(phase4_authority_state)")
      .all()
      .map((row) => String(row.name));
    assert.deepEqual(authorityColumns, [
      "singleton",
      "storage_version",
      "mode",
      "revision",
      "cutover_epoch",
      "preparation_id",
      "evidence_hash",
      "evidence_json",
      "prepared_at",
      "cutover_at",
      "rollback_expires_at",
      "finalized_at",
      "updated_at",
    ]);
    assert.equal(
      upgraded.prepare("SELECT mode FROM phase4_authority_state WHERE singleton = 1").get().mode,
      "legacy",
    );
    upgraded.close();

    const reopened = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    assert.equal(reopened.health().ok, true);
    assert.equal(reopened.health().schemaVersion, 9);
    reopened.close();
  });
});


import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  observePhase4AuthorityState,
  observePhase4ShadowMismatches,
} from "../mac-helper/src/persistence/phase4MaintenanceEvidence.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

function withDatabase(version, operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-observation-"));
  const databasePath = join(directory, "state.sqlite");
  const owner = new SwiftSimSqliteDatabase({
    path: databasePath,
    migrations: PHASE4_SQLITE_MIGRATIONS.slice(0, version),
  });
  owner.close();
  try {
    return operation(databasePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("shadow observation query failure blocks instead of becoming zero mismatches", () => {
  withDatabase(8, (databasePath) => {
    const mutator = new DatabaseSync(databasePath);
    try {
      mutator.exec(
        "ALTER TABLE device_build_shadow_mismatches RENAME TO device_build_shadow_mismatches_unreadable",
      );
    } finally {
      mutator.close();
    }

    assert.throws(
      () => observePhase4ShadowMismatches(databasePath),
      /device_build_shadow_mismatches|no such table/i,
    );

    const readOnly = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(
        Number(readOnly.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version),
        8,
      );
    } finally {
      readOnly.close();
    }
  });
});

test("v9 authority observation query failure blocks instead of becoming benign authority", () => {
  withDatabase(9, (databasePath) => {
    const mutator = new DatabaseSync(databasePath);
    try {
      mutator.exec("ALTER TABLE phase4_authority_state RENAME TO phase4_authority_state_unreadable");
    } finally {
      mutator.close();
    }

    assert.throws(
      () => observePhase4AuthorityState(databasePath, 9),
      /phase4_authority_state|no such table/i,
    );

    const readOnly = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(
        Number(readOnly.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version),
        9,
      );
    } finally {
      readOnly.close();
    }
  });
});

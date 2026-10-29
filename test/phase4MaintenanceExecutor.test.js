import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readStateBytes } from "./fixtures/state-bytes.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const CLIENT = new URL("../mac-helper/bin/swift-sim-phase4-cutover.js", import.meta.url);

function withRoot(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-cutover-executor-"));
  const stateRoot = join(directory, ".swift-sim");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  try {
    return operation({ directory, stateRoot, databasePath: join(stateRoot, "state.sqlite") });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("maintenance status is read-only and never creates the database", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const result = spawnSync(
      process.execPath,
      [CLIENT.pathname, "status", "--state-root", stateRoot],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.readOnly, true);
    assert.equal(report.mutationAllowed, false);
    assert.equal(report.transitionState, "not-migrated");
    assert.equal(report.latestSchemaVersion, 9);
    assert.equal(existsSync(databasePath), false);
  });
});

test("maintenance status reports the durable authority without mutating SQLite bytes", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    database.close();
    chmodSync(databasePath, 0o600);
    const before = readStateBytes(databasePath);
    const result = spawnSync(
      process.execPath,
      [CLIENT.pathname, "status", "--state-root", stateRoot],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.readOnly, true);
    assert.equal(report.mutationAllowed, false);
    assert.equal(report.authority, "legacy");
    assert.equal(report.schemaVersion, 9);
    assert.deepEqual(readStateBytes(databasePath), before);
  });
});

test("maintenance executor rejects unknown actions and missing explicit state roots", () => {
  withRoot(({ stateRoot }) => {
    const unknown = spawnSync(process.execPath, [CLIENT.pathname, "finalize"], {
      encoding: "utf8",
    });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Usage|finalize/i);

    const missingRoot = spawnSync(process.execPath, [CLIENT.pathname, "status"], {
      encoding: "utf8",
    });
    assert.notEqual(missingRoot.status, 0);
    assert.match(missingRoot.stderr, /--state-root/);
    assert.equal(existsSync(join(stateRoot, "state.sqlite")), false);
  });
});

test("maintenance executor rejects finalization and deletion without changing durable state", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    database.close();
    chmodSync(databasePath, 0o600);
    const before = readStateBytes(databasePath);
    const legacyPath = join(stateRoot, "sessions.json");
    writeFileSync(legacyPath, '{"sessions":[]}\n', { mode: 0o600 });
    const legacyBefore = readStateBytes(legacyPath);
    for (const action of ["finalize", "expire", "delete-legacy"]) {
      const result = spawnSync(
        process.execPath,
        [CLIENT.pathname, action, "--state-root", stateRoot],
        { encoding: "utf8", timeout: 10_000 },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Usage: swift-sim-phase4-cutover/);
      assert.equal(result.stdout, "");
      assert.deepEqual(readStateBytes(databasePath), before);
      assert.deepEqual(readStateBytes(legacyPath), legacyBefore);
    }
    const status = spawnSync(
      process.execPath,
      [CLIENT.pathname, "status", "--state-root", stateRoot],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).authority, "legacy");
  });
});

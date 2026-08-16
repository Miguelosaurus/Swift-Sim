import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
    const before = readFileSync(databasePath);
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
    assert.deepEqual(readFileSync(databasePath), before);
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

test("maintenance executor never exposes a finalize action", () => {
  const source = readFileSync(
    new URL("../mac-helper/bin/swift-sim-phase4-cutover.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /"finalize"/);
  assert.doesNotMatch(source, /finalizeSqlite|finalizePreparation/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync as readBytes,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPhase4OperatorDiagnostics } from "../mac-helper/src/commands/phase4OperatorDiagnostics.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const artifactAudit = Object.freeze({
  readOnly: true,
  cleanupEnabled: false,
  measurementComplete: true,
  totalKiB: 64,
  reclaimableKiB: 0,
  protectedKiB: 64,
  manualReviewKiB: 0,
  orphanRootCount: 0,
  measurementIssueCount: 0,
});

test("operator diagnostics mark malformed existing legacy authority incompatible without changing it", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-authority-diagnostics-"));
  const stateRoot = join(directory, ".swift-sim");
  const databasePath = join(stateRoot, "state.sqlite");
  const legacyPath = join(stateRoot, "device-builds.json");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);

  createDatabase(databasePath, PHASE4_SQLITE_MIGRATIONS);
  writeFileSync(legacyPath, "{malformed-json\n", { mode: 0o600 });

  const databaseBefore = readBytes(databasePath);
  const legacyBefore = readBytes(legacyPath);
  const umaskBefore = process.umask();
  const fixtureBefore = process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
  const nodeEnvBefore = process.env.NODE_ENV;
  try {
    delete process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
    delete process.env.NODE_ENV;
    const report = collectPhase4OperatorDiagnostics({ stateRoot, artifactAudit });
    assert.equal(report.readOnly, true);
    assert.equal(report.mutationAllowed, false);
    assert.equal(report.authority.mode, "legacy");
    assert.equal(report.compatibility.status, "blocked");
    assert.equal(report.compatibility.state, "incompatible");
    assert.equal(report.compatibility.legacyReadable, false);
    assert.equal(report.compatibility.rollbackReadable, false);
    assert.ok(
      report.recovery.actionCodes.includes("preserve-compatibility-paths-and-review-cutover-state"),
    );
    assert.deepEqual(readBytes(databasePath), databaseBefore);
    assert.deepEqual(readBytes(legacyPath), legacyBefore);
    assert.equal(process.umask(), umaskBefore);
  } finally {
    restoreFixture(fixtureBefore);
    restoreNodeEnv(nodeEnvBefore);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("operator diagnostics report a valid v7 database as migration attention rather than broken", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-v7-diagnostics-"));
  const stateRoot = join(directory, ".swift-sim");
  const databasePath = join(stateRoot, "state.sqlite");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);

  createDatabase(databasePath, DEVICE_BUILD_SQLITE_MIGRATIONS);
  const databaseBefore = readBytes(databasePath);
  const fixtureBefore = process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
  const nodeEnvBefore = process.env.NODE_ENV;
  try {
    delete process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
    delete process.env.NODE_ENV;
    const report = collectPhase4OperatorDiagnostics({ stateRoot, artifactAudit });
    assert.equal(report.database.status, "attention");
    assert.equal(report.database.schemaVersion, 7);
    assert.equal(report.database.latestSchemaVersion, 9);
    assert.equal(report.database.missingTableCount, 3);
    assert.equal(report.migration.status, "healthy");
    assert.equal(report.migration.outcome, "checkpointed");
    assert.equal(report.authority.mode, "legacy");
    assert.equal(report.authority.revision, 0);
    assert.equal(report.compatibility.state, "transitioning");
    assert.ok(
      report.recovery.actionCodes.includes(
        "keep-authority-unchanged-and-resume-supported-migration",
      ),
    );
    assert.equal(
      report.recovery.actionCodes.includes("preserve-state-and-review-database-health"),
      false,
    );
    assert.deepEqual(readBytes(databasePath), databaseBefore);
  } finally {
    restoreFixture(fixtureBefore);
    restoreNodeEnv(nodeEnvBefore);
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDatabase(databasePath, migrations) {
  const previousCreationUmask = process.umask(0o077);
  let database;
  try {
    database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations,
      now: () => "2026-08-14T00:00:00.000Z",
    });
  } finally {
    process.umask(previousCreationUmask);
  }
  database.close();
  chmodSync(databasePath, 0o600);
}

function restoreFixture(previous) {
  if (previous === undefined) {
    delete process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
  } else {
    process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE = previous;
  }
}

function restoreNodeEnv(previous) {
  if (previous === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previous;
  }
}

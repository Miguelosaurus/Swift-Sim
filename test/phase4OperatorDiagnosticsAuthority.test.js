import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPhase4OperatorDiagnostics } from "../mac-helper/src/commands/phase4OperatorDiagnostics.js";
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

  const previousCreationUmask = process.umask(0o077);
  let database;
  try {
    database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
      now: () => "2026-08-14T00:00:00.000Z",
    });
  } finally {
    process.umask(previousCreationUmask);
  }
  database.close();
  chmodSync(databasePath, 0o600);
  writeFileSync(legacyPath, "{malformed-json\n", { mode: 0o600 });

  const databaseBefore = readFileSync(databasePath);
  const legacyBefore = readFileSync(legacyPath);
  const umaskBefore = process.umask();
  const fixtureBefore = process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
  try {
    delete process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
    const report = collectPhase4OperatorDiagnostics({ stateRoot, artifactAudit });
    assert.equal(report.readOnly, true);
    assert.equal(report.mutationAllowed, false);
    assert.equal(report.compatibility.status, "blocked");
    assert.equal(report.compatibility.state, "incompatible");
    assert.equal(report.compatibility.legacyReadable, false);
    assert.equal(report.compatibility.rollbackReadable, false);
    assert.ok(
      report.recovery.actionCodes.includes("preserve-compatibility-paths-and-review-cutover-state"),
    );
    assert.deepEqual(readFileSync(databasePath), databaseBefore);
    assert.deepEqual(readFileSync(legacyPath), legacyBefore);
    assert.equal(process.umask(), umaskBefore);
  } finally {
    if (fixtureBefore === undefined) {
      delete process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
    } else {
      process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE = fixtureBefore;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

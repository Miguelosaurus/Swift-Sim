import assert from "node:assert/strict";
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
import test from "node:test";
import { collectPhase4OperatorDiagnostics } from "../mac-helper/src/commands/phase4OperatorDiagnostics.js";
import { createExtractedHelperServices } from "../mac-helper/src/helperCliRuntime.js";
import { validatePhase4MaintenanceEvidence } from "../mac-helper/src/persistence/phase4CutoverPreflight.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SqlitePairingStateRepository } from "../mac-helper/src/persistence/sqlitePairingStateRepository.js";
import { SqlitePhase4AuthorityRepository } from "../mac-helper/src/persistence/sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const PREPARATION_ID = "c".repeat(64);
const ARTIFACT_AUDIT = Object.freeze({
  readOnly: true,
  cleanupEnabled: false,
  measurementComplete: true,
  totalKiB: 0,
  reclaimableKiB: 0,
  protectedKiB: 0,
  manualReviewKiB: 0,
  orphanRootCount: 0,
  measurementIssueCount: 0,
});

function withRoot(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-routing-"));
  const stateRoot = join(directory, ".swift-sim");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  try {
    return operation({ stateRoot, databasePath: join(stateRoot, "state.sqlite") });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function prepareEvidence(overrides = {}) {
  return {
    exactCandidateSHA: true,
    hostedVerifyGreen: true,
    maintenanceAuthorized: true,
    installedProvenanceVerified: true,
    exactProcessIdentityVerified: true,
    writersQuiesced: true,
    exactDomainLocksAvailable: true,
    privatePermissionsVerified: true,
    liveSourceHashesCaptured: true,
    schemaMigrationsCoherent: true,
    databaseIntegrityWalForeignKeysVerified: true,
    preMigrationDatabaseSnapshotVerified: true,
    legacyBackupsVerified: true,
    migrationReopenIdempotencyVerified: true,
    installedCandidateHelperHealthy: true,
    zeroUnresolvedShadowMismatches: true,
    rollbackReadable: true,
    cleanupDisabledForCutover: true,
    sqliteProcessAuthorityAbsent: true,
    rollbackExecutable: true,
    failClosedAbortClassesVerified: true,
    unrelatedPhaseWorkAbsent: true,
    candidateSHA: "d".repeat(40),
    verifyRunID: 1,
    processIdentity: { pid: 42, startedAt: "Fri Aug 14 13:00:00 2026" },
    shadowMismatchCount: 0,
    ...overrides,
  };
}

test("prepare stop-condition validation rejects unresolved shadow mismatch evidence", () => {
  assert.throws(
    () =>
      validatePhase4MaintenanceEvidence(
        prepareEvidence({
          zeroUnresolvedShadowMismatches: false,
          shadowMismatchCount: 1,
        }),
        "prepare",
      ),
    /zeroUnresolvedShadowMismatches|shadow mismatch/i,
  );
});

test("extracted one-shot pairing command uses global SQLite authority and never writes legacy after activation", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const legacyPath = join(stateRoot, "pairing.json");
    const legacy = {
      token: "legacy-token",
      installationID: "installation-1",
      macName: "Legacy Mac",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    };
    writeFileSync(legacyPath, JSON.stringify(legacy, null, 2), { mode: 0o600 });
    writeFileSync(join(stateRoot, "pairing-invites.json"), "[]\n", { mode: 0o600 });
    const legacyBytes = readBytes(legacyPath, "utf8");

    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    new SqlitePairingStateRepository(database).replace({
      credential: {
        token: "sqlite-token",
        installationID: "installation-1",
        macName: "SQLite Mac",
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
      invitations: [],
    });
    const authority = new SqlitePhase4AuthorityRepository(database);
    const prepared = authority.beginPreparation({
      expectedRevision: 0,
      preparationID: PREPARATION_ID,
      evidence: { oneShotRouting: true },
      now: "2026-08-16T00:01:00.000Z",
    });
    authority.activateSqliteRollback({
      expectedRevision: prepared.revision,
      preparationID: prepared.preparationID,
      evidenceHash: prepared.evidenceHash,
      now: "2026-08-16T00:02:00.000Z",
      rollbackExpiresAt: "2099-08-16T00:02:00.000Z",
    });
    database.close();

    const services = createExtractedHelperServices("pair", {
      stateRoot,
      printQRCode() {},
    });
    const result = services.pair({
      rotate: false,
      qr: false,
      remoteBaseUrl: "",
    });
    assert.equal(result.macName, "SQLite Mac");
    assert.equal(readBytes(legacyPath, "utf8"), legacyBytes);
  });
});

test("rollback-preparing survives reopen, remains SQLite-authoritative, and is visible read-only in accepted diagnostics", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    const authority = new SqlitePhase4AuthorityRepository(database);
    const prepared = authority.beginPreparation({
      expectedRevision: 0,
      preparationID: PREPARATION_ID,
      evidence: { restart: true },
      now: "2026-08-16T00:01:00.000Z",
    });
    const active = authority.activateSqliteRollback({
      expectedRevision: prepared.revision,
      preparationID: prepared.preparationID,
      evidenceHash: prepared.evidenceHash,
      now: "2026-08-16T00:02:00.000Z",
      rollbackExpiresAt: "2099-08-16T00:02:00.000Z",
    });
    const rollbackPreparing = authority.beginRollbackPreparation({
      expectedRevision: active.revision,
      expectedCutoverEpoch: active.cutoverEpoch,
      now: "2026-08-16T00:03:00.000Z",
    });
    assert.equal(rollbackPreparing.mode, "rollback-preparing");
    database.close();

    const reopened = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    assert.equal(
      new SqlitePhase4AuthorityRepository(reopened).getState().mode,
      "rollback-preparing",
    );
    reopened.close();
    chmodSync(databasePath, 0o600);

    const diagnostics = collectPhase4OperatorDiagnostics({
      stateRoot,
      artifactAudit: ARTIFACT_AUDIT,
    });
    assert.equal(diagnostics.readOnly, true);
    assert.equal(diagnostics.redacted, true);
    assert.equal(diagnostics.mutationAllowed, false);
    assert.equal(diagnostics.authority.mode, "rollback-preparing");
    assert.equal(diagnostics.authority.rollbackPreparationActive, true);
    assert.equal(diagnostics.authority.rollbackAvailable, true);
    assert.ok(
      diagnostics.recovery.actionCodes.includes(
        "keep-sqlite-authority-and-resume-current-state-rollback-export",
      ),
    );
  });
});

test("v9 global selector and frozen durable-session table contain no process authority fields", () => {
  withRoot(({ databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    const authorityColumns = database
      .prepare("PRAGMA table_info(phase4_authority_state)")
      .all()
      .map((row) => String(row.name));
    const sessionColumns = database
      .prepare("PRAGMA table_info(session_records)")
      .all()
      .map((row) => String(row.name));
    for (const forbidden of ["pid", "port", "url", "process", "worker", "termination"]) {
      assert.equal(authorityColumns.some((column) => column.includes(forbidden)), false);
      assert.equal(sessionColumns.some((column) => column.includes(forbidden)), false);
    }
    assert.deepEqual(sessionColumns, [
      "id",
      "token",
      "project",
      "scheme",
      "simulator_udid",
      "created_at",
    ]);
    database.close();
  });
});

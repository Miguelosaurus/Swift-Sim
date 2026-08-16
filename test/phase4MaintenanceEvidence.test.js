import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bindPhase4MaintenanceEvidence } from "../mac-helper/src/persistence/phase4MaintenanceEvidence.js";
import { Phase4CutoverPreflightInspector } from "../mac-helper/src/persistence/phase4CutoverPreflightInspector.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const CANDIDATE_SHA = "a".repeat(40);
const CLIENT = new URL("../mac-helper/bin/swift-sim-phase4-cutover.js", import.meta.url);

function startedAt(pid = process.pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
  });
  return String(result.stdout || "").trim();
}

function evidence(overrides = {}) {
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
    candidateSHA: CANDIDATE_SHA,
    verifyRunID: 31848127993,
    processIdentity: { pid: process.pid, startedAt: startedAt() },
    shadowMismatchCount: 0,
    ...overrides,
  };
}

const SPAWN = spawnSync;

function withRoot(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-evidence-"));
  const stateRoot = join(directory, ".swift-sim");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  try {
    return operation({ directory, stateRoot, databasePath: join(stateRoot, "state.sqlite") });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function seedMatchingV9State(stateRoot, databasePath) {
  const database = new SwiftSimSqliteDatabase({
    path: databasePath,
    migrations: PHASE4_SQLITE_MIGRATIONS,
  });
  database.close();
  chmodSync(databasePath, 0o600);
  const backups = join(stateRoot, "migration-backups", "phase4-cutover");
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  copyFileSync(databasePath, join(backups, "state.sqlite"));
  for (const [name, value] of [
    ["pairing", { token: "x", installationID: "i", macName: "m", createdAt: "", updatedAt: "" }],
    ["pairing-invites", []],
    [
      "device-builds",
      {
        version: 6,
        apps: {},
        artifactCleanupJobs: {},
        deliveryReferenceCleanupJobs: {},
        builds: [],
      },
    ],
  ]) {
    writeFileSync(join(backups, `${name}.1.bak`), JSON.stringify(value), { mode: 0o600 });
  }
  writeFileSync(join(stateRoot, "pairing.json"), JSON.stringify({}), { mode: 0o600 });
  writeFileSync(join(stateRoot, "pairing-invites.json"), JSON.stringify([]), { mode: 0o600 });
  writeFileSync(join(stateRoot, "device-builds.json"), JSON.stringify({ version: 6 }), {
    mode: 0o600,
  });
  writeFileSync(join(stateRoot, "sessions.json"), JSON.stringify({ sessions: [] }), {
    mode: 0o600,
  });
}

test("a hand-authored true cannot override a measurable private-permission contradiction", () => {
  withRoot(({ stateRoot }) => {
    chmodSync(stateRoot, 0o755);
    try {
      assert.throws(
        () =>
          bindPhase4MaintenanceEvidence(evidence(), "prepare", {
            stateRoot,
            candidateSHA: CANDIDATE_SHA,
            spawnSync: SPAWN,
          }),
        /contradicts the measured environment/i,
      );
    } finally {
      chmodSync(stateRoot, 0o700);
    }
  });
});

test("a hand-authored true cannot override the measured migration identity", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
    });
    database.close();
    chmodSync(databasePath, 0o600);
    assert.throws(
      () =>
        bindPhase4MaintenanceEvidence(evidence(), "prepare", {
          stateRoot,
          candidateSHA: CANDIDATE_SHA,
          spawnSync: SPAWN,
        }),
      /contradicts the measured environment/i,
    );
  });
});

test("a hand-authored true cannot override a measured process start identity", () => {
  withRoot(({ stateRoot, databasePath }) => {
    seedMatchingV9State(stateRoot, databasePath);
    const wrong = evidence({ processIdentity: { pid: process.pid, startedAt: "wrong start" } });
    assert.throws(
      () =>
        bindPhase4MaintenanceEvidence(wrong, "prepare", {
          stateRoot,
          candidateSHA: CANDIDATE_SHA,
          spawnSync: SPAWN,
        }),
      /processIdentity/i,
    );
  });
});

test("binder accepts evidence that matches independently measured facts", () => {
  withRoot(({ stateRoot, databasePath }) => {
    seedMatchingV9State(stateRoot, databasePath);
    const bound = bindPhase4MaintenanceEvidence(evidence(), "prepare", {
      stateRoot,
      candidateSHA: CANDIDATE_SHA,
      spawnSync: SPAWN,
    });
    assert.equal(bound.measured.schemaMigrationsCoherent, true);
    assert.equal(bound.measured.databaseIntegrityWalForeignKeysVerified, true);
    assert.equal(bound.measured.preMigrationDatabaseSnapshotVerified, true);
    assert.equal(bound.measured.legacyBackupsVerified, true);
    assert.equal(bound.measured.zeroUnresolvedShadowMismatches, true);
  });
});

test("preflight inspection is read-only and never claims a migration-capable open", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
    });
    database.close();
    chmodSync(databasePath, 0o600);
    const before = readFileSync(databasePath);
    const inspector = new Phase4CutoverPreflightInspector({ stateRoot }).inspect();
    assert.equal(inspector.readOnly, true);
    assert.equal(inspector.mutationAllowed, false);
    assert.equal(inspector.includesMigrationCapableOpen, false);
    assert.equal(inspector.schemaVersion, 7);
    assert.deepEqual(readFileSync(databasePath), before);
  });
});

test("mutating actions fail before any migration-capable open when measured facts are false", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
    });
    database.close();
    chmodSync(databasePath, 0o600);
    const before = readFileSync(databasePath);
    const evidenceFile = join(stateRoot, "evidence.json");
    writeFileSync(evidenceFile, JSON.stringify(evidence()), { mode: 0o600 });

    const result = spawnSync(
      process.execPath,
      [
        CLIENT.pathname,
        "prepare",
        "--state-root",
        stateRoot,
        "--evidence-file",
        evidenceFile,
        "--expected-revision",
        "0",
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0, result.stderr);
    assert.match(result.stderr, /contradicts the measured environment/i);
    assert.deepEqual(readFileSync(databasePath), before);
    const schemaVersion = Number(
      new SwiftSimSqliteDatabase({
        path: databasePath,
        migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
      })
        .prepare("SELECT COALESCE(MAX(version), 0) AS value FROM schema_migrations")
        .get()?.value || 0,
    );
    assert.equal(schemaVersion, 7);
  });
});

test("mutating actions require the verified pre-migration snapshot before opening", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    database.close();
    chmodSync(databasePath, 0o600);
    writeFileSync(join(stateRoot, "pairing.json"), JSON.stringify({}), { mode: 0o600 });
    const before = readFileSync(databasePath);
    const evidenceFile = join(stateRoot, "evidence.json");
    writeFileSync(
      evidenceFile,
      JSON.stringify(evidence({ preMigrationDatabaseSnapshotVerified: true })),
      { mode: 0o600 },
    );
    const result = spawnSync(
      process.execPath,
      [
        CLIENT.pathname,
        "prepare",
        "--state-root",
        stateRoot,
        "--evidence-file",
        evidenceFile,
        "--expected-revision",
        "0",
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0, result.stderr);
    assert.match(
      result.stderr,
      /contradicts the measured environment|pre-migration database snapshot is not present/i,
    );
    assert.deepEqual(readFileSync(databasePath), before);
  });
});

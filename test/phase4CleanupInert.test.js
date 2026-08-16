import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectPhase4OperatorDiagnostics } from "../mac-helper/src/commands/phase4OperatorDiagnostics.js";
import { Phase4CutoverCoordinator } from "../mac-helper/src/persistence/phase4CutoverCoordinator.js";
import { createPhase4ProductionStoreFactories } from "../mac-helper/src/persistence/phase4ProductionStores.js";
import { Phase4RollbackCoordinator } from "../mac-helper/src/persistence/phase4RollbackCoordinator.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SqlitePhase4AuthorityRepository } from "../mac-helper/src/persistence/sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const PREPARATION_ID = "a".repeat(64);
const CANDIDATE_SHA = "b".repeat(40);

function evidence() {
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
    finalLockedProjectionEquality: true,
    finalFreshnessRecheck: true,
    atomicAuthorityTransitionReady: true,
    candidateSHA: CANDIDATE_SHA,
    verifyRunID: 31848127993,
    processIdentity: { pid: process.pid, startedAt: "Fri Aug 14 13:00:00 2026" },
    shadowMismatchCount: 0,
  };
}

function fakeSpawnSync(command, args, options) {
  assert.equal(command, "/bin/ps");
  assert.deepEqual(args.slice(-2), ["-o", "lstart="]);
  assert.equal(options.encoding, "utf8");
  return { status: 0, stdout: "Fri Aug 14 13:00:00 2026\n", stderr: "" };
}

function withCleanupRoot(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-cleanup-inert-"));
  const stateRoot = join(directory, ".swift-sim");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const artifactRoot = join(stateRoot, "device-builds", "build-cleanup-1");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(artifactRoot, "sentinel"), "do-not-clean\n", { mode: 0o600 });
  const now = "2026-08-14T10:00:00.000Z";
  writeFileSync(
    join(stateRoot, "pairing.json"),
    JSON.stringify({
      token: "token",
      installationID: "installation-1",
      macName: "Mac",
      createdAt: now,
      updatedAt: now,
    }),
    { mode: 0o600 },
  );
  writeFileSync(join(stateRoot, "pairing-invites.json"), JSON.stringify([]), { mode: 0o600 });
  writeFileSync(
    join(stateRoot, "device-builds.json"),
    JSON.stringify({
      version: 6,
      apps: {},
      artifactCleanupJobs: {
        "cleanup-1": {
          id: "cleanup-1",
          root: artifactRoot,
          buildId: "build-cleanup-1",
          createdAt: "2026-08-14T00:00:00.000Z",
          notBefore: "2026-08-14T00:00:00.000Z",
          nextAttemptAt: "2026-08-14T00:00:00.000Z",
          attempts: 0,
          lastError: "",
        },
      },
      deliveryReferenceCleanupJobs: {
        "delivery-1": {
          id: "delivery-1",
          generation: "g1",
          referenceID: "build:build-cleanup-1",
          createdAt: "2026-08-14T00:00:00.000Z",
          nextAttemptAt: "2026-08-14T00:00:00.000Z",
          attempts: 0,
          lastError: "",
        },
      },
      builds: [],
    }),
    { mode: 0o600 },
  );
  writeFileSync(join(stateRoot, "sessions.json"), JSON.stringify({ sessions: [] }), {
    mode: 0o600,
  });
  const sentinelPath = join(artifactRoot, "sentinel");
  try {
    return operation({
      directory,
      stateRoot,
      sentinelPath,
      artifactRoot,
      assertPreserved() {
        assert.equal(existsSync(sentinelPath), true, "cleanup sentinel was deleted");
        assert.equal(readFileSync(sentinelPath, "utf8"), "do-not-clean\n");
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function legacyCleanupJobCount(stateRoot) {
  const raw = JSON.parse(readFileSync(join(stateRoot, "device-builds.json"), "utf8"));
  return Object.keys(raw.artifactCleanupJobs || {}).length;
}

function activateAndRollback(stores, stateRoot) {
  const coordinator = new Phase4CutoverCoordinator({
    database: stores.database,
    stateRoot,
    spawnSync: fakeSpawnSync,
  });
  coordinator.prepare({
    expectedRevision: 0,
    preparationID: PREPARATION_ID,
    maintenanceEvidence: evidence(),
  });
  const prepared = stores.authorityRepository.getState();
  coordinator.activate({
    expectedRevision: prepared.revision,
    preparationID: prepared.preparationID,
    evidenceHash: prepared.evidenceHash,
    rollbackWindowMs: 60 * 60 * 1000,
    maintenanceEvidence: evidence(),
  });
  const active = stores.authorityRepository.getState();
  new Phase4RollbackCoordinator({
    database: stores.database,
    stateRoot,
    spawnSync: fakeSpawnSync,
  }).run({
    expectedRevision: active.revision,
    expectedCutoverEpoch: active.cutoverEpoch,
    maintenanceEvidence: evidence(),
  });
}

test("helper startup and reopen never drain artifact cleanup", () => {
  withCleanupRoot(({ stateRoot, assertPreserved }) => {
    const stores = createPhase4ProductionStoreFactories({ stateRoot });
    assert.equal(legacyCleanupJobCount(stateRoot), 1);
    assertPreserved();
    stores.createDeviceBuildStore();
    assert.equal(legacyCleanupJobCount(stateRoot), 1);
    assertPreserved();
    stores.database.close();

    const reopened = createPhase4ProductionStoreFactories({ stateRoot });
    reopened.createDeviceBuildStore();
    assert.equal(legacyCleanupJobCount(stateRoot), 1);
    assertPreserved();
    reopened.database.close();
  });
});

test("doctor and maintenance status never drain artifact cleanup", () => {
  withCleanupRoot(({ stateRoot, assertPreserved }) => {
    const stores = createPhase4ProductionStoreFactories({ stateRoot, deviceMaintenance: false });
    collectPhase4OperatorDiagnostics({
      stateRoot,
      artifactAudit: {
        readOnly: true,
        cleanupEnabled: false,
        measurementComplete: true,
        totalKiB: 1,
        reclaimableKiB: 0,
        protectedKiB: 1,
        manualReviewKiB: 0,
        orphanRootCount: 0,
        measurementIssueCount: 0,
      },
    });
    assert.equal(legacyCleanupJobCount(stateRoot), 1);
    assertPreserved();
    stores.database.close();
  });
});

test("prepare, activate, and rollback never drain artifact cleanup", () => {
  withCleanupRoot(({ stateRoot, assertPreserved }) => {
    const stores = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    activateAndRollback(stores, stateRoot);
    assert.equal(legacyCleanupJobCount(stateRoot), 1);
    assertPreserved();

    const reopened = new SwiftSimSqliteDatabase({
      path: join(stateRoot, "state.sqlite"),
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    assert.equal(new SqlitePhase4AuthorityRepository(reopened).getState().mode, "legacy");
    reopened.close();
  });
});

test("SQLite-routed device-build store construction is cleanup-inert", () => {
  withCleanupRoot(({ stateRoot, assertPreserved }) => {
    const stores = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    const coordinator = new Phase4CutoverCoordinator({
      database: stores.database,
      stateRoot,
      spawnSync: fakeSpawnSync,
    });
    coordinator.prepare({
      expectedRevision: 0,
      preparationID: PREPARATION_ID,
      maintenanceEvidence: evidence(),
    });
    const prepared = stores.authorityRepository.getState();
    coordinator.activate({
      expectedRevision: prepared.revision,
      preparationID: prepared.preparationID,
      evidenceHash: prepared.evidenceHash,
      rollbackWindowMs: 60 * 60 * 1000,
      maintenanceEvidence: evidence(),
    });
    stores.createDeviceBuildStore();
    assert.equal(stores.router.current().mode, "sqlite-rollback");
    assertPreserved();
    stores.database.close();
  });
});

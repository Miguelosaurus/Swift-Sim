import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
import { collectPhase4OperatorDiagnostics } from "../mac-helper/src/commands/phase4OperatorDiagnostics.js";
import { Phase4AuthorityRouter } from "../mac-helper/src/persistence/phase4AuthorityRouter.js";
import { Phase4CutoverCoordinator } from "../mac-helper/src/persistence/phase4CutoverCoordinator.js";
import { createPhase4ProductionStoreFactories } from "../mac-helper/src/persistence/phase4ProductionStores.js";
import { Phase4RollbackCoordinator } from "../mac-helper/src/persistence/phase4RollbackCoordinator.js";
import { SqliteDurableSessionMutationRepository } from "../mac-helper/src/persistence/phase4SessionStore.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SqlitePhase4AuthorityRepository } from "../mac-helper/src/persistence/sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const PREPARATION_ID = "a".repeat(64);
const CANDIDATE_SHA = "b".repeat(40);
const ARTIFACT_AUDIT = Object.freeze({
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

function withRoot(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-cutover-"));
  const stateRoot = join(directory, ".swift-sim");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  try {
    return operation({ directory, stateRoot, databasePath: join(stateRoot, "state.sqlite") });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function fakeSpawnSync(command, args, options) {
  assert.equal(command, "/bin/ps");
  assert.deepEqual(args.slice(-2), ["-o", "lstart="]);
  assert.equal(options.encoding, "utf8");
  return { status: 0, stdout: "Fri Aug 14 13:00:00 2026\n", stderr: "" };
}

function maintenanceEvidence(overrides = {}) {
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
    rollbackReadable: true,
    cleanupDisabledForCutover: true,
    sqliteProcessAuthorityAbsent: true,
    rollbackExecutable: true,
    failClosedAbortClassesVerified: true,
    unrelatedPhaseWorkAbsent: true,
    finalLockedProjectionEquality: true,
    zeroUnresolvedShadowMismatches: true,
    finalFreshnessRecheck: true,
    atomicAuthorityTransitionReady: true,
    candidateSHA: CANDIDATE_SHA,
    verifyRunID: 31848127993,
    processIdentity: { pid: process.pid, startedAt: "Fri Aug 14 13:00:00 2026" },
    shadowMismatchCount: 0,
    ...overrides,
  };
}

function seedLegacyState(stateRoot, { cleanupRoot } = {}) {
  const now = "2026-08-14T10:00:00.000Z";
  const pairing = {
    token: "legacy-token",
    installationID: "installation-1",
    macName: "Cutover Test Mac",
    createdAt: now,
    updatedAt: now,
  };
  const session = {
    id: "session-1",
    token: "session-token-legacy",
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "SIM-1",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    remoteBaseUrl: "",
    orientation: "portrait",
    build: { state: "external-or-not-run" },
    stream: {
      state: "stopped",
      transport: "serve-sim",
      quality: "fallback",
      localUrl: "",
      previewUrl: "",
      wsUrl: "",
      port: 49152,
      pid: 4242,
      raw: { runtimeOnly: "initial" },
      limitations: [],
    },
    logs: ["initial-runtime"],
  };
  const artifactCleanupJobs = cleanupRoot
    ? {
        "cleanup-1": {
          id: "cleanup-1",
          root: cleanupRoot,
          createdAt: now,
          attempts: 0,
          lastError: "",
        },
      }
    : {};
  writeJSON(join(stateRoot, "pairing.json"), pairing);
  writeJSON(join(stateRoot, "pairing-invites.json"), []);
  writeJSON(join(stateRoot, "device-builds.json"), {
    version: 6,
    apps: {},
    artifactCleanupJobs,
    deliveryReferenceCleanupJobs: {},
    builds: [],
  });
  writeJSON(join(stateRoot, "sessions.json"), { sessions: [session] });
  return { pairing, session };
}

test("v8 reopens through append-only v9 with unchanged v1-v8 migration checksums and legacy default", () => {
  withRoot(({ databasePath }) => {
    const frozenV8 = PHASE4_SQLITE_MIGRATIONS.slice(0, 8);
    const v8 = new SwiftSimSqliteDatabase({ path: databasePath, migrations: frozenV8 });
    const v8Rows = v8
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => ({ ...row }));
    assert.equal(v8Rows.length, 8);
    v8.close();

    const upgraded = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    const allRows = upgraded
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(allRows.slice(0, 8), v8Rows);
    assert.equal(allRows[8].version, 9);
    assert.equal(allRows[8].name, "phase4_global_authority_epoch");
    assert.match(String(allRows[8].checksum), /^[a-f0-9]{64}$/);
    const repository = new SqlitePhase4AuthorityRepository(upgraded);
    const authority = repository.getState();
    assert.equal(authority.mode, "legacy");
    assert.equal(authority.revision, 0);
    assert.equal(authority.cutoverEpoch, 0);
    assert.equal(typeof repository.finalizeSqlite, "undefined");
    upgraded.close();
  });
});

test("global authority prepare is restartable, rollback preparation is durable, window is half-open, and stale epochs fail", () => {
  withRoot(({ databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    const repository = new SqlitePhase4AuthorityRepository(database);
    const prepared = repository.beginPreparation({
      expectedRevision: 0,
      preparationID: PREPARATION_ID,
      evidence: { candidateSHA: CANDIDATE_SHA },
      now: "2026-08-15T00:00:00.000Z",
    });
    assert.equal(prepared.mode, "preparing");
    assert.equal(prepared.revision, 1);
    assert.deepEqual(
      repository.beginPreparation({
        expectedRevision: 1,
        preparationID: PREPARATION_ID,
        evidence: { candidateSHA: CANDIDATE_SHA },
        now: "2026-08-15T00:01:00.000Z",
      }),
      prepared,
    );
    assert.throws(
      () =>
        repository.beginPreparation({
          expectedRevision: 0,
          preparationID: PREPARATION_ID,
          evidence: { candidateSHA: CANDIDATE_SHA },
        }),
      /stale|revision/i,
    );
    const active = repository.activateSqliteRollback({
      expectedRevision: prepared.revision,
      preparationID: PREPARATION_ID,
      evidenceHash: prepared.evidenceHash,
      now: "2026-08-15T01:00:00.000Z",
      rollbackExpiresAt: "2026-08-15T02:00:00.000Z",
    });
    assert.equal(active.mode, "sqlite-rollback");
    assert.equal(active.cutoverEpoch, 1);
    assert.throws(
      () =>
        repository.beginRollbackPreparation({
          expectedRevision: active.revision,
          expectedCutoverEpoch: active.cutoverEpoch,
          now: "2026-08-15T02:00:00.000Z",
        }),
      /expired/i,
    );
    assert.throws(
      () =>
        repository.beginRollbackPreparation({
          expectedRevision: active.revision,
          expectedCutoverEpoch: 0,
          now: "2026-08-15T01:59:59.999Z",
        }),
      /epoch is stale/i,
    );
    const rollbackPreparing = repository.beginRollbackPreparation({
      expectedRevision: active.revision,
      expectedCutoverEpoch: active.cutoverEpoch,
      now: "2026-08-15T01:30:00.000Z",
    });
    assert.equal(rollbackPreparing.mode, "rollback-preparing");
    assert.equal(rollbackPreparing.revision, active.revision + 1);
    const legacy = repository.rollbackToLegacy({
      expectedRevision: rollbackPreparing.revision,
      expectedCutoverEpoch: rollbackPreparing.cutoverEpoch,
      now: "2026-08-15T01:59:59.999Z",
    });
    assert.equal(legacy.mode, "legacy");
    assert.equal(legacy.cutoverEpoch, 1);
    database.close();
  });
});

test("authority router re-reads per operation, calls exactly one backend, and never falls back", () => {
  let mode = "legacy";
  let authorityReads = 0;
  const router = new Phase4AuthorityRouter({
    getState() {
      authorityReads += 1;
      return { mode };
    },
  });
  let legacyReads = 0;
  let sqliteReads = 0;
  assert.equal(
    router.read({
      legacy: () => (++legacyReads, "legacy"),
      sqlite: () => (++sqliteReads, "sqlite"),
    }),
    "legacy",
  );
  mode = "sqlite-rollback";
  assert.equal(
    router.write({
      legacy: () => (++legacyReads, "legacy"),
      sqlite: () => (++sqliteReads, "sqlite"),
    }),
    "sqlite",
  );
  mode = "rollback-preparing";
  assert.equal(
    router.read({
      legacy: () => (++legacyReads, "legacy"),
      sqlite: () => (++sqliteReads, "sqlite"),
    }),
    "sqlite",
  );
  assert.equal(authorityReads, 3);
  assert.equal(legacyReads, 1);
  assert.equal(sqliteReads, 2);
  mode = "legacy";
  assert.throws(
    () =>
      router.read({
        legacy: () => {
          throw new Error("selected legacy failure");
        },
        sqlite: () => {
          sqliteReads += 100;
          return "fallback";
        },
      }),
    /selected legacy failure/,
  );
  assert.equal(sqliteReads, 2);
});

test("serialized prepare survives reopen; stale source blocks activation; cancel leaves legacy authority", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const { pairing } = seedLegacyState(stateRoot);
    let database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    let coordinator = new Phase4CutoverCoordinator({
      database,
      stateRoot,
      spawnSync: fakeSpawnSync,
    });
    const prepared = coordinator.prepare({
      expectedRevision: 0,
      preparationID: PREPARATION_ID,
      maintenanceEvidence: maintenanceEvidence(),
    });
    assert.equal(prepared.authority.mode, "preparing");
    database.close();

    database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    coordinator = new Phase4CutoverCoordinator({
      database,
      stateRoot,
      spawnSync: fakeSpawnSync,
    });
    assert.equal(coordinator.status().authority.mode, "preparing");
    writeJSON(join(stateRoot, "pairing.json"), {
      ...pairing,
      token: "changed-after-prepare",
    });
    assert.throws(
      () =>
        coordinator.activate({
          expectedRevision: prepared.authority.revision,
          preparationID: prepared.authority.preparationID,
          evidenceHash: prepared.authority.evidenceHash,
          rollbackWindowMs: 60 * 60 * 1000,
          maintenanceEvidence: maintenanceEvidence(),
        }),
      /stale pairing source|stale pairing source\/projection/i,
    );
    const cancelled = coordinator.cancelPreparation({
      expectedRevision: prepared.authority.revision,
      preparationID: prepared.authority.preparationID,
    });
    assert.equal(cancelled.authority.mode, "legacy");
    database.close();
  });
});

test("activation is one global switch; post-switch writes are SQLite-only and current-state rollback preserves runtime-only session fields", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const cleanupRoot = join(stateRoot, "artifact-must-survive-cutover");
    mkdirSync(cleanupRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(cleanupRoot, "sentinel"), "do-not-clean\n", { mode: 0o600 });
    const initial = seedLegacyState(stateRoot, { cleanupRoot });
    const pairingPath = join(stateRoot, "pairing.json");
    const devicePath = join(stateRoot, "device-builds.json");
    const sessionPath = join(stateRoot, "sessions.json");
    const pairingBefore = readFileSync(pairingPath, "utf8");
    const deviceBefore = readFileSync(devicePath, "utf8");

    const factories = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    const coordinator = new Phase4CutoverCoordinator({
      database: factories.database,
      stateRoot,
      spawnSync: fakeSpawnSync,
    });
    const prepared = coordinator.prepare({
      expectedRevision: 0,
      preparationID: PREPARATION_ID,
      maintenanceEvidence: maintenanceEvidence(),
    });
    assert.equal(factories.createPairingStore().current().token, initial.pairing.token);
    assert.equal(factories.router.current().mode, "preparing");
    assert.throws(
      () =>
        coordinator.activate({
          expectedRevision: prepared.authority.revision,
          preparationID: prepared.authority.preparationID,
          evidenceHash: prepared.authority.evidenceHash,
          rollbackWindowMs: 60 * 60 * 1000,
          maintenanceEvidence: maintenanceEvidence({ finalLockedProjectionEquality: false }),
        }),
      /finalLockedProjectionEquality/,
    );

    const activated = coordinator.activate({
      expectedRevision: prepared.authority.revision,
      preparationID: prepared.authority.preparationID,
      evidenceHash: prepared.authority.evidenceHash,
      rollbackWindowMs: 60 * 60 * 1000,
      maintenanceEvidence: maintenanceEvidence(),
    });
    assert.equal(activated.authority.mode, "sqlite-rollback");
    assert.equal(activated.authority.cutoverEpoch, 1);
    assert.equal(
      existsSync(join(cleanupRoot, "sentinel")),
      true,
      "cutover must not execute cleanup",
    );

    factories.database.close();
    const restarted = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    assert.equal(restarted.router.current().mode, "sqlite-rollback");
    assert.equal(restarted.createPairingStore().current().token, initial.pairing.token);

    const pairingStore = restarted.createPairingStore();
    const rotated = pairingStore.rotate();
    assert.notEqual(rotated.token, initial.pairing.token);
    assert.equal(
      readFileSync(pairingPath, "utf8"),
      pairingBefore,
      "post-switch pairing must not dual-write legacy JSON",
    );

    const deviceStore = restarted.createDeviceBuildStore();
    const currentBuild = deviceStore.create({ scheme: "RollbackApp" });
    assert.ok(currentBuild.id);
    assert.equal(
      readFileSync(devicePath, "utf8"),
      deviceBefore,
      "post-switch device state must not dual-write legacy JSON",
    );

    const sessionStore = restarted.createSessionStore();
    const runtimeSession = sessionStore.get(initial.session.id);
    assert.ok(runtimeSession);
    runtimeSession.logs.push("runtime-after-cutover");
    runtimeSession.orientation = "landscape";
    runtimeSession.stream.raw = {
      ...(runtimeSession.stream.raw || {}),
      runtimeOnly: "newer",
    };
    runtimeSession.stream.pid = 7777;
    runtimeSession.token = "runtime-file-must-not-win";
    sessionStore.save(runtimeSession);
    const durableRepository = new SqliteDurableSessionMutationRepository(restarted.database);
    durableRepository.upsert({
      id: initial.session.id,
      token: "sqlite-current-token",
      project: "/tmp/NewApp.xcodeproj",
      scheme: "NewApp",
      simulatorUDID: "SIM-NEW",
      createdAt: initial.session.createdAt,
    });
    const projected = sessionStore.get(initial.session.id);
    assert.equal(projected.token, "sqlite-current-token");
    assert.equal(projected.project, "/tmp/NewApp.xcodeproj");
    assert.equal(projected.stream.pid, 7777);
    assert.equal(projected.stream.raw.runtimeOnly, "newer");

    const diagnostics = collectPhase4OperatorDiagnostics({
      stateRoot,
      artifactAudit: ARTIFACT_AUDIT,
    });
    assert.equal(diagnostics.readOnly, true);
    assert.equal(diagnostics.mutationAllowed, false);
    assert.equal(diagnostics.authority.mode, "sqlite-rollback");
    assert.equal(diagnostics.authority.cutoverEpoch, 1);
    assert.equal(diagnostics.authority.rollbackAvailable, true);
    assert.equal(diagnostics.database.latestSchemaVersion, 9);

    const active = restarted.authorityRepository.getState();
    const rolledBack = new Phase4RollbackCoordinator({
      database: restarted.database,
      stateRoot,
      spawnSync: fakeSpawnSync,
    }).run({
      expectedRevision: active.revision,
      expectedCutoverEpoch: active.cutoverEpoch,
      maintenanceEvidence: maintenanceEvidence(),
    });
    assert.equal(rolledBack.authority.mode, "legacy");
    const pairingAfter = JSON.parse(readFileSync(pairingPath, "utf8"));
    assert.equal(
      pairingAfter.token,
      rotated.token,
      "pairing rollback must export current SQLite state",
    );
    const deviceAfter = JSON.parse(readFileSync(devicePath, "utf8"));
    assert.ok(
      deviceAfter.builds.some((build) => build.id === currentBuild.id),
      "device rollback must export current SQLite state",
    );
    const sessionAfter = JSON.parse(readFileSync(sessionPath, "utf8")).sessions[0];
    assert.equal(
      sessionAfter.token,
      "sqlite-current-token",
      "current SQLite durable data must win rollback merge",
    );
    assert.equal(sessionAfter.project, "/tmp/NewApp.xcodeproj");
    assert.equal(
      sessionAfter.stream.pid,
      7777,
      "runtime-only process metadata must survive rollback",
    );
    assert.equal(sessionAfter.stream.raw.runtimeOnly, "newer");
    assert.ok(sessionAfter.logs.includes("runtime-after-cutover"));
    assert.equal(
      existsSync(join(cleanupRoot, "sentinel")),
      true,
      "rollback must not execute cleanup",
    );

    restarted.database.close();
    const reopened = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    const reopenedAuthority = new SqlitePhase4AuthorityRepository(reopened).getState();
    assert.equal(reopenedAuthority.mode, "legacy");
    assert.equal(reopenedAuthority.cutoverEpoch, 1);
    assert.equal(reopened.health().ok, true);
    reopened.close();
  });
});

test("explicit cutover operator status requires a state root and status itself is read-only", () => {
  withRoot(({ stateRoot, databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    database.close();
    const cli = new URL("../mac-helper/bin/swift-sim-phase4-cutover.js", import.meta.url);
    const missingRoot = spawnSync(process.execPath, [cli.pathname, "status"], {
      encoding: "utf8",
    });
    assert.notEqual(missingRoot.status, 0);
    assert.match(missingRoot.stderr, /--state-root/);
    const before = readFileSync(databasePath);
    const status = spawnSync(
      process.execPath,
      [cli.pathname, "status", "--state-root", stateRoot],
      { encoding: "utf8" },
    );
    assert.equal(status.status, 0, status.stderr);
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.authority, "legacy");
    assert.equal(parsed.latestSchemaVersion, 9);
    assert.deepEqual(readFileSync(databasePath), before);
  });
});

function writeJSON(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

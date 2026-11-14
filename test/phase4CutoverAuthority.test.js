import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync as readBytes,
  rmSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectPhase4OperatorDiagnostics } from "../mac-helper/src/commands/phase4OperatorDiagnostics.js";
import { DEVICE_BUILD_CUTOVER_LEGACY_RAW } from "./fixtures/deviceBuildCutoverFixtures.js";
import { migrateToSqliteAutomatically, AUTOMATIC_ROLLBACK_WINDOW_MS } from "../mac-helper/src/persistence/phase4AutomaticMigration.js";
import { Phase4PairingAuthorityBridge } from "../mac-helper/src/persistence/phase4PairingAuthorityBridge.js";
import { Phase4AuthorityRouter } from "../mac-helper/src/persistence/phase4AuthorityRouter.js";
import { Phase4CutoverCoordinator } from "../mac-helper/src/persistence/phase4CutoverCoordinator.js";
import { createPhase4ProductionStoreFactories } from "../mac-helper/src/persistence/phase4ProductionStores.js";
import { SqliteDurableSessionMutationRepository } from "../mac-helper/src/persistence/phase4SessionStore.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SqlitePairingAuthorityRepository } from "../mac-helper/src/persistence/sqlitePairingAuthorityRepository.js";
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
    return operation({ stateRoot, databasePath: join(stateRoot, "state.sqlite") });
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
    ...overrides,
  };
}

function seedLegacyState(stateRoot, cleanupRoot = null) {
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

test("v8 upgrades append-only to v9 with frozen v1-v8 identities and legacy default", () => {
  withRoot(({ databasePath }) => {
    const v8 = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS.slice(0, 8),
    });
    const frozen = v8
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => ({ ...row }));
    v8.close();

    const v9 = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    const current = v9
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(current.slice(0, 8), frozen);
    assert.equal(current[8].version, 9);
    assert.equal(current[8].name, "phase4_global_authority_epoch");
    const authority = new SqlitePhase4AuthorityRepository(v9);
    assert.deepEqual(
      { mode: authority.getState().mode, revision: authority.getState().revision },
      { mode: "legacy", revision: 0 },
    );
    assert.equal(typeof authority.finalizeSqlite, "undefined");
    v9.close();
  });
});

test("authority preparation is restartable and rollback preparation is durable, fenced, and half-open", () => {
  withRoot(({ databasePath }) => {
    const database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    const authority = new SqlitePhase4AuthorityRepository(database);
    const prepared = authority.beginPreparation({
      expectedRevision: 0,
      preparationID: PREPARATION_ID,
      evidence: { candidateSHA: CANDIDATE_SHA },
      now: "2026-08-15T00:00:00.000Z",
    });
    assert.equal(prepared.mode, "preparing");
    assert.deepEqual(
      authority.beginPreparation({
        expectedRevision: prepared.revision,
        preparationID: PREPARATION_ID,
        evidence: { candidateSHA: CANDIDATE_SHA },
        now: "2026-08-15T00:01:00.000Z",
      }),
      prepared,
    );
    const active = authority.activateSqliteRollback({
      expectedRevision: prepared.revision,
      preparationID: prepared.preparationID,
      evidenceHash: prepared.evidenceHash,
      now: "2026-08-15T01:00:00.000Z",
      rollbackExpiresAt: "2026-08-15T02:00:00.000Z",
    });
    assert.throws(
      () =>
        authority.beginRollbackPreparation({
          expectedRevision: active.revision,
          expectedCutoverEpoch: active.cutoverEpoch,
          now: "2026-08-15T02:00:00.000Z",
        }),
      /expired/i,
    );
    assert.throws(
      () =>
        authority.beginRollbackPreparation({
          expectedRevision: active.revision,
          expectedCutoverEpoch: 0,
          now: "2026-08-15T01:30:00.000Z",
        }),
      /epoch is stale/i,
    );
    const rollbackPreparing = authority.beginRollbackPreparation({
      expectedRevision: active.revision,
      expectedCutoverEpoch: active.cutoverEpoch,
      now: "2026-08-15T01:30:00.000Z",
    });
    assert.equal(rollbackPreparing.mode, "rollback-preparing");
    assert.equal(rollbackPreparing.revision, active.revision + 1);
    const restored = authority.rollbackToLegacy({
      expectedRevision: rollbackPreparing.revision,
      expectedCutoverEpoch: rollbackPreparing.cutoverEpoch,
      now: "2026-08-15T01:59:59.999Z",
    });
    assert.equal(restored.mode, "legacy");
    assert.equal(restored.cutoverEpoch, 0);
    assert.equal(restored.revision, rollbackPreparing.revision + 1);
    database.close();
  });
});

test("operation routing rereads authority, selects one backend, and never falls back", () => {
  let mode = "legacy";
  let authorityReads = 0;
  let legacyCalls = 0;
  let sqliteCalls = 0;
  const router = new Phase4AuthorityRouter({
    getState() {
      authorityReads += 1;
      return { mode };
    },
  });
  assert.equal(
    router.read({
      legacy: () => (++legacyCalls, "legacy"),
      sqlite: () => (++sqliteCalls, "sqlite"),
    }),
    "legacy",
  );
  mode = "sqlite-rollback";
  assert.equal(
    router.write({
      legacy: () => (++legacyCalls, "legacy"),
      sqlite: () => (++sqliteCalls, "sqlite"),
    }),
    "sqlite",
  );
  mode = "rollback-preparing";
  assert.equal(
    router.read({
      legacy: () => (++legacyCalls, "legacy"),
      sqlite: () => (++sqliteCalls, "sqlite"),
    }),
    "sqlite",
  );
  mode = "legacy";
  assert.throws(
    () =>
      router.read({
        legacy: () => {
          throw new Error("selected legacy failure");
        },
        sqlite: () => {
          sqliteCalls += 100;
          return "fallback";
        },
      }),
    /selected legacy failure/,
  );
  assert.equal(authorityReads, 4);
  assert.equal(legacyCalls, 1);
  assert.equal(sqliteCalls, 2);
});

function writeJSON(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

test("automatic migration waits for pairing and preserves a credential through cutover", () => {
  withRoot(({ stateRoot }) => {
    assert.deepEqual(migrateToSqliteAutomatically({ stateRoot, spawn: spawnSync }), { status: "waiting" });
    seedLegacyState(stateRoot);
    for (const name of ["pairing-invites.json", "device-builds.json", "sessions.json"]) rmSync(join(stateRoot, name));
    const stores = createPhase4ProductionStoreFactories({ stateRoot, deviceMaintenance: false });
    const before = stores.createPairingStore().current();
    const started = Date.now();
    const result = migrateToSqliteAutomatically({ stateRoot, spawn: fakeSpawnSync });
    assert.equal(result.status, "migrated");
    assert.ok(Math.abs(Date.parse(result.rollbackExpiresAt) - started - AUTOMATIC_ROLLBACK_WINDOW_MS) < 5000);
    assert.equal(stores.router.current().mode, "sqlite-rollback");
    assert.deepEqual(stores.createPairingStore().current(), before);
    const statusPath = join(stateRoot, "storage-migration.json");
    const status = readBytes(statusPath);
    const recorded = JSON.parse(status);
    assert.equal(recorded.rollbackExpiresAt, result.rollbackExpiresAt);
    assert.ok(Date.parse(recorded.migratedAt) >= started);
    assert.equal(statSync(statusPath).mode & 0o077, 0);
    assert.equal(migrateToSqliteAutomatically({ stateRoot, spawn: fakeSpawnSync }).status, "sqlite");
    assert.deepEqual(readBytes(statusPath), status);
    stores.database.close();
  });
});

test("automatic migration preserves populated product reads, source bytes and private backups", () => {
  withRoot(({ stateRoot }) => {
    seedLegacyState(stateRoot);
    const device = JSON.parse(DEVICE_BUILD_CUTOVER_LEGACY_RAW);
    device.apps["app-2"] = { ...device.apps["app-1"] };
    device.builds.push({ ...device.builds[0], id: "legacy-build-2", scheme: "Second", app: { ...device.builds[0].app, identity: "app-2", bundleIdentifier: "com.example.second" } });
    writeJSON(join(stateRoot, "device-builds.json"), device);
    const stores = createPhase4ProductionStoreFactories({ stateRoot, deviceMaintenance: false });
    const pairing = stores.createPairingStore().current();
    const invites = stores.createPairingInviteStore();
    const { invite } = invites.create({ pairing });
    const builds = stores.createDeviceBuildStore();
    const sessions = stores.createSessionStore();
    const snapshot = () => ({
      pairing: stores.createPairingStore().current(),
      status: stores.createPairingStore().status(),
      invite: invites.inspect(invite, pairing),
      builds: builds.list(),
      build: builds.get("legacy-build-1"),
      apps: builds.listApps({ includeArchived: true }),
      sessions: sessions.list(),
    });
    const before = snapshot();
    assert.equal(before.builds.length, 2);
    assert.ok(before.invite);
    assert.equal(before.apps.length, 2);
    assert.equal(before.sessions.length, 1);
    const names = ["pairing.json", "pairing-invites.json", "device-builds.json", "sessions.json"];
    const original = names.map((name) => readBytes(join(stateRoot, name)));
    assert.equal(migrateToSqliteAutomatically({ stateRoot, spawn: fakeSpawnSync }).status, "migrated");
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(names.map((name) => readBytes(join(stateRoot, name))), original);
    const backupRoot = join(stateRoot, "migration-backups");
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      assert.equal(statSync(path).mode & 0o077, 0, path);
      return entry.isDirectory() ? walk(path) : [readBytes(path)];
    });
    const backups = walk(backupRoot);
    for (const bytes of original) assert.ok(backups.some((backup) => backup.equals(bytes)));
    stores.database.close();
  });
});

test("automatic failure clears fences, defers for a day and retries", () => {
  withRoot(({ stateRoot }) => {
    seedLegacyState(stateRoot);
    const path = join(stateRoot, "sessions.json");
    const valid = readBytes(path);
    writeFileSync(path, "{bad json", { mode: 0o600 });
    const start = Date.now();
    const run = (time) => migrateToSqliteAutomatically({ stateRoot, spawn: fakeSpawnSync, now: () => time });
    const failed = run(start);
    assert.equal(failed.status, "legacy");
    const stores = createPhase4ProductionStoreFactories({ stateRoot, deviceMaintenance: false });
    const authority = stores.authorityRepository.getState();
    assert.equal(authority.mode, "legacy");
    assert.equal(new Phase4PairingAuthorityBridge(stores.database).current().mode, "legacy");
    const status = JSON.parse(readBytes(join(stateRoot, "storage-migration.json"), "utf8"));
    assert.equal(status.failedAt, new Date(start).toISOString());
    assert.equal(status.code, failed.code);
    writeFileSync(path, valid);
    assert.equal(run(start + 86_400_000 - 1).status, "deferred");
    assert.deepEqual(stores.authorityRepository.getState(), authority);
    assert.equal(run(start + 86_400_000).status, "migrated");
    stores.database.close();
  });
});

test("automatic migration recovers interrupted preparation", () => {
  withRoot(({ stateRoot }) => {
    seedLegacyState(stateRoot);
    const stores = createPhase4ProductionStoreFactories({ stateRoot, deviceMaintenance: false });
    new SqlitePairingAuthorityRepository(stores.database).prepareSqlite({ expectedRevision: 0, preparationID: PREPARATION_ID });
    stores.authorityRepository.beginPreparation({ expectedRevision: 0, preparationID: PREPARATION_ID, evidence: { version: 1 } });
    assert.equal(stores.router.current().mode, "preparing");
    assert.equal(migrateToSqliteAutomatically({ stateRoot, spawn: fakeSpawnSync }).status, "migrated");
    stores.database.close();
  });
});

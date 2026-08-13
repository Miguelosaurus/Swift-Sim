import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  DeviceBuildStateRepository,
  DeviceBuildStateSnapshot,
} from "../mac-helper/src/contracts/deviceBuildRepository.js";
import type {
  LegacyImportCheckpoint,
  LegacyImportCheckpointRepository,
} from "../mac-helper/src/contracts/repository.js";
import type {
  Clock,
  LockLease,
  LockManager,
  LockRequest,
} from "../mac-helper/src/infrastructure/ports.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { BUILD_STATE_VERSION } from "../mac-helper/src/deviceBuildStoreCore.js";
import {
  DeviceBuildLegacyImportApplier,
  DeviceBuildLegacyImportCoordinator,
} from "../mac-helper/src/persistence/deviceBuildLegacyImport.js";
import {
  deviceBuildProjectionHash,
  parseDeviceBuildLegacySnapshot,
} from "../mac-helper/src/persistence/deviceBuildLockedLegacySnapshot.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import { SqliteDeviceBuildStateRepository } from "../mac-helper/src/persistence/sqliteDeviceBuildStateRepository.js";
import { SqliteLegacyImportCheckpointRepository } from "../mac-helper/src/persistence/sqliteLegacyImportCheckpointRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";
import { v061DeviceBuildFixture } from "./fixtures/upgrade-evidence/v0.6.1/fixtures.js";

const IMPORTED_AT = "2026-08-11T10:30:00.000Z";
const CHECKPOINT_SOURCE = "device-build-state-v1";

const clock: Clock = {
  now: () => new Date(IMPORTED_AT),
  monotonicMilliseconds: () => 0,
  async sleep() {},
};

class RecordingLockManager implements LockManager {
  held = false;
  requests: LockRequest[] = [];

  private lease(request: LockRequest): LockLease {
    return {
      path: request.path,
      ownerPath: join(request.path, "owner.json"),
      ownerNonce: "device-build-import-test",
      async release() {},
      releaseSync() {},
    };
  }

  async acquire(_request: LockRequest): Promise<LockLease> {
    throw new Error("Direct acquire is not used by the import test lock manager.");
  }

  acquireSync(_request: LockRequest): LockLease {
    throw new Error("Direct acquireSync is not used by the import test lock manager.");
  }

  async withLock<T>(request: LockRequest, operation: (lease: LockLease) => Promise<T>): Promise<T> {
    this.requests.push(structuredClone(request));
    this.held = true;
    try {
      return await operation(this.lease(request));
    } finally {
      this.held = false;
    }
  }

  withLockSync<T>(request: LockRequest, operation: (lease: LockLease) => T): T {
    this.requests.push(structuredClone(request));
    this.held = true;
    try {
      return operation(this.lease(request));
    } finally {
      this.held = false;
    }
  }
}

interface Harness {
  root: string;
  sourcePath: string;
  backupDirectory: string;
  lockRequest: LockRequest;
  fileStore: NodeAtomicFileStore;
  lockManager: RecordingLockManager;
  database: SwiftSimSqliteDatabase;
  repository: SqliteDeviceBuildStateRepository;
  checkpointRepository: SqliteLegacyImportCheckpointRepository;
  coordinator(checkpoints?: LegacyImportCheckpointRepository): DeviceBuildLegacyImportCoordinator;
}

function createHarness(t: TestContext): Harness {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-device-build-import-"));
  const sourcePath = join(root, "device-builds.json");
  const backupDirectory = join(root, "backups");
  const lockRequest: LockRequest = {
    path: `${sourcePath}.lock`,
    waitMs: 0,
    staleAfterMs: 60_000,
    ownerMode: 0o600,
  };
  const fileStore = new NodeAtomicFileStore();
  const lockManager = new RecordingLockManager();
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "swift-sim.sqlite"),
    migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
  });
  const repository = new SqliteDeviceBuildStateRepository(database);
  const checkpointRepository = new SqliteLegacyImportCheckpointRepository(database);

  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });

  return {
    root,
    sourcePath,
    backupDirectory,
    lockRequest,
    fileStore,
    lockManager,
    database,
    repository,
    checkpointRepository,
    coordinator(checkpoints = checkpointRepository) {
      return new DeviceBuildLegacyImportCoordinator({
        deviceBuildRepository: lockCheckedDeviceBuildRepository(repository, lockManager),
        checkpointRepository: lockCheckedCheckpointRepository(checkpoints, lockManager),
        fileStore,
        lockManager,
        source: {
          name: "device-builds.json",
          path: sourcePath,
          lockRequest,
        },
        backupDirectory,
        checkpointSource: CHECKPOINT_SOURCE,
        clock,
      });
    },
  };
}

function lockCheckedDeviceBuildRepository(
  repository: DeviceBuildStateRepository,
  lockManager: RecordingLockManager,
): DeviceBuildStateRepository {
  return {
    read() {
      assert.equal(lockManager.held, true, "device-build repository read escaped source lock");
      return repository.read();
    },
    getBuild(id) {
      assert.equal(lockManager.held, true, "device-build repository get escaped source lock");
      return repository.getBuild(id);
    },
    replace(snapshot) {
      assert.equal(lockManager.held, true, "device-build repository replace escaped source lock");
      repository.replace(snapshot);
    },
  };
}

function lockCheckedCheckpointRepository(
  repository: LegacyImportCheckpointRepository,
  lockManager: RecordingLockManager,
): LegacyImportCheckpointRepository {
  return {
    transaction<T>(operation: () => T): T {
      assert.equal(lockManager.held, true, "checkpoint transaction escaped source lock");
      return repository.transaction(operation);
    },
    get(source: string): LegacyImportCheckpoint | null {
      assert.equal(lockManager.held, true, "checkpoint read escaped source lock");
      return repository.get(source);
    },
    list(): LegacyImportCheckpoint[] {
      assert.equal(lockManager.held, true, "checkpoint list escaped source lock");
      return repository.list();
    },
    upsert(checkpoint: LegacyImportCheckpoint): void {
      assert.equal(lockManager.held, true, "checkpoint write escaped source lock");
      repository.upsert(checkpoint);
    },
  };
}

function writeLegacy(harness: Harness, state: ReturnType<typeof legacyState>, suffix = ""): string {
  const raw = `${JSON.stringify(state, null, 2)}${suffix}`;
  harness.fileStore.writeTextSync(harness.sourcePath, raw, {
    mode: 0o600,
    createParentMode: 0o700,
    replace: true,
    syncDirectory: true,
  });
  return raw;
}

function legacyState(revision = 1) {
  const buildID = "legacy-build-1";
  return {
    version: BUILD_STATE_VERSION,
    apps: {
      "app-1": {
        archivedAt: "",
        migrationExtension: `app-${revision}`,
      },
    },
    artifactCleanupJobs: {
      "artifact-job-1": {
        id: "artifact-job-1",
        root: "/tmp/legacy-artifact",
        buildId: buildID,
        createdAt: "2026-08-11T08:00:00.000Z",
        nextAttemptAt: "2026-08-11T08:10:00.000Z",
        attempts: revision,
        lastError: revision === 1 ? "busy" : "still busy",
      },
    },
    deliveryReferenceCleanupJobs: {
      "delivery-job-1": {
        id: "delivery-job-1",
        generation: "legacy-generation",
        referenceID: "legacy-reference",
        buildId: buildID,
        createdAt: "2026-08-11T08:00:00.000Z",
        nextAttemptAt: "2026-08-11T08:15:00.000Z",
        attempts: revision,
        lastError: revision === 1 ? "provider unavailable" : "provider still unavailable",
      },
    },
    builds: [
      {
        id: buildID,
        token: "legacy-token",
        remoteBaseUrl: "https://legacy.example.test",
        delivery: {
          mode: "custom",
          provider: "user-configured",
          expiresAt: "2026-08-11T12:00:00.000Z",
        },
        project: "/tmp/Legacy.xcodeproj",
        workspace: "",
        scheme: "Legacy",
        configuration: "Release",
        exportMethod: "development",
        preserveData: true,
        createdAt: "2026-08-11T09:00:00.000Z",
        updatedAt: `2026-08-11T09:0${revision}:00.000Z`,
        ttlMinutes: 60,
        expiresAt: "2026-08-11T12:00:00.000Z",
        state: "ready",
        app: {
          identity: "app-1",
          name: "Legacy",
          bundleIdentifier: "com.example.legacy",
          version: "1.0",
          build: String(revision),
          teamID: "TEAM123",
        },
        signing: {
          style: "automatic",
          method: "development",
          deviceInstallable: true,
          updateSafe: "yes",
          warnings: [],
        },
        installation: {
          state: "unknown",
          requestedAt: "",
          verifiedAt: "",
          devices: [],
        },
        artifacts: {
          root: "/tmp/legacy-artifact",
          archivePath: "/tmp/legacy-artifact/Legacy.xcarchive",
          exportPath: "/tmp/legacy-artifact/export",
          ipaPath: "/tmp/legacy-artifact/Legacy.ipa",
          manifestPath: "/tmp/legacy-artifact/manifest.plist",
        },
        logs: [`revision-${revision}`],
        migrationExtension: { revision },
      },
    ],
  };
}

test("imports device-build legacy state under one source lock and checkpoints exact evidence", (t) => {
  const harness = createHarness(t);
  const raw = writeLegacy(harness, legacyState());
  const expected = parseDeviceBuildLegacySnapshot(raw, harness.sourcePath).snapshot;

  const first = harness.coordinator().run();
  assert.equal(first.status, "applied");
  assert.equal(first.sourceVersion, BUILD_STATE_VERSION);
  assert.equal(first.recordCount, 4);
  assert.deepEqual(harness.repository.read(), expected);
  assert.deepEqual(harness.checkpointRepository.get(CHECKPOINT_SOURCE), {
    source: CHECKPOINT_SOURCE,
    sourceRevision: first.sourceRevision,
    projectionHash: first.projectionHash,
    importedAt: IMPORTED_AT,
    recordCount: 4,
  });
  assert.equal(harness.lockManager.held, false);
  assert.equal(harness.lockManager.requests.length, 1);
  assert.equal(readdirSync(harness.backupDirectory).length, 1);

  const second = harness.coordinator().run();
  assert.equal(second.status, "already-current");
  assert.equal(second.sourceRevision, first.sourceRevision);
  assert.equal(second.projectionHash, first.projectionHash);
  assert.deepEqual(second.backups, first.backups);
  assert.equal(readdirSync(harness.backupDirectory).length, 1);
});

test("retry after checkpoint interruption repairs evidence without replacing matching domain state", (t) => {
  const harness = createHarness(t);
  writeLegacy(harness, legacyState());
  let failCheckpoint = true;
  const interruptedCheckpoints: LegacyImportCheckpointRepository = {
    transaction<T>(operation: () => T): T {
      return harness.checkpointRepository.transaction(operation);
    },
    get(source: string): LegacyImportCheckpoint | null {
      return harness.checkpointRepository.get(source);
    },
    list(): LegacyImportCheckpoint[] {
      return harness.checkpointRepository.list();
    },
    upsert(checkpoint: LegacyImportCheckpoint): void {
      if (failCheckpoint) {
        failCheckpoint = false;
        throw new Error("simulated checkpoint interruption");
      }
      harness.checkpointRepository.upsert(checkpoint);
    },
  };

  assert.throws(
    () => harness.coordinator(interruptedCheckpoints).run(),
    /simulated checkpoint interruption/,
  );
  assert.equal(harness.repository.read().builds.length, 1);
  assert.equal(harness.checkpointRepository.get(CHECKPOINT_SOURCE), null);

  harness.database.exec(`CREATE TRIGGER reject_device_build_replacement
    BEFORE DELETE ON device_builds
    BEGIN
      SELECT RAISE(ABORT, 'unexpected device-build replacement');
    END`);
  const repaired = harness.coordinator().run();

  assert.equal(repaired.status, "checkpointed");
  assert.equal(
    harness.checkpointRepository.get(CHECKPOINT_SOURCE)?.projectionHash,
    repaired.projectionHash,
  );
});

test("corrupted checkpoint persistence is detected and retry repairs evidence without re-replacing state", (t) => {
  const harness = createHarness(t);
  writeLegacy(harness, legacyState());
  const corruptedCheckpoints: LegacyImportCheckpointRepository = {
    transaction<T>(operation: () => T): T {
      return harness.checkpointRepository.transaction(operation);
    },
    get(source: string): LegacyImportCheckpoint | null {
      return harness.checkpointRepository.get(source);
    },
    list(): LegacyImportCheckpoint[] {
      return harness.checkpointRepository.list();
    },
    upsert(checkpoint: LegacyImportCheckpoint): void {
      harness.checkpointRepository.upsert({
        ...checkpoint,
        projectionHash: "f".repeat(64),
      });
    },
  };

  assert.throws(
    () => harness.coordinator(corruptedCheckpoints).run(),
    /checkpoint did not persist exactly/,
  );
  assert.equal(harness.repository.read().builds.length, 1);
  assert.equal(harness.checkpointRepository.get(CHECKPOINT_SOURCE)?.projectionHash, "f".repeat(64));

  harness.database.exec(`CREATE TRIGGER reject_device_build_replacement_after_bad_checkpoint
    BEFORE DELETE ON device_builds
    BEGIN
      SELECT RAISE(ABORT, 'unexpected device-build replacement after bad checkpoint');
    END`);
  const repaired = harness.coordinator().run();

  assert.equal(repaired.status, "checkpointed");
  assert.equal(
    harness.checkpointRepository.get(CHECKPOINT_SOURCE)?.projectionHash,
    repaired.projectionHash,
  );
});

test("byte-only source revision changes repair only the checkpoint", (t) => {
  const harness = createHarness(t);
  const state = legacyState();
  const raw = writeLegacy(harness, state);
  const first = harness.coordinator().run();

  harness.database.exec(`CREATE TRIGGER reject_device_build_replacement
    BEFORE DELETE ON device_builds
    BEGIN
      SELECT RAISE(ABORT, 'unexpected device-build replacement');
    END`);
  writeLegacy(harness, state, "\n");
  const second = harness.coordinator().run();

  assert.equal(second.status, "checkpointed");
  assert.notEqual(second.sourceRevision, first.sourceRevision);
  assert.equal(second.projectionHash, first.projectionHash);
  assert.equal(
    harness.checkpointRepository.get(CHECKPOINT_SOURCE)?.sourceRevision,
    second.sourceRevision,
  );
  assert.equal(harness.fileStore.readTextSync(harness.sourcePath), `${raw}\n`);
  assert.equal(readdirSync(harness.backupDirectory).length, 2);
});

test("changed normalized legacy projection applies a new device-build snapshot", (t) => {
  const harness = createHarness(t);
  writeLegacy(harness, legacyState(1));
  const first = harness.coordinator().run();

  const raw = writeLegacy(harness, legacyState(2));
  const expected = parseDeviceBuildLegacySnapshot(raw, harness.sourcePath).snapshot;
  const second = harness.coordinator().run();

  assert.equal(second.status, "applied");
  assert.notEqual(second.projectionHash, first.projectionHash);
  assert.deepEqual(harness.repository.read(), expected);
  assert.equal(readdirSync(harness.backupDirectory).length, 2);
});

test("applier rejects forged locked evidence before SQLite or checkpoint mutation", (t) => {
  const harness = createHarness(t);
  const parsed = parseDeviceBuildLegacySnapshot(JSON.stringify(legacyState()), harness.sourcePath);
  const snapshot = parsed.snapshot;
  const applier = new DeviceBuildLegacyImportApplier({
    deviceBuildRepository: harness.repository,
    checkpointRepository: harness.checkpointRepository,
    checkpointSource: CHECKPOINT_SOURCE,
    clock,
  });

  assert.throws(
    () =>
      applier.apply({
        snapshot,
        sourceRevision: "a".repeat(64),
        projectionHash: "b".repeat(64),
        recordCount: 4,
        backups: ["/tmp/backup"],
        sourceVersion: BUILD_STATE_VERSION,
      }),
    /projectionHash does not match/,
  );
  assert.deepEqual(harness.repository.read(), emptySnapshot());
  assert.equal(harness.checkpointRepository.get(CHECKPOINT_SOURCE), null);

  const futureHash = deviceBuildProjectionHash(snapshot);
  assert.throws(
    () =>
      applier.apply({
        snapshot,
        sourceRevision: "c".repeat(64),
        projectionHash: futureHash,
        recordCount: 4,
        backups: ["/tmp/backup"],
        sourceVersion: BUILD_STATE_VERSION + 1,
      }),
    /exceeds supported version/,
  );
  assert.deepEqual(harness.repository.read(), emptySnapshot());
});

test("published v0.6.1 device fixture imports with provider-compatible epoch evidence", (t) => {
  const harness = createHarness(t);
  const raw = JSON.stringify(v061DeviceBuildFixture);
  harness.fileStore.writeTextSync(harness.sourcePath, raw, {
    mode: 0o600,
    createParentMode: 0o700,
    replace: true,
    syncDirectory: true,
  });

  const first = harness.coordinator().run();

  assert.equal(first.status, "applied");
  assert.equal(first.sourceVersion, 5);
  assert.equal(first.recordCount, 1);
  assert.equal(harness.repository.read().apps[0]?.id, "app-v061");
  const checkpoint = harness.checkpointRepository.get(CHECKPOINT_SOURCE);
  assert.equal(checkpoint?.sourceRevision, first.sourceRevision);
  assert.equal(checkpoint?.projectionHash, first.projectionHash);
  assert.equal(checkpoint?.recordCount, first.recordCount);
  assert.equal(harness.coordinator().run().status, "already-current");
  assert.equal(readdirSync(harness.backupDirectory).length, 1);
});

function emptySnapshot(): DeviceBuildStateSnapshot {
  return {
    builds: [],
    apps: [],
    artifactCleanupJobs: [],
    deliveryReferenceCleanupJobs: [],
  };
}

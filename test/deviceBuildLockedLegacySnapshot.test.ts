import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BUILD_STATE_VERSION,
  MAX_DEVICE_BUILD_LOG_BYTES,
  MAX_DEVICE_BUILD_LOG_LINES,
  deviceAppIdentity,
} from "../mac-helper/src/deviceBuildStoreCore.js";
import type {
  AtomicWriteOptions,
  LockLease,
  LockManager,
  LockRequest,
} from "../mac-helper/src/infrastructure/ports.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import {
  DeviceBuildLockedLegacySnapshotReader,
  deviceBuildProjectionHash,
  parseDeviceBuildLegacySnapshot,
} from "../mac-helper/src/persistence/deviceBuildLockedLegacySnapshot.js";

class RecordingLockManager implements LockManager {
  held = false;
  requests: LockRequest[] = [];

  private lease(request: LockRequest): LockLease {
    return {
      path: request.path,
      ownerPath: join(request.path, "owner.json"),
      ownerNonce: "recording-lock",
      async release() {},
      releaseSync() {},
    };
  }

  async acquire(_request: LockRequest): Promise<LockLease> {
    throw new Error("Direct acquire is not used by this test lock manager.");
  }

  acquireSync(_request: LockRequest): LockLease {
    throw new Error("Direct acquireSync is not used by this test lock manager.");
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

type MigrationIOEvent = {
  operation: "read" | "write";
  path: string;
  lockHeld: boolean;
};

class LockTrackingAtomicFileStore extends NodeAtomicFileStore {
  readonly events: MigrationIOEvent[] = [];

  constructor(private readonly lockManager: RecordingLockManager) {
    super();
  }

  override readTextSync(path: string): string {
    this.events.push({ operation: "read", path, lockHeld: this.lockManager.held });
    return super.readTextSync(path);
  }

  override writeTextSync(path: string, value: string, options: AtomicWriteOptions): void {
    this.events.push({ operation: "write", path, lockHeld: this.lockManager.held });
    super.writeTextSync(path, value, options);
  }
}

function withHarness(
  run: (harness: {
    root: string;
    sourcePath: string;
    backupDirectory: string;
    artifactRoot: string;
    verifierStore: NodeAtomicFileStore;
    migrationFileStore: LockTrackingAtomicFileStore;
    lockManager: RecordingLockManager;
    reader: DeviceBuildLockedLegacySnapshotReader;
  }) => void,
) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-build-legacy-snapshot-"));
  const sourcePath = join(root, "device-builds.json");
  const backupDirectory = join(root, "backups");
  const artifactRoot = join(root, "artifact-root-must-survive");
  const lockManager = new RecordingLockManager();
  const verifierStore = new NodeAtomicFileStore();
  const migrationFileStore = new LockTrackingAtomicFileStore(lockManager);
  const reader = new DeviceBuildLockedLegacySnapshotReader({
    fileStore: migrationFileStore,
    lockManager,
    source: {
      name: "device-builds.json",
      path: sourcePath,
      lockRequest: {
        path: `${sourcePath}.lock`,
        waitMs: 5_000,
        staleAfterMs: 250,
        ownerMode: 0o600,
      },
    },
    backupDirectory,
  });

  try {
    run({
      root,
      sourcePath,
      backupDirectory,
      artifactRoot,
      verifierStore,
      migrationFileStore,
      lockManager,
      reader,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function legacyState(artifactRoot: string) {
  const bundleIdentifier = "com.example.legacy";
  const teamID = "TEAM123";
  const appID = deviceAppIdentity({ bundleIdentifier, teamID });
  const build = {
    id: "legacy-build-1",
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
    updatedAt: "2026-08-11T09:05:00.000Z",
    ttlMinutes: 60,
    expiresAt: "2026-08-11T12:00:00.000Z",
    state: "ready",
    app: {
      name: "Legacy",
      bundleIdentifier,
      version: "1.0",
      build: "7",
      teamID,
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
      root: artifactRoot,
      archivePath: join(artifactRoot, "Legacy.xcarchive"),
      exportPath: join(artifactRoot, "export"),
      ipaPath: join(artifactRoot, "Legacy.ipa"),
      manifestPath: join(artifactRoot, "manifest.plist"),
    },
    logs: Array.from(
      { length: MAX_DEVICE_BUILD_LOG_LINES + 25 },
      (_, index) => `${index}:${"x".repeat(256)}`,
    ),
    migrationExtension: { preserved: true },
  };

  return {
    version: BUILD_STATE_VERSION - 1,
    apps: {
      [appID]: {
        archivedAt: "",
        migrationExtension: "app-preserved",
      },
    },
    artifactCleanupJobs: {
      "artifact-job-1": {
        id: "artifact-job-1",
        root: artifactRoot,
        buildId: "legacy-build-1",
        createdAt: "2026-08-11T08:00:00.000Z",
        notBefore: "2026-08-11T08:10:00.000Z",
        nextAttemptAt: "2026-08-11T08:10:00.000Z",
        attempts: 1,
        lastError: "busy",
        migrationExtension: "artifact-preserved",
      },
    },
    deliveryReferenceCleanupJobs: {
      "delivery-job-1": {
        id: "delivery-job-1",
        generation: "legacy-generation",
        referenceID: "legacy-reference",
        buildId: "legacy-build-1",
        createdAt: "2026-08-11T08:00:00.000Z",
        nextAttemptAt: "2026-08-11T08:15:00.000Z",
        attempts: 2,
        lastError: "provider unavailable",
        migrationExtension: "delivery-preserved",
      },
    },
    builds: [build],
  };
}

test("locked legacy snapshot normalizes in memory, backs up exact bytes, and causes no live-store side effects", () =>
  withHarness(
    ({
      sourcePath,
      backupDirectory,
      artifactRoot,
      verifierStore,
      migrationFileStore,
      lockManager,
      reader,
    }) => {
      mkdirSync(artifactRoot, { recursive: true });
      const raw = JSON.stringify(legacyState(artifactRoot), null, 2);
      writeFileSync(sourcePath, raw, { mode: 0o600 });

      const locked = reader.withLockedSnapshot((snapshot) => {
        assert.equal(lockManager.held, true);
        assert.equal(verifierStore.readTextSync(sourcePath), raw);
        assert.equal(existsSync(artifactRoot), true);
        return snapshot;
      });

      assert.equal(lockManager.held, false);
      assert.deepEqual(lockManager.requests, [
        {
          path: `${sourcePath}.lock`,
          waitMs: 5_000,
          staleAfterMs: 250,
          ownerMode: 0o600,
        },
      ]);
      assert.deepEqual(migrationFileStore.events, [
        { operation: "read", path: sourcePath, lockHeld: true },
        { operation: "write", path: locked.backups[0]!, lockHeld: true },
        { operation: "read", path: locked.backups[0]!, lockHeld: true },
      ]);
      assert.equal(locked.sourceVersion, BUILD_STATE_VERSION - 1);
      assert.equal(locked.recordCount, 4);
      assert.match(locked.sourceRevision, /^[a-f0-9]{64}$/);
      assert.equal(locked.projectionHash, deviceBuildProjectionHash(locked.snapshot));
      assert.equal(Object.isFrozen(locked.snapshot), true);
      assert.equal(Object.isFrozen(locked.snapshot.builds[0]?.app), true);

      const build = locked.snapshot.builds[0];
      assert.ok(build);
      assert.equal(build.revision, 0);
      assert.equal(build.tokenExpiredAt, "");
      assert.equal(build.installTTLMinutes, 60);
      assert.equal(build.ttlMinutes, 60);
      assert.equal(build.app.identity, locked.snapshot.apps[0]?.id);
      assert.equal(build.installation.updatedAt, "");
      assert.equal(build.installation.verificationDeadlineAt, "");
      assert.ok(build.logs.length <= MAX_DEVICE_BUILD_LOG_LINES);
      assert.ok(Buffer.byteLength(build.logs.join("\n"), "utf8") <= MAX_DEVICE_BUILD_LOG_BYTES);
      assert.match(build.logs.at(-1) || "", /^524:/);
      assert.deepEqual((build as unknown as Record<string, unknown>).migrationExtension, {
        preserved: true,
      });
      assert.equal(locked.snapshot.apps[0]?.migrationExtension, "app-preserved");
      assert.equal(
        locked.snapshot.artifactCleanupJobs[0]?.migrationExtension,
        "artifact-preserved",
      );
      assert.equal(
        locked.snapshot.deliveryReferenceCleanupJobs[0]?.migrationExtension,
        "delivery-preserved",
      );

      assert.equal(verifierStore.readTextSync(sourcePath), raw);
      assert.equal(existsSync(artifactRoot), true);
      assert.equal(locked.backups.length, 1);
      assert.equal(verifierStore.readTextSync(locked.backups[0]!), raw);
      assert.equal(readdirSync(backupDirectory).length, 1);
    },
  ));

test("source revision follows exact bytes while projection hash follows normalized state", () =>
  withHarness(({ sourcePath, artifactRoot, reader }) => {
    const raw = JSON.stringify(legacyState(artifactRoot), null, 2);
    writeFileSync(sourcePath, raw, { mode: 0o600 });
    const first = reader.withLockedSnapshot((snapshot) => snapshot);

    writeFileSync(sourcePath, `${raw}\n`, { mode: 0o600 });
    const second = reader.withLockedSnapshot((snapshot) => snapshot);

    assert.notEqual(second.sourceRevision, first.sourceRevision);
    assert.equal(second.projectionHash, first.projectionHash);
    assert.notDeepEqual(second.backups, first.backups);
  }));

test("missing build state produces an empty locked snapshot without inventing a backup", () =>
  withHarness(({ backupDirectory, reader }) => {
    const locked = reader.withLockedSnapshot((snapshot) => snapshot);
    assert.equal(locked.sourceVersion, 0);
    assert.equal(locked.recordCount, 0);
    assert.deepEqual(locked.snapshot, {
      builds: [],
      apps: [],
      artifactCleanupJobs: [],
      deliveryReferenceCleanupJobs: [],
    });
    assert.deepEqual(locked.backups, []);
    assert.equal(existsSync(backupDirectory), false);
  }));

test("future state versions fail closed after preserving the exact source backup", () =>
  withHarness(({ sourcePath, backupDirectory, artifactRoot, verifierStore, reader }) => {
    const state = legacyState(artifactRoot);
    state.version = BUILD_STATE_VERSION + 1;
    const raw = JSON.stringify(state);
    writeFileSync(sourcePath, raw, { mode: 0o600 });

    assert.throws(
      () => reader.withLockedSnapshot((snapshot) => snapshot),
      /newer than supported version/,
    );
    assert.equal(verifierStore.readTextSync(sourcePath), raw);
    const backups = readdirSync(backupDirectory);
    assert.equal(backups.length, 1);
    assert.equal(verifierStore.readTextSync(join(backupDirectory, backups[0]!)), raw);
  }));

test("malformed map identities fail closed instead of repairing legacy state silently", () => {
  const state = legacyState("/tmp/artifact");
  const job = state.artifactCleanupJobs["artifact-job-1"];
  job.id = "different-id";
  assert.throws(
    () => parseDeviceBuildLegacySnapshot(JSON.stringify(state), "/tmp/device-builds.json"),
    /id does not match map key/,
  );
});

test("locked snapshot callback must remain synchronous", () =>
  withHarness(({ reader, lockManager }) => {
    assert.throws(
      () => reader.withLockedSnapshot(async () => undefined),
      /must complete synchronously/,
    );
    assert.equal(lockManager.requests.length, 0);
  }));

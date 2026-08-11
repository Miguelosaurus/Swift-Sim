import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { DeviceBuildRecord } from "../mac-helper/src/contracts/build.js";
import type {
  ArtifactCleanupJobRecord,
  DeliveryReferenceCleanupJobRecord,
  DeviceBuildAppStateRecord,
  DeviceBuildShadowMismatchObservation,
} from "../mac-helper/src/contracts/deviceBuildRepository.js";
import type { Clock } from "../mac-helper/src/infrastructure/ports.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import {
  DeviceBuildShadowComparator,
  deviceBuildShadowKeyHash,
  deviceBuildShadowMismatchID,
  deviceBuildShadowProjectionHash,
} from "../mac-helper/src/persistence/deviceBuildShadowComparison.js";
import { SqliteDeviceBuildShadowMismatchRepository } from "../mac-helper/src/persistence/sqliteDeviceBuildShadowMismatchRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

function createHarness(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-device-build-shadow-"));
  const path = join(root, "state.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { path };
}

function openStores(path: string) {
  const database = new SwiftSimSqliteDatabase({
    path,
    migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
  });
  return {
    database,
    repository: new SqliteDeviceBuildShadowMismatchRepository(database),
  };
}

function clock(now: () => string): Clock {
  return {
    now: () => new Date(now()),
    monotonicMilliseconds: () => 0,
    sleep: async () => {},
  };
}

function buildRecord(overrides: Partial<DeviceBuildRecord> = {}): DeviceBuildRecord {
  return {
    id: "private-build-1",
    token: "secret-build-token",
    tokenExpiredAt: "",
    revision: 1,
    remoteBaseUrl: "https://private.example.test",
    delivery: {
      mode: "custom",
      provider: "user-configured",
      expiresAt: "2026-08-11T13:00:00.000Z",
      generation: "secret-generation",
      referenceID: "secret-reference",
    },
    project: "/Users/private/App.xcodeproj",
    workspace: "",
    scheme: "App",
    configuration: "Release",
    exportMethod: "development",
    preserveData: true,
    createdAt: "2026-08-11T11:00:00.000Z",
    updatedAt: "2026-08-11T11:01:00.000Z",
    installTTLMinutes: 60,
    ttlMinutes: 60,
    expiresAt: "2026-08-11T13:00:00.000Z",
    state: "ready",
    app: {
      identity: "private-app-1",
      name: "Private App",
      bundleIdentifier: "com.private.app",
      version: "1.0",
      build: "1",
      teamID: "PRIVATE",
    },
    signing: {
      style: "automatic",
      method: "development",
      deviceInstallable: true,
      updateSafe: "yes",
      warnings: [],
    },
    installation: {
      state: "verified",
      requestedAt: "2026-08-11T11:00:10.000Z",
      verifiedAt: "2026-08-11T11:00:20.000Z",
      updatedAt: "2026-08-11T11:00:20.000Z",
      verificationDeadlineAt: "",
      devices: [],
    },
    artifacts: {
      root: "/Users/private/build",
      archivePath: "/Users/private/build/App.xcarchive",
      exportPath: "/Users/private/build/export",
      ipaPath: "/Users/private/build/App.ipa",
      manifestPath: "/Users/private/build/manifest.plist",
    },
    logs: ["private diagnostic"],
    ...overrides,
  };
}

const APP: DeviceBuildAppStateRecord = {
  id: "private-app-1",
  archivedAt: "",
  extensionMarker: "private-app-extension",
};
const ARTIFACT_JOB: ArtifactCleanupJobRecord = {
  id: "private-artifact-job-1",
  root: "/Users/private/old-build",
  buildId: "private-old-build",
  createdAt: "2026-08-11T10:00:00.000Z",
  attempts: 1,
  lastError: "private artifact error",
};
const DELIVERY_JOB: DeliveryReferenceCleanupJobRecord = {
  id: "private-delivery-job-1",
  generation: "private-delivery-generation",
  referenceID: "private-delivery-reference",
  buildId: "private-old-build",
  createdAt: "2026-08-11T10:00:00.000Z",
  attempts: 1,
  lastError: "private delivery error",
};

test("device-build shadow migration extends the transactional schema", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());

  const health = stores.database.health();
  assert.equal(health.ok, true);
  assert.equal(health.schemaVersion, DEVICE_BUILD_SQLITE_MIGRATIONS.at(-1)?.version);
  const table = stores.database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get("device_build_shadow_mismatches");
  assert.equal(table?.name, "device_build_shadow_mismatches");
});

test("matching projections are canonical and produce no durable evidence", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const comparator = new DeviceBuildShadowComparator({
    mismatchRepository: stores.repository,
    clock: clock(() => "2026-08-11T12:00:00.000Z"),
  });
  const reorderedApp = {
    extensionMarker: APP.extensionMarker,
    archivedAt: APP.archivedAt,
    id: APP.id,
  };

  const result = comparator.compare({
    surface: "app",
    key: APP.id,
    legacy: APP,
    sqlite: reorderedApp,
  });

  assert.equal(result.matched, true);
  assert.equal(result.surface, "app");
  assert.equal(result.evidence, null);
  assert.equal(result.keyHash, deviceBuildShadowKeyHash(APP.id));
  assert.equal(result.legacyProjectionHash, result.sqliteProjectionHash);
  assert.deepEqual(stores.repository.list(), []);
});

test("mismatches persist deterministic redacted evidence and coalesce observations", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  let now = "2026-08-11T12:00:00.000Z";
  const comparator = new DeviceBuildShadowComparator({
    mismatchRepository: stores.repository,
    clock: clock(() => now),
  });
  const sqliteApp = { ...APP, archivedAt: "2026-08-11T11:30:00.000Z" };

  const first = comparator.compare({
    surface: "app",
    key: APP.id,
    legacy: APP,
    sqlite: sqliteApp,
  });
  now = "2026-08-11T12:01:00.000Z";
  const second = comparator.compare({
    surface: "app",
    key: APP.id,
    legacy: APP,
    sqlite: sqliteApp,
  });
  now = "2026-08-11T11:59:00.000Z";
  const backwardClock = comparator.compare({
    surface: "app",
    key: APP.id,
    legacy: APP,
    sqlite: sqliteApp,
  });

  assert.equal(first.matched, false);
  assert.equal(first.evidence?.mismatchID, second.evidence?.mismatchID);
  assert.equal(backwardClock.evidence?.observationCount, 3);
  assert.equal(backwardClock.evidence?.firstObservedAt, "2026-08-11T12:00:00.000Z");
  assert.equal(backwardClock.evidence?.lastObservedAt, "2026-08-11T12:01:00.000Z");
  const serialized = JSON.stringify(backwardClock.evidence);
  for (const secret of [APP.id, APP.extensionMarker, sqliteApp.archivedAt]) {
    assert.equal(serialized.includes(String(secret)), false);
  }

  const persisted = backwardClock.evidence;
  assert.ok(persisted);
  stores.database.close();
  const reopened = openStores(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.repository.get(persisted.mismatchID), persisted);
});

test("all entity surfaces and missing rows compare through one redacted contract", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const comparator = new DeviceBuildShadowComparator({
    mismatchRepository: stores.repository,
    clock: clock(() => "2026-08-11T12:00:00.000Z"),
  });
  const build = buildRecord();

  const cases = [
    ["build", build.id, build],
    ["app", APP.id, APP],
    ["artifact-cleanup-job", ARTIFACT_JOB.id, ARTIFACT_JOB],
    ["delivery-cleanup-job", DELIVERY_JOB.id, DELIVERY_JOB],
  ] as const;

  for (const [surface, key, projection] of cases) {
    const matched = comparator.compare({ surface, key, legacy: projection, sqlite: projection });
    assert.equal(matched.matched, true);
    const missing = comparator.compare({ surface, key, legacy: projection, sqlite: null });
    assert.equal(missing.matched, false);
    assert.equal(missing.surface, surface);
    assert.equal(missing.sqliteProjectionHash, null);
  }

  assert.equal(stores.repository.list().length, 4);
  const serialized = JSON.stringify(stores.repository.list());
  for (const secret of [
    build.id,
    build.token,
    build.project,
    APP.id,
    ARTIFACT_JOB.root,
    DELIVERY_JOB.generation,
    DELIVERY_JOB.referenceID,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("projection validation fails before durable mismatch evidence", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const comparator = new DeviceBuildShadowComparator({
    mismatchRepository: stores.repository,
    clock: clock(() => "2026-08-11T12:00:00.000Z"),
  });

  assert.throws(
    () => comparator.compare({ surface: "app", key: "different", legacy: APP, sqlite: APP }),
    /does not match its key/,
  );
  assert.throws(
    () =>
      comparator.compare({
        surface: "artifact-cleanup-job",
        key: ARTIFACT_JOB.id,
        legacy: { ...ARTIFACT_JOB, attempts: -1 },
        sqlite: ARTIFACT_JOB,
      }),
    /non-negative safe integer/,
  );
  assert.throws(
    () =>
      deviceBuildShadowProjectionHash({
        ...APP,
        extensionMarker: undefined,
      }),
    /must not contain undefined/,
  );
  assert.deepEqual(stores.repository.list(), []);
});

test("repository rejects malformed or forged shadow evidence before SQLite mutation", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const keyHash = digest("private-app-1");
  const legacyProjectionHash = digest("legacy");
  const sqliteProjectionHash = digest("sqlite");
  const identity = {
    surface: "app" as const,
    keyHash,
    legacyProjectionHash,
    sqliteProjectionHash,
  };
  const valid: DeviceBuildShadowMismatchObservation = {
    mismatchID: deviceBuildShadowMismatchID(identity),
    ...identity,
    observedAt: "2026-08-11T12:00:00.000Z",
  };

  assert.throws(
    () => stores.repository.observe({ ...valid, mismatchID: digest("forged") }),
    /does not match/,
  );
  assert.throws(
    () => stores.repository.observe({ ...valid, mismatchID: "not-a-hash" }),
    /lowercase SHA-256/,
  );
  assert.throws(
    () =>
      stores.repository.observe({
        ...valid,
        observedAt: "2026-08-11T12:00:00Z",
      }),
    /canonical UTC timestamp/,
  );
  assert.throws(
    () =>
      deviceBuildShadowMismatchID({
        surface: "app",
        keyHash,
        legacyProjectionHash,
        sqliteProjectionHash: legacyProjectionHash,
      }),
    /different projections/,
  );
  assert.deepEqual(stores.repository.list(), []);
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

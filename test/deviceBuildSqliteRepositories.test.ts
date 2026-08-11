import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DeviceBuildRecord } from "../mac-helper/src/contracts/build.js";
import type { DeviceBuildStateSnapshot } from "../mac-helper/src/contracts/deviceBuildRepository.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import {
  SqliteDeviceBuildStateRepository,
  normalizeDeviceBuildStateSnapshot,
} from "../mac-helper/src/persistence/sqliteDeviceBuildStateRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

function createHarness(t: { after(callback: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-device-build-sqlite-"));
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "state.sqlite"),
    migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
    now: () => "2026-08-11T09:30:00.000Z",
  });
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { database, repository: new SqliteDeviceBuildStateRepository(database) };
}

function buildRecord(overrides: Partial<DeviceBuildRecord> = {}): DeviceBuildRecord {
  return {
    id: "build-1",
    token: "token-1",
    tokenExpiredAt: "",
    revision: 7,
    remoteBaseUrl: "https://example.test",
    delivery: {
      mode: "custom",
      provider: "user-configured",
      expiresAt: "2026-08-11T10:30:00.000Z",
      generation: "generation-1",
      referenceID: "reference-1",
    },
    project: "/tmp/App.xcodeproj",
    workspace: "",
    scheme: "App",
    configuration: "Release",
    exportMethod: "development",
    preserveData: true,
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt: "2026-08-11T09:10:00.000Z",
    installTTLMinutes: 60,
    ttlMinutes: 60,
    expiresAt: "2026-08-11T10:30:00.000Z",
    state: "ready",
    app: {
      identity: "app-1",
      name: "App",
      bundleIdentifier: "com.example.app",
      version: "1.0",
      build: "42",
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
      state: "verified",
      requestedAt: "2026-08-11T09:05:00.000Z",
      verifiedAt: "2026-08-11T09:06:00.000Z",
      updatedAt: "2026-08-11T09:06:00.000Z",
      verificationDeadlineAt: "",
      devices: [{ name: "iPhone", state: "installed", version: "1.0", build: "42" }],
    },
    artifacts: {
      root: "/tmp/build-1",
      archivePath: "/tmp/build-1/App.xcarchive",
      exportPath: "/tmp/build-1/export",
      ipaPath: "/tmp/build-1/App.ipa",
      manifestPath: "/tmp/build-1/manifest.plist",
      resultBundlePath: "/tmp/build-1/result.xcresult",
    },
    logs: ["built", "delivered"],
    buildSettings: ["SWIFT_VERSION=6"],
    allowProvisioningUpdates: true,
    capabilities: [
      {
        token: "older-token",
        expiresAt: "2026-08-11T10:00:00.000Z",
        remoteBaseUrl: "https://old.example.test",
        delivery: {
          mode: "custom",
          provider: "user-configured",
          expiresAt: "2026-08-11T10:00:00.000Z",
        },
        installTTLMinutes: 60,
        createdAt: "2026-08-11T08:50:00.000Z",
      },
    ],
    control: { cancelPath: "/tmp/build-1/.cancelled" },
    liveReload: {
      eligible: true,
      engineReady: true,
      compilerReady: true,
      capturedCompilations: 2,
      error: "",
      host: "127.0.0.1",
    },
    ...overrides,
  };
}

function snapshot(): DeviceBuildStateSnapshot {
  return {
    builds: [buildRecord()],
    apps: [{ id: "app-1", archivedAt: "", migrationMarker: "preserved" }],
    artifactCleanupJobs: [
      {
        id: "artifact-job-1",
        root: "/tmp/old-build",
        buildId: "old-build",
        createdAt: "2026-08-11T08:00:00.000Z",
        notBefore: "2026-08-11T08:10:00.000Z",
        nextAttemptAt: "2026-08-11T08:10:00.000Z",
        attempts: 1,
        lastError: "busy",
        updatedAt: "2026-08-11T08:05:00.000Z",
        migrationMarker: "artifact-preserved",
      },
    ],
    deliveryReferenceCleanupJobs: [
      {
        id: "delivery-job-1",
        generation: "generation-old",
        referenceID: "reference-old",
        buildId: "old-build",
        createdAt: "2026-08-11T08:00:00.000Z",
        nextAttemptAt: "2026-08-11T08:15:00.000Z",
        attempts: 2,
        lastError: "provider unavailable",
        updatedAt: "2026-08-11T08:07:00.000Z",
        migrationMarker: "delivery-preserved",
      },
    ],
  };
}

test("device-build SQLite migration extends the validated pairing schema", (t) => {
  const { database } = createHarness(t);
  const health = database.health();
  assert.equal(health.ok, true);
  assert.equal(health.schemaVersion, 7);
  assert.equal(health.latestSchemaVersion, 7);
  const tables = database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  for (const table of [
    "pairing_credentials",
    "pairing_invitations",
    "device_builds",
    "device_app_state",
    "artifact_cleanup_jobs",
    "delivery_reference_cleanup_jobs",
    "device_build_shadow_mismatches",
  ]) {
    assert.ok(tables.includes(table), `missing ${table}`);
  }
});

test("device-build state round-trips atomically with extension fields intact", (t) => {
  const { repository } = createHarness(t);
  const expected = normalizeDeviceBuildStateSnapshot(snapshot());
  repository.replace(expected);
  assert.deepEqual(repository.read(), expected);
  assert.deepEqual(repository.getBuild("build-1"), expected.builds[0]);
  assert.equal(repository.getBuild("missing"), null);
});

test("invalid replacement fails before deleting the previous snapshot", (t) => {
  const { repository } = createHarness(t);
  const expected = normalizeDeviceBuildStateSnapshot(snapshot());
  repository.replace(expected);

  const duplicate: DeviceBuildStateSnapshot = {
    ...snapshot(),
    builds: [buildRecord(), buildRecord()],
  };
  assert.throws(() => repository.replace(duplicate), /Duplicate device build id/);
  assert.deepEqual(repository.read(), expected);
});

test("SQLite consistency checks reject mismatched extracted build columns", (t) => {
  const { database } = createHarness(t);
  const build = buildRecord();
  const insert = database.prepare(`INSERT INTO device_builds(
    id, revision, app_identity, state, created_at, updated_at, record_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  assert.throws(
    () =>
      insert.run(
        "different-id",
        build.revision,
        build.app.identity,
        build.state,
        build.createdAt,
        build.updatedAt,
        JSON.stringify(build),
      ),
    /constraint/i,
  );
});

test("SQL constraint failure rolls back an in-progress snapshot replacement", (t) => {
  const { repository } = createHarness(t);
  const expected = normalizeDeviceBuildStateSnapshot(snapshot());
  repository.replace(expected);

  const sqlInvalid: DeviceBuildStateSnapshot = {
    ...snapshot(),
    builds: [buildRecord({ id: "build-2", createdAt: "" })],
  };
  assert.doesNotThrow(() => normalizeDeviceBuildStateSnapshot(sqlInvalid));
  assert.throws(() => repository.replace(sqlInvalid), /constraint/i);
  assert.deepEqual(repository.read(), expected);
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import { createDeviceBuildShadowRuntime } from "../mac-helper/src/persistence/deviceBuildShadowRuntime.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { projectDurableSession } from "../mac-helper/src/persistence/sessionBoundaryProjection.js";
import { compareDurableSessionShadow } from "../mac-helper/src/persistence/sessionDurableShadowComparison.js";
import { observeSessionDurableShadowSnapshot } from "../mac-helper/src/persistence/sessionDurableShadowRuntime.js";
import { sessionDurableShadowPaths } from "../mac-helper/src/persistence/sessionDurableShadowPaths.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const LEGACY_SESSION = Object.freeze({
  id: "session-1",
  token: "token-1",
  project: "/tmp/App.xcodeproj",
  scheme: "App",
  simulatorUDID: "SIM-1",
  createdAt: "2026-08-14T10:00:00.000Z",
  revision: 7,
  updatedAt: "2026-08-14T10:10:00.000Z",
  remoteBaseUrl: "https://example.invalid",
  orientation: "portrait",
  build: { state: "ready", artifactRoot: "/tmp/build" },
  stream: {
    state: "running",
    transport: "serve-sim",
    pid: 4242,
    port: 9191,
    localUrl: "http://127.0.0.1:9191",
    previewUrl: "http://127.0.0.1:9191/preview",
    wsUrl: "ws://127.0.0.1:9191/live",
    raw: { worker: "runtime-only" },
  },
  logs: ["runtime log"],
});

function withTempDirectory(operation) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-phase4-integration-"));
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    return operation(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fakeSpawnSync(calls = []) {
  return (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    return {
      status: 0,
      stdout: "Fri Aug 14 13:00:00 2026\n",
      stderr: "",
    };
  };
}

test("Phase-4 global SQLite history appends durable sessions as v8 without changing v1-v7", () => {
  assert.equal(PHASE4_SQLITE_MIGRATIONS.length, 8);
  for (let index = 0; index < DEVICE_BUILD_SQLITE_MIGRATIONS.length; index += 1) {
    assert.strictEqual(PHASE4_SQLITE_MIGRATIONS[index], DEVICE_BUILD_SQLITE_MIGRATIONS[index]);
  }
  assert.deepEqual(
    PHASE4_SQLITE_MIGRATIONS.map(({ version, name }) => ({ version, name })),
    [
      { version: 1, name: "legacy_import_checkpoints" },
      { version: 2, name: "pairing_state" },
      { version: 3, name: "pairing_shadow_mismatch_evidence" },
      { version: 4, name: "pairing_authority_state" },
      { version: 5, name: "pairing_cutover_preparation" },
      { version: 6, name: "device_build_domain_state" },
      { version: 7, name: "device_build_shadow_mismatch_evidence" },
      { version: 8, name: "durable_session_domain_state" },
    ],
  );
});

test("schema v7 upgrades to v8, creates only the frozen session columns, and reopens", () => {
  withTempDirectory((root) => {
    const databasePath = join(root, "state.sqlite");
    const v7 = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: DEVICE_BUILD_SQLITE_MIGRATIONS,
    });
    assert.equal(v7.health().schemaVersion, 7);
    v7.close();

    const upgraded = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    assert.equal(upgraded.health().schemaVersion, 8);
    const columns = upgraded
      .prepare("PRAGMA table_info(session_records)")
      .all()
      .map((row) => String(row.name));
    assert.deepEqual(columns, [
      "id",
      "token",
      "project",
      "scheme",
      "simulator_udid",
      "created_at",
    ]);
    upgraded.close();

    const reopened = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    assert.equal(reopened.health().ok, true);
    assert.equal(reopened.health().schemaVersion, 8);
    reopened.close();
  });
});

test("every production shared-state opener accepts an already-latest v8 database", () => {
  withTempDirectory((root) => {
    const databasePath = join(root, "state.sqlite");
    const latest = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    latest.close();

    const devicePath = join(root, "device-builds.json");
    const deviceRuntime = createDeviceBuildShadowRuntime({
      databasePath,
      backupDirectory: join(root, "migration-backups", "device-builds"),
      source: {
        name: "device-builds.json",
        path: devicePath,
        lockRequest: {
          path: `${devicePath}.lock`,
          waitMs: 5000,
          staleAfterMs: 250,
          ownerMode: 0o600,
        },
      },
      spawnSync: fakeSpawnSync(),
    });
    assert.equal(deviceRuntime.health().schemaVersion, 8);
    deviceRuntime.importLegacy();
    deviceRuntime.close();

    const sessionPath = join(root, "sessions.json");
    const sessionObservation = observeSessionDurableShadowSnapshot({
      ...sessionDurableShadowPaths(sessionPath),
      spawnSync: fakeSpawnSync(),
    });
    assert.equal(sessionObservation.health.ok, true);
    assert.equal(sessionObservation.health.schemaVersion, 8);
    assert.equal(sessionObservation.authority, "legacy-json");
    assert.equal(sessionObservation.postImportMismatchCount, 0);
  });
});

const DURABLE_MUTATIONS = Object.freeze({
  id: "session-2",
  token: "token-2",
  project: "/tmp/Other.xcodeproj",
  scheme: "Other",
  simulatorUDID: "SIM-2",
  createdAt: "2026-08-14T12:00:00.000Z",
});

for (const [field, value] of Object.entries(DURABLE_MUTATIONS)) {
  test(`durable session shadow detects an individual ${field} mutation`, () => {
    const sqlite = projectDurableSession(LEGACY_SESSION);
    const mutated = { ...sqlite, [field]: value };
    const comparison = compareDurableSessionShadow(LEGACY_SESSION, mutated);
    assert.equal(comparison.matched, false);
    assert.ok(comparison.mismatch);
  });
}

test("runtime-only session churn does not create a durable mismatch", () => {
  const sqlite = projectDurableSession(LEGACY_SESSION);
  const runtimeOnly = structuredClone(LEGACY_SESSION);
  runtimeOnly.revision = 999;
  runtimeOnly.updatedAt = "2026-08-14T12:59:59.000Z";
  runtimeOnly.remoteBaseUrl = "https://changed.invalid";
  runtimeOnly.orientation = "landscape";
  runtimeOnly.build = { state: "failed", artifactRoot: "/tmp/other" };
  runtimeOnly.logs = ["changed", "again"];
  runtimeOnly.stream = {
    state: "failed",
    transport: "native-companion",
    pid: 99999,
    port: 65500,
    localUrl: "http://127.0.0.1:65500",
    previewUrl: "http://127.0.0.1:65500/other",
    wsUrl: "ws://127.0.0.1:65500/other",
    raw: { worker: "changed", runtimeClaim: "changed" },
  };
  assert.deepEqual(compareDurableSessionShadow(runtimeOnly, sqlite), {
    matched: true,
    mismatch: null,
  });
});

test("session staged observer locks with exact Darwin ps lstart identity and keeps JSON authority", () => {
  withTempDirectory((root) => {
    const calls = [];
    const sessionPath = join(root, "sessions.json");
    const result = observeSessionDurableShadowSnapshot({
      ...sessionDurableShadowPaths(sessionPath),
      spawnSync: fakeSpawnSync(calls),
    });
    assert.equal(result.authority, "legacy-json");
    assert.equal(result.postImportMismatchCount, 0);
    assert.ok(calls.length >= 1);
    assert.equal(calls[0].command, "/bin/ps");
    assert.deepEqual(calls[0].args, ["-p", String(process.pid), "-o", "lstart="]);
    assert.equal(calls[0].options.encoding, "utf8");
  });
});

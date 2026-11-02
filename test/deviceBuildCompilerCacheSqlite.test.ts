import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync as readFixtureBytes,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCompilerCacheRetention } from "../mac-helper/src/deviceBuildCompilerCacheRetention.js";
import { createNodeCompilerCacheStorage } from "../mac-helper/src/infrastructure/nodeCompilerCacheRetention.js";
import { createSqliteDeviceBuildStore } from "../mac-helper/src/persistence/phase4DeviceBuildStore.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

test("compiler cache retirement persists through SQLite without touching inactive legacy state", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-cache-sqlite-"));
  const legacyPath = join(root, "device-builds.json");
  writeFileSync(legacyPath, "inactive-legacy-sentinel");
  const database = new SwiftSimSqliteDatabase({
    path: join(root, "state.sqlite"),
    migrations: PHASE4_SQLITE_MIGRATIONS,
  });
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const store = createSqliteDeviceBuildStore({ database, legacyPath, maintenance: false });
  const builds = [];
  for (let index = 0; index < 5; index += 1) {
    const build = store.create({
      project: "/private/tmp/Example.xcodeproj",
      scheme: "Example",
      configuration: "Debug",
    });
    build.state = "ready";
    build.app = {
      ...build.app,
      bundleIdentifier: "com.example.retention",
      teamID: "FIXTURE",
      version: "1",
      build: String(index),
    };
    build.createdAt = new Date(Date.parse("2026-10-01T00:00:00Z") + index * 60_000).toISOString();
    build.liveReload = { compilerReady: true };
    const artifactRoot = String(build.artifacts.root);
    build.artifacts.ipaPath = join(artifactRoot, "export", "Example.ipa");
    mkdirSync(join(artifactRoot, "DerivedData"), { recursive: true, mode: 0o700 });
    mkdirSync(join(artifactRoot, "export"), { mode: 0o700 });
    writeFileSync(build.artifacts.ipaPath, "signed-install-payload");
    store.save(build);
    builds.push(build);
  }
  const service = createCompilerCacheRetention({
    store,
    artifactDirectory: join(root, "device-builds"),
    queue: {
      pollingSnapshot: () => ({ records: [], desires: [] }),
      withRetentionSnapshot: async (operation: (value: { records: []; desires: [] }) => unknown) =>
        operation({ records: [], desires: [] }),
    },
    references: { read: () => ({}), openPaths: async () => [] },
    storage: createNodeCompilerCacheStorage(),
    withEngineLock: async (operation: () => unknown) => operation(),
  });
  assert.equal((await service.reconcile()).pruned, 3);
  const reopened = createSqliteDeviceBuildStore({ database, legacyPath, maintenance: false });
  assert.equal(reopened.list().length, 5);
  for (const build of builds.slice(0, 3)) {
    assert.equal(reopened.get(build.id)?.liveReload?.compilerReady, false);
    assert.equal(existsSync(join(String(build.artifacts.root), "DerivedData")), false);
    assert.equal(existsSync(String(build.artifacts.ipaPath)), true);
    store.save(build);
    assert.equal(reopened.get(build.id)?.liveReload?.compilerReady, false);
  }
  assert.equal(readFixtureBytes(legacyPath, "utf8"), "inactive-legacy-sentinel");
});

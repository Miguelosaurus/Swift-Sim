import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BUILD_STATE_VERSION } from "../mac-helper/src/deviceBuildStoreCore.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { createDeviceBuildShadowRuntime } from "../mac-helper/src/persistence/deviceBuildShadowRuntime.js";

const CURRENT_START = "Mon Aug 11 12:34:56 2026";
const WRITE_OPTIONS = {
  mode: 0o600,
  createParentMode: 0o700,
  replace: true,
  syncDirectory: true,
};

test("device-build shadow runtime composes resumable import, health, observer, and legacy lock identity", (t) => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-device-build-shadow-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourcePath = join(root, "device-builds.json");
  const databasePath = join(root, "state.sqlite");
  const fileStore = new NodeAtomicFileStore();
  fileStore.writeJSONSync(
    sourcePath,
    {
      version: BUILD_STATE_VERSION,
      apps: {},
      artifactCleanupJobs: {},
      deliveryReferenceCleanupJobs: {},
      builds: [],
    },
    WRITE_OPTIONS,
  );
  let processIdentityCalls = 0;
  const diagnostics: string[] = [];
  const originalUmask = process.umask();
  const runtime = createDeviceBuildShadowRuntime({
    databasePath,
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
    backupDirectory: join(root, "backups"),
    spawnSync(command, args, options) {
      processIdentityCalls += 1;
      assert.equal(command, "/bin/ps");
      assert.deepEqual(args, ["-p", String(process.pid), "-o", "lstart="]);
      assert.deepEqual(options, { encoding: "utf8" });
      return { status: 0, stdout: `${CURRENT_START}\n` };
    },
    fileStore,
    reportError(error) {
      diagnostics.push(error.message);
    },
  });
  t.after(() => runtime.close());

  assert.equal(process.umask(), originalUmask);
  assert.equal(statSync(databasePath).mode & 0o777, 0o600);
  const health = runtime.health();
  assert.equal(health.ok, true);
  assert.equal(health.schemaVersion, 7);
  assert.equal(health.latestSchemaVersion, 7);

  const first = runtime.importLegacy();
  assert.equal(first.status, "checkpointed");
  assert.equal(first.sourceVersion, BUILD_STATE_VERSION);
  assert.equal(first.recordCount, 0);
  assert.equal(first.backups.length, 1);
  assert.equal(statSync(first.backups[0]).mode & 0o777, 0o600);
  assert.ok(processIdentityCalls > 0);

  const retry = runtime.importLegacy();
  assert.equal(retry.status, "already-current");
  assert.equal(retry.sourceRevision, first.sourceRevision);
  assert.equal(retry.projectionHash, first.projectionHash);

  const matched = runtime.shadowObserver.observe({
    surface: "app",
    key: "missing-app",
    legacy: null,
  });
  assert.equal(matched?.matched, true);
  assert.equal(matched?.evidence, null);

  const mismatch = runtime.shadowObserver.observe({
    surface: "app",
    key: "private-app",
    legacy: { id: "private-app", archivedAt: "" },
  });
  assert.equal(mismatch?.matched, false);
  assert.equal(mismatch?.sqliteProjectionHash, null);
  assert.ok(mismatch?.evidence);
  assert.equal(JSON.stringify(mismatch?.evidence).includes("private-app"), false);
  assert.deepEqual(diagnostics, []);

  runtime.close();
  runtime.close();
  assert.equal(
    runtime.shadowObserver.observe({ surface: "app", key: "missing-app", legacy: null }),
    null,
  );
  assert.deepEqual(diagnostics, ["Device-build shadow observation failed."]);
});

test("device-build shadow runtime validates non-I/O dependencies before opening SQLite", () => {
  assert.throws(
    () =>
      createDeviceBuildShadowRuntime({
        databasePath: "/path/that/must/not/be/opened/state.sqlite",
        source: {
          name: "device-builds.json",
          path: "/path/that/must/not-be-read/device-builds.json",
          lockRequest: {
            path: "/path/that/must/not-be-opened/device-builds.lock",
            waitMs: 5_000,
            staleAfterMs: 250,
            ownerMode: 0o600,
          },
        },
        backupDirectory: "/path/that/must/not/be-written/backups",
        spawnSync: null as unknown as Parameters<
          typeof createDeviceBuildShadowRuntime
        >[0]["spawnSync"],
      }),
    /requires spawnSync/,
  );
});

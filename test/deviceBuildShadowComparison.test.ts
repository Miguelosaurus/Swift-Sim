import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  DeviceBuildShadowMismatchObservation,
  DeviceBuildStateSnapshot,
} from "../mac-helper/src/contracts/deviceBuildRepository.js";
import type { Clock } from "../mac-helper/src/infrastructure/ports.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";
import {
  DeviceBuildShadowComparator,
  deviceBuildShadowMismatchID,
} from "../mac-helper/src/persistence/deviceBuildShadowComparison.js";
import { SqliteDeviceBuildShadowMismatchRepository } from "../mac-helper/src/persistence/sqliteDeviceBuildShadowMismatchRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

function createHarness(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-device-build-shadow-"));
  const path = join(root, "state.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, path };
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

function snapshot(): DeviceBuildStateSnapshot {
  return {
    builds: [],
    apps: [
      { id: "private-app-2", archivedAt: "2026-08-11T11:00:00.000Z", marker: "second" },
      { id: "private-app-1", archivedAt: "", marker: "first" },
    ],
    artifactCleanupJobs: [
      {
        id: "private-artifact-job-2",
        root: "/Users/private/build-two",
        createdAt: "2026-08-11T10:01:00.000Z",
        attempts: 1,
        lastError: "busy two",
      },
      {
        id: "private-artifact-job-1",
        root: "/Users/private/build-one",
        createdAt: "2026-08-11T10:00:00.000Z",
        attempts: 0,
        lastError: "",
      },
    ],
    deliveryReferenceCleanupJobs: [
      {
        id: "private-delivery-job-2",
        generation: "secret-generation-two",
        referenceID: "secret-reference-two",
        createdAt: "2026-08-11T10:01:00.000Z",
        attempts: 1,
        lastError: "provider busy",
      },
      {
        id: "private-delivery-job-1",
        generation: "secret-generation-one",
        referenceID: "secret-reference-one",
        createdAt: "2026-08-11T10:00:00.000Z",
        attempts: 0,
        lastError: "",
      },
    ],
  };
}

function clock(now: () => string): Clock {
  return {
    now: () => new Date(now()),
    monotonicMilliseconds: () => 0,
    sleep: async () => {},
  };
}

test("device-build shadow migration extends the transactional schema", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());

  const health = stores.database.health();
  assert.equal(health.ok, true);
  assert.equal(health.schemaVersion, 7);
  assert.equal(health.latestSchemaVersion, 7);
  const table = stores.database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get("device_build_shadow_mismatches");
  assert.equal(table?.name, "device_build_shadow_mismatches");
});

test("matching normalized device-build snapshots produce no durable evidence", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const comparator = new DeviceBuildShadowComparator({
    mismatchRepository: stores.repository,
    clock: clock(() => "2026-08-11T12:00:00.000Z"),
  });
  const legacy = snapshot();
  const reordered: DeviceBuildStateSnapshot = {
    builds: [],
    apps: [...legacy.apps].reverse(),
    artifactCleanupJobs: [...legacy.artifactCleanupJobs].reverse(),
    deliveryReferenceCleanupJobs: [...legacy.deliveryReferenceCleanupJobs].reverse(),
  };

  const result = comparator.compare({
    key: "device-build-state-v1",
    legacy,
    sqlite: reordered,
  });

  assert.equal(result.matched, true);
  assert.equal(result.evidence, null);
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
  const legacy = snapshot();
  const sqlite: DeviceBuildStateSnapshot = {
    ...legacy,
    apps: legacy.apps.map((app) =>
      app.id === "private-app-1"
        ? { ...app, archivedAt: "2026-08-11T11:30:00.000Z" }
        : app,
    ),
  };

  const first = comparator.compare({ key: "device-build-state-v1", legacy, sqlite });
  now = "2026-08-11T12:01:00.000Z";
  const second = comparator.compare({ key: "device-build-state-v1", legacy, sqlite });
  now = "2026-08-11T11:59:00.000Z";
  const backwardClock = comparator.compare({ key: "device-build-state-v1", legacy, sqlite });

  assert.equal(first.matched, false);
  assert.equal(second.matched, false);
  assert.equal(first.evidence?.mismatchID, second.evidence?.mismatchID);
  assert.equal(backwardClock.evidence?.observationCount, 3);
  assert.equal(backwardClock.evidence?.firstObservedAt, "2026-08-11T12:00:00.000Z");
  assert.equal(backwardClock.evidence?.lastObservedAt, "2026-08-11T12:01:00.000Z");
  const serialized = JSON.stringify(backwardClock.evidence);
  for (const secret of [
    "device-build-state-v1",
    "private-app-1",
    "/Users/private/build-one",
    "secret-generation-one",
    "secret-reference-one",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }

  const persisted = backwardClock.evidence;
  assert.ok(persisted);
  stores.database.close();
  const reopened = openStores(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.repository.get(persisted.mismatchID), persisted);
});

test("different mismatch pairs produce different durable identities", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const comparator = new DeviceBuildShadowComparator({
    mismatchRepository: stores.repository,
    clock: clock(() => "2026-08-11T12:00:00.000Z"),
  });
  const legacy = snapshot();
  const firstSqlite: DeviceBuildStateSnapshot = {
    ...legacy,
    apps: legacy.apps.map((app) => ({ ...app, archivedAt: "changed-one" })),
  };
  const secondSqlite: DeviceBuildStateSnapshot = {
    ...legacy,
    deliveryReferenceCleanupJobs: legacy.deliveryReferenceCleanupJobs.map((job) => ({
      ...job,
      attempts: job.attempts + 1,
    })),
  };

  const first = comparator.compare({
    key: "device-build-state-v1",
    legacy,
    sqlite: firstSqlite,
  });
  const second = comparator.compare({
    key: "device-build-state-v1",
    legacy,
    sqlite: secondSqlite,
  });

  assert.notEqual(first.evidence?.mismatchID, second.evidence?.mismatchID);
  assert.equal(stores.repository.list().length, 2);
});

test("repository rejects malformed or forged shadow evidence before SQLite mutation", (t) => {
  const { path } = createHarness(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const hashes = {
    keyHash: digest("device-build-state-v1"),
    legacyProjectionHash: digest("legacy"),
    sqliteProjectionHash: digest("sqlite"),
  };
  const valid: DeviceBuildShadowMismatchObservation = {
    mismatchID: deviceBuildShadowMismatchID(hashes),
    ...hashes,
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
  const sameProjection = digest("same-projection");
  assert.throws(
    () =>
      stores.repository.observe({
        ...valid,
        mismatchID: deviceBuildShadowMismatchID({
          keyHash: valid.keyHash,
          legacyProjectionHash: sameProjection,
          sqliteProjectionHash: sameProjection,
        }),
        legacyProjectionHash: sameProjection,
        sqliteProjectionHash: sameProjection,
      }),
    /different projections/,
  );
  assert.throws(
    () => stores.repository.observe({ ...valid, observedAt: "2026-08-11T12:00:00Z" }),
    /canonical UTC timestamp/,
  );
  assert.deepEqual(stores.repository.list(), []);
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

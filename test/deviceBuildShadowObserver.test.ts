import assert from "node:assert/strict";
import test from "node:test";
import type {
  ArtifactCleanupJobRecord,
  DeliveryReferenceCleanupJobRecord,
  DeviceBuildAppStateRecord,
  DeviceBuildShadowComparisonResult,
  DeviceBuildShadowProjection,
  DeviceBuildShadowSurface,
  DeviceBuildStateSnapshot,
} from "../mac-helper/src/contracts/deviceBuildRepository.js";
import { DeviceBuildShadowObserver } from "../mac-helper/src/persistence/deviceBuildShadowObserver.js";

const APP: DeviceBuildAppStateRecord = {
  id: "app-1",
  archivedAt: "",
  marker: "legacy-app",
};
const ARTIFACT_JOB: ArtifactCleanupJobRecord = {
  id: "artifact-job-1",
  root: "/private/artifact",
  createdAt: "2026-08-11T12:00:00.000Z",
  attempts: 0,
  lastError: "",
};
const DELIVERY_JOB: DeliveryReferenceCleanupJobRecord = {
  id: "delivery-job-1",
  generation: "private-generation",
  referenceID: "private-reference",
  createdAt: "2026-08-11T12:00:00.000Z",
  attempts: 0,
  lastError: "",
};

const MATCHED: DeviceBuildShadowComparisonResult = {
  matched: true,
  surface: "app",
  keyHash: "a".repeat(64),
  legacyProjectionHash: "b".repeat(64),
  sqliteProjectionHash: "b".repeat(64),
  evidence: null,
};

function snapshot(overrides: Partial<DeviceBuildStateSnapshot> = {}): DeviceBuildStateSnapshot {
  return {
    builds: [],
    apps: [APP],
    artifactCleanupJobs: [ARTIFACT_JOB],
    deliveryReferenceCleanupJobs: [DELIVERY_JOB],
    ...overrides,
  };
}

test("device-build shadow observer selects the SQLite projection by explicit surface", () => {
  let readCount = 0;
  let getBuildCount = 0;
  const compared: Array<{
    surface: DeviceBuildShadowSurface;
    key: string;
    legacy: DeviceBuildShadowProjection;
    sqlite: DeviceBuildShadowProjection;
  }> = [];
  const observer = new DeviceBuildShadowObserver({
    deviceBuildRepository: {
      getBuild() {
        getBuildCount += 1;
        return null;
      },
      read() {
        readCount += 1;
        return snapshot();
      },
    },
    comparator: {
      compare(input) {
        compared.push(input);
        return { ...MATCHED, surface: input.surface };
      },
    },
  });

  assert.equal(observer.observe({ surface: "build", key: "missing-build", legacy: null })?.matched, true);
  assert.equal(observer.observe({ surface: "app", key: APP.id, legacy: APP })?.matched, true);
  assert.equal(
    observer.observe({
      surface: "artifact-cleanup-job",
      key: ARTIFACT_JOB.id,
      legacy: ARTIFACT_JOB,
    })?.matched,
    true,
  );
  assert.equal(
    observer.observe({
      surface: "delivery-cleanup-job",
      key: DELIVERY_JOB.id,
      legacy: DELIVERY_JOB,
    })?.matched,
    true,
  );

  assert.equal(getBuildCount, 1);
  assert.equal(readCount, 3);
  assert.equal(compared[0]?.sqlite, null);
  assert.deepEqual(compared[1]?.sqlite, APP);
  assert.deepEqual(compared[2]?.sqlite, ARTIFACT_JOB);
  assert.deepEqual(compared[3]?.sqlite, DELIVERY_JOB);
  assert.notEqual(compared[1]?.legacy, APP);
  assert.deepEqual(compared[1]?.legacy, APP);
});

test("device-build shadow observer passes null for a missing SQLite entity", () => {
  let comparedSqlite: DeviceBuildShadowProjection = APP;
  const observer = new DeviceBuildShadowObserver({
    deviceBuildRepository: {
      getBuild() {
        return null;
      },
      read() {
        return snapshot({ apps: [] });
      },
    },
    comparator: {
      compare(input) {
        comparedSqlite = input.sqlite;
        return { ...MATCHED, surface: input.surface };
      },
    },
  });

  const result = observer.observe({ surface: "app", key: APP.id, legacy: APP });
  assert.equal(result?.matched, true);
  assert.equal(comparedSqlite, null);
});

test("device-build shadow observer contains repository, comparator, and reporter failures", async () => {
  const diagnostics: string[] = [];
  const repositoryFailure = new DeviceBuildShadowObserver({
    deviceBuildRepository: {
      getBuild() {
        throw new Error("private database path");
      },
      read() {
        return snapshot();
      },
    },
    comparator: {
      compare() {
        return assert.fail("comparison must not run after repository failure");
      },
    },
    reportError(error) {
      diagnostics.push(error.message);
      return Promise.reject(new Error("reporter rejected"));
    },
  });

  assert.equal(
    repositoryFailure.observe({ surface: "build", key: "build-1", legacy: null }),
    null,
  );
  await Promise.resolve();
  assert.deepEqual(diagnostics, ["Device-build shadow observation failed."]);

  const comparatorFailure = new DeviceBuildShadowObserver({
    deviceBuildRepository: {
      getBuild() {
        return null;
      },
      read() {
        return snapshot();
      },
    },
    comparator: {
      compare() {
        throw new Error("private comparison detail");
      },
    },
    reportError() {
      throw new Error("reporter threw");
    },
  });
  assert.equal(
    comparatorFailure.observe({ surface: "app", key: APP.id, legacy: APP }),
    null,
  );
});

test("device-build shadow observer rejects malformed snapshots without leaking failure", () => {
  const diagnostics: string[] = [];
  const observer = new DeviceBuildShadowObserver({
    deviceBuildRepository: {
      getBuild() {
        return null;
      },
      read() {
        return { ...snapshot(), apps: null } as unknown as DeviceBuildStateSnapshot;
      },
    },
    comparator: {
      compare() {
        return assert.fail("malformed SQLite snapshot must not reach comparison");
      },
    },
    reportError(error) {
      diagnostics.push(error.message);
    },
  });

  assert.equal(observer.observe({ surface: "app", key: APP.id, legacy: APP }), null);
  assert.deepEqual(diagnostics, ["Device-build shadow observation failed."]);
});

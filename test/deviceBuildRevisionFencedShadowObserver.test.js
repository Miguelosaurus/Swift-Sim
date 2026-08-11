import assert from "node:assert/strict";
import test from "node:test";
import { DeviceBuildRevisionFencedShadowObserver } from "../mac-helper/src/persistence/deviceBuildRevisionFencedShadowObserver.js";

function build(revision, overrides = {}) {
  return {
    id: "build-1",
    token: "secret-token",
    tokenExpiredAt: "",
    revision,
    remoteBaseUrl: "https://example.test",
    delivery: {
      mode: "custom",
      provider: "user-configured",
      expiresAt: "2026-08-11T18:00:00.000Z",
    },
    project: "/tmp/App.xcodeproj",
    workspace: "",
    scheme: "App",
    configuration: "Release",
    exportMethod: "development",
    preserveData: true,
    createdAt: "2026-08-11T16:00:00.000Z",
    updatedAt: "2026-08-11T16:01:00.000Z",
    installTTLMinutes: 60,
    ttlMinutes: 60,
    expiresAt: "2026-08-11T18:00:00.000Z",
    state: "ready",
    app: {
      identity: "app-1",
      name: "App",
      bundleIdentifier: "com.example.app",
      version: "1.0",
      build: "1",
      teamID: "TEAM",
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
      updatedAt: "2026-08-11T16:01:00.000Z",
      verificationDeadlineAt: "",
      devices: [],
    },
    artifacts: {
      root: "/tmp/build-1",
      archivePath: "",
      exportPath: "",
      ipaPath: "/tmp/build-1/App.ipa",
      manifestPath: "",
    },
    logs: [],
    ...overrides,
  };
}

const RESULT = {
  matched: true,
  surface: "build",
  keyHash: "a".repeat(64),
  legacyProjectionHash: "b".repeat(64),
  sqliteProjectionHash: "b".repeat(64),
  evidence: null,
};

test("revision-fenced build shadow compares only the same persisted build revision", () => {
  const legacy = build(7);
  const sqlite = build(7, { logs: ["sqlite-copy"] });
  const comparisons = [];
  const observer = new DeviceBuildRevisionFencedShadowObserver({
    deviceBuildRepository: { getBuild: () => sqlite, read: () => assert.fail("not used") },
    comparator: {
      compare(input) {
        comparisons.push(input);
        return RESULT;
      },
    },
    fallbackObserver: { observe: () => assert.fail("build must not use fallback") },
  });

  assert.equal(observer.observe({ surface: "build", key: legacy.id, legacy }), RESULT);
  assert.equal(comparisons.length, 1);
  assert.notEqual(comparisons[0].legacy, legacy);
  assert.deepEqual(comparisons[0].legacy, legacy);
  assert.equal(comparisons[0].sqlite, sqlite);
});

test("missing or stale SQLite builds are skipped instead of becoming mismatch evidence", () => {
  let comparisonCalls = 0;
  const comparator = {
    compare() {
      comparisonCalls += 1;
      return RESULT;
    },
  };
  const fallbackObserver = { observe: () => assert.fail("build must not use fallback") };

  const missing = new DeviceBuildRevisionFencedShadowObserver({
    deviceBuildRepository: { getBuild: () => null, read: () => assert.fail("not used") },
    comparator,
    fallbackObserver,
  });
  assert.equal(missing.observe({ surface: "build", key: "build-1", legacy: build(8) }), null);

  const stale = new DeviceBuildRevisionFencedShadowObserver({
    deviceBuildRepository: { getBuild: () => build(7), read: () => assert.fail("not used") },
    comparator,
    fallbackObserver,
  });
  assert.equal(stale.observe({ surface: "build", key: "build-1", legacy: build(8) }), null);
  assert.equal(comparisonCalls, 0);
});

test("non-build surfaces retain the generic observer until they have their own live freshness fence", () => {
  const input = { surface: "app", key: "app-1", legacy: { id: "app-1", archivedAt: "" } };
  let forwarded;
  const observer = new DeviceBuildRevisionFencedShadowObserver({
    deviceBuildRepository: { getBuild: () => assert.fail("not used"), read: () => assert.fail("not used") },
    comparator: { compare: () => assert.fail("not used") },
    fallbackObserver: {
      observe(value) {
        forwarded = value;
        return null;
      },
    },
  });

  assert.equal(observer.observe(input), null);
  assert.equal(forwarded, input);
});

test("revision-fenced shadow failures remain generic and cannot affect JSON authority", async () => {
  const diagnostics = [];
  const observer = new DeviceBuildRevisionFencedShadowObserver({
    deviceBuildRepository: {
      getBuild() {
        throw new Error("private SQLite detail");
      },
      read: () => assert.fail("not used"),
    },
    comparator: { compare: () => assert.fail("not used") },
    fallbackObserver: { observe: () => assert.fail("not used") },
    reportError(error) {
      diagnostics.push(error.message);
      return Promise.reject(new Error("reporter rejected"));
    },
  });

  assert.equal(observer.observe({ surface: "build", key: "build-1", legacy: build(7) }), null);
  await Promise.resolve();
  assert.deepEqual(diagnostics, ["Revision-fenced device-build shadow observation failed."]);
});

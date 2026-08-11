import assert from "node:assert/strict";
import test from "node:test";
import { isDeviceBuildRecord } from "../mac-helper/src/contracts/deviceBuildRecordRuntime.js";
import { createDeviceBuildShadowRuntime } from "../mac-helper/src/persistence/deviceBuildShadowRuntime.js";
import { DeviceBuildShadowComparator } from "../mac-helper/src/persistence/deviceBuildShadowComparison.js";
import { SqliteDeviceBuildStateRepository } from "../mac-helper/src/persistence/sqliteDeviceBuildStateRepository.js";

test("device-build shadow runtime graph is loadable directly from the source tree", () => {
  assert.equal(typeof createDeviceBuildShadowRuntime, "function");
  assert.equal(typeof DeviceBuildShadowComparator, "function");
  assert.equal(typeof SqliteDeviceBuildStateRepository, "function");
  assert.equal(typeof isDeviceBuildRecord, "function");
});

test("source runtime validator accepts the persisted build shape and rejects key contract violations", () => {
  const valid = buildRecord();
  assert.equal(isDeviceBuildRecord(valid), true);

  for (const invalid of [
    { ...valid, id: "" },
    { ...valid, revision: -1 },
    { ...valid, ttlMinutes: 30 },
    { ...valid, state: "unknown-state" },
    { ...valid, app: { ...valid.app, teamID: 42 } },
    { ...valid, installation: { ...valid.installation, state: "bogus" } },
    { ...valid, capabilities: [{ ...valid.capabilities[0], installTTLMinutes: 1 }] },
  ]) {
    assert.equal(isDeviceBuildRecord(invalid), false);
  }
});

function buildRecord() {
  return {
    id: "build-1",
    token: "secret-token",
    tokenExpiredAt: "",
    revision: 3,
    remoteBaseUrl: "https://example.test",
    delivery: {
      mode: "custom",
      provider: "user-configured",
      expiresAt: "2026-08-11T20:00:00.000Z",
      generation: "generation-1",
      referenceID: "reference-1",
    },
    project: "/tmp/App.xcodeproj",
    workspace: "",
    scheme: "App",
    configuration: "Release",
    exportMethod: "development",
    preserveData: true,
    createdAt: "2026-08-11T18:00:00.000Z",
    updatedAt: "2026-08-11T18:01:00.000Z",
    installTTLMinutes: 60,
    ttlMinutes: 60,
    expiresAt: "2026-08-11T20:00:00.000Z",
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
      updateSafe: "same-bundle-update",
      warnings: [],
    },
    installation: {
      state: "verified",
      requestedAt: "2026-08-11T18:00:30.000Z",
      verifiedAt: "2026-08-11T18:00:40.000Z",
      updatedAt: "2026-08-11T18:00:40.000Z",
      verificationDeadlineAt: "",
      devices: [{ name: "iPhone", state: "installed", version: "1.0", build: "1" }],
    },
    artifacts: {
      root: "/tmp/build-1",
      archivePath: "/tmp/build-1/App.xcarchive",
      exportPath: "/tmp/build-1/export",
      ipaPath: "/tmp/build-1/App.ipa",
      manifestPath: "/tmp/build-1/manifest.plist",
      resultBundlePath: "/tmp/build-1/result.xcresult",
    },
    logs: ["ready"],
    buildSettings: ["SWIFT_VERSION=6"],
    allowProvisioningUpdates: true,
    capabilities: [
      {
        token: "capability-token",
        expiresAt: "2026-08-11T19:00:00.000Z",
        remoteBaseUrl: "https://example.test",
        delivery: null,
        installTTLMinutes: 60,
        createdAt: "2026-08-11T18:00:00.000Z",
      },
    ],
    control: { cancelPath: "/tmp/build-1/.cancelled" },
    liveReload: {
      eligible: true,
      engineReady: true,
      compilerReady: true,
      capturedCompilations: 1,
      error: "",
      host: "127.0.0.1",
    },
  };
}

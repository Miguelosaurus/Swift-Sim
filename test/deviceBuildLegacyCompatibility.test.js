import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_STATE_VERSION } from "../mac-helper/src/deviceBuildStoreCore.js";
import { parseDeviceBuildLegacySnapshot } from "../mac-helper/src/persistence/deviceBuildLockedLegacySnapshot.js";

function legacyBuild() {
  return {
    id: "legacy-build-compat",
    token: "legacy-token",
    remoteBaseUrl: "",
    delivery: {
      mode: "quick-tunnel",
      provider: "cloudflare-quick-tunnel",
      expiresAt: "",
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
      bundleIdentifier: "com.example.legacy",
      version: "1.0",
      build: "7",
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
      state: "unknown",
      requestedAt: "",
      verifiedAt: "",
      devices: [],
    },
    artifacts: {
      root: "/tmp/build",
      archivePath: "/tmp/build/Legacy.xcarchive",
      exportPath: "/tmp/build/export",
      ipaPath: "/tmp/build/Legacy.ipa",
      manifestPath: "/tmp/build/manifest.plist",
    },
    logs: [],
  };
}

function legacyState(build) {
  return JSON.stringify({
    version: BUILD_STATE_VERSION,
    builds: [build],
    apps: {},
    artifactCleanupJobs: {},
    deliveryReferenceCleanupJobs: {},
  });
}

test("legacy snapshot upgrades only known historical missing build fields", () => {
  const build = legacyBuild();
  delete build.delivery;
  delete build.signing.deviceInstallable;

  const parsed = parseDeviceBuildLegacySnapshot(legacyState(build));
  const imported = parsed.snapshot.builds[0];

  assert.deepEqual(imported.delivery, {
    mode: "quick-tunnel",
    provider: "cloudflare-quick-tunnel",
    expiresAt: "",
  });
  assert.equal(imported.signing.deviceInstallable, false);
});

test("legacy snapshot preserves explicit delivery and device-installable semantics", () => {
  const build = legacyBuild();
  build.delivery = {
    mode: "custom",
    provider: "user-configured",
    expiresAt: "2026-08-11T12:30:00.000Z",
  };
  build.signing.deviceInstallable = true;

  const parsed = parseDeviceBuildLegacySnapshot(legacyState(build));
  const imported = parsed.snapshot.builds[0];

  assert.deepEqual(imported.delivery, build.delivery);
  assert.equal(imported.signing.deviceInstallable, true);
});

test("legacy snapshot does not repair malformed present delivery", () => {
  const build = legacyBuild();
  build.delivery = {
    mode: "not-a-real-mode",
    provider: "cloudflare-quick-tunnel",
    expiresAt: "",
  };

  assert.throws(
    () => parseDeviceBuildLegacySnapshot(legacyState(build)),
    /Device build record is invalid\./,
  );
});

test("legacy snapshot does not invent a missing signing object", () => {
  const build = legacyBuild();
  delete build.signing;

  assert.throws(
    () => parseDeviceBuildLegacySnapshot(legacyState(build)),
    /Device build record is invalid\./,
  );
});

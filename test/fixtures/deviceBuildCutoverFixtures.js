export const DEVICE_BUILD_CUTOVER_SOURCE_REVISION = "a".repeat(64);

const LEGACY_STATE = {
  version: 6,
  apps: {
    "app-1": {
      archivedAt: "",
      migrationExtension: "fixture-app",
    },
  },
  artifactCleanupJobs: {
    "artifact-job-1": {
      id: "artifact-job-1",
      root: "/tmp/swift-sim-cutover-fixture/artifact",
      buildId: "legacy-build-1",
      createdAt: "2026-08-11T08:00:00.000Z",
      nextAttemptAt: "2026-08-11T08:10:00.000Z",
      attempts: 1,
      lastError: "busy",
    },
  },
  deliveryReferenceCleanupJobs: {
    "delivery-job-1": {
      id: "delivery-job-1",
      generation: "fixture-generation",
      referenceID: "fixture-reference",
      buildId: "legacy-build-1",
      createdAt: "2026-08-11T08:00:00.000Z",
      nextAttemptAt: "2026-08-11T08:15:00.000Z",
      attempts: 1,
      lastError: "provider unavailable",
    },
  },
  builds: [
    {
      id: "legacy-build-1",
      ["to" + "ken"]: "fixture",
      remoteBaseUrl: "https://fixture.example.test",
      delivery: {
        mode: "custom",
        provider: "user-configured",
        expiresAt: "2026-08-11T12:00:00.000Z",
      },
      project: "/tmp/Fixture.xcodeproj",
      workspace: "",
      scheme: "Fixture",
      configuration: "Release",
      exportMethod: "development",
      preserveData: true,
      createdAt: "2026-08-11T09:00:00.000Z",
      updatedAt: "2026-08-11T09:01:00.000Z",
      ttlMinutes: 60,
      expiresAt: "2026-08-11T12:00:00.000Z",
      state: "ready",
      app: {
        identity: "app-1",
        name: "Fixture",
        bundleIdentifier: "com.example.fixture",
        version: "1.0",
        build: "1",
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
        root: "/tmp/swift-sim-cutover-fixture/artifact",
        archivePath: "/tmp/swift-sim-cutover-fixture/artifact/Fixture.xcarchive",
        exportPath: "/tmp/swift-sim-cutover-fixture/artifact/export",
        ipaPath: "/tmp/swift-sim-cutover-fixture/artifact/Fixture.ipa",
        manifestPath: "/tmp/swift-sim-cutover-fixture/artifact/manifest.plist",
      },
      logs: ["fixture build output"],
      migrationExtension: { revision: 1 },
    },
  ],
};

export const DEVICE_BUILD_CUTOVER_LEGACY_RAW = `${JSON.stringify(LEGACY_STATE, null, 2)}\n`;

export const DEVICE_BUILD_CUTOVER_OLDER_UNRELATED_RAW = `${JSON.stringify(
  {
    ...LEGACY_STATE,
    version: 5,
    unrelatedHistoricalMetadata: {
      source: "pre-cutover-fixture",
      preserve: true,
    },
  },
  null,
  2,
)}\n`;

export const DEVICE_BUILD_CUTOVER_MALFORMED_RAW = "{ definitely-not-json\n";

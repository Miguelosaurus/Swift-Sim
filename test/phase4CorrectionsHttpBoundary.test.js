import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  handlePublicDeviceBuildCapability,
  setDeviceBuildCapabilityBoundaryFactories,
} from "../mac-helper/src/deviceBuildCapabilityBoundaryPreload.js";
import {
  handlePairingFallback,
  handlePublicBuildLogs,
  setHelperHttpBoundaryFactories,
} from "../mac-helper/src/helperHttpBoundaryPreload.js";
import { Phase4CutoverCoordinator } from "../mac-helper/src/persistence/phase4CutoverCoordinator.js";
import { createPhase4ProductionStoreFactories } from "../mac-helper/src/persistence/phase4ProductionStores.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SqlitePhase4AuthorityRepository } from "../mac-helper/src/persistence/sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const PREPARATION_ID = "a".repeat(64);
const CANDIDATE_SHA = "b".repeat(40);

function responseRecorder() {
  return {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(body = "") {
      this.body += body;
    },
    destroy() {},
  };
}

function fakeSpawnSync(command, args, options) {
  assert.equal(command, "/bin/ps");
  assert.deepEqual(args.slice(-2), ["-o", "lstart="]);
  assert.equal(options.encoding, "utf8");
  return { status: 0, stdout: "Fri Aug 14 13:00:00 2026\n", stderr: "" };
}

function maintenanceEvidence() {
  return {
    exactCandidateSHA: true,
    hostedVerifyGreen: true,
    maintenanceAuthorized: true,
    installedProvenanceVerified: true,
    exactProcessIdentityVerified: true,
    writersQuiesced: true,
    exactDomainLocksAvailable: true,
    privatePermissionsVerified: true,
    liveSourceHashesCaptured: true,
    schemaMigrationsCoherent: true,
    databaseIntegrityWalForeignKeysVerified: true,
    preMigrationDatabaseSnapshotVerified: true,
    legacyBackupsVerified: true,
    migrationReopenIdempotencyVerified: true,
    installedCandidateHelperHealthy: true,
    zeroUnresolvedShadowMismatches: true,
    rollbackReadable: true,
    cleanupDisabledForCutover: true,
    sqliteProcessAuthorityAbsent: true,
    rollbackExecutable: true,
    failClosedAbortClassesVerified: true,
    unrelatedPhaseWorkAbsent: true,
    finalLockedProjectionEquality: true,
    finalFreshnessRecheck: true,
    atomicAuthorityTransitionReady: true,
    candidateSHA: CANDIDATE_SHA,
    verifyRunID: 31848127993,
    processIdentity: { pid: process.pid, startedAt: "Fri Aug 14 13:00:00 2026" },
    shadowMismatchCount: 0,
  };
}

function seedLegacyState(stateRoot) {
  const now = "2026-08-14T10:00:00.000Z";
  const pairing = {
    token: "legacy-pair-token",
    installationID: "installation-1",
    macName: "Boundary Test Mac",
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(join(stateRoot, "pairing.json"), JSON.stringify(pairing), { mode: 0o600 });
  writeFileSync(join(stateRoot, "pairing-invites.json"), JSON.stringify([]), { mode: 0o600 });
  writeFileSync(
    join(stateRoot, "device-builds.json"),
    JSON.stringify({
      version: 6,
      apps: {},
      artifactCleanupJobs: {},
      deliveryReferenceCleanupJobs: {},
      builds: [],
    }),
    { mode: 0o600 },
  );
  writeFileSync(join(stateRoot, "sessions.json"), JSON.stringify({ sessions: [] }), {
    mode: 0o600,
  });
  return pairing;
}

async function withRoot(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-corrections-http-"));
  const stateRoot = join(directory, ".swift-sim");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  try {
    return await operation({ directory, stateRoot });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function activateSqliteRollback(stores, stateRoot) {
  const coordinator = new Phase4CutoverCoordinator({
    database: stores.database,
    stateRoot,
    spawnSync: fakeSpawnSync,
  });
  coordinator.prepare({
    expectedRevision: 0,
    preparationID: PREPARATION_ID,
    maintenanceEvidence: maintenanceEvidence(),
  });
  const prepared = stores.authorityRepository.getState();
  return coordinator.activate({
    expectedRevision: prepared.revision,
    preparationID: prepared.preparationID,
    evidenceHash: prepared.evidenceHash,
    rollbackWindowMs: 60 * 60 * 1000,
    maintenanceEvidence: maintenanceEvidence(),
  });
}

function publishReadyBuild(buildStore, build) {
  const record = buildStore.get(build.id);
  record.state = "ready";
  record.expiresAt = new Date(Date.now() + 60_000).toISOString();
  record.token = "cap-token";
  record.app = {
    ...record.app,
    name: "BoundaryApp",
    bundleIdentifier: "com.example",
    version: "1",
    build: "2",
  };
  record.artifacts = { ...record.artifacts, ipaPath: "/tmp/App.ipa" };
  record.logs = ["Build is ready to install."];
  record.capabilities = [];
  buildStore.save(record);
  return record;
}

test("helper HTTP boundaries route every pairing/build operation through the v9 selector after activation", async () => {
  await withRoot(async ({ stateRoot }) => {
    const legacyPairing = seedLegacyState(stateRoot);
    const pairingPath = join(stateRoot, "pairing.json");
    const devicePath = join(stateRoot, "device-builds.json");
    const pairingBefore = readFileSync(pairingPath);
    const deviceBefore = readFileSync(devicePath);

    const stores = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    setDeviceBuildCapabilityBoundaryFactories({ factory: () => stores });
    setHelperHttpBoundaryFactories({ factory: () => stores });

    // Legacy routing: HTTP reads observe the legacy JSON before activation.
    let response = responseRecorder();
    assert.equal(
      handlePairingFallback(
        { method: "GET", url: "/pair?token=legacy-pair-token", headers: { host: "127.0.0.1" } },
        response,
      ),
      true,
    );
    assert.equal(response.status, 200);

    const activated = activateSqliteRollback(stores, stateRoot);
    assert.equal(activated.authority.mode, "sqlite-rollback");

    // HTTP pairing reads now observe SQLite after a SQLite-side rotation.
    const rotated = stores.createPairingStore().rotate();
    assert.notEqual(rotated.token, legacyPairing.token);
    assert.equal(readFileSync(pairingPath, "utf8"), pairingBefore.toString("utf8"));

    response = responseRecorder();
    assert.equal(
      handlePairingFallback(
        {
          method: "GET",
          url: `/pair?token=${rotated.token}`,
          headers: { host: "127.0.0.1" },
        },
        response,
      ),
      true,
    );
    assert.equal(response.status, 200);
    assert.match(response.body, /installation-1/);
    assert.ok(response.body.includes(rotated.token));

    response = responseRecorder();
    assert.equal(
      handlePairingFallback(
        { method: "GET", url: "/pair?token=legacy-pair-token", headers: { host: "127.0.0.1" } },
        response,
      ),
      true,
    );
    assert.equal(response.status, 401);

    // HTTP device-build reads and writes go through SQLite only.
    const buildStore = stores.createDeviceBuildStore();
    const build = buildStore.create({ scheme: "BoundaryApp" });
    publishReadyBuild(buildStore, build);
    assert.equal(readFileSync(devicePath, "utf8"), deviceBefore.toString("utf8"));

    response = responseRecorder();
    assert.equal(
      handlePublicBuildLogs(
        {
          method: "GET",
          url: `/api/device-builds/${build.id}/logs?token=cap-token`,
          headers: { host: "127.0.0.1" },
        },
        response,
      ),
      true,
    );
    assert.equal(response.status, 200);
    assert.match(response.body, /Build is ready to install/);

    response = responseRecorder();
    assert.equal(
      await handlePublicDeviceBuildCapability(
        {
          method: "POST",
          url: `/api/device-builds/${build.id}/install-request?token=cap-token`,
          headers: { host: "127.0.0.1" },
        },
        response,
        {
          pairingStore: stores.createPairingStore(),
          deviceBuildStore: stores.createDeviceBuildStore(),
        },
      ),
      true,
    );
    assert.equal(response.status, 200);
    assert.equal(readFileSync(devicePath, "utf8"), deviceBefore.toString("utf8"));

    // The boundary holds the routed facade, never a direct legacy store.
    const routedPairing = stores.createPairingStore();
    assert.equal(typeof routedPairing.phase4AuthorityState, "function");
    assert.equal(routedPairing.phase4AuthorityState().mode, "sqlite-rollback");
    const routedBuilds = stores.createDeviceBuildStore();
    assert.equal(typeof routedBuilds.phase4AuthorityState, "function");
    assert.equal(routedBuilds.phase4AuthorityState().mode, "sqlite-rollback");

    stores.database.close();
  });
});

test("selected SQLite failure propagates through the HTTP boundary with no legacy fallback", () => {
  withRoot(({ stateRoot }) => {
    seedLegacyState(stateRoot);
    const stores = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    setHelperHttpBoundaryFactories({ factory: () => stores });
    activateSqliteRollback(stores, stateRoot);
    const buildStore = stores.createDeviceBuildStore();
    const build = buildStore.create({ scheme: "BoundaryApp" });
    publishReadyBuild(buildStore, build);

    stores.database.close();
    const response = responseRecorder();
    assert.throws(
      () =>
        handlePublicBuildLogs(
          {
            method: "GET",
            url: `/api/device-builds/${build.id}/logs?token=cap-token`,
            headers: { host: "127.0.0.1" },
          },
          response,
        ),
      /statement has been finalized|closed/i,
    );
  });
});

test("helper/service reopen in sqlite-rollback mode keeps HTTP reads on SQLite", () => {
  withRoot(({ stateRoot }) => {
    const legacyPairing = seedLegacyState(stateRoot);
    const pairingPath = join(stateRoot, "pairing.json");
    const pairingBefore = readFileSync(pairingPath);

    let stores = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    setHelperHttpBoundaryFactories({ factory: () => stores });
    activateSqliteRollback(stores, stateRoot);
    const rotated = stores.createPairingStore().rotate();
    assert.notEqual(rotated.token, legacyPairing.token);
    stores.database.close();

    stores = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    setHelperHttpBoundaryFactories({ factory: () => stores });
    assert.equal(stores.router.current().mode, "sqlite-rollback");

    const response = responseRecorder();
    assert.equal(
      handlePairingFallback(
        {
          method: "GET",
          url: `/pair?token=${rotated.token}`,
          headers: { host: "127.0.0.1" },
        },
        response,
      ),
      true,
    );
    assert.equal(response.status, 200);
    assert.equal(readFileSync(pairingPath, "utf8"), pairingBefore.toString("utf8"));

    const reopened = new SwiftSimSqliteDatabase({
      path: join(stateRoot, "state.sqlite"),
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
    assert.equal(new SqlitePhase4AuthorityRepository(reopened).getState().mode, "sqlite-rollback");
    reopened.close();
  });
});

test("boundary store creation never leaves a direct legacy pairing/device store reachable", () => {
  withRoot(({ stateRoot }) => {
    seedLegacyState(stateRoot);
    const stores = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    setDeviceBuildCapabilityBoundaryFactories({ factory: () => stores });
    setHelperHttpBoundaryFactories({ factory: () => stores });

    const pairing = stores.createPairingStore();
    const invites = stores.createPairingInviteStore();
    const builds = stores.createDeviceBuildStore();
    for (const store of [pairing, invites, builds]) {
      assert.equal(typeof store.phase4AuthorityState, "function");
      assert.equal(store.phase4AuthorityState().mode, "legacy");
    }
    stores.database.close();
  });
});

test("public device-build capability defaults resolve through the routed boundary after activation", async () => {
  await withRoot(async ({ stateRoot }) => {
    seedLegacyState(stateRoot);
    const stores = createPhase4ProductionStoreFactories({
      stateRoot,
      deviceMaintenance: false,
    });
    setDeviceBuildCapabilityBoundaryFactories({ factory: () => stores });
    activateSqliteRollback(stores, stateRoot);

    const buildStore = stores.createDeviceBuildStore();
    const build = buildStore.create({ scheme: "BoundaryApp" });
    publishReadyBuild(buildStore, build);

    const response = responseRecorder();
    assert.equal(
      await handlePublicDeviceBuildCapability(
        {
          method: "GET",
          url: `/api/device-builds/${build.id}?token=cap-token`,
          headers: { host: "127.0.0.1" },
        },
        response,
      ),
      true,
    );
    assert.equal(response.status, 200);
    assert.match(response.body, /BoundaryApp/);
    stores.database.close();
  });
});

test("explicit boundary dependencies never resolve the production factory", async () => {
  let factoryCalls = 0;
  setDeviceBuildCapabilityBoundaryFactories({
    factory: () => {
      factoryCalls += 1;
      throw new Error("production factory must not resolve");
    },
  });
  setHelperHttpBoundaryFactories({
    factory: () => {
      factoryCalls += 1;
      throw new Error("production factory must not resolve");
    },
  });
  const pairing = { token: "t", installationID: "i", macName: "m", createdAt: "", updatedAt: "" };
  const store = {
    tokenMatches: (token) => token === pairing.token,
    current: () => pairing,
  };
  const builds = { get: () => null };
  const response = responseRecorder();
  assert.equal(
    handlePairingFallback(
      { method: "GET", url: "/pair?token=t", headers: { host: "127.0.0.1" } },
      response,
      store,
      { inspect: () => null },
      { evaluate: () => ({ valid: true, externalBaseURL: "http://127.0.0.1" }) },
    ),
    true,
  );
  assert.equal(response.status, 200);
  assert.equal(
    await handlePublicDeviceBuildCapability(
      {
        method: "GET",
        url: "/api/device-builds/missing?token=x",
        headers: { host: "127.0.0.1" },
      },
      responseRecorder(),
      { pairingStore: store, deviceBuildStore: builds },
    ),
    true,
  );
  assert.equal(factoryCalls, 0);
});

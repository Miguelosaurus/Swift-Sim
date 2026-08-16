import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Phase4CutoverCoordinator } from "../mac-helper/src/persistence/phase4CutoverCoordinator.js";
import {
  bindPhase4MaintenanceEvidence,
  verifyPhase4PreparationBackups,
} from "../mac-helper/src/persistence/phase4MaintenanceEvidence.js";
import { withPhase4MaintenanceDatabase } from "../mac-helper/src/persistence/phase4MaintenanceExecutor.js";
import {
  inspectPhase4HelperProcessIdentity,
  phase4HelperProcessIdentityPath,
} from "../mac-helper/src/persistence/phase4HelperProcessIdentity.js";
import { inspectPhase4MigrationIdentity } from "../mac-helper/src/persistence/phase4MigrationIdentity.js";
import { verifyPhase4PreMigrationSnapshot } from "../mac-helper/src/persistence/phase4MaintenanceSnapshot.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const CANDIDATE_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const HELPER_PID = 900_000_001;
const HELPER_STARTED_AT = "Mon Aug 17 00:00:00 2026";
const PREPARATION_ID = "c".repeat(64);

function evidence(overrides = {}) {
  return {
    exactCandidateSHA: true,
    hostedVerifyGreen: true,
    maintenanceAuthorized: true,
    writersQuiesced: true,
    cleanupDisabledForCutover: true,
    sqliteProcessAuthorityAbsent: true,
    unrelatedPhaseWorkAbsent: true,
    rollbackExecutable: true,
    candidateSHA: CANDIDATE_SHA,
    verifyRunID: 31963902059,
    processIdentity: { pid: HELPER_PID, startedAt: HELPER_STARTED_AT },
    ...overrides,
  };
}

async function withFixture(version, operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-r2-"));
  const stateRoot = join(directory, ".swift-sim");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  const databasePath = join(stateRoot, "state.sqlite");
  seedLegacyState(stateRoot);
  seedHelperJournal(stateRoot);
  const provenancePath = join(directory, "build-provenance.json");
  writeJSON(provenancePath, { version: 1, gitSHA: CANDIDATE_SHA });
  const database = new SwiftSimSqliteDatabase({
    path: databasePath,
    migrations: PHASE4_SQLITE_MIGRATIONS.slice(0, version),
  });
  database.close();
  chmodSync(databasePath, 0o600);
  try {
    return await operation({ directory, stateRoot, databasePath, provenancePath });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function seedLegacyState(stateRoot) {
  const now = "2026-08-17T00:00:00.000Z";
  writeJSON(join(stateRoot, "pairing.json"), {
    token: "legacy-token",
    installationID: "installation-1",
    macName: "Maintenance Test Mac",
    createdAt: now,
    updatedAt: now,
  });
  writeJSON(join(stateRoot, "pairing-invites.json"), []);
  writeJSON(join(stateRoot, "device-builds.json"), {
    version: 6,
    apps: {},
    artifactCleanupJobs: {},
    deliveryReferenceCleanupJobs: {},
    builds: [],
  });
  writeJSON(join(stateRoot, "sessions.json"), {
    sessions: [
      {
        id: "session-1",
        token: "session-token",
        project: "/tmp/App.xcodeproj",
        scheme: "App",
        simulatorUDID: "SIM-1",
        createdAt: now,
        updatedAt: now,
        revision: 1,
        remoteBaseUrl: "",
        orientation: "portrait",
        build: { state: "external-or-not-run" },
        stream: {
          state: "stopped",
          transport: "serve-sim",
          quality: "fallback",
          localUrl: "",
          previewUrl: "",
          wsUrl: "",
          port: 49152,
          pid: 4242,
          raw: {},
          limitations: [],
        },
        logs: [],
      },
    ],
  });
}

function seedHelperJournal(stateRoot, overrides = {}) {
  const path = phase4HelperProcessIdentityPath(stateRoot);
  mkdirSync(join(stateRoot, "runtime"), { recursive: true, mode: 0o700 });
  writeJSON(path, {
    version: 1,
    role: "swift-sim-helper",
    pid: HELPER_PID,
    startedAt: HELPER_STARTED_AT,
    ...overrides,
  });
}

function writeJSON(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function absentHelperSpawn(command, args, options) {
  assert.equal(command, "/bin/ps");
  assert.deepEqual(args, ["-p", String(HELPER_PID), "-o", "lstart="]);
  assert.equal(options.encoding, "utf8");
  return { status: 1, stdout: "", stderr: "" };
}

function runningHelperSpawn(command, args, options) {
  assert.equal(command, "/bin/ps");
  assert.deepEqual(args, ["-p", String(HELPER_PID), "-o", "lstart="]);
  assert.equal(options.encoding, "utf8");
  return { status: 0, stdout: `${HELPER_STARTED_AT}\n`, stderr: "" };
}

function reusedPidSpawn(command, args, options) {
  assert.equal(command, "/bin/ps");
  assert.deepEqual(args, ["-p", String(HELPER_PID), "-o", "lstart="]);
  assert.equal(options.encoding, "utf8");
  return { status: 0, stdout: "Mon Aug 17 00:01:00 2026\n", stderr: "" };
}

function schemaVersion(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return Number(
      database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version || 0,
    );
  } finally {
    database.close();
  }
}

async function assertBlockedBeforeMigration(version, mutate, expected = /Phase-4/i) {
  await withFixture(version, async ({ stateRoot, databasePath, provenancePath }) => {
    await mutate({ stateRoot, databasePath, provenancePath });
    let opens = 0;
    await assert.rejects(
      withPhase4MaintenanceDatabase(
        {
          stateRoot,
          evidence: evidence(),
          stage: "prepare",
          spawnSync: absentHelperSpawn,
          provenancePath,
          openDatabase() {
            opens += 1;
            return new SwiftSimSqliteDatabase({
              path: databasePath,
              migrations: PHASE4_SQLITE_MIGRATIONS,
            });
          },
        },
        () => null,
      ),
      expected,
    );
    assert.equal(opens, 0, "migration-capable owner must not be constructed");
    assert.equal(schemaVersion(databasePath), version, "v9 must not be written before preflight");
  });
}

for (const version of [7, 8]) {
  test(`valid disposable v${version} reaches migration only after all pre-migration gates`, async () => {
    await withFixture(version, async ({ stateRoot, databasePath, provenancePath }) => {
      let opens = 0;
      const result = await withPhase4MaintenanceDatabase(
        {
          stateRoot,
          evidence: evidence(),
          stage: "prepare",
          spawnSync: absentHelperSpawn,
          provenancePath,
          openDatabase() {
            opens += 1;
            return new SwiftSimSqliteDatabase({
              path: databasePath,
              migrations: PHASE4_SQLITE_MIGRATIONS,
            });
          },
        },
        (_database, bound) => ({
          schemaVersion: bound.measured.schemaVersion,
          snapshot: bound.measured.snapshot,
          reopen: bound.measured.migrationReopenIdempotencyVerified,
          permissionsMissing: bound.measured.permissionsMissing,
          measuredHasHostedVerify: Object.hasOwn(bound.measured, "hostedVerifyGreen"),
        }),
      );
      assert.equal(opens, 3);
      assert.equal(result.schemaVersion, 9);
      assert.equal(result.snapshot.verified, true);
      assert.match(result.snapshot.sha256, /^[a-f0-9]{64}$/);
      assert.equal(result.reopen, true);
      assert.deepEqual(result.permissionsMissing, []);
      assert.equal(result.measuredHasHostedVerify, false);
      assert.equal(schemaVersion(databasePath), 9);
      assert.equal(
        inspectPhase4MigrationIdentity(databasePath, {
          allowedVersions: [9],
          requireFull: true,
          requireWal: true,
        }).full,
        true,
      );
    });
  });
}

test("valid v8 preparation proves exact backups for all four legacy sources", async () => {
  await withFixture(8, async ({ stateRoot, databasePath, provenancePath }) => {
    const prepared = await withPhase4MaintenanceDatabase(
      {
        stateRoot,
        evidence: evidence(),
        stage: "prepare",
        spawnSync: absentHelperSpawn,
        provenancePath,
      },
      (database, bound) => {
        const result = new Phase4CutoverCoordinator({
          database,
          stateRoot,
          spawnSync: absentHelperSpawn,
        }).prepare({
          expectedRevision: 0,
          preparationID: PREPARATION_ID,
          maintenanceEvidence: bound,
        });
        const backupProof = verifyPhase4PreparationBackups({
          stateRoot,
          domains: result.domains,
          sourceHashes: bound.measured.sourceHashes,
        });
        return { result, backupProof };
      },
    );
    assert.equal(prepared.result.authority.mode, "preparing");
    assert.equal(prepared.backupProof.verified, true);
    assert.equal(prepared.backupProof.count, 4);
    assert.deepEqual(
      prepared.backupProof.proofs.map((proof) => proof.role).sort(),
      ["credential", "deviceBuilds", "invitations", "sessions"],
    );
    assert.ok(prepared.backupProof.proofs.every((proof) => proof.equal));
    assert.equal(schemaVersion(databasePath), 9);
  });
});

test("empty permissionsMissing is success, while a private-permission defect fails closed", async () => {
  await withFixture(8, async ({ stateRoot, provenancePath }) => {
    const bound = bindPhase4MaintenanceEvidence(evidence(), "prepare", {
      stateRoot,
      spawnSync: absentHelperSpawn,
      provenancePath,
    });
    assert.deepEqual(bound.measured.permissionsMissing, []);
    assert.equal(bound.measured.privatePermissionsVerified, true);

    chmodSync(join(stateRoot, "sessions.json"), 0o644);
    assert.throws(
      () =>
        bindPhase4MaintenanceEvidence(evidence({ privatePermissionsVerified: true }), "prepare", {
          stateRoot,
          spawnSync: absentHelperSpawn,
          provenancePath,
        }),
      /privatePermissionsVerified|pre-migration maintenance condition/i,
    );
  });
});

test("candidate provenance is measured from the installed manifest, not echoed evidence", async () => {
  await withFixture(8, async ({ stateRoot, provenancePath }) => {
    writeJSON(provenancePath, { version: 1, gitSHA: OTHER_SHA });
    assert.throws(
      () =>
        bindPhase4MaintenanceEvidence(evidence({ installedProvenanceVerified: true }), "prepare", {
          stateRoot,
          spawnSync: absentHelperSpawn,
          provenancePath,
        }),
      /installedProvenanceVerified|pre-migration maintenance condition/i,
    );
  });
});

test("helper identity distinguishes running, absent, PID reuse, and stale journal", async () => {
  await withFixture(8, async ({ stateRoot }) => {
    const expectedIdentity = { pid: HELPER_PID, startedAt: HELPER_STARTED_AT };
    assert.deepEqual(
      {
        state: inspectPhase4HelperProcessIdentity({
          stateRoot,
          spawnSync: absentHelperSpawn,
          expectedIdentity,
        }).state,
        quiesced: inspectPhase4HelperProcessIdentity({
          stateRoot,
          spawnSync: absentHelperSpawn,
          expectedIdentity,
        }).helperQuiesced,
      },
      { state: "absent", quiesced: true },
    );
    assert.equal(
      inspectPhase4HelperProcessIdentity({
        stateRoot,
        spawnSync: runningHelperSpawn,
        expectedIdentity,
      }).state,
      "running",
    );
    assert.equal(
      inspectPhase4HelperProcessIdentity({
        stateRoot,
        spawnSync: reusedPidSpawn,
        expectedIdentity,
      }).state,
      "pid-reused",
    );
    assert.equal(
      inspectPhase4HelperProcessIdentity({
        stateRoot,
        spawnSync: absentHelperSpawn,
        expectedIdentity: { pid: HELPER_PID, startedAt: "wrong" },
      }).state,
      "stale-journal",
    );
  });
});

test("helper PID/start mismatch and a non-quiesced helper block before migration", async () => {
  await assertBlockedBeforeMigration(
    8,
    async ({ stateRoot }) => seedHelperJournal(stateRoot, { startedAt: "different" }),
    /exactProcessIdentityVerified|pre-migration maintenance condition/i,
  );
  await withFixture(8, async ({ stateRoot, databasePath, provenancePath }) => {
    let opens = 0;
    await assert.rejects(
      withPhase4MaintenanceDatabase(
        {
          stateRoot,
          evidence: evidence(),
          stage: "prepare",
          spawnSync: runningHelperSpawn,
          provenancePath,
          openDatabase() {
            opens += 1;
            return new SwiftSimSqliteDatabase({
              path: databasePath,
              migrations: PHASE4_SQLITE_MIGRATIONS,
            });
          },
        },
        () => null,
      ),
      /helperQuiesced|pre-migration maintenance condition/i,
    );
    assert.equal(opens, 0);
    assert.equal(schemaVersion(databasePath), 8);
  });
});

test("migration version, name, order, checksum, and schema-ahead defects fail before migration", async (t) => {
  const cases = [
    ["version gap", (db) => db.exec("UPDATE schema_migrations SET version = 9 WHERE version = 7")],
    ["name replacement", (db) => db.exec("UPDATE schema_migrations SET name = 'replaced' WHERE version = 7")],
    [
      "order replacement",
      (db) =>
        db.exec(
          "UPDATE schema_migrations SET name = 'temporary' WHERE version = 6; UPDATE schema_migrations SET name = 'device_build_domain_state' WHERE version = 7; UPDATE schema_migrations SET name = 'device_build_shadow_mismatch_evidence' WHERE version = 6",
        ),
    ],
    [
      "checksum replacement",
      (db) => db.exec(`UPDATE schema_migrations SET checksum = '${"0".repeat(64)}' WHERE version = 7`),
    ],
    [
      "schema ahead",
      (db) =>
        db.exec(
          `INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (10, 'future', '${"1".repeat(64)}', '2026-08-17T00:00:00.000Z')`,
        ),
    ],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      await assertBlockedBeforeMigration(7, async ({ databasePath }) => {
        const database = new DatabaseSync(databasePath);
        try {
          mutate(database);
        } finally {
          database.close();
        }
      });
    });
  }
});

test("a required migration query failure blocks instead of becoming benign state", async () => {
  await assertBlockedBeforeMigration(8, async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("ALTER TABLE schema_migrations RENAME TO schema_migrations_unreadable");
    } finally {
      database.close();
    }
  }, /schema_migrations|no such table/i);
});

test("a forged zero-shadow boolean cannot hide a real mismatch", async () => {
  await assertBlockedBeforeMigration(8, async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      database
        .prepare(
          `INSERT INTO device_build_shadow_mismatches(
             mismatch_id, surface, key_hash, legacy_projection_hash, sqlite_projection_hash,
             first_observed_at, last_observed_at, observation_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "1".repeat(64),
          "build",
          "2".repeat(64),
          "3".repeat(64),
          "4".repeat(64),
          "2026-08-17T00:00:00.000Z",
          "2026-08-17T00:00:00.000Z",
          1,
        );
    } finally {
      database.close();
    }
  }, /zeroUnresolvedShadowMismatches|pre-migration maintenance condition/i);
});

test("invalid or inconsistent snapshot bytes fail closed when reopened", async () => {
  await withFixture(7, async ({ directory, databasePath }) => {
    const expectedMigration = inspectPhase4MigrationIdentity(databasePath, {
      allowedVersions: [7],
      requireWal: true,
    });
    const snapshotPath = join(directory, "invalid.sqlite");
    writeFileSync(snapshotPath, Buffer.from("not-a-sqlite-database"), { mode: 0o600 });
    chmodSync(snapshotPath, 0o600);
    assert.throws(
      () => verifyPhase4PreMigrationSnapshot({ snapshotPath, expectedMigration }),
      /SQLite|database|migration|file is not a database/i,
    );
    assert.equal(schemaVersion(databasePath), 7);
  });
});

test("each of the four legacy backups is mandatory and must be byte-identical", async (t) => {
  const roles = ["credential", "invitations", "deviceBuilds", "sessions"];
  for (const role of roles) {
    await t.test(role, async () => {
      await withFixture(8, async ({ directory, stateRoot, provenancePath }) => {
        const bound = bindPhase4MaintenanceEvidence(evidence(), "prepare", {
          stateRoot,
          spawnSync: absentHelperSpawn,
          provenancePath,
        });
        const backupDir = join(directory, "backups");
        mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        const paths = {
          credential: join(backupDir, "credential-pairing.json.test.bak"),
          invitations: join(backupDir, "invitations-pairing-invites.json.test.bak"),
          deviceBuilds: join(backupDir, "device-build-device-builds.json.test.bak"),
          sessions: join(backupDir, "sessions-sessions.json.test.bak"),
        };
        const sourceNames = {
          credential: "pairing.json",
          invitations: "pairing-invites.json",
          deviceBuilds: "device-builds.json",
          sessions: "sessions.json",
        };
        for (const key of roles) {
          copyFileSync(join(stateRoot, sourceNames[key]), paths[key]);
          chmodSync(paths[key], 0o600);
        }
        const domains = {
          pairing: { backups: [paths.credential, paths.invitations] },
          deviceBuild: { backups: [paths.deviceBuilds] },
          sessions: { backups: [paths.sessions] },
        };
        const good = verifyPhase4PreparationBackups({
          stateRoot,
          domains,
          sourceHashes: bound.measured.sourceHashes,
        });
        assert.equal(good.count, 4);

        if (role === "sessions" || role === "invitations") {
          unlinkSync(paths[role]);
        } else {
          writeFileSync(paths[role], Buffer.from("mismatch"), { mode: 0o600 });
        }
        assert.throws(
          () =>
            verifyPhase4PreparationBackups({
              stateRoot,
              domains,
              sourceHashes: bound.measured.sourceHashes,
            }),
          /backup|ENOENT|bytes/i,
        );
      });
    });
  }
});

test("source hash proof is cryptographic over exact bytes", async () => {
  await withFixture(8, async ({ stateRoot, provenancePath }) => {
    const bound = bindPhase4MaintenanceEvidence(evidence(), "prepare", {
      stateRoot,
      spawnSync: absentHelperSpawn,
      provenancePath,
    });
    const bytes = readFileSync(join(stateRoot, "sessions.json"));
    assert.equal(
      bound.measured.sourceHashes.sessions.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.equal(bound.measured.sourceHashes.sessions.byteLength, bytes.length);
  });
});

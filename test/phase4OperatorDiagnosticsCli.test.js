import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync as readBytes,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPhase4OperatorDiagnostics } from "../mac-helper/src/commands/phase4OperatorDiagnostics.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const cli = new URL("../mac-helper/bin/swift-sim.js", import.meta.url);

const healthyFixture = Object.freeze({
  repositoryHealth: {
    value: {
      ok: true,
      integrity: "ok",
      journalMode: "wal",
      foreignKeys: true,
      foreignKeyViolations: 0,
      missingTables: [],
      schemaVersion: 8,
      latestSchemaVersion: 8,
      migrationsApplied: 8,
    },
  },
  migration: { value: { status: "already-current", recordCount: 4 } },
  shadow: { value: { enabled: true, mismatchCount: 0, observationCount: 12 } },
  compatibility: {
    value: {
      state: "compatible",
      legacyReadable: true,
      sqliteReadable: true,
      rollbackReadable: true,
    },
  },
  artifactStorage: {
    value: {
      readOnly: true,
      cleanupEnabled: false,
      measurementComplete: true,
      totalKiB: 256,
      reclaimableKiB: 64,
      protectedKiB: 192,
      manualReviewKiB: 0,
      orphanRootCount: 0,
      measurementIssueCount: 0,
    },
  },
});

test("doctor --json exposes healthy accepted Phase-4 support diagnostics without mutation", () => {
  withDoctorFixture(structuredClone(healthyFixture), ({ report, before, after, fixtureBefore, fixtureAfter }) => {
    const phase4 = report.storage.phase4Support;
    assert.equal(phase4.version, 1);
    assert.equal(phase4.readOnly, true);
    assert.equal(phase4.redacted, true);
    assert.equal(phase4.mutationAllowed, false);
    assert.equal(phase4.overall, "healthy");
    assert.equal(phase4.database.status, "healthy");
    assert.equal(phase4.migration.status, "healthy");
    assert.equal(phase4.shadow.status, "healthy");
    assert.equal(phase4.compatibility.status, "healthy");
    assert.equal(phase4.artifactStorage.status, "healthy");
    assert.deepEqual(before, after);
    assert.deepEqual(fixtureBefore, fixtureAfter);
  });
});

test("doctor classifies corrupt, incompatible, permission, busy, and unavailable database failures with recovery guidance", () => {
  const cases = [
    ["corrupt", { message: "/Users/private/state.sqlite is malformed: not a database" }],
    ["incompatible", { message: "SQLite schema version 9 is newer than this Swift Sim build" }],
    ["permission-denied", { code: "EACCES", message: "permission denied /Users/private/state.sqlite" }],
    ["busy", { code: "SQLITE_BUSY", message: "database is locked /Users/private/state.sqlite" }],
    ["unavailable", { code: "ENOENT", message: "database unavailable /Users/private/state.sqlite" }],
  ];

  for (const [category, failure] of cases) {
    const fixture = structuredClone(healthyFixture);
    fixture.repositoryHealth = { throw: failure };
    withDoctorFixture(fixture, ({ report, raw, before, after, fixtureBefore, fixtureAfter }) => {
      const phase4 = report.storage.phase4Support;
      assert.equal(phase4.database.failureCategory, category);
      assert.equal(phase4.readOnly, true);
      assert.equal(phase4.redacted, true);
      assert.equal(phase4.mutationAllowed, false);
      assert.ok(phase4.recovery.actionCodes.length > 0, `${category} should offer recovery guidance`);
      assert.doesNotMatch(raw, /Users\/private\/state\.sqlite/);
      assert.deepEqual(before, after);
      assert.deepEqual(fixtureBefore, fixtureAfter);
    });
  }
});

test("doctor reports artifact orphan/manual-review evidence without enabling cleanup", () => {
  const fixture = structuredClone(healthyFixture);
  fixture.artifactStorage.value = {
    ...fixture.artifactStorage.value,
    measurementComplete: true,
    manualReviewKiB: 96,
    orphanRootCount: 2,
  };
  withDoctorFixture(fixture, ({ report, before, after, fixtureBefore, fixtureAfter }) => {
    const phase4 = report.storage.phase4Support;
    assert.equal(phase4.artifactStorage.status, "attention");
    assert.equal(phase4.artifactStorage.orphanRootCount, 2);
    assert.equal(phase4.artifactStorage.manualReviewKiB, 96);
    assert.equal(phase4.artifactStorage.cleanupEnabled, false);
    assert.equal(phase4.mutationAllowed, false);
    assert.ok(phase4.recovery.actionCodes.length > 0);
    assert.deepEqual(before, after);
    assert.deepEqual(fixtureBefore, fixtureAfter);
  });
});

test("human doctor output includes the read-only Phase-4 health and recovery summary", () => {
  withDoctorFixture(structuredClone(healthyFixture), ({ directory, fixturePath, sentinelPath }) => {
    const result = spawnSync(process.execPath, [cli.pathname, "doctor"], {
      encoding: "utf8",
      env: doctorEnv(directory, fixturePath),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Phase-4 support: healthy/);
    assert.match(result.stdout, /recovery=none/);
    assert.match(result.stdout, /Evidence is read-only, redacted, and mutation-disabled/);
    assert.equal(readBytes(sentinelPath, "utf8"), "preserve-authority\n");
  });
});

test("real v8 operator diagnostics preserve authoritative SQLite bytes and keep WAL coordination private", () => {
  withRealPhase4Database(({ stateRoot, databasePath }) => {
    const before = readBytes(databasePath);
    assert.equal(existsSync(`${databasePath}-wal`), false);
    assert.equal(existsSync(`${databasePath}-shm`), false);

    const report = collectWithoutFixture({
      stateRoot,
      artifactAudit: structuredClone(healthyFixture.artifactStorage.value),
    });

    assert.equal(report.readOnly, true);
    assert.equal(report.mutationAllowed, false);
    assert.equal(report.database.status, "healthy");
    assert.deepEqual(readBytes(databasePath), before);

    const walPath = `${databasePath}-wal`;
    const shmPath = `${databasePath}-shm`;
    if (existsSync(walPath)) {
      assert.equal(statSync(walPath).size, 0, "read-only diagnostics must not append WAL records");
      assert.equal(statSync(walPath).mode & 0o077, 0, "diagnostic WAL must remain private");
    }
    if (existsSync(shmPath)) {
      assert.equal(statSync(shmPath).mode & 0o077, 0, "diagnostic SHM must remain private");
    }
  });
});

test("real operator diagnostics reject a non-private SQLite database before opening it", () => {
  withRealPhase4Database(({ stateRoot, databasePath }) => {
    chmodSync(databasePath, 0o644);
    const before = readBytes(databasePath);

    const report = collectWithoutFixture({
      stateRoot,
      artifactAudit: structuredClone(healthyFixture.artifactStorage.value),
    });

    assert.equal(report.database.available, false);
    assert.equal(report.database.failureCategory, "permission-denied");
    assert.deepEqual(readBytes(databasePath), before);
    assert.equal(existsSync(`${databasePath}-wal`), false);
    assert.equal(existsSync(`${databasePath}-shm`), false);
  });
});

function withDoctorFixture(fixture, assertion) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-doctor-"));
  const fixturePath = join(directory, "phase4-fixture.json");
  const sentinelPath = join(directory, "authority-sentinel.txt");
  writeFileSync(fixturePath, JSON.stringify(fixture));
  writeFileSync(sentinelPath, "preserve-authority\n");
  const before = readBytes(sentinelPath);
  const fixtureBefore = readBytes(fixturePath);
  try {
    const result = spawnSync(process.execPath, [cli.pathname, "doctor", "--json"], {
      encoding: "utf8",
      env: doctorEnv(directory, fixturePath),
    });
    assert.equal(result.status, 0, result.stderr);
    const raw = result.stdout;
    const report = JSON.parse(raw);
    const after = readBytes(sentinelPath);
    const fixtureAfter = readBytes(fixturePath);
    assertion({ report, raw, before, after, fixtureBefore, fixtureAfter, directory, fixturePath, sentinelPath });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function withRealPhase4Database(assertion) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-real-diagnostics-"));
  const stateRoot = join(directory, ".swift-sim");
  const databasePath = join(stateRoot, "state.sqlite");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  let database;
  const previousUmask = process.umask(0o077);
  try {
    database = new SwiftSimSqliteDatabase({
      path: databasePath,
      migrations: PHASE4_SQLITE_MIGRATIONS,
      now: () => "2026-08-14T00:00:00.000Z",
    });
  } finally {
    process.umask(previousUmask);
  }
  database.close();
  chmodSync(databasePath, 0o600);
  try {
    assertion({ directory, stateRoot, databasePath });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function collectWithoutFixture(options) {
  const previousFixture = process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
  try {
    delete process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
    return collectPhase4OperatorDiagnostics(options);
  } finally {
    if (previousFixture === undefined) {
      delete process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE;
    } else {
      process.env.SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE = previousFixture;
    }
  }
}

function doctorEnv(directory, fixturePath) {
  return {
    ...process.env,
    NODE_ENV: "test",
    HOME: directory,
    SWIFT_SIM_PHASE4_DIAGNOSTICS_FIXTURE: fixturePath,
    SWIFT_SIM_DISABLE_CODEX: "1",
    SWIFT_SIM_DISABLE_CURSOR: "1",
    SWIFT_SIM_DISABLE_CLAUDE: "1",
    SWIFT_SIM_DISABLE_OPENCODE: "1",
  };
}

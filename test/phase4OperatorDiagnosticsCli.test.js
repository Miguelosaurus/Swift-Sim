import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  withDoctorFixture(structuredClone(healthyFixture), ({ report, before, after }) => {
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
  });
});

test("doctor classifies corrupt, incompatible, permission, and busy database failures with recovery guidance", () => {
  const cases = [
    ["corrupt", { message: "/Users/private/state.sqlite is malformed: not a database" }],
    ["incompatible", { message: "SQLite schema version 9 is newer than this Swift Sim build" }],
    ["permission-denied", { code: "EACCES", message: "permission denied /Users/private/state.sqlite" }],
    ["busy", { code: "SQLITE_BUSY", message: "database is locked /Users/private/state.sqlite" }],
  ];

  for (const [category, failure] of cases) {
    const fixture = structuredClone(healthyFixture);
    fixture.repositoryHealth = { throw: failure };
    withDoctorFixture(fixture, ({ report, raw, before, after }) => {
      const phase4 = report.storage.phase4Support;
      assert.equal(phase4.database.failureCategory, category);
      assert.equal(phase4.readOnly, true);
      assert.equal(phase4.redacted, true);
      assert.equal(phase4.mutationAllowed, false);
      assert.ok(phase4.recovery.actionCodes.length > 0, `${category} should offer recovery guidance`);
      assert.doesNotMatch(raw, /Users\/private\/state\.sqlite/);
      assert.deepEqual(before, after);
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
  withDoctorFixture(fixture, ({ report, before, after }) => {
    const phase4 = report.storage.phase4Support;
    assert.equal(phase4.artifactStorage.status, "attention");
    assert.equal(phase4.artifactStorage.orphanRootCount, 2);
    assert.equal(phase4.artifactStorage.manualReviewKiB, 96);
    assert.equal(phase4.artifactStorage.cleanupEnabled, false);
    assert.equal(phase4.mutationAllowed, false);
    assert.ok(phase4.recovery.actionCodes.length > 0);
    assert.deepEqual(before, after);
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
    assert.match(result.stdout, /Evidence is read-only, redacted, and mutation-disabled/);
    assert.equal(readFileSync(sentinelPath, "utf8"), "preserve-authority\n");
  });
});

function withDoctorFixture(fixture, assertion) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-phase4-doctor-"));
  const fixturePath = join(directory, "phase4-fixture.json");
  const sentinelPath = join(directory, "authority-sentinel.txt");
  writeFileSync(fixturePath, JSON.stringify(fixture));
  writeFileSync(sentinelPath, "preserve-authority\n");
  const before = readFileSync(sentinelPath);
  try {
    const result = spawnSync(process.execPath, [cli.pathname, "doctor", "--json"], {
      encoding: "utf8",
      env: doctorEnv(directory, fixturePath),
    });
    assert.equal(result.status, 0, result.stderr);
    const raw = result.stdout;
    const report = JSON.parse(raw);
    const after = readFileSync(sentinelPath);
    assertion({ report, raw, before, after, directory, fixturePath, sentinelPath });
  } finally {
    rmSync(directory, { recursive: true, force: true });
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

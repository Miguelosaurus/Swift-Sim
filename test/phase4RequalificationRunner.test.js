import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SqlitePhase4AuthorityRepository } from "../mac-helper/src/persistence/sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";
import { readStateBytes } from "./fixtures/state-bytes.js";

const RUNNER = fileURLToPath(new URL("../scripts/phase4/requalify-state.mjs", import.meta.url));
const THIS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_ROOT = existsSync(join(THIS_ROOT, "tsconfig.json")) ? THIS_ROOT : dirname(THIS_ROOT);
const SHA = "a".repeat(40);
let template;
let templateParent;

before(() => {
  // Compile into a disposable package, independent of root/dist freshness and
  // source-test ordering. Every child runs the actual installed-boundary API.
  templateParent = mkdtempSync(join(tmpdir(), "swift-sim-runner-package-"));
  template = join(templateParent, "candidate");
  const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
  const compiled = spawnSync(
    process.execPath,
    [
      tsc,
      "--project",
      join(SOURCE_ROOT, "tsconfig.json"),
      "--outDir",
      join(template, "dist"),
      "--sourceMap",
      "false",
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  writeJSON(join(template, "package.json"), { type: "module" });
  writeJSON(join(template, "dist", "mac-helper", "build-provenance.json"), {
    version: 1,
    gitSHA: SHA,
  });
});
after(() => {
  if (templateParent) rmSync(templateParent, { recursive: true, force: true });
});

function writeJSON(path, value) {
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
}
function fixture(version = 8) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-requalification-"));
  const candidateRoot = join(directory, "candidate");
  const stateRoot = join(directory, "state");
  mkdirSync(candidateRoot, { mode: 0o700 });
  cpSync(join(template, "dist", "mac-helper"), join(candidateRoot, "dist", "mac-helper"), {
    recursive: true,
  });
  writeJSON(join(candidateRoot, "package.json"), { type: "module" });
  mkdirSync(stateRoot, { mode: 0o700 });
  const databasePath = join(stateRoot, "state.sqlite");
  const database = new SwiftSimSqliteDatabase({
    path: databasePath,
    migrations: PHASE4_SQLITE_MIGRATIONS.slice(0, version),
  });
  database.close();
  chmodSync(databasePath, 0o600);
  writeJSON(join(stateRoot, "pairing.json"), {
    installationID: "private-installation",
    token: "SECRET_PAIRING_TOKEN",
    macName: "Mac",
    createdAt: "2026-10-29T12:00:00.000Z",
    updatedAt: "2026-10-29T12:00:00.000Z",
  });
  writeJSON(join(stateRoot, "pairing-invites.json"), []);
  writeJSON(join(stateRoot, "device-builds.json"), {
    version: 6,
    apps: {},
    builds: [],
    artifactCleanupJobs: {},
    deliveryReferenceCleanupJobs: {},
  });
  writeJSON(join(stateRoot, "sessions.json"), { sessions: [] });
  mkdirSync(join(stateRoot, "runtime"), { mode: 0o700 });
  const retired = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {spawnSync} from "node:child_process";
    const observed = spawnSync("/bin/ps", ["-p", String(process.pid), "-o", "lstart="], {encoding: "utf8"});
    if (observed.status !== 0 || !observed.stdout.trim()) process.exit(1);
    process.stdout.write(JSON.stringify({pid: process.pid, startedAt: observed.stdout.trim()}));
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(retired.status, 0, retired.stderr);
  const identity = JSON.parse(retired.stdout);
  writeJSON(join(stateRoot, "runtime", "helper-process-identity.json"), {
    version: 1,
    role: "swift-sim-helper",
    pid: identity.pid,
    startedAt: identity.startedAt,
  });
  const evidence = {
    candidateSHA: SHA,
    verifyRunID: 42,
    exactCandidateSHA: true,
    hostedVerifyGreen: true,
    maintenanceAuthorized: true,
    writersQuiesced: true,
    cleanupDisabledForCutover: true,
    sqliteProcessAuthorityAbsent: true,
    unrelatedPhaseWorkAbsent: true,
    processIdentity: identity,
  };
  const evidenceFile = join(directory, "evidence.json");
  const outputFile = join(directory, "result.json");
  writeJSON(evidenceFile, evidence);
  return { directory, candidateRoot, stateRoot, databasePath, evidence, evidenceFile, outputFile };
}
function run(options, extra = []) {
  return spawnSync(
    process.execPath,
    [
      RUNNER,
      "--candidate-root",
      options.candidateRoot,
      "--state-root",
      options.stateRoot,
      "--evidence-file",
      options.evidenceFile,
      "--output-file",
      options.outputFile,
      ...extra,
    ],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, HOME: options.directory } },
  );
}
function report(options) {
  return JSON.parse(readStateBytes(options.outputFile).toString());
}

for (const version of [7, 8]) {
  test(`operator runner migrates disposable v${version} without preparation or authority activation`, (t) => {
    const f = fixture(version);
    t.after(() => rmSync(f.directory, { recursive: true, force: true }));
    const before = Object.fromEntries(
      ["pairing.json", "pairing-invites.json", "device-builds.json", "sessions.json"].map(
        (name) => [name, readStateBytes(join(f.stateRoot, name))],
      ),
    );
    const result = run(f);
    assert.equal(result.status, 0, `${result.stderr} ${JSON.stringify(report(f))}`);
    const value = report(f);
    assert.equal(value.status, "passed");
    assert.equal(value.candidateSHA, SHA);
    assert.equal(value.verifyRunID, 42);
    assert.equal(value.before.schemaVersion, version);
    assert.equal(value.after.schemaVersion, 9);
    assert.equal(value.databaseHealth.ok, true);
    assert.equal(value.snapshot.verified, true);
    assert.equal(value.snapshot.schemaVersion, version);
    assert.match(value.snapshot.sha256, /^[a-f0-9]{64}$/);
    assert.equal(value.migrationReopenIdempotencyVerified, true);
    assert.equal(value.noAuthorityTransition, true);
    assert.equal(value.noPreparation, true);
    assert.equal(value.after.authority.mode, "legacy");
    assert.equal(value.after.authority.revision, 0);
    assert.equal(value.helperStarted, false);
    assert.equal(value.cleanupInvoked, false);
    assert.equal(statSync(f.outputFile).mode & 0o777, 0o600);
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /SECRET_PAIRING_TOKEN|private-installation/);
    assert.equal(serialized.includes(f.directory), false);
    for (const [name, bytes] of Object.entries(before))
      assert.deepEqual(readStateBytes(join(f.stateRoot, name)), bytes);
  });
}

test("candidate SHA mismatch blocks before candidate APIs or database mutation", (t) => {
  const f = fixture();
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  writeJSON(f.evidenceFile, { ...f.evidence, candidateSHA: "b".repeat(40) });
  // Removing an entry module proves a mismatched manifest fails before loading it.
  rmSync(
    join(
      f.candidateRoot,
      "dist",
      "mac-helper",
      "src",
      "persistence",
      "phase4MaintenanceExecutor.js",
    ),
  );
  const bytes = readStateBytes(f.databasePath);
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.equal(report(f).failedAt, "candidate-provenance");
  assert.equal(report(f).migrationMayHaveOccurred, false);
  assert.deepEqual(readStateBytes(f.databasePath), bytes);
});

test("runner rejects existing preparing authority before migration or snapshots", (t) => {
  const f = fixture(9);
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const database = new SwiftSimSqliteDatabase({
    path: f.databasePath,
    migrations: PHASE4_SQLITE_MIGRATIONS,
  });
  new SqlitePhase4AuthorityRepository(database).beginPreparation({
    expectedRevision: 0,
    evidence: { fixture: true },
    preparationID: "c".repeat(64),
  });
  database.close();
  const bytes = readStateBytes(f.databasePath);
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.equal(report(f).failedAt, "read-only-inspection");
  assert.equal(report(f).migrationMayHaveOccurred, false);
  assert.deepEqual(readStateBytes(f.databasePath), bytes);
  assert.equal(existsSync(join(f.stateRoot, "migration-backups")), false);
});

test("runner is one-shot and never overwrites existing evidence", (t) => {
  const f = fixture();
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  writeJSON(f.outputFile, { preserve: true });
  const bytes = readStateBytes(f.databasePath);
  assert.notEqual(run(f).status, 0);
  assert.deepEqual(report(f), { preserve: true });
  assert.deepEqual(readStateBytes(f.databasePath), bytes);
});

test("runner requires explicit absolute paths and refuses an authority action", () => {
  const result = spawnSync(process.execPath, [RUNNER, "--state-root", "relative", "--activate"], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
});

test("runner preserves legitimate missing invitation/session files", (t) => {
  const f = fixture();
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  for (const file of ["pairing-invites.json", "sessions.json"]) rmSync(join(f.stateRoot, file));
  const result = run(f);
  assert.equal(result.status, 0, `${result.stderr} ${JSON.stringify(report(f))}`);
  const value = report(f);
  assert.deepEqual(value.before.legacySources.invitations, { present: false });
  assert.deepEqual(value.after.legacySources.sessions, { present: false });
  assert.equal(value.legacySourcesPreserved, true);
  assert.equal(existsSync(join(f.stateRoot, "pairing-invites.json")), false);
  assert.equal(existsSync(join(f.stateRoot, "sessions.json")), false);
});

test("runner preserves an existing legacy authority revision", (t) => {
  const f = fixture(9);
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const database = new SwiftSimSqliteDatabase({
    path: f.databasePath,
    migrations: PHASE4_SQLITE_MIGRATIONS,
  });
  const repository = new SqlitePhase4AuthorityRepository(database);
  const prepared = repository.beginPreparation({
    expectedRevision: 0,
    evidence: { fixture: true },
    preparationID: "c".repeat(64),
  });
  repository.cancelPreparation({
    expectedRevision: prepared.revision,
    preparationID: prepared.preparationID,
  });
  database.close();
  const result = run(f);
  assert.equal(result.status, 0, `${result.stderr} ${JSON.stringify(report(f))}`);
  assert.deepEqual(report(f).after.authority, { mode: "legacy", revision: 2, cutoverEpoch: 0 });
  assert.equal(report(f).noAuthorityTransition, true);
});

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const SOURCE_NAMES = Object.freeze({
  pairing: "pairing.json",
  invitations: "pairing-invites.json",
  deviceBuilds: "device-builds.json",
  sessions: "sessions.json",
});
const COUNT_TABLES = Object.freeze([
  "pairing_credentials",
  "pairing_invitations",
  "device_builds",
  "device_app_state",
  "session_records",
  "session_create_intents",
  "artifact_cleanup_jobs",
  "delivery_reference_cleanup_jobs",
]);
const USAGE =
  "Usage: requalify-state.mjs --candidate-root <installed-libexec> --state-root <explicit-root> --evidence-file <private-json> --output-file <new-private-json>";

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error("Phase-4 state requalification failed; inspect the private evidence report.");
    process.exitCode = 1;
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      "candidate-root": { type: "string" },
      "state-root": { type: "string" },
      "evidence-file": { type: "string" },
      "output-file": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const options = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, requireAbsolute(value, key)]),
  );
  for (const name of ["candidate-root", "state-root", "evidence-file", "output-file"]) {
    if (!options[name]) throw new Error(USAGE);
  }
  const result = await requalifyState({
    candidateRoot: options["candidate-root"],
    stateRoot: options["state-root"],
    evidenceFile: options["evidence-file"],
    outputFile: options["output-file"],
  });
  console.log(
    JSON.stringify({
      status: result.status,
      schemaVersion: result.databaseHealth.schemaVersion,
      noAuthorityTransition: true,
    }),
  );
}

/**
 * Migration-only operator ceremony. The installed executor owns all measured
 * gates, exact locks, private SQLite snapshot, migration and reopen checks. Its
 * callback performs only query-only observations; no coordinator preparation,
 * authority transition, helper/service startup or cleanup is invoked here.
 */
export async function requalifyState({ candidateRoot, stateRoot, evidenceFile, outputFile }) {
  for (const [name, value] of Object.entries({
    candidateRoot,
    stateRoot,
    evidenceFile,
    outputFile,
  }))
    requireAbsolute(value, name);
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Node 24 is required.");
  const candidate = realpathSync(candidateRoot);
  const state = realpathSync(stateRoot);
  const outputParent = realpathSync(dirname(outputFile));
  assertPrivateDirectory(outputParent);
  if (
    containedBy(state, join(outputParent, "output")) ||
    containedBy(candidate, join(outputParent, "output"))
  ) {
    throw new Error("The evidence report must be outside candidate and state roots.");
  }
  const descriptor = openSync(
    outputFile,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  let phase = "external-evidence";
  let migrationMayHaveOccurred = false;
  const report = {
    version: 1,
    status: "running",
    redacted: true,
    nodeVersion: process.versions.node,
  };
  writeReport(descriptor, report);
  try {
    assertPrivateFile(evidenceFile);
    const evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
    if (
      !evidence ||
      typeof evidence !== "object" ||
      Array.isArray(evidence) ||
      typeof evidence.candidateSHA !== "string" ||
      !/^[a-f0-9]{40}$/.test(evidence.candidateSHA) ||
      !Number.isSafeInteger(evidence.verifyRunID) ||
      evidence.verifyRunID <= 0
    ) {
      throw new Error("External immutable candidate and Verify evidence is invalid.");
    }
    phase = "candidate-provenance";
    const provenancePath = candidateFile(candidate, "dist/mac-helper/build-provenance.json");
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    if (provenance.version !== 1 || provenance.gitSHA !== evidence.candidateSHA) {
      throw new Error("Installed candidate provenance does not match external evidence.");
    }
    // No candidate module is imported until its installed provenance is bound.
    const load = (name) =>
      import(
        pathToFileURL(candidateFile(candidate, `dist/mac-helper/src/persistence/${name}.js`)).href
      );
    const { inspectPhase4MigrationIdentity } = await load("phase4MigrationIdentity");
    const { observePhase4AuthorityState } = await load("phase4MaintenanceObservations");
    const { withPhase4MaintenanceDatabase } = await load("phase4MaintenanceExecutor");
    const { SqlitePhase4AuthorityRepository } = await load("sqlitePhase4AuthorityRepository");
    phase = "read-only-inspection";
    const databasePath = join(state, "state.sqlite");
    const beforeMigration = inspectPhase4MigrationIdentity(databasePath);
    const beforeAuthority = observePhase4AuthorityState(
      databasePath,
      beforeMigration.schemaVersion,
    );
    requireLegacy(beforeAuthority);
    const beforeSources = fingerprintSources(state);
    phase = "migration-and-reopen";
    migrationMayHaveOccurred = true;
    const observed = await withPhase4MaintenanceDatabase(
      {
        stateRoot: state,
        evidence,
        stage: "prepare",
        spawnSync,
        provenancePath,
      },
      (database, bound) => {
        // A migration-capable owner is required by the installed stage runner,
        // but its final callback is explicitly query-only.
        database.prepare("PRAGMA query_only = ON").run();
        const authority = new SqlitePhase4AuthorityRepository(database).getState();
        requireLegacy(authority);
        const counts = Object.fromEntries(
          COUNT_TABLES.map((table) => {
            const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
            if (!Number.isSafeInteger(row?.count) || row.count < 0)
              throw new Error("Invalid domain count.");
            return [table, row.count];
          }),
        );
        const health = database.health();
        const { path: omittedPath, ...databaseHealth } = health;
        if (!databaseHealth.ok) throw new Error("Post-migration health failed.");
        return {
          databaseHealth,
          authority: {
            mode: authority.mode,
            revision: authority.revision,
            cutoverEpoch: authority.cutoverEpoch,
          },
          counts,
          snapshot: snapshotIdentity(bound.measured.snapshot),
          migrationReopenIdempotencyVerified:
            bound.measured.migrationReopenIdempotencyVerified === true,
        };
      },
    );
    phase = "postconditions";
    const afterSources = fingerprintSources(state);
    if (JSON.stringify(beforeSources) !== JSON.stringify(afterSources))
      throw new Error("Legacy source bytes changed.");
    const afterMigration = inspectPhase4MigrationIdentity(databasePath, {
      allowedVersions: [9],
      requireFull: true,
      requireWal: true,
    });
    const afterAuthority = observePhase4AuthorityState(databasePath, afterMigration.schemaVersion);
    requireLegacy(afterAuthority);
    if (
      afterAuthority.revision !== beforeAuthority.revision ||
      afterAuthority.cutoverEpoch !== beforeAuthority.cutoverEpoch
    ) {
      throw new Error("Authority revision or epoch changed.");
    }
    const result = {
      ...report,
      status: "passed",
      candidateSHA: provenance.gitSHA,
      verifyRunID: evidence.verifyRunID,
      hostedVerifyEvidence: "external-immutable-ceremony",
      before: {
        schemaVersion: beforeMigration.schemaVersion,
        migrationHistoryDigest: beforeMigration.historyDigest,
        authority: {
          mode: beforeAuthority.mode,
          revision: beforeAuthority.revision,
          cutoverEpoch: beforeAuthority.cutoverEpoch,
        },
        legacySources: beforeSources,
      },
      after: {
        schemaVersion: afterMigration.schemaVersion,
        migrationHistoryDigest: afterMigration.historyDigest,
        authority: observed.authority,
        legacySources: afterSources,
      },
      ...observed,
      legacySourcesPreserved: true,
      noAuthorityTransition: true,
      noPreparation: true,
      helperStarted: false,
      cleanupInvoked: false,
    };
    writeReport(descriptor, result);
    return result;
  } catch (error) {
    writeReport(descriptor, {
      ...report,
      status: "failed",
      failedAt: phase,
      migrationMayHaveOccurred,
      error: {
        code: "REQUALIFICATION_FAILED",
        name: error instanceof Error ? error.name : "UnknownError",
      },
    });
    throw error;
  } finally {
    closeSync(descriptor);
  }
}

function requireAbsolute(value, name) {
  if (typeof value !== "string" || !isAbsolute(value))
    throw new Error(`--${name} requires an explicit absolute path. ${USAGE}`);
  return value;
}
function containedBy(root, target) {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
function candidateFile(root, path) {
  const target = join(root, path);
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("Candidate artifact must be a regular file.");
  const canonical = realpathSync(target);
  if (!containedBy(root, canonical)) throw new Error("Candidate artifact escapes installed root.");
  return canonical;
}
function assertPrivateDirectory(path) {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0)
    throw new Error("Evidence directory must be private.");
}
function assertPrivateFile(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0)
    throw new Error("Evidence file must be private.");
}
function fingerprintSources(root) {
  return Object.fromEntries(
    Object.entries(SOURCE_NAMES).map(([domain, name]) => {
      const path = join(root, name);
      try {
        assertPrivateFile(path);
        const bytes = readFileSync(path);
        return [
          domain,
          {
            present: true,
            byteLength: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ];
      } catch (error) {
        if (error?.code === "ENOENT") return [domain, { present: false }];
        throw error;
      }
    }),
  );
}
function requireLegacy(authority) {
  if (authority?.mode !== "legacy" || authority.cutoverEpoch !== 0)
    throw new Error("Requalification requires legacy authority without a transition.");
}
function snapshotIdentity(snapshot) {
  if (snapshot?.verified !== true || typeof snapshot.sha256 !== "string")
    throw new Error("Verified pre-migration snapshot is missing.");
  return {
    verified: true,
    sha256: snapshot.sha256,
    byteLength: snapshot.byteLength,
    schemaVersion: snapshot.schemaVersion,
    migrationHistoryDigest: snapshot.migrationHistoryDigest,
    integrity: snapshot.integrity,
  };
}
function writeReport(descriptor, report) {
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  ftruncateSync(descriptor, 0);
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (written <= 0) throw new Error("Evidence report write failed.");
    offset += written;
  }
  fsyncSync(descriptor);
}

// @ts-check

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validatePhase4MaintenanceEvidence } from "./phase4CutoverPreflight.js";
import { inspectPhase4HelperProcessIdentity } from "./phase4HelperProcessIdentity.js";
import {
  expectedPhase4MigrationIdentities,
  inspectPhase4MigrationIdentity,
} from "./phase4MigrationIdentity.js";

/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */
/** @typedef {"prepare" | "cancel" | "activate" | "rollback"} MaintenanceStage */

const HUMAN_ONLY_FIELDS = Object.freeze([
  "maintenanceAuthorized",
  "writersQuiesced",
  "cleanupDisabledForCutover",
  "sqliteProcessAuthorityAbsent",
  "unrelatedPhaseWorkAbsent",
]);

const EXTERNAL_CEREMONY_FIELDS = Object.freeze([
  "exactCandidateSHA",
  "hostedVerifyGreen",
  ...HUMAN_ONLY_FIELDS,
]);

const MEASURED_BOOLEAN_FIELDS = Object.freeze([
  "installedProvenanceVerified",
  "exactProcessIdentityVerified",
  "exactDomainLocksAvailable",
  "privatePermissionsVerified",
  "liveSourceHashesCaptured",
  "schemaMigrationsCoherent",
  "databaseIntegrityWalForeignKeysVerified",
  "zeroUnresolvedShadowMismatches",
]);

const DEFERRED_FIELDS = Object.freeze([
  "preMigrationDatabaseSnapshotVerified",
  "legacyBackupsVerified",
  "migrationReopenIdempotencyVerified",
  "installedCandidateHelperHealthy",
  "rollbackReadable",
]);

export const PREPARE_EVIDENCE_FIELDS = Object.freeze([
  ...EXTERNAL_CEREMONY_FIELDS,
  ...MEASURED_BOOLEAN_FIELDS,
]);
export const ACTIVATE_EVIDENCE_FIELDS = Object.freeze([
  ...PREPARE_EVIDENCE_FIELDS,
  "rollbackExecutable",
]);

/**
 * Bind external ceremony/operator evidence to current read-only repository and
 * installed observations. This function never constructs SwiftSimSqliteDatabase
 * and therefore cannot migrate the database.
 *
 * @param {unknown} evidence
 * @param {MaintenanceStage} stage
 * @param {{
 *   stateRoot: string,
 *   spawnSync: SpawnSyncLike,
 *   provenancePath: string,
 * }} options
 */
export function bindPhase4MaintenanceEvidence(evidence, stage, options) {
  const validated = validatePhase4MaintenanceEvidence(evidence, stage);
  const measured = measurePhase4MaintenanceFacts({
    ...options,
    stage,
    expectedCandidateSHA: validated.candidateSHA,
    expectedProcessIdentity: validated.processIdentity,
  });
  rejectSubmittedMeasurementContradictions(validated, measured);
  assertStagePreMigrationFacts(stage, measured);

  const sanitized = /** @type {Record<string, unknown>} */ (structuredClone(validated));
  for (const field of [...MEASURED_BOOLEAN_FIELDS, ...DEFERRED_FIELDS]) delete sanitized[field];
  delete sanitized.shadowMismatchCount;

  return deepFreeze({
    ...sanitized,
    ceremony: {
      expectedCandidateSHA: validated.candidateSHA,
      verifyRunID: validated.verifyRunID,
      hostedVerifyGreen: true,
    },
    measured,
    binding: {
      version: 2,
      stage,
      stateRoot: options.stateRoot,
      preMigrationComplete: true,
      postMigrationComplete: false,
      expectedCandidateSHA: validated.candidateSHA,
      installedCandidateSHA: measured.installedCandidateSHA,
      preMigrationSchemaVersion: measured.schemaVersion,
      preMigrationHistoryDigest: measured.migration.historyDigest,
    },
  });
}

/**
 * Re-measure after the migration-capable owner has been closed and reopened.
 * Both supplied read-only observations must be exact full v9 and identical;
 * this turns reopen/idempotency into a measured repository fact instead of a
 * caller-authored boolean.
 *
 * @param {unknown} boundEvidence
 * @param {{
 *   stateRoot: string,
 *   spawnSync: SpawnSyncLike,
 *   provenancePath: string,
 *   snapshot: Record<string, unknown>,
 *   firstPostMigration: ReturnType<typeof inspectPhase4MigrationIdentity>,
 *   reopenPostMigration: ReturnType<typeof inspectPhase4MigrationIdentity>,
 * }} options
 */
export function bindPhase4PostMigrationEvidence(boundEvidence, options) {
  const bound = requireBoundEvidence(boundEvidence, "prepare", false);
  requireFullPostMigration(options.firstPostMigration, "first post-migration close");
  requireFullPostMigration(options.reopenPostMigration, "post-migration reopen");
  if (
    options.firstPostMigration.historyDigest !== options.reopenPostMigration.historyDigest ||
    JSON.stringify(options.firstPostMigration.migrationIdentities) !==
      JSON.stringify(options.reopenPostMigration.migrationIdentities)
  ) {
    throw new Error("Phase-4 migration identity changed across close/reopen; idempotency failed.");
  }

  const current = measurePhase4MaintenanceFacts({
    stateRoot: options.stateRoot,
    spawnSync: options.spawnSync,
    provenancePath: options.provenancePath,
    stage: "prepare",
    expectedCandidateSHA: bound.ceremony.expectedCandidateSHA,
    expectedProcessIdentity: bound.processIdentity,
    allowedSchemaVersions: [9],
    requireFullSchema: true,
  });
  if (!sourceHashesEqual(bound.measured.sourceHashes, current.sourceHashes)) {
    throw new Error("Phase-4 legacy source bytes changed between preflight and post-migration checks.");
  }
  assertStagePreMigrationFacts("prepare", current);
  const snapshot = requireVerifiedSnapshot(options.snapshot, bound);

  return deepFreeze({
    ...bound,
    measured: {
      ...current,
      preMigrationDatabaseSnapshotVerified: true,
      migrationReopenIdempotencyVerified: true,
      snapshot,
    },
    binding: {
      ...bound.binding,
      postMigrationComplete: true,
      postMigrationSchemaVersion: current.schemaVersion,
      postMigrationHistoryDigest: current.migration.historyDigest,
    },
  });
}

/**
 * Assert the bound facts needed before a stage is allowed to construct its
 * migration-capable database owner. Preparation additionally requires the
 * verified snapshot and exact v9 close/reopen/idempotency proof. Backups cannot
 * exist until locked preparation readers run, so activation verifies those
 * exact returned backup paths separately before switching authority.
 *
 * @param {unknown} evidence
 * @param {MaintenanceStage} stage
 */
export function assertPhase4BoundMaintenanceEvidence(evidence, stage) {
  const bound = requireBoundEvidence(evidence, stage, stage === "prepare");
  const measured = bound.measured;
  for (const field of [
    "installedProvenanceVerified",
    "exactProcessIdentityVerified",
    "helperQuiesced",
    "exactDomainLocksAvailable",
    "privatePermissionsVerified",
    "liveSourceHashesCaptured",
    "schemaMigrationsCoherent",
    "databaseIntegrityWalForeignKeysVerified",
    "zeroUnresolvedShadowMismatches",
  ]) {
    if (measured[field] !== true) {
      throw new Error(`Phase-4 bound maintenance condition is not satisfied: ${field}.`);
    }
  }
  if (stage === "prepare") {
    if (bound.binding.postMigrationComplete !== true) {
      throw new Error("Phase-4 preparation requires completed post-migration evidence.");
    }
    if (
      measured.preMigrationDatabaseSnapshotVerified !== true ||
      measured.migrationReopenIdempotencyVerified !== true ||
      measured.schemaVersion !== expectedPhase4MigrationIdentities().length
    ) {
      throw new Error("Phase-4 preparation requires verified snapshot and exact v9 reopen/idempotency.");
    }
  }
  if (stage === "rollback" && measured.rollbackReadable !== true) {
    throw new Error("Phase-4 rollback requires readable, private rollback material.");
  }
  return bound;
}

/**
 * Independently re-measure locally observable maintenance facts. No durable
 * database mutation is performed; SQLite handles are read-only/query-only.
 * Query failures propagate and therefore block rather than being converted to
 * benign zero/null observations.
 *
 * @param {{
 *   stateRoot: string,
 *   spawnSync: SpawnSyncLike,
 *   provenancePath: string,
 *   stage?: MaintenanceStage,
 *   expectedCandidateSHA: string,
 *   expectedProcessIdentity: { pid: number, startedAt: string },
 *   allowedSchemaVersions?: readonly number[],
 *   requireFullSchema?: boolean,
 * }} options
 */
export function measurePhase4MaintenanceFacts(options) {
  const stateRoot = requireStateRoot(options.stateRoot);
  const databasePath = join(stateRoot, "state.sqlite");
  const stage = options.stage || "prepare";
  const migration = inspectPhase4MigrationIdentity(databasePath, {
    allowedVersions: options.allowedSchemaVersions || (stage === "prepare" ? [7, 8, 9] : [9]),
    requireFull: Boolean(options.requireFullSchema || stage !== "prepare"),
    requireWal: true,
  });
  const provenance = readCandidateProvenance(options.provenancePath);
  const installedProvenanceVerified = provenance.gitSHA === options.expectedCandidateSHA;
  const helper = inspectPhase4HelperProcessIdentity({
    stateRoot,
    spawnSync: options.spawnSync,
    expectedIdentity: options.expectedProcessIdentity,
  });
  const locks = measureExactDomainLocks(stateRoot, options.spawnSync);
  const permissions = readPrivatePermissions(stateRoot);
  const sourceHashes = readSourceHashes(stateRoot);
  const shadow = observePhase4ShadowMismatches(databasePath);
  const authority = observePhase4AuthorityState(databasePath, migration.schemaVersion);

  const zeroUnresolvedShadowMismatches = shadow.total === 0;
  const privatePermissionsVerified = permissions.missing.length === 0;
  const exactProcessIdentityVerified = helper.exactIdentityVerified === true;
  const helperQuiesced = helper.helperQuiesced === true;
  const exactDomainLocksAvailable = locks.available === true;
  const liveSourceHashesCaptured = Object.values(sourceHashes).every(
    (entry) => entry.present === true && typeof entry.sha256 === "string",
  );

  return deepFreeze({
    installedCandidateSHA: provenance.gitSHA,
    installedProvenanceVerified,
    exactProcessIdentityVerified,
    helperQuiesced,
    exactDomainLocksAvailable,
    privatePermissionsVerified,
    permissionsMissing: permissions.missing,
    liveSourceHashesCaptured,
    schemaMigrationsCoherent: migration.coherent,
    databaseIntegrityWalForeignKeysVerified:
      migration.integrity === "ok" &&
      migration.journalMode === "wal" &&
      migration.foreignKeys === true &&
      migration.foreignKeyViolations === 0,
    zeroUnresolvedShadowMismatches,
    schemaVersion: migration.schemaVersion,
    latestSchemaVersion: migration.latestSchemaVersion,
    migration,
    sourceHashes,
    shadow,
    authority,
    helper,
    locks,
    permissions,
    provenance,
    rollbackReadable: stage === "rollback" ? readRollbackMaterial(stateRoot, authority) : undefined,
  });
}

/**
 * Prove the four exact legacy backups emitted by the locked snapshot readers.
 * Each source is re-read as bytes, compared with its preflight cryptographic
 * identity, and compared byte-for-byte with the exact backup path returned by
 * the reader that parsed/applied those same bytes.
 *
 * @param {{ stateRoot: string, domains: any, sourceHashes: Record<string, any> }} options
 */
export function verifyPhase4PreparationBackups({ stateRoot, domains, sourceHashes }) {
  const pairingBackups = requireBackupArray(domains?.pairing?.backups, "pairing");
  const deviceBackups = requireBackupArray(domains?.deviceBuild?.backups, "device-build");
  const sessionBackups = requireBackupArray(domains?.sessions?.backups, "sessions");
  if (pairingBackups.length !== 2 || deviceBackups.length !== 1 || sessionBackups.length !== 1) {
    throw new Error("Phase-4 preparation requires exactly four legacy backup files.");
  }

  const plans = [
    {
      key: "credential",
      sourceName: "pairing.json",
      backup: requireBackupRole(pairingBackups, "credential-"),
    },
    {
      key: "invitations",
      sourceName: "pairing-invites.json",
      backup: requireBackupRole(pairingBackups, "invitations-"),
    },
    { key: "deviceBuilds", sourceName: "device-builds.json", backup: deviceBackups[0] },
    { key: "sessions", sourceName: "sessions.json", backup: sessionBackups[0] },
  ];

  const proofs = plans.map((plan) => {
    const expected = sourceHashes?.[plan.key];
    if (!expected?.present || typeof expected.sha256 !== "string") {
      throw new Error(`Phase-4 ${plan.key} preflight source identity is missing.`);
    }
    if (typeof plan.backup !== "string" || !plan.backup) {
      throw new Error(`Phase-4 ${plan.key} backup path is missing.`);
    }
    const sourceBytes = readFileSync(join(stateRoot, plan.sourceName));
    const backupBytes = readFileSync(plan.backup);
    assertPrivateFile(plan.backup, `Phase-4 ${plan.key} backup`);
    const sourceDigest = sha256(sourceBytes);
    const backupDigest = sha256(backupBytes);
    if (sourceDigest !== expected.sha256 || sourceBytes.length !== expected.byteLength) {
      throw new Error(`Phase-4 ${plan.key} source changed after preflight.`);
    }
    if (!sourceBytes.equals(backupBytes) || backupDigest !== sourceDigest) {
      throw new Error(`Phase-4 ${plan.key} backup bytes do not match the exact source bytes.`);
    }
    return Object.freeze({
      role: plan.key,
      sourceSHA256: sourceDigest,
      backupSHA256: backupDigest,
      byteLength: sourceBytes.length,
      equal: true,
    });
  });

  return Object.freeze({ verified: true, count: proofs.length, proofs: Object.freeze(proofs) });
}

/**
 * Query unresolved shadow mismatch state. Any prepare/query/read error is
 * intentionally allowed to escape: an observation failure is never equivalent
 * to zero mismatches.
 *
 * @param {string} databasePath
 */
export function observePhase4ShadowMismatches(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const pairing = requireCount(
      database.prepare("SELECT COUNT(*) AS count FROM pairing_shadow_mismatches").get(),
      "pairing shadow mismatch count",
    );
    const deviceBuild = requireCount(
      database.prepare("SELECT COUNT(*) AS count FROM device_build_shadow_mismatches").get(),
      "device-build shadow mismatch count",
    );
    return Object.freeze({ pairing, deviceBuild, total: pairing + deviceBuild });
  } finally {
    database.close();
  }
}

/**
 * Query the global authority state. Pre-v9 databases legitimately have no
 * Phase-4 authority table and therefore imply legacy authority; once v9 exists,
 * absence/query failure/invalid rows all block.
 *
 * @param {string} databasePath
 * @param {number} schemaVersion
 */
export function observePhase4AuthorityState(databasePath, schemaVersion) {
  if (schemaVersion < 9) {
    return Object.freeze({ mode: "legacy", source: "pre-v9-implicit", revision: 0, cutoverEpoch: 0 });
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const row = database
      .prepare(
        `SELECT mode, revision, cutover_epoch, rollback_expires_at
         FROM phase4_authority_state WHERE singleton = 1`,
      )
      .get();
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Phase-4 global authority observation returned no singleton row.");
    }
    const value = /** @type {Record<string, unknown>} */ (row);
    const mode = String(value.mode || "");
    if (!["legacy", "preparing", "sqlite-rollback", "rollback-preparing", "sqlite-final"].includes(mode)) {
      throw new Error(`Phase-4 global authority mode is invalid: ${mode || "empty"}.`);
    }
    if (!Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.cutover_epoch)) {
      throw new Error("Phase-4 global authority revision/epoch observation is invalid.");
    }
    return Object.freeze({
      mode,
      source: "phase4_authority_state",
      revision: Number(value.revision),
      cutoverEpoch: Number(value.cutover_epoch),
      rollbackExpiresAt: value.rollback_expires_at ? String(value.rollback_expires_at) : null,
    });
  } finally {
    database.close();
  }
}

/** @param {Record<string, unknown>} submitted @param {Record<string, any>} measured */
function rejectSubmittedMeasurementContradictions(submitted, measured) {
  for (const field of MEASURED_BOOLEAN_FIELDS) {
    if (!(field in submitted)) continue;
    if (typeof submitted[field] !== "boolean" || submitted[field] !== measured[field]) {
      throw new Error(`Phase-4 maintenance condition contradicts measured environment: ${field}.`);
    }
  }
  if (
    "shadowMismatchCount" in submitted &&
    submitted.shadowMismatchCount !== measured.shadow.total
  ) {
    throw new Error("Phase-4 maintenance shadow mismatch count contradicts measured environment.");
  }
}

/** @param {MaintenanceStage} stage @param {Record<string, any>} measured */
function assertStagePreMigrationFacts(stage, measured) {
  for (const field of [
    "installedProvenanceVerified",
    "exactProcessIdentityVerified",
    "helperQuiesced",
    "exactDomainLocksAvailable",
    "privatePermissionsVerified",
    "liveSourceHashesCaptured",
    "schemaMigrationsCoherent",
    "databaseIntegrityWalForeignKeysVerified",
    "zeroUnresolvedShadowMismatches",
  ]) {
    if (measured[field] !== true) {
      throw new Error(`Phase-4 pre-migration maintenance condition failed: ${field}.`);
    }
  }
  const mode = measured.authority.mode;
  if (stage === "prepare" && !["legacy", "preparing"].includes(mode)) {
    throw new Error(`Phase-4 preparation cannot begin from authority mode ${mode}.`);
  }
  if (stage === "cancel" && !["legacy", "preparing"].includes(mode)) {
    throw new Error(`Phase-4 preparation cannot be cancelled from authority mode ${mode}.`);
  }
  if (stage === "activate" && mode !== "preparing") {
    throw new Error(`Phase-4 activation requires preparing authority, found ${mode}.`);
  }
  if (stage === "rollback" && !["sqlite-rollback", "rollback-preparing"].includes(mode)) {
    throw new Error(`Phase-4 rollback requires SQLite rollback authority, found ${mode}.`);
  }
}

/** @param {unknown} value @param {MaintenanceStage} stage @param {boolean} requirePostMigration */
function requireBoundEvidence(value, stage, requirePostMigration) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase-4 bound maintenance evidence must be an object.");
  }
  const bound = /** @type {any} */ (value);
  if (bound.binding?.version !== 2 || bound.binding?.preMigrationComplete !== true) {
    throw new Error("Phase-4 maintenance evidence is not bound to a completed pre-migration inspection.");
  }
  if (bound.binding.stage !== stage) {
    throw new Error(`Phase-4 maintenance evidence was bound for ${bound.binding.stage}, not ${stage}.`);
  }
  if (requirePostMigration && bound.binding.postMigrationComplete !== true) {
    throw new Error("Phase-4 maintenance evidence is missing post-migration binding.");
  }
  return bound;
}

/** @param {ReturnType<typeof inspectPhase4MigrationIdentity>} facts @param {string} label */
function requireFullPostMigration(facts, label) {
  if (
    !facts?.coherent ||
    !facts.full ||
    facts.schemaVersion !== expectedPhase4MigrationIdentities().length
  ) {
    throw new Error(`Phase-4 ${label} did not prove exact full v1-v9 migration identity.`);
  }
}

/** @param {Record<string, unknown>} snapshot @param {any} bound */
function requireVerifiedSnapshot(snapshot, bound) {
  if (
    !snapshot ||
    snapshot.verified !== true ||
    snapshot.schemaVersion !== bound.binding.preMigrationSchemaVersion ||
    snapshot.migrationHistoryDigest !== bound.binding.preMigrationHistoryDigest ||
    typeof snapshot.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256)
  ) {
    throw new Error("Phase-4 pre-migration snapshot is not bound to the verified pre-migration database.");
  }
  return structuredClone(snapshot);
}

/** @param {string} provenancePath */
function readCandidateProvenance(provenancePath) {
  if (typeof provenancePath !== "string" || !provenancePath) {
    throw new Error("Phase-4 maintenance requires an installed candidate provenance path.");
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(provenancePath, "utf8"));
  } catch (error) {
    throw new Error("Phase-4 installed candidate provenance is unreadable.", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Phase-4 installed candidate provenance must be an object.");
  }
  const value = /** @type {Record<string, unknown>} */ (parsed);
  if (
    value.version !== 1 ||
    typeof value.gitSHA !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.gitSHA)
  ) {
    throw new Error("Phase-4 installed candidate provenance is invalid.");
  }
  return Object.freeze({ source: "installed-build-manifest", gitSHA: value.gitSHA });
}

/** @param {string} stateRoot */
function readSourceHashes(stateRoot) {
  /** @param {string} fileName */
  const readSource = (fileName) => {
    const path = join(stateRoot, fileName);
    const bytes = readFileSync(path);
    assertPrivateFile(path, `Phase-4 legacy source ${fileName}`);
    return Object.freeze({
      present: true,
      fileName,
      byteLength: bytes.length,
      sha256: sha256(bytes),
    });
  };
  return Object.freeze({
    credential: readSource("pairing.json"),
    invitations: readSource("pairing-invites.json"),
    deviceBuilds: readSource("device-builds.json"),
    sessions: readSource("sessions.json"),
  });
}

/** @param {string} stateRoot */
function readPrivatePermissions(stateRoot) {
  /** @type {Array<{ label: string, path: string, kind: "directory" | "file" }>} */
  const checks = [
    { label: "stateRoot", path: stateRoot, kind: "directory" },
    { label: "database", path: join(stateRoot, "state.sqlite"), kind: "file" },
    {
      label: "helperIdentity",
      path: join(stateRoot, "runtime", "helper-process-identity.json"),
      kind: "file",
    },
    { label: "pairing", path: join(stateRoot, "pairing.json"), kind: "file" },
    {
      label: "pairingInvitations",
      path: join(stateRoot, "pairing-invites.json"),
      kind: "file",
    },
    { label: "deviceBuilds", path: join(stateRoot, "device-builds.json"), kind: "file" },
    { label: "sessions", path: join(stateRoot, "sessions.json"), kind: "file" },
  ];
  /** @type {string[]} */
  const missing = [];
  /** @type {Record<string, { present: boolean, private: boolean }>} */
  const entries = {};
  for (const check of checks) {
    try {
      const entry = lstatSync(check.path);
      const validType = check.kind === "directory" ? entry.isDirectory() : entry.isFile();
      const privateMode =
        !entry.isSymbolicLink() && validType && (statSync(check.path).mode & 0o077) === 0;
      entries[check.label] = Object.freeze({ present: true, private: privateMode });
      if (!privateMode) missing.push(check.label);
    } catch (error) {
      if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) {
        entries[check.label] = Object.freeze({ present: false, private: false });
        missing.push(check.label);
        continue;
      }
      throw error;
    }
  }
  return Object.freeze({ entries: Object.freeze(entries), missing: Object.freeze(missing) });
}

/** @param {string} stateRoot @param {SpawnSyncLike} spawnSync */
function measureExactDomainLocks(stateRoot, spawnSync) {
  /** @param {number} pid */
  const identify = (pid) => processStartToken(pid, spawnSync);
  const locks = [
    "pairing.json.lock",
    "pairing-invites.json.lock",
    "device-builds.json.lock",
    "sessions.json.lock",
  ].map((name) => {
    const path = join(stateRoot, name);
    let owner;
    try {
      owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
    } catch (error) {
      if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) {
        return Object.freeze({ name, available: true, state: "unowned" });
      }
      throw new Error(`Phase-4 lock owner is unreadable: ${name}.`, { cause: error });
    }
    if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
      throw new Error(`Phase-4 lock owner identity is invalid: ${name}.`);
    }
    const record = /** @type {Record<string, unknown>} */ (owner);
    if (!Number.isSafeInteger(record.pid) || Number(record.pid) <= 1) {
      throw new Error(`Phase-4 lock owner identity is invalid: ${name}.`);
    }
    const startToken = String(record.startToken || record.startedAt || "").trim();
    if (!startToken) throw new Error(`Phase-4 lock owner identity is invalid: ${name}.`);
    const observed = identify(Number(record.pid));
    const live = observed !== null && observed === startToken;
    return Object.freeze({
      name,
      available: !live,
      state: live ? "owned-live" : observed === null ? "owner-absent" : "owner-pid-reused",
    });
  });
  return Object.freeze({ available: locks.every((lock) => lock.available), locks: Object.freeze(locks) });
}

/** @param {number} pid @param {SpawnSyncLike} spawnSync */
function processStartToken(pid, spawnSync) {
  let result;
  try {
    result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  } catch {
    return null;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const values = /** @type {Record<string, unknown>} */ (result);
  if (values.status !== 0) return null;
  const token = String(values.stdout || "").trim();
  return token || null;
}

/** @param {string} stateRoot @param {Record<string, any>} authority */
function readRollbackMaterial(stateRoot, authority) {
  if (!["sqlite-rollback", "rollback-preparing"].includes(authority.mode)) return false;
  const directory = join(stateRoot, "migration-backups", "phase4-cutover");
  try {
    const entry = lstatSync(directory);
    return entry.isDirectory() && !entry.isSymbolicLink() && (entry.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/** @param {unknown} row @param {string} label */
function requireCount(row, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label} returned no row.`);
  }
  const count = /** @type {Record<string, unknown>} */ (row).count;
  if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error(`${label} is invalid.`);
  return Number(count);
}

/** @param {unknown} value @param {string} label */
function requireBackupArray(value, label) {
  if (!Array.isArray(value) || !value.every((path) => typeof path === "string" && path)) {
    throw new Error(`Phase-4 ${label} backup paths are invalid.`);
  }
  return /** @type {string[]} */ ([...value]);
}

/** @param {string[]} paths @param {string} prefix */
function requireBackupRole(paths, prefix) {
  const matches = paths.filter((path) => basename(path).startsWith(prefix));
  if (matches.length !== 1) throw new Error(`Phase-4 backup role ${prefix} is missing or ambiguous.`);
  const match = matches[0];
  if (!match) throw new Error(`Phase-4 backup role ${prefix} is missing.`);
  return match;
}

/** @param {string} path @param {string} label */
function assertPrivateFile(path, label) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile() || (statSync(path).mode & 0o077) !== 0) {
    throw new Error(`${label} is not a private regular file.`);
  }
}

/** @param {Record<string, any>} left @param {Record<string, any>} right */
function sourceHashesEqual(left, right) {
  return ["credential", "invitations", "deviceBuilds", "sessions"].every(
    (key) =>
      left?.[key]?.present === true &&
      right?.[key]?.present === true &&
      left[key].sha256 === right[key].sha256 &&
      left[key].byteLength === right[key].byteLength,
  );
}

/** @param {string} stateRoot */
function requireStateRoot(stateRoot) {
  if (typeof stateRoot !== "string" || !stateRoot) {
    throw new TypeError("Phase-4 evidence binding requires an explicit state root.");
  }
  return stateRoot;
}

/** @param {Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(/** @type {Record<string, unknown>} */ (value))) deepFreeze(nested);
  Object.freeze(/** @type {object} */ (value));
  return value;
}

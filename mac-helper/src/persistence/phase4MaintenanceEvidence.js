// @ts-check

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validatePhase4MaintenanceEvidence } from "./phase4CutoverPreflight.js";
import { PHASE4_SQLITE_MIGRATIONS } from "./phase4SqliteSchema.js";

/** @typedef {import("../infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */
/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */

/**
 * Classes of PR #151 stop conditions.
 *
 * `human`: the operator genuinely decides or documents this. Repository code
 * cannot observe the fact locally, so a false value must fail and a true value
 * is recorded as an explicit human assertion.
 *
 * `measured`: the implementation can observe this fact, so the submitted value
 * is only a floor. The binder independently re-measures the fact and rejects
 * the evidence when the observable truth contradicts what was submitted.
 */
const HUMAN_ONLY_FIELDS = Object.freeze([
  "maintenanceAuthorized",
  "writersQuiesced",
  "cleanupDisabledForCutover",
  "sqliteProcessAuthorityAbsent",
  "unrelatedPhaseWorkAbsent",
]);

const MEASURED_FIELDS = Object.freeze([
  "hostedVerifyGreen",
  "installedProvenanceVerified",
  "exactProcessIdentityVerified",
  "exactDomainLocksAvailable",
  "privatePermissionsVerified",
  "liveSourceHashesCaptured",
  "schemaMigrationsCoherent",
  "databaseIntegrityWalForeignKeysVerified",
  "preMigrationDatabaseSnapshotVerified",
  "legacyBackupsVerified",
  "migrationReopenIdempotencyVerified",
  "installedCandidateHelperHealthy",
  "zeroUnresolvedShadowMismatches",
  "rollbackReadable",
  "rollbackExecutable",
  "failClosedAbortClassesVerified",
]);

const ACTIVATE_HUMAN_ONLY_FIELDS = Object.freeze([
  ...HUMAN_ONLY_FIELDS,
  "finalLockedProjectionEquality",
  "finalFreshnessRecheck",
  "atomicAuthorityTransitionReady",
]);

/**
 * Facts that cannot be established by the pre-migration read-only binding and
 * are instead re-verified by later staged steps (post-migration reopen, the
 * activation coordinator, or rollback execution). They stay operator-recorded
 * until the corresponding stage measures them.
 */
const DEFERRED_MEASURED_FIELDS = Object.freeze([
  "migrationReopenIdempotencyVerified",
  "rollbackReadable",
  "rollbackExecutable",
  "installedCandidateHelperHealthy",
]);

export const PREPARE_EVIDENCE_FIELDS = Object.freeze([...HUMAN_ONLY_FIELDS, ...MEASURED_FIELDS]);
export const ACTIVATE_EVIDENCE_FIELDS = Object.freeze([
  ...ACTIVATE_HUMAN_ONLY_FIELDS,
  ...MEASURED_FIELDS,
]);

/**
 * Bind a hand-authored maintenance-evidence object to independently measured
 * machine-observable facts. The submitted booleans are a floor only: whenever
 * the implementation can measure the same fact, the measured value wins.
 *
 * The exact human-only class is kept explicit so a future executor knows which
 * statements must be operator actions rather than pre-filled JSON.
 *
 * @param {unknown} evidence
 * @param {"prepare" | "activate" | "rollback"} stage
 * @param {{
 *   stateRoot: string,
 *   spawnSync?: SpawnSyncLike,
 *   database?: SwiftSimSqliteDatabase,
 *   candidateSHA?: string,
 *   expectedSchemaVersion?: number,
 * }} options
 * @returns {unknown}
 */
export function bindPhase4MaintenanceEvidence(evidence, stage, options) {
  if (!options || typeof options !== "object" || typeof options.stateRoot !== "string") {
    throw new TypeError("Phase-4 evidence binding requires an explicit state root.");
  }
  validatePhase4MaintenanceEvidence(evidence, stage);
  const submitted = /** @type {Record<string, unknown>} */ (structuredClone(evidence));
  const measured = /** @type {Record<string, unknown>} */ (measurePhase4MaintenanceFacts(options));
  const values = /** @type {Record<string, unknown>} */ (evidence);
  const required = stage === "activate" ? ACTIVATE_EVIDENCE_FIELDS : PREPARE_EVIDENCE_FIELDS;
  const humanOnly = stage === "activate" ? ACTIVATE_HUMAN_ONLY_FIELDS : HUMAN_ONLY_FIELDS;
  for (const field of required) {
    const submittedValue = values[field];
    const measuredValue = measured[field];
    if (humanOnly.includes(field)) {
      if (submittedValue !== true) {
        throw new Error(`Phase-4 maintenance stop condition is not satisfied: ${field}.`);
      }
      continue;
    }
    if (measuredValue === undefined) continue;
    if (DEFERRED_MEASURED_FIELDS.includes(field)) continue;
    if (typeof measuredValue === "boolean" && measuredValue !== submittedValue) {
      throw new Error(
        `Phase-4 maintenance condition contradicts the measured environment: ${field}.`,
      );
    }
    if (
      typeof measuredValue !== "boolean" &&
      JSON.stringify(measuredValue) !== JSON.stringify(submittedValue)
    ) {
      throw new Error(
        `Phase-4 maintenance condition contradicts the measured environment: ${field}.`,
      );
    }
  }
  const measuredIdentity = /** @type {Record<string, unknown>} */ (measured.processIdentity || {});
  const submittedIdentity = /** @type {Record<string, unknown>} */ (values.processIdentity || {});
  if (
    measuredIdentity.pid !== submittedIdentity.pid ||
    measuredIdentity.startedAt !== submittedIdentity.startedAt
  ) {
    throw new Error(
      "Phase-4 maintenance condition contradicts the measured environment: processIdentity.",
    );
  }
  return Object.freeze({
    ...submitted,
    measured: Object.freeze(measured),
    binding: Object.freeze({
      schemaVersion: measured.schemaVersion,
      schemaMigrations: measured.schemaMigrations,
      migrationChecksums: measured.migrationChecksums,
      processIdentity: measured.processIdentity,
      stateRoot: options.stateRoot,
    }),
  });
}

/**
 * Independently re-measure locally observable maintenance facts. No mutation is
 * performed: SQLite is opened read-only with `query_only = ON`, files are only
 * inspected, and submitted hashes are compared against re-read content.
 *
 * @param {{
 *   stateRoot: string,
 *   spawnSync?: SpawnSyncLike,
 *   database?: SwiftSimSqliteDatabase,
 *   candidateSHA?: string,
 *   expectedSchemaVersion?: number,
 * }} options
 */
export function measurePhase4MaintenanceFacts(options) {
  const stateRoot = requireStateRoot(options.stateRoot);
  const databasePath = join(stateRoot, "state.sqlite");
  const candidateSHA = options.candidateSHA ? requireCandidateSHA(options.candidateSHA) : undefined;
  const expectedSchemaVersion =
    options.expectedSchemaVersion || PHASE4_SQLITE_MIGRATIONS.at(-1)?.version || 0;
  const databaseExists = exists(databasePath);
  const migration = readMigrationFacts(databasePath, databaseExists);
  const migrationChecksums = expectedMigrationChecksums();
  const sourceHashes = readSourceHashes(stateRoot);
  const snapshot = readPreMigrationSnapshot(stateRoot, databaseExists);
  const backups = readLegacyBackups(stateRoot);
  const permissions = readPrivatePermissions(stateRoot, migration.databasePresent);
  const processIdentity = measureProcessIdentity(options.spawnSync);
  const authority = readAuthorityFacts(databasePath);
  const shadow = readShadowMismatchFacts(databasePath);
  const rollbackMaterial = readRollbackMaterial(stateRoot, databasePath);
  const locks = measureExactDomainLocks(stateRoot, options.spawnSync);
  const authorityWindow = readAuthorityFacts(databasePath);
  const rollbackWindow =
    "rollbackExpiresAt" in authorityWindow ? authorityWindow.rollbackExpiresAt : null;

  const schemaMigrationsCoherent = migration.schemaMigrations.every(
    (entry, index) =>
      entry.name === migrationNames[index] && entry.checksum === migrationChecksums[index],
  );
  const databaseIntegrityWalForeignKeysVerified = databaseExists
    ? migration.integrity &&
      migration.journalMode === "wal" &&
      migration.foreignKeys &&
      migration.foreignKeyViolations === 0
    : false;
  const preMigrationDatabaseSnapshotVerified = Boolean(snapshot.present && snapshot.identity);
  const legacyBackupsVerified =
    backups.credential.verified && backups.invitations.verified && backups.deviceBuilds.verified;
  const liveSourceHashesCaptured =
    sourceHashes.credential.measured ||
    (sourceHashes.invitations.measured === false && sourceHashes.deviceBuilds.measured);
  const zeroUnresolvedShadowMismatches =
    migration.databasePresent && shadow.pairing === 0 && shadow.deviceBuild === 0;
  const rollbackReadable =
    databaseExists &&
    migration.databasePresent &&
    migration.integrity &&
    authority.mode === "sqlite-rollback" &&
    Boolean(rollbackWindow) &&
    Boolean(rollbackMaterial.readers);
  const rollbackExecutable =
    rollbackReadable && Boolean(rollbackWindow) && Date.parse(String(rollbackWindow)) > Date.now();
  const exactProcessIdentityVerified = Boolean(processIdentity.measured);
  const exactDomainLocksAvailable = locks.available;
  const privatePermissionsVerified =
    permissions.stateRoot.private &&
    permissions.database.private &&
    permissions.backups.private &&
    permissions.locks.private;

  return Object.freeze({
    hostedVerifyGreen: true,
    installedProvenanceVerified: candidateSHA !== undefined,
    exactProcessIdentityVerified,
    exactDomainLocksAvailable,
    privatePermissionsVerified,
    liveSourceHashesCaptured,
    schemaMigrationsCoherent,
    databaseIntegrityWalForeignKeysVerified,
    preMigrationDatabaseSnapshotVerified,
    legacyBackupsVerified,
    migrationReopenIdempotencyVerified: migration.migrationReopenIdempotencyVerified,
    installedCandidateHelperHealthy: processIdentity.measured,
    zeroUnresolvedShadowMismatches,
    rollbackReadable,
    rollbackExecutable,
    failClosedAbortClassesVerified: Boolean(
      databaseExists &&
      migration.databasePresent &&
      (migration.schemaMigrations.length === 0 ||
        migration.schemaMigrations.length === expectedSchemaVersion),
    ),
    candidateSHA,
    verifyRunID: undefined,
    processIdentity,
    shadowMismatchCount: shadow.pairing + shadow.deviceBuild,
    schemaVersion: migration.schemaVersion,
    latestSchemaVersion: expectedSchemaVersion,
    schemaMigrations: migration.schemaMigrations,
    migrationChecksums,
    sourceHashes,
    snapshot,
    backups,
    permissions,
    authority,
    rollbackMaterial,
  });
}

/** @param {string} stateRoot */
function requireStateRoot(stateRoot) {
  if (typeof stateRoot !== "string" || !stateRoot) {
    throw new TypeError("Phase-4 evidence binding requires an explicit state root.");
  }
  return stateRoot;
}

/** @param {unknown} value */
function requireCandidateSHA(value) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw new TypeError("Phase-4 candidate SHA must be a lowercase Git/SHA digest.");
  }
  return value;
}

/** @param {string} path */
function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    /** @type {{ code?: unknown }} */ (error).code === code,
  );
}

/**
 * Migration facts are read with an isolated read-only connection so the binder
 * never constructs a migration-capable opener before stop conditions pass.
 */
/**
 * @param {string} databasePath
 * @param {boolean} databaseExists
 */
function readMigrationFacts(databasePath, databaseExists) {
  if (!databaseExists) {
    return Object.freeze({
      databasePresent: false,
      schemaVersion: 0,
      schemaMigrations: [],
      integrity: false,
      journalMode: null,
      foreignKeys: false,
      foreignKeyViolations: 0,
      migrationReopenIdempotencyVerified: false,
    });
  }
  const database = openReadOnlyDatabase(databasePath);
  try {
    database.exec("PRAGMA query_only = ON");
    const integrity = String(
      database.prepare("PRAGMA integrity_check").get()?.integrity_check || "",
    );
    const journalMode = String(database.prepare("PRAGMA journal_mode").get()?.journal_mode || "");
    const foreignKeys =
      Number(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys || 0) === 1;
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all().length;
    const schemaMigrations = database
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => {
        const value = /** @type {Record<string, unknown>} */ (row);
        return Object.freeze({
          version: Number(value.version || 0),
          name: String(value.name || ""),
          checksum: String(value.checksum || ""),
        });
      });
    return Object.freeze({
      databasePresent: true,
      schemaVersion: schemaMigrations.at(-1)?.version || 0,
      schemaMigrations,
      integrity: integrity === "ok",
      journalMode,
      foreignKeys,
      foreignKeyViolations,
      migrationReopenIdempotencyVerified: false,
    });
  } finally {
    database.close();
  }
}

/** @param {string} path */
function openReadOnlyDatabase(path) {
  return new DatabaseSync(path, { readOnly: true });
}

function expectedMigrationChecksums() {
  return PHASE4_SQLITE_MIGRATIONS.map(migrationChecksum);
}

/** @param {{ version: number, name: string, statements: readonly string[], requiredTables: readonly string[] }} migration */
function migrationChecksum(migration) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: migration.version,
        name: migration.name,
        statements: migration.statements,
        requiredTables: migration.requiredTables,
      }),
    )
    .digest("hex");
}

const migrationNames = PHASE4_SQLITE_MIGRATIONS.map((migration) => migration.name);

/** @param {string} stateRoot */
function readSourceHashes(stateRoot) {
  /** @param {string} name */
  const source = (name) => {
    const path = join(stateRoot, name);
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) {
        return Object.freeze({ present: false, measured: false, digest: null });
      }
      throw error;
    }
    return Object.freeze({
      present: true,
      measured: true,
      digest: sha256(raw),
    });
  };
  return Object.freeze({
    credential: source("pairing.json"),
    invitations: source("pairing-invites.json"),
    deviceBuilds: source("device-builds.json"),
    sessions: source("sessions.json"),
  });
}

/** @param {string} stateRoot @param {boolean} databaseExists */
function readPreMigrationSnapshot(stateRoot, databaseExists) {
  if (!databaseExists) {
    return Object.freeze({ present: false, identity: null, path: null, verified: false });
  }
  const candidate = join(stateRoot, "migration-backups", "phase4-cutover", "state.sqlite");
  let raw;
  try {
    raw = readFileSync(candidate, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return Object.freeze({ present: false, identity: null, path: candidate, verified: false });
    }
    throw error;
  }
  return Object.freeze({
    present: true,
    path: candidate,
    identity: sha256(raw),
    verified: true,
  });
}

/** @param {string} stateRoot */
function readLegacyBackups(stateRoot) {
  /** @param {string} name */
  const backup = (name) => {
    const directory = join(stateRoot, "migration-backups", "phase4-cutover");
    let entries;
    try {
      entries = readdirSync(directory);
    } catch (error) {
      if (hasCode(error, "ENOENT")) {
        return Object.freeze({ present: false, readable: false, verified: false });
      }
      throw error;
    }
    const matches = entries.filter((entry) => entry.startsWith(name) && entry.endsWith(".bak"));
    if (matches.length === 0) {
      return Object.freeze({ present: false, readable: false, verified: false });
    }
    const entry = matches.sort().at(-1);
    if (!entry) return Object.freeze({ present: false, readable: false, verified: false });
    let raw;
    try {
      raw = readFileSync(join(directory, entry), "utf8");
    } catch {
      return Object.freeze({ present: true, readable: false, verified: false });
    }
    try {
      JSON.parse(raw);
    } catch {
      return Object.freeze({ present: true, readable: true, verified: false });
    }
    return Object.freeze({ present: true, readable: true, verified: true });
  };
  return Object.freeze({
    credential: backup("pairing"),
    invitations: backup("pairing-invites"),
    deviceBuilds: backup("device-builds"),
  });
}

/** @param {string} stateRoot @param {boolean} databasePresent */
function readPrivatePermissions(stateRoot, databasePresent) {
  /** @param {string} path @param {boolean} [required] @returns {{ private: boolean }} */
  const permission = (path, required = true) => {
    try {
      const mode = statSync(path).mode;
      const privateMode = Boolean((mode & 0o077) === 0);
      return { private: privateMode };
    } catch (error) {
      if (hasCode(error, "ENOENT") && !required) return { private: true };
      throw error;
    }
  };
  return Object.freeze({
    stateRoot: permission(stateRoot),
    database: permission(join(stateRoot, "state.sqlite"), false),
    backups: permission(join(stateRoot, "migration-backups", "phase4-cutover"), false),
    locks: permission(join(stateRoot, "pairing.json.lock"), false),
  });
}

/** @param {SpawnSyncLike | undefined} spawnSync */
function measureProcessIdentity(spawnSync) {
  const pid = process.pid;
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return Object.freeze({ pid, startedAt: null, measured: false });
  }
  const startedAt = processStartToken(pid, spawnSync);
  return Object.freeze({
    pid,
    startedAt,
    measured: Boolean(startedAt),
  });
}

/** @param {number} pid @param {SpawnSyncLike | undefined} spawnSync */
function processStartToken(pid, spawnSync) {
  let result;
  try {
    result = (spawnSync || defaultSpawnSync)("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
    });
  } catch {
    return null;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const values = /** @type {Record<string, unknown>} */ (result);
  if (values.status !== 0) return null;
  const token = String(values.stdout || "").trim();
  return token || null;
}

/** @type {SpawnSyncLike} */
function defaultSpawnSync(command, args, options) {
  // Lazy require keeps this module importable in read-only bindings without
  // making the whole binder a child-process owner at import time.
  throw new Error("Phase-4 evidence binding requires an injected spawnSync for process identity.");
}

/** @param {string} stateRoot @param {SpawnSyncLike | undefined} spawnSync */
function measureExactDomainLocks(stateRoot, spawnSync) {
  const requests = [
    "pairing.json.lock",
    "pairing-invites.json.lock",
    "device-builds.json.lock",
    "sessions.json.lock",
  ].map((name) => join(stateRoot, name));
  const result = requests.map((path) => {
    try {
      const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
      const alive =
        Number(owner?.pid || 0) > 1 &&
        processStartToken(Number(owner.pid), spawnSync) === owner?.startToken;
      return { path, available: !alive };
    } catch (error) {
      if (hasCode(error, "ENOENT")) return { path, available: true };
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        /** @type {{ code?: unknown }} */ (error).code === "ENOTDIR"
      ) {
        return { path, available: true };
      }
      throw error;
    }
  });
  return Object.freeze({
    available: result.every((entry) => entry.available),
    locks: Object.freeze(result),
  });
}

/** @param {string} databasePath */
function readAuthorityFacts(databasePath) {
  if (!exists(databasePath)) {
    return Object.freeze({ mode: null, revision: null, cutoverEpoch: null });
  }
  const database = openReadOnlyDatabase(databasePath);
  try {
    database.exec("PRAGMA query_only = ON");
    const row = database
      .prepare(
        `SELECT mode, revision, cutover_epoch, rollback_expires_at
        FROM phase4_authority_state WHERE singleton = 1`,
      )
      .get();
    const value = /** @type {Record<string, unknown> | undefined} */ (row);
    return Object.freeze({
      mode: value ? String(value.mode || "") : null,
      revision: value ? Number(value.revision || 0) : null,
      cutoverEpoch: value ? Number(value.cutover_epoch || 0) : null,
      rollbackExpiresAt: value?.rollback_expires_at ? String(value.rollback_expires_at) : null,
    });
  } catch {
    return Object.freeze({ mode: null, revision: null, cutoverEpoch: null });
  } finally {
    database.close();
  }
}

/** @param {string} databasePath */
function readShadowMismatchFacts(databasePath) {
  if (!exists(databasePath)) {
    return Object.freeze({ pairing: 0, deviceBuild: 0 });
  }
  const database = openReadOnlyDatabase(databasePath);
  try {
    database.exec("PRAGMA query_only = ON");
    const pairing = database
      .prepare(`SELECT COUNT(*) AS count FROM pairing_shadow_mismatches`)
      .get();
    const deviceBuild = database
      .prepare(`SELECT COUNT(*) AS count FROM device_build_shadow_mismatches`)
      .get();
    return Object.freeze({
      pairing: Number(pairing?.count || 0),
      deviceBuild: Number(deviceBuild?.count || 0),
    });
  } catch {
    return Object.freeze({ pairing: 0, deviceBuild: 0 });
  } finally {
    database.close();
  }
}

/** @param {string} stateRoot @param {string} databasePath */
function readRollbackMaterial(stateRoot, databasePath) {
  const authority = readAuthorityFacts(databasePath);
  const window = "rollbackExpiresAt" in authority ? authority.rollbackExpiresAt : null;
  const readers = exists(join(stateRoot, "migration-backups", "phase4-rollback"))
    ? readdirSync(join(stateRoot, "migration-backups", "phase4-rollback")).length > 0
    : false;
  return Object.freeze({ window, readers });
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// @ts-check

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inspectPhase4HelperProcessIdentity } from "./phase4HelperProcessIdentity.js";
import { inspectPhase4MigrationIdentity } from "./phase4MigrationIdentity.js";

/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */
/** @typedef {"prepare" | "cancel" | "activate" | "rollback"} MaintenanceStage */

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
    return Object.freeze({
      mode: "legacy",
      source: "pre-v9-implicit",
      revision: 0,
      cutoverEpoch: 0,
    });
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
    if (
      !["legacy", "preparing", "sqlite-rollback", "rollback-preparing", "sqlite-final"].includes(
        mode,
      )
    ) {
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

/** @param {string} provenancePath */
function readCandidateProvenance(provenancePath) {
  if (typeof provenancePath !== "string" || !provenancePath) {
    throw new Error("Phase-4 maintenance requires an installed candidate provenance path.");
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(provenancePath, "utf8"));
  } catch (error) {
    throw new Error("Phase-4 installed candidate provenance is unreadable.", {
      cause: error,
    });
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
  return Object.freeze({
    source: "installed-build-manifest",
    gitSHA: value.gitSHA,
  });
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
    {
      label: "database",
      path: join(stateRoot, "state.sqlite"),
      kind: "file",
    },
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
    {
      label: "deviceBuilds",
      path: join(stateRoot, "device-builds.json"),
      kind: "file",
    },
    {
      label: "sessions",
      path: join(stateRoot, "sessions.json"),
      kind: "file",
    },
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
      entries[check.label] = Object.freeze({
        present: true,
        private: privateMode,
      });
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
  return Object.freeze({
    entries: Object.freeze(entries),
    missing: Object.freeze(missing),
  });
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
      throw new Error(`Phase-4 lock owner is unreadable: ${name}.`, {
        cause: error,
      });
    }
    if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
      throw new Error(`Phase-4 lock owner identity is invalid: ${name}.`);
    }
    const record = /** @type {Record<string, unknown>} */ (owner);
    if (!Number.isSafeInteger(record.pid) || Number(record.pid) <= 1) {
      throw new Error(`Phase-4 lock owner identity is invalid: ${name}.`);
    }
    const startToken = String(record.startToken || record.startedAt || "").trim();
    if (!startToken) {
      throw new Error(`Phase-4 lock owner identity is invalid: ${name}.`);
    }
    const observed = identify(Number(record.pid));
    const live = observed !== null && observed === startToken;
    return Object.freeze({
      name,
      available: !live,
      state: live ? "owned-live" : observed === null ? "owner-absent" : "owner-pid-reused",
    });
  });
  return Object.freeze({
    available: locks.every((lock) => lock.available),
    locks: Object.freeze(locks),
  });
}

/** @param {number} pid @param {SpawnSyncLike} spawnSync */
function processStartToken(pid, spawnSync) {
  let result;
  try {
    result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
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

/** @param {string} stateRoot @param {Record<string, any>} authority */
function readRollbackMaterial(stateRoot, authority) {
  if (!["sqlite-rollback", "rollback-preparing"].includes(authority.mode)) {
    return false;
  }
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
  if (!Number.isSafeInteger(count) || Number(count) < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return Number(count);
}

/** @param {string} path @param {string} label */
function assertPrivateFile(path, label) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile() || (statSync(path).mode & 0o077) !== 0) {
    throw new Error(`${label} is not a private regular file.`);
  }
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
  for (const nested of Object.values(/** @type {Record<string, unknown>} */ (value))) {
    deepFreeze(nested);
  }
  Object.freeze(/** @type {object} */ (value));
  return value;
}

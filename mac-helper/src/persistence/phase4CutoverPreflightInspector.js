// @ts-check

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */

/**
 * Read-only pre-migration inspection. This module never constructs
 * SwiftSimSqliteDatabase and never runs a migration-capable open. Its only
 * SQLite touch is a read-only/query-only connection used to substantiate
 * migration identity, integrity, shadow counts, and rollback material.
 */
export class Phase4CutoverPreflightInspector {
  #stateRoot;
  /** @type {SpawnSyncLike | undefined} */
  #spawnSync;

  /** @param {{ stateRoot: string, spawnSync?: SpawnSyncLike }} options */
  constructor({ stateRoot, spawnSync }) {
    if (typeof stateRoot !== "string" || !stateRoot) {
      throw new TypeError("Phase-4 preflight requires an explicit state root.");
    }
    this.#stateRoot = stateRoot;
    if (spawnSync !== undefined && typeof spawnSync !== "function") {
      throw new TypeError("Phase-4 preflight spawnSync must be a function.");
    }
    this.#spawnSync = spawnSync;
  }

  inspect() {
    const stateRoot = this.#stateRoot;
    const databasePath = join(stateRoot, "state.sqlite");
    const databasePresent = exists(databasePath);
    const migration = readImmutableMigrationFacts(databasePath, databasePresent);
    const shadows = readShadowCounts(databasePath, databasePresent);
    const lockIdentity = readLockOwnerIdentity(stateRoot, this.#spawnSync);
    const permissions = privatePermissions(stateRoot, databasePresent);
    const rollbackMaterial = rollbackMaterialFacts(
      stateRoot,
      databasePresent,
      migration.schemaVersion,
    );
    const processIdentity = readProcessIdentity(this.#spawnSync);
    const snapshot = preMigrationSnapshotFacts(stateRoot, databasePresent);
    const sourceHashes = legacySourceHashes(stateRoot);
    return Object.freeze({
      readOnly: true,
      mutationAllowed: false,
      includesMigrationCapableOpen: false,
      permissionsMissing: permissions.missing,
      databasePresent,
      schemaVersion: migration.schemaVersion,
      latestSchemaVersion: migration.latestSchemaVersion,
      migrationCoherent: migration.coherent,
      migrationIdentities: migration.identities,
      databaseHealth: migration.health,
      shadowMismatchCount: shadows.total,
      shadowCounts: shadows,
      locks: lockIdentity,
      permissions,
      rollbackMaterial,
      processIdentity,
      preMigrationSnapshot: snapshot,
      sourceHashes,
      stateRoot,
    });
  }
}

/** @param {string} path */
function exists(path) {
  try {
    statSync(path);
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

/** @param {string} path @param {boolean} present */
function readImmutableMigrationFacts(path, present) {
  if (!present) {
    return Object.freeze({
      schemaVersion: 0,
      latestSchemaVersion: 0,
      coherent: false,
      identities: Object.freeze([]),
      health: null,
    });
  }
  const database = openReadOnly(path);
  try {
    database.exec("PRAGMA query_only = ON");
    const rows = database
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
    const integrity = String(
      database.prepare("PRAGMA integrity_check").get()?.integrity_check || "",
    );
    const journalMode = String(database.prepare("PRAGMA journal_mode").get()?.journal_mode || "");
    const foreignKeys =
      Number(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys || 0) === 1;
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all().length;
    const contiguous = rows.every((row, index) => row.version === index + 1);
    const nonEmptyNames = rows.every((row) => row.name.length > 0);
    const shaChecks = rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum));
    return Object.freeze({
      schemaVersion: rows.at(-1)?.version || 0,
      latestSchemaVersion: 0,
      coherent: contiguous && nonEmptyNames && shaChecks,
      identities: Object.freeze(rows),
      health: Object.freeze({
        integrity,
        journalMode,
        foreignKeys,
        foreignKeyViolations,
        ok:
          integrity === "ok" && journalMode === "wal" && foreignKeys && foreignKeyViolations === 0,
      }),
    });
  } finally {
    database.close();
  }
}

/** @param {string} path */
function openReadOnly(path) {
  return new DatabaseSync(path, { readOnly: true });
}

/** @param {string} path @param {boolean} present */
function readShadowCounts(path, present) {
  if (!present) {
    return Object.freeze({ pairing: 0, deviceBuild: 0, total: 0 });
  }
  const database = openReadOnly(path);
  try {
    database.exec("PRAGMA query_only = ON");
    const pairing = Number(
      database.prepare("SELECT COUNT(*) AS count FROM pairing_shadow_mismatches").get()?.count || 0,
    );
    const deviceBuild = Number(
      database.prepare("SELECT COUNT(*) AS count FROM device_build_shadow_mismatches").get()
        ?.count || 0,
    );
    return Object.freeze({ pairing, deviceBuild, total: pairing + deviceBuild });
  } catch {
    return Object.freeze({ pairing: 0, deviceBuild: 0, total: 0 });
  } finally {
    database.close();
  }
}

/** @param {string} stateRoot @param {SpawnSyncLike | undefined} spawnSync */
function readLockOwnerIdentity(stateRoot, spawnSync) {
  const names = [
    "pairing.json.lock",
    "pairing-invites.json.lock",
    "device-builds.json.lock",
    "sessions.json.lock",
  ];
  const locks = names.map((name) => {
    const path = join(stateRoot, name);
    const ownerPath = join(path, "owner.json");
    if (!exists(ownerPath)) return Object.freeze({ path, available: true, owner: null });
    let owner;
    try {
      owner = JSON.parse(readText(ownerPath));
    } catch {
      return Object.freeze({ path, available: false, owner: null });
    }
    const alive =
      Number(owner?.pid || 0) > 1 &&
      processStartToken(Number(owner.pid), spawnSync) === owner?.startToken;
    return Object.freeze({ path, available: !alive, owner });
  });
  return Object.freeze({
    available: locks.every((lock) => lock.available),
    locks: Object.freeze(locks),
  });
}

/** @param {SpawnSyncLike | undefined} spawnSync */
function readProcessIdentity(spawnSync) {
  const pid = process.pid;
  const startedAt = processStartToken(pid, spawnSync);
  return Object.freeze({
    pid,
    startedAt,
    measured: Boolean(startedAt),
  });
}

/** @param {number} pid @param {SpawnSyncLike | undefined} spawnSync */
function processStartToken(pid, spawnSync) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  let result;
  try {
    result = (spawnSync || noopSpawnSync)("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
    });
  } catch {
    return null;
  }
  const values = /** @type {Record<string, unknown> | null} */ (
    result && typeof result === "object" && !Array.isArray(result) ? result : null
  );
  if (!values || values.status !== 0) return null;
  const token = String(values.stdout || "").trim();
  return token || null;
}

/** @type {SpawnSyncLike} */
function noopSpawnSync() {
  throw new Error("Phase-4 preflight requires an injected spawnSync to verify process identity.");
}

/** @param {string} stateRoot @param {boolean} databasePresent */
function privatePermissions(stateRoot, databasePresent) {
  /** @param {string} path @param {boolean} required */
  const privateCheck = (path, required) => {
    if (!exists(path)) return required ? { private: false } : { private: true };
    const mode = statSync(path).mode;
    return { private: (mode & 0o077) === 0 };
  };
  const stateRootPerm = privateCheck(stateRoot, true);
  const databasePerm = privateCheck(join(stateRoot, "state.sqlite"), databasePresent);
  const backupDir = join(stateRoot, "migration-backups", "phase4-cutover");
  const backupPerm = privateCheck(backupDir, false);
  const lockDirs = [
    "pairing.json.lock",
    "pairing-invites.json.lock",
    "device-builds.json.lock",
    "sessions.json.lock",
  ];
  const lockPerms = lockDirs.map((name) => privateCheck(join(stateRoot, name), false));
  const missing = [
    ...(stateRootPerm.private ? [] : ["stateRoot"]),
    ...(databasePerm.private ? [] : ["database"]),
    ...(backupPerm.private ? [] : ["backups"]),
    ...(lockPerms.some((entry) => !entry.private) ? ["locks"] : []),
  ];
  return Object.freeze({
    stateRoot: stateRootPerm.private,
    database: databasePerm.private,
    backups: backupPerm.private,
    locks: lockPerms.every((entry) => entry.private),
    missing,
  });
}

/** @param {string} stateRoot @param {boolean} databasePresent @param {number} schemaVersion */
function rollbackMaterialFacts(stateRoot, databasePresent, schemaVersion) {
  const rollbackDir = join(stateRoot, "migration-backups", "phase4-rollback");
  const readers = exists(rollbackDir) ? readdirSync(rollbackDir).length > 0 : false;
  return Object.freeze({
    present: databasePresent,
    readers,
    schemaVersion,
  });
}

/** @param {string} stateRoot @param {boolean} databasePresent */
function preMigrationSnapshotFacts(stateRoot, databasePresent) {
  const snapshot = join(stateRoot, "migration-backups", "phase4-cutover", "state.sqlite");
  return Object.freeze({
    present: databasePresent && exists(snapshot),
    path: snapshot,
  });
}

/** @param {string} stateRoot */
function legacySourceHashes(stateRoot) {
  /** @param {string} name */
  const source = (name) => {
    const path = join(stateRoot, name);
    if (!exists(path)) return Object.freeze({ present: false, digest: null });
    const raw = readText(path);
    return Object.freeze({ present: true, digest: sha256(raw) });
  };
  return Object.freeze({
    pairing: source("pairing.json"),
    invitations: source("pairing-invites.json"),
    deviceBuilds: source("device-builds.json"),
    sessions: source("sessions.json"),
  });
}

/** @param {string} path */
function readText(path) {
  return readFileSync(path, "utf8");
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

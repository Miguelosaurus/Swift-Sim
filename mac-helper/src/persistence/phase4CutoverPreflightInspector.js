// @ts-check

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  expectedPhase4MigrationIdentities,
  inspectPhase4MigrationIdentity,
} from "./phase4MigrationIdentity.js";

/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */

/**
 * Read-only pre-migration inspection. This class intentionally does not try to
 * infer the maintenance helper from the inspector's own process. Exact helper
 * identity is bound later from the helper-written PID + Darwin start-token
 * journal by phase4MaintenanceEvidence.js.
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
    if (spawnSync !== undefined && typeof spawnSync !== "function") {
      throw new TypeError("Phase-4 preflight spawnSync must be a function.");
    }
    this.#stateRoot = stateRoot;
    this.#spawnSync = spawnSync;
  }

  inspect() {
    const stateRoot = this.#stateRoot;
    const databasePath = join(stateRoot, "state.sqlite");
    const databasePresent = exists(databasePath);
    const migration = databasePresent
      ? inspectPhase4MigrationIdentity(databasePath, {
          allowedVersions: [7, 8, 9],
          requireFull: false,
          requireWal: true,
        })
      : null;
    const shadows = databasePresent ? readShadowCounts(databasePath) : zeroShadows();
    const locks = readLockOwnerIdentity(stateRoot, this.#spawnSync);
    const permissions = privatePermissions(stateRoot, databasePresent);
    const authority = readAuthority(databasePath, migration?.schemaVersion || 0);
    return Object.freeze({
      readOnly: true,
      mutationAllowed: false,
      includesMigrationCapableOpen: false,
      permissionsMissing: permissions.missing,
      privatePermissionsVerified: permissions.missing.length === 0,
      databasePresent,
      schemaVersion: migration?.schemaVersion || 0,
      latestSchemaVersion: expectedPhase4MigrationIdentities().length,
      migrationCoherent: migration?.coherent || false,
      migrationIdentities: migration?.migrationIdentities || Object.freeze([]),
      databaseHealth: migration
        ? Object.freeze({
            integrity: migration.integrity,
            journalMode: migration.journalMode,
            foreignKeys: migration.foreignKeys,
            foreignKeyViolations: migration.foreignKeyViolations,
            ok: true,
          })
        : null,
      shadowMismatchCount: shadows.total,
      shadowCounts: shadows,
      locks,
      permissions,
      authority,
      processIdentity: Object.freeze({
        measured: false,
        source: "helper-journal-required-at-evidence-binding",
      }),
      preMigrationSnapshots: readSnapshotFacts(stateRoot),
      sourceHashes: legacySourceHashes(stateRoot),
      stateRoot,
    });
  }
}

/** @param {string} databasePath */
function readShadowCounts(databasePath) {
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

function zeroShadows() {
  return Object.freeze({ pairing: 0, deviceBuild: 0, total: 0 });
}

/** @param {string} path @param {number} schemaVersion */
function readAuthority(path, schemaVersion) {
  if (schemaVersion < 9) return Object.freeze({ mode: "legacy", source: "pre-v9-implicit" });
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const row = database
      .prepare("SELECT mode, revision, cutover_epoch FROM phase4_authority_state WHERE singleton = 1")
      .get();
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Phase-4 authority observation returned no singleton row.");
    }
    const value = /** @type {Record<string, unknown>} */ (row);
    const mode = String(value.mode || "");
    if (!["legacy", "preparing", "sqlite-rollback", "rollback-preparing", "sqlite-final"].includes(mode)) {
      throw new Error(`Phase-4 authority observation returned invalid mode ${mode || "empty"}.`);
    }
    return Object.freeze({
      mode,
      source: "phase4_authority_state",
      revision: requireNonNegativeInteger(value.revision, "Phase-4 authority revision"),
      cutoverEpoch: requireNonNegativeInteger(value.cutover_epoch, "Phase-4 authority epoch"),
    });
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
    const ownerPath = join(stateRoot, name, "owner.json");
    if (!exists(ownerPath)) return Object.freeze({ name, available: true, state: "unowned" });
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
      throw new Error(`Phase-4 lock owner ${name} is invalid.`);
    }
    const value = /** @type {Record<string, unknown>} */ (owner);
    const pid = requirePositivePid(value.pid, `Phase-4 lock owner ${name} pid`);
    const startToken = String(value.startToken || value.startedAt || "").trim();
    if (!startToken) throw new Error(`Phase-4 lock owner ${name} has no exact start token.`);
    if (!spawnSync) {
      return Object.freeze({ name, available: false, state: "identity-unmeasured" });
    }
    const observed = processStartToken(pid, spawnSync);
    const live = observed === startToken;
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

/** @param {string} stateRoot @param {boolean} databasePresent */
function privatePermissions(stateRoot, databasePresent) {
  const checks = [
    ["stateRoot", stateRoot, true, "directory"],
    ["database", join(stateRoot, "state.sqlite"), databasePresent, "file"],
    ["pairing", join(stateRoot, "pairing.json"), false, "file"],
    ["pairingInvitations", join(stateRoot, "pairing-invites.json"), false, "file"],
    ["deviceBuilds", join(stateRoot, "device-builds.json"), false, "file"],
    ["sessions", join(stateRoot, "sessions.json"), false, "file"],
    ["helperIdentity", join(stateRoot, "runtime", "helper-process-identity.json"), false, "file"],
  ];
  const missing = [];
  const entries = {};
  for (const [label, path, required, type] of checks) {
    if (!exists(path)) {
      entries[label] = Object.freeze({ present: false, private: !required });
      if (required) missing.push(label);
      continue;
    }
    const entry = lstatSync(path);
    const correctType = type === "directory" ? entry.isDirectory() : entry.isFile();
    const privateMode = !entry.isSymbolicLink() && correctType && (statSync(path).mode & 0o077) === 0;
    entries[label] = Object.freeze({ present: true, private: privateMode });
    if (!privateMode) missing.push(label);
  }
  return Object.freeze({ entries: Object.freeze(entries), missing: Object.freeze(missing) });
}

/** @param {string} stateRoot */
function readSnapshotFacts(stateRoot) {
  const directory = join(stateRoot, "migration-backups", "phase4-cutover", "database");
  if (!exists(directory)) return Object.freeze([]);
  const entries = readdirSync(directory)
    .filter((name) => name.endsWith(".sqlite"))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      const bytes = readFileSync(path);
      return Object.freeze({ name, byteLength: bytes.length, sha256: sha256(bytes) });
    });
  return Object.freeze(entries);
}

/** @param {string} stateRoot */
function legacySourceHashes(stateRoot) {
  const source = (fileName) => {
    const path = join(stateRoot, fileName);
    if (!exists(path)) return Object.freeze({ present: false, sha256: null, byteLength: 0 });
    const bytes = readFileSync(path);
    return Object.freeze({ present: true, sha256: sha256(bytes), byteLength: bytes.length });
  };
  return Object.freeze({
    pairing: source("pairing.json"),
    invitations: source("pairing-invites.json"),
    deviceBuilds: source("device-builds.json"),
    sessions: source("sessions.json"),
  });
}

/** @param {string} path */
function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) return false;
    throw error;
  }
}

/** @param {unknown} row @param {string} label */
function requireCount(row, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${label} returned no row.`);
  return requireNonNegativeInteger(/** @type {Record<string, unknown>} */ (row).count, label);
}

/** @param {unknown} value @param {string} label */
function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid.`);
  return Number(value);
}

/** @param {unknown} value @param {string} label */
function requirePositivePid(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) <= 1) throw new Error(`${label} is invalid.`);
  return Number(value);
}

/** @param {Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

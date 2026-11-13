// @ts-check

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NodeAtomicFileStore } from "../infrastructure/nodeAtomicFileStore.js";
import { Phase4CutoverCoordinator } from "./phase4CutoverCoordinator.js";
import { PHASE4_SQLITE_MIGRATIONS } from "./phase4SqliteSchema.js";
import { SqlitePhase4AuthorityRepository } from "./sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "./swiftSimSqliteDatabase.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const AUTOMATIC_ROLLBACK_WINDOW_MS = 30 * DAY_MS;
const RETRY_AFTER_MS = DAY_MS;
const STATUS_FILE = "storage-migration.json";

/**
 * Move a legacy JSON installation to SQLite authority once, at helper startup.
 * The cutover coordinator backs up every legacy source during import and leaves
 * the original JSON untouched; the operator rollback stays available for the
 * window. Failures keep legacy authority and retry at most once per day.
 *
 * @param {{ stateRoot?: string, now?: () => number, spawn?: typeof spawnSync, log?: (line: string) => void,
 *   openDatabase?: (path: string) => SwiftSimSqliteDatabase }} [options]
 */
export function migrateToSqliteAutomatically(options = {}) {
  const stateRoot = options.stateRoot || join(homedir(), ".swift-sim");
  const now = options.now || Date.now;
  const log = options.log || (() => {});
  const statusPath = join(stateRoot, STATUS_FILE);
  // The helper creates the pairing credential first; until then there is no
  // legacy state that needs moving and the import would reject.
  if (!existsSync(join(stateRoot, "pairing.json"))) return Object.freeze({ status: "waiting" });
  const previous = readStatus(statusPath);
  const database = (options.openDatabase || openDatabase)(join(stateRoot, "state.sqlite"));
  try {
    const mode = new SqlitePhase4AuthorityRepository(database).getState().mode;
    if (mode !== "legacy" && mode !== "preparing") return Object.freeze({ status: "sqlite", mode });
    if (previous?.failedAt && now() - Date.parse(previous.failedAt) < RETRY_AFTER_MS) {
      return Object.freeze({ status: "deferred", code: previous.code });
    }
    const result = new Phase4CutoverCoordinator({ database, stateRoot, spawnSync: options.spawn || spawnSync })
      .migrateAutomatically({ rollbackWindowMs: AUTOMATIC_ROLLBACK_WINDOW_MS });
    const rollbackExpiresAt = result.authority?.rollbackExpiresAt || null;
    writeStatus(statusPath, { version: 1, migratedAt: new Date(now()).toISOString(), rollbackExpiresAt });
    log(`Swift Sim moved its local state to SQLite. Legacy backups are kept until ${rollbackExpiresAt}.`);
    return Object.freeze({ status: "migrated", rollbackExpiresAt });
  } catch (error) {
    const code = failureCode(error);
    try {
      writeStatus(statusPath, { version: 1, failedAt: new Date(now()).toISOString(), code });
    } catch {
      // Without a status record the next start simply retries.
    }
    log(`Swift Sim kept its existing local state format (${code}); it will retry later.`);
    return Object.freeze({ status: "legacy", code });
  } finally {
    database.close();
  }
}

/** @param {string} path */
function openDatabase(path) {
  const previous = process.umask(0o077);
  try {
    return new SwiftSimSqliteDatabase({ path, migrations: PHASE4_SQLITE_MIGRATIONS });
  } finally {
    process.umask(previous);
  }
}

/** @param {string} path */
function readStatus(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && value.version === 1 ? value : null;
  } catch {
    return null;
  }
}

/** @param {string} path @param {Record<string, unknown>} value */
function writeStatus(path, value) {
  new NodeAtomicFileStore().writeJSONSync(path, value, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
}

/** @param {unknown} error */
function failureCode(error) {
  const code = /** @type {{ code?: unknown }} */ (error)?.code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  if (/stale/i.test(message)) return "SOURCE_CHANGED_DURING_MIGRATION";
  if (/lock/i.test(message)) return "STATE_LOCKED";
  if (/equality|projection/i.test(message)) return "PROJECTION_MISMATCH";
  return "MIGRATION_FAILED";
}

// @ts-check

import { basename, dirname, isAbsolute, join } from "node:path";

const LEGACY_LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_OWNER_MODE = 0o600;
const SQLITE_FILENAME = "state.sqlite";

/**
 * Derive the staged durable-session observer paths from the authoritative
 * sessions.json path. The observer shares state.sqlite with the other Phase-4
 * domains while keeping session migration backups domain-scoped.
 *
 * @param {string} legacyPath
 */
export function sessionDurableShadowPaths(legacyPath) {
  const sourcePath = requireAbsolutePath(legacyPath, "Session legacy state path");
  const stateDirectory = dirname(sourcePath);
  return Object.freeze({
    databasePath: join(stateDirectory, SQLITE_FILENAME),
    backupDirectory: join(stateDirectory, "migration-backups", "sessions"),
    source: Object.freeze({
      name: basename(sourcePath),
      path: sourcePath,
      lockRequest: Object.freeze({
        path: `${sourcePath}.lock`,
        waitMs: LEGACY_LOCK_WAIT_MS,
        staleAfterMs: OWNERLESS_LOCK_GRACE_MS,
        ownerMode: LEGACY_OWNER_MODE,
      }),
    }),
  });
}

/** @param {unknown} value @param {string} label */
function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || !isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path.`);
  }
  return value;
}

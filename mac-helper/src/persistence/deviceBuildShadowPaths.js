// @ts-check

import { basename, dirname, isAbsolute, join } from "node:path";

const LEGACY_LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_OWNER_MODE = 0o600;
const SQLITE_FILENAME = "state.sqlite";

/**
 * Derive the shadow database and migration-backup locations from the existing
 * authoritative device-build JSON path rather than introducing a second state
 * root. All transactional domains will share the same SQLite database; domain
 * backups remain separated beneath one migration-backup directory.
 *
 * The lock request reproduces DeviceBuildStore's exact legacy protocol:
 * `<json>.lock`, 5 second wait, 250 ms ownerless grace, and 0600 owner record.
 *
 * @param {string} legacyPath
 */
export function deviceBuildShadowPaths(legacyPath) {
  const sourcePath = requireAbsolutePath(legacyPath, "Device-build legacy state path");
  const stateDirectory = dirname(sourcePath);
  return Object.freeze({
    databasePath: join(stateDirectory, SQLITE_FILENAME),
    backupDirectory: join(stateDirectory, "migration-backups", "device-builds"),
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

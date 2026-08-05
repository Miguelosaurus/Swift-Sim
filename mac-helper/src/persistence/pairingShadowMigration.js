// @ts-check

import { createHash } from "node:crypto";
import { join } from "node:path";
import { parsePairingCredential } from "../contracts/pairing.js";

/** @typedef {import("../contracts/pairing.js").PairingCredentialRecord} PairingCredentialRecord */
/** @typedef {import("../contracts/repository.js").LegacyImportCheckpointRepository} LegacyImportCheckpointRepository */
/** @typedef {import("../contracts/repository.js").PairingCredentialRepository} PairingCredentialRepository */
/** @typedef {import("../contracts/repository.js").RepositoryTransactionOwner} RepositoryTransactionOwner */
/** @typedef {import("../infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("../infrastructure/ports.js").LockManager} LockManager */
/** @typedef {import("../infrastructure/ports.js").LockRequest} LockRequest */

const BACKUP_WRITE_OPTIONS = Object.freeze({
  mode: 0o600,
  createParentMode: 0o700,
  replace: false,
  syncDirectory: true,
});

/**
 * @typedef {{
 *   matches: boolean,
 *   legacyProjectionHash: string,
 *   sqliteProjectionHash: string | null,
 * }} PairingShadowComparison
 *
 * @typedef {{
 *   status: "applied" | "already-current",
 *   backupPath: string,
 *   sourceRevision: string,
 *   projectionHash: string,
 *   importedAt: string,
 *   comparison: PairingShadowComparison,
 * }} PairingShadowImportResult
 */

/**
 * Pairing-only migration coordinator. It is intentionally not wired into the
 * production helper in Phase 4B; callers must explicitly supply the legacy
 * source path, its existing lock, and the SQLite repositories.
 */
export class PairingShadowMigration {
  /**
   * @param {{
   *   transactionOwner: RepositoryTransactionOwner,
   *   pairingRepository: PairingCredentialRepository,
   *   checkpointRepository: LegacyImportCheckpointRepository,
   *   fileStore: AtomicFileStore,
   *   lockManager: LockManager,
   *   lockRequest: LockRequest,
   *   sourcePath: string,
   *   sourceName?: string,
   *   backupDirectory: string,
   *   now?: () => string,
   * }} options
   */
  constructor({
    transactionOwner,
    pairingRepository,
    checkpointRepository,
    fileStore,
    lockManager,
    lockRequest,
    sourcePath,
    sourceName = "pairing.json",
    backupDirectory,
    now = () => new Date().toISOString(),
  }) {
    this.transactionOwner = transactionOwner;
    this.pairingRepository = pairingRepository;
    this.checkpointRepository = checkpointRepository;
    this.fileStore = fileStore;
    this.lockManager = lockManager;
    this.lockRequest = lockRequest;
    this.sourcePath = requireNonEmptyString(sourcePath, "Legacy pairing source path");
    this.sourceName = requireSafeSourceName(sourceName);
    this.backupDirectory = requireNonEmptyString(
      backupDirectory,
      "Legacy pairing backup directory",
    );
    this.now = now;
  }

  /** @returns {PairingShadowImportResult} */
  run() {
    return this.lockManager.withLockSync(this.lockRequest, () => {
      const sourceText = this.fileStore.readTextSync(this.sourcePath);
      const sourceRevision = sha256(sourceText);
      const backupPath = pairingBackupPathFor(
        this.backupDirectory,
        this.sourceName,
        sourceRevision,
      );
      ensureImmutableBackup(this.fileStore, backupPath, sourceText);

      const legacyRecord = parseLegacyPairingSource(sourceText, this.sourcePath);
      const projectionHash = pairingProjectionHash(legacyRecord);
      const currentCheckpoint = this.checkpointRepository.get(this.sourceName);
      const currentComparison = comparePairingProjection(
        legacyRecord,
        this.pairingRepository.get(),
      );
      if (
        currentCheckpoint?.sourceRevision === sourceRevision &&
        currentCheckpoint.projectionHash === projectionHash &&
        currentCheckpoint.recordCount === 1 &&
        currentComparison.matches
      ) {
        return {
          status: "already-current",
          backupPath,
          sourceRevision,
          projectionHash,
          importedAt: currentCheckpoint.importedAt,
          comparison: currentComparison,
        };
      }

      const importedAt = requireNonEmptyString(this.now(), "Pairing import timestamp");
      this.transactionOwner.transaction(() => {
        this.pairingRepository.replace(legacyRecord);
        const transactionComparison = comparePairingProjection(
          legacyRecord,
          this.pairingRepository.get(),
        );
        if (!transactionComparison.matches) {
          throw new Error("SQLite pairing projection did not match the locked legacy source.");
        }
        this.checkpointRepository.upsert({
          source: this.sourceName,
          sourceRevision,
          projectionHash,
          importedAt,
          recordCount: 1,
        });
      });

      const comparison = comparePairingProjection(legacyRecord, this.pairingRepository.get());
      if (!comparison.matches) {
        throw new Error("SQLite pairing projection changed immediately after import commit.");
      }
      return {
        status: "applied",
        backupPath,
        sourceRevision,
        projectionHash,
        importedAt,
        comparison,
      };
    });
  }
}

/**
 * @param {PairingCredentialRecord} legacyRecord
 * @param {PairingCredentialRecord | null} sqliteRecord
 * @returns {PairingShadowComparison}
 */
export function comparePairingProjection(legacyRecord, sqliteRecord) {
  const legacyProjectionHash = pairingProjectionHash(legacyRecord);
  const sqliteProjectionHash = sqliteRecord ? pairingProjectionHash(sqliteRecord) : null;
  return {
    matches: legacyProjectionHash === sqliteProjectionHash,
    legacyProjectionHash,
    sqliteProjectionHash,
  };
}

/** @param {PairingCredentialRecord} record */
export function pairingProjectionHash(record) {
  const validated = parsePairingCredential(record);
  return sha256(
    JSON.stringify({
      token: validated.token,
      installationID: validated.installationID,
      macName: validated.macName,
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
    }),
  );
}

/** @param {string} backupDirectory @param {string} sourceName @param {string} sourceRevision */
export function pairingBackupPathFor(backupDirectory, sourceName, sourceRevision) {
  return join(
    requireNonEmptyString(backupDirectory, "Legacy pairing backup directory"),
    `${requireSafeSourceName(sourceName)}.${requireSha256(sourceRevision)}.bak`,
  );
}

/** @param {string} sourceText @param {string} sourcePath */
function parseLegacyPairingSource(sourceText, sourcePath) {
  try {
    return parsePairingCredential(JSON.parse(sourceText));
  } catch (error) {
    throw new Error(`Legacy pairing source at ${sourcePath} is invalid and was not imported.`, {
      cause: error,
    });
  }
}

/** @param {AtomicFileStore} fileStore @param {string} backupPath @param {string} sourceText */
function ensureImmutableBackup(fileStore, backupPath, sourceText) {
  const existing = readIfPresent(fileStore, backupPath);
  if (existing !== null) {
    assertBackupMatches(backupPath, existing, sourceText);
    return;
  }
  try {
    fileStore.writeTextSync(backupPath, sourceText, BACKUP_WRITE_OPTIONS);
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
    const racedBackup = fileStore.readTextSync(backupPath);
    assertBackupMatches(backupPath, racedBackup, sourceText);
  }
}

/** @param {AtomicFileStore} fileStore @param {string} path */
function readIfPresent(fileStore, path) {
  try {
    return fileStore.readTextSync(path);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

/** @param {string} backupPath @param {string} actual @param {string} expected */
function assertBackupMatches(backupPath, actual, expected) {
  if (actual !== expected) {
    throw new Error(
      `Legacy pairing backup at ${backupPath} does not match its content-addressed source.`,
    );
  }
}

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    /** @type {{ code?: unknown }} */ (error).code === code
  );
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** @param {unknown} value */
function requireSha256(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Legacy pairing source revision must be a lowercase SHA-256 digest.");
  }
  return value;
}

/** @param {unknown} value */
function requireSafeSourceName(value) {
  const sourceName = requireNonEmptyString(value, "Legacy pairing source name");
  if (!/^[A-Za-z0-9._-]+$/.test(sourceName) || sourceName === "." || sourceName === "..") {
    throw new Error("Legacy pairing source name must be a safe file name.");
  }
  return sourceName;
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

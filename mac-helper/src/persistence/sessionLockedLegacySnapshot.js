// @ts-check

import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  durableSessionProjectionHash,
  parseLegacyDurableSessions,
} from "./sessionDurableProjection.js";

/** @typedef {import("../contracts/durableSession.js").DurableSessionRecord} DurableSessionRecord */
/** @typedef {import("../infrastructure/ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("../infrastructure/ports.js").LockManager} LockManager */
/** @typedef {import("../infrastructure/ports.js").LockRequest} LockRequest */

/**
 * @typedef {{ name: string, path: string, lockRequest: LockRequest }} SessionLegacySource
 * @typedef {{
 *   snapshot: readonly DurableSessionRecord[],
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 * }} LockedSessionLegacySnapshot
 */

const BACKUP_WRITE_OPTIONS = Object.freeze({
  mode: 0o600,
  createParentMode: 0o700,
  replace: false,
  syncDirectory: true,
});

export class SessionLockedLegacySnapshotReader {
  /** @type {AtomicFileStore} */
  #fileStore;
  /** @type {LockManager} */
  #lockManager;
  /** @type {SessionLegacySource} */
  #source;
  /** @type {string} */
  #backupDirectory;

  /**
   * @param {{
   *   fileStore: AtomicFileStore,
   *   lockManager: LockManager,
   *   source: SessionLegacySource,
   *   backupDirectory: string,
   * }} options
   */
  constructor({ fileStore, lockManager, source, backupDirectory }) {
    if (
      !fileStore ||
      typeof fileStore.readTextSync !== "function" ||
      typeof fileStore.writeTextSync !== "function"
    ) {
      throw new Error("Session legacy atomic file store is required.");
    }
    if (!lockManager || typeof lockManager.withLockSync !== "function") {
      throw new Error("Session legacy lock manager is required.");
    }
    this.#fileStore = fileStore;
    this.#lockManager = lockManager;
    this.#source = validateSessionLegacySource(source);
    this.#backupDirectory = requireNonEmptyString(
      backupDirectory,
      "Session legacy backup directory",
    );
  }

  /**
   * @template T
   * @param {(snapshot: LockedSessionLegacySnapshot) => T} operation
   * @returns {T}
   */
  withLockedSnapshot(operation) {
    if (typeof operation !== "function" || operation.constructor?.name === "AsyncFunction") {
      throw new Error("Session locked snapshot operation must complete synchronously.");
    }
    return this.#lockManager.withLockSync(this.#source.lockRequest, () => {
      const locked = this.#readLockedSnapshot();
      const result = operation(locked);
      if (isThenable(result)) {
        throw new Error("Session locked snapshot operation must complete synchronously.");
      }
      return result;
    });
  }

  /** @returns {LockedSessionLegacySnapshot} */
  #readLockedSnapshot() {
    let raw = null;
    try {
      raw = this.#fileStore.readTextSync(this.#source.path);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    }
    const digest = raw === null ? null : sha256(raw);
    let backupPath = null;
    if (raw !== null && digest !== null) {
      backupPath = join(
        this.#backupDirectory,
        `sessions-${sanitizeSourceName(this.#source.name)}.${digest}.bak`,
      );
      try {
        this.#fileStore.writeTextSync(backupPath, raw, BACKUP_WRITE_OPTIONS);
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
      }
      if (this.#fileStore.readTextSync(backupPath) !== raw) {
        throw new Error(`Session legacy backup content mismatch: ${backupPath}.`);
      }
    }

    const snapshot = Object.freeze(
      (raw === null ? [] : parseLegacyDurableSessions(raw, this.#source.path)).map((record) =>
        Object.freeze(structuredClone(record)),
      ),
    );
    return Object.freeze({
      snapshot,
      sourceRevision: sha256(
        JSON.stringify({ version: 1, name: this.#source.name, present: raw !== null, digest }),
      ),
      projectionHash: durableSessionProjectionHash(snapshot),
      recordCount: snapshot.length,
      backups: Object.freeze(backupPath ? [backupPath] : []),
    });
  }
}

/** @param {SessionLegacySource} source */
export function validateSessionLegacySource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Session legacy source is required.");
  }
  return {
    name: requireNonEmptyString(source.name, "Session legacy source name"),
    path: requireNonEmptyString(source.path, "Session legacy source path"),
    lockRequest: validateLockRequest(source.lockRequest),
  };
}

/** @param {LockRequest} request */
function validateLockRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Session legacy lock request is required.");
  }
  return {
    path: requireNonEmptyString(request.path, "Session legacy lock path"),
    waitMs: request.waitMs,
    staleAfterMs: request.staleAfterMs,
    ownerMode: request.ownerMode,
  };
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

/** @param {string} value */
function sanitizeSourceName(value) {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) {
    throw new Error("Session legacy source name has no safe backup characters.");
  }
  return sanitized;
}

/** @param {unknown} value */
function isThenable(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (/** @type {{ then?: unknown }} */ (value).then) === "function"
  );
}

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

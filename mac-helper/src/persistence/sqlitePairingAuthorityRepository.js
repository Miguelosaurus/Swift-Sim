// @ts-check

/** @typedef {import("../contracts/repository.js").PairingAuthorityCutoverEvidence} PairingAuthorityCutoverEvidence */
/** @typedef {import("../contracts/repository.js").PairingAuthorityState} PairingAuthorityState */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

export class SqlitePairingAuthorityRepository {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  #readStatement;
  #activateStatement;
  #rollbackStatement;
  #finalizeStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#database = database;
    this.#readStatement = database.prepare(`SELECT
      mode,
      source_revision,
      projection_hash,
      cutover_at,
      rollback_expires_at,
      finalized_at,
      revision
    FROM pairing_authority_state
    WHERE singleton = 1`);
    this.#activateStatement = database.prepare(`UPDATE pairing_authority_state
      SET mode = 'sqlite-rollback',
          source_revision = ?,
          projection_hash = ?,
          cutover_at = ?,
          rollback_expires_at = ?,
          finalized_at = NULL,
          revision = revision + 1
      WHERE singleton = 1 AND mode = 'legacy' AND revision = ?`);
    this.#rollbackStatement = database.prepare(`UPDATE pairing_authority_state
      SET mode = 'legacy',
          source_revision = NULL,
          projection_hash = NULL,
          cutover_at = NULL,
          rollback_expires_at = NULL,
          finalized_at = NULL,
          revision = revision + 1
      WHERE singleton = 1 AND mode = 'sqlite-rollback' AND revision = ?`);
    this.#finalizeStatement = database.prepare(`UPDATE pairing_authority_state
      SET mode = 'sqlite-final',
          finalized_at = ?,
          revision = revision + 1
      WHERE singleton = 1 AND mode = 'sqlite-rollback' AND revision = ?`);
  }

  /** @returns {PairingAuthorityState} */
  current() {
    return mapAuthorityRow(this.#readStatement.get());
  }

  /** @param {PairingAuthorityCutoverEvidence} evidence @returns {PairingAuthorityState} */
  activateSqlite(evidence) {
    const normalized = normalizeCutoverEvidence(evidence);
    return this.#database.transaction(() => {
      const current = this.current();
      if (current.mode === "sqlite-rollback" && sameCutover(current, normalized)) {
        return current;
      }
      if (current.mode !== "legacy") {
        throw new Error(`Pairing authority cannot activate SQLite from ${current.mode}.`);
      }
      requireOneChange(
        this.#activateStatement.run(
          normalized.sourceRevision,
          normalized.projectionHash,
          normalized.cutoverAt,
          normalized.rollbackExpiresAt,
          current.revision,
        ),
        "activate SQLite pairing authority",
      );
      return this.current();
    });
  }

  /**
   * @param {{ sourceRevision: string, rolledBackAt: string }} input
   * @returns {PairingAuthorityState}
   */
  rollbackToLegacy(input) {
    const sourceRevision = requireHash(input?.sourceRevision, "Pairing rollback sourceRevision");
    const rolledBackAt = requireCanonicalTimestamp(input?.rolledBackAt, "Pairing rolledBackAt");
    return this.#database.transaction(() => {
      const current = this.current();
      if (current.mode !== "sqlite-rollback") {
        throw new Error(`Pairing authority cannot roll back from ${current.mode}.`);
      }
      if (current.sourceRevision !== sourceRevision) {
        throw new Error("Pairing rollback sourceRevision does not match the frozen legacy source.");
      }
      const cutoverAt = requireCanonicalTimestamp(current.cutoverAt, "Pairing cutoverAt");
      const rollbackExpiresAt = requireCanonicalTimestamp(
        current.rollbackExpiresAt,
        "Pairing rollbackExpiresAt",
      );
      if (rolledBackAt.time < cutoverAt.time) {
        throw new Error("Pairing rollback cannot precede cutover.");
      }
      if (rolledBackAt.time > rollbackExpiresAt.time) {
        throw new Error("Pairing rollback window has expired.");
      }
      requireOneChange(
        this.#rollbackStatement.run(current.revision),
        "roll back pairing authority",
      );
      return this.current();
    });
  }

  /** @param {{ finalizedAt: string }} input @returns {PairingAuthorityState} */
  finalizeSqlite(input) {
    const finalizedAt = requireCanonicalTimestamp(input?.finalizedAt, "Pairing finalizedAt");
    return this.#database.transaction(() => {
      const current = this.current();
      if (current.mode === "sqlite-final" && current.finalizedAt === finalizedAt.value) {
        return current;
      }
      if (current.mode !== "sqlite-rollback") {
        throw new Error(`Pairing authority cannot finalize SQLite from ${current.mode}.`);
      }
      const rollbackExpiresAt = requireCanonicalTimestamp(
        current.rollbackExpiresAt,
        "Pairing rollbackExpiresAt",
      );
      if (finalizedAt.time < rollbackExpiresAt.time) {
        throw new Error("Pairing authority cannot finalize before the rollback window expires.");
      }
      requireOneChange(
        this.#finalizeStatement.run(finalizedAt.value, current.revision),
        "finalize SQLite pairing authority",
      );
      return this.current();
    });
  }
}

/** @param {unknown} value @returns {PairingAuthorityCutoverEvidence} */
function normalizeCutoverEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing cutover evidence must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  const cutoverAt = requireCanonicalTimestamp(values.cutoverAt, "Pairing cutoverAt");
  const rollbackExpiresAt = requireCanonicalTimestamp(
    values.rollbackExpiresAt,
    "Pairing rollbackExpiresAt",
  );
  if (rollbackExpiresAt.time <= cutoverAt.time) {
    throw new Error("Pairing rollbackExpiresAt must follow cutoverAt.");
  }
  return {
    sourceRevision: requireHash(values.sourceRevision, "Pairing sourceRevision"),
    projectionHash: requireHash(values.projectionHash, "Pairing projectionHash"),
    cutoverAt: cutoverAt.value,
    rollbackExpiresAt: rollbackExpiresAt.value,
  };
}

/** @param {unknown} row @returns {PairingAuthorityState} */
function mapAuthorityRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SQLite returned no pairing authority state.");
  }
  const values = /** @type {Record<string, unknown>} */ (row);
  const revision = requireSafeInteger(values.revision, "Pairing authority revision");
  if (values.mode === "legacy") {
    requireNullEvidence(values, "legacy");
    return {
      mode: "legacy",
      sourceRevision: null,
      projectionHash: null,
      cutoverAt: null,
      rollbackExpiresAt: null,
      finalizedAt: null,
      revision,
    };
  }
  if (values.mode !== "sqlite-rollback" && values.mode !== "sqlite-final") {
    throw new Error("SQLite returned an invalid pairing authority mode.");
  }
  const sourceRevision = requireHash(values.source_revision, "Pairing sourceRevision");
  const projectionHash = requireHash(values.projection_hash, "Pairing projectionHash");
  const cutoverAt = requireCanonicalTimestamp(values.cutover_at, "Pairing cutoverAt");
  const rollbackExpiresAt = requireCanonicalTimestamp(
    values.rollback_expires_at,
    "Pairing rollbackExpiresAt",
  );
  if (rollbackExpiresAt.time <= cutoverAt.time) {
    throw new Error("SQLite returned an invalid pairing rollback interval.");
  }
  if (values.mode === "sqlite-rollback") {
    if (values.finalized_at !== null) {
      throw new Error("SQLite returned finalized evidence during the rollback window.");
    }
    return {
      mode: "sqlite-rollback",
      sourceRevision,
      projectionHash,
      cutoverAt: cutoverAt.value,
      rollbackExpiresAt: rollbackExpiresAt.value,
      finalizedAt: null,
      revision,
    };
  }
  const finalizedAt = requireCanonicalTimestamp(values.finalized_at, "Pairing finalizedAt");
  if (finalizedAt.time < rollbackExpiresAt.time) {
    throw new Error("SQLite returned pairing finalization before rollback expiry.");
  }
  return {
    mode: "sqlite-final",
    sourceRevision,
    projectionHash,
    cutoverAt: cutoverAt.value,
    rollbackExpiresAt: rollbackExpiresAt.value,
    finalizedAt: finalizedAt.value,
    revision,
  };
}

/** @param {Record<string, unknown>} values @param {string} mode */
function requireNullEvidence(values, mode) {
  for (const key of [
    "source_revision",
    "projection_hash",
    "cutover_at",
    "rollback_expires_at",
    "finalized_at",
  ]) {
    if (values[key] !== null) {
      throw new Error(`SQLite returned ${mode} pairing authority with cutover evidence.`);
    }
  }
}

/**
 * @param {PairingAuthorityState} current
 * @param {PairingAuthorityCutoverEvidence} evidence
 */
function sameCutover(current, evidence) {
  return (
    current.sourceRevision === evidence.sourceRevision &&
    current.projectionHash === evidence.projectionHash &&
    current.cutoverAt === evidence.cutoverAt &&
    current.rollbackExpiresAt === evidence.rollbackExpiresAt
  );
}

/** @param {unknown} result @param {string} action */
function requireOneChange(result, action) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`Could not ${action} because SQLite returned no change result.`);
  }
  const values = /** @type {Record<string, unknown>} */ (result);
  if (requireSafeInteger(values.changes, "SQLite change count") !== 1) {
    throw new Error(`Could not ${action} because the authority revision changed.`);
  }
}

/** @param {unknown} value @param {string} label */
function requireSafeInteger(value, label) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (
    typeof value === "bigint" &&
    value >= 0n &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  throw new Error(`${label} must be a non-negative safe integer.`);
}

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireCanonicalTimestamp(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return { value, time };
}

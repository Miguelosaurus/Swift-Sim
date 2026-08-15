// @ts-check

import { createHash, randomBytes } from "node:crypto";

/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

export const PHASE4_AUTHORITY_MODES = Object.freeze({
  legacy: "legacy",
  preparing: "preparing",
  sqliteRollback: "sqlite-rollback",
  sqliteFinal: "sqlite-final",
});

export class SqlitePhase4AuthorityRepository {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  #readStatement;
  #prepareStatement;
  #cancelStatement;
  #activateStatement;
  #rollbackStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#database = database;
    this.#readStatement = database.prepare(`SELECT
      storage_version, mode, revision, cutover_epoch, preparation_id,
      evidence_hash, evidence_json, prepared_at, cutover_at,
      rollback_expires_at, finalized_at, updated_at
    FROM phase4_authority_state WHERE singleton = 1`);
    this.#prepareStatement = database.prepare(`UPDATE phase4_authority_state SET
      mode = 'preparing',
      revision = ?,
      preparation_id = ?,
      evidence_hash = ?,
      evidence_json = ?,
      prepared_at = ?,
      cutover_at = NULL,
      rollback_expires_at = NULL,
      finalized_at = NULL,
      updated_at = ?
    WHERE singleton = 1 AND mode = 'legacy' AND revision = ?`);
    this.#cancelStatement = database.prepare(`UPDATE phase4_authority_state SET
      mode = 'legacy',
      revision = ?,
      preparation_id = NULL,
      evidence_hash = NULL,
      evidence_json = NULL,
      prepared_at = NULL,
      cutover_at = NULL,
      rollback_expires_at = NULL,
      finalized_at = NULL,
      updated_at = ?
    WHERE singleton = 1 AND mode = 'preparing' AND revision = ? AND preparation_id = ?`);
    this.#activateStatement = database.prepare(`UPDATE phase4_authority_state SET
      mode = 'sqlite-rollback',
      revision = ?,
      cutover_epoch = ?,
      cutover_at = ?,
      rollback_expires_at = ?,
      updated_at = ?
    WHERE singleton = 1 AND mode = 'preparing' AND revision = ? AND preparation_id = ? AND evidence_hash = ?`);
    this.#rollbackStatement = database.prepare(`UPDATE phase4_authority_state SET
      mode = 'legacy',
      revision = ?,
      preparation_id = NULL,
      evidence_hash = NULL,
      evidence_json = NULL,
      prepared_at = NULL,
      cutover_at = NULL,
      rollback_expires_at = NULL,
      finalized_at = NULL,
      updated_at = ?
    WHERE singleton = 1 AND mode = 'sqlite-rollback' AND revision = ? AND cutover_epoch = ?`);
  }

  getState() {
    return parseAuthorityRow(this.#readStatement.get());
  }

  /**
   * Preparation is idempotent for byte-identical evidence. A restart can call
   * it again without creating a new epoch or widening the authority window.
   *
   * @param {{ expectedRevision: number, evidence: unknown, preparationID?: string, now?: string }} input
   */
  beginPreparation(input) {
    const now = timestamp(input.now ?? new Date().toISOString(), "Phase-4 preparation time");
    const evidenceJSON = canonicalJSONString(input.evidence);
    const evidenceHash = sha256(evidenceJSON);
    const preparationID = input.preparationID
      ? digest(input.preparationID, "Phase-4 preparation id")
      : sha256(`${evidenceHash}\0${randomBytes(32).toString("hex")}`);
    const expectedRevision = revision(input.expectedRevision, "Phase-4 expected revision");

    return this.#database.transaction(() => {
      const state = this.getState();
      if (state.mode === PHASE4_AUTHORITY_MODES.preparing) {
        if (state.revision !== expectedRevision) staleRevision(expectedRevision, state.revision);
        if (state.evidenceHash !== evidenceHash || state.preparationID !== preparationID) {
          throw new Error("Phase-4 preparation already exists with different evidence or identity.");
        }
        return state;
      }
      if (state.mode !== PHASE4_AUTHORITY_MODES.legacy) {
        throw new Error(`Phase-4 preparation requires legacy authority, found ${state.mode}.`);
      }
      if (state.revision !== expectedRevision) staleRevision(expectedRevision, state.revision);
      const nextRevision = state.revision + 1;
      const result = this.#prepareStatement.run(
        nextRevision,
        preparationID,
        evidenceHash,
        evidenceJSON,
        now,
        now,
        state.revision,
      );
      if (Number(result.changes) !== 1) throw new Error("Phase-4 preparation lost its revision fence.");
      return this.getState();
    });
  }

  /**
   * Cancel only an uncommitted preparation. Product authority remains legacy
   * throughout, making this safe to resume after a stale-source rejection.
   * @param {{ expectedRevision: number, preparationID: string, now?: string }} input
   */
  cancelPreparation(input) {
    const expectedRevision = revision(input.expectedRevision, "Phase-4 expected revision");
    const preparationID = digest(input.preparationID, "Phase-4 preparation id");
    const now = timestamp(input.now ?? new Date().toISOString(), "Phase-4 cancellation time");
    return this.#database.transaction(() => {
      const state = this.getState();
      if (state.mode === PHASE4_AUTHORITY_MODES.legacy) return state;
      if (state.mode !== PHASE4_AUTHORITY_MODES.preparing) {
        throw new Error(`Phase-4 preparation cannot be cancelled from ${state.mode}.`);
      }
      if (state.revision !== expectedRevision) staleRevision(expectedRevision, state.revision);
      if (state.preparationID !== preparationID) {
        throw new Error("Phase-4 preparation id does not match the active preparation.");
      }
      const result = this.#cancelStatement.run(
        state.revision + 1,
        now,
        state.revision,
        preparationID,
      );
      if (Number(result.changes) !== 1) {
        throw new Error("Phase-4 preparation cancellation lost its revision fence.");
      }
      return this.getState();
    });
  }

  /**
   * The optional callback runs inside the exact same BEGIN IMMEDIATE/COMMIT as
   * the global selector update. It is used only for domain-local fence rows
   * (pairing); it may not start another SQLite transaction.
   *
   * @param {{
   *   expectedRevision: number,
   *   preparationID: string,
   *   evidenceHash: string,
   *   rollbackExpiresAt: string,
   *   now?: string,
   *   beforeSelectorCommit?: (input: { cutoverEpoch: number, cutoverAt: string, rollbackExpiresAt: string }) => void,
   * }} input
   */
  activateSqliteRollback(input) {
    const expectedRevision = revision(input.expectedRevision, "Phase-4 expected revision");
    const preparationID = digest(input.preparationID, "Phase-4 preparation id");
    const evidenceHash = digest(input.evidenceHash, "Phase-4 evidence hash");
    const cutoverAt = timestamp(input.now ?? new Date().toISOString(), "Phase-4 cutover time");
    const rollbackExpiresAt = timestamp(input.rollbackExpiresAt, "Phase-4 rollback expiry");
    if (Date.parse(rollbackExpiresAt) <= Date.parse(cutoverAt)) {
      throw new Error("Phase-4 rollback expiry must be after cutover time.");
    }

    return this.#database.transaction(() => {
      const state = this.getState();
      if (state.mode !== PHASE4_AUTHORITY_MODES.preparing) {
        throw new Error(`Phase-4 activation requires preparing authority, found ${state.mode}.`);
      }
      if (state.revision !== expectedRevision) staleRevision(expectedRevision, state.revision);
      if (state.preparationID !== preparationID || state.evidenceHash !== evidenceHash) {
        throw new Error("Phase-4 activation evidence does not match the prepared epoch.");
      }
      const cutoverEpoch = state.cutoverEpoch + 1;
      input.beforeSelectorCommit?.({ cutoverEpoch, cutoverAt, rollbackExpiresAt });
      const nextRevision = state.revision + 1;
      const result = this.#activateStatement.run(
        nextRevision,
        cutoverEpoch,
        cutoverAt,
        rollbackExpiresAt,
        cutoverAt,
        state.revision,
        preparationID,
        evidenceHash,
      );
      if (Number(result.changes) !== 1) throw new Error("Phase-4 activation lost its revision fence.");
      return this.getState();
    });
  }

  /**
   * The half-open rollback window is [cutoverAt, rollbackExpiresAt). Current
   * SQLite data must already have been exported and verified before this call.
   *
   * @param {{
   *   expectedRevision: number,
   *   expectedCutoverEpoch: number,
   *   now?: string,
   *   beforeSelectorCommit?: (input: { cutoverEpoch: number }) => void,
   * }} input
   */
  rollbackToLegacy(input) {
    const expectedRevision = revision(input.expectedRevision, "Phase-4 expected revision");
    const expectedCutoverEpoch = revision(input.expectedCutoverEpoch, "Phase-4 cutover epoch");
    const now = timestamp(input.now ?? new Date().toISOString(), "Phase-4 rollback time");

    return this.#database.transaction(() => {
      const state = this.getState();
      if (state.mode !== PHASE4_AUTHORITY_MODES.sqliteRollback) {
        throw new Error(`Phase-4 rollback requires sqlite-rollback authority, found ${state.mode}.`);
      }
      if (state.revision !== expectedRevision) staleRevision(expectedRevision, state.revision);
      if (state.cutoverEpoch !== expectedCutoverEpoch) {
        throw new Error(
          `Phase-4 rollback epoch is stale: expected ${expectedCutoverEpoch}, found ${state.cutoverEpoch}.`,
        );
      }
      if (!state.rollbackExpiresAt || Date.parse(now) >= Date.parse(state.rollbackExpiresAt)) {
        throw new Error("Phase-4 rollback window has expired.");
      }
      input.beforeSelectorCommit?.({ cutoverEpoch: state.cutoverEpoch });
      const nextRevision = state.revision + 1;
      const result = this.#rollbackStatement.run(
        nextRevision,
        now,
        state.revision,
        state.cutoverEpoch,
      );
      if (Number(result.changes) !== 1) throw new Error("Phase-4 rollback lost its revision fence.");
      return this.getState();
    });
  }
}

/** @param {unknown} row */
function parseAuthorityRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Phase-4 authority state is missing.");
  }
  const value = /** @type {Record<string, unknown>} */ (row);
  const mode = String(value.mode || "");
  if (!Object.values(PHASE4_AUTHORITY_MODES).includes(mode)) {
    throw new Error(`Phase-4 authority state has invalid mode ${mode || "<empty>"}.`);
  }
  const evidenceJSON = nullableString(value.evidence_json);
  let evidence = null;
  if (evidenceJSON !== null) {
    try { evidence = JSON.parse(evidenceJSON); } catch { throw new Error("Phase-4 preparation evidence is malformed."); }
  }
  return Object.freeze({
    storageVersion: revision(value.storage_version, "Phase-4 storage version"),
    mode,
    revision: revision(value.revision, "Phase-4 authority revision"),
    cutoverEpoch: revision(value.cutover_epoch, "Phase-4 cutover epoch"),
    preparationID: nullableString(value.preparation_id),
    evidenceHash: nullableString(value.evidence_hash),
    evidence,
    preparedAt: nullableString(value.prepared_at),
    cutoverAt: nullableString(value.cutover_at),
    rollbackExpiresAt: nullableString(value.rollback_expires_at),
    finalizedAt: nullableString(value.finalized_at),
    updatedAt: String(value.updated_at || ""),
  });
}

/** @param {unknown} value */
function canonicalJSONString(value) {
  return JSON.stringify(canonicalize(value));
}

/** @param {unknown} value @returns {unknown} */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(/** @type {Record<string, unknown>} */ (value))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  if (["string", "number", "boolean"].includes(typeof value) || value === null) return value;
  throw new Error("Phase-4 preparation evidence must be canonical JSON data.");
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} value @param {string} label */
function digest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  const canonical = new Date(value).toISOString();
  if (value !== canonical) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return canonical;
}

/** @param {unknown} value @param {string} label */
function revision(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value */
function nullableString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Phase-4 authority text column is invalid.");
  return value;
}

function staleRevision(expected, actual) {
  throw new Error(`Phase-4 authority revision is stale: expected ${expected}, found ${actual}.`);
}

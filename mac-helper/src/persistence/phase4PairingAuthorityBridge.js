// @ts-check

import { normalizePairingAuthorityState } from "./pairingAuthorityReadRepository.js";

/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

/**
 * Pairing retains its validated v7 domain fence row. This bridge changes that
 * row only from inside the global v9 selector transaction, so the pairing-local
 * evidence can never become the product-wide authority selector by accident.
 */
export class Phase4PairingAuthorityBridge {
  #read;
  #activate;
  #rollback;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#read = database.prepare(`SELECT
      mode,
      preparation_id AS preparationID,
      source_revision AS sourceRevision,
      projection_hash AS projectionHash,
      cutover_at AS cutoverAt,
      rollback_expires_at AS rollbackExpiresAt,
      finalized_at AS finalizedAt,
      revision
    FROM pairing_authority_state WHERE singleton = 1`);
    this.#activate = database.prepare(`UPDATE pairing_authority_state SET
      mode = 'sqlite-rollback',
      source_revision = ?,
      projection_hash = ?,
      cutover_at = ?,
      rollback_expires_at = ?,
      finalized_at = NULL,
      revision = revision + 1
    WHERE singleton = 1 AND mode = 'legacy-preparing'
      AND preparation_id = ? AND revision = ?`);
    this.#rollback = database.prepare(`UPDATE pairing_authority_state SET
      mode = 'legacy',
      preparation_id = NULL,
      source_revision = NULL,
      projection_hash = NULL,
      cutover_at = NULL,
      rollback_expires_at = NULL,
      finalized_at = NULL,
      revision = revision + 1
    WHERE singleton = 1 AND mode = 'sqlite-rollback'
      AND source_revision = ? AND revision = ?`);
  }

  current() {
    return normalizePairingAuthorityState(this.#read.get());
  }

  /**
   * Must be called while SwiftSimSqliteDatabase already owns BEGIN IMMEDIATE.
   * @param {{ preparationID: string, sourceRevision: string, projectionHash: string, cutoverAt: string, rollbackExpiresAt: string }} input
   */
  activateInsideGlobalCommit(input) {
    const current = this.current();
    if (current.mode === "sqlite-rollback") {
      if (
        current.preparationID === input.preparationID &&
        current.sourceRevision === input.sourceRevision &&
        current.projectionHash === input.projectionHash &&
        current.cutoverAt === input.cutoverAt &&
        current.rollbackExpiresAt === input.rollbackExpiresAt
      ) {
        return current;
      }
      throw new Error("Pairing local authority already belongs to a different cutover epoch.");
    }
    if (current.mode !== "legacy-preparing" || current.preparationID !== input.preparationID) {
      throw new Error("Pairing local authority is not prepared for the global cutover epoch.");
    }
    const result = this.#activate.run(
      requireHash(input.sourceRevision, "Pairing sourceRevision"),
      requireHash(input.projectionHash, "Pairing projectionHash"),
      requireTimestamp(input.cutoverAt, "Pairing cutoverAt"),
      requireTimestamp(input.rollbackExpiresAt, "Pairing rollbackExpiresAt"),
      requireHash(input.preparationID, "Pairing preparationID"),
      current.revision,
    );
    if (Number(result.changes) !== 1) {
      throw new Error("Pairing local activation lost its revision fence inside global commit.");
    }
    return this.current();
  }

  /**
   * Must be called only after current SQLite pairing state was exported and
   * verified against legacy files, while the global rollback transaction is
   * still pending.
   * @param {{ sourceRevision: string, rolledBackAt: string }} input
   */
  rollbackInsideGlobalCommit(input) {
    const current = this.current();
    if (current.mode === "legacy") return current;
    if (current.mode !== "sqlite-rollback") {
      throw new Error(`Pairing local rollback requires sqlite-rollback, found ${current.mode}.`);
    }
    const rolledBackAt = requireTimestamp(input.rolledBackAt, "Pairing rolledBackAt");
    const cutoverAt = requireTimestamp(current.cutoverAt, "Pairing cutoverAt");
    const rollbackExpiresAt = requireTimestamp(
      current.rollbackExpiresAt,
      "Pairing rollbackExpiresAt",
    );
    if (Date.parse(rolledBackAt) < Date.parse(cutoverAt)) {
      throw new Error("Pairing rollback cannot precede cutover.");
    }
    if (Date.parse(rolledBackAt) >= Date.parse(rollbackExpiresAt)) {
      throw new Error("Pairing rollback window has expired.");
    }
    if (current.sourceRevision !== requireHash(input.sourceRevision, "Pairing sourceRevision")) {
      throw new Error("Pairing rollback sourceRevision does not match the active epoch.");
    }
    const result = this.#rollback.run(current.sourceRevision, current.revision);
    if (Number(result.changes) !== 1) {
      throw new Error("Pairing local rollback lost its revision fence inside global commit.");
    }
    return this.current();
  }
}

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return value;
}

// @ts-check

import {
  normalizePairingShadowProjection,
  pairingShadowProjectionHash,
  pairingShadowProjectionRecordCount,
} from "./pairingShadowProjection.js";

/** @typedef {import("../contracts/pairing.js").PairingCredentialRecord} PairingCredentialRecord */
/** @typedef {import("../contracts/pairing.js").PairingInvitationRecord} PairingInvitationRecord */
/** @typedef {import("../contracts/repository.js").LegacyImportCheckpoint} LegacyImportCheckpoint */
/** @typedef {import("../contracts/repository.js").LegacyImportCheckpointRepository} LegacyImportCheckpointRepository */
/** @typedef {import("../contracts/repository.js").PairingCredentialRepository} PairingCredentialRepository */
/** @typedef {import("../contracts/repository.js").PairingInvitationRepository} PairingInvitationRepository */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

export class SqlitePairingShadowImporter {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  /** @type {PairingCredentialRepository} */
  #credentials;
  /** @type {PairingInvitationRepository} */
  #invitations;
  /** @type {LegacyImportCheckpointRepository} */
  #checkpoints;
  /** @type {() => string} */
  #now;

  /**
   * @param {{
   *   database: SwiftSimSqliteDatabase,
   *   credentials: PairingCredentialRepository,
   *   invitations: PairingInvitationRepository,
   *   checkpoints: LegacyImportCheckpointRepository,
   *   now?: () => string,
   * }} options
   */
  constructor({
    database,
    credentials,
    invitations,
    checkpoints,
    now = () => new Date().toISOString(),
  }) {
    this.#database = database;
    this.#credentials = credentials;
    this.#invitations = invitations;
    this.#checkpoints = checkpoints;
    this.#now = now;
  }

  /**
   * @param {{
   *   source: string,
   *   sourceRevision: string,
   *   credential?: PairingCredentialRecord | null,
   *   invitations: readonly PairingInvitationRecord[],
   * }} input
   * @returns {LegacyImportCheckpoint}
   */
  import(input) {
    const source = requireNonEmptyString(input?.source, "Pairing shadow source");
    const sourceRevision = requireNonEmptyString(
      input?.sourceRevision,
      "Pairing shadow sourceRevision",
    );
    const projection = normalizePairingShadowProjection({
      credential: input?.credential,
      invitations: input?.invitations,
    });
    const projectionHash = pairingShadowProjectionHash(projection);
    const recordCount = pairingShadowProjectionRecordCount(projection);

    return this.#database.transaction(() => {
      const currentCheckpoint = this.#checkpoints.get(source);
      const currentProjectionHash = pairingShadowProjectionHash(this.read());
      if (
        currentCheckpoint?.sourceRevision === sourceRevision &&
        currentCheckpoint.projectionHash === projectionHash &&
        currentCheckpoint.recordCount === recordCount &&
        currentProjectionHash === projectionHash
      ) {
        return currentCheckpoint;
      }

      const importedAt = requireNonEmptyString(this.#now(), "Pairing shadow importedAt");
      this.#invitations.replaceAll([]);
      this.#credentials.replaceAll(projection.credential ? [projection.credential] : []);
      this.#invitations.replaceAll(projection.invitations);

      const storedHash = pairingShadowProjectionHash(this.read());
      if (storedHash !== projectionHash) {
        throw new Error(
          `Pairing shadow projection mismatch: imported ${projectionHash}, read back ${storedHash}.`,
        );
      }

      const checkpoint = {
        source,
        sourceRevision,
        projectionHash,
        importedAt,
        recordCount,
      };
      this.#checkpoints.upsert(checkpoint);
      return checkpoint;
    });
  }

  read() {
    const credentials = this.#credentials.list();
    if (credentials.length > 1) {
      throw new Error("Pairing shadow state contains more than one credential.");
    }
    return normalizePairingShadowProjection({
      credential: credentials[0] ?? null,
      invitations: this.#invitations.list(),
    });
  }
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

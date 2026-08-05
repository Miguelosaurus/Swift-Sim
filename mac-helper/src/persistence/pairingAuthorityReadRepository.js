// @ts-check

/** @typedef {import("../contracts/repository.js").PairingAuthorityReader} PairingAuthorityReader */
/** @typedef {import("../contracts/repository.js").PairingAuthorityState} PairingAuthorityState */
/** @typedef {import("../contracts/repository.js").PairingStateReader} PairingStateReader */

const PAIRING_READER_METHODS = Object.freeze([
  "read",
  "getCredential",
  "getInvitation",
  "findInvitationByInviteHash",
]);

export class PairingAuthorityReadRepository {
  /** @type {PairingAuthorityReader} */
  #authorityReader;
  /** @type {PairingStateReader} */
  #legacyReader;
  /** @type {PairingStateReader} */
  #sqliteReader;

  /**
   * @param {{
   *   authorityReader: PairingAuthorityReader,
   *   legacyReader: PairingStateReader,
   *   sqliteReader: PairingStateReader,
   * }} options
   */
  constructor(options) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new Error("Pairing authority read repository options must be an object.");
    }
    this.#authorityReader = requireAuthorityReader(options.authorityReader);
    this.#legacyReader = requirePairingStateReader(options.legacyReader, "Legacy pairing reader");
    this.#sqliteReader = requirePairingStateReader(options.sqliteReader, "SQLite pairing reader");
    if (this.#legacyReader === this.#sqliteReader) {
      throw new Error("Legacy and SQLite pairing readers must be distinct.");
    }
  }

  read() {
    return this.#selectedReader().read();
  }

  /** @param {string} installationID */
  getCredential(installationID) {
    return this.#selectedReader().getCredential(installationID);
  }

  /** @param {string} id */
  getInvitation(id) {
    return this.#selectedReader().getInvitation(id);
  }

  /** @param {string} inviteHash */
  findInvitationByInviteHash(inviteHash) {
    return this.#selectedReader().findInvitationByInviteHash(inviteHash);
  }

  /** @returns {PairingStateReader} */
  #selectedReader() {
    const authority = normalizePairingAuthorityState(this.#authorityReader.current());
    return authority.mode === "legacy" || authority.mode === "legacy-preparing"
      ? this.#legacyReader
      : this.#sqliteReader;
  }
}

/** @param {unknown} value @returns {Readonly<PairingAuthorityState>} */
export function normalizePairingAuthorityState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing authority state must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  const revision = requireSafeInteger(values.revision, "Pairing authority revision");

  if (values.mode === "legacy") {
    for (const key of [
      "preparationID",
      "sourceRevision",
      "projectionHash",
      "cutoverAt",
      "rollbackExpiresAt",
      "finalizedAt",
    ]) {
      if (values[key] !== null) {
        throw new Error("Legacy pairing authority cannot contain cutover evidence.");
      }
    }
    return Object.freeze({
      mode: "legacy",
      preparationID: null,
      sourceRevision: null,
      projectionHash: null,
      cutoverAt: null,
      rollbackExpiresAt: null,
      finalizedAt: null,
      revision,
    });
  }

  if (
    values.mode !== "legacy-preparing" &&
    values.mode !== "sqlite-rollback" &&
    values.mode !== "sqlite-final"
  ) {
    throw new Error(
      "Pairing authority mode must be legacy, legacy-preparing, sqlite-rollback, or sqlite-final.",
    );
  }
  const preparationID = requireHash(values.preparationID, "Pairing preparationID");
  const cutoverAt = requireCanonicalTimestamp(values.cutoverAt, "Pairing cutoverAt");
  const rollbackExpiresAt = requireCanonicalTimestamp(
    values.rollbackExpiresAt,
    "Pairing rollbackExpiresAt",
  );
  if (rollbackExpiresAt.time <= cutoverAt.time) {
    throw new Error("Pairing rollbackExpiresAt must follow cutoverAt.");
  }

  if (values.mode === "legacy-preparing") {
    if (
      values.sourceRevision !== null ||
      values.projectionHash !== null ||
      values.finalizedAt !== null
    ) {
      throw new Error("Pairing preparation cannot contain cutover evidence.");
    }
    return Object.freeze({
      mode: "legacy-preparing",
      preparationID,
      sourceRevision: null,
      projectionHash: null,
      cutoverAt: cutoverAt.value,
      rollbackExpiresAt: rollbackExpiresAt.value,
      finalizedAt: null,
      revision,
    });
  }

  const sourceRevision = requireHash(values.sourceRevision, "Pairing sourceRevision");
  const projectionHash = requireHash(values.projectionHash, "Pairing projectionHash");
  if (values.mode === "sqlite-rollback") {
    if (values.finalizedAt !== null) {
      throw new Error("SQLite rollback authority cannot contain finalization evidence.");
    }
    return Object.freeze({
      mode: "sqlite-rollback",
      preparationID,
      sourceRevision,
      projectionHash,
      cutoverAt: cutoverAt.value,
      rollbackExpiresAt: rollbackExpiresAt.value,
      finalizedAt: null,
      revision,
    });
  }

  const finalizedAt = requireCanonicalTimestamp(values.finalizedAt, "Pairing finalizedAt");
  if (finalizedAt.time < rollbackExpiresAt.time) {
    throw new Error("Pairing finalization cannot precede rollback expiry.");
  }
  return Object.freeze({
    mode: "sqlite-final",
    preparationID,
    sourceRevision,
    projectionHash,
    cutoverAt: cutoverAt.value,
    rollbackExpiresAt: rollbackExpiresAt.value,
    finalizedAt: finalizedAt.value,
    revision,
  });
}

/** @param {unknown} value @returns {PairingAuthorityReader} */
function requireAuthorityReader(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing authority reader must be an object.");
  }
  const reader = /** @type {Record<string, unknown>} */ (value);
  if (typeof reader.current !== "function") {
    throw new Error("Pairing authority reader must implement current().");
  }
  return /** @type {PairingAuthorityReader} */ (value);
}

/** @param {unknown} value @param {string} label @returns {PairingStateReader} */
function requirePairingStateReader(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const reader = /** @type {Record<string, unknown>} */ (value);
  for (const method of PAIRING_READER_METHODS) {
    if (typeof reader[method] !== "function") {
      throw new Error(`${label} must implement ${method}().`);
    }
  }
  return /** @type {PairingStateReader} */ (value);
}

/** @param {unknown} value @param {string} label */
function requireSafeInteger(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
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

// @ts-check

/** @typedef {import("../contracts/repository.js").PairingAuthorityRepository} PairingAuthorityRepository */
/** @typedef {import("../contracts/repository.js").PairingAuthoritySelection} PairingAuthoritySelection */
/** @typedef {import("../contracts/repository.js").PairingAuthorityState} PairingAuthorityState */
/** @typedef {import("../contracts/repository.js").PairingStateRepository} PairingStateRepository */

const PAIRING_STATE_METHODS = Object.freeze([
  "read",
  "replace",
  "getCredential",
  "getInvitation",
  "findInvitationByInviteHash",
]);

export class PairingAuthoritySelector {
  /** @type {PairingAuthorityRepository} */
  #authorityRepository;
  /** @type {PairingStateRepository} */
  #legacyRepository;
  /** @type {PairingStateRepository} */
  #sqliteRepository;

  /**
   * @param {{
   *   authorityRepository: PairingAuthorityRepository,
   *   legacyRepository: PairingStateRepository,
   *   sqliteRepository: PairingStateRepository,
   * }} options
   */
  constructor(options) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new Error("Pairing authority selector options must be an object.");
    }
    this.#authorityRepository = requireAuthorityRepository(options.authorityRepository);
    this.#legacyRepository = requirePairingStateRepository(
      options.legacyRepository,
      "Legacy pairing repository",
    );
    this.#sqliteRepository = requirePairingStateRepository(
      options.sqliteRepository,
      "SQLite pairing repository",
    );
    if (this.#legacyRepository === this.#sqliteRepository) {
      throw new Error("Legacy and SQLite pairing repositories must be distinct.");
    }
  }

  /** @returns {Readonly<PairingAuthoritySelection>} */
  select() {
    const authority = normalizePairingAuthorityState(this.#authorityRepository.current());
    const target = authority.mode === "legacy" ? "legacy" : "sqlite";
    return Object.freeze({
      authority,
      target,
      repository: target === "legacy" ? this.#legacyRepository : this.#sqliteRepository,
    });
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
      sourceRevision: null,
      projectionHash: null,
      cutoverAt: null,
      rollbackExpiresAt: null,
      finalizedAt: null,
      revision,
    });
  }

  if (values.mode !== "sqlite-rollback" && values.mode !== "sqlite-final") {
    throw new Error("Pairing authority mode must be legacy, sqlite-rollback, or sqlite-final.");
  }
  const sourceRevision = requireHash(values.sourceRevision, "Pairing sourceRevision");
  const projectionHash = requireHash(values.projectionHash, "Pairing projectionHash");
  const cutoverAt = requireCanonicalTimestamp(values.cutoverAt, "Pairing cutoverAt");
  const rollbackExpiresAt = requireCanonicalTimestamp(
    values.rollbackExpiresAt,
    "Pairing rollbackExpiresAt",
  );
  if (rollbackExpiresAt.time <= cutoverAt.time) {
    throw new Error("Pairing rollbackExpiresAt must follow cutoverAt.");
  }

  if (values.mode === "sqlite-rollback") {
    if (values.finalizedAt !== null) {
      throw new Error("SQLite rollback authority cannot contain finalization evidence.");
    }
    return Object.freeze({
      mode: "sqlite-rollback",
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
    sourceRevision,
    projectionHash,
    cutoverAt: cutoverAt.value,
    rollbackExpiresAt: rollbackExpiresAt.value,
    finalizedAt: finalizedAt.value,
    revision,
  });
}

/** @param {unknown} value @returns {PairingAuthorityRepository} */
function requireAuthorityRepository(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing authority repository must be an object.");
  }
  const repository = /** @type {Record<string, unknown>} */ (value);
  if (typeof repository.current !== "function") {
    throw new Error("Pairing authority repository must implement current().");
  }
  return /** @type {PairingAuthorityRepository} */ (value);
}

/** @param {unknown} value @param {string} label @returns {PairingStateRepository} */
function requirePairingStateRepository(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const repository = /** @type {Record<string, unknown>} */ (value);
  for (const method of PAIRING_STATE_METHODS) {
    if (typeof repository[method] !== "function") {
      throw new Error(`${label} must implement ${method}().`);
    }
  }
  return /** @type {PairingStateRepository} */ (value);
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

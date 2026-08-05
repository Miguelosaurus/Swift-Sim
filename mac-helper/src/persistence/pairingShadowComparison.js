// @ts-check

import { createHash } from "node:crypto";
import { parsePairingCredential, parsePairingInvitation } from "../contracts/pairing.js";

/** @typedef {import("../contracts/repository.js").PairingShadowComparisonResult} PairingShadowComparisonResult */
/** @typedef {import("../contracts/repository.js").PairingShadowMismatchRepository} PairingShadowMismatchRepository */
/** @typedef {import("../contracts/repository.js").PairingShadowProjection} PairingShadowProjection */
/** @typedef {import("../contracts/repository.js").PairingShadowSurface} PairingShadowSurface */

export class PairingShadowComparator {
  /** @type {PairingShadowMismatchRepository} */
  #mismatchRepository;
  /** @type {() => string} */
  #now;

  /**
   * @param {{
   *   mismatchRepository: PairingShadowMismatchRepository,
   *   now?: () => string,
   * }} options
   */
  constructor({ mismatchRepository, now = () => new Date().toISOString() }) {
    if (!mismatchRepository || typeof mismatchRepository.observe !== "function") {
      throw new Error("Pairing shadow mismatch repository is required.");
    }
    this.#mismatchRepository = mismatchRepository;
    this.#now = now;
  }

  /**
   * Compare values already read by the authoritative legacy path. This method
   * never reads or writes legacy JSON and its result must not authorize a
   * request; it only records redacted evidence when projections differ.
   *
   * @param {{
   *   surface: PairingShadowSurface,
   *   key: string,
   *   legacy: PairingShadowProjection,
   *   sqlite: PairingShadowProjection,
   * }} input
   * @returns {PairingShadowComparisonResult}
   */
  compare({ surface, key, legacy, sqlite }) {
    const validatedSurface = requireSurface(surface);
    const validatedLegacy = normalizeProjection(validatedSurface, legacy);
    const validatedSqlite = normalizeProjection(validatedSurface, sqlite);
    const keyHash = sha256(requireNonEmptyString(key, "Pairing shadow comparison key"));
    const legacyProjectionHash = projectionHash(validatedLegacy);
    const sqliteProjectionHash = projectionHash(validatedSqlite);
    if (legacyProjectionHash === sqliteProjectionHash) {
      return {
        matched: true,
        surface: validatedSurface,
        keyHash,
        legacyProjectionHash,
        sqliteProjectionHash,
        evidence: null,
      };
    }
    const mismatchID = pairingShadowMismatchID({
      surface: validatedSurface,
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
    });
    const evidence = this.#mismatchRepository.observe({
      mismatchID,
      surface: validatedSurface,
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
      observedAt: requireTimestamp(this.#now(), "Pairing shadow observedAt"),
    });
    return {
      matched: false,
      surface: validatedSurface,
      keyHash,
      legacyProjectionHash,
      sqliteProjectionHash,
      evidence,
    };
  }
}

/**
 * @param {{
 *   surface: PairingShadowSurface,
 *   keyHash: string,
 *   legacyProjectionHash: string | null,
 *   sqliteProjectionHash: string | null,
 * }} input
 */
export function pairingShadowMismatchID(input) {
  return sha256(
    JSON.stringify({
      surface: requireSurface(input.surface),
      keyHash: requireHash(input.keyHash, "Pairing shadow keyHash"),
      legacyProjectionHash: requireNullableHash(
        input.legacyProjectionHash,
        "Pairing shadow legacyProjectionHash",
      ),
      sqliteProjectionHash: requireNullableHash(
        input.sqliteProjectionHash,
        "Pairing shadow sqliteProjectionHash",
      ),
    }),
  );
}

/**
 * @param {PairingShadowSurface} surface
 * @param {PairingShadowProjection} projection
 * @returns {PairingShadowProjection}
 */
function normalizeProjection(surface, projection) {
  if (projection === null) return null;
  if (surface === "credential") {
    const credential = parsePairingCredential(projection);
    return {
      token: credential.token,
      installationID: credential.installationID,
      macName: credential.macName,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
  const invitation = parsePairingInvitation(projection);
  return {
    id: invitation.id,
    inviteHash: invitation.inviteHash,
    installationID: invitation.installationID,
    clientNonce: invitation.clientNonce,
    claimed: invitation.claimed,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    ...(invitation.claimedAt === undefined ? {} : { claimedAt: invitation.claimedAt }),
  };
}

/** @param {PairingShadowProjection} projection */
function projectionHash(projection) {
  if (projection === null) return null;
  return sha256(JSON.stringify(canonicalize(projection)));
}

/** @param {unknown} value @returns {unknown} */
function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Pairing shadow projections require finite numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object") {
    throw new Error("Pairing shadow projections must contain only JSON values.");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  /** @type {Record<string, unknown>} */
  const canonical = {};
  for (const key of Object.keys(record).sort()) {
    canonical[key] = canonicalize(record[key]);
  }
  return canonical;
}

/** @param {unknown} value @returns {PairingShadowSurface} */
function requireSurface(value) {
  if (value !== "credential" && value !== "invitation") {
    throw new Error("Pairing shadow surface must be credential or invitation.");
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireNullableHash(value, label) {
  return value === null ? null : requireHash(value, label);
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireTimestamp(value, label) {
  const timestamp = requireNonEmptyString(value, label);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return timestamp;
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

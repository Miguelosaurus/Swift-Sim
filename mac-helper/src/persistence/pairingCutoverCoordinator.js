// @ts-check

import { normalizePairingAuthorityState } from "./pairingAuthorityReadRepository.js";
import { pairingProjectionHash } from "./pairingLockedLegacySnapshot.js";

/** @typedef {import("../contracts/repository.js").PairingAuthorityRepository} PairingAuthorityRepository */
/** @typedef {import("../contracts/repository.js").PairingAuthorityState} PairingAuthorityState */
/** @typedef {import("../contracts/repository.js").PairingStateSnapshot} PairingStateSnapshot */

/**
 * @typedef {{
 *   snapshot: PairingStateSnapshot,
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 * }} LockedPairingLegacySnapshot
 * @typedef {{
 *   status: "applied" | "checkpointed" | "already-current",
 *   sourceRevision: string,
 *   projectionHash: string,
 *   recordCount: number,
 *   backups: readonly string[],
 * }} PairingLegacyImportResult
 * @typedef {{
 *   withLockedSnapshot<T>(operation: (snapshot: LockedPairingLegacySnapshot) => T): T,
 * }} LockedSnapshotReader
 * @typedef {{
 *   apply(snapshot: LockedPairingLegacySnapshot): PairingLegacyImportResult,
 * }} LegacyImportApplier
 * @typedef {{
 *   expectedRevision: number,
 *   preparationID: string,
 *   rollbackWindowMs: number,
 * }} PairingCutoverRequest
 * @typedef {{
 *   status: "activated" | "already-active",
 *   importStatus: "applied" | "checkpointed" | "already-current" | null,
 *   sourceRevision: string,
 *   projectionHash: string,
 *   authority: Readonly<PairingAuthorityState>,
 * }} PairingCutoverResult
 */

export class PairingCutoverCoordinator {
  /** @type {PairingAuthorityRepository} */
  #authorityRepository;
  /** @type {LockedSnapshotReader} */
  #snapshotReader;
  /** @type {LegacyImportApplier} */
  #importApplier;
  /** @type {() => string} */
  #now;

  /**
   * @param {{
   *   authorityRepository: PairingAuthorityRepository,
   *   snapshotReader: LockedSnapshotReader,
   *   importApplier: LegacyImportApplier,
   *   now?: () => string,
   * }} options
   */
  constructor({
    authorityRepository,
    snapshotReader,
    importApplier,
    now = () => new Date().toISOString(),
  }) {
    this.#authorityRepository = requireAuthorityRepository(authorityRepository);
    this.#snapshotReader = requireSnapshotReader(snapshotReader);
    this.#importApplier = requireImportApplier(importApplier);
    if (typeof now !== "function") {
      throw new Error("Pairing cutover clock must be a function.");
    }
    this.#now = now;
  }

  /** @param {PairingCutoverRequest} request @returns {Readonly<PairingCutoverResult>} */
  run(request) {
    const normalized = normalizeRequest(request);
    this.#ensurePreparation(normalized);
    const result = this.#snapshotReader.withLockedSnapshot((lockedSnapshot) =>
      this.#runLocked(normalized, lockedSnapshot),
    );
    if (isThenable(result)) {
      throw new Error("Pairing cutover locked operation must complete synchronously.");
    }
    return result;
  }

  /** @param {PairingCutoverRequest} request */
  #ensurePreparation(request) {
    const current = normalizePairingAuthorityState(this.#authorityRepository.current());
    if (current.mode === "legacy") {
      requireRevision(current, request.expectedRevision, "prepare pairing cutover");
      const prepared = normalizePairingAuthorityState(
        this.#authorityRepository.prepareSqlite({
          expectedRevision: request.expectedRevision,
          preparationID: request.preparationID,
        }),
      );
      requirePreparedState(prepared, request);
      return;
    }
    if (current.mode === "legacy-preparing") {
      requirePreparedState(current, request);
      return;
    }
    if (current.mode === "sqlite-rollback") {
      requireActiveRetryState(current, request);
      return;
    }
    throw new Error(`Pairing cutover cannot run from ${current.mode}.`);
  }

  /**
   * @param {PairingCutoverRequest} request
   * @param {LockedPairingLegacySnapshot} lockedSnapshot
   * @returns {Readonly<PairingCutoverResult>}
   */
  #runLocked(request, lockedSnapshot) {
    const locked = normalizeLockedSnapshotEvidence(lockedSnapshot);
    const current = normalizePairingAuthorityState(this.#authorityRepository.current());

    if (current.mode === "sqlite-rollback") {
      requireActiveRetryState(current, request);
      requireActiveSnapshot(current, locked);
      return cutoverResult("already-active", null, current, locked);
    }

    requirePreparedState(current, request);
    const imported = normalizeImportResult(this.#importApplier.apply(lockedSnapshot));
    if (
      imported.sourceRevision !== locked.sourceRevision ||
      imported.projectionHash !== locked.projectionHash
    ) {
      throw new Error("Pairing import result does not match the locked legacy snapshot.");
    }

    const cutoverAt = requireCanonicalTimestamp(this.#now(), "Pairing cutoverAt");
    const rollbackExpiresAt = addMilliseconds(
      cutoverAt,
      request.rollbackWindowMs,
      "Pairing rollbackExpiresAt",
    );
    const activated = normalizePairingAuthorityState(
      this.#authorityRepository.activateSqlite({
        expectedRevision: current.revision,
        preparationID: request.preparationID,
        sourceRevision: locked.sourceRevision,
        projectionHash: locked.projectionHash,
        cutoverAt: cutoverAt.value,
        rollbackExpiresAt,
      }),
    );
    requireActivatedState(activated, request, locked, cutoverAt.value, rollbackExpiresAt);
    return cutoverResult("activated", imported.status, activated, locked);
  }
}

/** @param {unknown} value @returns {PairingCutoverRequest} */
function normalizeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing cutover request must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  return {
    expectedRevision: requireTransitionRevision(
      values.expectedRevision,
      "Pairing cutover expectedRevision",
    ),
    preparationID: requireHash(values.preparationID, "Pairing preparationID"),
    rollbackWindowMs: requirePositiveSafeInteger(
      values.rollbackWindowMs,
      "Pairing rollbackWindowMs",
    ),
  };
}

/** @param {PairingAuthorityState} state @param {PairingCutoverRequest} request */
function requirePreparedState(state, request) {
  if (
    state.mode !== "legacy-preparing" ||
    state.revision !== request.expectedRevision + 1 ||
    state.preparationID !== request.preparationID
  ) {
    throw new Error("Pairing authority does not match the requested cutover preparation.");
  }
}

/** @param {PairingAuthorityState} state @param {PairingCutoverRequest} request */
function requireActiveRetryState(state, request) {
  if (
    state.revision !== request.expectedRevision + 2 ||
    state.preparationID !== request.preparationID
  ) {
    throw new Error("Pairing authority does not match the requested active cutover epoch.");
  }
}

/**
 * @param {PairingAuthorityState} authority
 * @param {{ sourceRevision: string, projectionHash: string }} locked
 */
function requireActiveSnapshot(authority, locked) {
  if (
    authority.sourceRevision !== locked.sourceRevision ||
    authority.projectionHash !== locked.projectionHash
  ) {
    throw new Error("Active pairing authority does not match the locked legacy snapshot.");
  }
}

/**
 * @param {PairingAuthorityState} authority
 * @param {PairingCutoverRequest} request
 * @param {{ sourceRevision: string, projectionHash: string }} locked
 * @param {string} cutoverAt
 * @param {string} rollbackExpiresAt
 */
function requireActivatedState(
  authority,
  request,
  locked,
  cutoverAt,
  rollbackExpiresAt,
) {
  if (
    authority.mode !== "sqlite-rollback" ||
    authority.revision !== request.expectedRevision + 2 ||
    authority.preparationID !== request.preparationID ||
    authority.sourceRevision !== locked.sourceRevision ||
    authority.projectionHash !== locked.projectionHash ||
    authority.cutoverAt !== cutoverAt ||
    authority.rollbackExpiresAt !== rollbackExpiresAt ||
    authority.finalizedAt !== null
  ) {
    throw new Error("Pairing authority activation did not persist the exact cutover evidence.");
  }
}

/** @param {unknown} value */
function normalizeLockedSnapshotEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing locked legacy snapshot must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  const snapshot = /** @type {PairingStateSnapshot} */ (values.snapshot);
  const sourceRevision = requireHash(values.sourceRevision, "Pairing legacy sourceRevision");
  const projectionHash = requireHash(values.projectionHash, "Pairing legacy projectionHash");
  if (pairingProjectionHash(snapshot) !== projectionHash) {
    throw new Error("Pairing locked snapshot projectionHash does not match its snapshot.");
  }
  return Object.freeze({ sourceRevision, projectionHash });
}

/** @param {unknown} value @returns {PairingLegacyImportResult} */
function normalizeImportResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing import result must be an object.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  if (
    values.status !== "applied" &&
    values.status !== "checkpointed" &&
    values.status !== "already-current"
  ) {
    throw new Error("Pairing import result has an invalid status.");
  }
  return /** @type {PairingLegacyImportResult} */ ({
    ...values,
    sourceRevision: requireHash(values.sourceRevision, "Pairing import sourceRevision"),
    projectionHash: requireHash(values.projectionHash, "Pairing import projectionHash"),
  });
}

/**
 * @param {"activated" | "already-active"} status
 * @param {"applied" | "checkpointed" | "already-current" | null} importStatus
 * @param {Readonly<PairingAuthorityState>} authority
 * @param {{ sourceRevision: string, projectionHash: string }} locked
 * @returns {Readonly<PairingCutoverResult>}
 */
function cutoverResult(status, importStatus, authority, locked) {
  return Object.freeze({
    status,
    importStatus,
    sourceRevision: locked.sourceRevision,
    projectionHash: locked.projectionHash,
    authority,
  });
}

/** @param {unknown} value @returns {PairingAuthorityRepository} */
function requireAuthorityRepository(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing authority repository is required.");
  }
  const repository = /** @type {Record<string, unknown>} */ (value);
  for (const method of ["current", "prepareSqlite", "activateSqlite"]) {
    if (typeof repository[method] !== "function") {
      throw new Error(`Pairing authority repository must implement ${method}().`);
    }
  }
  return /** @type {PairingAuthorityRepository} */ (value);
}

/** @param {unknown} value @returns {LockedSnapshotReader} */
function requireSnapshotReader(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing locked snapshot reader is required.");
  }
  if (typeof (/** @type {Record<string, unknown>} */ (value)).withLockedSnapshot !== "function") {
    throw new Error("Pairing locked snapshot reader must implement withLockedSnapshot().");
  }
  return /** @type {LockedSnapshotReader} */ (value);
}

/** @param {unknown} value @returns {LegacyImportApplier} */
function requireImportApplier(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing legacy import applier is required.");
  }
  if (typeof (/** @type {Record<string, unknown>} */ (value)).apply !== "function") {
    throw new Error("Pairing legacy import applier must implement apply().");
  }
  return /** @type {LegacyImportApplier} */ (value);
}

/** @param {PairingAuthorityState} authority @param {number} revision @param {string} action */
function requireRevision(authority, revision, action) {
  if (authority.revision !== revision) {
    throw new Error(
      `Cannot ${action}: expected pairing authority revision ${revision}, found ${authority.revision}.`,
    );
  }
}

/** @param {{ value: string, time: number }} timestamp @param {number} milliseconds @param {string} label */
function addMilliseconds(timestamp, milliseconds, label) {
  const time = timestamp.time + milliseconds;
  if (!Number.isFinite(time)) throw new Error(`${label} is outside the supported date range.`);
  try {
    return new Date(time).toISOString();
  } catch (error) {
    throw new Error(`${label} is outside the supported date range.`, { cause: error });
  }
}

/** @param {unknown} value @param {string} label */
function requireTransitionRevision(value, label) {
  const revision = requireSafeInteger(value, label);
  if (revision > Number.MAX_SAFE_INTEGER - 2) {
    throw new Error(`${label} cannot advance through cutover safely.`);
  }
  return revision;
}

/** @param {unknown} value @param {string} label */
function requirePositiveSafeInteger(value, label) {
  const integer = requireSafeInteger(value, label);
  if (integer === 0) throw new Error(`${label} must be greater than zero.`);
  return integer;
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

/** @param {unknown} value */
function isThenable(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (/** @type {{ then?: unknown }} */ (value).then) === "function"
  );
}

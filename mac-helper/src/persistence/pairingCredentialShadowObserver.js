// @ts-check

import { parsePairingCredential } from "../contracts/pairing.js";

/** @typedef {import("../contracts/pairing.js").PairingCredentialRecord} PairingCredentialRecord */
/** @typedef {import("../contracts/repository.js").PairingShadowComparisonResult} PairingShadowComparisonResult */
/** @typedef {import("../contracts/repository.js").PairingStateRepository} PairingStateRepository */
/**
 * @typedef {{
 *   compare(input: {
 *     surface: "credential",
 *     key: string,
 *     legacy: PairingCredentialRecord,
 *     sqlite: PairingCredentialRecord | null,
 *   }): PairingShadowComparisonResult,
 * }} PairingShadowComparatorPort
 */

export class PairingCredentialShadowObserver {
  /** @type {PairingStateRepository} */
  #pairingRepository;
  /** @type {PairingShadowComparatorPort} */
  #comparator;
  /** @type {(error: Error) => void} */
  #reportError;

  /**
   * @param {{
   *   pairingRepository: PairingStateRepository,
   *   comparator: PairingShadowComparatorPort,
   *   reportError?: (error: Error) => void,
   * }} options
   */
  constructor({ pairingRepository, comparator, reportError = () => {} }) {
    if (!pairingRepository || typeof pairingRepository.getCredential !== "function") {
      throw new Error("Pairing shadow state repository is required.");
    }
    if (!comparator || typeof comparator.compare !== "function") {
      throw new Error("Pairing shadow comparator is required.");
    }
    if (typeof reportError !== "function") {
      throw new Error("Pairing shadow error reporter must be a function.");
    }
    this.#pairingRepository = pairingRepository;
    this.#comparator = comparator;
    this.#reportError = reportError;
  }

  /**
   * Best-effort only. JSON remains authoritative and callers must ignore this
   * result for authorization and response decisions.
   *
   * @param {PairingCredentialRecord} legacyCredential
   * @returns {PairingShadowComparisonResult | null}
   */
  observeCredential(legacyCredential) {
    try {
      const credential = parsePairingCredential(legacyCredential);
      const sqliteCredential = this.#pairingRepository.getCredential(
        credential.installationID,
      );
      return this.#comparator.compare({
        surface: "credential",
        key: credential.installationID,
        legacy: credential,
        sqlite: sqliteCredential,
      });
    } catch {
      try {
        this.#reportError(new Error("Pairing credential shadow observation failed."));
      } catch {
        // Shadow diagnostics are never allowed to affect JSON authority.
      }
      return null;
    }
  }
}

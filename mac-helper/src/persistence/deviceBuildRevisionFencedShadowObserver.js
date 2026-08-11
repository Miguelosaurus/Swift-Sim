// @ts-check

import { isDeviceBuildRecord } from "../contracts/build.js";

/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowComparisonResult} DeviceBuildShadowComparisonResult */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowProjection} DeviceBuildShadowProjection */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildShadowSurface} DeviceBuildShadowSurface */
/** @typedef {import("../contracts/deviceBuildRepository.js").DeviceBuildStateReader} DeviceBuildStateReader */
/**
 * @typedef {{
 *   compare(input: {
 *     surface: DeviceBuildShadowSurface,
 *     key: string,
 *     legacy: DeviceBuildShadowProjection,
 *     sqlite: DeviceBuildShadowProjection,
 *   }): DeviceBuildShadowComparisonResult,
 * }} DeviceBuildShadowComparatorPort
 * @typedef {{
 *   observe(input: {
 *     surface: DeviceBuildShadowSurface,
 *     key: string,
 *     legacy: DeviceBuildShadowProjection,
 *   }): DeviceBuildShadowComparisonResult | null,
 * }} DeviceBuildShadowObserverPort
 */

/**
 * Prevent expected SQLite staleness from becoming false migration evidence.
 *
 * The live Phase 4L hook currently observes only build records. DeviceBuildStore
 * increments `revision` on every persisted build mutation, so a matching
 * revision is the bounded proof that the already-read JSON projection and the
 * SQLite shadow belong to the same build epoch. Missing SQLite rows or revision
 * drift are skipped rather than persisted as mismatches. Other surfaces retain
 * the generic observer for isolated migration/shadow tests until they gain an
 * equally strong freshness fence at a live authoritative read seam.
 */
export class DeviceBuildRevisionFencedShadowObserver {
  /** @type {DeviceBuildStateReader} */
  #deviceBuildRepository;
  /** @type {DeviceBuildShadowComparatorPort} */
  #comparator;
  /** @type {DeviceBuildShadowObserverPort} */
  #fallbackObserver;
  /** @type {(error: Error) => unknown} */
  #reportError;

  /**
   * @param {{
   *   deviceBuildRepository: DeviceBuildStateReader,
   *   comparator: DeviceBuildShadowComparatorPort,
   *   fallbackObserver: DeviceBuildShadowObserverPort,
   *   reportError?: (error: Error) => unknown,
   * }} options
   */
  constructor({ deviceBuildRepository, comparator, fallbackObserver, reportError = () => {} }) {
    if (!deviceBuildRepository || typeof deviceBuildRepository.getBuild !== "function") {
      throw new Error("Revision-fenced device-build shadow repository is required.");
    }
    if (!comparator || typeof comparator.compare !== "function") {
      throw new Error("Revision-fenced device-build shadow comparator is required.");
    }
    if (!fallbackObserver || typeof fallbackObserver.observe !== "function") {
      throw new Error("Revision-fenced device-build fallback observer is required.");
    }
    if (typeof reportError !== "function") {
      throw new Error("Revision-fenced device-build error reporter must be a function.");
    }
    this.#deviceBuildRepository = deviceBuildRepository;
    this.#comparator = comparator;
    this.#fallbackObserver = fallbackObserver;
    this.#reportError = reportError;
  }

  /**
   * @param {{
   *   surface: DeviceBuildShadowSurface,
   *   key: string,
   *   legacy: DeviceBuildShadowProjection,
   * }} input
   * @returns {DeviceBuildShadowComparisonResult | null}
   */
  observe(input) {
    if (input.surface !== "build") {
      return this.#fallbackObserver.observe(input);
    }

    try {
      if (!isDeviceBuildRecord(input.legacy) || input.legacy.id !== input.key) {
        throw new Error("Revision-fenced legacy build projection is invalid.");
      }
      const sqlite = this.#deviceBuildRepository.getBuild(input.key);
      if (!sqlite) return null;
      if (!isDeviceBuildRecord(sqlite) || sqlite.id !== input.key) {
        throw new Error("Revision-fenced SQLite build projection is invalid.");
      }
      if (sqlite.revision !== input.legacy.revision) return null;

      return this.#comparator.compare({
        surface: "build",
        key: input.key,
        legacy: structuredClone(input.legacy),
        sqlite,
      });
    } catch {
      this.#reportFailure();
      return null;
    }
  }

  #reportFailure() {
    try {
      const reporting = this.#reportError(
        new Error("Revision-fenced device-build shadow observation failed."),
      );
      void Promise.resolve(reporting).catch(() => {});
    } catch {
      // Diagnostic-only shadow work must never affect JSON authority.
    }
  }
}

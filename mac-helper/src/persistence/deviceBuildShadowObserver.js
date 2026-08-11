// @ts-check

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
 */

export class DeviceBuildShadowObserver {
  /** @type {DeviceBuildStateReader} */
  #deviceBuildRepository;
  /** @type {DeviceBuildShadowComparatorPort} */
  #comparator;
  /** @type {(error: Error) => unknown} */
  #reportError;

  /**
   * @param {{
   *   deviceBuildRepository: DeviceBuildStateReader,
   *   comparator: DeviceBuildShadowComparatorPort,
   *   reportError?: (error: Error) => unknown,
   * }} options
   */
  constructor({ deviceBuildRepository, comparator, reportError = () => {} }) {
    if (
      !deviceBuildRepository ||
      typeof deviceBuildRepository.getBuild !== "function" ||
      typeof deviceBuildRepository.read !== "function"
    ) {
      throw new Error("Device-build shadow repository is required.");
    }
    if (!comparator || typeof comparator.compare !== "function") {
      throw new Error("Device-build shadow comparator is required.");
    }
    if (typeof reportError !== "function") {
      throw new Error("Device-build shadow error reporter must be a function.");
    }
    this.#deviceBuildRepository = deviceBuildRepository;
    this.#comparator = comparator;
    this.#reportError = reportError;
  }

  /**
   * Best-effort diagnostic only. The caller supplies a projection it already
   * obtained from the authoritative JSON path. This observer never reads
   * legacy JSON and its result must never influence authorization, response,
   * or mutation decisions.
   *
   * @param {{
   *   surface: DeviceBuildShadowSurface,
   *   key: string,
   *   legacy: DeviceBuildShadowProjection,
   * }} input
   * @returns {DeviceBuildShadowComparisonResult | null}
   */
  observe({ surface, key, legacy }) {
    try {
      const sqlite = this.#sqliteProjection(surface, key);
      return this.#comparator.compare({
        surface,
        key,
        legacy: structuredClone(legacy),
        sqlite,
      });
    } catch {
      this.#reportFailure();
      return null;
    }
  }

  /**
   * @param {DeviceBuildShadowSurface} surface
   * @param {string} key
   * @returns {DeviceBuildShadowProjection}
   */
  #sqliteProjection(surface, key) {
    if (surface === "build") {
      return this.#deviceBuildRepository.getBuild(key);
    }

    const snapshot = this.#deviceBuildRepository.read();
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Device-build shadow snapshot is invalid.");
    }
    switch (surface) {
      case "app":
        return findProjection(snapshot.apps, key, "apps");
      case "artifact-cleanup-job":
        return findProjection(snapshot.artifactCleanupJobs, key, "artifact cleanup jobs");
      case "delivery-cleanup-job":
        return findProjection(
          snapshot.deliveryReferenceCleanupJobs,
          key,
          "delivery cleanup jobs",
        );
      default:
        throw new Error("Device-build shadow surface is invalid.");
    }
  }

  #reportFailure() {
    try {
      const reporting = this.#reportError(new Error("Device-build shadow observation failed."));
      void Promise.resolve(reporting).catch(() => {});
    } catch {
      // Shadow diagnostics are never allowed to affect JSON authority.
    }
  }
}

/**
 * @param {unknown} collection
 * @param {string} key
 * @param {string} label
 * @returns {DeviceBuildShadowProjection}
 */
function findProjection(collection, key, label) {
  if (!Array.isArray(collection)) {
    throw new Error(`Device-build shadow ${label} snapshot is invalid.`);
  }
  return (
    collection.find((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
      return /** @type {{ id?: unknown }} */ (candidate).id === key;
    }) || null
  );
}

// @ts-check

const ACTIVE_BUILD_STATES = new Set([
  "queued",
  "validating",
  "preparing",
  "archiving",
  "building",
  "exporting",
  "delivering",
]);

/**
 * @typedef {{ referenceID?: unknown }} DeliveryReference
 * @typedef {{
 *   id: string,
 *   generation: string,
 *   referenceID: string,
 *   nextAttemptAt?: string,
 *   createdAt?: string,
 * }} DeliveryCleanupJob
 * @typedef {{
 *   id: string,
 *   state?: unknown,
 *   expiresAt?: string,
 *   delivery?: DeliveryReference,
 *   capabilities?: Array<{
 *     expiresAt?: string,
 *     delivery?: DeliveryReference,
 *   }>,
 *   pendingRenewal?: { id?: unknown },
 * }} DeliveryBuild
 * @typedef {{ generation: string, references?: unknown[] }} DeliveryStatus
 * @typedef {{
 *   listDeliveryReferenceCleanupJobs(): DeliveryCleanupJob[],
 *   completeDeliveryReferenceCleanupJob(jobID: string): unknown,
 *   failDeliveryReferenceCleanupJob(jobID: string, error: unknown): unknown,
 *   list(): DeliveryBuild[],
 * }} DeliveryMaintenanceBuildStore
 * @typedef {{
 *   stopGeneration(generation: string, options: { referenceID: string }): boolean,
 *   statuses(): DeliveryStatus[],
 * }} DeliveryMaintenanceAdapter
 * @typedef {{
 *   deviceBuildStore: DeliveryMaintenanceBuildStore,
 *   deviceDelivery: DeliveryMaintenanceAdapter,
 *   now?: number,
 * }} DeliveryMaintenanceOptions
 */

/**
 * Own delivery cleanup/reconciliation concurrency and policy.
 *
 * A single coordinator preserves the compatibility boundary's existing global
 * promise coalescing: concurrent calls return the already-running operation,
 * even when later callers supply different injected dependencies.
 */
export class DeliveryMaintenanceCoordinator {
  /** @type {Promise<void> | undefined} */
  #cleanupPromise;
  /** @type {Promise<void> | undefined} */
  #reconciliationPromise;
  /** @type {Promise<void> | undefined} */
  #maintenancePromise;

  /** @param {DeliveryMaintenanceOptions} options */
  drainCleanupJobsOnce({ deviceBuildStore, deviceDelivery, now = Date.now() }) {
    if (this.#cleanupPromise) return this.#cleanupPromise;
    this.#cleanupPromise = Promise.resolve()
      .then(() => {
        for (const job of deviceBuildStore.listDeliveryReferenceCleanupJobs()) {
          const dueAt = Date.parse(job.nextAttemptAt || job.createdAt || "");
          if (Number.isFinite(dueAt) && dueAt > now) continue;
          try {
            const released = deviceDelivery.stopGeneration(job.generation, {
              referenceID: job.referenceID,
            });
            if (!released) {
              throw new Error("Delivery generation is still referenced or could not be stopped.");
            }
            deviceBuildStore.completeDeliveryReferenceCleanupJob(job.id);
          } catch (error) {
            deviceBuildStore.failDeliveryReferenceCleanupJob(job.id, error);
          }
        }
      })
      .finally(() => {
        this.#cleanupPromise = undefined;
      });
    return this.#cleanupPromise;
  }

  /** @param {DeliveryMaintenanceOptions} options */
  reconcileReferencesOnce({ deviceBuildStore, deviceDelivery, now = Date.now() }) {
    if (this.#reconciliationPromise) return this.#reconciliationPromise;
    this.#reconciliationPromise = Promise.resolve()
      .then(() => {
        const liveReferences = new Set();
        for (const build of deviceBuildStore.list()) {
          const currentExpiresAt = Date.parse(build.expiresAt || "");
          if (Number.isFinite(currentExpiresAt) && currentExpiresAt > now) {
            addDeliveryReference(liveReferences, build.delivery);
          }
          for (const capability of Array.isArray(build.capabilities) ? build.capabilities : []) {
            const expiresAt = Date.parse(capability?.expiresAt || "");
            if (Number.isFinite(expiresAt) && expiresAt > now) {
              addDeliveryReference(liveReferences, capability.delivery);
            }
          }
          if (build.pendingRenewal?.id) {
            liveReferences.add(`renewal:${build.pendingRenewal.id}`);
          }
          if (ACTIVE_BUILD_STATES.has(build.state)) {
            liveReferences.add(`build:${build.id}`);
          }
        }

        for (const status of deviceDelivery.statuses()) {
          for (const referenceID of Array.isArray(status.references) ? status.references : []) {
            if (!isManagedReference(referenceID) || liveReferences.has(referenceID)) continue;
            try {
              deviceDelivery.stopGeneration(status.generation, {
                referenceID: String(referenceID),
              });
            } catch {
              // A later maintenance pass retries surviving state. Never make
              // helper startup depend on best-effort orphan reconciliation.
            }
          }
        }
      })
      .finally(() => {
        this.#reconciliationPromise = undefined;
      });
    return this.#reconciliationPromise;
  }

  /** @param {DeliveryMaintenanceOptions} options */
  runOnce(options) {
    if (this.#maintenancePromise) return this.#maintenancePromise;
    this.#maintenancePromise = Promise.resolve()
      .then(() => this.reconcileReferencesOnce(options))
      .then(() => this.drainCleanupJobsOnce(options))
      .finally(() => {
        this.#maintenancePromise = undefined;
      });
    return this.#maintenancePromise;
  }
}

/** @param {Set<unknown>} references @param {DeliveryReference | undefined} delivery */
function addDeliveryReference(references, delivery) {
  if (delivery?.referenceID) references.add(String(delivery.referenceID));
}

/** @param {unknown} referenceID */
function isManagedReference(referenceID) {
  return /^(?:build|renewal):/.test(String(referenceID || ""));
}

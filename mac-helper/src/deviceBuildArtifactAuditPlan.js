// @ts-check

/**
 * @typedef {{ compilerReady?: boolean }} BuildLiveReload
 * @typedef {{ root?: unknown }} BuildArtifacts
 * @typedef {{
 *   id: string,
 *   state: string,
 *   liveReload?: BuildLiveReload,
 *   artifacts?: BuildArtifacts,
 * }} BuildRecord
 * @typedef {{
 *   buildID: string,
 *   root: string,
 *   totalKiB: number,
 *   derivedDataKiB?: number,
 *   archiveKiB?: number,
 *   resultBundleKiB?: number,
 *   exportPayloadKiB?: number,
 *   scratchKiB?: number,
 *   otherKiB?: number,
 * }} BuildArtifactInventory
 * @typedef {{ name: string, root: string, totalKiB: number }} OrphanArtifactRoot
 */

export const DEVICE_BUILD_ARTIFACT_AUDIT_VERSION = 1;

/**
 * Produce a read-only retention projection from already measured artifact usage.
 * The planner does not touch the filesystem and intentionally does not make
 * superseded-live ownership guesses. It mirrors the proven Phase 4Z2 policy:
 *
 * - failed builds: whole root reclaimable after the diagnostic grace period;
 * - ready non-live builds: DerivedData/archive/result/scratch reclaimable;
 * - ready live compiler builds: archive/result/scratch reclaimable while
 *   DerivedData remains protected;
 * - IPA/export payloads and uncategorized bytes remain protected for ready
 *   builds;
 * - orphan roots are diagnostic/manual-review only, never auto-reclaimable.
 *
 * @param {{
 *   builds: BuildRecord[],
 *   inventory: BuildArtifactInventory[],
 *   orphanRoots?: OrphanArtifactRoot[],
 * }} input
 */
export function planDeviceBuildArtifactAudit({ builds, inventory, orphanRoots = [] }) {
  if (!Array.isArray(builds)) throw new TypeError("Artifact audit builds must be an array.");
  if (!Array.isArray(inventory)) throw new TypeError("Artifact audit inventory must be an array.");
  if (!Array.isArray(orphanRoots)) throw new TypeError("Artifact audit orphan roots must be an array.");

  const inventoryByBuild = new Map();
  for (const entry of inventory) {
    validateInventory(entry);
    if (inventoryByBuild.has(entry.buildID)) {
      throw new Error(`Duplicate artifact inventory for build ${entry.buildID}.`);
    }
    inventoryByBuild.set(entry.buildID, normalizedInventory(entry));
  }

  /** @type {ReturnType<typeof planBuild>[]} */
  const buildPlans = [];
  for (const build of builds) {
    if (!build || typeof build !== "object" || typeof build.id !== "string" || !build.id) {
      throw new TypeError("Artifact audit build records require an id.");
    }
    const measured = inventoryByBuild.get(build.id) || emptyInventory(build);
    buildPlans.push(planBuild(build, measured));
    inventoryByBuild.delete(build.id);
  }

  const unboundInventory = [...inventoryByBuild.values()].map((entry) => ({
    buildID: entry.buildID,
    root: entry.root,
    totalKiB: entry.totalKiB,
    disposition: "manual-review",
    reason: "artifact inventory has no matching build record",
  }));
  const normalizedOrphans = orphanRoots.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !entry.name) {
      throw new TypeError("Orphan artifact roots require a name.");
    }
    const totalKiB = nonnegativeNumber(entry.totalKiB, "orphan totalKiB");
    return Object.freeze({
      name: entry.name,
      root: String(entry.root || ""),
      totalKiB,
      disposition: "manual-review",
      reason: "artifact root is not referenced by current build metadata",
    });
  });

  const buckets = Object.freeze({
    nonLiveReadyIntermediates: summarize(
      buildPlans.filter((plan) => plan.policy === "ready-non-live"),
      (plan) => plan.reclaimableKiB,
    ),
    liveReadyIntermediates: summarize(
      buildPlans.filter((plan) => plan.policy === "ready-live"),
      (plan) => plan.reclaimableKiB,
    ),
    failedWholeRoots: summarize(
      buildPlans.filter((plan) => plan.policy === "failed"),
      (plan) => plan.reclaimableKiB,
    ),
    protectedLiveDerivedData: summarize(
      buildPlans.filter((plan) => plan.policy === "ready-live"),
      (plan) => plan.protectedDerivedDataKiB,
    ),
    protectedInstallPayloads: summarize(
      buildPlans.filter((plan) => plan.state === "ready"),
      (plan) => plan.protectedInstallPayloadKiB,
    ),
  });

  const totalKiB = sum(buildPlans, (plan) => plan.totalKiB)
    + sum(normalizedOrphans, (entry) => entry.totalKiB)
    + sum(unboundInventory, (entry) => entry.totalKiB);
  const reclaimableKiB = sum(buildPlans, (plan) => plan.reclaimableKiB);
  const protectedKiB = sum(buildPlans, (plan) => plan.protectedKiB);
  const manualReviewKiB = sum(normalizedOrphans, (entry) => entry.totalKiB)
    + sum(unboundInventory, (entry) => entry.totalKiB);

  return Object.freeze({
    version: DEVICE_BUILD_ARTIFACT_AUDIT_VERSION,
    readOnly: true,
    buildCount: builds.length,
    measuredBuildCount: buildPlans.filter((plan) => plan.measured).length,
    totalKiB,
    reclaimableKiB,
    protectedKiB,
    manualReviewKiB,
    buckets,
    builds: Object.freeze(buildPlans),
    orphanRoots: Object.freeze(normalizedOrphans),
    unboundInventory: Object.freeze(unboundInventory),
    warnings: Object.freeze([
      "Historical cleanup is not activated by this projection.",
      "Live-ready DerivedData remains protected until live-build ownership and supersession are durable and unambiguous.",
      "Orphan or unbound artifact roots require manual review and are never counted as automatically reclaimable.",
    ]),
  });
}

/** @param {BuildRecord} build @param {ReturnType<typeof normalizedInventory>} measured */
function planBuild(build, measured) {
  const state = String(build.state || "");
  const compilerReady = build.liveReload?.compilerReady === true;
  const ready = state === "ready";
  const failed = state === "failed";
  const readyIntermediatesKiB = measured.archiveKiB
    + measured.resultBundleKiB
    + measured.scratchKiB
    + (compilerReady ? 0 : measured.derivedDataKiB);
  const reclaimableKiB = failed
    ? measured.totalKiB
    : ready
      ? readyIntermediatesKiB
      : 0;
  const policy = failed
    ? "failed"
    : ready
      ? compilerReady ? "ready-live" : "ready-non-live"
      : "protected-other-state";
  const protectedKiB = Math.max(0, measured.totalKiB - reclaimableKiB);
  return Object.freeze({
    buildID: build.id,
    root: measured.root,
    state,
    compilerReady,
    measured: measured.measured,
    policy,
    totalKiB: measured.totalKiB,
    reclaimableKiB,
    protectedKiB,
    protectedDerivedDataKiB: ready && compilerReady ? measured.derivedDataKiB : 0,
    protectedInstallPayloadKiB: ready ? measured.exportPayloadKiB : 0,
    components: Object.freeze({
      derivedDataKiB: measured.derivedDataKiB,
      archiveKiB: measured.archiveKiB,
      resultBundleKiB: measured.resultBundleKiB,
      exportPayloadKiB: measured.exportPayloadKiB,
      scratchKiB: measured.scratchKiB,
      otherKiB: measured.otherKiB,
    }),
  });
}

/** @param {BuildArtifactInventory} entry */
function normalizedInventory(entry) {
  const totalKiB = nonnegativeNumber(entry.totalKiB, "totalKiB");
  const derivedDataKiB = nonnegativeNumber(entry.derivedDataKiB || 0, "derivedDataKiB");
  const archiveKiB = nonnegativeNumber(entry.archiveKiB || 0, "archiveKiB");
  const resultBundleKiB = nonnegativeNumber(entry.resultBundleKiB || 0, "resultBundleKiB");
  const exportPayloadKiB = nonnegativeNumber(entry.exportPayloadKiB || 0, "exportPayloadKiB");
  const scratchKiB = nonnegativeNumber(entry.scratchKiB || 0, "scratchKiB");
  const categorizedKiB = derivedDataKiB + archiveKiB + resultBundleKiB + exportPayloadKiB + scratchKiB;
  const otherKiB = entry.otherKiB === undefined
    ? Math.max(0, totalKiB - categorizedKiB)
    : nonnegativeNumber(entry.otherKiB, "otherKiB");
  if (categorizedKiB + otherKiB > totalKiB) {
    throw new Error(`Artifact inventory exceeds total size for build ${entry.buildID}.`);
  }
  return Object.freeze({
    buildID: entry.buildID,
    root: String(entry.root || ""),
    totalKiB,
    derivedDataKiB,
    archiveKiB,
    resultBundleKiB,
    exportPayloadKiB,
    scratchKiB,
    otherKiB,
    measured: true,
  });
}

/** @param {BuildRecord} build */
function emptyInventory(build) {
  return Object.freeze({
    buildID: build.id,
    root: typeof build.artifacts?.root === "string" ? build.artifacts.root : "",
    totalKiB: 0,
    derivedDataKiB: 0,
    archiveKiB: 0,
    resultBundleKiB: 0,
    exportPayloadKiB: 0,
    scratchKiB: 0,
    otherKiB: 0,
    measured: false,
  });
}

/** @param {BuildArtifactInventory} entry */
function validateInventory(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.buildID !== "string" || !entry.buildID) {
    throw new TypeError("Artifact inventory entries require buildID.");
  }
}

/** @param {unknown} value @param {string} label */
function nonnegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`Artifact audit ${label} must be a nonnegative finite number.`);
  }
  return value;
}

/** @template T @param {T[]} values @param {(value: T) => number} select */
function sum(values, select) {
  return values.reduce((total, value) => total + select(value), 0);
}

/** @template T @param {T[]} values @param {(value: T) => number} select */
function summarize(values, select) {
  return Object.freeze({ count: values.length, totalKiB: sum(values, select) });
}

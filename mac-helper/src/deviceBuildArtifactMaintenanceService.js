// @ts-check

import { resolve } from "node:path";
import { planDeviceBuildArtifactAudit } from "./deviceBuildArtifactAuditPlan.js";
import {
  buildRevision,
  canonicalBuildRoot,
  DEVICE_BUILD_ARTIFACT_MAINTENANCE_VERSION,
  maintenanceCandidatePath,
  planDeviceBuildArtifactMaintenance,
} from "./deviceBuildArtifactMaintenancePlan.js";

/**
 * Historical maintenance is deliberately unwired. Integration supplies the
 * authoritative build readers plus the proven read-only usage adapter and a
 * purpose-specific contained executor.
 *
 * @param {{
 *   listBuilds(): readonly any[],
 *   getBuild(id: string): any | null,
 *   artifactDirectory(): string,
 *   usage: { measure(input: { builds: readonly any[], artifactDirectory: string }): Promise<{ inventory: any[], orphanRoots?: any[], issues?: any[] }> },
 *   executor: { approveContained(root: string, candidate: string): string, reclaimApproved(path: string): Promise<void> },
 * }} dependencies
 */
export function createDeviceBuildArtifactMaintenanceService(dependencies) {
  validateDependencies(dependencies);
  return Object.freeze({ plan, apply });

  async function plan() {
    const builds = dependencies.listBuilds();
    if (!Array.isArray(builds)) {
      throw new TypeError("Artifact maintenance listBuilds must return an array.");
    }
    const artifactDirectory = dependencies.artifactDirectory();
    const measurement = await dependencies.usage.measure({ builds, artifactDirectory });
    const audit = planDeviceBuildArtifactAudit({
      builds,
      inventory: Array.isArray(measurement.inventory) ? measurement.inventory : [],
      orphanRoots: Array.isArray(measurement.orphanRoots) ? measurement.orphanRoots : [],
    });
    return planDeviceBuildArtifactMaintenance({ audit, builds, artifactDirectory });
  }

  /** @param {Awaited<ReturnType<typeof plan>>} maintenancePlan */
  async function apply(maintenancePlan) {
    validatePlan(maintenancePlan);
    if (dependencies.artifactDirectory() !== maintenancePlan.artifactDirectory) {
      throw new Error("Artifact maintenance plan no longer targets the current artifact directory.");
    }
    const results = [];
    for (const entry of maintenancePlan.actions) results.push(await applyOne(entry));
    return Object.freeze({
      version: maintenancePlan.version,
      attempted: results.length,
      removed: results.filter((value) => value.status === "removed").length,
      alreadyAbsent: results.filter((value) => value.status === "already-absent").length,
      refused: results.filter((value) => value.status === "refused").length,
      failed: results.filter((value) => value.status === "failed").length,
      results: Object.freeze(results),
    });
  }

  async function applyOne(entry) {
    try {
      const validation = await validateFreshAction(entry);
      if (!validation.ok) {
        return result(
          entry,
          validation.alreadyAbsent ? "already-absent" : "refused",
          validation.reason,
        );
      }
      const candidate = maintenanceCandidatePath(validation.current, entry.kind, entry.canonicalRoot);
      if (!candidate || candidate !== entry.path) {
        return result(entry, "refused", "current artifact path no longer matches the planned path");
      }
      let approved;
      try {
        approved = dependencies.executor.approveContained(entry.canonicalRoot, candidate);
      } catch (error) {
        if (isMissing(error)) return result(entry, "already-absent", "artifact path is already absent");
        return result(entry, "refused", errorMessage(error));
      }
      if (approved !== candidate) {
        return result(entry, "refused", "maintenance executor returned a non-canonical path");
      }
      await dependencies.executor.reclaimApproved(approved);
      return result(entry, "removed", "fresh state and containment revalidated immediately before reclamation");
    } catch (error) {
      if (isMissing(error)) return result(entry, "already-absent", "artifact path is already absent");
      return result(entry, "failed", errorMessage(error));
    }
  }

  async function validateFreshAction(entry) {
    const current = dependencies.getBuild(entry.buildID);
    const basic = basicFreshnessRefusal(entry, current);
    if (basic) return { ok: false, reason: basic };

    const artifactDirectory = dependencies.artifactDirectory();
    const currentCandidate = maintenanceCandidatePath(current, entry.kind, entry.canonicalRoot);
    if (!currentCandidate || currentCandidate !== entry.path) {
      return { ok: false, reason: "current artifact path no longer matches the planned path" };
    }
    if (entry.kind === "failed-root") {
      try {
        dependencies.executor.approveContained(entry.canonicalRoot, currentCandidate);
      } catch (error) {
        if (isMissing(error)) {
          return { ok: false, alreadyAbsent: true, reason: "artifact root is already absent" };
        }
        return { ok: false, reason: errorMessage(error) };
      }
    }

    const measurement = await dependencies.usage.measure({ builds: [current], artifactDirectory });
    const issues = Array.isArray(measurement.issues) ? measurement.issues : [];
    if (issues.length > 0) {
      return { ok: false, reason: "fresh artifact measurement is ambiguous or unsafe" };
    }
    const audit = planDeviceBuildArtifactAudit({
      builds: [current],
      inventory: Array.isArray(measurement.inventory) ? measurement.inventory : [],
      orphanRoots: Array.isArray(measurement.orphanRoots) ? measurement.orphanRoots : [],
    });
    if (audit.measuredBuildCount !== 1 || audit.builds.length !== 1) {
      return { ok: false, reason: "current build could not be measured for retention revalidation" };
    }
    const currentPlan = planDeviceBuildArtifactMaintenance({
      audit,
      builds: [current],
      artifactDirectory,
    });
    const same = currentPlan.actions.some((candidate) => (
      candidate.buildID === entry.buildID
      && candidate.expectedRevision === entry.expectedRevision
      && candidate.kind === entry.kind
      && candidate.path === entry.path
      && candidate.canonicalRoot === entry.canonicalRoot
    ));
    if (!same) {
      const auditBuild = audit.builds[0];
      if (
        auditBuild
        && policyStillAllowsKind(auditBuild.policy, entry.kind)
        && measuredSizeForKind(auditBuild, entry.kind) === 0
      ) {
        return {
          ok: false,
          alreadyAbsent: true,
          reason: "artifact path is already absent under the same current retention policy",
        };
      }
      return { ok: false, reason: "current retention classification no longer authorizes this action" };
    }

    const latest = dependencies.getBuild(entry.buildID);
    const latestRefusal = basicFreshnessRefusal(entry, latest);
    if (latestRefusal) return { ok: false, reason: latestRefusal };
    return { ok: true, current: latest };
  }

  function basicFreshnessRefusal(entry, current) {
    if (!current || typeof current !== "object" || current.id !== entry.buildID) {
      return "authoritative build record is missing or has the wrong identity";
    }
    const revision = buildRevision(current);
    if (revision === null || revision !== entry.expectedRevision) {
      return "authoritative build revision changed since planning";
    }
    const currentRoot = canonicalBuildRoot(dependencies.artifactDirectory(), entry.buildID);
    if (
      !currentRoot
      || currentRoot !== entry.canonicalRoot
      || typeof current.artifacts?.root !== "string"
      || resolve(current.artifacts.root) !== currentRoot
    ) {
      return "authoritative artifact root changed or is not canonical";
    }
    return "";
  }
}

function validatePlan(plan) {
  if (
    !plan
    || typeof plan !== "object"
    || plan.version !== DEVICE_BUILD_ARTIFACT_MAINTENANCE_VERSION
    || plan.dryRun !== true
    || typeof plan.artifactDirectory !== "string"
    || !Array.isArray(plan.actions)
  ) {
    throw new TypeError("Artifact maintenance apply requires a dry-run maintenance plan.");
  }
}

function validateDependencies(dependencies) {
  if (!dependencies || typeof dependencies !== "object") {
    throw new TypeError("Artifact maintenance dependencies are required.");
  }
  if (typeof dependencies.listBuilds !== "function" || typeof dependencies.getBuild !== "function") {
    throw new TypeError("Artifact maintenance requires authoritative build readers.");
  }
  if (typeof dependencies.artifactDirectory !== "function") {
    throw new TypeError("Artifact maintenance requires artifactDirectory.");
  }
  if (!dependencies.usage || typeof dependencies.usage.measure !== "function") {
    throw new TypeError("Artifact maintenance requires usage measurement.");
  }
  if (
    !dependencies.executor
    || typeof dependencies.executor.approveContained !== "function"
    || typeof dependencies.executor.reclaimApproved !== "function"
  ) {
    throw new TypeError("Artifact maintenance requires a contained maintenance executor.");
  }
}

function policyStillAllowsKind(policy, kind) {
  if (kind === "failed-root") return policy === "failed";
  if (kind === "derivedData") return policy === "ready-non-live";
  return (
    (kind === "archive" || kind === "resultBundle" || kind === "scratch")
    && (policy === "ready-non-live" || policy === "ready-live")
  );
}

function measuredSizeForKind(auditBuild, kind) {
  if (kind === "failed-root") return Number(auditBuild.totalKiB || 0);
  const key = kind === "derivedData"
    ? "derivedDataKiB"
    : kind === "archive"
      ? "archiveKiB"
      : kind === "resultBundle"
        ? "resultBundleKiB"
        : kind === "scratch"
          ? "scratchKiB"
          : "";
  return key ? Number(auditBuild.components?.[key] || 0) : -1;
}

function result(entry, status, message) {
  return Object.freeze({
    actionID: entry.id,
    buildID: entry.buildID,
    kind: entry.kind,
    status,
    message,
  });
}

function isMissing(error) {
  return Boolean(
    error
    && typeof error === "object"
    && /** @type {{ code?: unknown }} */ (error).code === "ENOENT"
  );
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

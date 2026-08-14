import { resolve } from "node:path";
import { planDeviceBuildArtifactAudit } from "./deviceBuildArtifactAuditPlan.js";
import {
  buildRevision,
  canonicalBuildRoot,
  DEVICE_BUILD_ARTIFACT_MAINTENANCE_VERSION,
  maintenanceCandidatePath,
  planDeviceBuildArtifactMaintenance,
  type MaintenanceAction,
  type MaintenanceBuildRecord,
  type MaintenanceKind,
} from "./deviceBuildArtifactMaintenancePlan.js";

type CurrentBuild = MaintenanceBuildRecord & { state: string };
type AuditInput = Parameters<typeof planDeviceBuildArtifactAudit>[0];
type Inventory = AuditInput["inventory"];
type OrphanRoots = NonNullable<AuditInput["orphanRoots"]>;
type Measurement = { inventory: Inventory; orphanRoots?: OrphanRoots; issues?: unknown[] };
type Executor = {
  approveContained(root: string, candidate: string): string;
  reclaimApproved(path: string): Promise<void>;
};
type Dependencies = {
  listBuilds(): readonly CurrentBuild[];
  getBuild(id: string): CurrentBuild | null;
  artifactDirectory(): string;
  usage: { measure(input: { builds: readonly CurrentBuild[]; artifactDirectory: string }): Promise<Measurement> };
  executor: Executor;
};
type MaintenancePlan = ReturnType<typeof planDeviceBuildArtifactMaintenance>;
type ResultStatus = "removed" | "already-absent" | "refused" | "failed";
type ActionResult = {
  actionID: string;
  buildID: string;
  kind: MaintenanceKind;
  status: ResultStatus;
  message: string;
};
type FreshValidation =
  | { ok: true; current: CurrentBuild }
  | { ok: false; reason: string; alreadyAbsent?: boolean };

export function createDeviceBuildArtifactMaintenanceService(dependencies: Dependencies) {
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
      inventory: measurement.inventory,
      orphanRoots: measurement.orphanRoots ?? [],
    });
    return planDeviceBuildArtifactMaintenance({ audit, builds, artifactDirectory });
  }

  async function apply(maintenancePlan: MaintenancePlan) {
    validatePlan(maintenancePlan);
    if (dependencies.artifactDirectory() !== maintenancePlan.artifactDirectory) {
      throw new Error("Artifact maintenance plan no longer targets the current artifact directory.");
    }
    const results: ActionResult[] = [];
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

  async function applyOne(entry: MaintenanceAction): Promise<ActionResult> {
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
      let approved: string;
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
      return result(
        entry,
        "removed",
        "fresh state and containment revalidated immediately before reclamation",
      );
    } catch (error) {
      if (isMissing(error)) return result(entry, "already-absent", "artifact path is already absent");
      return result(entry, "failed", errorMessage(error));
    }
  }

  async function validateFreshAction(entry: MaintenanceAction): Promise<FreshValidation> {
    const current = dependencies.getBuild(entry.buildID);
    const basic = basicFreshnessRefusal(entry, current);
    if (basic) return { ok: false, reason: basic };
    if (!current) return { ok: false, reason: "authoritative build record is missing" };

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
    if ((measurement.issues ?? []).length > 0) {
      return { ok: false, reason: "fresh artifact measurement is ambiguous or unsafe" };
    }
    const audit = planDeviceBuildArtifactAudit({
      builds: [current],
      inventory: measurement.inventory,
      orphanRoots: measurement.orphanRoots ?? [],
    });
    if (audit.measuredBuildCount !== 1 || audit.builds.length !== 1) {
      return { ok: false, reason: "current build could not be measured for retention revalidation" };
    }
    const currentPlan = planDeviceBuildArtifactMaintenance({ audit, builds: [current], artifactDirectory });
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
    if (!latest) return { ok: false, reason: "authoritative build record is missing" };
    return { ok: true, current: latest };
  }

  function basicFreshnessRefusal(entry: MaintenanceAction, current: CurrentBuild | null) {
    if (!current || current.id !== entry.buildID) {
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

function validatePlan(plan: MaintenancePlan) {
  if (
    !plan
    || plan.version !== DEVICE_BUILD_ARTIFACT_MAINTENANCE_VERSION
    || plan.dryRun !== true
    || typeof plan.artifactDirectory !== "string"
    || !Array.isArray(plan.actions)
  ) {
    throw new TypeError("Artifact maintenance apply requires a dry-run maintenance plan.");
  }
}

function validateDependencies(dependencies: Dependencies) {
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

function policyStillAllowsKind(policy: unknown, kind: MaintenanceKind) {
  if (kind === "failed-root") return policy === "failed";
  if (kind === "derivedData") return policy === "ready-non-live";
  return (
    (kind === "archive" || kind === "resultBundle" || kind === "scratch")
    && (policy === "ready-non-live" || policy === "ready-live")
  );
}

function measuredSizeForKind(
  auditBuild: { totalKiB?: number; components?: Record<string, number> },
  kind: MaintenanceKind,
) {
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

function result(entry: MaintenanceAction, status: ResultStatus, message: string): ActionResult {
  return Object.freeze({ actionID: entry.id, buildID: entry.buildID, kind: entry.kind, status, message });
}

function isMissing(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

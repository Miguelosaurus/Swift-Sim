import { isAbsolute, relative, resolve, sep } from "node:path";

export type MaintenanceKind = "failed-root" | "derivedData" | "archive" | "resultBundle" | "scratch";

type BuildArtifacts = {
  root?: unknown;
  archivePath?: unknown;
  resultBundlePath?: unknown;
  exportPath?: unknown;
};

export type MaintenanceBuildRecord = {
  id: string;
  revision?: unknown;
  state?: string;
  liveReload?: { compilerReady?: boolean };
  artifacts?: BuildArtifacts;
};

type AuditBuild = {
  buildID?: unknown;
  root?: unknown;
  policy?: unknown;
  reclaimableKiB?: unknown;
  components?: Record<string, unknown>;
};

export type MaintenanceAction = {
  id: string;
  buildID: string;
  expectedRevision: number;
  canonicalRoot: string;
  kind: MaintenanceKind;
  path: string;
};

type MaintenanceSkip = { buildID: string; code: string; message: string };

export const DEVICE_BUILD_ARTIFACT_MAINTENANCE_VERSION = 1;

const READY_COMPONENTS: ReadonlyArray<readonly [Exclude<MaintenanceKind, "failed-root">, string]> = [
  ["derivedData", "derivedDataKiB"],
  ["archive", "archiveKiB"],
  ["resultBundle", "resultBundleKiB"],
  ["scratch", "scratchKiB"],
];

export function planDeviceBuildArtifactMaintenance({
  audit,
  builds,
  artifactDirectory,
}: {
  audit: { readOnly?: boolean; builds?: readonly AuditBuild[] };
  builds: readonly MaintenanceBuildRecord[];
  artifactDirectory: string;
}) {
  if (!audit || audit.readOnly !== true || !Array.isArray(audit.builds)) {
    throw new TypeError("Artifact maintenance requires a read-only artifact audit.");
  }
  if (!Array.isArray(builds)) throw new TypeError("Artifact maintenance builds must be an array.");
  const rootDirectory = requiredAbsolutePath(artifactDirectory, "artifact directory");
  const buildsByID = new Map(builds.map((build) => [requiredBuildID(build), build]));
  const actions: MaintenanceAction[] = [];
  const skipped: MaintenanceSkip[] = [];

  for (const auditBuild of audit.builds) {
    const buildID = typeof auditBuild.buildID === "string" ? auditBuild.buildID : "";
    const build = buildsByID.get(buildID);
    if (!build) {
      skipped.push({ buildID, code: "missing-build", message: "Audit entry has no matching authoritative build." });
      continue;
    }
    const revision = buildRevision(build);
    if (revision === null) {
      skipped.push({ buildID, code: "missing-revision", message: "Build has no authoritative revision freshness fact." });
      continue;
    }
    const canonicalRoot = canonicalBuildRoot(rootDirectory, buildID);
    if (!canonicalRoot || resolve(String(build.artifacts?.root || "")) !== canonicalRoot) {
      skipped.push({ buildID, code: "root-mismatch", message: "Build root does not match its canonical artifact root." });
      continue;
    }
    if (resolve(String(auditBuild.root || "")) !== canonicalRoot) {
      skipped.push({ buildID, code: "audit-root-mismatch", message: "Audit root does not match the current canonical artifact root." });
      continue;
    }
    if (auditBuild.policy === "failed" && Number(auditBuild.reclaimableKiB || 0) > 0) {
      actions.push(makeAction(buildID, revision, canonicalRoot, "failed-root", canonicalRoot));
      continue;
    }
    if (auditBuild.policy !== "ready-non-live" && auditBuild.policy !== "ready-live") continue;

    const paths = candidatePaths(build, canonicalRoot);
    for (const [kind, sizeKey] of READY_COMPONENTS) {
      if (kind === "derivedData" && auditBuild.policy === "ready-live") continue;
      if (Number(auditBuild.components?.[sizeKey] || 0) <= 0) continue;
      const path = paths[kind];
      if (!path || !isStrictlyContained(canonicalRoot, path)) {
        skipped.push({ buildID, code: "component-path-unproven", message: `Reclaimable ${kind} path was not safely derivable.` });
        continue;
      }
      actions.push(makeAction(buildID, revision, canonicalRoot, kind, path));
    }
  }

  return Object.freeze({
    version: DEVICE_BUILD_ARTIFACT_MAINTENANCE_VERSION,
    dryRun: true as const,
    artifactDirectory: rootDirectory,
    actions: Object.freeze(actions),
    skipped: Object.freeze(skipped),
  });
}

export function maintenanceCandidatePath(build: MaintenanceBuildRecord, kind: MaintenanceKind, canonicalRoot: string) {
  if (kind === "failed-root") return canonicalRoot;
  return candidatePaths(build, canonicalRoot)[kind] || "";
}

function candidatePaths(build: MaintenanceBuildRecord, root: string) {
  return {
    derivedData: resolve(root, "DerivedData"),
    archive: absoluteString(build.artifacts?.archivePath),
    resultBundle: absoluteString(build.artifacts?.resultBundlePath),
    scratch: resolve(root, "ExportOptions.plist"),
  };
}

function makeAction(buildID: string, revision: number, root: string, kind: MaintenanceKind, path: string): MaintenanceAction {
  return Object.freeze({ id: `${buildID}:${revision}:${kind}`, buildID, expectedRevision: revision, canonicalRoot: root, kind, path: resolve(path) });
}

function requiredBuildID(build: MaintenanceBuildRecord) {
  if (!build || typeof build !== "object" || typeof build.id !== "string" || !build.id) {
    throw new TypeError("Artifact maintenance build records require an id.");
  }
  return build.id;
}

export function buildRevision(build: MaintenanceBuildRecord | null | undefined) {
  const value = Number(build?.revision);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function canonicalBuildRoot(artifactDirectory: string, buildID: string) {
  const root = requiredAbsolutePath(artifactDirectory, "artifact directory");
  if (!buildID || buildID === "." || buildID === ".." || buildID.includes("/") || buildID.includes("\\")) return "";
  const candidate = resolve(root, buildID);
  return isStrictlyContained(root, candidate) ? candidate : "";
}

function absoluteString(value: unknown) {
  if (typeof value !== "string" || !value || !isAbsolute(value)) return "";
  return resolve(value);
}

export function isStrictlyContained(root: string, candidate: string) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const child = relative(resolvedRoot, resolvedCandidate);
  return Boolean(child && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

function requiredAbsolutePath(value: unknown, label: string) {
  if (typeof value !== "string" || !value || !isAbsolute(value)) {
    throw new TypeError(`Artifact maintenance ${label} must be absolute.`);
  }
  return resolve(value);
}

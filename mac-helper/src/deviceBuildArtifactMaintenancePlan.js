// @ts-check

import { isAbsolute, relative, resolve, sep } from "node:path";

export const DEVICE_BUILD_ARTIFACT_MAINTENANCE_VERSION = 1;

const READY_COMPONENTS = Object.freeze({
  derivedData: "derivedDataKiB",
  archive: "archiveKiB",
  resultBundle: "resultBundleKiB",
  scratch: "scratchKiB",
});

/**
 * Convert a read-only artifact audit plus the authoritative build records used
 * to obtain it into a bounded executable plan. Orphan/unbound/manual-review
 * inventory is intentionally absent from the executable action list.
 *
 * @param {{
 *   audit: { readOnly?: boolean, builds?: readonly any[] },
 *   builds: readonly any[],
 *   artifactDirectory: string,
 * }} input
 */
export function planDeviceBuildArtifactMaintenance({ audit, builds, artifactDirectory }) {
  if (!audit || audit.readOnly !== true || !Array.isArray(audit.builds)) {
    throw new TypeError("Artifact maintenance requires a read-only artifact audit.");
  }
  if (!Array.isArray(builds)) throw new TypeError("Artifact maintenance builds must be an array.");
  const rootDirectory = requiredAbsolutePath(artifactDirectory, "artifact directory");
  const buildsByID = new Map(builds.map((build) => [requiredBuildID(build), build]));
  const actions = [];
  const skipped = [];

  for (const auditBuild of audit.builds) {
    const buildID = typeof auditBuild?.buildID === "string" ? auditBuild.buildID : "";
    const build = buildsByID.get(buildID);
    if (!build) {
      skipped.push(skip(buildID, "missing-build", "Audit entry has no matching authoritative build."));
      continue;
    }
    const revision = buildRevision(build);
    if (revision === null) {
      skipped.push(skip(buildID, "missing-revision", "Build has no authoritative revision freshness fact."));
      continue;
    }
    const canonicalRoot = canonicalBuildRoot(rootDirectory, buildID);
    if (!canonicalRoot || resolve(String(build.artifacts?.root || "")) !== canonicalRoot) {
      skipped.push(skip(buildID, "root-mismatch", "Build root does not match its canonical artifact root."));
      continue;
    }
    if (resolve(String(auditBuild.root || "")) !== canonicalRoot) {
      skipped.push(skip(buildID, "audit-root-mismatch", "Audit root does not match the current canonical artifact root."));
      continue;
    }

    if (auditBuild.policy === "failed" && Number(auditBuild.reclaimableKiB || 0) > 0) {
      actions.push(action(buildID, revision, canonicalRoot, "failed-root", canonicalRoot));
      continue;
    }
    if (auditBuild.policy !== "ready-non-live" && auditBuild.policy !== "ready-live") continue;

    const paths = candidatePaths(build, canonicalRoot);
    for (const [kind, sizeKey] of Object.entries(READY_COMPONENTS)) {
      if (kind === "derivedData" && auditBuild.policy === "ready-live") continue;
      if (Number(auditBuild.components?.[sizeKey] || 0) <= 0) continue;
      const path = paths[kind];
      if (!path || !isStrictlyContained(canonicalRoot, path)) {
        skipped.push(skip(buildID, "component-path-unproven", `Reclaimable ${kind} path was not safely derivable.`));
        continue;
      }
      actions.push(action(buildID, revision, canonicalRoot, kind, path));
    }
  }

  return Object.freeze({
    version: DEVICE_BUILD_ARTIFACT_MAINTENANCE_VERSION,
    dryRun: true,
    artifactDirectory: rootDirectory,
    actions: Object.freeze(actions),
    skipped: Object.freeze(skipped),
  });
}

export function maintenanceCandidatePath(build, kind, canonicalRoot) {
  if (kind === "failed-root") return canonicalRoot;
  return candidatePaths(build, canonicalRoot)[kind] || "";
}

function candidatePaths(build, root) {
  return {
    derivedData: resolve(root, "DerivedData"),
    archive: absoluteString(build.artifacts?.archivePath),
    resultBundle: absoluteString(build.artifacts?.resultBundlePath),
    scratch: resolve(root, "ExportOptions.plist"),
  };
}

function action(buildID, revision, root, kind, path) {
  return Object.freeze({
    id: `${buildID}:${revision}:${kind}`,
    buildID,
    expectedRevision: revision,
    canonicalRoot: root,
    kind,
    path: resolve(path),
  });
}

function skip(buildID, code, message) {
  return Object.freeze({ buildID, code, message });
}

function requiredBuildID(build) {
  if (!build || typeof build !== "object" || typeof build.id !== "string" || !build.id) {
    throw new TypeError("Artifact maintenance build records require an id.");
  }
  return build.id;
}

export function buildRevision(build) {
  const value = Number(build?.revision);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function canonicalBuildRoot(artifactDirectory, buildID) {
  const root = requiredAbsolutePath(artifactDirectory, "artifact directory");
  if (typeof buildID !== "string" || !buildID || buildID === "." || buildID === ".." || buildID.includes("/") || buildID.includes("\\")) {
    return "";
  }
  const candidate = resolve(root, buildID);
  return isStrictlyContained(root, candidate) ? candidate : "";
}

function absoluteString(value) {
  if (typeof value !== "string" || !value || !isAbsolute(value)) return "";
  return resolve(value);
}

export function isStrictlyContained(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const child = relative(resolvedRoot, resolvedCandidate);
  return Boolean(child && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

function requiredAbsolutePath(value, label) {
  if (typeof value !== "string" || !value || !isAbsolute(value)) {
    throw new TypeError(`Artifact maintenance ${label} must be absolute.`);
  }
  return resolve(value);
}

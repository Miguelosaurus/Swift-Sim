import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const COMPILER_CACHE_KEEP_RECENT = 2;

// Pure metadata policy. Install payloads, captures, source snapshots, history,
// and the historical artifact-maintenance program are outside this policy.
export function planCompilerCacheRetention({
  builds,
  artifactDirectory,
  references,
  keepRecent = COMPILER_CACHE_KEEP_RECENT,
}) {
  if (!Array.isArray(builds) || !references || !Number.isSafeInteger(keepRecent) || keepRecent < 2)
    throw new TypeError(
      "Compiler cache retention requires complete references and at least two recent builds.",
    );
  const protectedBuilds = new Map();
  const protect = (build, reason) =>
    protectedBuilds.set(build.id, [...(protectedBuilds.get(build.id) || []), reason]);
  const groups = Map.groupBy(
    builds.filter(
      (build) => build.state === "ready" && recipe(build) && Number.isFinite(time(build.createdAt)),
    ),
    recipe,
  );
  for (const lane of groups.values()) {
    lane.sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.id.localeCompare(a.id));
    for (const build of lane.slice(0, keepRecent)) protect(build, "recent-build");
    // Installation history is cumulative. Only the latest positive observation
    // per device is a current-install reference; historical green checks are not.
    const installs = new Map();
    for (const build of lane) {
      const installation = build.installation || {};
      if (!["verified", "launch-confirmed"].includes(installation.state)) continue;
      const at = Math.max(
        ...[installation.lastSeenAt, installation.verifiedAt, installation.launchConfirmedAt].map(
          (value) => (Number.isFinite(time(value)) ? time(value) : -Infinity),
        ),
      );
      if (!Number.isFinite(at)) protect(build, "ambiguous-install");
      const devices =
        installation.devices
          ?.filter((device) => device.state === "installed")
          .map((device) => device.name)
          .filter(Boolean) || [];
      for (const key of ["last-launch", ...devices]) {
        if (!installs.has(key) || installs.get(key).at < at) installs.set(key, { build, at });
      }
    }
    for (const { build } of installs.values()) protect(build, "current-install");
  }
  const candidates = [];
  const skipped = [];
  for (const build of builds) {
    if (build.state !== "ready") protect(build, "non-ready-build");
    if (build.pinned === true || build.retention?.pinned === true) protect(build, "pinned-build");
    if (build.pendingRenewal || build.installation?.state === "requested")
      protect(build, "install-in-progress");
    const root = canonicalRoot(artifactDirectory, build.id);
    if (
      !recipe(build) ||
      !root ||
      !isAbsolute(build.artifacts?.root || "") ||
      resolve(build.artifacts.root) !== root ||
      !Number.isSafeInteger(build.revision) ||
      build.revision < 0 ||
      !Number.isFinite(time(build.createdAt))
    )
      protect(build, "ambiguous-build");
    if (root && referenced(build, root, references)) protect(build, "live-reference");
    if (
      root &&
      build.control?.cancelPath &&
      resolve(build.control.cancelPath) !== join(root, ".cancelled")
    )
      protect(build, "ambiguous-worker-path");
    const cache = build.liveReload?.compilerCache;
    if (
      build.liveReload?.compilerReady !== true &&
      !["retiring", "detached"].includes(cache?.state)
    )
      continue;
    if (protectedBuilds.has(build.id)) {
      skipped.push({ buildID: build.id, reasons: protectedBuilds.get(build.id) });
      continue;
    }
    const path = join(root, "DerivedData");
    // A malformed artifact path cannot make a cache an install-payload ancestor.
    if (
      [build.artifacts?.ipaPath, build.artifacts?.exportPath, build.icon?.path].some(
        (value) => typeof value === "string" && within(path, value),
      )
    ) {
      skipped.push({ buildID: build.id, reasons: ["payload-overlap"] });
      continue;
    }
    candidates.push({
      buildID: build.id,
      expectedRevision: build.revision,
      root,
      path,
      detachedPath: join(root, ".retired-compiler-cache"),
    });
  }
  return { version: 1, dryRun: true, keepRecent, candidates, skipped };
}

export function preserveCompilerCacheRetirement(incoming, existing) {
  if (!existing.liveReload?.compilerCache) return;
  incoming.liveReload = {
    ...incoming.liveReload,
    compilerReady: false,
    compilerCache: structuredClone(existing.liveReload.compilerCache),
  };
}

// Called through the existing authority-routed store. The first transaction
// disables the cache durably, BEFORE any filesystem mutation. Later phases
// always repeat the complete cross-build policy under the selected store lock.
export function retireDeviceBuildCompilerCache(
  store,
  { candidate, phase, references, detach, now, authorityUnchanged = () => true },
) {
  return store.withTransaction((state) => {
    if (!authorityUnchanged()) return { status: "refused", reason: "Storage authority changed." };
    const plan = planCompilerCacheRetention({
      builds: [...state.builds.values()],
      artifactDirectory: join(dirname(store.path), "device-builds"),
      references,
    });
    const current = plan.candidates.find(
      (item) =>
        item.buildID === candidate.buildID &&
        item.expectedRevision === candidate.expectedRevision &&
        item.path === candidate.path,
    );
    if (!current)
      return { status: "refused", reason: "Build ownership, revision, or references changed." };
    const build = state.builds.get(candidate.buildID);
    const cache = build.liveReload?.compilerCache;
    if (phase === "claim") {
      if (!cache) {
        if (!candidate.directoryIdentity || !candidate.rootIdentity)
          return { status: "refused", reason: "Compiler cache filesystem identity is missing." };
        build.liveReload = {
          ...build.liveReload,
          compilerReady: false,
          compilerCache: {
            version: 1,
            state: "retiring",
            retiredAt: now,
            directoryIdentity: candidate.directoryIdentity,
            rootIdentity: candidate.rootIdentity,
          },
        };
      }
    } else if (phase === "detach" && ["retiring", "detached"].includes(cache?.state)) {
      detach();
      cache.state = "detached";
    } else if (phase === "complete" && cache?.state === "detached") {
      cache.state = "pruned";
      cache.prunedAt = now;
    } else return { status: "refused", reason: "Compiler cache retirement phase changed." };
    build.revision += 1;
    build.updatedAt = now;
    return {
      status: "accepted",
      candidate: {
        ...current,
        expectedRevision: build.revision,
        ...build.liveReload.compilerCache,
      },
    };
  });
}

function recipe(build) {
  if (
    !build.app?.bundleIdentifier ||
    !build.app?.teamID ||
    !(build.project || build.workspace) ||
    !build.scheme ||
    !build.configuration
  )
    return "";
  return JSON.stringify([
    build.app.bundleIdentifier,
    build.app.teamID,
    build.project || "",
    build.workspace || "",
    build.scheme,
    build.configuration,
  ]);
}

function referenced(build, root, references) {
  if (references.buildIDs?.includes(build.id)) return true;
  if (references.paths?.some((path) => within(root, path))) return true;
  // The manifest contains compiler arguments and nested response-file paths.
  if (references.manifestJSON?.includes(`${root}/`)) return true;
  const app = build.app || {};
  const appIdentity = createHash("sha256")
    .update(JSON.stringify([app.bundleIdentifier, app.version, app.build]))
    .digest("hex");
  if (references.scopes?.some((scope) => scope.appIdentity === appIdentity)) return true;
  const identity = references.binaryIdentity;
  return Boolean(
    identity &&
    identity.bundle_id === app.bundleIdentifier &&
    identity.bundle_version === app.version &&
    identity.build_number === app.build,
  );
}

function canonicalRoot(directory, id) {
  if (!isAbsolute(directory) || typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) return "";
  return resolve(directory, id);
}
function within(root, path) {
  if (!isAbsolute(path)) return false;
  const child = relative(resolve(root), resolve(path));
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}
function time(value) {
  return typeof value === "string" ? Date.parse(value) : NaN;
}

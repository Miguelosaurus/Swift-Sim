// @ts-check

import { lstatSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** @typedef {import("./ports.js").CommandRunner} CommandRunner */
/**
 * @typedef {{
 *   root?: unknown,
 *   archivePath?: unknown,
 *   exportPath?: unknown,
 *   ipaPath?: unknown,
 *   resultBundlePath?: unknown,
 * }} BuildArtifacts
 * @typedef {{
 *   id: string,
 *   state?: string,
 *   liveReload?: { compilerReady?: boolean },
 *   artifacts?: BuildArtifacts,
 * }} BuildRecord
 * @typedef {{
 *   derivedData: string,
 *   archive: string,
 *   resultBundle: string,
 *   exportPayload: string,
 *   scratch: string,
 * }} ComponentPaths
 * @typedef {{
 *   buildID: string,
 *   root: string,
 *   totalKiB: number,
 *   derivedDataKiB: number,
 *   archiveKiB: number,
 *   resultBundleKiB: number,
 *   exportPayloadKiB: number,
 *   scratchKiB: number,
 * }} BuildArtifactInventory
 * @typedef {{ name: string, root: string, totalKiB: number }} OrphanArtifactRoot
 * @typedef {{ code: string, buildID?: string, path: string, message: string }} MeasurementIssue
 * @typedef {{ ok: true, path: string } | { ok: false, reason: string, path: string, message?: string }} PathInspection
 */

const DU_EXECUTABLE = "/usr/bin/du";
const DU_TIMEOUT_MS = 60_000;
const DU_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const DU_BATCH_SIZE = 100;

export class NodeDeviceBuildArtifactUsage {
  /**
   * @param {{
   *   commandRunner: CommandRunner,
   *   environmentNames(): string[],
   *   readDirectory?: typeof readdirSync,
   *   lstat?: typeof lstatSync,
   * }} dependencies
   */
  constructor({ commandRunner, environmentNames, readDirectory = readdirSync, lstat = lstatSync }) {
    if (!commandRunner || typeof commandRunner.run !== "function") {
      throw new TypeError("Device-build artifact usage requires commandRunner.");
    }
    if (typeof environmentNames !== "function") {
      throw new TypeError("Device-build artifact usage requires environmentNames.");
    }
    if (typeof readDirectory !== "function" || typeof lstat !== "function") {
      throw new TypeError(
        "Device-build artifact usage requires filesystem inspection dependencies.",
      );
    }
    this.commandRunner = commandRunner;
    this.environmentNames = environmentNames;
    this.readDirectory = readDirectory;
    this.lstat = lstat;
  }

  /**
   * @param {{ builds: readonly BuildRecord[], artifactDirectory: string }} input
   * @returns {Promise<{ inventory: BuildArtifactInventory[], orphanRoots: OrphanArtifactRoot[], issues: MeasurementIssue[] }>}
   */
  async measure({ builds, artifactDirectory }) {
    if (!Array.isArray(builds)) throw new TypeError("Artifact usage builds must be an array.");
    const rootDirectory = requiredAbsolutePath(artifactDirectory, "artifact directory");
    /** @type {MeasurementIssue[]} */
    const issues = [];
    const directoryEntries = this.safeArtifactDirectoryEntries(rootDirectory, issues);
    if (directoryEntries === null) {
      return { inventory: [], orphanRoots: [], issues };
    }

    const entriesByName = new Map(directoryEntries.map((entry) => [entry.name, entry]));
    const referencedNames = new Set();
    /** @type {{ build: BuildRecord, root: string, components: ComponentPaths }[]} */
    const measurableBuilds = [];

    for (const build of builds) {
      if (!build || typeof build !== "object" || typeof build.id !== "string" || !build.id) {
        issues.push(issue("invalid-build-id", "", rootDirectory, "Build record has no usable id."));
        continue;
      }
      referencedNames.add(build.id);
      const canonicalRoot = canonicalChild(rootDirectory, build.id);
      if (!canonicalRoot) {
        issues.push(
          issue(
            "invalid-build-id",
            build.id,
            rootDirectory,
            "Build id does not resolve to one direct artifact-root child.",
          ),
        );
        continue;
      }
      const recordedRoot = stringValue(build.artifacts?.root);
      if (!recordedRoot || resolve(recordedRoot) !== canonicalRoot) {
        issues.push(
          issue(
            "root-mismatch",
            build.id,
            recordedRoot || canonicalRoot,
            "Build metadata root does not match the canonical device-build root.",
          ),
        );
        continue;
      }
      const entry = entriesByName.get(build.id);
      if (!entry) {
        issues.push(
          issue("missing-root", build.id, canonicalRoot, "Referenced artifact root is missing."),
        );
        continue;
      }
      if (entry.isSymbolicLink?.() || !entry.isDirectory?.()) {
        issues.push(
          issue(
            "unsafe-root",
            build.id,
            canonicalRoot,
            "Referenced artifact root is not a normal directory and was not measured.",
          ),
        );
        continue;
      }
      const rootInspection = this.inspectExistingPath(rootDirectory, canonicalRoot);
      if (!rootInspection.ok) {
        issues.push(
          issue(
            "unsafe-root",
            build.id,
            rootInspection.path,
            `Referenced artifact root could not be safely revalidated: ${rootInspection.reason}.`,
          ),
        );
        continue;
      }

      measurableBuilds.push({
        build,
        root: canonicalRoot,
        components: this.componentPaths(build, canonicalRoot, issues),
      });
    }

    const orphanCandidates = directoryEntries
      .filter((entry) => !referencedNames.has(entry.name))
      .map((entry) => ({ entry, root: resolve(rootDirectory, entry.name) }));

    const rootPaths = [
      ...measurableBuilds.map((entry) => entry.root),
      ...orphanCandidates.filter(({ entry }) => !entry.isSymbolicLink?.()).map(({ root }) => root),
    ];
    const componentPaths = measurableBuilds.flatMap((entry) => Object.values(entry.components));
    const rootUsage = await this.measurePaths(rootPaths, issues);
    const componentUsage = await this.measurePaths(componentPaths, issues);

    const inventory = measurableBuilds.map(({ build, root, components }) => ({
      buildID: build.id,
      root,
      totalKiB: rootUsage.get(root) || 0,
      derivedDataKiB: componentUsage.get(components.derivedData) || 0,
      archiveKiB: components.archive ? componentUsage.get(components.archive) || 0 : 0,
      resultBundleKiB: components.resultBundle
        ? componentUsage.get(components.resultBundle) || 0
        : 0,
      exportPayloadKiB: components.exportPayload
        ? componentUsage.get(components.exportPayload) || 0
        : 0,
      scratchKiB: componentUsage.get(components.scratch) || 0,
    }));

    const orphanRoots = orphanCandidates.map(({ entry, root }) => {
      const totalKiB = entry.isSymbolicLink?.() ? 0 : rootUsage.get(root) || 0;
      if (entry.isSymbolicLink?.()) {
        issues.push(
          issue(
            "orphan-symlink",
            "",
            root,
            "Unreferenced artifact entry is a symlink; it was not followed or counted as reclaimable.",
          ),
        );
      }
      return { name: entry.name, root, totalKiB };
    });

    return { inventory, orphanRoots, issues };
  }

  /** @param {string} artifactDirectory @param {MeasurementIssue[]} issues */
  safeArtifactDirectoryEntries(artifactDirectory, issues) {
    try {
      const stat = this.lstat(artifactDirectory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        issues.push(
          issue(
            "unsafe-artifact-directory",
            "",
            artifactDirectory,
            "Device-build artifact directory is not a normal directory; audit stopped without traversal.",
          ),
        );
        return null;
      }
      return this.readDirectory(artifactDirectory, { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, "ENOENT")) return [];
      issues.push(
        issue(
          "artifact-directory-unreadable",
          "",
          artifactDirectory,
          error instanceof Error ? error.message : String(error),
        ),
      );
      return null;
    }
  }

  /**
   * @param {BuildRecord} build
   * @param {string} root
   * @param {MeasurementIssue[]} issues
   * @returns {ComponentPaths}
   */
  componentPaths(build, root, issues) {
    const derivedData = this.measurableContainedPath(
      root,
      resolve(root, "DerivedData"),
      build.id,
      issues,
    );
    const archive = this.measurableContainedPath(
      root,
      stringValue(build.artifacts?.archivePath),
      build.id,
      issues,
    );
    const resultBundle = this.measurableContainedPath(
      root,
      stringValue(build.artifacts?.resultBundlePath),
      build.id,
      issues,
    );
    const exportPayload = this.measurableContainedPath(
      root,
      stringValue(build.artifacts?.exportPath),
      build.id,
      issues,
    );
    const scratch = this.measurableContainedPath(
      root,
      resolve(root, "ExportOptions.plist"),
      build.id,
      issues,
    );

    if (build.state !== "ready") {
      return { derivedData, archive, resultBundle, exportPayload, scratch };
    }

    const retainedIpa = this.retainedInstallPayloadPath(build, root, issues);
    if (!retainedIpa) {
      return {
        derivedData: build.liveReload?.compilerReady === true ? derivedData : "",
        archive: "",
        resultBundle: "",
        exportPayload,
        scratch: "",
      };
    }

    return {
      derivedData:
        build.liveReload?.compilerReady === true
          ? derivedData
          : reclaimableCandidate(derivedData, root, retainedIpa, build.id, issues),
      archive: reclaimableCandidate(archive, root, retainedIpa, build.id, issues),
      resultBundle: reclaimableCandidate(resultBundle, root, retainedIpa, build.id, issues),
      exportPayload,
      scratch: reclaimableCandidate(scratch, root, retainedIpa, build.id, issues),
    };
  }

  /**
   * @param {BuildRecord} build
   * @param {string} root
   * @param {MeasurementIssue[]} issues
   */
  retainedInstallPayloadPath(build, root, issues) {
    const ipaPath = stringValue(build.artifacts?.ipaPath);
    if (!ipaPath) {
      issues.push(
        issue(
          "install-payload-unproven",
          build.id,
          root,
          "Ready build has no retained IPA path; reclaimable intermediates were conservatively excluded.",
        ),
      );
      return "";
    }
    const resolved = resolve(ipaPath);
    if (!isContained(root, resolved)) {
      issues.push(
        issue(
          "install-payload-unproven",
          build.id,
          resolved,
          "Ready build IPA path is outside its canonical root; reclaimable intermediates were conservatively excluded.",
        ),
      );
      return "";
    }
    const inspection = this.inspectExistingPath(root, resolved);
    if (!inspection.ok) {
      issues.push(
        issue(
          "install-payload-unproven",
          build.id,
          inspection.path,
          `Ready build IPA path is not safely measurable (${inspection.reason}); reclaimable intermediates were conservatively excluded.`,
        ),
      );
      return "";
    }
    return resolved;
  }

  /**
   * @param {string} root
   * @param {string} candidate
   * @param {string} buildID
   * @param {MeasurementIssue[]} issues
   */
  measurableContainedPath(root, candidate, buildID, issues) {
    if (!candidate) return "";
    const resolved = resolve(candidate);
    if (!isContained(root, resolved)) {
      issues.push(
        issue(
          "component-outside-root",
          buildID,
          resolved,
          "Artifact component path is outside its canonical build root and was not measured.",
        ),
      );
      return "";
    }
    const inspection = this.inspectExistingPath(root, resolved);
    if (inspection.ok) return resolved;
    if (inspection.reason === "missing") return "";
    issues.push(
      issue(
        inspection.reason === "symlink" ? "component-symlink" : "component-unreadable",
        buildID,
        inspection.path,
        inspection.message ||
          "Artifact component could not be safely measured without following a symlink.",
      ),
    );
    return "";
  }

  /** @param {string} root @param {string} candidate @returns {PathInspection} */
  inspectExistingPath(root, candidate) {
    const nested = relative(resolve(root), resolve(candidate));
    const parts = nested ? nested.split(sep).filter(Boolean) : [];
    let current = resolve(root);
    for (const part of parts) {
      current = resolve(current, part);
      try {
        const stat = this.lstat(current);
        if (stat.isSymbolicLink()) {
          return { ok: false, reason: "symlink", path: current };
        }
      } catch (error) {
        if (hasCode(error, "ENOENT")) {
          return { ok: false, reason: "missing", path: current };
        }
        return {
          ok: false,
          reason: "unreadable",
          path: current,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return { ok: true, path: resolve(candidate) };
  }

  /** @param {string[]} paths @param {MeasurementIssue[]} issues */
  async measurePaths(paths, issues) {
    const uniquePaths = [...new Set(paths.filter(Boolean).map((path) => resolve(path)))];
    /** @type {Map<string, number>} */
    const usage = new Map();
    for (let offset = 0; offset < uniquePaths.length; offset += DU_BATCH_SIZE) {
      const batch = uniquePaths.slice(offset, offset + DU_BATCH_SIZE);
      const firstPath = batch[0];
      if (!firstPath) continue;
      const result = await this.commandRunner.run({
        executable: DU_EXECUTABLE,
        args: ["-P", "-sk", ...batch],
        environment: {
          inherit: this.environmentNames(),
          overrides: { LC_ALL: "C" },
          unset: [],
        },
        policy: {
          timeoutMs: DU_TIMEOUT_MS,
          outputLimitBytes: DU_OUTPUT_LIMIT_BYTES,
          processGroup: "new",
          acceptedExitCodes: [0],
        },
      });
      if (result.error) {
        issues.push(
          issue(
            "disk-usage-failed",
            "",
            firstPath,
            `Read-only disk usage measurement failed: ${result.error}`,
          ),
        );
        continue;
      }
      for (const line of String(result.stdout || "").split(/\r?\n/)) {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        const kibText = match?.[1];
        const pathText = match?.[2];
        if (!kibText || !pathText) continue;
        const kib = Number(kibText);
        const path = resolve(pathText);
        if (Number.isFinite(kib) && kib >= 0) usage.set(path, kib);
      }
      for (const path of batch) {
        if (!usage.has(path)) {
          issues.push(
            issue(
              "disk-usage-missing",
              "",
              path,
              "Read-only disk usage measurement returned no size for this path.",
            ),
          );
        }
      }
    }
    return usage;
  }
}

/**
 * @param {string} candidate
 * @param {string} root
 * @param {string} retainedIpa
 * @param {string} buildID
 * @param {MeasurementIssue[]} issues
 */
function reclaimableCandidate(candidate, root, retainedIpa, buildID, issues) {
  if (!candidate) return "";
  if (samePath(candidate, root) || containsPath(candidate, retainedIpa)) {
    issues.push(
      issue(
        "component-protects-install-payload",
        buildID,
        candidate,
        "Artifact component is the build root or contains the retained IPA and was excluded from reclaimable bytes.",
      ),
    );
    return "";
  }
  return candidate;
}

/** @param {string} root @param {string} name */
function canonicalChild(root, name) {
  if (!name || name.includes("\0") || name.includes(sep)) return "";
  const child = resolve(root, name);
  return relative(root, child) === name ? child : "";
}

/** @param {string} root @param {string} candidate */
function isContained(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return (
    child === "" ||
    Boolean(child && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}

/** @param {string} parent @param {string} child */
function containsPath(parent, child) {
  const nested = relative(resolve(parent), resolve(child));
  return (
    nested === "" ||
    Boolean(nested && !isAbsolute(nested) && nested !== ".." && !nested.startsWith(`..${sep}`))
  );
}

/** @param {string} first @param {string} second */
function samePath(first, second) {
  return resolve(first) === resolve(second);
}

/** @param {unknown} value */
function stringValue(value) {
  return typeof value === "string" ? value : "";
}

/** @param {string} value @param {string} label */
function requiredAbsolutePath(value, label) {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) {
    throw new TypeError(`Device-build ${label} must be an absolute NUL-free path.`);
  }
  return resolve(value);
}

/** @param {string} code @param {string} buildID @param {string} path @param {string} message */
function issue(code, buildID, path, message) {
  return Object.freeze({ code, ...(buildID ? { buildID } : {}), path, message });
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    /** @type {{ code?: unknown }} */ (error).code === code,
  );
}

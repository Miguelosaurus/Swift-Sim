import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NodeArtifactStore } from "./nodeArtifactStore.js";
import { normalizedLiveBinaryIdentity } from "../liveBinaryIdentity.js";

const identity = (stat) => ({ device: String(stat.dev), inode: String(stat.ino) });
const same = (a, b) => a?.device === b?.device && a?.inode === b?.inode;

// Filesystem/process observations live at the infrastructure boundary. No raw
// recursive delete is introduced; reclamation uses the existing ArtifactStore.
export function createNodeCompilerCacheStorage(artifactStore = new NodeArtifactStore()) {
  function inspect(candidate, cache) {
    const root = directory(candidate.root);
    if (!root) return null;
    const parent = directory(dirname(candidate.root));
    const stateRoot = directory(dirname(dirname(candidate.root)));
    // Xcode build roots have historically been 0755 beneath the private state
    // root. Read/execute bits there do not broaden access through a 0700 parent.
    // Never repair modes as a side effect of retention.
    if (!parent || !stateRoot || stateRoot.mode & 0o077 || root.mode & 0o022 || parent.mode & 0o022)
      throw new Error("Compiler cache ownership is not private.");
    if (cache?.rootIdentity && !same(identity(root), cache.rootIdentity))
      throw new Error("Compiler cache root changed.");
    // A recorded worker, including an unverifiable/stale one, stays protected.
    // Ordinary successful builds remove this record before becoming ready.
    if (stat(join(candidate.root, ".cancelled.worker.json")))
      throw new Error("Compiler cache still has a worker record.");
    const source = directory(candidate.path);
    const detached = directory(candidate.detachedPath);
    if (!cache && detached) throw new Error("Unexpected detached cache.");
    if (source && detached) throw new Error("Ambiguous compiler cache directories.");
    const observed = source || detached;
    if (!observed)
      return cache
        ? { directoryIdentity: cache.directoryIdentity, rootIdentity: cache.rootIdentity }
        : null;
    const directoryIdentity = identity(observed);
    if (cache && !same(directoryIdentity, cache.directoryIdentity))
      throw new Error("Compiler cache identity changed.");
    return { directoryIdentity, rootIdentity: identity(root) };
  }
  function approve(candidate) {
    inspect(candidate, candidate);
    artifactStore.resolveContained(candidate.root, candidate.path);
    artifactStore.resolveContained(candidate.root, candidate.detachedPath);
  }
  return {
    inspect,
    detach(candidate) {
      approve(candidate);
      artifactStore.detachTreeSync(
        candidate.path,
        candidate.detachedPath,
        candidate.directoryIdentity,
      );
    },
    async remove(candidate) {
      approve(candidate);
      await artifactStore.removeTree(candidate.detachedPath);
    },
  };
}

export function createNodeCompilerCacheReferences({
  manifestPath,
  commandRunner,
  environmentNames,
}) {
  return {
    read() {
      const observation = stat(manifestPath);
      if (!observation) return {};
      if (
        !observation.isFile() ||
        observation.isSymbolicLink() ||
        observation.nlink !== 1 ||
        observation.mode & 0o077 ||
        (process.getuid && observation.uid !== process.getuid()) ||
        observation.size > 8 * 1024 * 1024
      )
        throw new Error("Live compiler references are unsafe.");
      const manifestJSON = readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(manifestJSON);
      if (
        manifest.version !== 1 ||
        !Array.isArray(manifest.compilations) ||
        !manifest.binding?.projectPath ||
        !manifest.binding?.scheme ||
        !manifest.sourceBaselines
      )
        throw new Error("Live compiler references are invalid.");
      normalizedLiveBinaryIdentity(manifest.binaryIdentity);
      const after = stat(manifestPath);
      if (
        !after ||
        !same(identity(observation), identity(after)) ||
        observation.mtimeMs !== after.mtimeMs ||
        observation.size !== after.size
      )
        throw new Error("Live compiler references changed.");
      return { manifestJSON, binaryIdentity: manifest.binaryIdentity };
    },
    async openPaths() {
      const result = await commandRunner.run({
        executable: "/usr/sbin/lsof",
        args: ["-nP", "-a", "-u", String(process.getuid()), "-F", "n"],
        environment: { inherit: environmentNames(), overrides: { LC_ALL: "C" }, unset: [] },
        policy: {
          timeoutMs: 15_000,
          outputLimitBytes: 16 * 1024 * 1024,
          processGroup: "new",
          acceptedExitCodes: [0],
        },
      });
      if (
        result.error ||
        result.code !== 0 ||
        result.stderr.trim() ||
        !/^p\d+$/m.test(result.stdout) ||
        !/^n\//m.test(result.stdout)
      )
        throw new Error("Open compiler-cache references could not be verified.");
      return result.stdout
        .split("\n")
        .filter((line) => line.startsWith("n/"))
        .map((line) => resolve(line.slice(1)));
    },
  };
}

function stat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function directory(path) {
  const value = stat(path);
  if (!value) return null;
  if (
    !value.isDirectory() ||
    value.isSymbolicLink() ||
    (process.getuid && value.uid !== process.getuid())
  )
    throw new Error("Compiler cache directory is unsafe.");
  return value;
}

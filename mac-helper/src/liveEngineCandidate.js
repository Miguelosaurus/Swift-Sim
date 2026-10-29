import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NodeAtomicFileStore, ensureDirectoryModeSync } from "./infrastructure/nodeAtomicFileStore.js";
import { NodeArtifactStore } from "./infrastructure/nodeArtifactStore.js";

const DEFAULT_ROOT = join(homedir(), ".swift-sim", "engine");
const CONFIG_NAME = "local-candidate.json";

// Explicit local qualification only. A candidate is never a fallback download,
// a background updater, or a published release. Invalid configuration fails
// closed without replacing the existing installed engine.
export function readLocalEngineCandidate({ rootPath = DEFAULT_ROOT } = {}) {
  const path = join(rootPath, CONFIG_NAME);
  try {
    const stats = privateFile(path);
    privateDirectory(rootPath);
    privateDirectory(join(rootPath, "candidates"));
    if (stats.size > 4096) throw new Error();
    const value = JSON.parse(readFileSync(path, "utf8"));
    validate(value);
    const archivePath = join(rootPath, "candidates", `${value.sha256}.zip`);
    if (privateFile(archivePath).size > 128 * 1024 * 1024) throw new Error();
    return { candidate: { ...value, archivePath }, error: "" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      try { lstatSync(path); } catch (missing) { if (missing?.code === "ENOENT") return { candidate: null, error: "" }; }
    }
    return { candidate: null, error: "The explicit local engine candidate is invalid or unavailable. Preserve its configuration and resolve it before changing the engine." };
  }
}

export async function stageLocalEngineCandidate({ archivePath, version, sha256, sourceRevision }, { rootPath = DEFAULT_ROOT, files = new NodeAtomicFileStore(), artifacts = new NodeArtifactStore() } = {}) {
  const value = { version, sha256, sourceRevision, localCandidate: true };
  validate(value);
  const stats = lstatSync(archivePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 128 * 1024 * 1024) throw candidateError();
  const bytes = readFileSync(archivePath);
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw candidateError();
  ensureDirectoryModeSync(rootPath, 0o700);
  const directory = join(rootPath, "candidates"); ensureDirectoryModeSync(directory, 0o700);
  const destination = artifacts.resolveContained(directory, `${sha256}.zip`);
  try { await artifacts.write(destination, bytes, { mode: 0o600, replace: false }); }
  catch (error) {
    if (error?.code !== "EEXIST" || privateFile(destination).size > 128 * 1024 * 1024 || createHash("sha256").update(readFileSync(destination)).digest("hex") !== sha256) throw candidateError();
  }
  await files.writeJSON(join(rootPath, CONFIG_NAME), value, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
  return { staged: true, version, sha256, localCandidate: true };
}

function validate(value) {
  if (!value || !/^\d+\.\d+\.\d+$/.test(value.version || "") || !/^[a-f0-9]{64}$/.test(value.sha256 || "")
    || !/^[a-f0-9]{40}$/.test(value.sourceRevision || "") || value.localCandidate !== true) throw candidateError();
}
function privateFile(path) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0 || (process.getuid && stats.uid !== process.getuid())) throw candidateError();
  return stats;
}
function privateDirectory(path) {
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0 || (process.getuid && stats.uid !== process.getuid())) throw candidateError();
}
function candidateError() { return Object.assign(new Error("The local engine candidate failed validation. The installed engine was not changed."), { code: "LIVE_ENGINE_CANDIDATE_INVALID" }); }

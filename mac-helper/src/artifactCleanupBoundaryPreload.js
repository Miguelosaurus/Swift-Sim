import { rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DeviceBuildStore } from "./deviceBuildStore.js";

const CLEANUP_RETRY_INTERVAL_MS = 30_000;
const MAX_CLEANUP_BACKOFF_MS = 60 * 60 * 1000;
let installed = false;

export function installArtifactCleanupBoundary() {
  if (installed) return;
  installed = true;

  DeviceBuildStore.prototype.drainArtifactCleanupJobs = function guardedArtifactCleanup() {
    const jobs = this.withLock(() => [...this.readState().artifactCleanupJobs.values()]);
    const now = Date.now();
    for (const job of jobs) {
      const dueAt = Date.parse(job.nextAttemptAt || job.notBefore || job.createdAt || "");
      if (Number.isFinite(dueAt) && dueAt > now) continue;
      try {
        const root = validatedArtifactCleanupRoot(this.path, job);
        rmSync(root, { recursive: true, force: true });
        this.withTransaction((state) => {
          state.artifactCleanupJobs.delete(job.id);
          return true;
        });
      } catch (error) {
        this.withTransaction((state) => {
          const current = state.artifactCleanupJobs.get(job.id);
          if (!current) return false;
          current.attempts = Number(current.attempts || 0) + 1;
          current.lastError = error instanceof Error ? error.message : String(error);
          current.updatedAt = new Date().toISOString();
          const backoff = Math.min(
            MAX_CLEANUP_BACKOFF_MS,
            CLEANUP_RETRY_INTERVAL_MS * 2 ** Math.min(current.attempts - 1, 7),
          );
          current.nextAttemptAt = new Date(Date.now() + backoff).toISOString();
          return false;
        });
      }
    }
  };
}

export function validatedArtifactCleanupRoot(statePath, job) {
  const base = resolve(join(dirname(resolve(String(statePath))), "device-builds"));
  const root = resolve(String(job?.root || ""));
  const buildID = String(job?.buildId || "").trim();
  if (!job?.id || !root || root === base) throw invalidCleanupRootError();

  if (buildID) {
    const expected = resolve(join(base, buildID));
    if (root !== expected) throw invalidCleanupRootError();
    return root;
  }

  // Legacy jobs did not persist buildId. They are accepted only when the
  // target is one direct child of Swift Sim's private artifact directory.
  const child = relative(base, root);
  if (!child
      || isAbsolute(child)
      || child === ".."
      || child.startsWith(`..${sep}`)
      || child.includes(sep)) {
    throw invalidCleanupRootError();
  }
  return root;
}

function invalidCleanupRootError() {
  const error = new Error(
    "Swift Sim refused an artifact cleanup path outside its private device-build directory.",
  );
  error.code = "SWIFT_SIM_ARTIFACT_CLEANUP_PATH_INVALID";
  return error;
}

import { lstatSync, statfsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const GiB = 1024 ** 3;
const METADATA_RESERVE_BYTES = 512 * 1024 ** 2;

/** A lower bound, not a prediction of Xcode's maximum scratch-space usage. */
export function deviceBuildStorageBudget(build, { previousBuilds = [], inspectFile = lstatSync } = {}) {
  const configuration = String(build?.configuration || "Release").toLowerCase();
  const mode = configuration === "debug" ? "debug-build" : "archive-export";
  const floor = mode === "debug-build" ? 2 * GiB : 4 * GiB;
  let previousIpaBytes = 0;
  const candidates = [build, ...previousBuilds.slice(0, 64)];
  for (const candidate of candidates) {
    if (!candidate || !sameBuildTarget(build, candidate) || !candidate.artifacts?.ipaPath) continue;
    try {
      const file = inspectFile(candidate.artifacts.ipaPath);
      if (file.isFile() && Number.isSafeInteger(Number(file.size)) && Number(file.size) > previousIpaBytes) previousIpaBytes = Number(file.size);
    } catch {
      // A missing old install payload does not permit less than the mode floor.
    }
  }
  return {
    mode,
    requiredBytes: Math.max(floor, previousIpaBytes * 8 + METADATA_RESERVE_BYTES),
    previousIpaBytes,
    estimation: previousIpaBytes ? "matching-install-payload" : "configuration-floor",
  };
}

/** Cheap, read-only and called only when a signed build is actually selected. */
export function assertDeviceBuildStorage(build, {
  root = build?.artifacts?.root || join(homedir(), ".swift-sim", "device-builds"),
  previousBuilds = [],
  inspectFile = lstatSync,
  inspectVolume = statfsSync,
} = {}) {
  const budget = deviceBuildStorageBudget(build, { previousBuilds, inspectFile });
  let path = resolve(root);
  let volume;
  for (let depth = 0; depth < 64; depth += 1) {
    try { volume = inspectVolume(path, { bigint: true }); break; }
    catch (error) {
      if (error?.code !== "ENOENT" || dirname(path) === path) throw storageError("BUILD_STORAGE_UNAVAILABLE");
      path = dirname(path);
    }
  }
  if (!volume) throw storageError("BUILD_STORAGE_UNAVAILABLE");
  let availableBytes;
  try {
    const blocks = BigInt(volume.bavail);
    const blockSize = BigInt(volume.bsize);
    if (blocks < 0n || blockSize <= 0n) throw new Error("invalid available storage");
    const available = blocks * blockSize;
    availableBytes = Number(available > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : available);
  } catch { throw storageError("BUILD_STORAGE_UNAVAILABLE"); }
  if (availableBytes < budget.requiredBytes) {
    const error = storageError("BUILD_STORAGE_INSUFFICIENT");
    error.storage = { ...budget, availableBytes };
    throw error;
  }
  return { ...budget, availableBytes };
}

function sameBuildTarget(first, second) {
  return String(first?.project || "") === String(second?.project || "")
    && String(first?.workspace || "") === String(second?.workspace || "")
    && String(first?.scheme || "") === String(second?.scheme || "")
    && String(first?.configuration || "Release").toLowerCase() === String(second?.configuration || "Release").toLowerCase();
}

function storageError(code) {
  const error = new Error(code === "BUILD_STORAGE_INSUFFICIENT"
    ? "[BUILD_STORAGE_INSUFFICIENT] Not enough free storage for the selected signed build. Reclaim disposable build outputs or caches before retrying."
    : "[BUILD_STORAGE_UNAVAILABLE] Unable to inspect the selected build artifact volume safely.");
  error.code = code;
  return error;
}

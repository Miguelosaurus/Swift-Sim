import "./lockOwnershipPreload.js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { runRequiredBuildValidation } from "./buildValidation.js";
import { renewalCancellationPath } from "./renewalCancellation.js";
import { completeOwnedWorkerProcessRecord, ownedWorkerProcessState } from "./ownedWorkerIdentity.js";
import { assertDeviceBuildStorage } from "./deviceBuildStorage.js";
import { recordDeviceBuildFailure } from "./buildFailure.js";
import {
  requestDeviceBuildCancellation as requestDeviceBuildCancellationCore,
  runDeviceBuild as runDeviceBuildCore,
  resumeDeviceBuild as resumeDeviceBuildCore,
  terminateRecordedDeviceBuildWorker as terminateRecordedDeviceBuildWorkerCore,
} from "./deviceBuilderCore.js";

export * from "./deviceBuilderCore.js";

// Recovery reuses an already signed app; do not run the full validation,
// provisioning, storage-floor or Xcode compilation pipeline again.
export async function resumeDeviceBuild(build, options = {}) {
  try { return await resumeDeviceBuildCore(build, options); }
  catch (error) {
    if (error?.preserveBuildState || error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;
    throw recordDeviceBuildFailure(build, error, options.save);
  }
}

export async function runDeviceBuild(build, options = {}) {
  const save = () => options.save?.(build);
  try {
    build.state = "validating";
    save();
    if (!build.project && !build.workspace) throw Object.assign(new Error("Missing project or workspace path."), { code: "BUILD_INPUT_INVALID" });
    if (typeof build.scheme !== "string" || !build.scheme.trim()) throw Object.assign(new Error("Missing required scheme."), { code: "BUILD_INPUT_INVALID" });
    (options.checkStorage || assertDeviceBuildStorage)(build, {
      previousBuilds: options.previousBuilds || [],
    });
    await runRequiredBuildValidation({
      project: build.project || "",
      workspace: build.workspace || "",
      cancelPath: build.control?.cancelPath || "",
    });
    return await runDeviceBuildCore(build, options);
  } catch (error) {
    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;
    throw recordDeviceBuildFailure(build, error, options.save);
  }
}

export function requestDeviceBuildCancellation(build, reason = "Device build cancelled.") {
  if (build?.state !== "ready" || !build?.pendingRenewal?.id) {
    return requestDeviceBuildCancellationCore(build, reason);
  }

  const baseCancelPath = build?.control?.cancelPath || "";
  const cancelPath = renewalCancellationPath(baseCancelPath);
  if (!cancelPath) return false;
  mkdirSync(dirname(cancelPath), { recursive: true, mode: 0o700 });
  writeFileSync(cancelPath, JSON.stringify({
    buildId: build.id,
    reason,
    scope: "renewal",
    renewalID: build.pendingRenewal.id,
    owner: {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
    },
    cancelledAt: new Date().toISOString(),
  }), { mode: 0o600 });
  return true;
}

export async function terminateRecordedDeviceBuildWorker(build) {
  const cancelPath = build?.control?.cancelPath || "";
  const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
  if (!workerPath || !existsSync(workerPath)) {
    // Detached Xcode and validation commands are started behind the owned-worker
    // journal handshake. Without a journal the real command was never released,
    // or it already exited and removed its journal, so there is no owned worker
    // left for restart recovery to terminate.
    return true;
  }

  let record;
  try {
    record = JSON.parse(readFileSync(workerPath, "utf8"));
  } catch {
    throw recoveryError(build, "has an unreadable worker identity");
  }

  if (!completeOwnedWorkerProcessRecord(record)) {
    throw recoveryError(build, "has an incomplete or legacy worker identity");
  }

  const ownershipState = ownedWorkerProcessState(record);
  if (ownershipState === "dead" || ownershipState === "replaced") {
    return clearStaleWorkerJournal(workerPath);
  }
  if (ownershipState !== "current") {
    throw recoveryError(build, "points to a process whose start identity cannot be verified");
  }

  const pid = Number(record.pid);
  const command = processCommand(pid);
  const expected = record.command === "required-validation"
    ? ["/bin/sh", " sh "]
    : [basename(String(record.command))];
  if (!command || !expected.some((fragment) => command.includes(fragment))) {
    const finalOwnershipState = ownedWorkerProcessState(record);
    if (finalOwnershipState === "dead" || finalOwnershipState === "replaced") {
      return clearStaleWorkerJournal(workerPath);
    }
    if (finalOwnershipState !== "current") {
      throw recoveryError(build, "points to a process whose start identity cannot be verified");
    }
    throw recoveryError(build, "points to a process whose command cannot be verified");
  }

  const terminated = await terminateRecordedDeviceBuildWorkerCore(build);
  if (!terminated) {
    throw recoveryError(build, "could not be confirmed stopped");
  }
  return true;
}

function clearStaleWorkerJournal(path) {
  rmSync(path, { force: true });
  return true;
}

function recoveryError(build, detail) {
  const error = new Error(
    `Interrupted device build ${build?.id || "(unknown)"} ${detail}. `
      + "Swift Sim will not start another build until the worker is safely resolved."
  );
  error.code = "SWIFT_SIM_UNSAFE_BUILD_RECOVERY";
  return error;
}

function processCommand(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

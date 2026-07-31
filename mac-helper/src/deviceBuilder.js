import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { runRequiredBuildValidation } from "./buildValidation.js";
import {
  runDeviceBuild as runDeviceBuildCore,
  terminateRecordedDeviceBuildWorker as terminateRecordedDeviceBuildWorkerCore,
} from "./deviceBuilderCore.js";

export * from "./deviceBuilderCore.js";

export async function runDeviceBuild(build, options = {}) {
  const save = () => options.save?.(build);
  try {
    build.state = "validating";
    save();
    await runRequiredBuildValidation({
      project: build.project || "",
      workspace: build.workspace || "",
      cancelPath: build.control?.cancelPath || "",
    });
    return await runDeviceBuildCore(build, options);
  } catch (error) {
    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;
    if (build.state === "validating") {
      build.state = "failed";
      build.logs = Array.isArray(build.logs) ? build.logs : [];
      build.logs.push(error instanceof Error ? error.message : String(error));
      save();
    }
    throw error;
  }
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

  const pid = Number(record?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || !record?.startedAt || !record?.command) {
    throw recoveryError(build, "has an incomplete worker identity");
  }

  if (processIsAlive(pid)) {
    const command = processCommand(pid);
    const expected = record.command === "required-validation"
      ? ["/bin/sh", " sh "]
      : [basename(String(record.command))];
    if (!command || !expected.some((fragment) => command.includes(fragment))) {
      throw recoveryError(build, "points to a process whose command cannot be verified");
    }
  }

  const terminated = await terminateRecordedDeviceBuildWorkerCore(build);
  if (!terminated) {
    throw recoveryError(build, "could not be confirmed stopped");
  }
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

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

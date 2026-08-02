import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { prepareOwnedWorkerProcessIdentity, requiredOwnedWorkerProcessRecord } from "./ownedWorkerIdentity.js";

const preferencesPath = join(homedir(), ".swift-sim", "preferences.json");
const DEFAULT_VALIDATION_TIMEOUT_SECONDS = 15 * 60;
const MAX_VALIDATION_TIMEOUT_SECONDS = 60 * 60;

export function readBuildValidationPreferences({ path = preferencesPath } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return defaultPreferences();
    }
    throw validationError(
      `Unable to read Swift Sim validation preferences at ${path}: ${error instanceof Error ? error.message : String(error)}. Run swift-sim setup again.`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validationError(`Swift Sim validation preferences at ${path} are malformed. Run swift-sim setup again.`);
  }
  if (parsed.buildValidationMode !== undefined
      && parsed.buildValidationMode !== "always"
      && parsed.buildValidationMode !== "explicit") {
    throw validationError(`Swift Sim validation preferences at ${path} contain an invalid validation mode. Run swift-sim setup again.`);
  }

  return {
    ...parsed,
    buildValidationMode: parsed.buildValidationMode === "always" ? "always" : "explicit",
    buildValidationCommand: typeof parsed.buildValidationCommand === "string"
      ? parsed.buildValidationCommand.trim()
      : "",
    buildValidationWorkingDirectory: typeof parsed.buildValidationWorkingDirectory === "string"
      ? parsed.buildValidationWorkingDirectory.trim()
      : "",
    buildValidationTimeoutSeconds: normalizeValidationTimeoutSeconds(parsed.buildValidationTimeoutSeconds),
  };
}

export async function runRequiredBuildValidation({
  args,
  project = "",
  workspace = "",
  cwd = process.cwd(),
  preferences,
  timeoutMs,
  cancelPath = "",
} = {}) {
  const resolvedPreferences = preferences || readBuildValidationPreferences();
  if (resolvedPreferences.buildValidationMode !== "always") return;

  const command = String(resolvedPreferences.buildValidationCommand || "").trim();
  if (!command) {
    throw validationError("Swift Sim is configured for mandatory validation, but no validation command is set. Run swift-sim setup again.");
  }

  const projectDirectory = resolveValidationWorkingDirectory({
    args: args ?? buildTargetArgs({ project, workspace }),
    cwd,
    configuredDirectory: resolvedPreferences.buildValidationWorkingDirectory,
  });
  const effectiveTimeoutMs = timeoutMs ?? normalizeValidationTimeoutSeconds(
    resolvedPreferences.buildValidationTimeoutSeconds
  ) * 1_000;

  console.log(`Running required project validation in ${projectDirectory}: ${command}`);
  await runValidationCommand(command, {
    cwd: projectDirectory,
    timeoutMs: effectiveTimeoutMs,
    cancelPath,
  });
}

export function resolveValidationWorkingDirectory({ args = [], cwd = process.cwd(), configuredDirectory = "" }) {
  const target = optionValue(args, "--workspace") || optionValue(args, "--project");
  if (!target) {
    throw validationError("Mandatory validation requires --project or --workspace.");
  }

  const absoluteTarget = canonicalExistingPath(isAbsolute(target) ? target : resolve(cwd, target), "Build target");
  const targetDirectory = targetValidationDirectory(absoluteTarget);

  if (!configuredDirectory) return findRepositoryRoot(targetDirectory) || targetDirectory;

  const configured = canonicalExistingPath(
    isAbsolute(configuredDirectory) ? configuredDirectory : resolve(cwd, configuredDirectory),
    "Configured validation working directory"
  );
  if (!statSync(configured).isDirectory()) {
    throw validationError(`Configured validation working directory is not a directory: ${configured}`);
  }
  if (!pathContains(configured, absoluteTarget)) {
    throw validationError(
      `Configured validation working directory ${configured} does not contain the requested build target ${absoluteTarget}. Re-run swift-sim setup from this project's repository root.`
    );
  }

  const targetRepository = findRepositoryRoot(targetDirectory);
  const configuredRepository = findRepositoryRoot(configured);
  if (targetRepository && configuredRepository !== targetRepository) {
    throw validationError(
      `Configured validation working directory ${configured} is not part of the build target's repository ${targetRepository}. Re-run swift-sim setup inside that repository.`
    );
  }
  return configured;
}

function runValidationCommand(command, { cwd, timeoutMs, cancelPath = "" }) {
  return new Promise((resolvePromise, reject) => {
    if (cancelPath) {
      try {
        prepareOwnedWorkerProcessIdentity();
      } catch (error) {
        reject(validationError(
          `Unable to prepare the active validation worker identity: ${error instanceof Error ? error.message : String(error)}`
        ));
        return;
      }
    }
    const child = spawn("/bin/sh", ["-lc", command], {
      cwd,
      env: process.env,
      detached: true,
      stdio: "inherit",
    });
    let settled = false;
    let terminating = false;
    let cancellationTimer;
    let timeoutTimer;
    let validationWorkerRecordError = null;
    const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
    if (workerPath) {
      try {
        mkdirSync(dirname(workerPath), { recursive: true, mode: 0o700 });
        writeFileSync(
          workerPath,
          JSON.stringify(requiredOwnedWorkerProcessRecord(child.pid, "required-validation")),
          { mode: 0o600 },
        );
      } catch (error) {
        validationWorkerRecordError = error;
      }
    }

    const finish = (error, preserveWorkerRecord = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearInterval(cancellationTimer);
      if (workerPath && !preserveWorkerRecord) rmSync(workerPath, { force: true });
      if (error) reject(error);
      else resolvePromise();
    };

    const terminate = (error) => {
      if (settled || terminating) return;
      terminating = true;
      void terminateProcessGroup(child.pid, 2_000).then((terminated) => {
        if (!terminated) {
          error.message += " Its process group could not be confirmed stopped.";
        }
        finish(error, !terminated);
      });
    };

    if (validationWorkerRecordError) {
      terminate(validationError(
        `Unable to persist the active validation worker identity: ${validationWorkerRecordError instanceof Error ? validationWorkerRecordError.message : String(validationWorkerRecordError)}`
      ));
      return;
    }

    timeoutTimer = setTimeout(() => {
      terminate(validationError(
        `Required validation timed out after ${Math.ceil(timeoutMs / 1_000)} seconds; device build cancelled.`
      ));
    }, timeoutMs);
    timeoutTimer.unref?.();

    if (cancelPath) {
      cancellationTimer = setInterval(() => {
        if (!existsSync(cancelPath) || settled) return;
        const error = validationError("Device build was cancelled while validation was running.");
        error.code = "SWIFT_SIM_BUILD_CANCELLED";
        terminate(error);
      }, 100);
      cancellationTimer.unref?.();
    }

    child.once("error", (error) => {
      if (terminating) return;
      finish(validationError(`Unable to run required validation: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      if (terminating) return;
      terminating = true;
      void (async () => {
        const exited = await waitForProcessGroupExit(child.pid, 500);
        if (code === 0 && exited) {
          terminating = false;
          finish();
          return;
        }
        const terminated = exited || await terminateProcessGroup(child.pid, 2_000);
        const error = code === 0
          ? validationError("Required validation exited successfully while descendant processes were still running; device build cancelled.")
          : validationError(
              `Required validation failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}; device build cancelled.`,
              code || 1
            );
        if (!terminated) error.message += " Its process group could not be confirmed stopped.";
        finish(error, !terminated);
      })();
    });
  });
}

async function terminateProcessGroup(pid, graceMs) {
  signalProcessGroup(pid, "SIGTERM");
  if (await waitForProcessGroupExit(pid, graceMs)) return true;
  signalProcessGroup(pid, "SIGKILL");
  return waitForProcessGroupExit(pid, 2_000);
}

function signalProcessGroup(pid, signal) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return;
  try { process.kill(-Number(pid), signal); } catch {
    try { process.kill(Number(pid), signal); } catch {}
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processGroupIsAlive(pid);
}

function processGroupIsAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(-Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function defaultPreferences() {
  return {
    buildValidationMode: "explicit",
    buildValidationCommand: "",
    buildValidationWorkingDirectory: "",
    buildValidationTimeoutSeconds: DEFAULT_VALIDATION_TIMEOUT_SECONDS,
  };
}

function normalizeValidationTimeoutSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_VALIDATION_TIMEOUT_SECONDS;
  return Math.max(1, Math.min(MAX_VALIDATION_TIMEOUT_SECONDS, Math.floor(parsed)));
}

function buildTargetArgs({ project, workspace }) {
  if (workspace) return ["--workspace", workspace];
  if (project) return ["--project", project];
  return [];
}

function canonicalExistingPath(path, label) {
  if (!existsSync(path)) throw validationError(`${label} does not exist: ${path}`);
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function targetValidationDirectory(target) {
  const extension = extname(target);
  if (extension === ".xcodeproj" || extension === ".xcworkspace") return dirname(target);
  return statSync(target).isDirectory() ? target : dirname(target);
}

function findRepositoryRoot(start) {
  let current = start;
  const filesystemRoot = parse(current).root;
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    if (current === filesystemRoot) return "";
    const parent = dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

function pathContains(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  if (index >= 0 && typeof args[index + 1] === "string") return args[index + 1];
  const prefix = `${option}=`;
  return args.find((value) => typeof value === "string" && value.startsWith(prefix))?.slice(prefix.length) || "";
}

function validationError(message, exitCode = 78) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

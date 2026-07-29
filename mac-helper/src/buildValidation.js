import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

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
    const child = spawn("/bin/sh", ["-lc", command], {
      cwd,
      env: process.env,
      detached: true,
      stdio: "inherit",
    });
    let settled = false;
    let timedOut = false;
    let forceTimer;
    let finalTimer;
    let cancellationTimer;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(forceTimer);
      clearTimeout(finalTimer);
      clearInterval(cancellationTimer);
      if (error) reject(error);
      else resolvePromise();
    };

    const signalGroup = (signal) => {
      try { process.kill(-child.pid, signal); } catch {
        try { child.kill(signal); } catch {}
      }
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalGroup("SIGTERM");
      forceTimer = setTimeout(() => signalGroup("SIGKILL"), 2_000);
      forceTimer.unref?.();
      finalTimer = setTimeout(() => finish(validationError(
        `Required validation timed out after ${Math.ceil(timeoutMs / 1_000)} seconds; device build cancelled.`
      )), 4_000);
      finalTimer.unref?.();
    }, timeoutMs);
    timeoutTimer.unref?.();

    if (cancelPath) {
      cancellationTimer = setInterval(() => {
        if (!existsSync(cancelPath) || settled) return;
        timedOut = true;
        signalGroup("SIGTERM");
        forceTimer = setTimeout(() => signalGroup("SIGKILL"), 2_000);
        forceTimer.unref?.();
        finalTimer = setTimeout(() => {
          const error = validationError("Device build was cancelled while validation was running.");
          error.code = "SWIFT_SIM_BUILD_CANCELLED";
          finish(error);
        }, 4_000);
        finalTimer.unref?.();
      }, 100);
      cancellationTimer.unref?.();
    }

    child.once("error", (error) => {
      finish(validationError(`Unable to run required validation: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      if (timedOut) {
        if (cancelPath && existsSync(cancelPath)) {
          const error = validationError("Device build was cancelled while validation was running.");
          error.code = "SWIFT_SIM_BUILD_CANCELLED";
          finish(error);
        } else {
          finish(validationError(
            `Required validation timed out after ${Math.ceil(timeoutMs / 1_000)} seconds; device build cancelled.`
          ));
        }
        return;
      }
      if (code === 0) {
        finish();
        return;
      }
      finish(validationError(
        `Required validation failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}; device build cancelled.`,
        code || 1
      ));
    });
  });
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

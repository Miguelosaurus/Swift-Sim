import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

const preferencesPath = join(homedir(), ".swift-sim", "preferences.json");

export function readBuildValidationPreferences() {
  try {
    const parsed = JSON.parse(readFileSync(preferencesPath, "utf8"));
    return {
      ...parsed,
      buildValidationMode: parsed.buildValidationMode === "always" ? "always" : "explicit",
      buildValidationCommand: typeof parsed.buildValidationCommand === "string"
        ? parsed.buildValidationCommand.trim()
        : "",
      buildValidationWorkingDirectory: typeof parsed.buildValidationWorkingDirectory === "string"
        ? parsed.buildValidationWorkingDirectory.trim()
        : "",
    };
  } catch {
    return {
      buildValidationMode: "explicit",
      buildValidationCommand: "",
      buildValidationWorkingDirectory: "",
    };
  }
}

export function runRequiredBuildValidation({
  args,
  project = "",
  workspace = "",
  cwd = process.cwd(),
  preferences,
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
  console.log(`Running required project validation in ${projectDirectory}: ${command}`);
  const result = spawnSync(command, {
    cwd: projectDirectory,
    env: process.env,
    shell: true,
    stdio: "inherit",
  });
  if (result.error) {
    throw validationError(`Unable to run required validation: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw validationError(`Required validation failed with exit code ${result.status ?? "unknown"}; device build cancelled.`, result.status || 1);
  }
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

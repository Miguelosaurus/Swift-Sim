import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function runRequiredBuildValidation({ args = process.argv.slice(2), cwd = process.cwd(), preferences } = {}) {
  const resolvedPreferences = preferences || readBuildValidationPreferences();
  if (resolvedPreferences.buildValidationMode !== "always") return;

  const command = String(resolvedPreferences.buildValidationCommand || "").trim();
  if (!command) {
    throw validationError("Swift Sim is configured for mandatory validation, but no validation command is set. Run swift-sim setup again.");
  }

  const projectDirectory = resolveValidationWorkingDirectory({
    args,
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

export function resolveValidationWorkingDirectory({ args, cwd, configuredDirectory = "" }) {
  if (configuredDirectory) {
    const configured = isAbsolute(configuredDirectory)
      ? configuredDirectory
      : resolve(cwd, configuredDirectory);
    if (!existsSync(configured)) {
      throw validationError(`Configured validation working directory does not exist: ${configured}`);
    }
    return configured;
  }

  const target = optionValue(args, "--workspace") || optionValue(args, "--project");
  if (!target) {
    throw validationError("Mandatory validation requires --project, --workspace, or a configured validation working directory.");
  }
  const absoluteTarget = isAbsolute(target) ? target : resolve(cwd, target);
  if (!existsSync(absoluteTarget)) {
    throw validationError(`Build target does not exist: ${absoluteTarget}`);
  }
  const extension = extname(absoluteTarget);
  if (extension === ".xcodeproj" || extension === ".xcworkspace") return dirname(absoluteTarget);
  return absoluteTarget;
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

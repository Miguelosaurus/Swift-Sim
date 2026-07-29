#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { readBuildValidationPreferences } from "../src/buildValidation.js";

const preferencesPath = join(homedir(), ".swift-sim", "preferences.json");
const args = process.argv.slice(2);
const command = args[0] || "help";

if (command === "ci-policy") {
  const preferences = readBuildValidationPreferences();
  const payload = {
    mode: preferences.buildValidationMode,
    runBeforeEveryBuild: preferences.buildValidationMode === "always",
    command: preferences.buildValidationCommand || "",
    workingDirectory: preferences.buildValidationWorkingDirectory || "",
    timeoutSeconds: preferences.buildValidationTimeoutSeconds,
  };
  if (args.includes("--json")) console.log(JSON.stringify(payload, null, 2));
  else if (payload.runBeforeEveryBuild) {
    console.log(`Run before every device build: ${payload.command}`);
    console.log(payload.workingDirectory
      ? `Validation working directory: ${payload.workingDirectory}`
      : "Validation working directory: inferred from --project or --workspace");
    console.log(`Validation timeout: ${payload.timeoutSeconds} seconds`);
  } else {
    console.log("Run project checks only when the user explicitly requests them.");
  }
  process.exit(0);
}

if (command === "setup" && !args.includes("--json") && input.isTTY && output.isTTY) {
  await configureBuildValidation();
}

await import("./swift-sim.js");

async function configureBuildValidation() {
  let current;
  try {
    current = readBuildValidationPreferences();
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
    current = {
      buildValidationMode: "explicit",
      buildValidationCommand: "",
      buildValidationWorkingDirectory: "",
      buildValidationTimeoutSeconds: 900,
    };
  }
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(
      "Run project CI/checks before every Swift Sim build link? [y/N] "
    )).trim().toLowerCase();
    current.buildValidationMode = ["y", "yes"].includes(answer) ? "always" : "explicit";
    if (current.buildValidationMode === "always") {
      const configured = (await rl.question(
        `Validation command [${current.buildValidationCommand || "npm run check"}]: `
      )).trim();
      current.buildValidationCommand = configured || current.buildValidationCommand || "npm run check";
      const workingDirectory = (await rl.question(
        "Validation repository root [infer from project/workspace]: "
      )).trim();
      if (workingDirectory) current.buildValidationWorkingDirectory = resolve(process.cwd(), workingDirectory);
      else delete current.buildValidationWorkingDirectory;
      const timeoutAnswer = (await rl.question(
        `Validation timeout in seconds [${current.buildValidationTimeoutSeconds || 900}]: `
      )).trim();
      const parsedTimeout = Number(timeoutAnswer || current.buildValidationTimeoutSeconds || 900);
      current.buildValidationTimeoutSeconds = Number.isFinite(parsedTimeout)
        ? Math.max(1, Math.min(3600, Math.floor(parsedTimeout)))
        : 900;
    } else {
      delete current.buildValidationCommand;
      delete current.buildValidationWorkingDirectory;
      delete current.buildValidationTimeoutSeconds;
    }
    writePreferences(current);
    console.log(current.buildValidationMode === "always"
      ? `Swift Sim will run '${current.buildValidationCommand}' before every device build with a ${current.buildValidationTimeoutSeconds}-second timeout.`
      : "Swift Sim will run project checks only when you explicitly ask.");
  } finally {
    rl.close();
  }
}

function writePreferences(preferences) {
  mkdirSync(dirname(preferencesPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${preferencesPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(preferences, null, 2), { mode: 0o600 });
  renameSync(temporaryPath, preferencesPath);
}

#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  };
  if (args.includes("--json")) console.log(JSON.stringify(payload, null, 2));
  else if (payload.runBeforeEveryBuild) {
    console.log(`Run before every device build: ${payload.command}`);
    console.log(payload.workingDirectory
      ? `Validation working directory: ${payload.workingDirectory}`
      : "Validation working directory: inferred from --project or --workspace");
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
  const current = readBuildValidationPreferences();
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
      if (workingDirectory) current.buildValidationWorkingDirectory = workingDirectory;
      else delete current.buildValidationWorkingDirectory;
    } else {
      delete current.buildValidationCommand;
      delete current.buildValidationWorkingDirectory;
    }
    writePreferences(current);
    console.log(current.buildValidationMode === "always"
      ? `Swift Sim will run '${current.buildValidationCommand}' before every device build.`
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

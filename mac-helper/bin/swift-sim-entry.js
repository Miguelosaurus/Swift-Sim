#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const preferencesPath = join(homedir(), ".swift-sim", "preferences.json");
const args = process.argv.slice(2);
const command = args[0] || "help";

if (command === "ci-policy") {
  const preferences = readPreferences();
  const payload = {
    mode: preferences.buildValidationMode,
    runBeforeEveryBuild: preferences.buildValidationMode === "always",
    command: preferences.buildValidationCommand || "",
  };
  if (args.includes("--json")) console.log(JSON.stringify(payload, null, 2));
  else if (payload.runBeforeEveryBuild) {
    console.log(`Run before every device build: ${payload.command}`);
  } else {
    console.log("Run project checks only when the user explicitly requests them.");
  }
  process.exit(0);
}

if (command === "setup" && !args.includes("--json") && input.isTTY && output.isTTY) {
  await configureBuildValidation();
}

if (command === "build-device" && readPreferences().buildValidationMode === "always") {
  runConfiguredValidation(readPreferences());
}

await import("./swift-sim.js");

async function configureBuildValidation() {
  const current = readPreferences();
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
    } else {
      delete current.buildValidationCommand;
    }
    writePreferences(current);
    console.log(current.buildValidationMode === "always"
      ? `Swift Sim will run '${current.buildValidationCommand}' before every device build.`
      : "Swift Sim will run project checks only when you explicitly ask.");
  } finally {
    rl.close();
  }
}

function runConfiguredValidation(preferences) {
  const validationCommand = String(preferences.buildValidationCommand || "").trim();
  if (!validationCommand) {
    console.error("Swift Sim is configured for mandatory validation, but no validation command is set. Run swift-sim setup again.");
    process.exit(78);
  }
  console.log(`Running required project validation: ${validationCommand}`);
  const result = spawnSync(validationCommand, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Unable to run required validation: ${result.error.message}`);
    process.exit(78);
  }
  if (result.status !== 0) {
    console.error(`Required validation failed with exit code ${result.status ?? "unknown"}; device build cancelled.`);
    process.exit(result.status || 1);
  }
}

function readPreferences() {
  try {
    const parsed = JSON.parse(readFileSync(preferencesPath, "utf8"));
    return {
      ...parsed,
      buildValidationMode: parsed.buildValidationMode === "always" ? "always" : "explicit",
      buildValidationCommand: typeof parsed.buildValidationCommand === "string"
        ? parsed.buildValidationCommand.trim()
        : "",
    };
  } catch {
    return { buildValidationMode: "explicit", buildValidationCommand: "" };
  }
}

function writePreferences(preferences) {
  mkdirSync(dirname(preferencesPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${preferencesPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(preferences, null, 2), { mode: 0o600 });
  renameSync(temporaryPath, preferencesPath);
}
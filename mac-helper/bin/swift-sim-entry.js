#!/usr/bin/env node
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
  };
  if (args.includes("--json")) console.log(JSON.stringify(payload, null, 2));
  else console.log(payload.runBeforeEveryBuild
    ? "Run project checks before every device build."
    : "Run project checks only when the user explicitly requests them.");
  process.exit(0);
}

if (command === "setup" && !args.includes("--json") && input.isTTY && output.isTTY) {
  await configureBuildValidation();
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
    writePreferences(current);
    console.log(current.buildValidationMode === "always"
      ? "Swift Sim agents will run project checks before every device build."
      : "Swift Sim agents will run project checks only when you explicitly ask.");
  } finally {
    rl.close();
  }
}

function readPreferences() {
  try {
    const parsed = JSON.parse(readFileSync(preferencesPath, "utf8"));
    return {
      ...parsed,
      buildValidationMode: parsed.buildValidationMode === "always" ? "always" : "explicit",
    };
  } catch {
    return { buildValidationMode: "explicit" };
  }
}

function writePreferences(preferences) {
  mkdirSync(dirname(preferencesPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${preferencesPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(preferences, null, 2), { mode: 0o600 });
  renameSync(temporaryPath, preferencesPath);
}

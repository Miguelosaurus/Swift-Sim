#!/usr/bin/env node
import { runRequiredBuildValidation } from "../src/buildValidation.js";

const [command = "serve", ...rest] = process.argv.slice(2);

try {
  if (command === "build-device") {
    runRequiredBuildValidation({ args: rest });
  }
  await import("./swift-sim-helper.js");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = Number(error?.exitCode) || 1;
}

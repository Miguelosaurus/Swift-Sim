import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readBuildValidationPreferences,
  resolveValidationWorkingDirectory,
  runRequiredBuildValidation,
} from "../mac-helper/src/buildValidation.js";

async function withProjects(run) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-validation-test-"));
  const appA = join(root, "AppA");
  const appB = join(root, "AppB");
  const projectA = join(appA, "ios", "AppA.xcodeproj");
  const projectB = join(appB, "ios", "AppB.xcodeproj");
  mkdirSync(join(appA, ".git"), { recursive: true });
  mkdirSync(join(appB, ".git"), { recursive: true });
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });
  try {
    return await run({ root, appA, appB, projectA, projectB });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("validation defaults to the requested target repository", () => withProjects(({ root, appA }) => {
  assert.equal(
    resolveValidationWorkingDirectory({ args: ["--project", "AppA/ios/AppA.xcodeproj"], cwd: root }),
    realpathSync(appA)
  );
}));

test("a configured directory inside the target repository may contain the Xcode target", () => withProjects(({ appA, projectA }) => {
  const iosDirectory = join(appA, "ios");
  assert.equal(
    resolveValidationWorkingDirectory({
      args: ["--project", projectA],
      configuredDirectory: iosDirectory,
    }),
    realpathSync(iosDirectory)
  );
}));

test("validation for one project cannot authorize a different project", () => withProjects(({ appA, projectB }) => {
  assert.throws(
    () => resolveValidationWorkingDirectory({
      args: ["--project", projectB],
      configuredDirectory: appA,
    }),
    /does not contain the requested build target/
  );
}));

test("a broad parent containing multiple repositories cannot be a validation root", () => withProjects(({ root, projectA }) => {
  assert.throws(
    () => resolveValidationWorkingDirectory({
      args: ["--project", projectA],
      configuredDirectory: root,
    }),
    /is not part of the build target's repository/
  );
}));

test("missing preferences default to explicit validation", () => withProjects(({ root }) => {
  const preferences = readBuildValidationPreferences({ path: join(root, "missing.json") });
  assert.equal(preferences.buildValidationMode, "explicit");
}));

test("an existing malformed preferences file fails closed", () => withProjects(({ root }) => {
  const path = join(root, "preferences.json");
  writeFileSync(path, "{broken-json", "utf8");
  assert.throws(
    () => readBuildValidationPreferences({ path }),
    /Unable to read Swift Sim validation preferences/
  );
}));

test("required validation runs asynchronously and succeeds", () => withProjects(async ({ projectA }) => {
  await runRequiredBuildValidation({
    project: projectA,
    preferences: {
      buildValidationMode: "always",
      buildValidationCommand: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
      buildValidationWorkingDirectory: "",
      buildValidationTimeoutSeconds: 10,
    },
  });
}));

test("required validation has a hard timeout", () => withProjects(async ({ projectA }) => {
  await assert.rejects(
    runRequiredBuildValidation({
      project: projectA,
      timeoutMs: 75,
      preferences: {
        buildValidationMode: "always",
        buildValidationCommand: `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 5000)"`,
        buildValidationWorkingDirectory: "",
        buildValidationTimeoutSeconds: 10,
      },
    }),
    /timed out/
  );
}));

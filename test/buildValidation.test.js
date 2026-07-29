import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveValidationWorkingDirectory } from "../mac-helper/src/buildValidation.js";

function withProjects(run) {
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
    return run({ root, appA, appB, projectA, projectB });
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

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveValidationWorkingDirectory } from "../mac-helper/src/buildValidation.js";

function withProjects(run) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-validation-test-"));
  const appA = join(root, "AppA");
  const appB = join(root, "AppB");
  const projectA = join(appA, "AppA.xcodeproj");
  const projectB = join(appB, "AppB.xcodeproj");
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });
  try {
    return run({ root, appA, appB, projectA, projectB });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("validation defaults to the requested Xcode target directory", () => withProjects(({ root, appA }) => {
  assert.equal(
    resolveValidationWorkingDirectory({ args: ["--project", "AppA/AppA.xcodeproj"], cwd: root }),
    appA
  );
}));

test("a configured repository root must contain the requested build target", () => withProjects(({ appA, projectA }) => {
  assert.equal(
    resolveValidationWorkingDirectory({
      args: ["--project", projectA],
      configuredDirectory: appA,
    }),
    appA
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

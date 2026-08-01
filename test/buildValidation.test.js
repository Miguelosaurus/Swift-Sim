import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

test("cancelling validation kills a TERM-ignoring descendant before rejecting", () => withProjects(async ({ root, projectA }) => {
  const cancelPath = join(root, "cancelled");
  const pidPath = join(root, "descendant.pid");
  const descendant = `${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)")}`;
  const command = `trap 'exit 0' TERM; ${descendant} & echo $! > ${JSON.stringify(pidPath)}; wait`;
  const validation = runRequiredBuildValidation({
    project: projectA,
    cancelPath,
    preferences: {
      buildValidationMode: "always",
      buildValidationCommand: command,
      buildValidationWorkingDirectory: "",
      buildValidationTimeoutSeconds: 10,
    },
  });
  const deadline = Date.now() + 3_000;
  while (!existsSync(pidPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  writeFileSync(cancelPath, "cancelled");
  await assert.rejects(validation, (error) => error?.code === "SWIFT_SIM_BUILD_CANCELLED");
  const status = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  assert.equal(status.status === 0 && !String(status.stdout || "").trim().startsWith("Z"), false);
}));


test("successful validation rejects and terminates surviving descendants", () => withProjects(async ({ root, projectA }) => {
  const pidPath = join(root, "success-descendant.pid");
  const descendantSource = "process.on('SIGHUP', () => {}); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
  const descendant = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(descendantSource)}`;
  const command = `${descendant} & echo $! > ${JSON.stringify(pidPath)}; exit 0`;
  await assert.rejects(
    runRequiredBuildValidation({
      project: projectA,
      preferences: {
        buildValidationMode: "always",
        buildValidationCommand: command,
        buildValidationWorkingDirectory: "",
        buildValidationTimeoutSeconds: 10,
      },
    }),
    /descendant processes were still running/
  );
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  const status = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  assert.equal(status.status === 0 && !String(status.stdout || "").trim().startsWith("Z"), false);
}));

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBuildFailure, buildFailureNotice, recordDeviceBuildFailure } from "../mac-helper/src/buildFailure.js";
import { deviceBuildStorageBudget, assertDeviceBuildStorage } from "../mac-helper/src/deviceBuildStorage.js";
import { runDeviceBuild } from "../mac-helper/src/deviceBuilder.js";
import { DeviceBuildStore } from "../mac-helper/src/deviceBuildStoreCore.js";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const target = { project: "/fixture/Example.xcodeproj", scheme: "Example", configuration: "Debug", artifacts: {} };

test("CodeSign evidence survives an unrelated stderr project warning", () => {
  const failure = {
    stdout: "CodeSign fixture.app\nerror: errSecInternalComponent\nCommand CodeSign failed with a nonzero exit code",
    stderr: "warning: Target 'Example' from project 'Example' requires a build setting",
  };
  assert.equal(classifyBuildFailure(failure), "SIGNING_FAILED");
  assert.equal(classifyBuildFailure("[SIGNING_FAILED] warning: project Example requires a build setting"), "SIGNING_FAILED");
  assert.equal(classifyBuildFailure("The following build commands failed:\n CodeSign fixture.app (in target Example)"), "SIGNING_FAILED");
});

test("successful signing steps and ordinary project wording do not become input or signing failures", () => {
  assert.equal(classifyBuildFailure("CodeSign fixture.app\nSwiftCompile failed: cannot find symbol"), "BUILD_FAILED");
  assert.equal(classifyBuildFailure("warning: in project Example, target Example requires a setting\nBUILD FAILED"), "BUILD_FAILED");
  assert.equal(classifyBuildFailure("Missing required scheme."), "BUILD_INPUT_INVALID");
});

test("storage evidence remains distinct from an unproven CodeSign failure cause", () => {
  assert.equal(classifyBuildFailure(Object.assign(new Error("write failed"), { code: "ENOSPC" })), "BUILD_STORAGE_INSUFFICIENT");
  assert.equal(classifyBuildFailure("Code signing failed: No space left on device"), "BUILD_STORAGE_INSUFFICIENT");
  assert.equal(classifyBuildFailure("Command CodeSign failed with a nonzero exit code"), "SIGNING_FAILED");
  const notice = buildFailureNotice(new Error("Command CodeSign failed /Users/private/file Bearer secret"));
  assert.equal(notice.code, "SIGNING_FAILED");
  assert.doesNotMatch(JSON.stringify(notice), /\/Users\/|Bearer|secret/);
});

test("preserved Debug registration failures retain bounded typed recovery without exposing raw artifacts", () => {
  for (const code of ["LIVE_REGISTRATION_PENDING", "LIVE_REGISTRATION_RECEIPT_MISMATCH", "LIVE_ENGINE_REGISTRATION_UPDATE_REQUIRED", "LIVE_CAPTURE_PROVENANCE_CHANGED", "LIVE_BUILD_RESUME_SOURCE_CHANGED", "LIVE_BUILD_RESUME_IDENTITY_MISMATCH", "BUILD_RESUME_STATE_CHANGED"]) {
    const error = Object.assign(new Error("private /Users/private/artifact Bearer secret"), { code });
    assert.equal(classifyBuildFailure(error), code);
    assert.equal(classifyBuildFailure(`[${code}] stage failure`), code);
    const notice = buildFailureNotice(error);
    assert.equal(notice.code, code);
    assert.doesNotMatch(JSON.stringify(notice), /\/Users\/|Bearer|secret/);
  }
  assert.equal(classifyBuildFailure("[UNTRUSTED_MADE_UP_CODE] arbitrary"), "BUILD_FAILED");
});

test("a terminal save failure preserves the original error and can be reconciled later", () => {
  const build = { state: "building", logs: [] };
  const original = new Error("Command CodeSign failed");
  const failed = recordDeviceBuildFailure(build, original, () => { throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }); });
  assert.strictEqual(failed, original);
  assert.equal(failed.code, "SIGNING_FAILED");
  assert.equal(failed.metadataPersistenceFailed, true);
  assert.equal(build.state, "failed");
  let persisted;
  recordDeviceBuildFailure(build, failed, (next) => { persisted = structuredClone(next); });
  assert.equal(failed.metadataPersistenceFailed, undefined);
  assert.equal(persisted.state, "failed");
});

test("storage budgets distinguish Debug from archive/export and scale from matching install payloads", () => {
  assert.equal(deviceBuildStorageBudget(target).requiredBytes, 2 * GiB);
  assert.equal(deviceBuildStorageBudget({ ...target, configuration: "Release" }).requiredBytes, 4 * GiB);
  const previousBuilds = [
    { ...target, artifacts: { ipaPath: "matching.ipa" } },
    { ...target, scheme: "Other", artifacts: { ipaPath: "unrelated.ipa" } },
  ];
  const calls = [];
  const budget = deviceBuildStorageBudget(target, {
    previousBuilds,
    inspectFile(path) { calls.push(path); return { isFile: () => true, size: 600 * MiB }; },
  });
  assert.deepEqual(calls, ["matching.ipa"]);
  assert.equal(budget.requiredBytes, 600 * MiB * 8 + 512 * MiB);
  assert.equal(budget.estimation, "matching-install-payload");
});

test("storage history is a bounded cached hint that neither writes state nor exposes credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-build-storage-"));
  try {
    const store = new DeviceBuildStore({ path: join(directory, "builds.json") });
    const build = store.create({ scheme: "Example", configuration: "Debug" });
    Object.assign(build, target, { artifacts: { ipaPath: "/fixture/Example.ipa" } });
    store.save(build);
    store.writeState = () => { throw new Error("Storage planning must not write state."); };
    const history = store.buildStorageHistory();
    assert.equal(history.length, 1);
    assert.deepEqual(history[0], { ...target, workspace: "", artifacts: { ipaPath: "/fixture/Example.ipa" } });
    assert.doesNotMatch(JSON.stringify(history), /token|capabilities|installation/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a low-storage build is rejected with numerical diagnostics before any build command", async () => {
  const build = { ...target, logs: [], state: "queued" };
  const states = [];
  let checks = 0; let commands = 0;
  await assert.rejects(runDeviceBuild(build, {
    save(next) { states.push(next.state); },
    logger() { commands += 1; },
    checkStorage(next) {
      checks += 1;
      return assertDeviceBuildStorage(next, {
        inspectVolume: () => ({ bavail: BigInt(199 * MiB), bsize: 1n }),
      });
    },
  }), (error) => {
    assert.equal(error.code, "BUILD_STORAGE_INSUFFICIENT");
    assert.equal(error.storage.availableBytes, 199 * MiB);
    assert.equal(error.storage.requiredBytes, 2 * GiB);
    assert.doesNotMatch(error.message, /\/fixture|\/Users\//);
    return true;
  });
  assert.equal(checks, 1); assert.equal(commands, 0);
  assert.deepEqual(states, ["validating", "failed"]);
  assert.equal(build.state, "failed");
});

test("volume checks walk only missing ancestors and fail closed for unreadable or malformed volume data", () => {
  const paths = [];
  const sufficient = assertDeviceBuildStorage(target, {
    root: "/fixture/missing/build",
    inspectVolume(path) {
      paths.push(path);
      if (path !== "/fixture") throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { bavail: BigInt(8 * GiB), bsize: 1n };
    },
  });
  assert.equal(sufficient.availableBytes, 8 * GiB);
  assert.deepEqual(paths, ["/fixture/missing/build", "/fixture/missing", "/fixture"]);
  for (const inspectVolume of [
    () => { throw Object.assign(new Error("private volume path"), { code: "EACCES" }); },
    () => ({ bavail: -1n, bsize: 1n }),
    () => ({ bavail: 1n, bsize: 0n }),
    () => ({ bavail: "malformed", bsize: 1n }),
  ]) {
    assert.throws(() => assertDeviceBuildStorage(target, { inspectVolume }), { code: "BUILD_STORAGE_UNAVAILABLE" });
  }
});

test("production Xcode runner classifies stdout CodeSign failure before returning a terse stderr warning", { timeout: 20_000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-signing-failure-"));
  const project = join(directory, "Example.xcodeproj");
  mkdirSync(project);
  const command = `#!${process.execPath}
    const args = process.argv.slice(2);
    if(args.includes('-showBuildSettings')) console.log('Build settings for action build and target Example:\\n    PRODUCT_TYPE = com.apple.product-type.application\\n    WRAPPER_EXTENSION = app\\n    PRODUCT_BUNDLE_IDENTIFIER = com.example.fixture\\n    DEVELOPMENT_TEAM = FIXTURE\\n    CURRENT_PROJECT_VERSION = 1');
    else {
      console.log('CodeSign fixture.app\\nerror: errSecInternalComponent\\nCommand CodeSign failed with a nonzero exit code');
      console.error('warning: project Example requires a setting');
      process.exitCode = 65;
    }
  `;
  writeFileSync(join(directory, "xcodebuild"), command, { mode: 0o700 });
  const core = fileURLToPath(new URL("../mac-helper/src/deviceBuilderCore.js", import.meta.url));
  const script = `
    import { runDeviceBuild } from ${JSON.stringify(core)};
    const build = { id:'fixture',project:${JSON.stringify(project)}, scheme:'Example',configuration:'Release', logs:[],artifacts:{root:${JSON.stringify(join(directory, "artifacts"))}},app:{},signing:{},preserveData:true };
    const states = [];
    try { await runDeviceBuild(build,{save:next=>states.push(next.state)}); }
    catch(error) { console.log(JSON.stringify({code:error.code,message:error.message,state:build.state,states})); }
  `;
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: directory, PATH: `${directory}:${process.env.PATH}` },
      encoding: "utf8", timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const outcome = JSON.parse(result.stdout.trim());
    assert.equal(outcome.code, "SIGNING_FAILED");
    assert.match(outcome.message, /^\[SIGNING_FAILED\]/);
    assert.equal(outcome.state, "failed");
    assert.equal(outcome.states.at(-1), "failed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

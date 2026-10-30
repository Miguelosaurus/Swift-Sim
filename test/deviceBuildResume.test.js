import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { resumeDeviceBuild, signedDebugBuildDestination } from "../mac-helper/src/deviceBuilderCore.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
const fixtureFileStore = new NodeAtomicFileStore();

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-resume-"));
  const base = join(directory, "device-builds");
  const root = join(base, "build-fixture");
  const app = join(root, "DerivedData", "Build", "Products", "Debug-iphoneos", "Example.app");
  const project = join(directory, "Example.xcodeproj");
  const resultBundle = join(root, "Example.xcresult");
  const source = join(directory, "Card.swift");
  const stamp = 1_700_000_000_000;
  for (const path of [app, join(app, "_CodeSignature"), project, resultBundle, join(root, "export")]) mkdirSync(path, { recursive: true });
  for (const [path, bytes] of [[source, "struct Card {}"], [join(project, "project.pbxproj"), "approved project"],
    ...["Info.plist", "DifferentExecutable", "DifferentExecutable.debug.dylib", "_CodeSignature/CodeResources"].map((name) => [join(app, name), name])]) {
    writeFileSync(path, bytes); utimesSync(path, stamp / 1000 - 5, stamp / 1000 - 5);
  }
  const identity = { bundle_id: "com.example.fixture", bundle_version: "1.0", build_number: "28", executable_uuid: "11111111-1111-1111-1111-111111111111", debug_dylib_uuid: "22222222-2222-2222-2222-222222222222" };
  const build = { id: "build-fixture", state: "failed", project, scheme: "Example", configuration: "Debug", app: { bundleIdentifier: identity.bundle_id, version: "1.0", build: "28", teamID: "FIXTURETEAM" }, liveReload: { eligible: true, compilerReady: false },
    createdAt: new Date(stamp - 20_000).toISOString(), updatedAt: new Date(stamp + 5000).toISOString(), logs: [], control: { cancelPath: join(root, ".cancelled") }, artifacts: { root, exportPath: join(root, "export"), resultBundlePath: resultBundle, ipaPath: "" } };
  const summary = { status: "succeeded", errorCount: 0, actionTitle: 'Build "Example"', startTime: stamp / 1000 - 10, endTime: stamp / 1000, destination: { platform: "iOS" } };
  const calls = []; const publications = [];
  let current = structuredClone(build); let registrationResult = { registered: 89 }; let afterRegister; let beforePackage; let beforeStart;
  const fingerprint = (path) => ({ hash: createHash("sha256").update(fixtureFileStore.readTextSync(path)).digest("hex"), size: lstatSync(path).size, mtimeMs: lstatSync(path).mtimeMs });
  const inspect = () => ({ provenance: { version: 1, resultBundle: { path: resultBundle, logDigest: "fixture-log-digest" }, projectPath: join(project, "project.pbxproj"), scheme: "Example", binaryIdentity: identity,
    sourceFiles: [{ path: source, ...fingerprint(source) }], projectFiles: [{ path: join(project, "project.pbxproj"), ...fingerprint(join(project, "project.pbxproj")) }],
    appFingerprint: ["Info.plist", "DifferentExecutable", "DifferentExecutable.debug.dylib", "_CodeSignature/CodeResources"].map((name) => ({ name, ...fingerprint(join(app, name)) })) } });
  const runtime = { buildRootBase: base, inspectLiveBuildResult: inspect,
    async withLiveBuildSession(_options, operation, hooks) {
      beforeStart?.();
      await hooks.beforeStart();
      calls.push("engine-start");
      return operation({ liveSession: { started: true, host: "private-test-host" }, async registerLiveBuildResult(options) {
        calls.push({ registration: options.expectedProvenance });
        afterRegister?.();
        return registrationResult;
      } });
    },
    async runCommand(command, args, options) {
      calls.push({ command, args: [...args], timeoutMs: options.timeoutMs });
      if (command === "/usr/bin/codesign") return { code: 0, stderr: args.includes("-d") ? "TeamIdentifier=FIXTURETEAM\n" : "" };
      if (command === "xcrun" && args[0] === "xcresulttool") return { code: 0, stdout: JSON.stringify(summary) };
      if (command === "xcrun" && args[0] === "dyld_info") {
        options.onLine(`${args.at(-1)} [arm64]:`); options.onLine("    -imports:"); return { code: 0 };
      }
      if (command === "/usr/bin/ditto") {
        beforePackage?.(args);
        if (args[0] === app) cpSync(app, args[1], { recursive: true });
        else writeFileSync(args.at(-1), "synthetic install payload");
        return { code: 0 };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  };
  return { directory, root, app, source, project, resultBundle, identity, build, summary, calls, publications, runtime, inspect,
    options: { runtime, save(value) { current = structuredClone(value); publications.push(structuredClone(value)); }, readCurrent: () => structuredClone(current) },
    current() { return current; }, mutateCurrent(fn) { fn(current); },
    afterRegister(fn) { afterRegister = fn; }, beforePackage(fn) { beforePackage = fn; }, beforeStart(fn) { beforeStart = fn; },
    result(value) { registrationResult = value; }, cleanup() { rmSync(directory, { recursive: true, force: true }); } };
}

test("a preserved signed Debug app resumes registration and packaging without a new compile or build number", async () => {
  const f = fixture();
  try {
    await resumeDeviceBuild(f.build, f.options);
    assert.equal(f.build.state, "ready"); assert.equal(f.build.app.build, "28");
    assert.equal(f.build.liveReload.compilerReady, true); assert.equal(f.build.liveReload.capturedCompilations, 89);
    assert.equal(f.build.liveReload.recovery.phase, "packaged");
    assert.equal(f.publications[0].state, "preparing"); assert.equal(f.publications[0].liveReload.compilerReady, false);
    assert.ok(existsSync(f.build.artifacts.ipaPath));
    assert.equal(f.calls.some((call) => call.command === "xcodebuild"), false);
    assert.ok(f.calls.filter((call) => call.command).every((call) => call.timeoutMs > 0 && call.timeoutMs <= 120_000));
    const registration = f.calls.find((call) => call.registration);
    assert.deepEqual(registration.registration, f.inspect().provenance);
    assert.ok(f.calls.some((call) => call.command === "xcrun" && call.args.at(-1).endsWith("DifferentExecutable.debug.dylib")));
  } finally { f.cleanup(); }
});

test("signed Debug install generation uses a generic destination even when provisioning is allowed", () => {
  assert.equal(signedDebugBuildDestination({ allowProvisioningUpdates: true }), "generic/platform=iOS");
  assert.equal(signedDebugBuildDestination({ allowProvisioningUpdates: false }), "generic/platform=iOS");
});

test("a failed precompilation attempt cannot be promoted from an unsuccessful result bundle", async () => {
  const f = fixture();
  try {
    f.summary.status = "failed"; f.summary.errorCount = 1;
    await assert.rejects(resumeDeviceBuild(f.build, f.options));
    assert.equal(f.calls.includes("engine-start"), false); assert.equal(f.build.liveReload.compilerReady, false);
    assert.equal(f.calls.some((call) => call.registration), false);
  } finally { f.cleanup(); }
});

for (const field of ["bundle_id", "bundle_version", "build_number", "executable_uuid", "debug_dylib_uuid"]) {
  test(`resume rejects mismatching or missing preserved ${field}`, async () => {
    const f = fixture();
    try {
      f.identity[field] = field.endsWith("uuid") ? "" : "different";
      await assert.rejects(resumeDeviceBuild(f.build, f.options));
      assert.equal(f.calls.includes("engine-start"), false); assert.equal(f.build.state, "failed");
    } finally { f.cleanup(); }
  });
}

test("source edits newer than the preserved build prevent legacy checkpoint adoption", async () => {
  const f = fixture();
  try {
    utimesSync(f.source, Date.now() / 1000, Date.now() / 1000);
    await assert.rejects(resumeDeviceBuild(f.build, f.options));
    assert.equal(f.calls.includes("engine-start"), false);
  } finally { f.cleanup(); }
});

test("a newly replaced signed app cannot be adopted as the old result bundle's product", async () => {
  const f = fixture();
  try {
    utimesSync(join(f.app, "DifferentExecutable"), Date.now() / 1000, Date.now() / 1000);
    await assert.rejects(resumeDeviceBuild(f.build, f.options));
    assert.equal(f.calls.includes("engine-start"), false);
  } finally { f.cleanup(); }
});

test("a packaged checkpoint can recover a later delivery failure without changing the build identity", async () => {
  const f = fixture();
  try {
    await resumeDeviceBuild(f.build, f.options);
    const previousIpa = f.build.artifacts.ipaPath;
    const previousProvenance = structuredClone(f.build.liveReload.recovery.provenance);
    f.build.state = "failed"; f.mutateCurrent((b) => { b.state = "failed"; });
    await resumeDeviceBuild(f.build, f.options);
    assert.equal(f.build.state, "ready"); assert.equal(f.build.artifacts.ipaPath, previousIpa);
    assert.equal(f.build.app.build, "28"); assert.deepEqual(f.build.liveReload.recovery.provenance, previousProvenance);
    assert.equal(f.calls.some((call) => call.command === "xcodebuild"), false);
  } finally { f.cleanup(); }
});

test("an escaping result path or symlinked app is never registered or packaged", async () => {
  for (const mutation of ["path", "symlink"]) {
    const f = fixture();
    try {
      if (mutation === "path") { f.build.artifacts.resultBundlePath = join(f.directory, "outside.xcresult"); f.mutateCurrent((b) => { b.artifacts.resultBundlePath = f.build.artifacts.resultBundlePath; }); }
      else { const moved = join(f.root, "Elsewhere.app"); cpSync(f.app, moved, { recursive: true }); rmSync(f.app, { recursive: true }); symlinkSync(moved, f.app); }
      await assert.rejects(resumeDeviceBuild(f.build, f.options));
      assert.equal(f.calls.includes("engine-start"), false);
    } finally { f.cleanup(); }
  }
});

test("a concurrent state change while waiting for lifecycle admission is preserved", async () => {
  const f = fixture();
  try {
    f.beforeStart(() => f.mutateCurrent((b) => { b.state = "ready"; }));
    await assert.rejects(resumeDeviceBuild(f.build, f.options), (error) => error.code === "BUILD_RESUME_STATE_CHANGED" && error.preserveBuildState === true);
    assert.equal(f.current().state, "ready"); assert.equal(f.publications.length, 0); assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});

test("cancellation and unverifiable worker ownership reject recovery without state replacement", async () => {
  for (const kind of ["cancel", "worker"]) {
    const f = fixture();
    try {
      writeFileSync(kind === "cancel" ? f.build.control.cancelPath : `${f.build.control.cancelPath}.worker.json`, kind === "cancel" ? "cancelled" : "{}");
      await assert.rejects(resumeDeviceBuild(f.build, f.options));
      assert.equal(f.publications.length, 0); assert.equal(f.calls.includes("engine-start"), false);
    } finally { f.cleanup(); }
  }
});

test("registration failure retains the signed app and checkpoint without publishing compiler readiness", async () => {
  const f = fixture();
  try {
    f.result({ registered: 0 });
    await assert.rejects(resumeDeviceBuild(f.build, f.options));
    assert.equal(f.build.state, "failed"); assert.equal(f.build.liveReload.compilerReady, false);
    assert.equal(f.build.liveReload.recovery.phase, "registration");
    assert.ok(existsSync(f.app)); assert.equal(f.calls.some((call) => call.command === "/usr/bin/ditto"), false);
  } finally { f.cleanup(); }
});

test("a persisted checkpoint refuses a different executable UUID even under the same app version", async () => {
  const f = fixture();
  try {
    f.result({ registered: 0 });
    await assert.rejects(resumeDeviceBuild(f.build, f.options));
    f.result({ registered: 89 });
    f.identity.executable_uuid = "33333333-3333-3333-3333-333333333333";
    const starts = f.calls.filter((call) => call === "engine-start").length;
    await assert.rejects(resumeDeviceBuild(f.build, f.options));
    assert.equal(f.calls.filter((call) => call === "engine-start").length, starts);
    assert.equal(f.build.liveReload.compilerReady, false);
  } finally { f.cleanup(); }
});

test("source changes during registration or packaging never publish a ready install", async () => {
  for (const phase of ["register", "package"]) {
    const f = fixture();
    try {
      const change = () => writeFileSync(f.source, "struct Changed {}");
      if (phase === "register") f.afterRegister(change);
      else f.beforePackage(change);
      await assert.rejects(resumeDeviceBuild(f.build, f.options));
      assert.equal(f.build.state, "failed"); assert.equal(f.publications.some((b) => b.state === "ready"), false);
    } finally { f.cleanup(); }
  }
});

test("a copied app whose signed bytes differ is rejected before archive publication", async () => {
  const f = fixture();
  try {
    const run = f.runtime.runCommand;
    f.runtime.runCommand = async (command, args, options) => {
      const result = await run(command, args, options);
      if (command === "/usr/bin/ditto" && args[0] === f.app) writeFileSync(join(args[1], "DifferentExecutable"), "changed bytes");
      return result;
    };
    await assert.rejects(resumeDeviceBuild(f.build, f.options));
    assert.equal(f.calls.some((call) => call.command === "/usr/bin/ditto" && call.args[0] === "-c"), false);
    assert.equal(f.publications.some((b) => b.state === "ready"), false);
  } finally { f.cleanup(); }
});

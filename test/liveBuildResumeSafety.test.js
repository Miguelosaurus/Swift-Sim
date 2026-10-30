import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resumeDeviceBuild } from "../mac-helper/src/deviceBuilderCore.js";
import { inspectLiveBuildResult } from "../mac-helper/src/liveReload.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-resume-safety-"));
  const base = join(directory, "device-builds");
  const root = join(base, "preserved");
  const app = join(root, "DerivedData", "Build", "Products", "Debug-iphoneos", "Example.app");
  const resultBundle = join(root, "Example.xcresult");
  const project = join(directory, "Example.xcodeproj");
  const source = join(directory, "Card.swift");
  const lock = join(project, "project.xcworkspace", "xcshareddata", "swiftpm", "Package.resolved");
  const stamp = 1_700_000_000_000;
  for (const path of [app, resultBundle, dirname(lock), join(root, "export")]) mkdirSync(path, { recursive: true });
  for (const [path, bytes] of [[source, "struct Card {}"], [lock, '{"pin":"original"}'], [join(project, "project.pbxproj"), "approved Debug linker"],
    ...["Info.plist", "Example", "Example.debug.dylib", "_CodeSignature/CodeResources"].map((name) => [join(app, name), name])]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes); utimesSync(path, stamp / 1000 - 5, stamp / 1000 - 5);
  }
  const identity = { bundle_id: "com.example.fixture", bundle_version: "1.0", build_number: "28", executable_uuid: "11111111-1111-1111-1111-111111111111", debug_dylib_uuid: "22222222-2222-2222-2222-222222222222" };
  const build = { id: "preserved", state: "failed", project, scheme: "Example", configuration: "Debug", app: { bundleIdentifier: identity.bundle_id, version: "1.0", build: "28", teamID: "FIXTURE" }, liveReload: { eligible: true, compilerReady: false }, logs: [], control: { cancelPath: join(root, ".cancelled") }, artifacts: { root, exportPath: join(root, "export"), resultBundlePath: resultBundle } };
  const summary = { status: "succeeded", errorCount: 0, actionTitle: 'Build "Example"', startTime: stamp / 1000 - 10, endTime: stamp / 1000, destination: { platform: "iOS" } };
  let current = structuredClone(build); let onAdmit = () => {}; let onRegister = () => {};
  const events = []; const saved = [];
  const fingerprint = (path) => ({ hash: createHash("sha256").update(readFileSync(path)).digest("hex"), size: lstatSync(path).size, mtimeMs: lstatSync(path).mtimeMs });
  const inspect = () => ({ provenance: { version: 1, binaryIdentity: identity, sourceFiles: [{ path: source, ...fingerprint(source) }], projectFiles: [lock, join(project, "project.pbxproj")].map((path) => ({ path, ...fingerprint(path) })), appFingerprint: ["Info.plist", "Example", "Example.debug.dylib", "_CodeSignature/CodeResources"].map((name) => ({ name, ...fingerprint(join(app, name)) })) } });
  const runtime = { buildRootBase: base, inspectLiveBuildResult: inspect,
    async withLiveBuildSession(_input, operation, hooks) { onAdmit(); await hooks.beforeStart(); events.push("engine"); return operation({ liveSession: { started: true, host: "fixture" }, async registerLiveBuildResult() { events.push("register"); onRegister(); return { registered: 89 }; } }); },
    async runCommand(command, args, options) {
      if (command === "/usr/bin/codesign") return { code: 0, stderr: args.includes("-d") ? "TeamIdentifier=FIXTURE\n" : "" };
      if (command === "xcrun" && args[0] === "xcresulttool") return { code: 0, stdout: JSON.stringify(summary) };
      if (command === "xcrun" && args[0] === "dyld_info") { options.onLine(`${args.at(-1)} [arm64]:`); options.onLine("    -imports:"); return { code: 0 }; }
      throw new Error(`Unexpected verification command: ${command}`);
    },
    async packageApp() { events.push("package"); throw new Error("Must not reach packaging"); },
  };
  return { directory, project, resultBundle, source, lock, app, build, events, saved,
    options: { runtime, save(value) { current = structuredClone(value); saved.push(structuredClone(value)); }, readCurrent: () => current ? structuredClone(current) : null },
    onAdmit(fn) { onAdmit = fn; }, onRegister(fn) { onRegister = fn; }, deleteCurrent() { current = null; }, mutateCurrent(fn) { fn(current); }, current: () => current,
    cleanup() { rmSync(directory, { recursive: true, force: true }); } };
}

test("deletion after compiler acknowledgement cannot recreate the build or publish its preserved app", async () => {
  const f = fixture();
  try {
    f.onRegister(() => f.deleteCurrent());
    await assert.rejects(resumeDeviceBuild(f.build, f.options), (error) => error.code === "BUILD_RESUME_STATE_CHANGED" && error.preserveBuildState === true);
    assert.equal(f.current(), null);
    assert.deepEqual(f.events, ["engine", "register"]);
    assert.equal(f.saved.some((record) => record.state === "ready" || record.state === "failed"), false);
  } finally { f.cleanup(); }
});

test("a dependency pin changed during registration is detected even when its timestamp is backdated", async () => {
  const f = fixture();
  try {
    const oldTime = lstatSync(f.lock).mtimeMs / 1000;
    f.onRegister(() => { writeFileSync(f.lock, '{"pin":"replaced"}'); utimesSync(f.lock, oldTime, oldTime); });
    await assert.rejects(resumeDeviceBuild(f.build, f.options), { code: "LIVE_BUILD_RESUME_SOURCE_CHANGED" });
    assert.equal(f.events.includes("package"), false);
    assert.equal(f.saved.some((record) => record.state === "ready"), false);
  } finally { f.cleanup(); }
});

test("a signing identity substitution while waiting for admission preserves the new owner's build", async () => {
  const f = fixture();
  try {
    f.onAdmit(() => f.mutateCurrent((record) => { record.app.teamID = "OTHERTEAM"; }));
    await assert.rejects(resumeDeviceBuild(f.build, f.options), (error) => error.code === "BUILD_RESUME_STATE_CHANGED" && error.preserveBuildState === true);
    assert.equal(f.current().app.teamID, "OTHERTEAM");
    assert.deepEqual(f.events, []); assert.equal(f.saved.length, 0);
  } finally { f.cleanup(); }
});

test("capture records the actual project lockfile and binds a qualified source alias to its canonical target", () => {
  const f = fixture();
  try {
    const alias = join(dirname(f.source), "Alias.swift");
    const second = join(dirname(f.source), "Second.swift"); writeFileSync(second, "struct Second {}");
    symlinkSync(f.source, alias);
    const options = { resultBundle: f.resultBundle, projectPath: join(f.project, "project.pbxproj"), scheme: "Example", runtime: { buildLog: { emittedOutput: `/tool/swift-frontend -frontend -c ${alias} -module-name Example -sdk /sdk -target arm64-apple-ios16.0 -file-compilation-dir ${f.directory}` } } };
    const before = inspectLiveBuildResult(options).provenance;
    assert.equal(before.projectFiles.some((file) => file.path === f.lock), true);
    const originalAlias = before.sourceFiles.find((file) => file.path === alias);
    assert.ok(originalAlias);
    unlinkSync(alias); symlinkSync(second, alias);
    const after = inspectLiveBuildResult(options).provenance.sourceFiles.find((file) => file.path === alias);
    assert.notDeepEqual(after, originalAlias);
  } finally { f.cleanup(); }
});

test("a source alias changed after the build cannot inherit an older target's timestamp", async () => {
  const f = fixture();
  try {
    const inspect = f.options.runtime.inspectLiveBuildResult;
    f.options.runtime.inspectLiveBuildResult = () => {
      const captured = inspect();
      captured.provenance.sourceFiles[0].linkMtimeMs = Date.now();
      return captured;
    };
    await assert.rejects(resumeDeviceBuild(f.build, f.options), { code: "LIVE_BUILD_RESUME_SOURCE_CHANGED" });
    assert.deepEqual(f.events, []);
    assert.equal(f.saved.some((record) => record.state === "ready"), false);
  } finally { f.cleanup(); }
});

test("preserved build recovery cannot revive revoked install capability or overwrite an active renewal", async () => {
  for (const change of [{ tokenExpiredAt: new Date().toISOString() }, { pendingRenewal: { id: "another-owner" } }]) {
    const f = fixture();
    try {
      Object.assign(f.build, change);
      await assert.rejects(resumeDeviceBuild(f.build, f.options), { code: "LIVE_BUILD_RESUME_INELIGIBLE" });
      assert.deepEqual(f.events, []);
      assert.equal(f.saved.length, 0);
    } finally { f.cleanup(); }
  }
});

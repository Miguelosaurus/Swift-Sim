import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareStatefulBuild, inspectStatefulBuild, statefulBodyIndex } from "../mac-helper/src/statefulBuild.js";
import { classifyPrivateAdditiveEditSet } from "../mac-helper/src/liveReload.js";

import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
const fixtureFiles = new NodeAtomicFileStore();

const hash = value => createHash("sha256").update(value).digest("hex");
function fixture(t, { sourceText = 'struct Screen: View { var body: some View { Text("before") } }', constants = [] } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "swift-sim-stateful-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "App.xcodeproj"); mkdirSync(project);
  const source = join(root, "Screen.swift"); writeFileSync(source, sourceText);
  const compilerPath = join(root, "tool", "bin", "swiftc");
  mkdirSync(join(root, "tool", "bin"), { recursive: true });
  mkdirSync(join(root, "tool", "share", "swift"), { recursive: true });
  writeFileSync(join(root, "tool", "share", "swift", "features.json"), JSON.stringify({ features: [{ name: "emit-abi-descriptor" }] }));
  writeFileSync(compilerPath, '#!/usr/bin/python3\nimport os,sys,json\nif "-typecheck" in sys.argv: sys.exit(int(os.environ.get("TEST_OLD_SDK", "0")))\nwith open(os.environ["TEST_ARGS_PATH"], "w") as f: json.dump(sys.argv[1:],f)\n', { mode: 0o700 });
  const compiler = { instrument({ files }) { return { resourceDigest: "a".repeat(64), files: files.map(file => ({ ...file, source: file.source.replace('"before"', '"overlay"'), owners: ["Screen"], constants })) }; } };
  const build = prepareStatefulBuild({ projectPath: project, root: join(root, "build"), moduleName: "App", compilerPath, compiler });
  const run = (args, env = {}) => {
    const output = join(root, "args.json");
    const result = spawnSync(build.wrapperPath, args, { env: { ...process.env, TEST_ARGS_PATH: output, ...env }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(fixtureFiles.readTextSync(output));
  };
  return { root, source, build, run };
}

test("compiler overlay is Debug and selected-module only, and original sources stay unchanged", t => {
  const f = fixture(t); const original = fixtureFiles.readTextSync(f.source, "utf8");
  for (const args of [["--version"], ["-module-name", "Dependency", "-DDEBUG"], ["-module-name", "App", "-O"]]) assert.deepEqual(f.run(args), args);
  const args = ["-module-name", "App", "-D", "DEBUG"];
  assert.deepEqual(f.run(args), [...args, "-vfsoverlay", f.build.overlayPath]);
  assert.equal(fixtureFiles.readTextSync(f.source, "utf8"), original);
  const capture = inspectStatefulBuild(f.build.overlayPath, new Set([f.source]));
  assert.deepEqual(capture.index.bodies, { [f.source]: ["Screen"] });
  assert.deepEqual(statefulBodyIndex(capture.index, "App").bodies, capture.index.bodies);
  writeFileSync(f.source, original.replace("before", "after"));
  assert.doesNotThrow(() => statefulBodyIndex(capture.index, "App"));
  assert.throws(() => inspectStatefulBuild(f.build.overlayPath, new Set([f.source])), { code: "STATEFUL_BUILD_INVALID" });
});

test("old SDK falls back before any source is transformed and cannot claim an overlay capture", t => {
  const f = fixture(t); const args = ["-module-name", "App", "-DDEBUG"];
  assert.deepEqual(f.run(args, { TEST_OLD_SDK: "1" }), args);
  assert.deepEqual(f.run(args), args, "a build cannot mix its ABI after probing a different architecture");
  assert.throws(() => inspectStatefulBuild(f.build.overlayPath, new Set([f.source])), { code: "STATEFUL_BUILD_INVALID" });
});

test("response files work and transformed-input or immutable-index corruption fails closed", t => {
  const f = fixture(t); const response = join(f.root, "response.rsp"); writeFileSync(response, '-module-name App -D DEBUG');
  assert.deepEqual(f.run(["@" + response]), ["@" + response, "-vfsoverlay", f.build.overlayPath]);
  const capture = inspectStatefulBuild(f.build.overlayPath, new Set([f.source]));
  assert.throws(() => statefulBodyIndex({ ...capture.index, manifestDigest: "b".repeat(64) }, "App"), { code: "STATEFUL_BUILD_INVALID" });
  assert.throws(() => statefulBodyIndex(capture.index, "Other"), { code: "STATEFUL_BUILD_INVALID" });
  const manifest = JSON.parse(fixtureFiles.readTextSync(f.build.manifestPath));
  writeFileSync(manifest.files[0].generatedPath, "changed generated source", { mode: 0o600 });
  assert.throws(() => statefulBodyIndex(capture.index, "App"), { code: "STATEFUL_BUILD_INVALID" });
  assert.throws(() => inspectStatefulBuild(f.build.overlayPath, new Set([f.source])), { code: "STATEFUL_BUILD_INVALID" });
  assert.equal(hash(fixtureFiles.readTextSync(f.build.manifestPath)), capture.index.manifestDigest);
});

test("the real integrated driver retains ABI descriptor output with the private frontend", { skip: process.platform !== "darwin" }, t => {
  const found = spawnSync("/usr/bin/xcrun", ["--find", "swiftc"], { encoding: "utf8" });
  if (found.status !== 0) { t.skip("Xcode compiler unavailable"); return; }
  const f = fixture(t); const compilerPath = found.stdout.trim();
  const build = prepareStatefulBuild({ projectPath: join(f.root, "App.xcodeproj"), root: join(f.root, "real-build"),
    moduleName: "App", compilerPath, compiler: { instrument: ({ files }) => ({ resourceDigest: "a".repeat(64), files: files.map(file => ({ ...file, owners: ["Screen"] })) }) } });
  const result = spawnSync(compilerPath, ["-driver-print-jobs", "-emit-module", f.source, "-module-name", "FeatureProbe",
    "-o", join(f.root, "FeatureProbe.swiftmodule"), "-driver-use-frontend-path", build.wrapperPath,
    "-resource-dir", build.resourceDirectory], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /-emit-abi-descriptor-path/);
  const manifest = JSON.parse(fixtureFiles.readTextSync(build.manifestPath));
  assert.equal(manifest.featuresDigest, hash(fixtureFiles.readTextSync(manifest.featuresPath)));
});


test("constant-only sources are captured and constant index is bound to the manifest", t => {
  const f = fixture(t, { sourceText: "struct Theme { static let accent: Int = 1 }", constants: ["Theme.accent"] });
  f.run(["-module-name", "App", "-DDEBUG"]);
  const manifest = JSON.parse(fixtureFiles.readTextSync(f.build.manifestPath));
  assert.deepEqual(manifest.files[0].constants, ["Theme.accent"]);
  const capture = inspectStatefulBuild(f.build.overlayPath, new Set([f.source]));
  assert.deepEqual(capture.index.constants, { [f.source]: ["Theme.accent"] });
  assert.deepEqual(statefulBodyIndex(capture.index, "App").constants, capture.index.constants);
  assert.throws(() => statefulBodyIndex({ ...capture.index, constants: { [f.source]: ["Theme.other"] } }, "App"), { code: "STATEFUL_BUILD_INVALID" });
  manifest.files[0].constants = ["invalid"];
  const bytes = JSON.stringify(manifest); writeFileSync(f.build.manifestPath, bytes);
  const usagePath = join(f.root, "build", "stateful-sources", "usage.json");
  const usage = JSON.parse(fixtureFiles.readTextSync(usagePath)); usage.manifestDigest = hash(bytes);
  writeFileSync(usagePath, JSON.stringify(usage));
  assert.throws(() => inspectStatefulBuild(f.build.overlayPath, new Set([f.source])), { code: "STATEFUL_BUILD_INVALID" });
});


test("constant routing uses the captured index and requires complete coverage", t => {
  const before = "struct Theme { static let accent: Int = 1 }";
  const f = fixture(t, { sourceText: before, constants: ["Theme.accent"] });
  f.run(["-module-name", "App", "-DDEBUG"]);
  const capture = inspectStatefulBuild(f.build.overlayPath, new Set([f.source]));
  const manifest = { compilerContextProtocol: 2, stateful: capture.index,
    binaryIdentity: { bundle_id: "dev.fixture.app", bundle_version: "1", build_number: "1",
      executable_uuid: "11111111-1111-1111-1111-111111111111", debug_dylib_uuid: "22222222-2222-2222-2222-222222222222" },
    sourceBaselines: { [f.source]: hash(before) }, compilations: [{ moduleName: "App", sources: [f.source], workingDirectory: f.root, compilerArguments: [] }] };
  const compiler = { generate(input) {
    assert.deepEqual(input.statefulConstants, capture.index.constants);
    if (input.files[0].after.includes("other")) throw Object.assign(new Error("unsupported"), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
    return { constantProtocol: 1, additiveProtocol: 0 };
  } };
  const file = { path: f.source, kind: "swift", status: "modified", beforeSource: before, afterSource: before.replace("= 1", "= 2") };
  const result = classifyPrivateAdditiveEditSet([file], { manifest, compiler });
  assert.equal(result.route, "hot-reload"); assert.equal(result.reasonCode, "IMPLEMENTATION_ONLY"); assert.equal(result.requiresCompleteCoverage, true);
  assert.equal(classifyPrivateAdditiveEditSet([{ ...file, afterSource: before.replace("accent", "other") }], { manifest, compiler }), null);
});


test("overlay instrumentation sees shadowing declarations in otherwise ordinary Swift files", t => {
  const f = fixture(t, { sourceText: "struct Theme { static let accent: Color = .blue }" });
  const shadow = join(f.root, "Shadow.swift"); writeFileSync(shadow, "struct Color {}\n");
  let scanned;
  prepareStatefulBuild({ projectPath: join(f.root, "App.xcodeproj"), root: join(f.root, "shadow-build"), moduleName: "App",
    compilerPath: join(f.root, "tool", "bin", "swiftc"), compiler: { instrument({ files }) { scanned = files; return { files: [] }; } } });
  assert(scanned.some(file => file.path === shadow), "shadowing declarations must be included in the generator's module-wide policy");
});

test("an incomplete module inventory keeps view instrumentation but disables constant lowering", t => {
  const f = fixture(t);
  writeFileSync(join(f.root, "Huge.swift"), "// " + "x".repeat(1024 * 1024 + 1));
  writeFileSync(join(f.root, "Plain.swift"), "struct Model {}");
  let received;
  const build = prepareStatefulBuild({ projectPath: join(f.root, "App.xcodeproj"), root: join(f.root, "incomplete-build"),
    moduleName: "App", compilerPath: join(f.root, "tool", "bin", "swiftc"), compiler: { instrument(input) {
      received = input;
      return { resourceDigest: "a".repeat(64), files: input.files.map(file => ({ ...file, owners: ["Screen"] })) };
    } } });
  assert.ok(build);
  assert.equal(received.lowerConstants, false);
  assert.deepEqual(received.files.map(file => file.path), [f.source]);
});

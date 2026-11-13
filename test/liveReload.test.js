import { testCompiler } from "./testCompiler.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySwiftSource as original_classifySwiftSource,
  classifyEditSet as original_classifyEditSet,
  classifyLiveChanges as original_classifyLiveChanges, LIVE_REASON_CODES, inspectLiveReloadWarm } from "../mac-helper/src/liveReload.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("routes SwiftUI body edits through hot reload", () => {
  const before = `
    struct Card: View {
      let title: String
      var body: some View { Text(title).foregroundStyle(.blue) }
    }
  `;
  const after = `
    struct Card: View {
      let title: String
      var body: some View { Text(title).foregroundStyle(.purple).padding() }
    }
  `;
  assert.equal(classifySwiftSource(before, after).route, "hot-reload");
});

test("routes function implementation edits through hot reload", () => {
  const before = `func greeting(name: String) -> String { "Hi \\(name)" }`;
  const after = `func greeting(name: String) -> String { "Welcome, \\(name)!" }`;
  assert.equal(classifySwiftSource(before, after).route, "hot-reload");
});

test("requires a rebuild when stored state changes", () => {
  const before = `struct Model { var count: Int = 0 }`;
  const after = `struct Model { var count: Int = 0; var name = "Swift Sim" }`;
  assert.equal(classifySwiftSource(before, after).route, "rebuild-required");
});

test("requires a rebuild when a function signature changes", () => {
  const before = `func greeting(name: String) -> String { name }`;
  const after = `func greeting(name: String, excited: Bool) -> String { name }`;
  assert.equal(classifySwiftSource(before, after).route, "rebuild-required");
});

test("requires a rebuild when imports change", () => {
  const before = `import SwiftUI\nstruct Card: View { var body: some View { Text("A") } }`;
  const after = `import SwiftUI\nimport MapKit\nstruct Card: View { var body: some View { Text("A") } }`;
  assert.equal(classifySwiftSource(before, after).route, "rebuild-required");
});

test("requires a rebuild when only a stored-property initializer changes", () => {
  const before = `struct Card { var title = "Old"; func value() -> String { title } }`;
  const after = `struct Card { var title = "New"; func value() -> String { title } }`;
  const result = classifySwiftSource(before, after);
  assert.equal(result.route, "rebuild-required");
  assert.equal(result.reasonCode, LIVE_REASON_CODES.STORED_PROPERTY_CHANGED);
});

test("canonical edit sets fail closed for non-Swift and file lifecycle changes", () => {
  const nonSwift = classifyEditSet({ files: [{ path: "Assets.xcassets", kind: "resource", status: "modified" }] });
  assert.equal(nonSwift.route, "rebuild-required");
  assert.equal(nonSwift.reasonCode, LIVE_REASON_CODES.NON_SWIFT_FILE);

  const added = classifyEditSet({ files: [{ path: "New.swift", kind: "swift", status: "added" }] });
  assert.equal(added.route, "rebuild-required");
  assert.equal(added.reasonCode, LIVE_REASON_CODES.FILE_ADDED_OR_REMOVED);
});

test("canonical edit sets identify mixed edits as one rebuild operation", () => {
  const result = classifyEditSet({ files: [
    {
      path: "Card.swift",
      kind: "swift",
      status: "modified",
      beforeSource: `struct Card: View { var body: some View { Text("A") } }`,
      afterSource: `struct Card: View { var body: some View { Text("B") } }` },
    { path: "Info.plist", kind: "resource", status: "modified" },
  ] });
  assert.equal(result.route, "rebuild-required");
  assert.equal(result.reasonCode, LIVE_REASON_CODES.MIXED_EDIT_SET);
  assert.equal(result.changes.length, 2);
});

test("valid warm readiness uses only the engine status seam", async () => {
  const descriptor = { schemaVersion: 1, protocolVersion: "1", generation: 1, project: { path: "/tmp/Example.xcodeproj/project.pbxproj", root: "/tmp", scheme: "Example", availableSchemes: ["Example"], packageConfigured: true, interposableConfigured: true }, liveHost: "100.64.0.10", tailnet: { privateForwardConfigured: true, userspace: true }, engine: { sessionNonce: "engine-one", version: "0.4.0" }, compilerCapture: { path: "/tmp/compilations.json", missing: true }, configurationFingerprints: {} };
  let statusCalls = 0; let deepCalls = 0; let lockCalls = 0; let lockHeld = false;
  const result = await inspectLiveReloadWarm({ project: descriptor.project.path, scheme: "Example", runtime: {
    lock: async (operation) => { lockCalls += 1; lockHeld = true; try { return await operation(); } finally { lockHeld = false; } },
    readDescriptor: () => ({ valid: true, descriptor }),
    engineControl: async () => { assert.equal(lockHeld, true); statusCalls += 1; return { success: true, data: { watching_directories: ["/tmp"], has_connected_client: true, captured_compilations: 2, injection_state: "Ready" } }; },
    deepInspect: async () => { deepCalls += 1; return { ready: false }; } } });
  assert.equal(result.ready, true); assert.equal(result.readinessMode, "warm"); assert.equal(statusCalls, 1); assert.equal(deepCalls, 0); assert.equal(lockCalls, 1); assert.equal(lockHeld, false);
});



test("ignores declaration words inside comments and strings", () => {
  const before = `func message() -> String { "add var later" }`;
  const after = `func message() -> String { "remove class later" } // let fake = true`;
  assert.equal(classifySwiftSource(before, after).route, "hot-reload");
});

test("classifies multiple implementation-only files as one hot reload", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-classifier-"));
  const paths = ["Card", "Header"].map((name) => ({
    before: join(directory, `${name}-before.swift`),
    after: join(directory, `${name}-after.swift`) }));
  writeFileSync(paths[0].before, `struct Card: View { var body: some View { Text("A") } }`);
  writeFileSync(paths[0].after, `struct Card: View { var body: some View { Text("B") } }`);
  writeFileSync(paths[1].before, `func title() -> String { "Old" }`);
  writeFileSync(paths[1].after, `func title() -> String { "New" }`);
  const result = classifyLiveChanges({
    beforePaths: paths.map((path) => path.before),
    afterPaths: paths.map((path) => path.after) });
  assert.equal(result.route, "hot-reload");
  assert.equal(result.changes.length, 2);
});

test("makes a multi-file edit rebuild when any file changes structure", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-classifier-"));
  const beforePaths = [join(directory, "One-before.swift"), join(directory, "Two-before.swift")];
  const afterPaths = [join(directory, "One-after.swift"), join(directory, "Two-after.swift")];
  writeFileSync(beforePaths[0], `func title() -> String { "Old" }`);
  writeFileSync(afterPaths[0], `func title() -> String { "New" }`);
  writeFileSync(beforePaths[1], `struct State { var count = 0 }`);
  writeFileSync(afterPaths[1], `struct State { var count = 0; var name = "New" }`);
  const result = classifyLiveChanges({ beforePaths, afterPaths });
  assert.equal(result.route, "rebuild-required");
  assert.equal(result.hotReloadable, false);
});

const classifySwiftSource = (before, after, paths = {}) => original_classifySwiftSource(before, after, paths, { compiler: testCompiler });
const classifyEditSet = (options = {}) => original_classifyEditSet({ ...options, compiler: testCompiler });
const classifyLiveChanges = (options = {}) => original_classifyLiveChanges({ ...options, compiler: testCompiler });

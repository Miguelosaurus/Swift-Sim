import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySwiftSource,
  classifyEditSet,
  classifyLiveChanges,
  generateDynamicReplacementSource,
  LIVE_REASON_CODES,
  routeLiveEditSet,
  injectLiveSource,
} from "../mac-helper/src/liveReload.js";
import { mkdtempSync, writeFileSync } from "node:fs";
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
      afterSource: `struct Card: View { var body: some View { Text("B") } }`,
    },
    { path: "Info.plist", kind: "resource", status: "modified" },
  ] });
  assert.equal(result.route, "rebuild-required");
  assert.equal(result.reasonCode, LIVE_REASON_CODES.MIXED_EDIT_SET);
  assert.equal(result.changes.length, 2);
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
    after: join(directory, `${name}-after.swift`),
  }));
  writeFileSync(paths[0].before, `struct Card: View { var body: some View { Text("A") } }`);
  writeFileSync(paths[0].after, `struct Card: View { var body: some View { Text("B") } }`);
  writeFileSync(paths[1].before, `func title() -> String { "Old" }`);
  writeFileSync(paths[1].after, `func title() -> String { "New" }`);
  const result = classifyLiveChanges({
    beforePaths: paths.map((path) => path.before),
    afterPaths: paths.map((path) => path.after),
  });
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

test("generates a private-source dynamic replacement for SwiftUI bodies", () => {
  const generated = generateDynamicReplacementSource({
    source: `
      import SwiftUI
      struct Card: View {
        @State private var count = 0
        var body: some View { Text("Count: \\(count)").padding() }
      }
    `,
    sourcePath: "/tmp/Card.swift",
    moduleName: "ExampleApp",
  });
  assert.match(generated, /@_private\(sourceFile: "Card\.swift"\) import ExampleApp/);
  assert.match(generated, /extension Card/);
  assert.match(generated, /@_dynamicReplacement\(for: body\)/);
  assert.ok(generated.includes(`Text("Count: \\(count)").padding()`));
});

test("does not generate a SwiftUI replacement for non-view source", () => {
  assert.equal(generateDynamicReplacementSource({
    source: `func greeting() -> String { "Ready" }`,
    sourcePath: "/tmp/Logic.swift",
    moduleName: "ExampleApp",
  }), "");
});

test("generates qualified replacements for nested SwiftUI views", () => {
  const generated = generateDynamicReplacementSource({
    source: `
      import SwiftUI
      struct Screen: View {
        struct Row: View {
          var body: some View { Text("Row") }
        }
        var body: some View { Row() }
      }
    `,
    sourcePath: "/tmp/Screen.swift",
    moduleName: "ExampleApp",
  });
  assert.match(generated, /extension Screen\.Row/);
  assert.match(generated, /extension Screen \{/);
});

test("canonical routing returns stable phase timings through injected engine seams", async () => {
  let clock = 0;
  const result = await routeLiveEditSet({
    files: [{
      path: "Card.swift",
      kind: "swift",
      status: "modified",
      beforeSource: `struct Card: View { var body: some View { Text("A") } }`,
      afterSource: `struct Card: View { var body: some View { Text("B") } }`,
    }],
    runtime: {
      now: () => { clock += 3; return clock; },
      inspect: async () => ({ ready: true }),
      inject: async () => ({ succeeded: true, durationMs: 4, compileMs: 2, loadAckMs: 1, refreshAckMs: 1, requestID: "request-test" }),
    },
  });
  assert.equal(result.action, "hot-reload");
  assert.equal(result.reasonCode, LIVE_REASON_CODES.IMPLEMENTATION_ONLY);
  assert.equal(result.requestId, "request-test");
  assert.ok(result.timing.classificationMs >= 0);
  assert.ok(result.timing.compileMs >= 0);
  assert.ok(result.timing.loadAckMs >= 0);
  assert.ok(result.timing.refreshAckMs >= 0);
  assert.ok(result.timing.totalMs >= result.timing.classificationMs);
});

test("live injection reports compile, load, and refresh phases through injected seams", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-injection-"));
  const sourcePath = join(directory, "Card.swift");
  writeFileSync(sourcePath, `struct Card { var body: String { "Ready" } }`);
  let clock = 0;
  let statusCalls = 0;
  const result = await injectLiveSource(sourcePath, {
    now: () => { clock += 2; return clock; },
    compile: () => null,
    engineControl: async (request) => {
      if (request.action === "inject_source") return { success: true, data: { request_id: 7 } };
      statusCalls += 1;
      return { data: { completed_injection_request_id: 7, last_injection_succeeded: true, last_patch_report: { refreshAckMs: 3 } } };
    },
    delay: async () => {},
  });
  assert.equal(result.succeeded, true);
  assert.equal(result.requestID, 7);
  assert.ok(result.compileMs >= 0);
  assert.ok(result.loadAckMs >= 0);
  assert.equal(result.refreshAckMs, 3);
  assert.ok(result.durationMs >= result.compileMs);
  assert.equal(statusCalls, 1);
});

test("a successful engine response with zero dynamic replacements is not a live success", async () => {
  const result = await routeLiveEditSet({
    files: [{
      path: "Card.swift",
      kind: "swift",
      status: "modified",
      beforeSource: `struct Card: View { var body: some View { Text("A") } }`,
      afterSource: `struct Card: View { var body: some View { Text("B") } }`,
    }],
    runtime: {
      inspect: async () => ({ ready: true }),
      inject: async () => ({ succeeded: true, report: { dynamic_replacements: 0 }, requestID: "request-zero" }),
    },
  });
  assert.equal(result.action, "hot-reload-failed");
  assert.equal(result.reasonCode, LIVE_REASON_CODES.PATCH_LOAD_FAILED);
});

test("a patch without the root refresh acknowledgement fails closed", async () => {
  const result = await routeLiveEditSet({
    files: [{
      path: "Card.swift",
      kind: "swift",
      status: "modified",
      beforeSource: `struct Card: View { var body: some View { Text("A") } }`,
      afterSource: `struct Card: View { var body: some View { Text("B") } }`,
    }],
    runtime: {
      inspect: async () => ({ ready: true }),
      inject: async () => ({ succeeded: true, report: { dynamic_replacements: 1, refresh_acknowledged: false }, requestID: "request-no-refresh" }),
    },
  });
  assert.equal(result.action, "hot-reload-failed");
  assert.equal(result.reasonCode, LIVE_REASON_CODES.REFRESH_NOT_ACKNOWLEDGED);
});

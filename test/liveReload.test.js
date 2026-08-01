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

test("routes non-body implementation edits with a before-source compile context", async () => {
  let options;
  const result = await routeLiveEditSet({
    files: [{
      path: "Logic.swift",
      kind: "swift",
      status: "modified",
      beforeSource: `func greeting() -> String { "Hi" }`,
      afterSource: `func greeting() -> String { "Welcome" }`,
    }],
    runtime: {
      inspect: async () => ({ ready: true }),
      inject: async (_sourcePath, nextOptions) => {
        options = nextOptions;
        return { succeeded: true, durationMs: 1, report: { refresh_acknowledged: true } };
      },
    },
  });
  assert.equal(result.action, "hot-reload");
  assert.equal(options.beforePath, "");
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

test("generates replacements for changed helper functions and computed views", () => {
  const before = `
    import SwiftUI
    struct Screen: View {
      var body: some View { computedSlot }
      private var computedSlot: some View { Text("old") }
      private func helper() -> String { "old" }
    }
  `;
  const after = before
    .replace('Text("old")', 'Text("new")')
    .replace('-> String { "old" }', '-> String { "new" }');
  const generated = generateDynamicReplacementSource({
    source: after,
    beforeSource: before,
    sourcePath: "/tmp/Screen.swift",
    moduleName: "ExampleApp",
  });
  assert.match(generated, /@_dynamicReplacement\(for: computedSlot\)/);
  assert.match(generated, /private var __swiftSim_computedSlot: some View \{ Text\("new"\) \}/);
  assert.match(generated, /@_dynamicReplacement\(for: helper\(\)\)/);
  assert.match(generated, /private func __swiftSim_helper\(\) -> String \{ "new" \}/);
});

test("generates labeled replacements for implementation forms outside a View body", () => {
  const before = `
    import SwiftUI
    struct Modifier: ViewModifier {
      func body(content: Content) -> some View { content.overlay(Text("old")) }
    }
    actor Worker {
      func value() -> String { "old" }
    }
    extension Worker {
      static func label(for value: String) -> String { value }
    }
    struct Wrapper<Value> {
      var wrappedValue: Value { fatalError() }
    }
  `;
  const after = before
    .replace('Text("old")', 'Text("new")')
    .replace('func value() -> String { "old" }', 'func value() -> String { "new" }')
    .replace('static func label(for value: String) -> String { value }', 'static func label(for value: String) -> String { value + "!" }')
    .replace('var wrappedValue: Value { fatalError() }', 'var wrappedValue: Value { fatalError("changed") }');
  const generated = generateDynamicReplacementSource({
    source: after,
    beforeSource: before,
    sourcePath: "/tmp/Mechanisms.swift",
    moduleName: "ExampleApp",
  });
  assert.match(generated, /@_dynamicReplacement\(for: body\(content:\)\)/);
  assert.match(generated, /@_dynamicReplacement\(for: value\(\)\)/);
  assert.match(generated, /@_dynamicReplacement\(for: label\(for:\)\)/);
  assert.match(generated, /static func __swiftSim_label\(for value: String\)/);
  assert.match(generated, /@_dynamicReplacement\(for: wrappedValue\)/);
});

test("recognizes a View body implemented in an extension", () => {
  const before = `
    import SwiftUI
    struct ExtendedScreen: View {}
    extension ExtendedScreen {
      var body: some View { Text("old") }
    }
  `;
  const after = before.replace('Text("old")', 'Text("new")');
  const generated = generateDynamicReplacementSource({
    source: after,
    beforeSource: before,
    sourcePath: "/tmp/ExtendedScreen.swift",
    moduleName: "ExampleApp",
  });
  assert.match(generated, /extension ExtendedScreen/);
  assert.match(generated, /@_dynamicReplacement\(for: body\)/);
  assert.match(generated, /Text\("new"\)/);
});

test("inlines a simple async edit into the SwiftUI body replacement", () => {
  const before = `
    import SwiftUI
    struct Screen: View {
      var body: some View { BenchmarkMarkerView(value: "baseline").task { let value = await helper(); BenchmarkMarker.emit(caseID: "baseline", value: value) } }
      private func helper() async -> String { "old" }
    }
  `;
  const after = before.replace('"old"', '"new"');
  const generated = generateDynamicReplacementSource({
    source: after,
    beforeSource: before,
    sourcePath: "/tmp/Screen.swift",
    moduleName: "ExampleApp",
  });
  assert.match(generated, /@_dynamicReplacement\(for: body\)/);
  assert.match(generated, /let value = "new"/);
  assert.doesNotMatch(generated, /@_dynamicReplacement\(for: helper\(\)\)/);
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

test("interposition may report zero dynamic replacements", async () => {
  const result = await routeLiveEditSet({
    files: [{
      path: "Logic.swift",
      kind: "swift",
      status: "modified",
      beforeSource: `func greeting() -> String { "A" }`,
      afterSource: `func greeting() -> String { "B" }`,
    }],
    runtime: {
      inspect: async () => ({ ready: true }),
      inject: async () => ({
        succeeded: true,
        mode: "interposition",
        durationMs: 1,
        report: { dynamic_replacements: 0, refresh_acknowledged: true },
      }),
    },
  });
  assert.equal(result.action, "hot-reload");
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

test("preflights every multi-file patch before loading any member", async () => {
  const loaded = [];
  const preflighted = [];
  const result = await routeLiveEditSet({
    files: [
      {
        path: "One.swift",
        kind: "swift",
        status: "modified",
        beforeSource: `func one() -> String { "A" }`,
        afterSource: `func one() -> String { "B" }`,
      },
      {
        path: "Two.swift",
        kind: "swift",
        status: "modified",
        beforeSource: `func two() -> String { "A" }`,
        afterSource: `func two() -> String { "B" }`,
      },
    ],
    runtime: {
      inspect: async () => ({ ready: true }),
      preflight: async ({ sourcePath }) => {
        preflighted.push(sourcePath);
        return { mode: "interposition", generated: null, compileMs: 4 };
      },
      inject: async (_sourcePath, options) => {
        loaded.push(options.preparedPatch);
        return { succeeded: true, mode: "interposition", report: { refresh_acknowledged: true }, durationMs: 1 };
      },
    },
  });
  assert.equal(result.action, "hot-reload");
  assert.equal(result.atomic, true);
  assert.equal(result.partialApplication, false);
  assert.equal(preflighted.length, 2);
  assert.equal(loaded.length, 2);
  assert.ok(loaded.every((value) => value?.mode === "interposition"));
});

test("marks a later multi-file load failure as partial application", async () => {
  let loads = 0;
  const result = await routeLiveEditSet({
    files: [
      {
        path: "One.swift",
        kind: "swift",
        status: "modified",
        beforeSource: `func one() -> String { "A" }`,
        afterSource: `func one() -> String { "B" }`,
      },
      {
        path: "Two.swift",
        kind: "swift",
        status: "modified",
        beforeSource: `func two() -> String { "A" }`,
        afterSource: `func two() -> String { "B" }`,
      },
    ],
    runtime: {
      inspect: async () => ({ ready: true }),
      preflight: async () => ({ mode: "interposition", generated: null, compileMs: 1 }),
      inject: async () => {
        loads += 1;
        return loads === 1
          ? { succeeded: true, mode: "interposition", report: { refresh_acknowledged: true }, durationMs: 1 }
          : { succeeded: false, mode: "interposition", error: "The live patch timed out." };
      },
    },
  });
  assert.equal(result.action, "hot-reload-failed");
  assert.equal(result.partialApplication, true);
  assert.equal(result.atomic, true);
});

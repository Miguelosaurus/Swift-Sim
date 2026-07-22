import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySwiftSource,
  classifyLiveChanges,
  generateDynamicReplacementSource,
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

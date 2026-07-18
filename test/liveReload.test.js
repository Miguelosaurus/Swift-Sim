import test from "node:test";
import assert from "node:assert/strict";
import { classifySwiftSource } from "../mac-helper/src/liveReload.js";

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

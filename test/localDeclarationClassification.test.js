import test from "node:test";
import assert from "node:assert/strict";
import { classifySwiftSource, generateDynamicReplacementSource } from "../mac-helper/src/liveReload.js";

const method = (body) => `final class Probe { func value() -> Int { ${body} } }`;

const implementationEdits = [
  ["adds a method-local constant", method("return 1"), method("let local = 1; return local")],
  ["adds a method-local mutable value", method("return 1"), method("var local = 1; local += 1; return local")],
  ["renames and changes a local binding type", method("let local = 1; return local"), method("let result: Int = 2; return result")],
  ["removes a method-local declaration", method("let local = 1; return local"), method("return 2")],
  ["adds tuple destructuring", method("return 1"), method("let (first, second) = (1, 2); return first + second")],
  ["adds an if-let binding", method("return 1"), method("if let local = Optional(2) { return local }; return 0")],
  ["adds a guard-let binding", method("return 1"), method("guard let local = Optional(2) else { return 0 }; return local")],
  ["adds nested loop locals", method("return 1"), method("var result = 0; for item in [1, 2] { let next = item + 1; result += next }; return result")],
  ["adds switch pattern bindings", method("return 1"), method("switch Optional(2) { case let .some(local): return local; case .none: return 0 }")],
  ["adds an if-case binding", method("return 1"), method("if case let .some(local) = Optional(2) { return local }; return 0")],
  ["adds locals in nested closures", method("return 1"), method("let transformed = [1, 2].map { value in let next = value + 1; return next }; return transformed.reduce(0, +)")],
  ["adds a do/catch-local error binding", method("return 1"), method("do { let local = 2; return local } catch let problem { _ = problem; return 0 }")],
  ["adds locals inside an existing getter", "struct Probe { var value: Int { get { return 1 } } }", "struct Probe { var value: Int { get { let local = 2; return local } } }"],
  ["adds locals inside an existing setter", "struct Probe { var value: Int { get { 1 } set { _ = newValue } } }", "struct Probe { var value: Int { get { 1 } set { let local = newValue + 1; _ = local } } }"],
  ["adds locals inside an existing subscript", "struct Probe { subscript(index: Int) -> Int { return index } }", "struct Probe { subscript(index: Int) -> Int { let local = index + 1; return local } }"],
  ["adds locals inside an existing initializer", "struct Probe { let value: Int; init() { self.value = 1 } }", "struct Probe { let value: Int; init() { let local = 2; self.value = local } }"],
  ["adds locals inside a top-level function", "func value() -> Int { return 1 }", "func value() -> Int { let local = 2; return local }"],
  ["adds locals inside an existing extension method", "struct Probe {}\nextension Probe { func value() -> Int { return 1 } }", "struct Probe {}\nextension Probe { func value() -> Int { let local = 2; return local } }"],
  ["ignores brace and declaration decoys in comments", method("return 1"), method("/* } class Fake { var stored = 3; /* nested } */ } */ let local = 2; return local")],
  ["ignores brace and declaration decoys in a raw string", method("return 1"), method('let text = #"{ class Fake { let field = 2 } }"#; return text.count')],
  ["ignores delimiter decoys in a multiline string", method("return 1"), method('\nlet text = """\n} ] ) struct Fake { let field: Int\n"""\nreturn text.count\n')],
];

for (const [name, before, after] of implementationEdits) {
  test(`local-scope classification ${name}`, () => {
    const result = classifySwiftSource(before, after, { path: "Probe.swift" });
    assert.equal(result.route, "hot-reload", `${result.reasonCode}: ${result.reason}`);
    assert.equal(result.hotReloadable, true);
  });
}

const rebuildEdits = [
  ["keeps top-level storage initializers fenced alongside local edits",
    "let global = 1\n" + method("return 1"),
    "let global = 2\n" + method("let local = 2; return local")],
  ["keeps static extension storage initializers fenced alongside local edits",
    "struct Data {}\nextension Data { static let shared = 1; func value() -> Int { 1 } }",
    "struct Data {}\nextension Data { static let shared = 2; func value() -> Int { let local = 2; return local } }"],
  ...["protocol P { func external() -> Int }\n", '@_silgen_name("external")\nfunc external() -> Int\n'].map((prefix) => [
    "keeps stored fields after a bodyless callable declaration",
    prefix + "struct Probe { let first: Int }",
    prefix + "struct Probe { let first: Int; let second: Int }",
  ]),
  ...["func", "var", "init", "deinit", "subscript"].map((name) => [
    `keeps stored fields in escaped nominal name ${name}`,
    `struct \`${name}\` { var first: Int = 1 }`,
    `struct \`${name}\` { var first: Int = 1; var second: Int = 2 }`,
  ]),
  ...["func", "var", "init", "deinit", "subscript"].flatMap((name) => ["É" + name, name + "É", "😀" + name].map((type) => [
    `keeps stored fields in Unicode nominal name ${type}`,
    `struct ${type} { var first: Int = 1 }`,
    `struct ${type} { var first: Int = 1; var second: Int = 2 }`,
  ])),
  ["keeps stored layout in a multiline local nominal declaration",
    method("struct Local\n{ let first: Int }; return 1"),
    method("struct Local\n{ let first: Int; let second: Int }; return 2")],
  ["keeps stored layout in a multiline local inheritance clause",
    method("struct Local:\n Equatable { let first: Int }; return 1"),
    method("struct Local:\n Equatable { let first: Int; let second: Int }; return 2")],
  ["adds actual instance storage after a local body", method("let local = 1; return local"), "final class Probe { func value() -> Int { let local = 1; return local }; var stored = 2 }"],
  ["moves a local binding into instance storage", method("let local = 1; return local"), "final class Probe { let local = 1; func value() -> Int { return local } }"],
  ["adds actual instance storage before a local body", method("let local = 1; return local"), "final class Probe { let stored = 1; func value() -> Int { let local = 1; return local } }"],
  ["changes an existing stored initializer", "final class Probe { let stored = 1; func value() -> Int { return stored } }", "final class Probe { let stored = 2; func value() -> Int { let local = stored; return local } }"],
  ["changes a stored closure initializer containing locals", "struct Probe { let value: Int = { return 1 }() }", "struct Probe { let value: Int = { let local = 2; return local }() }"],
  ["adds a top-level binding", method("return 1"), `let added = 1\n${method("let local = 1; return local")}`],
  ["adds a second callable", method("return 1"), "final class Probe { func value() -> Int { let local = 1; return local }; func added() -> Int { return 2 } }"],
  ["changes a method signature alongside a local declaration", method("return 1"), "final class Probe { func value(seed: Int) -> Int { let local = seed; return local } }"],
  ["changes actor isolation", "final class Probe { func value() -> Int { return 1 } }", "final class Probe { @MainActor func value() -> Int { let local = 2; return local } }"],
  ["changes access modifiers", "final class Probe { private func value() -> Int { return 1 } }", "final class Probe { public func value() -> Int { let local = 2; return local } }"],
  ["adds an import", method("return 1"), `import Foundation\n${method("let local = 1; return local")}`],
  ["changes conditional compilation inside a method", method("\n#if DEBUG\nreturn 1\n#else\nreturn 0\n#endif\n"), method("\n#if RELEASE\nlet local = 2; return local\n#else\nreturn 0\n#endif\n")],
  ["changes runtime availability inside a method", method("if #available(iOS 17, *) { return 1 }; return 0"), method("if #available(iOS 18, *) { let local = 2; return local }; return 0")],
  ["adds a local type", method("return 1"), method("struct Local { let value: Int }; let local = Local(value: 2); return local.value")],
  ["changes a local type's stored layout", method("struct Local { let value: Int }; return 1"), method("struct Local { let value: Int; let other: Int }; return 2")],
  ["adds a local function", method("return 1"), method("func helper() -> Int { let local = 2; return local }; return helper()")],
  ["changes a local function signature", method("func helper() -> Int { return 1 }; return helper()"), method("func helper(seed: Int) -> Int { let local = seed; return local }; return helper(seed: 2)")],
  ["adds a local typealias", method("return 1"), method("typealias Local = Int; let local: Local = 2; return local")],
  ["changes enum cases alongside a local method edit", "enum Probe { case one; func value() -> Int { return 1 } }", "enum Probe { case one, two; func value() -> Int { let local = 2; return local } }"],
  ["adds another type after a callable boundary", method("return 1"), `${method("let local = 1; return local")}\nstruct Added { let stored: Int }`],
  ["does not let a comment swallow a structural member", "final class Probe { /* { func fake() { */ func value() -> Int { return 1 } }", "final class Probe { /* { func fake() { */ func value() -> Int { let local = 2; return local }; var stored = 3 }"],
  ["does not let a raw string swallow a structural member", method('let decoy = #"{ func fake() {"#; return decoy.count'), 'final class Probe { func value() -> Int { let decoy = #"{ func fake() {"#; return decoy.count }; var stored = 3 }'],
  ["rejects an unclosed callable before a new member", method("return 1"), "final class Probe { func value() -> Int { let local = 2; return local; var stored = 3 }"],
  ["rejects an extra closing brace around a local edit", method("return 1"), `${method("let local = 2; return local")} }`],
  ["rejects unbalanced parentheses around a local closure", method("return 1"), method("let local = ({ return 2 }; return local")],
  ["rejects unbalanced brackets around a local collection", method("return 1"), method("let local = [1, 2; return local.count")],
];

for (const [name, before, after] of rebuildEdits) {
  test(`local-scope safety ${name}`, () => {
    const result = classifySwiftSource(before, after, { path: "Probe.swift" });
    assert.equal(result.route, "rebuild-required", `${result.reasonCode}: ${result.reason}`);
    assert.equal(result.hotReloadable, false);
  });
}

test("replacement generation rejects a bundle that would silently omit a changed async implementation", () => {
  const before = "class Probe { func sync() -> Int { 1 }; func asyncValue() async -> Int { 1 } }";
  const after = "class Probe { func sync() -> Int { let local = 2; return local }; func asyncValue() async -> Int { let local = 2; return local } }";
  assert.equal(classifySwiftSource(before, after).route, "hot-reload");
  assert.throws(() => generateDynamicReplacementSource({ source: after, beforeSource: before, sourcePath: "Probe.swift", moduleName: "ProbeApp" }), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
});

test("replacement generation rejects an unrepresented multiline method alongside a supported change", () => {
  const before = "class Probe { func sync() -> Int { 1 }; func complex(\n input: Int\n) -> Int { input } }";
  const after = before.replace("{ 1 }", "{ let local = 2; return local }").replace("{ input }", "{ let local = input + 1; return local }");
  assert.throws(() => generateDynamicReplacementSource({ source: after, beforeSource: before, sourcePath: "Probe.swift", moduleName: "ProbeApp" }), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
});

test("nested stored layout stays fenced across callable contexts and nominal header spellings", () => {
  const headers = ["struct Local", "struct\nLocal", "struct Local:\n Equatable", "final class Local", "actor Local", "struct `func`", "struct Éfunc", "struct 😀var"];
  const contexts = [
    (type) => `final class Host { func value() -> Int { ${type}; return 0 } }`,
    (type) => `func value() -> Int { ${type}; return 0 }`,
    (type) => `struct Host { var value: Int { ${type}; return 0 } }`,
    (type) => `struct Host { subscript(index: Int) -> Int { ${type}; return index } }`,
    (type) => `struct Host { init() { ${type}; _ = 0 } }`,
  ];
  for (const header of headers) for (const context of contexts) {
    const before = context(`${header} { let first: Int = 1 }`);
    const after = context(`${header} { let first: Int = 1; let second: Int = 2 }`);
    assert.equal(classifySwiftSource(before, after).route, "rebuild-required", `${header}: ${context("...")}`);
  }
});

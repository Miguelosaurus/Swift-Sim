#!/usr/bin/env node
// Independent admission probes. Uses an already-built experimental generator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const generator = resolve(process.argv[2] || ".build/hot-reload-frontier/full-callable/generate");
function generate(before, after, files) {
  const result = spawnSync(generator, ["--experimental-full-callable-v1"], {
    input: JSON.stringify({ module: "ReviewFixture", files: files || [{ path: "ReviewFixture.swift", before, after }] }),
    encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
  });
  return { status: result.status, stderr: result.stderr, report: result.status === 0 ? JSON.parse(result.stdout) : null };
}
const getter = "public class A { public var x: Int { get { 1 } } }";
const method = "public class A { public func x()->Int {1} }";
const negatives = [
  ["getter gains async", getter, getter.replace("get { 1 }", "get async { 2 }")],
  ["getter gains throws", getter, getter.replace("get { 1 }", "get throws { 2 }")],
  ["getter gains typed throws", getter, getter.replace("get { 1 }", "get throws(any Error) { 2 }")],
  ["setter added", getter, getter.replace("get { 1 }", "get { 2 } set { print(newValue) }")],
  ["setter removed", getter.replace("get { 1 }", "get { 1 } set { print(newValue) }"), getter],
  ["getter gains isolation attribute", getter, getter.replace("get { 1 }", "@MainActor get { 2 }")],
  ["setter mutation modifier changes", getter.replace("get { 1 }", "get { 1 } set { }"), getter.replace("get { 1 }", "get { 2 } nonmutating set { }")],
  ["getter convention changes", getter, getter.replace("get { 1 }", "_read { yield 2 }")],
  ["implicit accessor changes to async", "public class A { public var x: Int { 1 } }", getter.replace("get { 1 }", "get async { 2 }")],
  ["generic constraint narrows", "public class A { public func x<T: BinaryInteger>(_ n:T)->T {n} }", "public class A { public func x<T: FixedWidthInteger>(_ n:T)->T {n+1} }"],
  ["generic where changes", "public class A { public func x<T>(_ n:T)->T where T: BinaryInteger {n} }", "public class A { public func x<T>(_ n:T)->T where T: FixedWidthInteger {n+1} }"],
  ["MainActor method gains nonisolated", "@MainActor " + method, "@MainActor " + method.replace("func x", "nonisolated func x").replace("{1}", "{2}")],
  ["type isolation removed", "@MainActor " + method, method.replace("{1}", "{2}")],
  ["function async removed", method.replace("x()->Int", "x() async ->Int"), method.replace("{1}", "{2}")],
  ["parameter type changed", "class A { func x(_ n:Int)->Int{n} }", "class A { func x(_ n:Double)->Int{Int(n)} }"],
  ["stored layout changed with supported edit", "class A { var state=1; func x()->Int{1} }", "class A { var state=1; var added=2; func x()->Int{2} }"],
  ["stored observer changed with supported edit", "class A { var state=1 {didSet{print(1)}}; func x()->Int{1} }", "class A { var state=1 {didSet{print(2)}}; func x()->Int{2} }"],
  ["deinit changed with supported edit", "class A { deinit {print(1)}; func x()->Int{1} }", "class A { deinit {print(2)}; func x()->Int{2} }"],
  ["initializer changed with supported edit", "class A { init() {print(1)}; func x()->Int{1} }", "class A { init() {print(2)}; func x()->Int{2} }"],
  ["local nominal declaration", method, method.replace("{1}", "{ struct Local { var x=1 }; return 2 }")],
  ["conditional declaration changed", "#if DEBUG\n" + method + "\n#endif", "#if DEBUG\n" + method.replace("{1}", "{2}") + "\n#endif"],
  ["subscript accessor signature changed", "class A { subscript(_ index:Int)->Int {get {index}}; func x()->Int{1} }", "class A { subscript(_ index:Int)->Int {get async {index+1}}; func x()->Int{2} }"],
  ["incomplete syntax", method, method + "\nfunc bad( {"],
];
for (const [name, before, after] of negatives) {
  const result = generate(before, after);
  assert.notEqual(result.status, 0, `${name} must reject entire logical bundle`);
}
const positives = [
  ["getter implementation", getter, getter.replace("{ 1 }", "{ 2 }")],
  ["getter and setter implementations", getter.replace("get { 1 }", "get { 1 } set { print(newValue) }"), getter.replace("get { 1 }", "get { 2 } set { print(newValue + 1) }")],
  ["nested closure", method, method.replace("{1}", "{ let operation: () -> Int = { let local=2; return local }; return operation() }")],
  ["multiline function parameters", "class A { func x(\n _ input: Int,\n f: (Int) async throws -> Int\n) async throws -> Int {try await f(input)} }", "class A { func x(\n _ input: Int,\n f: (Int) async throws -> Int\n) async throws -> Int {try await f(input+1)} }"],
  ["raw string braces and comments", method, method.replace("{1}", "{ let text = #\"} { /* not a comment */\"#; return text.count }")],
  ["unlabeled async subscript", "class A { subscript(_ index:Int)->Int {get async {index}} }", "class A { subscript(_ index:Int)->Int {get async {index+1}} }"],
  ["implicit unlabeled subscript", "class A { subscript(index:Int)->Int {index} }", "class A { subscript(index:Int)->Int {index+1} }"],
  ["explicit labeled subscript", "class A { subscript(label index:Int)->Int {index} }", "class A { subscript(label index:Int)->Int {index+1} }"],
  ["generic subscript", "class A { subscript<T: BinaryInteger>(generic input:T)->T {input} }", "class A { subscript<T: BinaryInteger>(generic input:T)->T {input+1} }"],
  ["unchanged conditional sibling", method + "\n#if DEBUG\nclass B {}\n#endif", method.replace("{1}", "{2}") + "\n#if DEBUG\nclass B {}\n#endif"],
];
for (const [name, before, after] of positives) {
  const result = generate(before, after);
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  assert.equal(result.report.changedMemberCount, 1, name);
  assert.equal(result.report.stableEligible, false, name);
}
const literalBefore = "class A { func x()->String { \"old\" } }";
const literalAfter = literalBefore.replace('"old"', '"__swiftSim_full_exact"');
const literalResult = generate(literalBefore, literalAfter);
assert.equal(literalResult.status, 0, literalResult.stderr);
assert(literalResult.report.sources[0].includes('"__swiftSim_full_exact"'), "generated-name uniquing must preserve exact user literal");
for (const attribute of ["@MainActor", "@available(macOS 12.0, *)"]) {
  const before = `public class ExtensionProbe {}\n${attribute} extension ExtensionProbe { public func value()->Int {1} }`;
  const result = generate(before, before.replace("{1}", "{2}"));
  assert.equal(result.status, 0, result.stderr);
  assert(result.report.sources[0].includes(`${attribute}\n`), "extension context attribute must be reproduced");
}
const mixed = generate(null, null, [
  { path: "A.swift", before: method, after: method.replace("{1}", "{2}") },
  { path: "B.swift", before: "class B { var state=1 }", after: "class B { var state=1; var added=2 }" },
]);
assert.notEqual(mixed.status, 0, "one unsupported file must reject the full multi-file bundle");
console.log(JSON.stringify({ negativeBundles: negatives.length + 1, positiveBundles: positives.length + 3, stableEligible: false }));

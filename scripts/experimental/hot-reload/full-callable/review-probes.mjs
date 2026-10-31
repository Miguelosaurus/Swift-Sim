#!/usr/bin/env node
// Independent admission probes. Uses an already-built experimental generator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import ts from "typescript";

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
  ...["function", "file", "fileID", "filePath", "line", "column", "isolation", "unqualifiedMacro"].map(name =>
    [`source-context expression #${name}`, method, method.replace("{1}", `{ let value = #${name}; return 2 }`)]),
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

// Exercise the actual maintainer tool's finally block with injected dependencies.
// No engine, phone, production queue, compiler or product source is contacted.
const qualifierPath = new URL("./qualify-phone.mjs", import.meta.url);
const qualifierText = readFileSync(qualifierPath, "utf8");
const qualifierTree = ts.createSourceFile("qualify-phone.mjs", qualifierText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const cleanupTry = qualifierTree.statements.find(statement => ts.isTryStatement(statement) && statement.finallyBlock);
assert(cleanupTry, "qualification tool must retain an explicit outer cleanup block");
const cleanupText = cleanupTry.finallyBlock.statements.map(statement => statement.getText(qualifierTree)).join("\n");
const safeSaveFunction = qualifierTree.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "saveAfterMutation");
assert(safeSaveFunction, "post-mutation persistence must be isolated from native restoration");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const executeCleanup = new AsyncFunction("dependencies", `
  const { assert, queue, adapter, createLiveDeliveryQueue, createLiveDeliveryRuntime,
    liveRuntimeLockManager, output, files, save, drive, runtime, receipt, hash, readFileSync,
    initialScope, mutationAttempted, originalError, persistenceErrors, join } = dependencies;
  ${safeSaveFunction.getText(qualifierTree)}
  ${cleanupText}
  return receipt;
`);
const faultCases = ["success", "uncertain-apply", "restore-failure", "client-absent", "revocation-failure", "audit-failure",
  "restore-receipt-write-failure", "result-write-failure"];
for (const scenario of faultCases) {
  const events = [];
  const scope = { binaryIdentity: "review-binary", sessionIdentity: "review-process" };
  const receipt = scenario === "uncertain-apply" ? {} : { apply: { outcome: "hot-reloaded" } };
  const save = (name, value) => {
    if ((scenario === "restore-receipt-write-failure" && name === "restoration-obligation.json" && value.required === false)
      || (scenario === "result-write-failure" && name === "result.json")) throw new Error("injected receipt write failure");
    events.push(["save", name, structuredClone(value)]);
  };
  const restoreQueue = {
    async enqueue() { events.push(["restore-enqueue"]); return { requestId: "review-restore" }; },
    async revokeDesired() { events.push(["restore-revoke"]); },
  };
  const dependencies = {
    assert, initialScope: scope, mutationAttempted: true, originalError: undefined, receipt, join,
    persistenceErrors: [],
    output: "/nonexistent-review-output", liveRuntimeLockManager: {},
    files: scenario === "audit-failure" ? [{ path: "unavailable-source", beforeSource: "source" }] : [],
    queue: { async revokeDesired() {
      events.push(["original-revoke"]);
      if (scenario === "revocation-failure") throw new Error("injected journal failure");
    } },
    adapter: { async inspect() {
      return { scope, connected: scenario !== "client-absent", foreground: true, rootReady: true,
        matchesBinary: true, revision: 1 };
    } },
    createLiveDeliveryQueue() { return restoreQueue; },
    createLiveDeliveryRuntime() { return { async stop() { events.push(["restore-stop"]); } }; },
    save,
    async drive() {
      events.push(["restore-drive"]);
      if (scenario === "restore-failure") throw new Error("injected restoration failure");
      return { outcome: "hot-reloaded", delivery: { revision: 2 } };
    },
    runtime: { async stop() { events.push(["original-stop"]); } },
    hash(value) { return value; },
    readFileSync() { throw new Error("injected source audit failure"); },
  };
  await executeCleanup(dependencies).catch(() => {});
  assert(events.some(([event]) => event === "original-stop"), `${scenario}: original runtime must always stop`);
  if (scenario === "client-absent") {
    assert.equal(receipt.restorationRequired, true, "unavailable client retains restoration obligation");
  } else {
    assert(events.some(([event]) => event === "restore-enqueue"), `${scenario}: cleanup cannot skip compensation`);
    assert(events.some(([event]) => event === "restore-stop"), `${scenario}: restoration runtime must always stop`);
  }
  if (scenario === "success") assert.equal(receipt.complete, true);
  if (scenario === "uncertain-apply") assert.notEqual(receipt.complete, true, "restoration must not manufacture application proof");
  if (scenario === "restore-failure") assert.equal(receipt.restorationRequired, true, "failed restoration keeps obligation");
  if (["restore-receipt-write-failure", "result-write-failure"].includes(scenario)) {
    assert.equal(receipt.complete, true, "persistence failure must not interrupt separately proven restoration");
    assert(dependencies.persistenceErrors.length > 0, "persistence failure remains explicit in the retained receipt");
  }
}
console.log(JSON.stringify({ negativeBundles: negatives.length + 1, positiveBundles: positives.length + 3,
  cleanupFaultCases: faultCases.length, stableEligible: false }));

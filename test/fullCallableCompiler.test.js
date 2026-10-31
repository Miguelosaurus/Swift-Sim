import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFullCallableCompiler, parseObjCCategories, replacementProofDigest } from "../mac-helper/src/fullCallableCompiler.js";
import { replacementCoverageDigest } from "../mac-helper/src/replacementProof.js";

const nonce = "0123456789abcdef0123456789abcdef";
const member = (name, extra = {}) => ({ file: "Fixture.swift", line: 1, member: "operation(_:)", owner: "Probe", replacementName: name, kind: "function", accessors: [], ...extra });
const generation = (members) => ({ schemaVersion: 1, capability: "full-callable-v1", generation: nonce, module: "Fixture", changedMemberCount: members.length, members, sources: ["generated"] });
const input = { module: "Fixture", generation: nonce, files: [{ path: "Fixture.swift", before: "before", after: "after" }] };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-callable-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tool", "bin"), { recursive: true });
  const swiftc = join(root, "tool", "bin", "swiftc"); writeFileSync(swiftc, "fake tool", { mode: 0o700 });
  const source = join(root, "Generator.swift"); writeFileSync(source, "source-v1");
  const dylib = join(root, "fixture.dylib"); writeFileSync(dylib, "immutable artifact");
  const state = { version: "Swift fixture 1", buildCount: 0, generated: generation([member("__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0")]),
    calls: [], nm: "symbol0TX\n", demangled: "dynamically replaceable variable for (extension in Patch):Fixture.Probe.__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0(Swift.Int) -> Swift.Int\n", otool: "", commands: "", fail: "", malformed: false };
  const runner = { runSync(request) {
    state.calls.push(request);
    const args = request.args; let stdout = "";
    if (state.fail && args.includes(state.fail)) return { code: null, stdout: "", stderr: "bounded failure", timedOut: state.fail === "--full-callable-generator-v1" };
    if (args[0] === "--find") stdout = swiftc + "\n";
    else if (args[0] === "--version") stdout = state.version;
    else if (args.includes("--show-sdk-path")) stdout = root + "/Host.sdk\n";
    else if (args.includes("-o")) { state.buildCount += 1; writeFileSync(args[args.indexOf("-o") + 1], "trusted compiled generator", { mode: 0o700 }); }
    else if (args[0] === "--full-callable-generator-v1") stdout = state.malformed ? "not JSON" : JSON.stringify(state.generated);
    else if (args[0] === "nm") stdout = state.nm;
    else if (args[0] === "swift-demangle") stdout = String(request.input).includes("ClassMetadata") ? "type metadata for Fixture.Probe\n" : state.demangled;
    else if (args[0] === "otool") stdout = args[1] === "-ov" ? state.otool : state.commands;
    else assert.fail("unexpected command");
    return { code: 0, stdout, stderr: "" };
  } };
  const compiler = createFullCallableCompiler({ runner, cacheRoot: join(root, "cache"), resourcePath: source });
  return { root, state, compiler, source, dylib };
}

test("generator cache binds source and toolchain and rejects tampered executable", t => {
  const f = fixture(t);
  f.compiler.generate(input); f.compiler.generate(input); assert.equal(f.state.buildCount, 1);
  assert(f.state.calls.filter(call => call.args[0] === "--full-callable-generator-v1").every(call => Buffer.isBuffer(call.input)));
  assert(f.state.calls.every(call => call.policy.outputLimitBytes <= 12 * 1024 * 1024 && call.policy.timeoutMs <= 60_000));
  f.state.version = "Swift fixture 2"; f.compiler.generate(input); assert.equal(f.state.buildCount, 2);
  writeFileSync(f.source, "source-v2"); f.compiler.generate(input); assert.equal(f.state.buildCount, 3);
  const final = f.state.calls.findLast(call => call.args[0] === "--full-callable-generator-v1").executable;
  writeFileSync(final, "tampered executable", { mode: 0o700 });
  const executions = f.state.calls.filter(call => call.args[0] === "--full-callable-generator-v1").length;
  assert.throws(() => f.compiler.generate(input), { code: "FULL_CALLABLE_CACHE_INVALID" });
  assert.equal(f.state.calls.filter(call => call.args[0] === "--full-callable-generator-v1").length, executions);
});

test("unsafe cache paths, malformed generator output and unavailable/timeout tools fail closed", t => {
  const f = fixture(t);
  f.state.fail = "--find"; assert.throws(() => f.compiler.generate(input), { code: "FULL_CALLABLE_COMPILER_UNAVAILABLE" });
  f.state.fail = ""; f.state.malformed = true;
  assert.throws(() => f.compiler.generate(input), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  f.state.malformed = false; f.state.fail = "--full-callable-generator-v1";
  assert.throws(() => f.compiler.generate(input), { code: "FULL_CALLABLE_COMPILER_TIMEOUT" });
  f.state.fail = ""; f.state.generated.members = [];
  assert.throws(() => f.compiler.generate(input), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  const cache = join(f.root, "symlink-cache"); symlinkSync(join(f.root, "cache"), cache);
  const unsafe = createFullCallableCompiler({ runner: { runSync: request => {
    if (request.args[0] === "--find") return { code: 0, stdout: join(f.root, "tool/bin/swiftc"), stderr: "" };
    return { code: 0, stdout: request.args[0] === "--version" ? "version" : f.root + "/sdk", stderr: "" };
  } }, cacheRoot: cache, resourcePath: f.source });
  assert.throws(() => unsafe.generate(input), { code: "FULL_CALLABLE_CACHE_INVALID" });
});

test("complete per-member Swift coverage rejects same-count missing/extra substitutions", t => {
  const f = fixture(t);
  const g = generation([member("__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0"), member("__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_1")]);
  f.state.nm = "symbol0TX\nsymbol1TX\n";
  f.state.demangled += "dynamically replaceable variable for (extension in Patch):Fixture.Probe.__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_99(Swift.Int) -> Swift.Int\n";
  assert.throws(() => f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }), { code: "FULL_CALLABLE_COVERAGE_INCOMPLETE" });
  f.state.demangled = f.state.demangled.replace("_f0_99", "_f0_1");
  const result = f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" });
  assert.equal(result.replacementProof.swift_replacements, 2);
  assert.equal(result.members.length, 2);
  assert.equal(result.coverageDigest, replacementCoverageDigest(result.replacementProof));
  f.state.nm += "orphanTI\n";
  assert.throws(() => f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }), { code: "FULL_CALLABLE_COVERAGE_INCOMPLETE" });
});

test("accessor requirements are individually covered, including labeled replacement subscripts", t => {
  const f = fixture(t);
  const g = generation([member("__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0", { kind: "property", accessors: ["getter", "setter"] }),
    member("__swiftSim_label_g0123456789abcdef0123456789abcdef_f0_1_0", { kind: "subscript", accessors: ["getter"] })]);
  f.state.nm = "getterTX\nsetterTX\nsubscriptTX\n";
  f.state.demangled = [
    "dynamically replaceable variable for (extension in Patch):Fixture.Probe.__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0.getter : Swift.Int",
    "dynamically replaceable variable for (extension in Patch):Fixture.Probe.__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0.setter : Swift.Int",
    "dynamically replaceable variable for (extension in Patch):Fixture.Probe.subscript.getter : (__swiftSim_label_g0123456789abcdef0123456789abcdef_f0_1_0: Swift.Int) -> Swift.Int",
  ].join("\n") + "\n";
  assert.equal(f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }).replacementProof.swift_replacements, 3);
  f.state.demangled = f.state.demangled.replace(".setter :", ".getter :");
  assert.throws(() => f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }), { code: "FULL_CALLABLE_COVERAGE_INCOMPLETE" });
});

const category = `fixture.dylib:
Contents of (__DATA_CONST,__objc_catlist) section
000000000001c908 0x20528 __CATEGORY_Probe_$_Patch
    name      0x17ef0 Patch
    cls       0x0 _OBJC_CLASS_$_Probe
    instanceMethods 0x17020 category_methods
        entsize 12 (relative)
        count   2
        name    0x95d0 (0x205f8) __swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0:
        types   0xeae (0x17eda) v24@0:8@16
        imp     0xffffa7ec (0x1181c) generated_thunk
        name    0x95cc (0x20600) callback:
        types   0xea2 (0x17eda) v24@0:8@16
        imp     0xffffa7e0 (0x1181c) generated_thunk
    classMethods 0x0
    protocols 0x0
    instanceProperties 0x0
Contents of (__DATA,__objc_selrefs) section
    0x17f25 unrelated:
`;

test("Objective-C callback coverage uses exact class, generated member, ABI and shared IMP", t => {
  const f = fixture(t); const g = generation([member("__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0")]);
  f.state.nm = ""; f.state.otool = category; f.state.commands = "sectname __objc_catlist\n size 0x8\n";
  const proof = f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }).replacementProof;
  assert.equal(proof.swift_replacements, 0); assert.equal(proof.objc_callbacks.length, 1);
  assert.deepEqual(proof.objc_callbacks[0], { class_name: "Probe", selector: "callback:", replacement_selector: "__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0:", type_encoding: "v24@0:8@16" });
  for (const changed of [category.replace("count   2", "count   3"), category.replace("(0x1181c) generated_thunk\n    classMethods", "(0x1181d) generated_thunk\n    classMethods"), category.replace("v24@0:8@16\n        imp     0xffffa7e0", "i24@0:8@16\n        imp     0xffffa7e0"), category.replace("__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0:", "__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_99:"), category.replace("__CATEGORY_Probe_", "__CATEGORY_Other_")]) {
    f.state.otool = changed;
    assert.throws(() => f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }));
  }
  f.state.otool = category; f.state.commands = "sectname __mod_init_func\n size 0x8\n";
  assert.throws(() => f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }), { code: "FULL_CALLABLE_OBJC_METADATA_INVALID" });
});

test("Objective-C metadata parsing rejects incomplete methods and prohibited class effects", () => {
  assert.equal(parseObjCCategories(category)[0].methods.length, 2);
  for (const line of ["00000001000010 0x100001234", "unexpected line"]) assert.throws(() => parseObjCCategories("Contents of (__DATA_CONST,__objc_catlist) section\n" + line + "\n"));
  for (const changed of [category.replace("classMethods 0x0", "classMethods 0x123"), category.replace("protocols 0x0", "protocols 0x123"), category.replace("instanceProperties 0x0", "instanceProperties 0x123"), category.replace("cls       0x0 _OBJC_CLASS_$_Probe", "cls 0x0"), category.replace("        imp     0xffffa7e0 (0x1181c) generated_thunk", "")]) assert.throws(() => parseObjCCategories(changed));
});

test("proof digest shares the v3 contract canonical callback ordering", () => {
  const callbacks = ["z", "A", "a"].map(class_name => ({ class_name, selector: "callback:", replacement_selector: "replacement:", type_encoding: "v24@0:8@16" }));
  const proof = { version: 3, swift_replacements: 1, objc_callbacks: callbacks };
  assert.equal(replacementProofDigest(proof), replacementCoverageDigest({ ...proof, objc_callbacks: [...callbacks].reverse() }));
});

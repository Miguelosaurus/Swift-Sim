import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFullCallableCompiler, parseObjCCategories, replacementProofDigest } from "../mac-helper/src/fullCallableCompiler.js";
import { replacementCoverageDigest } from "../mac-helper/src/replacementProof.js";

const nonce = "0123456789abcdef0123456789abcdef";
const member = (name, extra = {}) => ({ file: "Fixture.swift", line: 1, member: "operation(_:)", owner: "Probe", replacementName: name, kind: "function", accessors: [], isStatic: false, ...extra });
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

test("preservation is valid only for captured instrumented body owners", t => {
  const f = fixture(t); const path = join(f.root, "Fixture.swift");
  f.state.generated.refreshStrategy = "preserve-state-v1";
  const qualified = { ...input, files: [{ ...input.files[0], path }], statefulBodies: { [path]: ["Probe"] } };
  assert.throws(() => f.compiler.generate(qualified), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  Object.assign(f.state.generated.members[0], { member: "body", kind: "property", accessors: ["getter"] });
  assert.equal(f.compiler.generate(qualified).refreshStrategy, "preserve-state-v1");
  assert.throws(() => f.compiler.generate({ ...qualified, statefulBodies: { [path]: ["Other"] } }), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  assert.throws(() => f.compiler.generate({ ...qualified, statefulBodies: { [path]: "Probe" } }));
});

test("additive output requires explicit scope proof and preserved helpers stay on instrumented views", t => {
  const f = fixture(t); const path = join(f.root, "Fixture.swift");
  Object.assign(f.state.generated, { additiveProtocol: 1, requiresPrivateScopes: true,
    additions: [{ file: "Fixture.swift", owner: "Probe", declaration: "private-helper" }] });
  assert.throws(() => f.compiler.generate(input), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  const allowed = { ...input, allowAdditive: true, availableModules: ["Foundation"],
    files: [{ ...input.files[0], path, installedBaseline: "installed" }] };
  assert.equal(f.compiler.generate(allowed).requiresPrivateScopes, true);
  f.state.generated.requiresPrivateScopes = false;
  assert.throws(() => f.compiler.generate(allowed), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  f.state.generated.requiresPrivateScopes = true;
  f.state.generated.refreshStrategy = "preserve-state-v1";
  const captured = { ...allowed, statefulBodies: { [path]: ["Probe"] } };
  assert.equal(f.compiler.generate(captured).refreshStrategy, "preserve-state-v1");
  assert.throws(() => f.compiler.generate({ ...captured, statefulBodies: {} }), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  f.state.generated.members[0].isStatic = true;
  assert.throws(() => f.compiler.generate(captured), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
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
  f.state.nm = ""; f.state.otool = category; f.state.commands = "sectname __objc_catlist\n size 0x8\nsectname __objc_selrefs\n segname __DATA\n addr 0x100\n size 0x8\n";
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

test("static dispatch and exact module/owner prefixes cannot be substituted", t => {
  const f = fixture(t); const g = generation([member("__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0", { isStatic: true })]);
  f.state.demangled = f.state.demangled.replace("for (extension", "for static (extension");
  assert.equal(f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }).replacementProof.swift_replacements, 1);
  for (const changed of [f.state.demangled.replace("in Patch)", "in OtherPatch)"), f.state.demangled.replace(":Fixture.", ":OtherFixture."), f.state.demangled.replace("Fixture.Probe.", "Fixture.OtherProbe.")]) {
    const saved = f.state.demangled; f.state.demangled = changed;
    assert.throws(() => f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }), { code: "FULL_CALLABLE_COVERAGE_INCOMPLETE" });
    f.state.demangled = saved;
  }
});

test("multiple callback pairs in one compiler category and indirect selector references are complete", t => {
  const f = fixture(t);
  const first = "__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0";
  const second = "__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_1";
  const g = generation([member(first), member(second)]);
  const pair = `        name    0x12 (0x30) ${second}\n        types   0x21 @16@0:8\n        imp     0x12000 second\n        name    0x13 (0x31) ping\n        types   0x21 @16@0:8\n        imp     0x12000 second\n`;
  f.state.nm = "";
  f.state.otool = category.replace("count   2", "count   4").replace("    classMethods 0x0", pair + "    classMethods 0x0")
    .replace(`(0x205f8) ${first}:`, "(0x205f8)").replace("0x17f25 unrelated:", `0x17f25 ${first}:`);
  f.state.commands = "sectname __objc_catlist\n size 0x8\nsectname __objc_selrefs\n segname __DATA\n addr 0x205f8\n size 0x8\n";
  assert.equal(f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }).replacementProof.objc_callbacks.length, 2);
  f.state.commands = f.state.commands.replace("size 0x8\n", "size 0x10\n");
  assert.throws(() => f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" }), { code: "FULL_CALLABLE_OBJC_METADATA_INVALID" });
});

test("known original stateful dynamic slots are not native replacement receipts", t => {
  const f = fixture(t), g = generation([member("__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0")]);
  Object.assign(g, { additiveProtocol: 1, requiresPrivateScopes: true, additions: [], statefulComponentProtocol: 1,
    statefulComponents: [{ path: join(f.root, "Fixture.swift"), owner: "Card", layoutDigest: "a".repeat(64), sourceFileIndex: 0,
      slots: [{ member: "body", kind: "property", accessors: ["getter"], isStatic: false }] }], statefulOriginUses: [] });
  f.state.nm += "originalBodyTX\noriginalBodyTx\n";
  const replacement = f.state.demangled;
  f.state.demangled += "dynamically replaceable variable for Patch.Card.body.getter : SwiftUI.AnyView\n";
  const inspect = () => f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: g, moduleName: "Patch" });
  const receipt = inspect();
  assert.equal(receipt.replacementProof.swift_replacements, 1);
  assert.deepEqual(receipt.swiftSymbols, ["symbol0TX"]);
  for (const mutation of ["missing-key", "unexpected-body", "unexpected-owner", "extra-original", "missing-original", "forged-TI"]) {
    f.state.nm = "symbol0TX\noriginalBodyTX\noriginalBodyTx\n";
    f.state.demangled = replacement + "dynamically replaceable variable for Patch.Card.body.getter : SwiftUI.AnyView\n";
    if (mutation === "missing-key") f.state.nm = f.state.nm.replace("originalBodyTx\n", "");
    if (mutation === "unexpected-body") f.state.demangled = f.state.demangled.replace("Card.body", "Card.other");
    if (mutation === "unexpected-owner") f.state.demangled = f.state.demangled.replace("Patch.Card", "Elsewhere.Card");
    if (mutation === "extra-original") { f.state.nm += "extraTX\nextraTx\n"; f.state.demangled += "dynamically replaceable variable for Patch.Card.other.getter : SwiftUI.AnyView\n"; }
    if (mutation === "missing-original") { f.state.nm = "symbol0TX\n"; f.state.demangled = replacement; }
    if (mutation === "forged-TI") f.state.nm += "originalBodyTI\n";
    assert.throws(inspect, { code: "FULL_CALLABLE_COVERAGE_INCOMPLETE" }, mutation);
  }
});

test("pinned member modules and preservation require the exact admitted component origin", t => {
  const f = fixture(t), path = join(f.root, "Fixture.swift"), origin = { path, owner: "Card", module: "FirstPatch", sourceFile: "Replacement0.swift", layoutDigest: "a".repeat(64) };
  const allowed = { ...input, files: [{ ...input.files[0], path }], allowAdditive: true, allowStatefulAdditive: true, statefulOrigins: [origin] };
  f.state.generated = { ...generation([member("__swiftSim_full_g0123456789abcdef0123456789abcdef_f32_0", {
    member: "body", kind: "property", accessors: ["getter"], owner: "Card", targetModule: "FirstPatch" })]),
    additiveProtocol: 1, requiresPrivateScopes: true, additions: [], statefulComponentProtocol: 1, statefulComponents: [], statefulOriginUses: [origin], refreshStrategy: "preserve-state-v1" };
  assert.equal(f.compiler.generate(allowed).refreshStrategy, "preserve-state-v1");
  f.state.demangled = "dynamically replaceable variable for (extension in Patch):FirstPatch.Card.__swiftSim_full_g0123456789abcdef0123456789abcdef_f32_0.getter : SwiftUI.AnyView\n";
  assert.equal(f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: f.state.generated, moduleName: "Patch" }).replacementProof.swift_replacements, 1);
  f.state.demangled = f.state.demangled.replace("FirstPatch.Card", "Fixture.Card");
  assert.throws(() => f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: f.state.generated, moduleName: "Patch" }));
  for (const changed of [{ owner: "Other" }, { module: "Unadmitted" }, { layoutDigest: "b".repeat(64) }, { sourceFile: "Replacement1.swift" }]) {
    assert.throws(() => f.compiler.generate({ ...allowed, statefulOrigins: [{ ...origin, ...changed }] }), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  }
  assert.throws(() => f.compiler.generate({ ...allowed, allowStatefulAdditive: false }), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
});

function addedStateFixture(t, fields = [{ name: "count", key: "a".repeat(64), type: "Swift.Int" }]) {
  const f = fixture(t), path = join(f.root, "Fixture.swift");
  Object.assign(f.state.generated, { additiveProtocol: 1, requiresPrivateScopes: true, refreshStrategy: "preserve-state-v1",
    additions: [{ file: "Fixture.swift", owner: "Probe", declaration: "added-state" }],
    addedStateProtocol: 1, addedStateGeneration: 7, addedStateOwners: [{ path, owner: "Probe", fields }] });
  Object.assign(f.state.generated.members[0], { member: "body", kind: "property", accessors: ["getter"] });
  const allowed = { ...input, allowAdditive: true, allowAddedState: true, stateGeneration: 7,
    statefulBodies: { [path]: ["Probe"] }, files: [{ ...input.files[0], path, installedBaseline: "installed" }] };
  return { ...f, allowed };
}

test("added state is admitted only for exact captured owners and the current positive generation", t => {
  const f = addedStateFixture(t);
  assert.equal(f.compiler.generate(f.allowed).addedStateGeneration, 7);
  const calls = f.state.calls.length;
  for (const change of [{ allowAddedState: false }, { allowAddedState: "true" }, { allowAdditive: false },
    { stateGeneration: 0 }, { stateGeneration: -1 }, { stateGeneration: 1.5 }, { stateGeneration: Number.MAX_SAFE_INTEGER + 1 },
    { stateGeneration: undefined }]) assert.throws(() => f.compiler.generate({ ...f.allowed, ...change }));
  assert.equal(f.state.calls.length, calls, "invalid input rejects before any tool invocation");
  for (const change of [{ allowAddedState: undefined, stateGeneration: undefined }, { stateGeneration: 8 },
    { statefulBodies: {} }, { statefulBodies: { [f.allowed.files[0].path]: ["AnotherView"] } }]) {
    assert.throws(() => f.compiler.generate({ ...f.allowed, ...change }), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  }
});

test("added-state output cannot forge owners, field keys, shapes, or generation lineage", t => {
  const f = addedStateFixture(t), original = structuredClone(f.state.generated);
  const owner = original.addedStateOwners[0], field = owner.fields[0];
  const changes = [
    { addedStateProtocol: 2 }, { addedStateGeneration: 0 }, { addedStateGeneration: 8 }, { requiresPrivateScopes: false }, { additiveProtocol: 0 },
    { addedStateOwners: [] }, { addedStateOwners: {} }, { addedStateOwners: [owner, owner] },
    { addedStateOwners: [{ ...owner, path: join(f.root, "Other.swift") }] },
    { addedStateOwners: [{ ...owner, owner: "Other" }] }, { addedStateOwners: [{ ...owner, owner: "Probe; sideEffect()" }] },
    { addedStateOwners: [{ ...owner, fields: {} }] }, { addedStateOwners: [{ ...owner, fields: [field, field] }] },
    { addedStateOwners: [{ ...owner, fields: [{ ...field, name: "unsafe-name" }] }] },
    { addedStateOwners: [{ ...owner, fields: [{ ...field, key: "short" }] }] },
    { addedStateOwners: [{ ...owner, fields: [{ ...field, type: "UncapturedType" }] }] },
    { addedStateOwners: [{ ...owner, fields: Array.from({ length: 33 }, (_, i) => ({ name: `field${i}`, key: i.toString(16).padStart(64, "0"), type: "Bool" })) }] },
  ];
  for (const change of changes) {
    f.state.generated = { ...original, ...change };
    assert.throws(() => f.compiler.generate(f.allowed), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  }
});

test("added-state restoration permits an empty field set without manufacturing replacement coverage", t => {
  const f = addedStateFixture(t, []);
  const generated = f.compiler.generate(f.allowed);
  assert.equal(generated.addedStateOwners[0].fields.length, 0);
  f.state.demangled = "dynamically replaceable variable for (extension in Patch):Fixture.Probe.__swiftSim_full_g0123456789abcdef0123456789abcdef_f0_0.getter : SwiftUI.AnyView\n";
  const coverage = f.compiler.inspectCoverage({ dylibPath: f.dylib, generation: generated, moduleName: "Patch" });
  assert.equal(coverage.replacementProof.swift_replacements, 1);
  assert.equal(coverage.members.length, 1);
});

test("added-state types stay in the bounded primitive, optional and collection surface", t => {
  const f = addedStateFixture(t);
  for (const type of ["Swift.Bool", "String", "Int64", "Swift.UInt32", "Float", "Swift.Double", "String?", "Swift.Optional<Int>",
    "[Swift.Int]", "[String: Bool?]", "[[String: [UInt8]?]]", "[Swift.String: Swift.Optional<Double>]"]) {
    f.state.generated.addedStateOwners[0].fields[0].type = type;
    assert.equal(f.compiler.generate(f.allowed).addedStateProtocol, 1, type);
  }
  for (const type of ["", "Custom", "CGFloat", "Some.Type", "[String:Int:Bool]", "Optional<Custom>", "[Int", "[Int] trailing", "Int; fatalError()", "[".repeat(20) + "Int" + "]".repeat(20)]) {
    f.state.generated.addedStateOwners[0].fields[0].type = type;
    assert.throws(() => f.compiler.generate(f.allowed), { code: "FULL_CALLABLE_GENERATOR_INVALID" }, type);
  }
});

test("ordinary generations cannot smuggle added-state fields or detached sequence metadata", t => {
  const f = fixture(t), original = structuredClone(f.state.generated);
  for (const change of [{ addedStateProtocol: 0, addedStateGeneration: 1 }, { addedStateGeneration: 1 }, { addedStateProtocol: 0, addedStateOwners: [{}] },
    { addedStateOwners: {} }, { addedStateProtocol: false }]) {
    f.state.generated = { ...original, ...change };
    assert.throws(() => f.compiler.generate(input), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  }
  f.state.generated = { ...original, addedStateProtocol: 0, addedStateOwners: [] };
  assert.equal(f.compiler.generate(input).changedMemberCount, 1);
  assert.throws(() => f.compiler.generate({ ...input, stateGeneration: 7 }));
});

test("original state-name metadata is bounded on generator origins and new component declarations", t => {
  const f = fixture(t), path = join(f.root, "Fixture.swift");
  const origin = { path, owner: "Card", module: "FirstPatch", sourceFile: "Replacement0.swift", layoutDigest: "a".repeat(64), stateNames: ["count"] };
  const allowed = { ...input, files: [{ ...input.files[0], path }], allowAdditive: true, allowStatefulAdditive: true, statefulOrigins: [origin] };
  assert.equal(f.compiler.generate(allowed).changedMemberCount, 1);
  for (const stateNames of [null, "count", [""], ["bad-name"], ["count", "count"], ["x".repeat(65)], Array(33).fill("count")]) {
    const calls = f.state.calls.length;
    assert.throws(() => f.compiler.generate({ ...allowed, statefulOrigins: [{ ...origin, stateNames }] }));
    assert.equal(f.state.calls.length, calls, "invalid names reject before executing tools");
  }
  Object.assign(f.state.generated, { additiveProtocol: 1, requiresPrivateScopes: true, additions: [], statefulComponentProtocol: 1,
    statefulComponents: [{ path, owner: "Card", layoutDigest: "a".repeat(64), sourceFileIndex: 0, stateNames: ["count"],
      slots: [{ member: "body", kind: "property", accessors: ["getter"], isStatic: false }] }], statefulOriginUses: [] });
  assert.deepEqual(f.compiler.generate(allowed).statefulComponents[0].stateNames, ["count"]);
  for (const stateNames of [null, "count", ["a", "a"], ["bad-name"], Array(33).fill("count")]) {
    f.state.generated.statefulComponents[0].stateNames = stateNames;
    assert.throws(() => f.compiler.generate(allowed), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  }
});

test("added State on a pinned view needs exact origin scope and original-name metadata", t => {
  const f = addedStateFixture(t), path = f.allowed.files[0].path;
  const origin = { path, owner: "Probe", module: "FirstPatch", sourceFile: "Replacement0.swift", layoutDigest: "a".repeat(64), stateNames: ["originalCount"] };
  const allowed = { ...f.allowed, statefulBodies: {}, allowStatefulAdditive: true, statefulOrigins: [origin] };
  Object.assign(f.state.generated, { statefulComponentProtocol: 1, statefulComponents: [], statefulOriginUses: [origin] });
  f.state.generated.members[0].targetModule = "FirstPatch";
  assert.equal(f.compiler.generate(allowed).addedStateProtocol, 1);
  const withoutNames = { ...origin }; delete withoutNames.stateNames;
  assert.throws(() => f.compiler.generate({ ...allowed, statefulOrigins: [withoutNames] }), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  for (const statefulOrigins of [[], [{ ...origin, path: join(f.root, "Other.swift") }], [{ ...origin, owner: "Other" }]]) {
    assert.throws(() => f.compiler.generate({ ...allowed, statefulOrigins }), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  }
  assert.equal(f.compiler.generate({ ...allowed, statefulOrigins: [{ ...origin, stateNames: [] }] }).addedStateProtocol, 1);
});

test("concrete property accessors preserve added State only on their exact admitted view owner", t => {
  const f = addedStateFixture(t);
  Object.assign(f.state.generated.members[0], { member: "derived", kind: "property", accessors: ["getter"] });
  assert.equal(f.compiler.generate(f.allowed).refreshStrategy, "preserve-state-v1");
  f.state.generated.members[0].isStatic = true;
  assert.throws(() => f.compiler.generate(f.allowed), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  f.state.generated.members[0].isStatic = false;
  f.state.generated.addedStateOwners[0].owner = "Other";
  assert.throws(() => f.compiler.generate(f.allowed), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  f.state.generated.addedStateOwners[0].owner = "Probe";
  delete f.state.generated.addedStateProtocol; delete f.state.generated.addedStateGeneration; delete f.state.generated.addedStateOwners;
  assert.throws(() => f.compiler.generate(f.allowed), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
});

test("constant indices and protocol claims are validated", t => {
  const f = fixture(t); const path = join(f.root, "Fixture.swift");
  for (const statefulConstants of [null, [], { relative: ["Theme.accent"] }, { [path]: "Theme.accent" }, { [path]: ["accent"] }, { [path]: ["Theme.bad-name"] }]) {
    assert.throws(() => f.compiler.generate({ ...input, statefulConstants }), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
  }
  f.state.generated.constantProtocol = 1;
  assert.throws(() => f.compiler.generate(input), { code: "FULL_CALLABLE_GENERATOR_INVALID" });
  assert.equal(f.compiler.generate({ ...input, statefulConstants: { [path]: ["Theme.accent"] } }).constantProtocol, 1);
});

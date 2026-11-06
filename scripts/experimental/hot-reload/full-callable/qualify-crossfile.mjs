#!/usr/bin/env node
// Host-native qualification only. No engine, phone, or product-source mutation.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createFullCallableCompiler } from "../../../../mac-helper/src/fullCallableCompiler.js";
import { NodeCommandRunner } from "../../../../mac-helper/src/infrastructure/nodeCommandRunner.js";

const output = resolve(process.argv[2] || `.build/crossfile-native-${Date.now()}`);
assert(!existsSync(output) || readdirSync(output).length === 0, "fresh output required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const runner = new NodeCommandRunner({ spawn, spawnSync });
const attempts = [];
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
function command(executable, args, { failure } = {}) {
  const result = runner.runSync({ executable, args,
    environment: { inherit: ["PATH", "HOME", "TMPDIR", "DEVELOPER_DIR"], overrides: {}, unset: ["SDKROOT"] },
    policy: { timeoutMs: 120_000, outputLimitBytes: 12 * 1024 * 1024, processGroup: "inherit", acceptedExitCodes: failure ? [0, 1] : [0] } });
  attempts.push({ executable, args, result }); save("attempts.json", attempts);
  assert(!result.error && !result.timedOut, result.stderr || result.error || "command failed");
  if (failure) {
    assert.notEqual(result.code, 0, "unsafe compilation unexpectedly succeeded");
    assert.match(result.stderr, failure);
    return result;
  }
  assert.equal(result.code, 0, result.stderr || "command failed");
  return result.stdout;
}
const sdk = command("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"]).trim();
const compiler = createFullCallableCompiler({ runner, cacheRoot: join(output, "compiler-cache") });
const module = "CrossfileDeliveryFixture";
const base = (name, seed) => `@MainActor public class ${name} {
  private var seed = ${seed}
  public init() {}
  public func value() -> Int { seed }
  public func payload() -> Any { seed }
}
`;
const original = [
  "struct InstalledModel { let value: Int }\nprivate func installedSecret() -> Int { 99 }\n" + base("ProbeA", 3),
  base("ProbeB", 7), "", "",
];
const paths = ["ProbeA.swift", "ProbeB.swift", "SharedHelper.swift", "SharedCard.swift"].map(name => join(output, name));
for (const index of [0, 1]) writeFileSync(paths[index], original[index], { mode: 0o600 });
const consumers = original.slice(0, 2).map((source, index) => source
  .replace("{ seed }", "{ crossfileValue(InstalledModel(value: seed)) + duplicatePrivate(0) }")
  .replace("-> Any { seed }", "-> Any { crossfilePayload(InstalledModel(value: seed)) }")
  + `private func duplicatePrivate(_ value: Int) -> Int { value + ${index + 1} }\n`);
const helper = amount => `func crossfileValue(_ model: InstalledModel) -> Int { model.value + ${amount} }
@MainActor func crossfilePayload(_ model: InstalledModel) -> Any {
  let card = SharedCard(number: crossfileValue(model))
  _ = card.body
  return card
}
`;
const card = `import SwiftUI
struct SharedCard: View {
  let number: Int
  var body: some View { Text(String(number)) }
}
`;
const first = [...consumers, helper(10), card];
const second = [...consumers, helper(20), card];
const compileFlags = ["-sdk", sdk, "-swift-version", "5"];
command("/usr/bin/xcrun", ["swiftc", ...compileFlags, "-emit-library", "-emit-module", "-enable-private-imports",
  "-Xfrontend", "-enable-implicit-dynamic", "-module-name", module, ...paths.slice(0, 2), "-o", join(output, `lib${module}.dylib`)]);
for (const [index, desired] of [first, second].entries()) {
  const ordinary = desired.map((source, file) => {
    const path = join(output, `Ordinary${index}File${file}.swift`);
    writeFileSync(path, source, { mode: 0o600 }); return path;
  });
  const path = join(output, `ordinary${index}.dylib`);
  command("/usr/bin/xcrun", ["swiftc", ...compileFlags, "-O", "-emit-library", "-module-name", `OrdinaryCrossfile${index}`, ...ordinary, "-o", path]);
  assert(!command("/usr/bin/xcrun", ["nm", "-j", "-U", path]).split(/\r?\n/).some(symbol => symbol.endsWith("TX")));
}
const inputFor = (index, before, desired) => ({ module, generation: String(index).repeat(32),
  allowAdditive: true, allowSharedAdditive: true, availableModules: ["SwiftUI"],
  moduleSources: paths.slice(0, 2).map((path, file) => ({ path, source: original[file] })),
  files: paths.map((path, file) => ({ path, before: before[file], after: desired[file],
    installedBaseline: original[file], ...(file >= 2 ? { isNewFile: true } : {}) })) });
function sourcesFor(generation, prefix) {
  return generation.sources.map((source, file) => {
    const path = join(output, `${prefix}File${file}.swift`);
    writeFileSync(path, source, { mode: 0o600 }); return path;
  });
}
const generations = [];
for (const [index, before, desired] of [[1, original, first], [2, first, second], [3, second, original]]) {
  const input = inputFor(index, before, desired);
  const generation = compiler.generate(input);
  assert.equal(generation.changedMemberCount, 4);
  assert.equal(generation.additiveProtocol, 1);
  assert.equal(generation.sharedAdditive, true);
  assert.equal(generation.requiresPrivateScopes, true);
  const sources = sourcesFor(generation, `Patch${index}`);
  const patchModule = `CrossfileGeneration${index}`;
  const dylibPath = join(output, `patch${index}.dylib`);
  command("/usr/bin/xcrun", ["swiftc", ...compileFlags, "-emit-library", "-module-name", patchModule, ...sources,
    "-I", output, "-L", output, `-l${module}`, "-o", dylibPath]);
  const coverage = compiler.inspectCoverage({ dylibPath, generation, moduleName: patchModule });
  assert.equal(coverage.members.length, 4);
  assert.equal(coverage.replacementProof.swift_replacements, 4);
  generations.push({ index, input, generation, coverage });
  save("generations.json", generations);
}
const invalid = [
  ["installed storage", 0, first[0].replace("private var seed = 3", "private var seed = 3; private var added = 0")],
  ["installed signature", 0, first[0].replace("func value() -> Int", "func value(_ argument: Int) -> Int")],
  ["public addition", 3, card.replace("struct SharedCard", "public struct SharedCard")],
  ["installed name collision", 2, first[2] + "struct InstalledModel {}\n"],
  ["duplicate shared name", 2, first[2] + "struct SharedCard {}\n"],
  ["new class", 2, first[2] + "class Other {}\n"],
  ["global storage", 2, first[2] + "let other = 1\n"],
  ["macro", 3, card.replace("let number: Int", "let number: Int; let context = #file")],
  ["existing conformance", 2, first[2] + "extension ProbeA: Equatable { public static func ==(a: ProbeA, b: ProbeA) -> Bool { true } }\n"],
  ["unavailable import", 2, first[2] + "import NotInCapturedSDK\n"],
];
for (const [name, file, after] of invalid) {
  const input = structuredClone(generations[0].input); input.files[file].after = after;
  assert.throws(() => compiler.generate(input), undefined, name);
}
const standalone = inputFor(4, original, first);
standalone.files = standalone.files.slice(2);
assert.throws(() => compiler.generate(standalone), undefined, "new declarations alone provide no installed replacement proof");

// A synthetic new source identity may access module-internal declarations,
// but cannot borrow file-private declarations from an installed source unit.
const privacyInput = inputFor(5, original, first);
privacyInput.files[2].after = privacyInput.files[2].after.replace("model.value + 10", "model.value + installedSecret()");
const privacyGeneration = compiler.generate(privacyInput);
command("/usr/bin/xcrun", ["swiftc", ...compileFlags, "-emit-library", "-module-name", "CrossfilePrivacyNegative",
  ...sourcesFor(privacyGeneration, "PrivacyNegative"), "-I", output, "-L", output, `-l${module}`, "-o", join(output, "privacy-negative.dylib")],
{ failure: /cannot find 'installedSecret' in scope/ });

const runnerSource = join(output, "Runner.swift");
writeFileSync(runnerSource, `import Foundation
import Darwin
import SwiftUI
import ${module}
func load(_ path: String) { guard dlopen(path, RTLD_NOW | RTLD_GLOBAL) != nil else { fatalError(String(cString: dlerror())) } }
func number(_ value: Any) -> Int { Mirror(reflecting: value).children.first!.value as! Int }
@MainActor func requireView(_ value: Any) { guard let view = value as? any View else { fatalError("not a SwiftUI view") }; _ = AnyView(view) }
@main enum Run {
 @MainActor static func main() {
  let a = ProbeA(), b = ProbeB()
  precondition(a.value() == 3 && b.value() == 7)
  load(CommandLine.arguments[1])
  precondition(a.value() == 14 && b.value() == 19)
  let old = a.payload(); precondition(number(old) == 13); requireView(old); requireView(b.payload())
  load(CommandLine.arguments[2])
  precondition(a.value() == 24 && b.value() == 29)
  let next = a.payload(); precondition(number(next) == 23 && number(old) == 13); requireView(next); requireView(old)
  precondition(ObjectIdentifier(type(of: old)) != ObjectIdentifier(type(of: next)))
  load(CommandLine.arguments[3])
  precondition(a.value() == 3 && b.value() == 7)
  precondition(a.payload() as? Int == 3 && b.payload() as? Int == 7)
  precondition(number(old) == 13 && number(next) == 23); requireView(old); requireView(next)
  print("Cross-file views/helpers, helper-only follow-up, private scopes, nominal coexistence and restoration passed")
 }
}
`, { mode: 0o600 });
const binary = join(output, "runner");
command("/usr/bin/xcrun", ["swiftc", ...compileFlags, "-parse-as-library", runnerSource, "-I", output, "-L", output,
  `-l${module}`, "-Xlinker", "-rpath", "-Xlinker", output, "-o", binary]);
const result = command(binary, [1, 2, 3].map(index => join(output, `patch${index}.dylib`))).trim();
save("summary.json", { result, generations, ordinaryOptimizedArtifacts: 2,
  rejected: [...invalid.map(([name]) => name), "new-file-only proof", "private cross-file access"] });
console.log(JSON.stringify({ output, result, negativeBundles: invalid.length + 2, ordinaryOptimizedArtifacts: 2 }));

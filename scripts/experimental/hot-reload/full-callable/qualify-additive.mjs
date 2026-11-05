#!/usr/bin/env node
// Host-native qualification only. Does not contact any engine or phone.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createFullCallableCompiler } from "../../../../mac-helper/src/fullCallableCompiler.js";
import { NodeCommandRunner } from "../../../../mac-helper/src/infrastructure/nodeCommandRunner.js";

const output = resolve(process.argv[2] || `.build/additive-native-${Date.now()}`);
assert(!existsSync(output) || readdirSync(output).length === 0, "fresh output required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const runner = new NodeCommandRunner({ spawn, spawnSync });
const attempts = [];
function command(executable, args) {
  const result = runner.runSync({ executable, args,
    environment: { inherit: ["PATH", "HOME", "TMPDIR", "DEVELOPER_DIR"], overrides: {}, unset: ["SDKROOT"] },
    policy: { timeoutMs: 120_000, outputLimitBytes: 12 * 1024 * 1024, processGroup: "inherit", acceptedExitCodes: [0] } });
  attempts.push({ executable, args, result });
  writeFileSync(join(output, "attempts.json"), JSON.stringify(attempts, null, 2), { mode: 0o600 });
  assert.equal(result.code, 0, result.stderr || result.error || "command failed");
  return result.stdout;
}
const sdk = command("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"]).trim();
const compiler = createFullCallableCompiler({ runner, cacheRoot: join(output, "compiler-cache") });
const module = "AdditiveDeliveryFixture";
const baseline = (name, seed) => `public class ${name} {
  private var seed = ${seed}
  public init() {}
  public func value() -> Int { seed }
  public func payload() -> Any { seed }
}
`;
const original = [baseline("ProbeA", 3), baseline("ProbeB", 7)];
const after = (source, amount) => "import Foundation\n" + source
  .replace("{ seed }", "{ adjust(seed) }")
  .replace("-> Any { seed }", "-> Any { Extra(n: adjust(seed)) }")
  + `private func adjust(_ value: Int) -> Int { NSNumber(value: value + ${amount}).intValue }
private struct Extra<T: BinaryInteger> { let n: T }
`;
const first = original.map(source => after(source, 10));
const second = original.map(source => after(source, 20));
const files = original.map((source, index) => {
  const path = join(output, `Fixture${index}.swift`);
  writeFileSync(path, source, { mode: 0o600 });
  return path;
});
command("/usr/bin/xcrun", ["swiftc", "-sdk", sdk, "-emit-library", "-emit-module", "-enable-private-imports",
  "-Xfrontend", "-enable-implicit-dynamic", "-module-name", module, ...files, "-o", join(output, `lib${module}.dylib`)]);
const generations = [];
for (const [index, desired] of [first, second].entries()) {
  const sourcePaths = desired.map((source, file) => {
    const path = join(output, `Ordinary${index}File${file}.swift`);
    writeFileSync(path, source, { mode: 0o600 }); return path;
  });
  const path = join(output, `ordinary${index}.dylib`);
  command("/usr/bin/xcrun", ["swiftc", "-sdk", sdk, "-O", "-emit-library", "-module-name", `Ordinary${index}`, ...sourcePaths, "-o", path]);
  assert(!command("/usr/bin/xcrun", ["nm", "-j", "-U", path]).split(/\r?\n/).some(symbol => symbol.endsWith("TX")));
}
for (const [index, before, desired] of [[1, original, first], [2, first, second], [3, second, original]]) {
  const input = { module, generation: String(index).repeat(32), allowAdditive: true, availableModules: ["Foundation"],
    files: files.map((path, file) => ({ path, before: before[file], after: desired[file], installedBaseline: original[file] })) };
  const generation = compiler.generate(input);
  assert.equal(generation.changedMemberCount, 4);
  assert.equal(generation.additiveProtocol, 1);
  assert.equal(generation.requiresPrivateScopes, true);
  const sources = generation.sources.map((source, file) => {
    const path = join(output, `Patch${index}File${file}.swift`);
    writeFileSync(path, source, { mode: 0o600 });
    return path;
  });
  const patchModule = `AdditiveGeneration${index}`;
  const dylibPath = join(output, `patch${index}.dylib`);
  command("/usr/bin/xcrun", ["swiftc", "-sdk", sdk, "-emit-library", "-module-name", patchModule, ...sources,
    "-I", output, "-L", output, `-l${module}`, "-o", dylibPath]);
  const coverage = compiler.inspectCoverage({ dylibPath, generation, moduleName: patchModule });
  assert.equal(coverage.members.length, 4);
  assert.equal(coverage.replacementProof.swift_replacements, 4);
  generations.push({ index, input, generation, coverage });
}
const invalid = [
  ["storage", first[0].replace("private var seed = 3", "private var seed = 3; private var extra = 0")],
  ["signature", first[0].replace("func value() -> Int", "func value(_ extra: Int) -> Int")],
  ["public helper", first[0].replace("private func adjust", "public func adjust")],
  ["new class", first[0] + "private class Other {}"],
  ["macro", first[0] + "private struct Other { let n = #file }"],
  ["conformance", first[0] + "extension ProbeA: Equatable { public static func ==(a: ProbeA, b: ProbeA) -> Bool { true } }"],
  ["missing module", first[0] + "import NotInCapturedSDK\n"],
];
for (const [name, source] of invalid) {
  assert.throws(() => compiler.generate({ ...generations[0].input,
    files: [{ ...generations[0].input.files[0], after: source }] }), undefined, name);
}
const runnerSource = join(output, "Runner.swift");
writeFileSync(runnerSource, `import Foundation
import Darwin
import ${module}
func load(_ path: String) { guard dlopen(path, RTLD_NOW | RTLD_GLOBAL) != nil else { fatalError(String(cString: dlerror())) } }
func number(_ value: Any) -> Int { Mirror(reflecting: value).children.first!.value as! Int }
@main enum Run {
 static func main() {
  let a = ProbeA(), b = ProbeB()
  precondition(a.value() == 3 && b.value() == 7)
  load(CommandLine.arguments[1])
  precondition(a.value() == 13 && b.value() == 17)
  let old = a.payload(); precondition(number(old) == 13)
  load(CommandLine.arguments[2])
  precondition(a.value() == 23 && b.value() == 27)
  let next = a.payload(); precondition(number(next) == 23 && number(old) == 13)
  precondition(ObjectIdentifier(type(of: old)) != ObjectIdentifier(type(of: next)))
  load(CommandLine.arguments[3])
  precondition(a.value() == 3 && b.value() == 7)
  precondition(a.payload() as? Int == 3 && b.payload() as? Int == 7)
  precondition(number(old) == 13 && number(next) == 23)
  print("Additions, private scopes, helper-only second edit, nominal coexistence and restoration passed")
 }
}
`, { mode: 0o600 });
const binary = join(output, "runner");
command("/usr/bin/xcrun", ["swiftc", "-sdk", sdk, "-parse-as-library", runnerSource, "-I", output, "-L", output,
  `-l${module}`, "-Xlinker", "-rpath", "-Xlinker", output, "-o", binary]);
const result = command(binary, [1, 2, 3].map(index => join(output, `patch${index}.dylib`))).trim();
writeFileSync(join(output, "summary.json"), JSON.stringify({ result, generations, ordinaryOptimizedArtifacts: 2, rejected: invalid.map(([name]) => name) }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ output, result, negativeBundles: invalid.length }));

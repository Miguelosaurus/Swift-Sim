#!/usr/bin/env node
// Host/captured-iOS compiler qualification only. Never contacts a live engine.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createFullCallableCompiler } from "../../../../mac-helper/src/fullCallableCompiler.js";
import { NodeCommandRunner } from "../../../../mac-helper/src/infrastructure/nodeCommandRunner.js";

const output = resolve(process.argv[2] || `.build/full-callable-production-qualification-${Date.now()}`);
assert(!existsSync(output) || readdirSync(output).length === 0, "fresh qualification output required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const runner = new NodeCommandRunner({ spawn, spawnSync });
const attempts = [];
function command(executable, args, options = {}) {
  const result = runner.runSync({ executable, args,
    environment: { inherit: ["PATH", "HOME", "TMPDIR", "DEVELOPER_DIR"], overrides: {}, unset: ["SDKROOT"] },
    ...(options.cwd ? { cwd: options.cwd } : {}),
    policy: { timeoutMs: 120_000, outputLimitBytes: 12 * 1024 * 1024, processGroup: "inherit", acceptedExitCodes: [0] } });
  attempts.push({ executable, args, result });
  writeFileSync(join(output, "attempts.json"), JSON.stringify(attempts, null, 2), { mode: 0o600 });
  assert.equal(result.code, 0, result.stderr || result.error || "command failed");
  return result.stdout;
}
const compiler = createFullCallableCompiler({ runner, cacheRoot: join(output, "compiler-cache") });
const module = "FullCallableQualification";
const baseline = `import Foundation
@objc public protocol CallbackContract {
    func callback(_ value: NSNumber, context: NSNumber) -> NSNumber
    func ping() -> NSNumber
}
public final class Probe: NSObject, CallbackContract {
    private var storage = 5
    public override init() { super.init() }
    public func callback(_ value: NSNumber, context: NSNumber) -> NSNumber { NSNumber(value: value.intValue + context.intValue + /*VERSION*/1) }
    public func ping() -> NSNumber { NSNumber(value: /*VERSION*/1) }
    public func calculate(_ value: Int) async throws -> Int {
        await withTaskGroup(of: Int.self) { group in
            group.addTask { value + /*VERSION*/1 }
            var result = 0
            for await value in group { result += value }
            return result
        }
    }
    public func generic<T: BinaryInteger>(_ value: T) -> T where T: Sendable { value + T(/*VERSION*/1) }
    public var computed: Int { get { storage + /*VERSION*/1 } set { storage = newValue - /*VERSION*/1 } }
    public subscript(_ index: Int) -> Int { get async { index + /*VERSION*/1 } }
}
public struct GenericProbe<T: BinaryInteger> {
    public init() {}
    public func value(_ input: T) -> T { input + T(/*VERSION*/1) }
}
@MainActor extension Probe {
    public func isolated(_ value: Int) -> Int { value + /*VERSION*/1 }
}
`;
const baselinePath = join(output, "Baseline.swift");
writeFileSync(baselinePath, baseline, { mode: 0o600 });
command("/usr/bin/xcrun", ["swiftc", "-emit-library", "-emit-module", "-enable-private-imports", "-module-name", module,
  "-Xfrontend", "-enable-implicit-dynamic", baselinePath, "-o", join(output, `lib${module}.dylib`)]);
const hostPatches = [];
let before = baseline;
for (const [index, version] of [2, 3, 1].entries()) {
  const after = baseline.replaceAll("/*VERSION*/1", `/*VERSION*/${version}`);
  const patchModule = `FullCallableQualificationPatch${index + 1}`;
  const generation = compiler.generate({ module, generation: String(index + 1).padStart(24, "0"), files: [{ path: "Baseline.swift", before, after }] });
  const source = join(output, `Patch${index + 1}.swift`);
  writeFileSync(source, generation.sources[0], { mode: 0o600 });
  const dylibPath = join(output, `patch${index + 1}.dylib`);
  command("/usr/bin/xcrun", ["swiftc", "-emit-library", "-module-name", patchModule, source,
    "-I", output, "-L", output, `-l${module}`, "-Xfrontend", "-disable-access-control", "-o", dylibPath]);
  const coverage = compiler.inspectCoverage({ dylibPath, generation, moduleName: patchModule });
  assert.equal(coverage.changedMemberCount, 8);
  assert.equal(coverage.replacementProof.swift_replacements, 7);
  assert.equal(coverage.replacementProof.objc_callbacks.length, 2);
  assert(coverage.replacementProof.objc_callbacks.every(callback => callback.replacement_selector.includes(`g${generation.generation}_`)));
  writeFileSync(join(output, `coverage${index + 1}.json`), JSON.stringify({ generation, coverage }, null, 2), { mode: 0o600 });
  hostPatches.push({ path: dylibPath, coverage }); before = after;
}
const observations = hostPatches.map(patch => patch.coverage.replacementProof.objc_callbacks);
const native = `import Darwin
import Foundation
import ObjectiveC
import ${module}
@main struct Runner {
    @MainActor static func main() async throws {
        let probe = Probe()
        let generic = GenericProbe<Int64>()
        let callbacks: [[(String, String)]] = ${JSON.stringify(observations.map(callbacks => callbacks.map(callback => [callback.selector, callback.replacement_selector]))).replaceAll("[\"", "(\"").replaceAll("\"]", "\")")}
        var assertions = 0
        for (index, version) in [1, 2, 3, 1].enumerated() {
            if index > 0 {
                for (_, alias) in callbacks[index - 1] { precondition(class_getInstanceMethod(Probe.self, NSSelectorFromString(alias)) == nil) }
                guard dlopen(CommandLine.arguments[index], RTLD_NOW | RTLD_GLOBAL) != nil else { fatalError(String(cString: dlerror())) }
                for (original, alias) in callbacks[index - 1] {
                    let a = class_getInstanceMethod(Probe.self, NSSelectorFromString(original))!
                    let b = class_getInstanceMethod(Probe.self, NSSelectorFromString(alias))!
                    precondition(unsafeBitCast(method_getImplementation(a), to: UInt.self) == unsafeBitCast(method_getImplementation(b), to: UInt.self))
                    precondition(String(cString: method_getTypeEncoding(a)!) == String(cString: method_getTypeEncoding(b)!))
                    assertions += 3
                }
            }
            let delegate: any CallbackContract = probe
            precondition(probe.callback(2, context: 3).intValue == 5 + version)
            precondition(delegate.callback(2, context: 3).intValue == 5 + version)
            precondition(delegate.ping().intValue == version)
            let asyncValue = try await probe.calculate(10)
            precondition(asyncValue == 10 + version)
            precondition(probe.generic(Int64(10)) == Int64(10 + version))
            probe.computed = 100 + version
            precondition(probe.computed == 100 + version)
            let subscriptValue = await probe[20]
            precondition(subscriptValue == 20 + version)
            precondition(generic.value(30) == Int64(30 + version))
            precondition(probe.isolated(40) == 40 + version)
            assertions += 9
        }
        print("PASS \\(assertions) generated native observations across two reloads and restoration")
    }
}
`;
writeFileSync(join(output, "Runner.swift"), native, { mode: 0o600 });
command("/usr/bin/xcrun", ["swiftc", "-parse-as-library", join(output, "Runner.swift"), "-I", output, "-L", output, `-l${module}`,
  "-Xlinker", "-rpath", "-Xlinker", output, "-o", join(output, "runner")]);
const nativeResult = command(join(output, "runner"), hostPatches.map(patch => patch.path));
const summary = { host: { nativeResult, generations: 3, membersPerGeneration: 8, swiftPerGeneration: 7, objcPerGeneration: 2 }, engineContacted: false, phoneContacted: false };
if (process.argv.includes("--captured-zenics")) {
  const manifest = JSON.parse(readFileSync(join(homedir(), ".swift-sim/live/compilations.json"), "utf8"));
  const context = manifest.compilations.find(item => item.moduleName === "ZenicsCalisthenicsVideo");
  assert(context);
  const names = ["ThumbnailPipeline.swift", "ThumbnailDiskCache.swift", "LibraryView.swift", "DataStore.swift", "ContentView.swift"];
  const files = names.map(name => {
    const path = context.sources.find(path => basename(path) === name); assert(path);
    const current = readFileSync(path, "utf8");
    const before = name === "ContentView.swift" ? current : readFileSync(join("/tmp/zenics-cache-scheduling.EgxxXW", name), "utf8");
    const after = name === "ContentView.swift" ? current.replace('Tab("Library", systemImage:', 'Tab("Library · Compiler", systemImage:') : current;
    return { path, before, after, currentHash: createHash("sha256").update(current).digest("hex") };
  });
  summary.ios = [];
  for (const [index, restore] of [false, true].entries()) {
    const generated = compiler.generate({ module: context.moduleName, generation: String(index + 10).padStart(24, "0"), files: files.map(file => ({ path: file.path, before: restore ? file.after : file.before, after: restore ? file.before : file.after })) });
    const paths = generated.sources.map((source, fileIndex) => { const path = join(output, `iOS${index}-${fileIndex}.swift`); writeFileSync(path, source, { mode: 0o600 }); return path; });
    const patchModule = `FullCallableCaptured${index}`;
    const dylibPath = join(output, `ios${index}.dylib`);
    command("/usr/bin/xcrun", ["swiftc", "-emit-library", ...paths, "-module-name", patchModule, ...context.compilerArguments,
      "-Xfrontend", "-disable-access-control", "-Xlinker", "-undefined", "-Xlinker", "dynamic_lookup", "-o", dylibPath], { cwd: context.workingDirectory });
    const coverage = compiler.inspectCoverage({ dylibPath, generation: generated, moduleName: patchModule });
    assert.equal(coverage.changedMemberCount, 8); assert.equal(coverage.replacementProof.swift_replacements, 7); assert.equal(coverage.replacementProof.objc_callbacks.length, 1);
    writeFileSync(join(output, `ios${index}-coverage.json`), JSON.stringify({ generation: generated, coverage }, null, 2), { mode: 0o600 });
    summary.ios.push({ restore, members: coverage.changedMemberCount, proof: coverage.replacementProof });
  }
  summary.sourceUnchanged = files.every(file => createHash("sha256").update(readFileSync(file.path)).digest("hex") === file.currentHash);
  assert.equal(summary.sourceUnchanged, true);
}
writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ output, ...summary }));

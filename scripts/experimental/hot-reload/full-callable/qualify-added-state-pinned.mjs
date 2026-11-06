#!/usr/bin/env node
// Production generator + native SwiftUI qualification. No engine, simulator or phone contact.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createFullCallableCompiler } from '../../../../mac-helper/src/fullCallableCompiler.js';
import { NodeCommandRunner } from '../../../../mac-helper/src/infrastructure/nodeCommandRunner.js';

const out = resolve(process.argv[2] || `.build/additive-state-20261106/pinned-${Date.now()}`);
assert(!existsSync(out), 'fresh qualification output required');
mkdirSync(out, { recursive: true, mode: 0o700 });
const runner = new NodeCommandRunner({ spawn, spawnSync }), attempts = [];
const save = (name, value) => {
  const path = join(out, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
  return path;
};
function run(executable, args) {
  const result = runner.runSync({ executable, args,
    environment: { inherit: ['PATH', 'HOME', 'TMPDIR', 'DEVELOPER_DIR'], overrides: { SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT: '1' }, unset: ['SDKROOT'] },
    policy: { timeoutMs: 120_000, outputLimitBytes: 12 * 1024 * 1024, processGroup: 'inherit', acceptedExitCodes: [0] } });
  attempts.push({ executable, args, ...result }); save('attempts.json', attempts);
  assert(!result.error && !result.timedOut, result.stderr || String(result.error));
  assert.equal(result.code, 0, result.stderr); return result.stdout;
}
const flags = ['-swift-version', '5', '-I', out, '-L', out, '-Xlinker', '-rpath', '-Xlinker', out];
const swift = args => run('/usr/bin/xcrun', ['swiftc', ...flags, ...args]);
const compiler = createFullCallableCompiler({ runner, cacheRoot: join(out, 'compiler-cache') });
const shim = save('Observer.swift', `import SwiftUI
@MainActor final class SwiftSimLiveObserver: ObservableObject { static let shared = SwiftSimLiveObserver(); @Published var revision = 0 }
@MainActor public func qualificationRefresh() { SwiftSimLiveObserver.shared.revision += 1 }
`);
swift(['-D', 'DEBUG', '-emit-library', '-emit-module', '-module-name', 'SwiftSimLive', shim,
  resolve('Sources/SwiftSimLive/StatePreservingRefresh.swift'), resolve('Sources/SwiftSimLive/AddedViewState.swift'), '-o', join(out, 'libSwiftSimLive.dylib')]);
const module = 'PinnedStateFixture', path = join(out, 'Root.swift');
const original = `import SwiftUI
@MainActor public final class Probe {
 public init() {}
 public var rootCount = 0; public var rootAppearances = 0; public var count = 0; public var flag = false
 public var appearances = 0; public var seen = ""; public var identity: ObjectIdentifier?
 public var setRoot: ((Int)->Void)?; public var setCount: ((Int)->Void)?; public var setFlag: ((Bool)->Void)?
}
@MainActor public struct RootView: View {
 let probe: Probe; @State private var rootCount = 0
 public init(_ probe: Probe) { self.probe = probe }
 public var body: AnyView {
  probe.rootCount = rootCount
  return AnyView(VStack { Text("root-original"); Text(String(rootCount)) }.onAppear { probe.rootAppearances += 1; probe.setRoot = { rootCount = $0 } })
 }
}
`;
const instrumented = compiler.instrument({ files: [{ path, source: original }] }).files[0];
assert(instrumented); save('Root.swift', instrumented.source);
swift(['-emit-library', '-emit-module', '-enable-private-imports', '-Xfrontend', '-enable-implicit-dynamic', '-module-name', module,
  path, '-lSwiftSimLive', '-o', join(out, `lib${module}.dylib`)]);
const first = original.replace('Text("root-original")', 'PinnedCard(probe: probe)') + `
@MainActor private struct PinnedCard: View {
 let probe: Probe
 @State private var count = 0
 var body: some View {
  let _ = record()
  Text("pin-one: \\(count)")
   .onAppear { probe.appearances += 1 }
 }
 private func record() {
  probe.count = count; probe.identity = ObjectIdentifier(PinnedCard.self); probe.seen = "one"
  probe.setCount = { count = $0 }
 }
}
`;
const second = first.replace('@State private var count = 0', '@State private var count = 0\n @State private var flag = false')
  .replace('Text("pin-one: \\(count)")', 'Text("pin-two: \\(count) \\(flag)")')
  .replace('probe.seen = "one"', 'probe.seen = "two"; probe.flag = flag\n  let binding = $flag; probe.setFlag = { binding.wrappedValue = $0 }');
const third = second.replace('pin-two:', 'pin-three:').replace('probe.seen = "two"', 'probe.seen = "three"');
const input = (n, before, after, statefulOrigins = []) => ({ module, generation: String(n).repeat(32),
  allowAdditive: true, allowSharedAdditive: true, allowStatefulAdditive: true, allowAddedState: true, stateGeneration: n,
  availableModules: ['SwiftUI'], statefulBodies: { [path]: ['RootView'] }, statefulOrigins,
  moduleSources: [{ path, source: original }], files: [{ path, before, after, installedBaseline: original }] });
function compile(generation, patchModule, emitModule = false) {
  const dir = join(out, patchModule); mkdirSync(dir, { mode: 0o700 });
  const sourcePaths = generation.sources.map((source, index) => save(`${patchModule}/Replacement${index}.swift`, source));
  const dylibPath = join(out, `lib${patchModule}.dylib`);
  swift(['-emit-library', ...(emitModule ? ['-emit-module', '-emit-module-path', join(out, `${patchModule}.swiftmodule`), '-enable-private-imports'] : []),
    '-module-name', patchModule, ...sourcePaths, `-l${module}`, '-lSwiftSimLive', '-Xlinker', '-undefined', '-Xlinker', 'dynamic_lookup', '-o', dylibPath]);
  const proof = compiler.inspectCoverage({ dylibPath, generation, moduleName: patchModule });
  save(`${patchModule}/coverage.json`, { generation, proof }); return proof;
}
const one = compiler.generate(input(1, original, first));
assert.equal(one.statefulComponents.length, 1); assert.deepEqual(one.statefulComponents[0].stateNames, ['count']);
assert.equal(one.refreshStrategy, 'preserve-state-v1');
assert.equal(compile(one, 'PinOne', true).replacementProof.swift_replacements, 1);
const origin = { path, owner: 'PinnedCard', module: 'PinOne', sourceFile: 'Replacement0.swift',
  layoutDigest: one.statefulComponents[0].layoutDigest, stateNames: one.statefulComponents[0].stateNames };
for (const [n, before, after, name, count] of [
  [2, first, second, 'PinTwo', 3], [3, second, third, 'PinThree', 3], [4, third, original, 'PinRestore', 1],
]) {
  const generation = compiler.generate(input(n, before, after, [origin]));
  assert.equal(generation.addedStateProtocol, 1); assert.equal(generation.addedStateGeneration, n);
  assert.equal(generation.refreshStrategy, 'preserve-state-v1');
  if (n < 4) {
    assert.equal(generation.statefulComponents.length, 0); assert.equal(generation.statefulOriginUses.length, 1);
    assert.equal(generation.addedStateOwners[0].owner, 'PinnedCard');
    assert.deepEqual(generation.addedStateOwners[0].fields.map(field => field.name), ['flag']);
  }
  assert.equal(compile(generation, name).replacementProof.swift_replacements, count);
}
// Original native storage and original defaults remain fenced; new slots do not hide layout changes.
for (const invalid of [second.replace('@State private var count = 0', '@State private var count = 1'), second.replace('@State private var count = 0', 'let count = 0'), second.replace('let probe: Probe\n @State', 'let probe: Probe; let another = 1\n @State')]) {
  assert.throws(() => compiler.generate(input(5, second, invalid, [origin])));
}
assert.throws(() => compiler.generate(input(5, second, second.replace('@State private var flag = false', '@State private var flag = true'), [origin])));
const legacyOrigin = { ...origin }; delete legacyOrigin.stateNames;
assert.throws(() => compiler.generate(input(5, first, second, [legacyOrigin])));
const native = `import SwiftUI
import AppKit
import Darwin
import SwiftSimLive
import ${module}
@main enum Run {
 @MainActor static func main() {
  let app = NSApplication.shared; app.setActivationPolicy(.prohibited)
  let window = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 400, height: 400), styleMask: .borderless, backing: .buffered, defer: false)
  let probe = Probe(); window.contentView = NSHostingView(rootView: RootView(probe)); window.orderFront(nil)
  var images: [UnsafeMutableRawPointer] = []; var identity: ObjectIdentifier?
  func load(_ name: String) { guard let image = dlopen(CommandLine.arguments[1] + "/lib" + name + ".dylib", RTLD_NOW | RTLD_GLOBAL) else { fatalError(String(cString: dlerror())) }; images.append(image); qualificationRefresh() }
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { probe.setRoot?(7) }
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { precondition(probe.rootCount == 7); load("PinOne") }
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { precondition(probe.seen == "one"); precondition(probe.count == 0); precondition(probe.appearances == 1); identity = probe.identity; probe.setCount?(8) }
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.7) { precondition(probe.count == 8); load("PinTwo") }
  DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { precondition(probe.seen == "two"); precondition(probe.count == 8); precondition(!probe.flag); precondition(probe.identity == identity); precondition(probe.appearances == 1); probe.setFlag?(true) }
  DispatchQueue.main.asyncAfter(deadline: .now() + 2.7) { precondition(probe.flag); load("PinThree") }
  DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { precondition(probe.seen == "three"); precondition(probe.count == 8 && probe.flag); precondition(probe.identity == identity); precondition(probe.appearances == 1); precondition(probe.rootCount == 7); load("PinRestore") }
  DispatchQueue.main.asyncAfter(deadline: .now() + 3.7) { precondition(probe.rootCount == 7, "root state lost during restoration"); precondition(probe.appearances == 1); print("ADDED_STATE_PINNED_PASS original=8 flag=true sameType=true appearances=1 root=7 restored=true"); window.close(); app.stop(nil); exit(0) }
  app.run()
 }
}
`;
swift(['-parse-as-library', save('Runner.swift', native), `-l${module}`, '-lSwiftSimLive', '-o', join(out, 'runner')]);
const receipt = run(join(out, 'runner'), [out]); assert.match(receipt, /ADDED_STATE_PINNED_PASS/);
save('receipt.json', { passed: true, receipt, proofCounts: [1, 3, 3, 1], sourceFilesMutated: false, phoneRequests: 0 });
console.log(receipt.trim());

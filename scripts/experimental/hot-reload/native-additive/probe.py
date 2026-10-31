#!/usr/bin/env python3
"""Native additive hot-reload experiments; never contacts Swift Sim or a device."""
from pathlib import Path
import argparse, json, os, subprocess, tempfile

ROOT = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    out = args.output or Path(tempfile.mkdtemp(prefix='swift-sim-native-additive-'))
    if out.exists() and any(out.iterdir()):
        parser.error('Output must be empty; prior experiment evidence is never overwritten.')
    out.mkdir(parents=True, exist_ok=True)
    results = {'schemaVersion': 1, 'platform': 'host-macos', 'cases': [], 'artifacts': str(out), 'compiler': subprocess.run(['xcrun', 'swiftc', '--version'], capture_output=True, text=True, check=True).stdout.strip()}
    def command(name, argv, expect=0):
        run = subprocess.run(argv, capture_output=True, text=True, timeout=120)
        (out / (name + '.log')).write_text(run.stdout + run.stderr)
        results['cases'].append({'name':name, 'status':run.returncode, 'expectedFailure':expect != 0, 'passed': (run.returncode == 0) if expect == 0 else (run.returncode != 0)})
        (out / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
        if expect == 0 and run.returncode:
            results['passed'] = False
            (out / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
            print(run.stderr)
            raise RuntimeError(name)
        return run
    def write(name, source):
        p = out / name
        p.write_text(source)
        return str(p)
    baseline = write('Baseline.swift', '''
public protocol CounterValue { func value() -> Int }
public final class Probe {
    private var seed: Int
    public init(_ seed: Int) { self.seed = seed }
    public dynamic func read() -> Int { seed }
    public func fixed() -> Int { seed }
    public dynamic func make() -> any CounterValue { OriginalValue(seed: seed) }
    public dynamic func oldHelper() -> Int { hiddenHelper(seed) }
}
private struct OriginalValue: CounterValue {
    let seed: Int
    func value() -> Int { seed }
}
fileprivate func hiddenHelper(_ value: Int) -> Int { value + 1 }
''')
    command('baseline', ['xcrun','swiftc','-emit-library','-emit-module','-enable-private-imports','-module-name','AdditiveBaseline',baseline,'-o',str(out/'libAdditiveBaseline.dylib')])
    patches=[]
    for generation in (1,2):
        multiplier = generation * 10
        # Private import preserves baseline private storage identity. New declarations
        # belong to a generation-specific module, so old values retain valid metadata.
        patch = write(f'Patch{generation}.swift', f'''
@_private(sourceFile: "Baseline.swift") import AdditiveBaseline
import Foundation
private func sameName(_ value: Int) -> Int {{ value * {multiplier} }}
private func extra(_ value: Int) -> Int {{ sameName(value) }}
fileprivate struct AddedValue<T: BinaryInteger>: CounterValue {{
    let payload: T
    func value() -> Int {{ Int(payload) * {multiplier} }}
}}
private extension AddedValue {{
    func formatted() -> String {{ String(value()) }}
}}
private protocol PatchOnlyProtocol {{
    associatedtype Output: BinaryInteger
    func patchProtocolValue() -> Output
}}
extension Probe: PatchOnlyProtocol {{
    fileprivate func patchProtocolValue() -> Int {{ seed + {multiplier} }}
}}
@_cdecl("checkPatchConformance{generation}")
public func checkConformance(_ pointer: UnsafeMutableRawPointer) -> Int {{
    let object = Unmanaged<Probe>.fromOpaque(pointer).takeUnretainedValue()
    // The existential and associated type metadata are introduced by this patch.
    let existential: any PatchOnlyProtocol = object
    return Int(existential.patchProtocolValue())
}}
extension Probe {{
    @_dynamicReplacement(for: read())
    private func replacementRead() -> Int {{
        // Added Foundation import refers to an available linked SDK, no new dependency.
        precondition(extra(seed) == Int(AddedValue(payload: seed).formatted())!)
        return Int(NSNumber(value: extra(seed)).int64Value) + coordinated(seed)
    }}
    @_dynamicReplacement(for: make())
    private func replacementMake() -> any CounterValue {{ AddedValue(payload: seed) }}
    @_dynamicReplacement(for: oldHelper())
    private func replacementOldHelper() -> Int {{ hiddenHelper(seed) + {generation} }}
}}
''')
        helper = write(f'Helper{generation}.swift', f'''
// A second compilation unit in the same versioned patch module.
private func sameName(_ value: Int) -> Int {{ value }}
func coordinated(_ value: Int) -> Int {{ sameName(value) + {generation} }}
''')
        dylib = str(out/f'patch{generation}.dylib')
        command(f'patch{generation}', ['xcrun','swiftc','-emit-library','-module-name',f'AdditivePatch{generation}','-I',str(out),'-L',str(out),'-lAdditiveBaseline',patch,helper,'-o',dylib])
        symbols = subprocess.check_output(['xcrun', 'nm', dylib], text=True)
        (out / f'patch{generation}-symbols.log').write_text(symbols)
        definitions = {line.split()[-1][:-2] for line in symbols.splitlines() if line.split()[-1].endswith(('TI', 'TX'))}
        results['cases'].append({'name':f'patch{generation}-replacement-definitions', 'count':len(definitions), 'passed':len(definitions) == 3})
        patches.append(dylib)
    # Disabling all access control changes private-scope semantics across files.
    scope_failure = command('disabled-access-control-collides-private-scopes', ['xcrun','swiftc','-emit-library','-module-name','DisabledPrivateScopes','-I',str(out),'-L',str(out),'-lAdditiveBaseline','-Xfrontend','-disable-access-control',str(out/'Patch1.swift'),str(out/'Helper1.swift'),'-o',str(out/'invalid-scopes.dylib')], expect=1)
    results['cases'][-1]['passed'] = scope_failure.returncode != 0 and 'invalid redeclaration' in scope_failure.stderr
    restore = write('Restore.swift', '''
@_private(sourceFile: "Baseline.swift") import AdditiveBaseline
extension Probe {
    @_dynamicReplacement(for: read()) private func restoredRead() -> Int { seed }
    @_dynamicReplacement(for: make()) private func restoredMake() -> any CounterValue { OriginalValue(seed: seed) }
    @_dynamicReplacement(for: oldHelper()) private func restoredOldHelper() -> Int { hiddenHelper(seed) }
}
''')
    restore_dylib = str(out/'restore.dylib')
    command('restore', ['xcrun','swiftc','-emit-library','-module-name','AdditiveRestore','-I',str(out),'-L',str(out),'-lAdditiveBaseline',restore,'-o',restore_dylib])
    patches.append(restore_dylib)
    negative_sources = {
        'target-without-dynamic-bootstrap': ('import AdditiveBaseline\nextension Probe { @_dynamicReplacement(for: fixed()) private func invalidFixed() -> Int { 2 } }', 'not marked'),
        'flattened-private-scopes': ((out/'Patch1.swift').read_text() + '\n' + (out/'Helper1.swift').read_text(), 'invalid redeclaration'),
        'added-instance-storage': ('import AdditiveBaseline\nextension Probe { var newStorage: Int = 0 }', 'extensions must not contain stored properties'),
        'absent-module': ('import SwiftSimAbsentModuleForNegativeProbe', 'no such module'),
        'incompatible-signature': ('import AdditiveBaseline\nextension Probe { @_dynamicReplacement(for: read()) private func bad() -> String { "bad" } }', 'could not be found'),
        'duplicate-existing-conformance': ('import AdditiveBaseline\nextension Probe: CounterValue { public func value() -> Int { 1 } }\nextension Probe: CounterValue {}', 'redundant conformance'),
        'one-bad-member-in-complete-bundle': ('import AdditiveBaseline\nextension Probe { @_dynamicReplacement(for: read()) private func valid() -> Int { 77 }; @_dynamicReplacement(for: nonexistent()) private func invalid() -> Int { 88 } }', 'could not be found'),
    }
    for name, (source, fragment) in negative_sources.items():
        path = write(name + '.swift', source)
        run = command(name, ['xcrun','swiftc','-emit-library','-module-name','Negative_' + name.replace('-','_'),'-I',str(out),'-L',str(out),'-lAdditiveBaseline',path,'-o',str(out/(name+'.dylib'))], expect=1)
        results['cases'][-1]['expectedDiagnostic'] = fragment
        results['cases'][-1]['passed'] = run.returncode != 0 and fragment in run.stderr
    runner = write('Runner.swift', '''
import AdditiveBaseline
import Darwin
func check(_ condition: @autoclosure () -> Bool, _ name: String) {
    guard condition() else { fatalError(name) }
    print("PASS " + name)
}
let existing = Probe(3)
let baselineValue = existing.make()
check(existing.read() == 3, "baseline existing instance")
check(baselineValue.value() == 3, "baseline protocol value")
let first = dlopen(CommandLine.arguments[1], RTLD_NOW | RTLD_GLOBAL)
guard first != nil else { fatalError(String(cString: dlerror())) }
let firstConformance = unsafeBitCast(dlsym(first, "checkPatchConformance1")!, to: (@convention(c) (UnsafeMutableRawPointer) -> Int).self)
check(firstConformance(Unmanaged.passUnretained(existing).toOpaque()) == 13, "existing instance gains patch-local protocol conformance")
check(existing.read() == 34, "new private helper + stored private access + multi-file helper")
check(existing.oldHelper() == 5, "existing fileprivate helper call")
let firstValue = existing.make()
check(firstValue.value() == 30, "added generic type protocol conformance")
check(baselineValue.value() == 3, "baseline value survives first patch")
let second = dlopen(CommandLine.arguments[2], RTLD_NOW | RTLD_GLOBAL)
guard second != nil else { fatalError(String(cString: dlerror())) }
let secondConformance = unsafeBitCast(dlsym(second, "checkPatchConformance2")!, to: (@convention(c) (UnsafeMutableRawPointer) -> Int).self)
check(secondConformance(Unmanaged.passUnretained(existing).toOpaque()) == 23, "second patch-local protocol conformance")
check(firstConformance(Unmanaged.passUnretained(existing).toOpaque()) == 13, "first patch protocol identity coexists with second")
check(existing.read() == 65, "second patch on same instance")
check(existing.oldHelper() == 6, "second existing private helper call")
let secondValue = existing.make()
check(secondValue.value() == 60, "second versioned generic metadata")
check(firstValue.value() == 30, "old patch value retains first code and metadata")
check(baselineValue.value() == 3, "original value retains original code and metadata")
check(String(reflecting: type(of: firstValue)) != String(reflecting: type(of: secondValue)), "generation-specific nominal identities")
let restored = dlopen(CommandLine.arguments[3], RTLD_NOW | RTLD_GLOBAL)
guard restored != nil else { fatalError(String(cString: dlerror())) }
check(existing.read() == 3, "original method behavior restored")
check(existing.oldHelper() == 4, "original helper behavior restored")
check(existing.make().value() == 3, "original factory and metadata restored")
check(firstValue.value() == 30 && secondValue.value() == 60, "escaped generation values survive source restoration")
check(firstConformance(Unmanaged.passUnretained(existing).toOpaque()) == 13, "source restoration does not unregister old conformance")
// Libraries deliberately remain loaded while escaped values exist.
print("ALL ADDITIVE NATIVE CHECKS PASSED")
''')
    executable = str(out/'runner')
    command('runner-compile',['xcrun','swiftc','-I',str(out),'-L',str(out),'-lAdditiveBaseline','-Xlinker','-rpath','-Xlinker',str(out),runner,'-o',executable])
    env = os.environ.copy()
    env['DYLD_LIBRARY_PATH']=str(out)
    run=subprocess.run([executable]+patches, capture_output=True,text=True,env=env,timeout=30)
    (out/'runtime.log').write_text(run.stdout+run.stderr)
    results['cases'].append({'name':'runtime', 'status':run.returncode,'passed':run.returncode==0, 'checks':run.stdout.count('PASS ')})
    results['passed']=all(c['passed'] for c in results['cases'])
    (out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(results,indent=2))
    if run.returncode: print(run.stderr)
    return 0 if results['passed'] else 1

if __name__ == '__main__': raise SystemExit(main())

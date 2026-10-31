#!/usr/bin/env python3
"""Compile ordinary source edits through the gated AST additive prototype."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
BASE_FIRST = '''
public protocol CounterValue { func value() -> Int }
public final class First {
    private let seed: Int
    private let originalUnused: Int = 7
    public init(_ seed: Int) { self.seed = seed }
    public func read() -> Int { seed }
    public func make() -> any CounterValue { Original(seed) }
}
private struct Original: CounterValue {
    let seed: Int
    init(_ seed: Int) { self.seed = seed }
    func value() -> Int { seed }
}
'''
BASE_SECOND = '''
public final class Second {
    private let seed: Int
    public init(_ seed: Int) { self.seed = seed }
    public func read() -> Int { seed }
}
'''

def after_first(version):
    return 'import Foundation\n' + BASE_FIRST.replace(
        'public func read() -> Int { seed }',
        'public func read() -> Int { sameName(seed) + adjustment() }\n'
        f'    private func adjustment() -> Int {{ seed + {version} }}'
    ).replace('Original(seed)', 'AddedValue(payload: seed)') + f'''
private func sameName(_ input: Int) -> Int {{
    let added = AddedValue(payload: input)
    return Int(NSNumber(value: added.formatted()).int64Value)
}}
private protocol AddedProtocol {{
    associatedtype Output: BinaryInteger
    func output() -> Output
}}
fileprivate struct AddedValue<T: BinaryInteger>: CounterValue, AddedProtocol {{
    let payload: T
    func value() -> Int {{ Int(payload) * {version * 10} }}
    func output() -> T {{ payload }}
}}
private extension AddedValue {{
    func formatted() -> Int {{ genericRead(self) * {version * 10} }}
}}
private func genericRead<T: AddedProtocol>(_ value: T) -> Int {{ Int(value.output()) }}
'''

def after_second(version):
    return BASE_SECOND.replace('public func read() -> Int { seed }',
                               'public func read() -> Int { sameName(seed) }') + f'''
private func sameName(_ input: Int) -> Int {{ input + {version * 200} }}
'''

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    out = args.output or Path(tempfile.mkdtemp(prefix='swift-sim-additive-ast-'))
    if out.exists() and any(out.iterdir()):
        parser.error('Output must be empty; failed experiments are retained.')
    out.mkdir(parents=True, exist_ok=True)
    attempts = []
    def run(name, argv, stdin=None, expect=0, env=None):
        result = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=120, env=env)
        (out/(name+'.log')).write_text(result.stdout+result.stderr)
        attempts.append({'name':name, 'status':result.returncode, 'expectedFailure':expect != 0,
                         'passed':result.returncode == 0 if expect == 0 else result.returncode != 0})
        (out/'attempts.json').write_text(json.dumps(attempts, indent=2)+'\n')
        if not attempts[-1]['passed']:
            raise RuntimeError(name+'\n'+result.stderr)
        return result
    compiler = Path(run('compiler-location',['xcrun','--find','swiftc']).stdout.strip())
    host = compiler.parent.parent/'lib/swift/host'
    generator = str(out/'generate')
    run('generator-compile',['xcrun','swiftc',str(HERE/'generate.swift'),'-I',str(host),'-L',str(host),
                             '-Xlinker','-rpath','-Xlinker',str(host),'-o',generator])
    baseline = out/'baseline'
    baseline.mkdir()
    (baseline/'First.swift').write_text(BASE_FIRST)
    (baseline/'Second.swift').write_text(BASE_SECOND)
    module='AdditiveASTBaseline'
    run('baseline-compile',['xcrun','swiftc','-emit-library','-emit-module','-module-name',module,
                           '-enable-private-imports','-Xfrontend','-enable-implicit-dynamic',
                           str(baseline/'First.swift'),str(baseline/'Second.swift'),'-o',str(out/f'lib{module}.dylib')])
    def request(first, second, generation='probe'):
        return {'module':module, 'generation':generation, 'availableModules':['Foundation'], 'files':[
            {'path':'First.swift','before':BASE_FIRST,'after':first},
            {'path':'Second.swift','before':BASE_SECOND,'after':second}]}
    patches=[]
    for version in (1,2):
        payload=request(after_first(version), after_second(version), f'v{version}')
        generated=json.loads(run(f'generate-v{version}',[generator,'--experimental-additive-v1'],json.dumps(payload)).stdout)
        assert generated['stableEligible'] is False
        assert generated['changedMemberCount'] == 3
        assert generated['addedDeclarationCount'] == 8
        assert generated['requiresSeparateSourceFiles'] is True and generated['disableAccessControl'] is False
        patch=out/f'patch{version}'
        patch.mkdir()
        for source in generated['sources']:
            (patch/source['path']).write_text(source['source'])
        dylib=str(out/f'patch{version}.dylib')
        run(f'patch-compile-v{version}',['xcrun','swiftc','-emit-library','-module-name',generated['patchModule'],
            '-I',str(out),'-L',str(out),f'-l{module}',str(patch/'First.swift'),str(patch/'Second.swift'),'-o',dylib])
        symbols=run(f'patch-symbols-v{version}',['xcrun','nm','-j',dylib]).stdout.splitlines()
        assert len({s for s in symbols if s.endswith('TX')}) == 3
        patches.append(dylib)
        # Ordinary product edits must compile without generator artifacts or manual cleanup.
        normal=out/f'ordinary{version}'
        normal.mkdir()
        (normal/'First.swift').write_text(after_first(version))
        (normal/'Second.swift').write_text(after_second(version))
        library=str(normal/'ordinary.dylib')
        run(f'ordinary-source-v{version}',['xcrun','swiftc','-O','-emit-library','-module-name',f'OrdinaryProduct{version}',
             str(normal/'First.swift'),str(normal/'Second.swift'),'-o',library])
        release_symbols=run(f'ordinary-symbols-v{version}',['xcrun','nm','-j',library]).stdout.splitlines()
        assert not any(s.endswith(('TX','TI')) for s in release_symbols), 'ordinary optimized artifact must not contain replacement definitions'
    negative = {
        'reordered-existing-layout':after_first(1).replace('private let seed: Int\n    private let originalUnused: Int = 7', 'private let originalUnused: Int = 7\n    private let seed: Int'),
        'macro-expression':after_first(1).replace('sameName(seed) + adjustment()', '#unqualifiedMacro(seed)'),
        'existing-storage':after_first(1).replace('private let seed: Int','private let seed: Int\n private let newField = 1'),
        'existing-signature':after_first(1).replace('public func read() -> Int', 'public func read() -> Double'),
        'public-added-helper':after_first(1)+'\npublic func unintendedAPI() {}',
        'existing-conformance':after_first(1).replace('public final class First {','public final class First: CounterValue {'),
        'unrepresented-property':after_first(1).replace('private func adjustment()', 'private var computed: Int { 1 }\n private func adjustment()'),
        'removed-method':after_first(1).replace('public func make() -> any CounterValue { AddedValue(payload: seed) }',''),
        'malformed':after_first(1)+'\nfunc broken( {',
        'absent-import':'import NotInstalledHere\n'+after_first(1),
        'local-nominal':after_first(1).replace('sameName(seed) + adjustment()', 'struct Local { var x = 1 }; return sameName(seed) + adjustment()'),
        'new-extension-existing-type':after_first(1)+'\nextension First { func untracked() -> Int { 1 } }',
        'active-initializer-change':after_first(1).replace('self.seed = seed','self.seed = seed + 1'),
        'macro-addition':after_first(1)+'\n@Observable private final class NewMacro {}',
    }
    for name, first in negative.items():
        run('reject-'+name,[generator,'--experimental-additive-v1'],json.dumps(request(first,after_second(1))),expect=1)
    run('reject-missing-gate',[generator],json.dumps(request(after_first(1),after_second(1))),expect=1)
    # Parser coverage is necessary but does not replace compiler/link qualification.
    invalid=request(after_first(1), after_second(1).replace('input + 200', 'missingDependency(input)'), 'invalid')
    generated=json.loads(run('generate-unresolved-bundle',[generator,'--experimental-additive-v1'],json.dumps(invalid)).stdout)
    bad=out/'invalid-complete-bundle'
    bad.mkdir()
    for source in generated['sources']:
        (bad/source['path']).write_text(source['source'])
    invalid_dylib=bad/'invalid.dylib'
    run('reject-unresolved-complete-bundle',['xcrun','swiftc','-emit-library','-module-name',generated['patchModule'],
        '-I',str(out),'-L',str(out),f'-l{module}',str(bad/'First.swift'),str(bad/'Second.swift'),'-o',str(invalid_dylib)],expect=1)
    assert not invalid_dylib.exists(), 'no loadable partial bundle may escape compilation'

    runner=out/'Runner.swift'
    runner.write_text('''
import AdditiveASTBaseline
import Darwin
func check(_ condition: @autoclosure () -> Bool, _ label: String) {
    guard condition() else { fatalError(label) }; print("PASS " + label)
}
let first = First(3), second = Second(5)
let old = first.make()
check(first.read() == 3 && second.read() == 5, "baseline original objects")
check(old.value() == 3, "baseline existential")
let one = dlopen(CommandLine.arguments[1], RTLD_NOW | RTLD_GLOBAL)
guard one != nil else { fatalError(String(cString: dlerror())) }
check(first.read() == 34, "generated private helper and generic protocol dependency")
check(second.read() == 205, "same-named helper in separate original file")
let value1 = first.make()
check(value1.value() == 30, "generated patch-local generic type")
check(old.value() == 3, "old baseline metadata retained")
let two = dlopen(CommandLine.arguments[2], RTLD_NOW | RTLD_GLOBAL)
guard two != nil else { fatalError(String(cString: dlerror())) }
check(first.read() == 65 && second.read() == 405, "second generated bundle replaces both files")
let value2 = first.make()
check(value2.value() == 60 && value1.value() == 30, "old and new generated generic metadata coexist")
check(String(reflecting: type(of: value1)) != String(reflecting: type(of: value2)), "generation-specific identity")
check(old.value() == 3, "baseline value remains valid after repeated generated patches")
print("GENERATED ADDITIVE NATIVE CHECKS PASSED")
''')
    executable=str(out/'runner')
    run('runner-compile',['xcrun','swiftc','-I',str(out),'-L',str(out),f'-l{module}',
                         '-Xlinker','-rpath','-Xlinker',str(out),str(runner),'-o',executable])
    env=os.environ.copy(); env['DYLD_LIBRARY_PATH']=str(out)
    runtime=run('native-runtime',[executable]+patches,env=env)
    assert runtime.stdout.count('PASS ') == 10
    result={'capability':'experimental-additive-v1','stableEligible':False,'nativeAssertions':10,
            'generatedMembersPerGeneration':3,'additionsPerGeneration':8,'generations':2,
            'negativeBundles':len(negative)+1,'compilerRejectedCompleteBundle':True,'ordinaryOptimizedArtifactsWithoutReplacementDefinitions':2,
            'productionChanged':False,'passed':True,'output':str(out)}
    (out/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__ == '__main__': main()

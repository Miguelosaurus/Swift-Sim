#!/usr/bin/env node
// Production generator/native SwiftUI qualification. No engine or phone contact.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createFullCallableCompiler } from '../../../../mac-helper/src/fullCallableCompiler.js';
import { NodeCommandRunner } from '../../../../mac-helper/src/infrastructure/nodeCommandRunner.js';
const out = resolve(process.argv[2] || `.build/stateful-native-${Date.now()}`);
assert(!existsSync(out)); mkdirSync(out, {recursive:true, mode:0o700});
const runner = new NodeCommandRunner({spawn,spawnSync}), attempts=[];
function run(executable,args, failure) {
 const r=runner.runSync({executable,args,environment:{inherit:['PATH','HOME','TMPDIR','DEVELOPER_DIR'],overrides:{SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT:'1'},unset:['SDKROOT']},policy:{timeoutMs:120000,outputLimitBytes:12*1024*1024,processGroup:'inherit',acceptedExitCodes:failure?[0,1]:[0]}});
 attempts.push({executable,args,...r}); writeFileSync(join(out,'attempts.json'),JSON.stringify(attempts,null,2),{mode:0o600});
 assert(!r.error&&!r.timedOut,r.stderr); if(failure){assert.notEqual(r.code,0);assert.match(r.stderr,failure);}else assert.equal(r.code,0,r.stderr); return r.stdout;
}
const save=(name,source)=>{const path=join(out,name);writeFileSync(path,source,{mode:0o600});return path;};
const flags=['-swift-version','5','-I',out,'-L',out,'-Xlinker','-rpath','-Xlinker',out];
const swift=(args,failure)=>run('/usr/bin/xcrun',['swiftc',...flags,...args],failure);
const compiler=createFullCallableCompiler({runner,cacheRoot:join(out,'cache')});
// Compile the product observation wrapper with a minimal host-only observer.
const observation=save('Observer.swift',`import SwiftUI
@MainActor final class SwiftSimLiveObserver: ObservableObject { static let shared = SwiftSimLiveObserver(); @Published var revision = 0 }
@MainActor public func qualificationRefresh() { SwiftSimLiveObserver.shared.revision += 1 }
`);
swift(['-D','DEBUG','-emit-library','-emit-module','-module-name','SwiftSimLive',observation,resolve('Sources/SwiftSimLive/StatePreservingRefresh.swift'),'-o',join(out,'libSwiftSimLive.dylib')]);
const module='StatefulFixture', path=join(out,'Host.swift'), helperPath=join(out,'Helper.swift');
const original=`import SwiftUI
@MainActor public final class Probe: ObservableObject {
 public init() {} ; public var seen = ""; public var appearances = 0
 public var setCount: ((Int)->Void)?; public var setDraft: ((String)->Void)?; public var identity: ObjectIdentifier?
}
@MainActor public struct Host: View {
 let probe: Probe; @State private var draft = "start"
 public init(_ probe: Probe) { self.probe = probe }
 public var body: some View { Text("original") }
}
`;
const installed=compiler.instrument({files:[{path,source:original}]}).files[0];assert(installed);
save('Host.swift',installed.source);
swift(['-emit-library','-emit-module','-enable-private-imports','-Xfrontend','-enable-implicit-dynamic','-module-name',module,path,'-lSwiftSimLive','-o',join(out,`lib${module}.dylib`)]);
const desired=(version)=>original.replace('Text("original")','StateCard(probe: probe, draft: $draft)')+`
@MainActor struct StateCard: View {
 let probe: Probe
 @State private var count = 0
 @Binding var draft: String
 @Environment(\\.locale) private var locale
 var body: some View {
  let _ = capture()
  Text("${version}:\\(sharedValue(count)):\\(draft)")
   .onAppear { probe.appearances += 1; probe.setCount = { count = $0 }; probe.setDraft = { draft = $0 } }
 }
 private func capture() { probe.seen = "${version}:\\(sharedValue(count)):\\(draft)"; probe.identity = ObjectIdentifier(StateCard.self); _ = locale.identifier }
}
private func sameFileSecret() -> Int { 1 }
`;
const source1=desired('one'), source2=desired('two');
const input=(n,before,after,helperBefore,helperAfter,origins=[])=>({module,generation:String(n).repeat(32),allowAdditive:true,allowSharedAdditive:true,allowStatefulAdditive:true,availableModules:['SwiftUI'],statefulBodies:{[path]:['Host']},statefulOrigins:origins,moduleSources:[{path,source:original}],files:[{path,before,after,installedBaseline:original},{path:helperPath,before:helperBefore,after:helperAfter,installedBaseline:'',isNewFile:true}]});
const helper=n=>`func sharedValue(_ value: Int) -> Int { value + ${n} }`;
const first=compiler.generate(input(1,original,source1,'',helper(10)));
assert.equal(first.statefulComponentProtocol,1);assert.equal(first.refreshStrategy,'preserve-state-v1');assert.equal(first.statefulComponents.length,1);
const origin={path,owner:'StateCard',module:'StatefulFirst',sourceFile:'Replacement0.swift',layoutDigest:first.statefulComponents[0].layoutDigest};
function compile(g,name,emit=false){
 const dir=join(out,name);mkdirSync(dir,{mode:0o700}); const sources=g.sources.map((s,i)=>save(`${name}/Replacement${i}.swift`,s));
 const dylib=join(out,`lib${name}.dylib`);
 swift(['-emit-library',...(emit?['-emit-module','-emit-module-path',join(out,`${name}.swiftmodule`),'-enable-private-imports']:[]),'-module-name',name,...sources,`-l${module}`,'-lSwiftSimLive','-Xlinker','-undefined','-Xlinker','dynamic_lookup','-o',dylib]);
 const coverage=compiler.inspectCoverage({dylibPath:dylib,generation:g,moduleName:name});
 save(`${name}/coverage.json`,JSON.stringify({generation:g,coverage},null,2));return coverage;
}
assert.equal(compile(first,'StatefulFirst',true).replacementProof.swift_replacements,1);
const second=compiler.generate(input(2,source1,source2,helper(10),helper(10),[origin]));
assert.equal(second.statefulComponents.length,0);assert.equal(second.statefulOriginUses.length,1);assert.equal(second.refreshStrategy,'preserve-state-v1');
assert.equal(compile(second,'StatefulSecond').replacementProof.swift_replacements,3);
const third=compiler.generate(input(3,source2,source2,helper(10),helper(20),[origin]));
assert.equal(compile(third,'StatefulThird').replacementProof.swift_replacements,3);
// Storage/default changes must never silently remount a pinned type.
for(const changed of [source2.replace('count = 0','count = 1'),source2.replace('@State private var count = 0','@State private var count = 0; @State private var extra = 1'),source2.replace('draft: String','draft: Int'),source2.replace('@State private var count = 0','let count = 0').replace('@Binding var draft: String','let draft: String').replace('@Environment(\\.locale) private var locale','let locale = Locale.current')]) assert.throws(()=>compiler.generate(input(4,source2,changed,helper(10),helper(10),[origin])));
for(const changed of [source1.replace('count = 0','count = sharedValue(0)'),source1.replace('@State private var count = 0','@State(initialValue: sharedValue(0)) private var count: Int'), source1.replace('struct StateCard','struct StateCard<T>'),source1.replace('@State private','@StateObject private')]) assert.throws(()=>compiler.generate(input(5,original,changed,'',helper(10))));
// Another source file cannot borrow the origin file's private functions.
const privacy=compiler.generate(input(6,source2,source2,helper(10),helper(10)+'\nfunc borrowed() -> Int { sameFileSecret() }',[origin]));
const privacySources=privacy.sources.map((s,i)=>save(`Privacy${i}.swift`,s));
swift(['-emit-library','-module-name','Privacy',...privacySources,`-l${module}`,'-lSwiftSimLive','-Xlinker','-undefined','-Xlinker','dynamic_lookup','-o',join(out,'privacy.dylib')],/(?:cannot find 'sameFileSecret'|'sameFileSecret' is inaccessible)/);
// Later pinned modules retain earlier serialized-module dependencies even if
// the earlier view disappears from current source. No direct stale-type import.
const secondCard = `\n@MainActor struct SecondCard: View { let probe: Probe; @State private var flag = false; var body: some View { Text(String(flag)) } }\n`;
const dependentSource=source2.replace('StateCard(probe: probe, draft: $draft)','SecondCard(probe: probe)')+secondCard;
const dependent=compiler.generate(input(7,source2,dependentSource,helper(20),helper(20),[origin]));
compile(dependent,'StatefulDependent',true);
const secondOrigin={path,owner:'SecondCard',module:'StatefulDependent',sourceFile:'Replacement0.swift',layoutDigest:dependent.statefulComponents[0].layoutDigest};
const onlySecond=original.replace('Text("original")','SecondCard(probe: probe)')+secondCard;
const surviving=compiler.generate(input(8,dependentSource,onlySecond,helper(20),helper(20),[origin,secondOrigin]));
assert.equal(surviving.statefulOriginUses.length,1);assert(!surviving.sources.some(s=>s.includes('import StatefulFirst')));
compile(surviving,'DependencyRetention');
const native=`import SwiftUI
import AppKit
import Darwin
import SwiftSimLive
import ${module}
@main enum Run {
 @MainActor static func main() {
 let app=NSApplication.shared; app.setActivationPolicy(.prohibited)
 let window=NSWindow(contentRect:NSRect(x:-10000,y:-10000,width:400,height:400),styleMask:.borderless,backing:.buffered,defer:false)
 let probe=Probe(); window.contentView=NSHostingView(rootView:Host(probe));window.orderFront(nil)
 var images:[UnsafeMutableRawPointer]=[];var identity:ObjectIdentifier?
 func load(_ name:String){guard let h=dlopen(CommandLine.arguments[1]+"/lib"+name+".dylib",RTLD_NOW|RTLD_GLOBAL) else {fatalError(String(cString:dlerror()))};images.append(h);qualificationRefresh()}
 DispatchQueue.main.asyncAfter(deadline:.now()+0.2){load("StatefulFirst")}
 DispatchQueue.main.asyncAfter(deadline:.now()+0.6){precondition(probe.seen=="one:10:start",probe.seen);probe.setCount?(7);probe.setDraft?("draft")}
 DispatchQueue.main.asyncAfter(deadline:.now()+1.0){precondition(probe.seen=="one:17:draft",probe.seen);identity=probe.identity;load("StatefulSecond")}
 DispatchQueue.main.asyncAfter(deadline:.now()+1.4){precondition(probe.seen=="two:17:draft",probe.seen);precondition(probe.identity==identity);precondition(probe.appearances==1);load("StatefulThird")}
 DispatchQueue.main.asyncAfter(deadline:.now()+1.8){precondition(probe.seen=="two:27:draft",probe.seen);probe.setCount?(11)}
 DispatchQueue.main.asyncAfter(deadline:.now()+2.2){precondition(probe.seen=="two:31:draft",probe.seen);precondition(probe.appearances==1);precondition(probe.identity==identity);print("STATEFUL_NATIVE_PASS count=11 draft=draft appearances=1 sameType=true helper=20");window.close();app.stop(nil);exit(0)}
 app.run()
 }
}
`;
swift(['-parse-as-library',save('Runner.swift',native),`-l${module}`,'-lSwiftSimLive','-o',join(out,'runner')]);
const receipt=run(join(out,'runner'),[out]);assert.match(receipt,/STATEFUL_NATIVE_PASS/);save('receipt.json',JSON.stringify({passed:true,receipt,newSlots:first.statefulComponents[0].slots.length},null,2));console.log(receipt.trim());

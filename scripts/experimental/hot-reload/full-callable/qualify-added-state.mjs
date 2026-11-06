#!/usr/bin/env node
// Production lowering + native SwiftUI only. Never contacts an engine or phone.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createFullCallableCompiler} from '../../../../mac-helper/src/fullCallableCompiler.js';
import {NodeCommandRunner} from '../../../../mac-helper/src/infrastructure/nodeCommandRunner.js';
const out=resolve(process.argv[2] || `.build/additive-state-20261106/installed-${Date.now()}`);assert(!existsSync(out));mkdirSync(out,{recursive:true,mode:0o700});
const runner=new NodeCommandRunner({spawn,spawnSync}),attempts=[];
function run(executable,args,failure){const r=runner.runSync({executable,args,environment:{inherit:['PATH','HOME','TMPDIR','DEVELOPER_DIR'],overrides:{SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT:'1'},unset:['SDKROOT']},policy:{timeoutMs:120000,outputLimitBytes:12*1024*1024,processGroup:'inherit',acceptedExitCodes:failure?[0,1]:[0]}});attempts.push({executable,args,...r});save('attempts.json',JSON.stringify(attempts,null,2));if(failure){assert.notEqual(r.code,0);assert.match(r.stderr,failure);}else assert.equal(r.code,0,r.stderr);return r.stdout;}
function save(name,text){const p=join(out,name);writeFileSync(p,text,{mode:0o600});return p;}
const compiler=createFullCallableCompiler({runner,cacheRoot:join(out,'cache')});
const flags=['-swift-version','5','-I',out,'-L',out,'-Xlinker','-rpath','-Xlinker',out];
const swift=args=>run('/usr/bin/xcrun',['swiftc',...flags,...args]);
const shim=save('Shim.swift','import SwiftUI\n@MainActor final class SwiftSimLiveObserver:ObservableObject {static let shared=SwiftSimLiveObserver();@Published var revision=0}\npublic typealias Refresh=SwiftSimRefresh\n@MainActor public func refresh(){SwiftSimLiveObserver.shared.revision += 1}\n');
swift(['-D','DEBUG','-emit-library','-emit-module','-module-name','SwiftSimLive',shim,resolve('Sources/SwiftSimLive/StatePreservingRefresh.swift'),resolve('Sources/SwiftSimLive/AddedViewState.swift'),'-o',join(out,'libSwiftSimLive.dylib')]);
const path=join(out,'Installed.swift'),module='InstalledApp';
const original=`import SwiftUI
@MainActor public final class Probe: ObservableObject {
 public init(){}; public var existing=0;public var added=0;public var draft="";public var later=false;public var childAppearances=0
 public var setExisting:((Int)->Void)?;public var setAdded:((Int)->Void)?;public var setDraft:((String)->Void)?;public var setLater:((Bool)->Void)?
}
@MainActor public struct Child:View {let probe:Probe;@State private var value=99;public var body:some View {Text(String(value)).onAppear{probe.childAppearances += 1}}}
@MainActor public struct Installed:View {
 let probe:Probe; @State private var existing=0
 public init(_ probe:Probe){self.probe=probe}
 private var derived:Int { existing }
 public var body:AnyView {
  probe.existing=existing
  return AnyView(VStack{Text("original");Child(probe:probe)}.onAppear{probe.setExisting={existing=$0}})
 }
}
`;
const installed=compiler.instrument({files:[{path,source:original}]}).files[0];assert(installed);save('Installed.swift',installed.source);
swift(['-emit-library','-emit-module','-enable-private-imports','-Xfrontend','-enable-implicit-dynamic','-module-name',module,path,'-lSwiftSimLive','-o',join(out,'libInstalledApp.dylib')]);
const first=original.replace('@State private var existing=0','@State private var existing=0\n @State private var added=0\n @State private var draft=""').replace('private var derived:Int { existing }','private var derived:Int { added }').replace('probe.existing=existing','probe.existing=existing;probe.added=derived;probe.draft=draft\n let binding=$added, text=$draft\n probe.setAdded={binding.wrappedValue=$0};probe.setDraft={text.wrappedValue=$0}').replace('Text("original")','Text("patch1")');
const second=first.replace('@State private var draft=""','@State private var draft=""\n @State private var later=false').replace('probe.draft=draft','probe.draft=draft;probe.later=later;probe.setLater={later=$0}').replace('Text("patch1")','Text("patch2")');
const input=(n,before,after)=>({module,generation:String(n).repeat(32),allowAdditive:true,allowSharedAdditive:true,allowAddedState:true,stateGeneration:n,availableModules:['SwiftUI'],statefulBodies:{[path]:['Installed','Child']},moduleSources:[{path,source:original}],files:[{path,before,after,installedBaseline:original}]});
for(const [n,before,after] of [[1,original,first],[2,first,second],[3,second,original]]){
 const g=compiler.generate(input(n,before,after));save(`generation${n}.json`,JSON.stringify(g,null,2));assert.equal(g.addedStateProtocol,1);assert.equal(g.addedStateGeneration,n);assert.equal(g.refreshStrategy,'preserve-state-v1');
 const p=save(`Patch${n}.swift`,g.sources[0]);const dylib=join(out,`libPatch${n}.dylib`);
 swift(['-emit-library','-module-name',`Patch${n}`,p,'-lSwiftSimLive','-lInstalledApp','-o',dylib]);
 const proof=compiler.inspectCoverage({dylibPath:dylib,generation:g,moduleName:`Patch${n}`});assert.equal(proof.replacementProof.swift_replacements,2);save(`proof${n}.json`,JSON.stringify(proof,null,2));
}
for(const [negative, after] of [first.replace('var added=0','var added=Date()'),first.replace('var added=0','var added: NSObject = NSObject()'),first.replace('@State private var added=0','@State(initialValue:0) private var added:Int'),first.replace('let binding=$added','let binding=_added.projectedValue'),first.replace('let binding=$added, text=$draft','let binding=$added, text=$draft\n let _ = { ($draft: SwiftUI.Binding<String>) in $draft }'),first.replace('var added=0','var added: Int=0')+'\ntypealias Int = Double\n',first.replace('public struct Installed:View {','public struct Installed:View { typealias State<T> = SwiftUI.State<T>;'),first+'\ntypealias IntegerLiteralType = Double\n',first.replace('var added=0','var added = -1')+'\nprefix func -(_ x: Int) -> Int { x }\n'].entries()) assert.throws(()=>compiler.generate(input(4,original,after)),undefined,`negative ${negative}`);
assert.doesNotThrow(()=>compiler.generate(input(4,original,first+'\nstruct Other { enum State { case idle } }\n')));
assert.throws(()=>compiler.generate(input(4,first,first.replace('var added=0','var added=1'))));
assert.throws(()=>compiler.generate(input(4,second,first)));
let native=`import SwiftUI
import AppKit
import Darwin
import SwiftSimLive
import InstalledApp
@main enum Run { @MainActor static func main(){
 let app=NSApplication.shared;app.setActivationPolicy(.prohibited)
 let window=NSWindow(contentRect:NSRect(x:-10000,y:-10000,width:400,height:400),styleMask:.borderless,backing:.buffered,defer:false)
 let a=Probe(),b=Probe();window.contentView=NSHostingView(rootView:VStack{Installed(a);Installed(b)});window.orderFront(nil)
 var images:[UnsafeMutableRawPointer]=[];var oldCount:((Int)->Void)?
 func load(_ n:Int){guard let h=dlopen(CommandLine.arguments[1]+"/libPatch"+String(n)+".dylib",RTLD_NOW|RTLD_GLOBAL) else{fatalError(String(cString:dlerror()))};images.append(h);refresh()}
 DispatchQueue.main.asyncAfter(deadline:.now()+0.3){a.setExisting?(7);b.setExisting?(12)}
 DispatchQueue.main.asyncAfter(deadline:.now()+0.7){precondition(a.existing==7&&b.existing==12);load(1)}
 DispatchQueue.main.asyncAfter(deadline:.now()+1.2){precondition(a.existing==7&&b.existing==12);precondition(a.added==0&&b.added==0);a.setAdded?(9);a.setDraft?("kept");b.setAdded?(22);b.setDraft?("separate")}
 DispatchQueue.main.asyncAfter(deadline:.now()+1.7){precondition(a.added==9&&b.added==22);oldCount=a.setAdded;load(2)}
 DispatchQueue.main.asyncAfter(deadline:.now()+2.2){precondition(a.existing==7&&b.existing==12);precondition(a.added==9&&b.added==22);precondition(a.draft=="kept"&&b.draft=="separate");precondition(!a.later);a.setLater?(true);oldCount?(10)}
 DispatchQueue.main.asyncAfter(deadline:.now()+2.7){precondition(a.added==10&&b.added==22);precondition(a.later && !b.later);precondition(a.childAppearances==1&&b.childAppearances==1);print("ADDITIVE_STATE_PASS existing=7/12 added=10/22 draft=kept/separate later=true/false childAppearances=1/1 wrapperBytes=\\(MemoryLayout<Refresh>.size)");window.close();app.stop(nil);exit(0)}
 app.run()
}}
`;
const finish='print("ADDITIVE_STATE_PASS';const at=native.indexOf(finish);assert(at>0);const end=native.indexOf('exit(0)',at)+7;const printed=native.slice(at,end);native=native.slice(0,at)+'load(3)'+native.slice(end);native=native.replace(' app.run()',' DispatchQueue.main.asyncAfter(deadline:.now()+3.2){precondition(a.existing==7&&b.existing==12);precondition(a.childAppearances==1&&b.childAppearances==1);'+printed+'}\n app.run()');
swift(['-parse-as-library',save('Runner.swift',native),'-lSwiftSimLive','-lInstalledApp','-o',join(out,'runner')]);const receipt=run(join(out,'runner'),[out]);assert.match(receipt,/ADDITIVE_STATE_PASS/);save('receipt.json',JSON.stringify({passed:true,receipt},null,2));console.log(receipt.trim());

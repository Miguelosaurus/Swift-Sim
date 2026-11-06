#!/usr/bin/env node
// Immutable captured-iPhone compilation only. No engine requests or phone edits.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { classifyPrivateAdditiveEditSet, prepareCompleteQueuedLivePatch } from '../../../../mac-helper/src/liveReload.js';
const out=resolve(process.argv[2]);assert(!existsSync(out));mkdirSync(out,{recursive:true,mode:0o700});
const hash=s=>createHash('sha256').update(s).digest('hex');
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2),{mode:0o600});
const manifestPath=join(homedir(),'.swift-sim/live/compilations.json'), manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const ctx=manifest.compilations.find(c=>c.moduleName==='ZenicsCalisthenicsVideo'), path=ctx.sources.find(p=>basename(p)==='ContentView.swift');
const original=readFileSync(path,'utf8');assert.equal(hash(original),manifest.sourceBaselines[path]);
const helperPath=join(dirname(path),'SwiftSimStatefulQualificationHelpers.swift'), viewPath=join(dirname(path),'SwiftSimStatefulQualificationBadge.swift');
assert(!existsSync(helperPath)&&!existsSync(viewPath));
const feedback='        .sensoryFeedback(.selection, trigger: selectedTab)';assert.equal(original.split(feedback).length,2);
const root=original.replace(feedback,'        .overlay(alignment: .top) { SwiftSimStatefulQualificationBadge() }\n'+feedback);
const helper=n=>`func swiftSimStatefulQualificationTitle(_ count: Int) -> String { "State ${n}: \\(count)" }\n`;
const view=`import SwiftUI
struct SwiftSimStatefulQualificationBadge: View {
 @State private var count = 0
 @State private var draft = "start"
 @Environment(\\.locale) private var locale
 var body: some View {
  VStack {
   Button(swiftSimStatefulQualificationTitle(count)) { count += 1 }.accessibilityIdentifier("swiftSimStateCounter")
   TextField("Draft", text: $draft).accessibilityIdentifier("swiftSimStateDraft")
   Text("Draft: \\(draft)").accessibilityIdentifier("swiftSimStateDraftReceipt")
  }.font(.caption.weight(.semibold)).padding(8).background(.teal.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
 }
}
`;
const originals={[path]:original,[helperPath]:'',[viewPath]:''};
const file=(path,beforeSource,afterSource)=>({path,beforeSource,afterSource,kind:'swift',status:'modified'});
const variants=[[file(path,original,root),file(helperPath,'',helper(1)),file(viewPath,'',view)],[file(helperPath,helper(1),helper(2))],[file(path,root,original),file(helperPath,helper(2),''),file(viewPath,view,'')]];
save('snapshots.json',{originals,variants});let origins=[];const results=[];
for(const [i,deltas] of variants.entries()) {
 const projected=i===1?[file(path,root,root),...deltas,file(viewPath,view,view)]:deltas;
 const files=projected.map(f=>({...f,installedBaseline:originals[f.path]}));
 const classified=classifyPrivateAdditiveEditSet(files,{manifest,baselineForFile:p=>originals[p]});assert.equal(classified?.route,'hot-reload');
 const record={requestId:`stateful-captured-${Date.now()}-${i}`,snapshotDigest:hash(JSON.stringify(deltas)),expiresAt:Date.now()+3600000,scope:{binaryIdentity:`${manifest.binaryIdentity.executable_uuid}:${manifest.binaryIdentity.debug_dylib_uuid}`,sessionIdentity:'captured-stateful-process'},files,statefulOrigins:origins};
 const prepared=prepareCompleteQueuedLivePatch(record,{manifestPath,artifactRoot:join(out,'artifacts'),patchRoot:join(out,'patches')});
 assert.equal(prepared.refreshStrategy,'preserve-state-v1');
 assert.equal(prepared.replacementProof.swift_replacements,i===1?2:1);
 if(i<2){assert.equal(prepared.statefulComponentProtocol,1);assert.equal(prepared.statefulOrigins.length,1);if(i===1)assert.deepEqual(prepared.statefulOrigins,origins);origins=prepared.statefulOrigins;}
 results.push({variant:i+1,classified,prepared});save('results.json',results);console.log(JSON.stringify({variant:i+1,compiled:true,replacements:prepared.replacementProof.swift_replacements}));
}
assert.equal(hash(readFileSync(path)),manifest.sourceBaselines[path]);assert(!existsSync(helperPath)&&!existsSync(viewPath));
console.log(JSON.stringify({complete:true,sourceUnchanged:true,phoneRequests:0}));

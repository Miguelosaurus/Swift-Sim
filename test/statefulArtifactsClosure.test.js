import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { statefulCompilerOrigins, completeStatefulMetadata } from '../mac-helper/src/liveStatefulArtifacts.js';
import { retainedStatefulOrigins } from '../mac-helper/src/liveDeliverySnapshots.js';
const scope = {project:'/App/App.xcodeproj',scheme:'App',appIdentity:'app',binaryIdentity:'binary',sessionIdentity:'process'};
const origin = (id, owner) => ({path:'/App/View.swift',owner,module:`SwiftSimLivePatch_${id.repeat(64)}`,sourceFile:'Replacement0.swift',layoutDigest:'a'.repeat(64),modulePath:`/patches/${id}/SwiftSimLivePatch_${id.repeat(64)}.swiftmodule`,moduleDigest:'b'.repeat(64),artifactPath:`/artifacts/${id}.dylib`,artifactDigest:'c'.repeat(64),requestId:`request-${id}`,processIdentity:'process',binaryIdentity:'binary',resourceDigest:'d'.repeat(64)});
test('a surviving pinned module retains its process dependency closure after an earlier view disappears', () => {
 const first=origin('1','First'), second=origin('2','Second');
 const descriptor=Object.fromEntries(['path','owner','module','sourceFile','layoutDigest'].map(key=>[key,second[key]]));
 const metadata=completeStatefulMetadata({statefulComponentProtocol:1,statefulComponents:[],statefulOriginUses:[descriptor]},[first,second],{record:{scope}});
 assert.deepEqual(metadata.statefulOrigins,[first,second]);
 const retained=retainedStatefulOrigins({records:[],desiredStates:[{scope,revoked:false,statefulOrigins:metadata.statefulOrigins}]},Date.now());
 assert.deepEqual(retained,[first,second]);
 assert.equal(completeStatefulMetadata({statefulComponentProtocol:0},[first,second],{record:{scope}}).statefulOrigins,undefined);
});


test('new component original State names survive metadata, verification, compiler projection and dependency retention', t => {
 const root=mkdtempSync(join(tmpdir(),'swift-sim-origin-names-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const key='1'.repeat(64), moduleName=`SwiftSimLivePatch_${key}`;
 const artifactRoot=join(root,'artifacts'), patchRoot=join(root,'patches');
 mkdirSync(artifactRoot,{mode:0o700});mkdirSync(patchRoot,{mode:0o700});
 const modulePath=join(patchRoot,`queued_${key}`,moduleName+'.swiftmodule');
 mkdirSync(dirname(modulePath),{mode:0o700});writeFileSync(modulePath,'module',{mode:0o600});
 const artifactPath=join(artifactRoot,`eval_injection_swift_sim_dynamic_${key}.dylib`);
 writeFileSync(artifactPath,'signed image',{mode:0o600});
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const artifactDigest=digest('signed image'), resourceDigest=digest('generator');
 const record={scope,requestId:'request-1'};
 const generation={statefulComponentProtocol:1,statefulOriginUses:[],statefulComponents:[{path:'/App/View.swift',owner:'Counter',sourceFileIndex:0,layoutDigest:digest('layout'),stateNames:['draft','count']}]};
 const metadata=completeStatefulMetadata(generation,[],{record,moduleName,modulePath,artifactPath,artifactDigest,resourceDigest});
 assert.deepEqual(metadata.statefulOrigins[0].stateNames,['count','draft']);
 writeFileSync(artifactPath+'.json',JSON.stringify({key,requestId:record.requestId,artifactDigest,binaryIdentity:scope.binaryIdentity,processIdentity:scope.sessionIdentity,statefulComponentProtocol:1,resourceDigest}),{mode:0o600});
 const compiler=statefulCompilerOrigins({...record,statefulOrigins:metadata.statefulOrigins},{artifactRoot,patchRoot,resourceDigest});
 assert.deepEqual(compiler.descriptors[0],{path:'/App/View.swift',owner:'Counter',module:moduleName,sourceFile:'Replacement0.swift',layoutDigest:digest('layout'),stateNames:['count','draft']});
 const reused=completeStatefulMetadata({statefulComponentProtocol:1,statefulComponents:[],statefulOriginUses:[compiler.descriptors[0]]},metadata.statefulOrigins,{record});
 assert.deepEqual(reused.statefulOrigins,metadata.statefulOrigins);
 const retained=retainedStatefulOrigins({records:[],desiredStates:[{scope,revoked:false,statefulOrigins:reused.statefulOrigins}]},Date.now());
 assert.deepEqual(retained[0].stateNames,['count','draft']);
 const legacy=completeStatefulMetadata({...generation,statefulComponents:[{...generation.statefulComponents[0],stateNames:undefined}]},[],{record,moduleName,modulePath,artifactPath,artifactDigest,resourceDigest});
 assert.equal(Object.hasOwn(legacy.statefulOrigins[0],'stateNames'),false);
});

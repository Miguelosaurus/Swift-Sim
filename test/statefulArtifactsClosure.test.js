import test from 'node:test';
import assert from 'node:assert/strict';
import { completeStatefulMetadata } from '../mac-helper/src/liveStatefulArtifacts.js';
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

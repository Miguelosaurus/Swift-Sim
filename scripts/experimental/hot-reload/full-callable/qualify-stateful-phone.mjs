#!/usr/bin/env node
// Explicit, staged acceptance through the normal helper. User keeps phone input.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { deliverChange } from '../../../../dist/mac-helper/src/changeDelivery.js';
import { liveDeliveryService } from '../../../../dist/mac-helper/src/liveDeliveryService.js';
import { readAppContext } from '../../../../dist/mac-helper/src/appContext.js';
assert.equal(process.argv[2],'--phone-ready');
const fixture=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8')), out=resolve(process.argv[4]), stage=Number(process.argv[5]);
assert([1,2,3].includes(stage));mkdirSync(out,{recursive:true,mode:0o700});
const manifest=JSON.parse(readFileSync(join(homedir(),'.swift-sim/live/compilations.json'),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const unchanged=()=>Object.entries(fixture.originals).every(([p,s])=>s===''?!existsSync(p):hash(readFileSync(p))===hash(s)&&hash(s)===manifest.sourceBaselines[p]);
assert(unchanged());assert.deepEqual(fixture.variants.map(v=>v.length),[3,1,3]);
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2),{mode:0o600});
const result=existsSync(join(out,'result.json'))?JSON.parse(readFileSync(join(out,'result.json'),'utf8')):{startedAt:new Date().toISOString(),complete:false,restorationRequired:false,steps:[]};
if(result.error){(result.recoveredErrors ||= []).push({stage,message:result.error});delete result.error;save('result.json',result);}
const service=liveDeliveryService();assert(result.steps.length>=stage-1);
let step=result.steps[stage-1];
if(!step){
 assert.equal(result.steps.length,stage-1);
 const response=await deliverChange({project:manifest.binding.projectPath,scheme:manifest.binding.scheme,liveOnly:true,files:fixture.variants[stage-1]});
 save(`submitted-${stage}.json`,response);assert.equal(response.outcome,'queued',JSON.stringify(response));
 step={stage,requestId:response.delivery.requestId,confirmed:false};result.steps.push(step);result.restorationRequired=true;save('result.json',result);
}
const deadline=Date.now()+180000;
try{
 let record;
 while(Date.now()<deadline){
  const status=service.status(step.requestId);save(`status-${stage}.json`,status);
  if(status.outcome==='hot-reloaded'){record=service.queue.get(status.delivery.requestId);break;}
  if(status.outcome!=='queued'&&status.reasonCode!=='QUEUE_APPLY_UNCONFIRMED')throw Error(`Request retained: ${status.reasonCode||status.outcome}`);
  await new Promise(done=>setTimeout(done,500));
 }
 assert(record,'Request retained at deadline; never resubmit');save(`record-${stage}.json`,record);
 assert.equal(record.proof?.refreshed,true);assert.equal(record.proof?.refreshStrategy,'preserve-state-v1');
 assert.equal(record.proof.replacementCoverage.complete_replacement_coverage,true);
 assert.equal(record.proof.replacementCoverage.dynamic_replacements,stage===2?3:1);
 if(stage<3){assert.equal(record.preparedPatch.statefulComponentProtocol,1);assert.equal(record.preparedPatch.statefulOrigins.length,2);}
 if(stage>1){assert.equal(record.scope.binaryIdentity,result.steps[0].binaryIdentity);assert.equal(record.scope.sessionIdentity,result.steps[0].sessionIdentity);assert(record.proof.revision>result.steps[stage-2].revision);}
 Object.assign(step,{confirmed:true,revision:record.proof.revision,binaryIdentity:record.scope.binaryIdentity,sessionIdentity:record.scope.sessionIdentity});
 save('result.json',result);
 await new Promise(done=>setTimeout(done,2200));
 const context=await readAppContext({project:manifest.binding.projectPath,scheme:manifest.binding.scheme,elements:true,artifactRoot:out});save(`context-${stage}.json`,context);
 step.contextAvailable=context.outcome==='context-ready';
 if(stage===3){result.complete=true;result.restorationRequired=false;}
 console.log(JSON.stringify({stage,confirmed:true,revision:step.revision,contextAvailable:step.contextAvailable,restored:stage===3}));
}catch(error){result.error=String(error.message).slice(0,400);throw error;}
finally{result.sourceUnchanged=unchanged();result.updatedAt=new Date().toISOString();save('result.json',result);}

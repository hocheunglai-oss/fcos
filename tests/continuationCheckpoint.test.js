import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { harmonizeContinuationCheckpoint, assertContinuationCheckpointConsistency, writeAuthoritativeContinuation } from '../scripts/lib/hosted-release/continuation-checkpoint.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const update = { status:'active_local_workflow_repair', next:'Repair the failed verifier without replaying the probe.',
  evidenceRefs:[{path:'/LOCAL/evidence',sha256:'a'.repeat(64)}], consumption:{remoteStatusPosts:1,organisationsProbeAttempts:1},pendingHumanDecision:null };
test('stale top-level aliases are replaced together while the original history and outcomes remain intact',()=>{
 const old={capturedAt:'2026-10-01T00:00:00Z',status:'waiting_human_old',next:'Ask an answered question',activeContinuation:{status:'active_new',next:'Already dispatched',unknown:['preserve']},immutableHistory:{consumed:'original-id'}};
 const next=harmonizeContinuationCheckpoint(old,update,{now:()=>Date.parse('2026-11-03T00:00:00Z')});
 assertContinuationCheckpointConsistency(next);assert.equal(next.historicalCurrentStates[0].next,old.next);
 assert.equal(old.status,'waiting_human_old');assert.deepEqual(next.activeContinuation.unknown,['preserve']);assert.equal(next.immutableHistory.consumed,'original-id');
 const contradictory=structuredClone(next);contradictory.next='Replay it';assert.throws(()=>assertContinuationCheckpointConsistency(contradictory),/CONTRADICTORY/);
});
test('an answered decision cannot produce a waiting-human phase',()=>{
 assert.throws(()=>harmonizeContinuationCheckpoint({}, {...update,status:'waiting_human_release',pendingHumanDecision:{presented:true,actualAnswerReceived:true,expectedAnswer:'approve',scope:{sha256:'a'.repeat(64)}}}),/UNANSWERED/);
});
test('consumed counts cannot fall and unresolved work cannot be called complete',()=>{
 const previous={currentState:{consumption:{remoteStatusPosts:1}}};
 assert.throws(()=>harmonizeContinuationCheckpoint(previous,{...update,consumption:{remoteStatusPosts:0}}),/CANNOT_DECREASE/);
 assert.throws(()=>harmonizeContinuationCheckpoint({}, {...update,status:'complete',productionStagesVerified:0,remainingRequiredPaths:2}),/NOT_COMPLETE/);
 assert.throws(()=>harmonizeContinuationCheckpoint({activeContinuation:{newWorkflowDispatches:1}}, {...update,consumption:{workflowDispatches:0}}),/CANNOT_DECREASE/);
 assert.throws(()=>harmonizeContinuationCheckpoint({currentState:{consumption:{remoteStatusPosts:0}},activeContinuation:{normalStatusRemoteAdmitted:1}}, {...update,consumption:{remoteStatusPosts:0}}),/CANNOT_DECREASE/);
});
test('pending decisions survive omitted updates and answered approval provenance is retained',()=>{
 const pending={presented:true,actualAnswerReceived:false,expectedAnswer:'approve',scope:{sha256:'a'.repeat(64)}};
 assert.throws(()=>harmonizeContinuationCheckpoint({pendingHumanDecision:pending}, update),/CANNOT_DISAPPEAR/);
 const omitted={...update};delete omitted.pendingHumanDecision;
 assert.deepEqual(harmonizeContinuationCheckpoint({pendingHumanDecision:pending},omitted).pendingHumanDecision,pending);
 const answered={...pending,actualAnswerReceived:true,actualApprovalRef:{path:'/LOCAL/approval',sha256:'b'.repeat(64)}};
 const next=harmonizeContinuationCheckpoint({pendingHumanDecision:answered},update);assert.deepEqual(next.completedHumanDecisionHistory,[answered]);assert.equal(next.pendingHumanDecision,null);
 const other={...pending,scope:{sha256:'c'.repeat(64)}};
 assert.throws(()=>harmonizeContinuationCheckpoint({pendingHumanDecision:pending},{...update,pendingHumanDecision:other}),/CANNOT_DISAPPEAR/);
 const replaced=harmonizeContinuationCheckpoint({pendingHumanDecision:answered},{...update,pendingHumanDecision:other});assert.deepEqual(replaced.completedHumanDecisionHistory,[answered]);
 assert.throws(()=>harmonizeContinuationCheckpoint({pendingHumanDecision:answered},{...update,pendingHumanDecision:pending}),/CANNOT_REOPEN/);
 const missingApproval={...answered};delete missingApproval.actualApprovalRef;
 assert.throws(()=>harmonizeContinuationCheckpoint({pendingHumanDecision:answered},{...update,pendingHumanDecision:missingApproval}),/PROVENANCE_IMMUTABLE/);
 assert.throws(()=>harmonizeContinuationCheckpoint({pendingHumanDecision:{...answered,questionItemId:'LOCAL-real-event'}},{...update,pendingHumanDecision:answered}),/PROVENANCE_IMMUTABLE/);
});
test('an existing writer lock is never removed or taken over',()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'fcos-checkpoint-lock-')));
 try {
  const path=join(directory,'checkpoint.json');writeFileSync(path,'{}');writeFileSync(path+'.write-lock','foreign-owner');
  assert.throws(()=>writeAuthoritativeContinuation(path,update,{expectedPriorSha256:sha('{}')}),/WRITER_BUSY/);
  assert.equal(readFileSync(path+'.write-lock','utf8'),'foreign-owner');assert.equal(readFileSync(path,'utf8'),'{}');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('two real processes cannot both replace the same checkpoint version',async()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'fcos-checkpoint-race-')));
 try {
  const path=join(directory,'checkpoint.json'),proof=join(directory,'proof.json'),worker=join(directory,'writer.mjs');writeFileSync(path,'{}');writeFileSync(proof,'actual LOCAL evidence');
  const moduleUrl=pathToFileURL(new URL('../scripts/lib/hosted-release/continuation-checkpoint.mjs',import.meta.url).pathname).href;
  writeFileSync(worker,`import {writeAuthoritativeContinuation} from ${JSON.stringify(moduleUrl)};process.on('message',m=>{try{writeAuthoritativeContinuation(m.path,m.update,{expectedPriorSha256:m.sha});process.send({ok:true});}catch(e){process.send({ok:false,code:e.message});}finally{process.disconnect();}});process.send({ready:true});`);
  const payload={path,sha:sha('{}'),update:{...update,evidenceRefs:[{path:proof,sha256:sha(readFileSync(proof))}]}};
  const writers=[0,1].map(()=>fork(worker,{stdio:['ignore','ignore','ignore','ipc']}));
  const completed=writers.map((child,index)=>new Promise((resolve,reject)=>{child.once('error',reject);child.on('message',m=>{if(m.ready)child.send({...payload,update:{...payload.update,next:'LOCAL writer '+index}});else resolve(m);});}));
  const results=await Promise.all(completed);assert.equal(results.filter(r=>r.ok).length,1);
  assert.match(results.find(r=>!r.ok).code,/WRITER_BUSY|COMPARE_AND_SWAP/);assertContinuationCheckpointConsistency(JSON.parse(readFileSync(path)));assert.equal(existsSync(path+'.write-lock'),false);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('writer verifies physical evidence and CAS before any replacement',()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'fcos-checkpoint-')));
 try {
  const path=join(directory,'checkpoint.json'), proof=join(directory,'proof.json');writeFileSync(path,'{"status":"old"}\n');writeFileSync(proof,'{"actual":true}\n');
  const original=readFileSync(path),actual={...update,evidenceRefs:[{path:proof,sha256:sha(readFileSync(proof))}]};
  assert.throws(()=>writeAuthoritativeContinuation(path,actual,{expectedPriorSha256:'0'.repeat(64)}),/COMPARE_AND_SWAP/);assert.deepEqual(readFileSync(path),original);
  const result=writeAuthoritativeContinuation(path,actual,{expectedPriorSha256:sha(original)});assert.equal(result.currentState.stateDoesNotGrantAuthority,true);
  const current=readFileSync(path);writeFileSync(proof,'changed');assert.throws(()=>writeAuthoritativeContinuation(path,actual,{expectedPriorSha256:sha(current)}),/EVIDENCE_CHANGED/);assert.deepEqual(readFileSync(path),current);
 } finally {rmSync(directory,{recursive:true,force:true});}
});

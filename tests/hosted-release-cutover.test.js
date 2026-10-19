import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createNotificationChallenge } from '../supabase/functions/release-coordinator/core.mjs';
import { inspectReviewedCutover, installPermanentLegacyFence, reviewedInstallEpochPlan, HOSTED_CUTOVER_LEGACY_GUARD, assertHostedCutoverLegacyGuard } from '../scripts/hosted-release-cutover.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex'),H='a'.repeat(64);
const HISTORICAL_OWNER='01a0b0e2-b1af-7bf0-963d-3138c42648e3';
async function fixture(t,{consolidated=false,historical=false}={}){
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'fcos-cutover-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const base=path.join(root,'legacy'),intents=path.join(base,'intents');await mkdir(intents,{recursive:true,mode:0o700});
 const put=async(name,value)=>{const file=path.join(root,name),raw=typeof value==='string'?value:JSON.stringify(value);await writeFile(file,raw,{mode:0o600});return{path:file,sha256:sha(raw)};};
 const helper=await put('guard.py',consolidated?await readFile(new URL('./helpers/xero-recovery-joined-coordinator.fixture.py',import.meta.url),'utf8'):'# Fixture only: actual shared lock uses coordination-mutex.lock\n');
 const leasePath=path.join(base,'live-provider-write-lease.json'),owners=consolidated?{production:'01a0f08b-7fcb-7870-9edc-343e16052b62',reconciliation:'01a0f08b-7fcb-7870-9edc-343e16052b62'}:{production:'production-owner',reconciliation:'financial-owner'};
 const workflow=await put('workflow.json',{unifiedCoordinator:{epoch:'legacy-epoch',writeLeasePath:leasePath,writeLeaseHelper:{path:helper.path,sha256:helper.sha256,localCoordinationGuardAccepted:true,independentReviewPending:false,providerAuthority:false},objectives:Object.fromEntries(Object.entries(owners).map(([id,ownerThreadId])=>[id,{ownerThreadId}]))}});
 const writers=[];for(const [id,ownerThreadId]of Object.entries(owners))writers.push({id,ownerThreadId,disabledEvidence:await put(`${id}-stopped.json`,{kind:'fcos_legacy_writer_fence',writerId:id,ownerThreadId,disabled:true,sourceSha256:H})});
 const intentOwner=historical?HISTORICAL_OWNER:owners.production;
 const intentPath=path.join(intents,'one-intent.json'),raw=JSON.stringify(historical?{kind:'source_bound_financial_decision_owner_mission_intent_v1',operation:'old-op',ownerThreadId:intentOwner,outcome:'unknown'}:{operationId:'old-op',outcome:'unknown'});await writeFile(intentPath,raw,{mode:0o600});
 const evidence={path:intentPath,sha256:sha(raw)},ownerReadback=await put('owner-readback.json',{kind:'fcos_legacy_owner_readback',operationId:'old-op',ownerThreadId:intentOwner,intentSha256:evidence.sha256,outcome:'unknown'});
 const review={kind:'fcos_hosted_cutover_review_v1',nextEpoch:2,legacyEpoch:'legacy-epoch',notificationChallenge:createNotificationChallenge(),coordinationOnly:true,providerAuthorityGranted:false,helper,workflow,leasePath,
  existingOwners:owners,requiredWriterIds:['production','reconciliation'],writers,intentInventories:[{directory:intents,entries:[{name:'one-intent.json',sha256:evidence.sha256}]}],uncertainIntents:[{operationId:'old-op',ownerThreadId:intentOwner,evidence,ownerReadback}]};
 const reviewed=await put('review.json',review),options={reviewPath:reviewed.path,reviewSha256:reviewed.sha256,expectedHelperSha256:helper.sha256,fixtureRoot:root};
 return {root,base,leasePath,review,options,put};
}
test('reviewed permanent fence occupies canonical shared lease; unknowns import unchanged and fence never expires/replaces',async t=>{
 const f=await fixture(t),review=inspectReviewedCutover(f.options);assert.equal(review.uncertainties.length,1);
 const proof=installPermanentLegacyFence(f.options),before=await readFile(f.leasePath);assert.equal(proof.proofHash,sha(before));
 const plan=reviewedInstallEpochPlan(f.options,{expectedFenceSha256:proof.proofHash});assert.equal(plan.parameters[0],2);assert.equal(plan.parameters[1].uncertainties[0].operationId,'old-op');assert.deepEqual(plan.parameters[1].notificationChallenge,f.review.notificationChallenge);
 assert.equal(plan.providerAuthorityGranted,false);assert.equal(JSON.parse(before).permanent,true);assert.equal(JSON.parse(before).leaseId,undefined);
 assert.throws(()=>installPermanentLegacyFence(f.options),/FENCE_REFUSED/);assert.deepEqual(await readFile(f.leasePath),before);
 assert.throws(()=>reviewedInstallEpochPlan(f.options,{expectedFenceSha256:H}),/FENCE_MISMATCH/);
});
test('any existing lease retains its exact bytes regardless of elapsed time or declared review',async t=>{
 const f=await fixture(t),original=JSON.stringify({ownerThreadId:'foreign',expiresAt:0,outcome:'unknown'});await writeFile(f.leasePath,original,{mode:0o600});
 assert.throws(()=>installPermanentLegacyFence(f.options),/FENCE_REFUSED/);assert.equal(await readFile(f.leasePath,'utf8'),original);
});
test('changed/missing intent coverage, helper bytes, snapshot, writer evidence and symlinks fail before fencing',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.base,'intents','new-intent.json'),'unknown',{mode:0o600});assert.throws(()=>installPermanentLegacyFence(f.options),/INVENTORY_CHANGED/);
 await rm(path.join(f.base,'intents','new-intent.json'));
 const omitted={...f.review,uncertainIntents:[]},ref=await f.put('omitted.json',omitted);assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:ref.path,reviewSha256:ref.sha256}),/UNCLASSIFIED_INTENT/);
 await writeFile(f.review.helper.path,'changed',{mode:0o600});assert.throws(()=>installPermanentLegacyFence(f.options),/REFERENCE_CHANGED/);
 const linked=path.join(f.root,'linked.json');await symlink(f.options.reviewPath,linked);assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:linked}),/SYMLINK/);
});

test('cutover review pins the canonical notification challenge before any fence',async t=>{
 const f=await fixture(t);
 for(const patch of [undefined,{...f.review.notificationChallenge,operator:'other'},{...f.review.notificationChallenge,repository:'other/fcos'},{...f.review.notificationChallenge,challenge:'short'}]){
  const ref=await f.put('invalid-notification.json',{...f.review,notificationChallenge:patch});
  assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:ref.path,reviewSha256:ref.sha256}),/NOTIFICATION_CHALLENGE_REQUIRED/);
 }
});

// This tests the live CLI pin boundary, independently of temporary-fixture path overrides.
test('cutover admits only the reviewed Features guard pair without repinning historical protocols',()=>{
 const current=HOSTED_CUTOVER_LEGACY_GUARD;
 assert.equal(current.sha256,'8ed4eda312b62c3b02c3a0a768ddd024a2a819af5f0f1194da47ef2a2d62fd38');
 assert.ok(current.path.endsWith('/features-reconciliation-owner-transition-v1/coordinator_guard.py'));
 assert.doesNotThrow(()=>assertHostedCutoverLegacyGuard(current,current.sha256));
 const old='24758c4191afae79fa4b149a166c450ac1cac20951a5f648f3cc3853969aa31d';
 for(const [helper,expected]of [
  [{...current,sha256:old},old],
  [{...current,path:current.path.replace('features-reconciliation-owner-transition-v1','public-runtime-material-upload-cancellation-v1')},current.sha256],
  [{...current,sha256:old},current.sha256],
  [current,old],
  [null,current.sha256],
 ])assert.throws(()=>assertHostedCutoverLegacyGuard(helper,expected),/CUTOVER_CANONICAL_HELPER_REQUIRED/);
});

test('the reviewed guard source and consolidated owner can fence a new record without rewriting original intent bytes',async t=>{
 const f=await fixture(t,{consolidated:true}),original=await readFile(f.review.uncertainIntents[0].evidence.path);
 assert.equal(f.review.helper.sha256,HOSTED_CUTOVER_LEGACY_GUARD.sha256);
 const checked=inspectReviewedCutover(f.options);assert.deepEqual(checked.existingOwners,f.review.existingOwners);
 const proof=installPermanentLegacyFence(f.options),plan=reviewedInstallEpochPlan(f.options,{expectedFenceSha256:proof.proofHash});
 assert.equal(plan.parameters[1].uncertainties[0].operationId,'old-op');
 assert.equal(plan.parameters[1].uncertainties[0].ownerThreadId,f.review.existingOwners.production);
 assert.deepEqual(await readFile(f.review.uncertainIntents[0].evidence.path),original);
 assert.equal(plan.providerAuthorityGranted,false);
});

test('pinned historical intent imports unknown unchanged without adopting current Features writer ownership',async t=>{
 const f=await fixture(t,{consolidated:true,historical:true});
 const original=await readFile(f.review.uncertainIntents[0].evidence.path),readback=await readFile(f.review.uncertainIntents[0].ownerReadback.path);
 const checked=inspectReviewedCutover(f.options);assert.equal(checked.uncertainties[0].ownerThreadId,HISTORICAL_OWNER);
 assert.equal(checked.existingOwners.reconciliation,'01a0f08b-7fcb-7870-9edc-343e16052b62');
 const proof=installPermanentLegacyFence(f.options),plan=reviewedInstallEpochPlan(f.options,{expectedFenceSha256:proof.proofHash});
 assert.equal(plan.parameters[1].uncertainties.length,1);assert.equal(plan.parameters[1].uncertainties[0].ownerThreadId,HISTORICAL_OWNER);
 assert.equal(plan.parameters[1].uncertainties[0].evidenceHash,sha(original));assert.equal(plan.providerAuthorityGranted,false);
 assert.deepEqual(await readFile(f.review.uncertainIntents[0].evidence.path),original);
 assert.deepEqual(await readFile(f.review.uncertainIntents[0].ownerReadback.path),readback);
 assert.equal(JSON.parse(await readFile(f.leasePath)).existingOwners.reconciliation,f.review.existingOwners.reconciliation);
});

test('historical import does not grant old or cross-objective writer ownership and ignores caller lineage maps',async t=>{
 const f=await fixture(t,{consolidated:true,historical:true});
 const writer={...f.review.writers[1],ownerThreadId:HISTORICAL_OWNER,disabledEvidence:await f.put('old-writer.json',{kind:'fcos_legacy_writer_fence',writerId:'reconciliation',ownerThreadId:HISTORICAL_OWNER,disabled:true,sourceSha256:H})};
 let ref=await f.put('old-writer-review.json',{...f.review,writers:[f.review.writers[0],writer]});
 assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:ref.path,reviewSha256:ref.sha256}),/FOREIGN_WRITER/);
 const foreign='11111111-1111-4111-8111-111111111111';
 ref=await f.put('caller-lineage.json',{...f.review,historicalOwners:{reconciliation:[foreign]},uncertainIntents:[{...f.review.uncertainIntents[0],ownerThreadId:foreign}]});
 assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:ref.path,reviewSha256:ref.sha256}),/INTENT_OWNER_INVALID/);
 const old=await fixture(t,{historical:true});assert.throws(()=>inspectReviewedCutover(old.options),/INTENT_OWNER_INVALID/);
 const changedWorkflow=JSON.parse(await readFile(f.review.workflow.path));changedWorkflow.unifiedCoordinator.objectives.reconciliation.ownerThreadId=HISTORICAL_OWNER;
 const workflow=await f.put('stale-owner-workflow.json',changedWorkflow);
 ref=await f.put('stale-owner-review.json',{...f.review,workflow,existingOwners:{...f.review.existingOwners,reconciliation:HISTORICAL_OWNER}});
 assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:ref.path,reviewSha256:ref.sha256}),/EXISTING_OWNER_CHANGED/);
 const current=await fixture(t),cross={...current.review.writers[0],ownerThreadId:current.review.existingOwners.reconciliation};
 ref=await current.put('cross-owner.json',{...current.review,writers:[cross,current.review.writers[1]]});
 assert.throws(()=>inspectReviewedCutover({...current.options,reviewPath:ref.path,reviewSha256:ref.sha256}),/FOREIGN_WRITER/);
});

test('historical readback keeps exact kind/hash/owner and rejects contradictory exposed intent identities',async t=>{
 const f=await fixture(t,{consolidated:true,historical:true}),intent=f.review.uncertainIntents[0];
 const original=JSON.parse(await readFile(intent.evidence.path)),readback=JSON.parse(await readFile(intent.ownerReadback.path));
 for(const patch of [{kind:'other'},{ownerThreadId:f.review.existingOwners.production},{operationId:'other'},{intentSha256:H}]){
  const ownerReadback=await f.put('bad-readback.json',{...readback,...patch}),ref=await f.put('bad-readback-review.json',{...f.review,uncertainIntents:[{...intent,ownerReadback}]});
  assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:ref.path,reviewSha256:ref.sha256}),/ACTUAL_OWNER_READBACK_REQUIRED/);
 }
 for(const patch of [{ownerThreadId:f.review.existingOwners.production},{threadId:f.review.existingOwners.production},{operation:'other'},{operationId:'other'},{lease:{ownerThreadId:f.review.existingOwners.production}},{lease:{operationId:'other'}},{kind:null}]){
  const raw=JSON.stringify({...original,...patch});await writeFile(intent.evidence.path,raw,{mode:0o600});const evidence={...intent.evidence,sha256:sha(raw)};
  const ownerReadback=await f.put('contradictory-readback.json',{...readback,intentSha256:evidence.sha256});
  const ref=await f.put('contradictory-review.json',{...f.review,intentInventories:[{...f.review.intentInventories[0],entries:[{name:'one-intent.json',sha256:evidence.sha256}]}],uncertainIntents:[{...intent,evidence,ownerReadback}]});
  assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:ref.path,reviewSha256:ref.sha256}),/INTENT_IDENTITY_MISMATCH/);
 }
});

test('original provider journal without dispatch schema retains the hash-bound owner-readback contract',async t=>{
 const f=await fixture(t,{consolidated:true,historical:true}),intent=f.review.uncertainIntents[0];
 const raw=JSON.stringify({id:'original-claim',idempotency_key:'original-fixed-claim',operation:'payment_apply',status:'unknown'});await writeFile(intent.evidence.path,raw,{mode:0o600});
 const evidence={...intent.evidence,sha256:sha(raw)},ownerReadback=await f.put('claim-readback.json',{kind:'fcos_legacy_owner_readback',operationId:intent.operationId,ownerThreadId:HISTORICAL_OWNER,intentSha256:evidence.sha256,outcome:'unknown'});
 const review={...f.review,intentInventories:[{...f.review.intentInventories[0],entries:[{name:'one-intent.json',sha256:evidence.sha256}]}],uncertainIntents:[{...intent,evidence,ownerReadback}]};
 const ref=await f.put('claim-review.json',review),options={...f.options,reviewPath:ref.path,reviewSha256:ref.sha256};
 assert.equal(inspectReviewedCutover(options).uncertainties[0].ownerThreadId,HISTORICAL_OWNER);
 const resolved=await f.put('known-claim-readback.json',{kind:'fcos_legacy_owner_readback',operationId:intent.operationId,ownerThreadId:HISTORICAL_OWNER,intentSha256:evidence.sha256,outcome:'applied'});
 const known=await f.put('known-claim-review.json',{...review,uncertainIntents:[],resolvedIntents:[{...intent,evidence,ownerReadback:resolved}]});
 assert.equal(inspectReviewedCutover({...f.options,reviewPath:known.path,reviewSha256:known.sha256}).uncertainties.length,0);
 const bad=await f.put('claim-kind-readback.json',{kind:'fcos_legacy_owner_readback',intentKind:'invented',operationId:intent.operationId,ownerThreadId:HISTORICAL_OWNER,intentSha256:evidence.sha256,outcome:'unknown'});
 const mismatch=await f.put('claim-kind-review.json',{...review,uncertainIntents:[{...intent,evidence,ownerReadback:bad}]});
 assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:mismatch.path,reviewSha256:mismatch.sha256}),/INTENT_IDENTITY_MISMATCH/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createNotificationChallenge } from '../supabase/functions/release-coordinator/core.mjs';
import { inspectReviewedCutover, installPermanentLegacyFence, reviewedInstallEpochPlan, HOSTED_CUTOVER_LEGACY_GUARD, assertHostedCutoverLegacyGuard } from '../scripts/hosted-release-cutover.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex'),H='a'.repeat(64);
async function fixture(t,{consolidated=false}={}){
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'fcos-cutover-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const base=path.join(root,'legacy'),intents=path.join(base,'intents');await mkdir(intents,{recursive:true,mode:0o700});
 const put=async(name,value)=>{const file=path.join(root,name),raw=typeof value==='string'?value:JSON.stringify(value);await writeFile(file,raw,{mode:0o600});return{path:file,sha256:sha(raw)};};
 const helper=await put('guard.py',consolidated?await readFile(new URL('./helpers/xero-recovery-joined-coordinator.fixture.py',import.meta.url),'utf8'):'# Fixture only: actual shared lock uses coordination-mutex.lock\n');
 const leasePath=path.join(base,'live-provider-write-lease.json'),owners=consolidated?{production:'01a0f08b-7fcb-7870-9edc-343e16052b62',reconciliation:'01a0f08b-7fcb-7870-9edc-343e16052b62'}:{production:'production-owner',reconciliation:'financial-owner'};
 const workflow=await put('workflow.json',{unifiedCoordinator:{epoch:'legacy-epoch',writeLeasePath:leasePath,writeLeaseHelper:{path:helper.path,sha256:helper.sha256,localCoordinationGuardAccepted:true,independentReviewPending:false,providerAuthority:false},objectives:Object.fromEntries(Object.entries(owners).map(([id,ownerThreadId])=>[id,{ownerThreadId}]))}});
 const writers=[];for(const [id,ownerThreadId]of Object.entries(owners))writers.push({id,ownerThreadId,disabledEvidence:await put(`${id}-stopped.json`,{kind:'fcos_legacy_writer_fence',writerId:id,ownerThreadId,disabled:true,sourceSha256:H})});
 const intentPath=path.join(intents,'one-intent.json'),raw=JSON.stringify({operationId:'old-op',outcome:'unknown'});await writeFile(intentPath,raw,{mode:0o600});
 const evidence={path:intentPath,sha256:sha(raw)},ownerReadback=await put('owner-readback.json',{kind:'fcos_legacy_owner_readback',operationId:'old-op',ownerThreadId:owners.production,intentSha256:evidence.sha256,outcome:'unknown'});
 const review={kind:'fcos_hosted_cutover_review_v1',nextEpoch:2,legacyEpoch:'legacy-epoch',notificationChallenge:createNotificationChallenge(),coordinationOnly:true,providerAuthorityGranted:false,helper,workflow,leasePath,
  existingOwners:owners,requiredWriterIds:['production','reconciliation'],writers,intentInventories:[{directory:intents,entries:[{name:'one-intent.json',sha256:evidence.sha256}]}],uncertainIntents:[{operationId:'old-op',ownerThreadId:owners.production,evidence,ownerReadback}]};
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

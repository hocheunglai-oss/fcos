import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inspectReviewedCutover, installPermanentLegacyFence, reviewedInstallEpochPlan } from '../scripts/hosted-release-cutover.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex'),H='a'.repeat(64);
async function fixture(t){
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'fcos-cutover-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const base=path.join(root,'legacy'),intents=path.join(base,'intents');await mkdir(intents,{recursive:true,mode:0o700});
 const put=async(name,value)=>{const file=path.join(root,name),raw=typeof value==='string'?value:JSON.stringify(value);await writeFile(file,raw,{mode:0o600});return{path:file,sha256:sha(raw)};};
 const helper=await put('guard.py','# Fixture only: actual shared lock uses coordination-mutex.lock\n');
 const leasePath=path.join(base,'live-provider-write-lease.json'),owners={production:'production-owner',reconciliation:'financial-owner'};
 const workflow=await put('workflow.json',{unifiedCoordinator:{epoch:'legacy-epoch',writeLeasePath:leasePath,writeLeaseHelper:{path:helper.path,sha256:helper.sha256,localCoordinationGuardAccepted:true,independentReviewPending:false,providerAuthority:false},objectives:Object.fromEntries(Object.entries(owners).map(([id,ownerThreadId])=>[id,{ownerThreadId}]))}});
 const writers=[];for(const [id,ownerThreadId]of Object.entries(owners))writers.push({id,ownerThreadId,disabledEvidence:await put(`${id}-stopped.json`,{kind:'fcos_legacy_writer_fence',writerId:id,ownerThreadId,disabled:true,sourceSha256:H})});
 const intentPath=path.join(intents,'one-intent.json'),raw=JSON.stringify({operationId:'old-op',outcome:'unknown'});await writeFile(intentPath,raw,{mode:0o600});
 const evidence={path:intentPath,sha256:sha(raw)},ownerReadback=await put('owner-readback.json',{kind:'fcos_legacy_owner_readback',operationId:'old-op',ownerThreadId:owners.production,intentSha256:evidence.sha256,outcome:'unknown'});
 const review={kind:'fcos_hosted_cutover_review_v1',nextEpoch:2,legacyEpoch:'legacy-epoch',coordinationOnly:true,providerAuthorityGranted:false,helper,workflow,leasePath,
  existingOwners:owners,requiredWriterIds:['production','reconciliation'],writers,intentInventories:[{directory:intents,entries:[{name:'one-intent.json',sha256:evidence.sha256}]}],uncertainIntents:[{operationId:'old-op',ownerThreadId:owners.production,evidence,ownerReadback}]};
 const reviewed=await put('review.json',review),options={reviewPath:reviewed.path,reviewSha256:reviewed.sha256,expectedHelperSha256:helper.sha256,fixtureRoot:root};
 return {root,base,leasePath,review,options,put};
}
test('reviewed permanent fence occupies canonical shared lease; unknowns import unchanged and fence never expires/replaces',async t=>{
 const f=await fixture(t),review=inspectReviewedCutover(f.options);assert.equal(review.uncertainties.length,1);
 const proof=installPermanentLegacyFence(f.options),before=await readFile(f.leasePath);assert.equal(proof.proofHash,sha(before));
 const plan=reviewedInstallEpochPlan(f.options,{expectedFenceSha256:proof.proofHash});assert.equal(plan.parameters[0],2);assert.equal(plan.parameters[1].uncertainties[0].operationId,'old-op');
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

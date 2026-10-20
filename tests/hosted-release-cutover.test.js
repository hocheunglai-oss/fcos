import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, link } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createNotificationChallenge } from '../supabase/functions/release-coordinator/core.mjs';
import { inspectReviewedCutover, installPermanentLegacyFence, reviewedInstallEpochPlan, HOSTED_CUTOVER_LEGACY_GUARD, assertHostedCutoverLegacyGuard, snapshotLegacyJournalTree, legacyProducerInventoryEntriesSha256 } from '../scripts/hosted-release-cutover.mjs';
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

async function treeFixture(t){
 const f=await fixture(t,{consolidated:true,historical:true}),directory=f.review.intentInventories[0].directory;
 const old=f.review.uncertainIntents[0],original=await readFile(old.evidence.path);await rm(old.evidence.path);
 await mkdir(path.join(directory,'journal'),{mode:0o700});await mkdir(path.join(directory,'swift-cache','empty'),{recursive:true,mode:0o700});
 const intentName='journal/original.intent.json',intent={...old,evidence:{path:path.join(directory,intentName),sha256:sha(original)}};
 await writeFile(intent.evidence.path,original,{mode:0o600});
 const journalName='journal/one.submitting.intent.json',journalPath=path.join(directory,journalName);
 await writeFile(journalPath,JSON.stringify({state:'uncertain',durable:true,lease:{ownerThreadId:intent.ownerThreadId,operationId:intent.operationId}}),{mode:0o600});
 await writeFile(path.join(directory,'swift-cache','module.pcm'),Buffer.from([0,255,1,128]),{mode:0o600});
 await writeFile(path.join(directory,'root-admission.json'),JSON.stringify({kind:'fixture_root_admission',accepted:false}),{mode:0o600});
 const producer=await f.put('producer.mjs','// Fixture producer: original intent + durable submitting record, explicit admission and cache companions.');
 const journalEvidence=[{path:journalPath,sha256:sha(await readFile(journalPath))}];intent.journalEvidence=journalEvidence;
 intent.ownerReadback=await f.put('tree-owner-readback.json',{kind:'fcos_legacy_owner_readback',ownerThreadId:intent.ownerThreadId,operationId:intent.operationId,intentSha256:intent.evidence.sha256,outcome:'unknown',journalEvidence});
 const entries=snapshotLegacyJournalTree(directory).map(item=>item.type==='directory'?item:item.name===intentName?{...item,role:'intent'}:item.name===journalName?
  {...item,role:'journal',intentName,intentSha256:intent.evidence.sha256,producerSourceSha256:producer.sha256}:
  {...item,role:'companion',category:item.name.startsWith('swift-cache/')?'build_cache':'admission',producerSourceSha256:producer.sha256});
 const proof={kind:'fcos_root_accepted_legacy_producer_inventory_v1',accepted:true,reviewerId:'/root',reviewedAt:new Date().toISOString(),directory,writerId:'production',writerSourceSha256:H,entriesSha256:legacyProducerInventoryEntriesSha256(entries),producerSources:[producer],completeSubmissionCoverageReviewed:true,providerOutcomesInferred:false,providerAuthorityGranted:false};
 const classification=await f.put('tree-classification.json',proof),inventory={kind:'fcos_legacy_producer_tree_inventory_v1',directory,writerId:'production',entries,classification};
 const review={...f.review,intentInventories:[inventory],uncertainIntents:[intent]},ref=await f.put('tree-review.json',review);
 return {...f,directory,producer,intent,journalPath,entries,proof,inventory,review,options:{...f.options,reviewPath:ref.path,reviewSha256:ref.sha256}};
}
async function changedTreeReview(f,entries,proofPatch={},reviewPatch={}){
 const classification=await f.put('changed-classification.json',{...f.proof,entriesSha256:legacyProducerInventoryEntriesSha256(entries),...proofPatch});
 const ref=await f.put('changed-tree-review.json',{...f.review,...reviewPatch,intentInventories:[{...f.inventory,entries,classification}]});
 return {...f.options,reviewPath:ref.path,reviewSha256:ref.sha256};
}
async function externalOriginalFixture(t,{opaque=false,multiple=false,outcome='unknown'}={}){
 const f=await treeFixture(t);await rm(f.intent.evidence.path);
 const lease={epoch:'legacy-epoch',objective:'production',ownerThreadId:f.review.existingOwners.production,operationId:'cleanup-op',bindingSha256:'b'.repeat(64),leaseId:'original-cleanup-lease'};
 const originalDirectory=path.join(f.root,'cycle-cleanup','setup');await mkdir(originalDirectory,{recursive:true,mode:0o700});
 const original=await f.put('cycle-cleanup/setup/cleanup.prepared.intent.json',{lease,state:'prepared',durable:true,at:'2026-10-20T14:46:03.826828+00:00'});
 const externalOriginalIntent={...original,lease};
 const journal=opaque?{kind:'additional_private_host_cleanup_attempt_v1',request:{method:'DELETE',route:'/v13/deployments/fixture-owned-host'},maximumDeleteRequests:1}:
  {kind:'private_host_setup_attempt_v1',action:'cleanup-association-0',scopeSha256:lease.bindingSha256,lease,request:{method:'PATCH',route:'/v9/projects/fixture/env/fixture',body:{customEnvironmentIds:[]}}};
 await writeFile(f.journalPath,JSON.stringify(journal),{mode:0o600});
 if(multiple)await writeFile(path.join(f.directory,'journal','cleanup.submitted.json'),JSON.stringify({kind:'fixture_cleanup_submission',lease,state:'submitted'}),{mode:0o600});
 const known=new Map(f.entries.map(item=>[item.name,item]));
 const entries=snapshotLegacyJournalTree(f.directory).map(item=>item.type==='directory'?item:known.get(item.name)?.role==='companion'?known.get(item.name):
  {...item,role:'journal',externalOriginalIntent,producerSourceSha256:f.producer.sha256});
 const journalEvidence=entries.filter(item=>item.role==='journal').map(item=>({path:path.join(f.directory,item.name),sha256:item.sha256}));
 const ownerReadback=await f.put('external-owner-readback.json',{kind:'fcos_legacy_owner_readback',...lease,intentSha256:original.sha256,outcome,journalEvidence});
 const intent={...lease,evidence:original,ownerReadback,journalEvidence};
 const originalEntries=snapshotLegacyJournalTree(originalDirectory).map(item=>({...item,role:'intent'}));
 const originalProof={...f.proof,directory:originalDirectory,entriesSha256:legacyProducerInventoryEntriesSha256(originalEntries)};
 const originalClassification=await f.put('original-classification.json',originalProof),originalInventory={...f.inventory,directory:originalDirectory,entries:originalEntries,classification:originalClassification};
 const proof={...f.proof,entriesSha256:legacyProducerInventoryEntriesSha256(entries)},classification=await f.put('external-classification.json',proof),inventory={...f.inventory,entries,classification};
 const review={...f.review,intentInventories:[inventory,originalInventory],uncertainIntents:outcome==='unknown'?[intent]:[],resolvedIntents:outcome==='unknown'?[]:[intent]};
 const reviewed=await f.put('external-review.json',review);
 return {...f,lease,intent,entries,proof,inventory,original,originalDirectory,originalEntries,originalProof,originalInventory,review,
  options:{...f.options,reviewPath:reviewed.path,reviewSha256:reviewed.sha256}};
}
async function changedExternalReview(f,{entries=f.entries,proofPatch={},originalProofPatch={},originalEntries=f.originalEntries,reviewPatch={},inventories}={}){
 const classification=await f.put('changed-external-classification.json',{...f.proof,entriesSha256:legacyProducerInventoryEntriesSha256(entries),...proofPatch});
 const originalClassification=await f.put('changed-original-classification.json',{...f.originalProof,entriesSha256:legacyProducerInventoryEntriesSha256(originalEntries),...originalProofPatch});
 const ref=await f.put('changed-external-review.json',{...f.review,...reviewPatch,intentInventories:inventories??[
  {...f.inventory,entries,classification},{...f.originalInventory,entries:originalEntries,classification:originalClassification}]});
 return {...f.options,reviewPath:ref.path,reviewSha256:ref.sha256};
}
test('external cleanup originals stay in separately reviewed physical trees through inspect, fence and epoch plan',async t=>{
 for(const opaque of [false,true]){
  const f=await externalOriginalFixture(t,{opaque,multiple:true}),original=await readFile(f.original.path),member=await readFile(f.journalPath);
  const checked=inspectReviewedCutover(f.options);assert.equal(checked.uncertainties.length,1);assert.equal(checked.inventories[0].entries.length,0);
  assert.equal(checked.inventories[0].journals.length,2);assert.equal(checked.inventories[1].entries[0].path,f.original.path);
  assert.ok(checked.refs.some(ref=>ref.path===f.original.path&&ref.sha256===f.original.sha256));
  const proof=installPermanentLegacyFence(f.options),plan=reviewedInstallEpochPlan(f.options,{expectedFenceSha256:proof.proofHash});
  assert.deepEqual(plan.parameters[1].uncertainties,[{operationId:f.lease.operationId,evidenceHash:f.original.sha256,ownerThreadId:f.lease.ownerThreadId,ownerReadbackHash:f.intent.ownerReadback.sha256}]);
  assert.equal(plan.providerAuthorityGranted,false);assert.deepEqual(await readFile(f.original.path),original);assert.deepEqual(await readFile(f.journalPath),member);
 }
 const resolved=await externalOriginalFixture(t,{opaque:true,outcome:'not_applied'}),proof=installPermanentLegacyFence(resolved.options);
 assert.deepEqual(reviewedInstallEpochPlan(resolved.options,{expectedFenceSha256:proof.proofHash}).parameters[1].uncertainties,[]);
});
test('external references hash the actual original path, bytes and lease tuple and reject ambiguous local references',async t=>{
 for(const change of ['hash','path','owner','operation','binding','lease-id','missing-binding','extra-binding','local-name','local-hash','inside-root','inside-dot-prefix']){
  const f=await externalOriginalFixture(t),fence=installPermanentLegacyFence(f.options);
  const entries=structuredClone(f.entries),journal=entries.find(item=>item.role==='journal'),external=journal.externalOriginalIntent;
  const prior=legacyProducerInventoryEntriesSha256(entries);
  if(change==='hash')external.sha256=H;
  if(change==='path')external.path=path.join(f.root,'unregistered-original.intent.json');
  if(change==='owner')external.lease.ownerThreadId=HISTORICAL_OWNER;
  if(change==='operation')external.lease.operationId='foreign-op';
  if(change==='binding')external.lease.bindingSha256=H;
  if(change==='lease-id')external.lease.leaseId='foreign-lease';
  if(change==='missing-binding')delete external.lease.bindingSha256;
  if(change==='extra-binding')external.lease.providerAuthorityGranted=true;
  if(change==='local-name')journal.intentName='journal/original.intent.json';
  if(change==='local-hash')journal.intentSha256=f.original.sha256;
  if(change==='inside-root')external.path=f.journalPath;
  if(change==='inside-dot-prefix')external.path=path.join(f.directory,'..not-parent','original.intent.json');
  if(!['extra-binding','local-name','local-hash'].includes(change))assert.notEqual(legacyProducerInventoryEntriesSha256(entries),prior,change);
  const options=await changedExternalReview(f,{entries});
  for(const inspect of [()=>inspectReviewedCutover(options),()=>reviewedInstallEpochPlan(options,{expectedFenceSha256:fence.proofHash})])
   assert.throws(inspect,/EXTERNAL_ORIGINAL_(BINDING|INVENTORY)_REQUIRED/,change);
 }
});
test('external originals require complete registered root acceptance and a unique matching physical intent claim',async t=>{
 for(const change of ['missing-root','unaccepted-root','wrong-root-reviewer','wrong-writer','companion-target','duplicate-root','omitted-member','unreviewed-source']){
  const f=await externalOriginalFixture(t,{opaque:true}),fence=installPermanentLegacyFence(f.options);let params={};
  if(change==='missing-root')params={inventories:[f.inventory]};
  if(change==='unaccepted-root')params={originalProofPatch:{accepted:false}};
  if(change==='wrong-root-reviewer')params={originalProofPatch:{reviewerId:'/other'}};
  if(change==='wrong-writer'){
   const classification=await f.put('foreign-writer-classification.json',{...f.originalProof,writerId:'reconciliation'});
   params={inventories:[f.inventory,{...f.originalInventory,writerId:'reconciliation',classification}]};
  }
  if(change==='companion-target')params={originalEntries:f.originalEntries.map(item=>({...item,role:'companion',category:'metadata',producerSourceSha256:f.producer.sha256}))};
  if(change==='duplicate-root')params={inventories:[f.inventory,f.originalInventory,f.originalInventory]};
  if(change==='omitted-member')params={originalEntries:[]};
  if(change==='unreviewed-source')params={entries:f.entries.map(item=>item.role==='journal'?{...item,producerSourceSha256:H}:item)};
  const options=await changedExternalReview(f,params);
  for(const inspect of [()=>inspectReviewedCutover(options),()=>reviewedInstallEpochPlan(options,{expectedFenceSha256:fence.proofHash})])
   assert.throws(inspect,/EXTERNAL_ORIGINAL_INVENTORY_REQUIRED|PRODUCER_CLASSIFICATION_REQUIRED|SUBMISSION_CANNOT_BE_COMPANION|DUPLICATE_INVENTORY_CLAIM|INVENTORY_CHANGED|JOURNAL_BINDING_REQUIRED/,change);
 }
});
test('external originals reject changed bytes, symlinks and unclassified physical additions after fencing',async t=>{
 for(const change of ['bytes','symlink','parent-symlink','new-file']){
  const f=await externalOriginalFixture(t),fence=installPermanentLegacyFence(f.options);
  if(change==='bytes')await writeFile(f.original.path,'changed',{mode:0o600});
  if(change==='symlink'){await rm(f.original.path);await symlink(f.journalPath,f.original.path);}
  if(change==='parent-symlink'){
   const raw=await readFile(f.original.path),target=path.join(f.root,'original-target');await mkdir(target,{mode:0o700});await writeFile(path.join(target,path.basename(f.original.path)),raw,{mode:0o600});
   await rm(f.originalDirectory,{recursive:true});await symlink(target,f.originalDirectory);
  }
  if(change==='new-file')await writeFile(path.join(f.originalDirectory,'late.attempt.json'),'unknown',{mode:0o600});
  for(const inspect of [()=>inspectReviewedCutover(f.options),()=>reviewedInstallEpochPlan(f.options,{expectedFenceSha256:fence.proofHash})])
   assert.throws(inspect,/INVENTORY_CHANGED|SYMLINK/,change);
 }
});
test('external final owner readback binds the actual lease and all original journals without inferring outcomes',async t=>{
 for(const change of ['owner','operation','binding','lease-id','epoch','objective','missing-binding','intent-binding','intent-missing-binding','original-binding','forged-outcome','missing-journal','duplicate-intent','member-binding','member-operation','member-owner']){
  const f=await externalOriginalFixture(t),fence=installPermanentLegacyFence(f.options);let entries=f.entries,originalEntries=f.originalEntries,intent=structuredClone(f.intent),readback=JSON.parse(await readFile(intent.ownerReadback.path));
  const keys={owner:'ownerThreadId',operation:'operationId',binding:'bindingSha256','lease-id':'leaseId',epoch:'epoch',objective:'objective'};
  if(keys[change])readback[keys[change]]=change==='binding'?H:'foreign';
  if(change==='missing-binding')delete readback.bindingSha256;
  if(change==='intent-binding')intent.bindingSha256=H;
  if(change==='intent-missing-binding')delete intent.bindingSha256;
  if(change==='original-binding'){
   const raw=JSON.stringify({...JSON.parse(await readFile(f.original.path)),bindingSha256:H});await writeFile(f.original.path,raw,{mode:0o600});
   intent.evidence={...intent.evidence,sha256:sha(raw)};readback.intentSha256=intent.evidence.sha256;
   originalEntries=f.originalEntries.map(item=>({...item,sha256:intent.evidence.sha256}));
   entries=f.entries.map(item=>item.role==='journal'?{...item,externalOriginalIntent:{...item.externalOriginalIntent,sha256:intent.evidence.sha256}}:item);
  }
  if(change==='forged-outcome')readback.outcome='verified_complete';
  if(change==='missing-journal')readback.journalEvidence=[];
  if(change.startsWith('member-')){
   const member=JSON.parse(await readFile(f.journalPath)),key=keys[change.slice(7)];member.lease[key]=key==='bindingSha256'?H:'foreign';
   await writeFile(f.journalPath,JSON.stringify(member),{mode:0o600});
   const memberRef={path:f.journalPath,sha256:sha(JSON.stringify(member))};entries=f.entries.map(item=>item.role==='journal'?{...item,sha256:memberRef.sha256}:item);
   intent.journalEvidence=[memberRef];readback.journalEvidence=[memberRef];
  }
  intent.ownerReadback=await f.put('external-bad-readback.json',readback);
  const options=await changedExternalReview(f,{entries,originalEntries,reviewPatch:{uncertainIntents:change==='duplicate-intent'?[intent,intent]:[intent]}});
  for(const inspect of [()=>inspectReviewedCutover(options),()=>reviewedInstallEpochPlan(options,{expectedFenceSha256:fence.proofHash})])
   assert.throws(inspect,/ACTUAL_OWNER_READBACK_REQUIRED|EXTERNAL_ORIGINAL_(BINDING|READBACK)_REQUIRED|JOURNAL_READBACK_REQUIRED|DUPLICATE_INTENT/,change);
 }
});
test('classification and final review cannot be stored inside any inventoried producer root',async t=>{
 for(const change of ['classification','review']){
  const f=await externalOriginalFixture(t);let options;
  if(change==='classification'){
   const classification=await f.put('cycle-cleanup/setup/inside-classification.json',f.proof);
   options=await changedExternalReview(f,{inventories:[{...f.inventory,classification},f.originalInventory]});
  }else{
   const ref=await f.put('cycle-cleanup/setup/inside-review.json',f.review);options={...f.options,reviewPath:ref.path,reviewSha256:ref.sha256};
  }
  assert.throws(()=>inspectReviewedCutover(options),/REVIEW_OUTSIDE_INVENTORIES_REQUIRED/);
 }
});
test('complete mixed producer tree fences original paths and imports one unknown with all phase members unchanged',async t=>{
 const f=await treeFixture(t),before=await readFile(f.intent.evidence.path),member=await readFile(f.journalPath);
 const checked=inspectReviewedCutover(f.options);assert.equal(checked.uncertainties.length,1);assert.equal(checked.inventories[0].journals.length,1);
 assert.equal(legacyProducerInventoryEntriesSha256([...f.entries].reverse()),f.proof.entriesSha256);
 assert.ok(checked.inventories[0].tree.some(e=>e.name==='swift-cache/empty'&&e.type==='directory'));
 const fence=installPermanentLegacyFence(f.options),plan=reviewedInstallEpochPlan(f.options,{expectedFenceSha256:fence.proofHash});
 assert.equal(plan.parameters[1].uncertainties.length,1);assert.equal(plan.parameters[1].uncertainties[0].ownerThreadId,HISTORICAL_OWNER);
 assert.equal(plan.parameters[1].uncertainties[0].evidenceHash,sha(before));assert.equal(plan.parameters[1].uncertainties[0].ownerReadbackHash,f.intent.ownerReadback.sha256);
 assert.deepEqual(await readFile(f.intent.evidence.path),before);assert.deepEqual(await readFile(f.journalPath),member);assert.equal(plan.providerAuthorityGranted,false);
});
test('nested new intent, changed cache/companion bytes and empty directory removal all refuse complete tree',async t=>{
 for(const mutation of ['new-intent','cache','admission','directory']){
  const f=await treeFixture(t);
  if(mutation==='new-intent')await writeFile(path.join(f.directory,'swift-cache','late.attempt.json'),'unknown',{mode:0o600});
  if(mutation==='cache')await writeFile(path.join(f.directory,'swift-cache','module.pcm'),'changed',{mode:0o600});
  if(mutation==='admission')await writeFile(path.join(f.directory,'root-admission.json'),'changed',{mode:0o600});
  if(mutation==='directory')await rm(path.join(f.directory,'swift-cache','empty'),{recursive:true});
  assert.throws(()=>installPermanentLegacyFence(f.options),/INVENTORY_CHANGED/,mutation);
 }
});
test('root classification cannot hide durable intents or phase journals as companions, even with a recomputed approved hash',async t=>{
 const f=await treeFixture(t);
 for(const role of ['intent','journal']){
  const entries=f.entries.map(item=>item.role===role?{name:item.name,type:item.type,sha256:item.sha256,role:'companion',category:'receipt',producerSourceSha256:f.producer.sha256}:item);
  const options=await changedTreeReview(f,entries);assert.throws(()=>inspectReviewedCutover(options),/SUBMISSION_CANNOT_BE_COMPANION/,role);
 }
 // A generic filename cannot disguise a recognizable durable record either.
 const file=path.join(f.directory,'root-admission.json');await writeFile(file,JSON.stringify({durable:true,state:'uncertain'}),{mode:0o600});
 const entries=f.entries.map(item=>item.name==='root-admission.json'?{...item,sha256:sha(JSON.stringify({durable:true,state:'uncertain'}))}:item);
 const options=await changedTreeReview(f,entries);assert.throws(()=>inspectReviewedCutover(options),/SUBMISSION_CANNOT_BE_COMPANION/);
});
test('mixed inventory requires actual root/source/writer acceptance and exact member readback, with no missing intent classification',async t=>{
 const f=await treeFixture(t);
 for(const patch of [{accepted:false},{reviewerId:'/rootbad'},{directory:path.dirname(f.directory)},{writerId:'reconciliation'},{writerSourceSha256:'b'.repeat(64)},{producerSources:[]},{completeSubmissionCoverageReviewed:false},{providerOutcomesInferred:true},{providerAuthorityGranted:true}]){
  const options=await changedTreeReview(f,f.entries,patch);assert.throws(()=>inspectReviewedCutover(options),/PRODUCER_CLASSIFICATION_REQUIRED/);
 }
 for(const patch of [{category:'unreviewed'},{producerSourceSha256:'b'.repeat(64)},{role:undefined}]){
  const entries=f.entries.map(item=>item.role==='companion'?{...item,...patch}:item);
  const options=await changedTreeReview(f,entries);assert.throws(()=>inspectReviewedCutover(options),/SUBMISSION_CANNOT_BE_COMPANION|CLASSIFICATION_REQUIRED/);
 }
 const missing=await f.put('missing-owner-members.json',{...JSON.parse(await readFile(f.intent.ownerReadback.path)),journalEvidence:[]});
 let options=await changedTreeReview(f,f.entries,{}, {uncertainIntents:[{...f.intent,ownerReadback:missing}]});assert.throws(()=>inspectReviewedCutover(options),/JOURNAL_READBACK_REQUIRED/);
 options=await changedTreeReview(f,f.entries,{}, {uncertainIntents:[]});assert.throws(()=>inspectReviewedCutover(options),/UNCLASSIFIED_INTENT/);
 options=await changedTreeReview(f,[...f.entries,f.entries[0]]);assert.throws(()=>inspectReviewedCutover(options),/INVENTORY_REQUIRED/);
 await writeFile(f.producer.path,'changed',{mode:0o600});assert.throws(()=>inspectReviewedCutover(f.options),/REFERENCE_CHANGED/);
});
test('mixed tree rejects traversal, wrong entry type, symlinks, hardlinks and directory-shaped intent claims',async t=>{
 for(const change of ['traversal','type','symlink','hardlink','directory','fifo']){
  const f=await treeFixture(t);let entries=f.entries;
  if(change==='traversal')entries=entries.map(item=>item.role==='intent'?{...item,name:'../outside.intent.json'}:item);
  if(change==='type')entries=entries.map(item=>item.role==='intent'?{...item,type:'directory'}:item);
  if(change==='symlink'){await rm(f.journalPath);await symlink(f.intent.evidence.path,f.journalPath);}
  if(change==='hardlink'){await rm(f.journalPath);await link(f.intent.evidence.path,f.journalPath);}
  if(change==='directory'){await rm(f.journalPath);await mkdir(f.journalPath,{mode:0o700});}
  if(change==='fifo'){await rm(f.journalPath);execFileSync('/usr/bin/mkfifo',[f.journalPath]);}
  if(['traversal','type'].includes(change)){const options=await changedTreeReview(f,entries);assert.throws(()=>inspectReviewedCutover(options),/NAME_INVALID|ENTRY_TYPE_INVALID/);}
  else assert.throws(()=>inspectReviewedCutover(f.options),/SYMLINK|REGULAR_OWNER_FILE|INVENTORY_CHANGED/);
 }
});
test('late nested attempt appearing while the canonical mutex is held refuses fencing after the initial JS inspection',async t=>{
 const f=await treeFixture(t),late=path.join(f.directory,'swift-cache','late.attempt.json');
 const code=`import fcntl,os,sys,time
fd=os.open(sys.argv[1],os.O_CREAT|os.O_RDWR,0o600)
fcntl.flock(fd,fcntl.LOCK_EX)
print('held',flush=True)
time.sleep(1)
open(sys.argv[2],'w').write('unknown')
fcntl.flock(fd,fcntl.LOCK_UN)
`;
 const child=spawn('/usr/bin/python3',['-I','-c',code,path.join(f.base,'coordination-mutex.lock'),late],{stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());await once(child.stdout,'data');assert.doesNotThrow(()=>inspectReviewedCutover(f.options));
 assert.throws(()=>installPermanentLegacyFence(f.options),/FENCE_REFUSED/);
 await assert.rejects(readFile(f.leasePath),{code:'ENOENT'});
});

test('submission member groups reject missing, foreign and contradictory identities without inventing phase operations',async t=>{
 for(const change of ['missing-member','foreign-owner','foreign-operation','foreign-target','duplicate-operation']){
  const f=await treeFixture(t);let entries=f.entries,patch={};
  if(change==='missing-member')patch={uncertainIntents:[{...f.intent,journalEvidence:[]}]};
  if(['foreign-owner','foreign-operation'].includes(change)){
   const lease={ownerThreadId:change==='foreign-owner'?f.review.existingOwners.production:HISTORICAL_OWNER,operationId:change==='foreign-operation'?'foreign-op':'old-op'};
   const raw=JSON.stringify({state:'uncertain',durable:true,lease});await writeFile(f.journalPath,raw,{mode:0o600});
   const evidence=[{path:f.journalPath,sha256:sha(raw)}];entries=entries.map(item=>item.role==='journal'?{...item,sha256:sha(raw)}:item);
   const readback=await f.put('member-readback.json',{...JSON.parse(await readFile(f.intent.ownerReadback.path)),journalEvidence:evidence});patch={uncertainIntents:[{...f.intent,journalEvidence:evidence,ownerReadback:readback}]};
  }
  if(change==='foreign-target')entries=entries.map(item=>item.role==='journal'?{...item,intentSha256:H}:item);
  if(change==='duplicate-operation'){
   const extra=await f.put('second-original.json',{operationId:'old-op'}),readback=await f.put('second-readback.json',{kind:'fcos_legacy_owner_readback',operationId:'old-op',ownerThreadId:HISTORICAL_OWNER,intentSha256:extra.sha256,outcome:'unknown'});
   patch={uncertainIntents:[f.intent,{operationId:'old-op',ownerThreadId:HISTORICAL_OWNER,evidence:extra,ownerReadback:readback}]};
  }
  const options=await changedTreeReview(f,entries,{},patch);assert.throws(()=>inspectReviewedCutover(options),/JOURNAL_READBACK_REQUIRED|IDENTITY_MISMATCH|JOURNAL_BINDING_REQUIRED|DUPLICATE_INTENT/,change);
 }
});

test('producer source names retain literal brackets and internal spaces through inspection, mutex fence and epoch plan',async t=>{
 const f=await treeFixture(t),names=['archive/api/functions/[name].js','archive/force-app/layouts/Invoice__c-Invoice Layout.layout-meta.xml'];
 const originals=[];
 for(const name of names){const file=path.join(f.directory,name);await mkdir(path.dirname(file),{recursive:true,mode:0o700});const raw=Buffer.from('Public source companion: '+name);await writeFile(file,raw,{mode:0o600});originals.push({file,raw});}
 const known=new Map(f.entries.map(item=>[item.name,item])),entries=snapshotLegacyJournalTree(f.directory).map(item=>known.get(item.name)??(item.type==='directory'?item:{...item,role:'companion',category:'build_cache',producerSourceSha256:f.producer.sha256}));
 const options=await changedTreeReview(f,entries),checked=inspectReviewedCutover(options);
 assert.deepEqual(checked.inventories[0].tree.filter(item=>names.includes(item.name)).map(item=>item.name),names);
 const proof=installPermanentLegacyFence(options),plan=reviewedInstallEpochPlan(options,{expectedFenceSha256:proof.proofHash});
 assert.equal(plan.parameters[1].uncertainties.length,1);assert.equal(plan.parameters[1].uncertainties[0].ownerThreadId,HISTORICAL_OWNER);assert.equal(plan.providerAuthorityGranted,false);
 for(const {file,raw}of originals)assert.deepEqual(await readFile(file),raw);
});

test('producer path segments reject traversal, controls, aliases and glob spellings without normalizing them',async t=>{
 const f=await treeFixture(t),target=f.entries.find(item=>item.role==='companion');
 for(const name of ['../escape','/absolute','journal/./original.intent.json','journal//original.intent.json','journal/../original.intent.json','journal\\original.intent.json','source\nfile','source\tfile','source\x00file','source\x7ffile','source\u202efile',' leading.js','trailing.js ','source*.js','source?.js','%2e%2e/escape']){
  const entries=f.entries.map(item=>item===target?{...item,name}:item),options=await changedTreeReview(f,entries);
  assert.throws(()=>inspectReviewedCutover(options),/NAME_INVALID/,JSON.stringify(name));
 }
 const entries=[...f.entries,{...target}],duplicate=await changedTreeReview(f,entries);assert.throws(()=>inspectReviewedCutover(duplicate),/INVENTORY_REQUIRED/);
});

test('actual control-character producer filenames are rejected by recursive snapshot',async t=>{
 for(const name of ['source\nfile.js','source\tfile.js','source\x7ffile.js']){
  const f=await treeFixture(t);await writeFile(path.join(f.directory,name),'public fixture',{mode:0o600});
  assert.throws(()=>snapshotLegacyJournalTree(f.directory),/NAME_INVALID/,JSON.stringify(name));
 }
});

test('legacy flat intent envelopes keep their original strict filename contract',async t=>{
 const f=await fixture(t),intent=f.review.uncertainIntents[0],raw=await readFile(intent.evidence.path),name='one [name].json',file=path.join(path.dirname(intent.evidence.path),name);
 await rm(intent.evidence.path);await writeFile(file,raw,{mode:0o600});
 const evidence={path:file,sha256:sha(raw)},ref=await f.put('flat-name-review.json',{...f.review,intentInventories:[{directory:path.dirname(file),entries:[{name,sha256:evidence.sha256}]}],uncertainIntents:[{...intent,evidence}]});
 assert.throws(()=>inspectReviewedCutover({...f.options,reviewPath:ref.path,reviewSha256:ref.sha256}),/NAME_INVALID/);
});

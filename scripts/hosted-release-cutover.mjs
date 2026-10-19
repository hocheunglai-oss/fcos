import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { assertNotificationChallenge } from '../supabase/functions/release-coordinator/core.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const CANONICAL_LEGACY_DIRECTORY='/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005';
// Cutover fences the currently accepted Features-owned guard. Historical release
// and attestation protocols retain their original immutable guard pins.
export const HOSTED_CUTOVER_LEGACY_GUARD=Object.freeze({
  path:resolve(CANONICAL_LEGACY_DIRECTORY,'features-reconciliation-owner-transition-v1/coordinator_guard.py'),
  sha256:'8ed4eda312b62c3b02c3a0a768ddd024a2a819af5f0f1194da47ef2a2d62fd38',
});
// This is the immutable reconciliation lineage of the pinned 8ed guard, not a
// current writer/claim owner and not a caller-provided ownership transition.
const FEATURES_OWNER='01a0f08b-7fcb-7870-9edc-343e16052b62';
const HISTORICAL_RECONCILIATION_OWNER='01a0b0e2-b1af-7bf0-963d-3138c42648e3';
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(value,code)=>{if(!value)fail(code);};
export function assertHostedCutoverLegacyGuard(helper,expectedHelperSha256) {
  need(expectedHelperSha256===HOSTED_CUTOVER_LEGACY_GUARD.sha256
    &&helper?.sha256===expectedHelperSha256&&helper.path===HOSTED_CUTOVER_LEGACY_GUARD.path,'CUTOVER_CANONICAL_HELPER_REQUIRED');
}
function noSymlinks(path) {
  need(isAbsolute(path),'CUTOVER_ABSOLUTE_PATH_REQUIRED');
  for(let p=resolve(path);;p=dirname(p)){need(!lstatSync(p).isSymbolicLink(),'CUTOVER_SYMLINK_FORBIDDEN');if(dirname(p)===p)break;}
}
function regular(path) {
  noSymlinks(path);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=fstatSync(fd);need(info.isFile()&&info.nlink===1&&info.uid===process.getuid(),'CUTOVER_REGULAR_OWNER_FILE_REQUIRED');return readFileSync(fd);}finally{closeSync(fd);}
}
function reference(ref) {need(ref&&validHash(ref.sha256),'CUTOVER_REFERENCE_REQUIRED');const raw=regular(ref.path);need(hash(raw)===ref.sha256,'CUTOVER_REFERENCE_CHANGED');return raw;}
function inside(root,path) {const p=relative(resolve(root),resolve(path));return p!==''&&!p.startsWith('..')&&!isAbsolute(p);}
function assertIntentOwner(owner,owners,helper) {
  if(Object.values(owners).includes(owner)) return;
  need(owner===HISTORICAL_RECONCILIATION_OWNER
    &&helper.sha256===HOSTED_CUTOVER_LEGACY_GUARD.sha256
    &&owners.production===FEATURES_OWNER&&owners.reconciliation===FEATURES_OWNER,
    'CUTOVER_INTENT_OWNER_INVALID');
}
function assertExposedIntentIdentity(raw,intent,readback) {
  // Some original provider journals are opaque rather than dispatch envelopes.
  // Keep the existing hash-bound owner-readback contract; do not invent a new
  // intent schema or infer provider provenance from a parseable object.
  let original;try{original=JSON.parse(raw);}catch{
    need(!Object.hasOwn(readback,'intentKind'),'CUTOVER_INTENT_IDENTITY_MISMATCH');return;
  }
  if(!original||typeof original!=='object'||Array.isArray(original)) {
    need(!Object.hasOwn(readback,'intentKind'),'CUTOVER_INTENT_IDENTITY_MISMATCH');return;
  }
  if(Object.hasOwn(original,'ownerThreadId')) need(original.ownerThreadId===intent.ownerThreadId,'CUTOVER_INTENT_IDENTITY_MISMATCH');
  if(Object.hasOwn(original,'operationId')) need(original.operationId===intent.operationId,'CUTOVER_INTENT_IDENTITY_MISMATCH');
  // `operation` can be a provider verb. These two existing dispatch kinds give
  // it an actual worker-operation identity; they do not restrict other journals.
  if(['source_bound_financial_decision_owner_mission_intent_v1','bounded_local_worker_dispatch_intent_v1'].includes(original.kind)) {
    need(original.operation===intent.operationId,'CUTOVER_INTENT_IDENTITY_MISMATCH');
    const ownerKey=original.kind==='bounded_local_worker_dispatch_intent_v1'?'threadId':'ownerThreadId';
    need(original[ownerKey]===intent.ownerThreadId,'CUTOVER_INTENT_IDENTITY_MISMATCH');
    if(Object.hasOwn(original,'threadId')) need(original.threadId===intent.ownerThreadId,'CUTOVER_INTENT_IDENTITY_MISMATCH');
  }
  if(original.lease&&typeof original.lease==='object'&&!Array.isArray(original.lease)) {
    if(Object.hasOwn(original.lease,'ownerThreadId')) need(original.lease.ownerThreadId===intent.ownerThreadId,'CUTOVER_INTENT_IDENTITY_MISMATCH');
    if(Object.hasOwn(original.lease,'operationId')) need(original.lease.operationId===intent.operationId,'CUTOVER_INTENT_IDENTITY_MISMATCH');
  }
  if(Object.hasOwn(original,'kind')) need(typeof original.kind==='string'&&original.kind.length>0,'CUTOVER_INTENT_IDENTITY_MISMATCH');
  if(Object.hasOwn(readback,'intentKind')) need(readback.intentKind===original.kind,'CUTOVER_INTENT_IDENTITY_MISMATCH');
}
/** Hash-reviewed input is data. The operator separately authenticates actual owner/provider evidence. */
export function inspectReviewedCutover({reviewPath,reviewSha256,expectedHelperSha256,fixtureRoot}) {
  need(validHash(reviewSha256)&&validHash(expectedHelperSha256),'CUTOVER_EXPLICIT_HASH_PINS_REQUIRED');
  const raw=regular(reviewPath);need(hash(raw)===reviewSha256,'CUTOVER_REVIEW_CHANGED');const review=JSON.parse(raw);
  need(review.kind==='fcos_hosted_cutover_review_v1'&&review.coordinationOnly===true&&review.providerAuthorityGranted===false
    &&Number.isSafeInteger(review.nextEpoch)&&review.nextEpoch>0,'CUTOVER_REVIEW_INVALID');
  try{assertNotificationChallenge(review.notificationChallenge);}catch{fail('CUTOVER_NOTIFICATION_CHALLENGE_REQUIRED');}
  if(fixtureRoot) need([realpathSync(tmpdir()),realpathSync('/tmp')].some(root=>inside(root,fixtureRoot))&&inside(fixtureRoot,reviewPath),'CUTOVER_FIXTURE_MUST_BE_TEMPORARY');
  else assertHostedCutoverLegacyGuard(review.helper,expectedHelperSha256);
  need(review.helper.sha256===expectedHelperSha256&&hash(reference(review.helper))===expectedHelperSha256,'CUTOVER_HELPER_CHANGED');
  const workflow=JSON.parse(reference(review.workflow)),c=workflow.unifiedCoordinator;
  need(c&&c.epoch===review.legacyEpoch&&c.writeLeasePath===review.leasePath
    &&c.writeLeaseHelper?.path===review.helper.path&&c.writeLeaseHelper.sha256===expectedHelperSha256
    &&c.writeLeaseHelper.localCoordinationGuardAccepted===true&&c.writeLeaseHelper.independentReviewPending===false
    &&c.writeLeaseHelper.providerAuthority===false,'CUTOVER_CANONICAL_SNAPSHOT_MISMATCH');
  const base=dirname(review.leasePath);noSymlinks(base);need(lstatSync(base).isDirectory()&&lstatSync(base).uid===process.getuid()&&(lstatSync(base).mode&0o022)===0,'CUTOVER_PRIVATE_DIRECTORY_REQUIRED');need(review.leasePath===resolve(base,'live-provider-write-lease.json'),'CUTOVER_SHARED_LEASE_REQUIRED');
  const owners=Object.fromEntries(Object.entries(c.objectives).map(([id,value])=>[id,value.ownerThreadId]));
  need(Object.keys(owners).sort().join(',')==='production,reconciliation'
    &&Object.keys(owners).every(id=>review.existingOwners?.[id]===owners[id]),'CUTOVER_EXISTING_OWNER_CHANGED');
  if(review.helper.sha256===HOSTED_CUTOVER_LEGACY_GUARD.sha256)
    need(owners.production===FEATURES_OWNER&&owners.reconciliation===FEATURES_OWNER,'CUTOVER_EXISTING_OWNER_CHANGED');
  const proofRefs=Object.entries(c.writeLeaseHelper).filter(([key,value])=>key!=='path'&&value&&typeof value==='object'&&value.path&&value.sha256).map(([,value])=>value);
  for(const ref of proofRefs) reference(ref);
  need(Array.isArray(review.requiredWriterIds)&&review.requiredWriterIds.includes('production')&&review.requiredWriterIds.includes('reconciliation')
    &&new Set(review.requiredWriterIds).size===review.requiredWriterIds.length&&Array.isArray(review.writers)
    &&review.writers.length===review.requiredWriterIds.length&&new Set(review.writers.map(w=>w.id)).size===review.writers.length,'CUTOVER_COMPLETE_WRITER_INVENTORY_REQUIRED');
  const refs=[review.helper,review.workflow,...proofRefs],writers=[];
  for(const writer of review.writers){
    need(review.requiredWriterIds.includes(writer.id)&&Object.values(owners).includes(writer.ownerThreadId)
      &&(!Object.hasOwn(owners,writer.id)||writer.ownerThreadId===owners[writer.id]),'CUTOVER_FOREIGN_WRITER');
    const proof=JSON.parse(reference(writer.disabledEvidence));refs.push(writer.disabledEvidence);
    need(proof.kind==='fcos_legacy_writer_fence'&&proof.writerId===writer.id&&proof.ownerThreadId===writer.ownerThreadId
      &&proof.disabled===true&&validHash(proof.sourceSha256),'CUTOVER_WRITER_NOT_FENCED');
    writers.push({id:writer.id,disabled:true,proofHash:writer.disabledEvidence.sha256});
  }
  need(Array.isArray(review.intentInventories)&&review.intentInventories.length>0&&Array.isArray(review.uncertainIntents),'CUTOVER_INTENT_INVENTORY_REQUIRED');
  const inventories=[];
  for(const inventory of review.intentInventories){
    need(Array.isArray(inventory.entries),'CUTOVER_INTENT_INVENTORY_REQUIRED');noSymlinks(inventory.directory);const names=readdirSync(inventory.directory).sort();
    need(names.join('\0')===inventory.entries.map(e=>e.name).sort().join('\0'),'CUTOVER_INTENT_INVENTORY_CHANGED');
    const entries=[];
    for(const item of inventory.entries){need(/^[a-zA-Z0-9._-]+$/.test(item.name),'CUTOVER_INTENT_NAME_INVALID');const ref={path:resolve(inventory.directory,item.name),sha256:item.sha256};reference(ref);refs.push(ref);entries.push(ref);}
    inventories.push({directory:inventory.directory,entries});
  }
  const uncertainties=[];
  const reviewedIntents=[...review.uncertainIntents,...(review.resolvedIntents??[])];
  for(const entry of inventories.flatMap(i=>i.entries)) need(reviewedIntents.some(i=>i.evidence.path===entry.path&&i.evidence.sha256===entry.sha256),'CUTOVER_UNCLASSIFIED_INTENT');
  for(const intent of reviewedIntents){
    need(typeof intent.operationId==='string'&&intent.operationId,'CUTOVER_INTENT_OWNER_INVALID');
    assertIntentOwner(intent.ownerThreadId,owners,review.helper);
    const original=reference(intent.evidence),readback=JSON.parse(reference(intent.ownerReadback));refs.push(intent.evidence,intent.ownerReadback);
    need(readback.kind==='fcos_legacy_owner_readback'&&readback.operationId===intent.operationId&&readback.ownerThreadId===intent.ownerThreadId
      &&readback.intentSha256===intent.evidence.sha256&&['applied','not_applied','unknown'].includes(readback.outcome),'CUTOVER_ACTUAL_OWNER_READBACK_REQUIRED');
    assertExposedIntentIdentity(original,intent,readback);
    if(readback.outcome==='unknown') uncertainties.push({operationId:intent.operationId,evidenceHash:intent.evidence.sha256,ownerThreadId:intent.ownerThreadId,ownerReadbackHash:intent.ownerReadback.sha256});
  }
  need(new Set(uncertainties.map(i=>i.operationId)).size===uncertainties.length,'CUTOVER_DUPLICATE_INTENT');
  if(fixtureRoot) for(const p of [review.leasePath,...refs.map(r=>r.path),...inventories.map(i=>i.directory)]) need(inside(fixtureRoot,p),'CUTOVER_FIXTURE_ESCAPED');
  else need(review.leasePath===resolve(CANONICAL_LEGACY_DIRECTORY,'live-provider-write-lease.json')
    &&review.workflow.path===resolve(CANONICAL_LEGACY_DIRECTORY,'../workflow-state.json')
    &&review.helper.path===HOSTED_CUTOVER_LEGACY_GUARD.path,'CUTOVER_CANONICAL_LOCAL_PATH_REQUIRED');
  return {review,reviewSha256,refs,inventories,writers,uncertainties,existingOwners:owners,base};
}
const fenceProgram=String.raw`
import os,sys,json,hashlib,stat,fcntl
v=json.load(sys.stdin)
def raw(p):
 for x in [p,*list(__import__('pathlib').Path(p).parents)]:
  if __import__('pathlib').Path(x).is_symlink(): raise ValueError('path')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  i=os.fstat(f.fileno())
  if not stat.S_ISREG(i.st_mode) or i.st_nlink!=1 or i.st_uid!=os.getuid(): raise ValueError('file')
  return f.read()
mutex=os.path.join(v['base'],'coordination-mutex.lock')
fd=os.open(mutex,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
try:
 i=os.fstat(fd)
 if not stat.S_ISREG(i.st_mode) or i.st_nlink!=1 or i.st_uid!=os.getuid(): raise ValueError('mutex')
 fcntl.flock(fd,fcntl.LOCK_EX)
 if os.path.lexists(v['leasePath']): raise ValueError('existing lease requires original owner readback')
 for ref in v['refs']:
  if hashlib.sha256(raw(ref['path'])).hexdigest()!=ref['sha256']: raise ValueError('changed proof')
 for inv in v['inventories']:
  if sorted(os.listdir(inv['directory']))!=sorted(os.path.basename(x['path']) for x in inv['entries']): raise ValueError('inventory')
 out=os.open(v['leasePath'],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(out,'w') as f:
  json.dump(v['sentinel'],f,sort_keys=True,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
 d=os.open(v['base'],os.O_RDONLY|os.O_NOFOLLOW)
 try: os.fsync(d)
 finally: os.close(d)
 print(hashlib.sha256(raw(v['leasePath'])).hexdigest())
finally: os.close(fd)
`;
export function installPermanentLegacyFence(options) {
  const checked=inspectReviewedCutover(options),{review,reviewSha256}=checked;
  const sentinel={schemaVersion:1,kind:'fcos_hosted_cutover_permanent_fence',nextEpoch:review.nextEpoch,legacyEpoch:review.legacyEpoch,
    legacySnapshotSha256:review.workflow.sha256,inventorySha256:reviewSha256,acceptedHelperSha256:review.helper.sha256,
    existingOwners:checked.existingOwners,coordinationOnly:true,providerAuthorityGranted:false,replayForbidden:true,permanent:true};
  let proofHash;
  try{proofHash=execFileSync('/usr/bin/python3',['-I','-c',fenceProgram],{input:JSON.stringify({...checked,leasePath:review.leasePath,sentinel}),encoding:'utf8',maxBuffer:4096,
    timeout:15000,env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']}).trim();}
  catch{fail('CUTOVER_FENCE_REFUSED_PRESERVE_ORIGINAL_LEASE');}
  need(validHash(proofHash)&&hash(regular(review.leasePath))===proofHash,'CUTOVER_FENCE_READBACK_FAILED');
  return {kind:'permanent_legacy_sentinel',path:review.leasePath,snapshotHash:review.workflow.sha256,proofHash,coordinationOnly:true,providerAuthorityGranted:false};
}
export function reviewedInstallEpochPlan(options,{expectedFenceSha256}) {
  const checked=inspectReviewedCutover(options),raw=regular(checked.review.leasePath),sentinel=JSON.parse(raw);
  need(validHash(expectedFenceSha256)&&hash(raw)===expectedFenceSha256&&sentinel.kind==='fcos_hosted_cutover_permanent_fence'
    &&sentinel.permanent===true&&sentinel.inventorySha256===checked.reviewSha256&&sentinel.legacySnapshotSha256===checked.review.workflow.sha256,
    'CUTOVER_PERMANENT_FENCE_MISMATCH');
  return {query:'select fcos_release_coordination.install_epoch($1::bigint,$2::jsonb)',parameters:[checked.review.nextEpoch,
    {inventoryComplete:true,inventoryHash:checked.reviewSha256,notificationChallenge:checked.review.notificationChallenge,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:checked.review.workflow.sha256,proofHash:expectedFenceSha256},writers:checked.writers,uncertainties:checked.uncertainties}],
    coordinationOnly:true,providerAuthorityGranted:false,operatorMustAuthenticateProviderEvidence:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const [action,reviewPath,reviewSha256,expectedHelperSha256,expectedFenceSha256]=process.argv.slice(2),options={reviewPath,reviewSha256,expectedHelperSha256};
    let result;if(action==='inspect'){const c=inspectReviewedCutover(options);result={reviewSha256:c.reviewSha256,nextEpoch:c.review.nextEpoch,writers:c.writers,unresolvedImports:c.uncertainties.length,coordinationOnly:true};}
    else if(action==='fence')result=installPermanentLegacyFence(options);
    else if(action==='rpc-plan')result=reviewedInstallEpochPlan(options,{expectedFenceSha256});else fail('CUTOVER_COMMAND_INVALID');
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){process.stderr.write((error.code?.startsWith('CUTOVER_')?error.code:'CUTOVER_REFUSED')+'\n');process.exitCode=1;}
}

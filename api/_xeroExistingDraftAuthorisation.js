import { randomUUID } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { requireExternalActionGate } from './_externalActionGates.js';
import { getFreshXeroConnection, xeroAccountingFetch, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { previewEvidenceHash as hash, preparePreviewPersistence } from './_xeroPreviewPersistence.js';
import { toSyncItemRow, normalizeXeroInvoice, XERO_FINANCIAL_CUTOFF, XERO_RECONCILIATION_VERSION } from './_xeroFinancialSync.js';
import { collectExistingDraftAuthorisation, existingDraftCollectionPrivateEvidence, readExistingDraftDetail } from './_xeroExistingDraftAuthorisationCollector.js';
import { EXISTING_DRAFT_AUTHORISATION_POLICY as POLICY, buildExistingDraftAuthorisationEvidence,
  evaluateExistingDraftAuthorisationEvidence, classifyExistingDraftAuthorisationReadback, existingDraftAuthorisationHash } from './_xeroExistingDraftAuthorisationPolicy.js';
import { claimExistingDraftAuthorisation, bindExistingDraftAuthorisationRequest, finishExistingDraftAuthorisation,
  readExistingDraftAuthorisationOutcome } from './_xeroExistingDraftAuthorisationPersistence.js';
import { runWithXeroBudget } from './_xeroSharedControl.js';

import { reserveExistingDraftQuota, releaseExistingDraftQuota } from './_xeroExistingDraftQuota.js';

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const uid = v => typeof v === 'string' && UUID.test(v);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a,b) => hash(a) === hash(b);
const fail = (message, code = 'XERO_DRAFT_STATUS_WORKFLOW_HELD') => Object.assign(Error(message), { code, status: 409 });
const assert = (ok,message,code) => { if (!ok) throw fail(message,code); };
const clean = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0,256) : '';
const actorFor = ctx => {
  const actor = { id: ctx?.profile?.id, email: String(ctx?.profile?.email || '').trim().toLowerCase() };
  assert(uid(actor.id) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor.email), 'A current authenticated Finance operator is required.'); return actor;
};
const runView = r => ({ id:r.id,revision:r.revision,status:r.status });
const rowView = r => ({ id:r.id,sourceId:clean(r.source_id),sourceNumber:clean(r.source_document_number),targetId:clean(r.xero_document_id),
  company:clean(r.source_payload.accountName || r.xero_payload.Contact?.Name),vessel:clean(r.source_payload.vesselName),
  currency:clean(r.currency),total:r.source_total,status:r.status,selected:r.selected,
  documentVerification:'UNVERIFIED',blockers:Array.isArray(r.blockers)?r.blockers.filter(v=>typeof v==='string').map(clean):[] });
async function one(query) { const r = await query.maybeSingle(); assert(!r.error && plain(r.data),'Exact durable workflow evidence is unavailable.'); return r.data; }
const noUpdate = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['UpdatedDateUTC','UpdatedDateUTCString'].includes(key)));
function dbInstant(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59
    || m[6] !== 'Z' && (Number(m[6].slice(1, 3)) > 23 || Number(m[6].slice(4, 6)) > 59)) return null;
  const day = Date.parse(`${m[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== m[1]) return null;
  const base = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[6]}`);
  return Number.isFinite(base) ? BigInt(base) * 1000n + BigInt((m[5] || '').padEnd(6, '0') || '0') : null;
}
const metadataSame=(k,a,b)=>['created_at','updated_at','source_snapshot_at','xero_snapshot_at'].includes(k)?dbInstant(a)!==null&&dbInstant(a)===dbInstant(b):same(a,b);
async function saved(client,id,actor) {
  const run=await one(client.from('xero_financial_sync_runs').select('*').eq('id',id));
  const response=await client.from('xero_financial_sync_items').select('*').eq('run_id',id).order('row_index').limit(26);
  const state=run.control_totals?.existingDraftAuthorisation;
  assert(!response.error&&Array.isArray(response.data)&&response.data.length>=1&&response.data.length<=25
    && run.mode==='preview'&&run.control_totals.preservationPolicy===POLICY&&state?.policyVersion===POLICY&&run.created_by===actor.id&&run.created_by_email===actor.email
    && run.control_totals.workflowSnapshot?.complete===true&&run.control_totals.workflowSnapshot.includePayments===false
    && response.data.length===run.control_totals.workflowSnapshot.expectedItemCount
    && same(response.data.map(r=>r.xero_document_id),state.targetIds)&&new Set(response.data.map(r=>r.id)).size===response.data.length
    && response.data.every((r,i)=>r.run_id===id&&r.row_index===i&&uid(r.id)&&r.proposed_payload===null)
    && run.source_fingerprint===hash(response.data.map(r=>r.source_payload))&&run.xero_fingerprint===hash(response.data.map(r=>r.xero_payload)),
  'The owned fixed draft authorisation preview changed.');
  return {run,items:response.data,state};
}
async function observe(ids,actor,deps) {
  const collection=await (deps.collect || collectExistingDraftAuthorisation)({targetIds:ids},deps);
  const capture=(deps.privateEvidence || existingDraftCollectionPrivateEvidence)(collection);
  assert(collection?.complete===true&&collection.actorId===actor.id&&uid(collection.tenantId)&&same(collection.targetIds,ids)
    && collection.financialWrites===0&&capture?.items?.length===ids.length&&Date.now()-Date.parse(collection.observedAt)>=0
    && Date.now()-Date.parse(collection.observedAt)<=300_000, 'Complete current server-acquired draft evidence is unavailable.');
  const proofs=capture.items.map(input=>input.held?null:buildExistingDraftAuthorisationEvidence({selection:input.selection,source:input.source,reviewedTarget:input.reviewedTarget,before:input.before,current:input.current}));
  capture.items.forEach((item,i)=>assert(item.before.InvoiceID===ids[i]&&(!proofs[i]?.proofValid||same(item.selection,proofs[i].evidence.selection)), 'The pinned approved target or scope changed.'));
  return {collection,capture,proofs};
}
export async function existingDraftAuthorisationPreview(body={},deps={}) {
  assert(plain(body)&&Object.keys(body).join(',')==='targetIds','Only exact approved target IDs can be supplied.');
  const actor=actorFor(deps.accessContext),client=deps.client||xeroContactSyncServiceClient(deps.env||process.env);
  const observed=await observe(body.targetIds,actor,{...deps,client}); const at=new Date().toISOString(),id=randomUUID();
  const items=observed.capture.items.map((entry,i)=>{
    const proof=observed.proofs[i],e=proof?.proofValid?proof.evidence:null,record=entry.selection.record;
    const base=e?e.source:{salesforceObject:record.sourceObject,salesforceId:record.sourceId,documentNumber:entry.before.InvoiceNumber,
      documentKind:record.sourceObject==='Invoice__c'?'buyer_invoice':'supplier_bill',xeroType:entry.before.Type,xeroCollection:'Invoices',
      currency:record.currency,total:Number(record.total),accountName:entry.reviewedTarget.Contact?.Name||'',sourceFingerprint:null,financialFingerprint:null};
    const blockers=e?[]:entry.held?[entry.held.message]:(proof?.blockers||['Current draft evidence is held.']);
    const row=toSyncItemRow({...base,action:e?'protected_legacy':'blocked',status:e?'eligible':'blocked',blockers,
      warnings:['Authorises the existing draft. PDF checking is deferred. No lines, sending or allocations change.'],xero:normalizeXeroInvoice(entry.before),proposedPayload:null,differences:[]},id,i,at);
    row.source_payload={...base,...(e?{existingDraftAuthorisation:e}:{existingDraftAuthorisationHold:{policyVersion:POLICY,targetId:entry.before.InvoiceID,reasonCode:entry.held?.reasonCode||'XERO_DRAFT_STATUS_PROOF_HELD'}})};
    row.xero_payload=entry.before;row.proposed_payload=null;row.mutation_attempts=0;return row;
  });
  const summary={total:items.length,eligible:items.filter(r=>r.status==='eligible').length,blocked:items.filter(r=>r.status==='blocked').length,financialWrites:0};
  const run={id,idempotency_key:`preview:${id}`,mode:'preview',status:'building',revision:1,cutoff_date:XERO_FINANCIAL_CUTOFF,
    source_snapshot_at:at,xero_snapshot_at:at,source_fingerprint:hash(items.map(r=>r.source_payload)),xero_fingerprint:hash(items.map(r=>r.xero_payload)),
    control_totals:{preservationPolicy:POLICY,postingMode:'authorised',existingDraftAuthorisation:{policyVersion:POLICY,targetIds:body.targetIds,scopeFingerprint:observed.collection.scopeFingerprint},
      workflowSnapshot:{reconciliationVersion:XERO_RECONCILIATION_VERSION,checkedAt:at}},classification_summary:summary,
    rate_limit_snapshot:observed.collection.forecast,created_by:actor.id,created_by_email:actor.email,created_at:at,updated_at:at};
  const parameters=preparePreviewPersistence(run,items,{tenantId:observed.collection.tenantId,includePayments:false,
    salesforceOrgId:fcosSalesforceEnvironment('production').orgId,inputEvidenceHash:hash({scope:body,items})});
  assert(Buffer.byteLength(JSON.stringify(parameters))<=4_000_000,'The complete review exceeds the storage bound. Select a smaller cohort.');
  // Read the exact intended publication after a lost response; never publish a second review.
  let response;
  try { response=await client.rpc('persist_xero_existing_draft_authorisation_preview_v1',parameters); } catch { /* Exact saved readback below decides the outcome. */ }
  const persisted=await saved(client,id,actor);
  const payloadHash=hash({run:parameters.p_run,items:parameters.p_items,reviewIdentity:parameters.p_review_identity});
  const expectedControls={...parameters.p_run.control_totals,workflowSnapshot:{...parameters.p_run.control_totals.workflowSnapshot,existingDraftPreviewPayloadHash:payloadHash}};
  const audit=await client.from('xero_financial_audit_events').select('*').eq('run_id',id).eq('event_type','existing_draft_authorisation_preview_published').limit(2);
  assert(!audit.error&&audit.data?.length===1&&audit.data[0].outcome==='success'&&audit.data[0].actor_id===actor.id&&audit.data[0].actor_email===actor.email
    &&same(audit.data[0].fingerprints,{payloadHash,reviewIdentity:parameters.p_review_identity})
    &&same(persisted.run.control_totals,expectedControls)&&persisted.run.status==='ready_for_review'&&persisted.run.revision===1
    &&Object.entries(parameters.p_run).filter(([k])=>!['status','control_totals'].includes(k)).every(([k,v])=>metadataSame(k,persisted.run[k],v))
    &&persisted.items.length===items.length&&items.every((r,i)=>Object.entries(r).every(([k,v])=>metadataSame(k,persisted.items[i][k],v)))
    &&(!response?.data||response.data.run?.id===id),
  'The complete preview publication is uncertain. Do not repeat it.', 'XERO_DRAFT_STATUS_PUBLICATION_UNCERTAIN');
  return {run:runView(persisted.run),rows:persisted.items.map(rowView),summary,forecast:observed.collection.forecast,financialWrites:0,documentVerification:'UNVERIFIED'};
}
export async function existingDraftAuthorisationRead(body={},deps={}) {
  assert(plain(body)&&Object.keys(body).join(',')==='runId'&&uid(body.runId),'An exact owned review ID is required.');
  const actor=actorFor(deps.accessContext),client=deps.client||xeroContactSyncServiceClient(deps.env||process.env),r=await saved(client,body.runId,actor);
  return {run:runView(r.run),rows:r.items.map(rowView),financialWrites:r.items.filter(i=>i.status==='updated').length,documentVerification:'UNVERIFIED'};
}

async function transition(client,run,name,args,expected) {
  const r=await client.rpc(name,{p_run_id:run.id,p_expected_revision:run.revision,...args});
  assert(!r.error&&r.data?.id===run.id&&r.data.revision===run.revision+1&&r.data.status===expected
    &&r.data.reviewed_by===(args.p_actor_id||run.reviewed_by)&&r.data.reviewed_by_email===(args.p_actor_email||run.reviewed_by_email)
    &&Number.isFinite(Date.parse(r.data.reviewed_at))
    && ['control_totals','source_fingerprint','xero_fingerprint','created_by','created_by_email','mode','cutoff_date'].every(k=>same(r.data[k],run[k])), 'The durable run transition is uncertain.');return r.data;
}
function finishEvidence(e,request,observed,verification,status) {
  return {policyVersion:POLICY,claimEvidenceHash:existingDraftAuthorisationHash(e),observed,verification,request,status};
}
const publicOutcome=(row,status)=>({itemId:row.id,targetId:row.xero_document_id,sourceNumber:clean(row.source_document_number),company:clean(row.source_payload.accountName),status,documentVerification:'UNVERIFIED'});

export async function existingDraftAuthorisationApply(body={},deps={}) {
  requireExternalActionGate('xero_financial_sync',deps.env||process.env);
  assert(plain(body)&&Object.keys(body).sort().join(',')==='reviewed,revision,runId,selectedItemIds'&&body.reviewed===true
    &&uid(body.runId)&&Number.isSafeInteger(body.revision)&&Array.isArray(body.selectedItemIds)&&body.selectedItemIds.length>=1&&body.selectedItemIds.length<=25
    &&body.selectedItemIds.every(uid)&&new Set(body.selectedItemIds).size===body.selectedItemIds.length,'Select the exact approved unchanged drafts and revision.');
  const actor=actorFor(deps.accessContext),client=deps.client||xeroContactSyncServiceClient(deps.env||process.env);
  let loaded=await saved(client,body.runId,actor),run=loaded.run;
  const chosen=loaded.items.filter(r=>body.selectedItemIds.includes(r.id));
  assert(run.revision===body.revision&&['ready_for_review','authorised'].includes(run.status)&&chosen.length===body.selectedItemIds.length
    &&chosen.every(r=>r.proposed_action==='protected_legacy'&&r.blockers.length===0&&evaluateExistingDraftAuthorisationEvidence(r.source_payload.existingDraftAuthorisation).proofValid), 'Held or changed rows cannot be authorised.');
  if(run.status==='authorised') assert(run.reviewed_by===actor.id&&run.reviewed_by_email===actor.email&&loaded.items.filter(r=>r.selected).length===chosen.length&&chosen.every(r=>r.selected), 'Existing selected approval changed.');
  const fresh=await observe(chosen.map(r=>r.xero_document_id),actor,{...deps,client,applying:true,runId:run.id});
  const outcomes=[];let uncertainty=false;
  const finish=async(status,error)=>{run=await transition(client,run,'finish_xero_financial_sync_run_v1',{p_status:status,
    p_classification_summary:{total:chosen.length,authorised:outcomes.filter(o=>o.status==='confirmed').length,financialWrites:outcomes.filter(o=>o.status==='confirmed').length},
    p_rate_limit_snapshot:{},p_error_code:error?.code||null,p_error_message:error?.message||null},status);};
  try {
    const eligible=[];
    chosen.forEach((row,i)=>{
      const old=row.source_payload.existingDraftAuthorisation,proof=fresh.proofs[i];
      if(!proof?.proofValid||!same(old.source,proof.evidence.source)||!same(old.selection,proof.evidence.selection)
        ||!same(old.reviewedTarget,proof.evidence.reviewedTarget)||!same(noUpdate(old.before),noUpdate(proof.evidence.before))) outcomes.push(publicOutcome(row,'held'));
      else eligible.push({row,proof});
    });
    assert(eligible.length>0,'No unchanged eligible draft remains. No authorisation was sent.');
    const ids=eligible.map(({row})=>row.id);
    if(run.status==='ready_for_review') run=await transition(client,run,'authorise_xero_financial_sync_run_v1',{p_selected_item_ids:ids,p_actor_id:actor.id,p_actor_email:actor.email},'authorised');
    else assert(ids.length===chosen.length,'The previously approved run selection changed; refresh before execution.');
    run=await transition(client,run,'start_xero_financial_sync_run_v1',{},'processing');loaded=await saved(client,run.id,actor);
    for(const {row:prior,proof} of eligible) {
      fresh.capture.guard();const row=loaded.items.find(r=>r.id===prior.id),e=proof.evidence;
      assert(row?.selected===true&&row.status==='selected','The selected draft row changed.');
      const idempotencyKey=`draft-status:${run.id}:${row.id}`;
      uncertainty=true;
      let claim;
      try {
        claim=await (deps.claim||claimExistingDraftAuthorisation)(client,{runId:run.id,expectedRunRevision:run.revision,itemId:row.id,
          expectedItemUpdatedAt:row.updated_at,tenantId:fresh.collection.tenantId,idempotencyKey,evidence:e,actor});
      } catch(error) {
        if(error?.code === 'DRAFT_AUTHORISATION_INTENT_REJECTED') {
          uncertainty=false;outcomes.push(publicOutcome(row,'held'));continue;
        }
        throw error;
      }
      assert(uid(claim.id)&&claim.alreadyClaimed!==true,'An existing claim requires GET-only recovery; no status was resent.');
      const request={requestId:randomUUID(),budgetId:fresh.capture.budget.id,tokenVersion:fresh.capture.connection.tokenVersion};
      await (deps.bind||bindExistingDraftAuthorisationRequest)(client,{claimId:claim.id,...request,actor});
      const locked=await readExistingDraftDetail(fresh.capture.connection,row.xero_document_id,fresh.capture.read);
      let preflightError;
      try {
        assert(same(noUpdate(locked),noUpdate(e.before)), 'The target changed immediately before authorisation.');
        await fresh.capture.recheck(row.xero_document_id);
      } catch(error) { preflightError=error; }
      if(preflightError) {
        // No POST was admitted. Retain the actual GET facts, release only this
        // never-sent intent, and let independent unchanged records continue.
        await (deps.finish||finishExistingDraftAuthorisation)(client,{claimId:claim.id,status:'rejected',evidenceFinish:finishEvidence(e,request,locked,
          receiptFor(fresh.capture,row.xero_document_id), 'rejected'),actor});
        uncertainty=false;outcomes.push(publicOutcome(row,'held'));continue;
      }
      let postError;
      try {
        await (deps.withBudget||runWithXeroBudget)(fresh.capture.connection,{budgetId:request.budgetId,budgetPhase:'operation',requestId:request.requestId},()=>
          (deps.accountingFetch||xeroAccountingFetch)(fresh.capture.connection,`/Invoices/${row.xero_document_id}?unitdp=4`,{method:'POST',body:proof.payload,idempotencyKey,
            requestId:request.requestId,budgetId:request.budgetId,env:deps.env||process.env,fetchImpl:deps.fetchImpl,retryOnRateLimit:false,transientRetryLimit:0,callsPerMinute:45}));
      }catch(error){postError=error;}
      const after=await readExistingDraftDetail(fresh.capture.connection,row.xero_document_id,fresh.capture.read,'verification');
      const verification=receiptFor(fresh.capture,row.xero_document_id),result=classifyExistingDraftAuthorisationReadback({evidence:e,observed:after});
      const admitted=await oneOrNull(client.from('xero_shared_requests').select('*').eq('tenant_id',fresh.collection.tenantId).eq('id',request.requestId));
      const definitiveRejected=result.status==='unchanged'&&(!admitted||admitted.state==='complete'&&[400,401,403,404,422].includes(admitted.response_status));
      const status=result.status==='confirmed'?'confirmed':definitiveRejected?'rejected':'uncertain';
      await (deps.finish||finishExistingDraftAuthorisation)(client,{claimId:claim.id,status,evidenceFinish:finishEvidence(e,request,after,verification,status),actor});
      if(status==='uncertain') throw fail('The authorisation outcome needs readback. No status update will be resent.','XERO_DRAFT_STATUS_OUTCOME_UNCERTAIN');

      uncertainty=false;outcomes.push(publicOutcome(row,status));
      if(postError&&status!=='confirmed') break;
    }
    await finish(outcomes.every(o=>o.status==='confirmed')?'completed':'partial');
    return {run:runView(run),outcomes,financialWrites:outcomes.filter(o=>o.status==='confirmed').length,documentVerification:'UNVERIFIED'};
  }catch(error){if(!uncertainty&&run.status==='processing') await finish(outcomes.length?'partial':'failed',error).catch(()=>{});throw error;}
  finally{await fresh.capture.release(uncertainty?'Draft-status outcome unresolved; durable barriers retained':'Draft-status batch complete').catch(()=>{});}
}
async function oneOrNull(query){const r=await query.maybeSingle();assert(!r.error,'The durable request evidence is unavailable.');return r.data;}
function receiptFor(capture,id){
  // The private collector appends every subsequent locked/readback GET receipt.
  const receipt=capture.receipts?.filter(r=>r.path===`/Invoices/${id}?unitdp=4`).at(-1);
  assert(receipt&&uid(receipt.requestId),'The exact shared detail read receipt is unavailable.');
  return {requestId:receipt.requestId,budgetId:receipt.budgetId,tokenVersion:receipt.tokenVersion};
}

export async function existingDraftAuthorisationRecover(body={},deps={}) {
  requireExternalActionGate('xero_financial_sync',deps.env||process.env);
  assert(plain(body)&&Object.keys(body).join(',')==='claimId'&&uid(body.claimId),'An exact owned uncertain claim is required.');
  const actor=actorFor(deps.accessContext),client=deps.client||xeroContactSyncServiceClient(deps.env||process.env);
  const originalClaim=await one(client.from('xero_existing_draft_authorisation_claims').select('*').eq('id',body.claimId).eq('actor_id',actor.id).eq('actor_email',actor.email));
  const stored=await (deps.readOutcome||readExistingDraftAuthorisationOutcome)(client,recoveryContext(originalClaim,actor));
  assert(stored?.claim,'The original status claim is unavailable.');
  const claim=stored.claim;let request=stored.request;
  if(['confirmed','rejected'].includes(stored.status)){await closeRecoveredRun(client,claim,actor,deps);return {claimId:claim.id,status:stored.status,financialWrites:stored.status==='confirmed'?1:0,documentVerification:'UNVERIFIED'};}
  const connection=await (deps.getConnection||getFreshXeroConnection)(client,{env:deps.env||process.env,fetchImpl:deps.fetchImpl});
  assert(connection.tenantId===claim.tenant_id&&Number.isSafeInteger(connection.tokenVersion)&&connection.tokenVersion>0
    &&Date.parse(connection.expiresAt)>Date.now()+90_000,'The recovery organisation or current connection changed.');
  // Recovery admission uses the claim's preserved GET-only escrow. The
  // database checks current allowance, provider holds, identity and capacity
  // atomically; an expired new-action grant cannot strand an existing intent.
  const budget=await (deps.reserveBudget||reserveExistingDraftQuota)(connection,{client,actor,targetIds:[claim.target_id],
    mode:'recovery',runId:claim.run_id,claimId:claim.id,ttlSeconds:600});
  assert(uid(budget?.id),'The recovery capacity was not durably reserved.');
  let receipt;
  try {
    if(!request){
      request=await (deps.bind||bindExistingDraftAuthorisationRequest)(client,{claimId:claim.id,requestId:randomUUID(),budgetId:budget.id,tokenVersion:connection.tokenVersion,actor});
    }
    const read=(_c,path)=> (deps.withBudget||runWithXeroBudget)(connection,{budgetId:budget.id,budgetPhase:'verification'},()=>
      (deps.accountingFetch||xeroAccountingFetch)(connection,path,{method:'GET',env:deps.env||process.env,fetchImpl:deps.fetchImpl,budgetId:budget.id,budgetPhase:'verification',
        transientRetryLimit:0,retryOnRateLimit:false,callsPerMinute:45,onResponse:r=>{
          assert(!receipt&&uid(r.requestId)&&r.budgetId===budget.id&&r.pathName===path&&r.method==='GET'&&r.status>=200&&r.status<300,
            'The exact successful recovery receipt is unavailable.');receipt=r;}}));
    const observed=await readExistingDraftDetail(connection,claim.target_id,read,'verification');
    assert(receipt,'The recovery read has no durable receipt.');
    const result=classifyExistingDraftAuthorisationReadback({evidence:claim.evidence,observed});
    const verification={requestId:receipt.requestId,budgetId:budget.id,tokenVersion:connection.tokenVersion};
    const original={requestId:request.request_id,budgetId:request.budget_id,tokenVersion:request.token_version};
    const admitted=await oneOrNull(client.from('xero_shared_requests').select('*').eq('id',original.requestId).eq('tenant_id',connection.tenantId));
    const outcome=admitted&&result.status==='confirmed'?'confirmed':!admitted||result.status==='unchanged'&&admitted.state==='complete'
      &&admitted.response_status>=400&&admitted.response_status<500&&![408,409,429].includes(admitted.response_status)?'rejected':'uncertain';
    assert(outcome!=='uncertain','Readback remains unresolved. No authorisation was retried.');
    await (deps.finish||finishExistingDraftAuthorisation)(client,{claimId:claim.id,status:outcome,evidenceFinish:finishEvidence(claim.evidence,original,observed,verification,outcome),actor});

    await closeRecoveredRun(client,claim,actor,deps);
    return {claimId:claim.id,status:outcome,financialWrites:outcome==='confirmed'?1:0,documentVerification:'UNVERIFIED'};
  } finally {await (deps.releaseBudget||releaseExistingDraftQuota)(connection,{client,actor,budgetId:budget.id,reason:'Status recovery GET finished'}).catch(()=>{});}
}

const recoveryContext=(claim,actor)=>({claimId:claim.id,runId:claim.run_id,itemId:claim.item_id,tenantId:claim.tenant_id,idempotencyKey:claim.idempotency_key,expectedEvidenceHash:claim.evidence_hash,actor});
async function closeRecoveredRun(client,claim,actor,deps) {
  const loaded=await saved(client,claim.run_id,actor),run=loaded.run;
  if(run.status!=='processing')return;
  assert(run.revision===claim.run_revision&&run.reviewed_by===actor.id&&run.reviewed_by_email===actor.email,'The original recovery run revision changed.');
  const response=await client.from('xero_existing_draft_authorisation_claims').select('*').eq('run_id',run.id).limit(26);
  assert(!response.error&&Array.isArray(response.data)&&response.data.length>=1&&response.data.length<=25,'Complete recovery claims are unavailable.');
  let confirmed=0;
  for(const current of response.data){
    const original=await (deps.readOutcome||readExistingDraftAuthorisationOutcome)(client,recoveryContext(current,actor));
    const status=original?.status;
    // An unresolved sibling retains the run barrier. Do not turn it into a
    // failed or completed outcome to make a new batch eligible.
    if(!['confirmed','rejected'].includes(status))return;
    if(status==='confirmed')confirmed++;
  }
  const selected=loaded.items.filter(r=>r.selected),status=confirmed===selected.length?'completed':'partial';
  await transition(client,run,'finish_xero_financial_sync_run_v1',{p_status:status,
    p_classification_summary:{total:selected.length,authorised:confirmed,financialWrites:confirmed,notConfirmed:selected.length-confirmed},
    p_rate_limit_snapshot:{},p_error_code:null,p_error_message:null},status);
}

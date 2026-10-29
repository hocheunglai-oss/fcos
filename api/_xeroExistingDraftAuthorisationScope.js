import { readStoredXeroConnection, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { existingDraftAuthorisationForecast } from './_xeroExistingDraftAuthorisationCollector.js';
import { readXeroSharedStatus } from './_xeroSharedControl.js';
import { readExistingDraftQuotaPolicy, existingDraftSpendableCalls } from './_xeroExistingDraftQuota.js';
const uuid = v => typeof v === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const clean = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0,256) : '';
const check = (ok, message) => { if (!ok) throw Object.assign(Error(message), { code:'XERO_DRAFT_STATUS_SCOPE_HELD',status:409 }); };
// This reads private fixed approval and durable outcomes only; it neither
// renews a token nor makes a Xero request. Raw evidence stays server-side.
export async function existingDraftAuthorisationApprovedScope(body={},deps={}) {
  const actor=deps.accessContext?.profile;
  check(body && typeof body==='object' && !Array.isArray(body) && Object.keys(body).length===0 && uuid(actor?.id)
    && typeof actor.email==='string', 'A current authenticated Finance operator is required.');
  const client=deps.client || xeroContactSyncServiceClient(deps.env || process.env);
  const connection=await (deps.readConnection || readStoredXeroConnection)(client);
  check(uuid(connection?.tenantId),'The scoped Xero connection is unavailable.');
  const selected=await client.from('xero_existing_draft_authorisation_approved_records').select('target_id,source_id,source_object,selection,reviewed_target')
    .eq('tenant_id',connection.tenantId).order('target_id').limit(55);
  check(!selected.error && selected.data?.length===54 && new Set(selected.data.map(r=>r.target_id)).size===54
    && selected.data.every(r=>uuid(r.target_id)&&r.selection?.record?.targetId===r.target_id), 'The complete fixed approved scope is unavailable.');
  const ids=selected.data.map(r=>r.target_id);
  const [mappings,claims]=await Promise.all([
    client.from('xero_financial_document_mappings').select('id,salesforce_object,salesforce_id,xero_document_id,xero_status').in('xero_document_id',ids).limit(55),
    client.from('xero_existing_draft_authorisation_claims').select('id,target_id,run_id,actor_id,actor_email,xero_existing_draft_authorisation_events(status)')
      .eq('tenant_id',connection.tenantId).in('target_id',ids).limit(1001),
  ]);
  check(!mappings.error && Array.isArray(mappings.data)&&mappings.data.length<=54 && !claims.error
    && Array.isArray(claims.data)&&claims.data.length<=1000, 'The complete durable draft outcomes are unavailable.');
  const unresolved=claims.data.filter(r=>!r.xero_existing_draft_authorisation_events?.some(e=>['confirmed','rejected'].includes(e.status)));
  const rows=selected.data.map(r=>{
    const record=r.selection.record, matches=mappings.data.filter(m=>m.xero_document_id===r.target_id);
    const status=matches.length===1&&matches[0].salesforce_object===r.source_object&&typeof matches[0].salesforce_id==='string'&&matches[0].salesforce_id.slice(0,15)===r.source_id.slice(0,15)?matches[0].xero_status:'OWNERSHIP_HELD';
    return {targetId:r.target_id,sourceId:r.source_id,sourceNumber:clean(r.reviewed_target.InvoiceNumber),company:clean(r.reviewed_target.Contact?.Name),
      reference:clean(r.reviewed_target.Reference),direction:r.source_object==='Invoice__c'?'Sales':'Bill',currency:record.currency,total:record.total,status};
  });
  const shared=await (deps.readStatus || readXeroSharedStatus)(connection);
  const policy=await (deps.readQuotaPolicy || readExistingDraftQuotaPolicy)(connection,{client,actor,targetIds:ids});
  const spendable=existingDraftSpendableCalls(shared,policy);
  let maxSafeCohort=0;
  if(!shared.dailyHold&&!shared.retryAt&&shared.unresolvedWrites===0)for(let count=1;count<=5;count++) {
    if(existingDraftAuthorisationForecast(count).totalCalls+existingDraftAuthorisationForecast(count,true).totalCalls<=spendable)maxSafeCohort=count;
  }
  return {rows,maxSafeCohort,completed:rows.filter(r=>['AUTHORISED','PAID'].includes(r.status)).length,
    unresolved:unresolved.filter(r=>r.actor_id===actor.id&&r.actor_email===actor.email.trim().toLowerCase()).map(r=>({claimId:r.id,targetId:r.target_id,runId:r.run_id})),
    executionHeld:unresolved.length>0,documentVerification:'UNVERIFIED',providerCalls:0,
    allowance:{observedAt:shared.rateLimit?.observedAt || null,availableCalls:shared.availableCalls,spendableCalls:spendable,reserve:policy.reserveFloor,reserveException:policy.reserveFloor===0,reserveExceptionExpiresAt:policy.grantExpiresAt,retryAt:shared.retryAt || null}};
}

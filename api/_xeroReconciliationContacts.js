import { randomUUID } from 'node:crypto';
import { requireExternalActionGate } from './_externalActionGates.js';
import { acquireLifecycleLock } from './_xeroPortal.js';
import { splitScopes, xeroAccountingFetch } from './_xeroContactSync.js';
import { contactRestoreBusinessFingerprint } from './_xeroContactRestore.js';
import { contactRestoreHash as hash, restoreAccountId as sfId, restoreUuid as uuid } from './_xeroContactRestorePolicy.js';
import { xeroSharedContext } from './_xeroSharedControl.js';

export const CAMPAIGN_CONTACT_POLICY = 'same_name_account_family_v1';
const nameKey = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
const text = value => typeof value === 'string' ? value.trim() : '';
const placeholder = value => /^(no\s*name|unknown|cash|miscellaneous|n\/?a|tbd|test|supplier|buyer)$/i.test(nameKey(value));
const error = (message, code = 'XERO_CAMPAIGN_CONTACT_INVALID', status = 409, details = {}) => Object.assign(new Error(message), { code, status, expose: true, details });
const storageError = () => error('The Contact operation evidence could not be durably verified.', 'XERO_CAMPAIGN_CONTACT_STORAGE', 503);
const accountView = row => ({ id: row.id, name: row.name, companyCode: row.companyCode || '', inactiveSuspended: row.inactiveSuspended, recordType: row.recordType || '' });
const contactView = row => ({ id: uuid(row.id), name: row.name, status: row.status, accountNumber: row.accountNumber || '', contactNumber: row.contactNumber || '', mergedToContactId: row.mergedToContactId || null });
const identity = row => { const { status: _status, ...fields } = contactView(row); return fields; };
const orderAccounts = rows => rows.map(accountView).sort((a,b) => sfId(a.id).localeCompare(sfId(b.id)));
const orderContacts = rows => rows.map(contactView).sort((a,b) => a.id.localeCompare(b.id));

function validateInventory(accounts, contacts, complete) {
  if (complete !== true || !Array.isArray(accounts) || !Array.isArray(contacts)
    || accounts.some(row => !sfId(row?.id) || !text(row.name) || typeof row.inactiveSuspended !== 'boolean'
      || (row.companyCode != null && typeof row.companyCode !== 'string') || (row.recordType != null && typeof row.recordType !== 'string'))
    || contacts.some(row => !uuid(row?.id) || !text(row.name) || !['ACTIVE','ARCHIVED','GDPRREQUEST'].includes(row.status)
      || ['accountNumber','contactNumber'].some(key => row[key] != null && typeof row[key] !== 'string'))
    || new Set(accounts.map(row => sfId(row.id))).size !== accounts.length || new Set(contacts.map(row => uuid(row.id))).size !== contacts.length) {
    throw error('Complete, duplicate-free Salesforce Account and Xero Contact inventories are required.');
  }
}

function familyState(family, allAccounts, contacts) {
  const familyName = nameKey(family[0]?.name);
  const ids = new Set(family.map(row => sfId(row.id)));
  const keys = new Set(family.map(row => nameKey(row.companyCode)).filter(Boolean));
  const exact = contacts.filter(row => nameKey(row.name) === familyName);
  const numberOwners = value => allAccounts.filter(row => (sfId(text(value)) && sfId(row.id) === sfId(text(value)))
    || (nameKey(value) && nameKey(row.companyCode) && nameKey(value) === nameKey(row.companyCode)));
  const related = contacts.filter(row => nameKey(row.name) === familyName || keys.has(nameKey(row.name))
    || [row.accountNumber,row.contactNumber].some(value => numberOwners(value).some(owner => ids.has(sfId(owner.id)))));
  const foreignAccounts = allAccounts.filter(row => !ids.has(sfId(row.id)) && keys.has(nameKey(row.companyCode)));
  for (const target of exact) {
    for (const value of [target.accountNumber,target.contactNumber]) {
      for (const owner of numberOwners(value)) if (!ids.has(sfId(owner.id))) foreignAccounts.push(owner);
    }
  }
  const uniqueForeign = [...new Map(foreignAccounts.map(row => [sfId(row.id),row])).values()];
  const blockers = [];
  if (family.some(row => row.inactiveSuspended)) blockers.push('An Account in this exact-name family is inactive or suspended.');
  if (family.some(row => placeholder(row.name))) blockers.push('A placeholder Account name cannot create or restore an accounting Contact.');
  if (family.some(row => text(row.name).length > 255)) blockers.push('The Account name exceeds the Xero Contact name limit.');
  if (family.some(row => !['Buyer','Supplier','Buyer_Supplier','Broker'].includes(row.recordType))) blockers.push('A source Account has an unsupported or missing business record type.');
  if (uniqueForeign.length) blockers.push('A CL key or explicit Contact identifier belongs to a different Salesforce legal name.');
  if (related.some(row => nameKey(row.name) !== familyName)) blockers.push('A different-name Xero Contact already claims this family’s explicit identifier.');
  if (exact.some(row => [row.accountNumber,row.contactNumber].some(value => sfId(text(value)) && !allAccounts.some(account => sfId(account.id) === sfId(text(value)))))) blockers.push('A Contact contains a Salesforce Account identifier that cannot be verified in the complete source inventory.');
  if (exact.some(row => row.status === 'GDPRREQUEST' || row.mergedToContactId)) blockers.push('A matching Contact is merged or in a protected status.');
  const active = exact.filter(row => row.status === 'ACTIVE');
  const archived = exact.filter(row => row.status === 'ARCHIVED');
  if (active.length > 1) blockers.push('More than one active Contact has this exact legal name.');
  if (!active.length && archived.length > 1) blockers.push('More than one archived Contact has this exact legal name.');
  return { exact, active, archived, related, foreignAccounts: uniqueForeign, blockers: [...new Set(blockers)] };
}
function makeCase({ tenantId, family, state, ownerId, baselineAt }) {
  const accounts = orderAccounts(family); const sourceId = accounts[0].id;
  const caseKey = `${tenantId}:Account:${sourceId}`;
  const target = state.active[0] || (state.archived.length === 1 ? state.archived[0] : null);
  const action = state.active.length === 1 ? null : state.archived.length === 1 ? 'restore' : 'create';
  const proposal = action ? { action, Name: text(accounts[0].name).replace(/\s+/g,' '), ContactStatus: 'ACTIVE',
    ...(action === 'restore' ? { ContactID: uuid(target.id) } : {}), accounts } : null;
  const contactEvidence = { policyVersion: CAMPAIGN_CONTACT_POLICY, tenantId, accounts, sourceFingerprint: hash(accounts),
    contacts: orderContacts(state.related), foreignAccounts: orderAccounts(state.foreignAccounts),
    targetIdentityFingerprint: target ? hash(identity(target)) : null };
  const reasons = state.blockers.length ? state.blockers : [action === null
    ? 'The unique active Contact is verified for this exact-name Account family.' : action === 'restore'
    ? 'Restore the single archived exact-name Contact; retain all its other details.'
    : 'Create one Contact for this exact-name Account family. Missing CL keys do not prevent this operation.'];
  const evidenceFingerprint = hash({ caseKey, contactEvidence, proposal, reasons: state.blockers });
  return { id: caseKey, caseKey, category: 'contact', status: state.blockers.length ? 'needs_decision' : action === null ? 'reconciled' : 'ready', sourceObject:'Account',
    sourceId, sourceIds:accounts.map(row=>row.id), targetId:uuid(target?.id) || null, accountName:proposal?.Name || text(accounts[0].name),
    title:`Contact ${text(accounts[0].name)}`, reason:reasons[0],reasons,dependencies:[],ownerId,ownerName:null,total:null,currency:null,baselineAt,
    evidenceFingerprint, contactProposal:proposal, contactEvidence };
}

export function buildCampaignContactCases({tenantId,accounts,contacts,complete,requiredAccountIds,ownerId,baselineAt,includeVerifiedAccountIds=[]}={}) {
  if (!uuid(tenantId) || !uuid(ownerId) || !Number.isFinite(Date.parse(baselineAt)) || !Array.isArray(requiredAccountIds)
    || requiredAccountIds.some(id=>!sfId(id))) throw error('The exact tenant, owner, baseline and referenced Account IDs are required.');
  validateInventory(accounts,contacts,complete);
  if(!Array.isArray(includeVerifiedAccountIds)||includeVerifiedAccountIds.some(id=>!sfId(id)))throw error('Verified family refresh IDs are invalid.');
  const verified=new Set(includeVerifiedAccountIds.map(sfId));
  const required=new Set(requiredAccountIds.map(sfId));const families=new Map();
  for(const account of accounts) {const key=nameKey(account.name);families.set(key,[...(families.get(key)||[]),account]);}
  const results=[];
  for(const family of families.values()) {
    if(!family.some(account=>required.has(sfId(account.id))))continue;
    const state=familyState(family,accounts,contacts);
    if(state.active.length===1 && !state.blockers.length && !family.some(row=>verified.has(sfId(row.id))))continue;
    results.push(makeCase({tenantId,family,state,ownerId,baselineAt}));
  }
  for(const id of [...new Map(requiredAccountIds.map(value=>[sfId(value),value])).values()].filter(value=>!accounts.some(row=>sfId(row.id)===sfId(value)))) {
    const caseKey=`${tenantId}:Account:${id}`;const reason='The referenced Salesforce Account is absent from the complete current inventory.';
    results.push({id:caseKey,caseKey,category:'contact',status:'needs_decision',sourceObject:'Account',sourceId:id,sourceIds:[id],targetId:null,
      accountName:null,title:`Account ${id}`,reason,reasons:[reason],dependencies:[],ownerId,total:null,currency:null,baselineAt,
      evidenceFingerprint:hash({caseKey,reason}),contactProposal:null,contactEvidence:null});
  }
  return results.sort((a,b)=>a.caseKey.localeCompare(b.caseKey));
}

async function one(query) {const result=await query;if(result.error||!result.data)throw storageError();return result.data;}
async function verifyClaim(client, actor, batch, row, tenantId) {
  const current=await one(client.from('xero_reconciliation_batches').select('id,campaign_id,category,status,claim_id,claim_case_ids,approved_by,approved_at').eq('id',batch.id).maybeSingle());
  const campaign=await one(client.from('xero_reconciliation_campaigns').select('id,tenant_id').eq('id',current.campaign_id).maybeSingle());
  const saved=await one(client.from('xero_reconciliation_cases').select('id,evidence_fingerprint,evidence').eq('campaign_id',current.campaign_id).eq('id',row.id).maybeSingle());
  if(current.status!=='running'||current.category!=='contact'||current.claim_id!==batch.claim_id||!current.claim_case_ids?.includes(row.id)
    ||!current.approved_by||!current.approved_at||campaign.tenant_id!==tenantId||saved.evidence_fingerprint!==row.evidenceFingerprint
    ||hash(saved.evidence.contactProposal)!==hash(row.contactProposal)||hash(saved.evidence.contactEvidence)!==hash(row.contactEvidence)
    ||hash(saved.evidence.sourceIds)!==hash(row.sourceIds))throw error('The exact approved Contact claim changed.');
  const permitted=await client.rpc('xero_campaign_actor_v1',{p_actor:actor.id,p_tenant:tenantId});if(permitted.error)throw error('Current Xero management access is required.','XERO_CAMPAIGN_CONTACT_FORBIDDEN',403);
  return { campaignId:campaign.id, batchId:current.id, claimId:current.claim_id, caseId:row.id, tenantId, evidenceFingerprint:row.evidenceFingerprint };
}
async function verifyLease(client,leaseId) {
  const lease=await one(client.from('xero_contact_lifecycle_locks').select('run_id,locked_until').eq('id','primary').maybeSingle());
  if(lease.run_id!==leaseId||!(Date.parse(lease.locked_until)>Date.now()))throw error('The Contact lifecycle lease expired or changed.','XERO_CAMPAIGN_CONTACT_LEASE_CHANGED');
}
async function audit(client,actor,eventType,outcome,evidence) {
  const result=await client.from('xero_financial_audit_events').insert({run_id:null,event_type:eventType,outcome,
    actor_id:actor.id,actor_email:actor.email,record_counts:{contacts:1,financialWrites:0},fingerprints:evidence}).select('id').single();
  if(result.error||!/^[1-9]\d*$/.test(String(result.data?.id||''))
    || (typeof result.data.id==='number'&&!Number.isSafeInteger(result.data.id)))throw storageError();return String(result.data.id);
}
async function history(client,authority) {
  const result=await client.from('xero_financial_audit_events').select('id,event_type,outcome,fingerprints')
    .eq('fingerprints->>tenantId',authority.tenantId).eq('fingerprints->>caseId',authority.caseId)
    .in('event_type',['campaign_contact_intent','campaign_contact_response','campaign_contact_verified'])
    .order('created_at').order('id').limit(1001);
  if(result.error||!Array.isArray(result.data)||result.data.length>1000)throw storageError();
  const events=result.data.map(event=>{
    if(!/^[1-9]\d*$/.test(String(event.id))||(typeof event.id==='number'&&!Number.isSafeInteger(event.id)))throw storageError();
    return {...event,id:String(event.id)};
  });
  const sameClaim=proof=>['campaignId','batchId','claimId'].every(key=>proof[key]===authority[key]);
  for(const intent of events.filter(event=>event.event_type==='campaign_contact_intent'&&!sameClaim(event.fingerprints))){
    const matches=event=>Object.keys(authority).every(key=>event.fingerprints[key]===intent.fingerprints[key])&&event.fingerprints.intentId===intent.id;
    const responses=events.filter(event=>event.event_type==='campaign_contact_response'&&matches(event));
    if(responses.length===1&&responses[0].outcome==='rejected'&&responses[0].fingerprints.definitiveNoWrite===true&&responses[0].fingerprints.outcomeUnknown===false)continue;
    const verified=events.filter(event=>event.event_type==='campaign_contact_verified'&&event.outcome==='verified'&&matches(event));
    let finished=false;
    for(const receipt of verified){
      const outcomes=await client.from('xero_reconciliation_events').select('evidence').eq('campaign_id',intent.fingerprints.campaignId)
        .eq('batch_id',intent.fingerprints.batchId).eq('event_type','case_outcome').eq('evidence->>receiptId',receipt.id).limit(2);
      if(outcomes.error||!Array.isArray(outcomes.data))throw storageError();
      const outcome=outcomes.data.length===1?outcomes.data[0].evidence:null;
      if(outcome?.status==='reconciled'&&outcome.caseId===authority.caseId&&outcome.evidenceFingerprint===intent.fingerprints.evidenceFingerprint
        &&outcome.originalIntentId===intent.id&&outcome.verificationFingerprint===receipt.fingerprints.verificationFingerprint
        &&outcome.xeroContactId===receipt.fingerprints.xeroContactId&&hash(outcome.sourceIds)===hash(intent.fingerprints.sourceIds))finished=true;
    }
    if(!finished)throw error('An earlier Contact operation has different evidence or remains unresolved; resolve it before continuing.');
  }
  return events.filter(event=>sameClaim(event.fingerprints));
}
async function originalRequest(client,authority,intent){
  if(!uuid(intent.postRequestId)||!intent.postBudgetId)throw error('The original Contact intent has no durable shared request authority. No Contact was resent.');
  const result=await client.from('xero_shared_requests').select('*').eq('tenant_id',authority.tenantId).eq('id',intent.postRequestId).maybeSingle();
  if(result.error)throw storageError();if(!result.data)return null;
  const request=result.data;
  const budget=await one(client.from('xero_shared_budgets').select('*').eq('tenant_id',authority.tenantId).eq('id',intent.postBudgetId).maybeSingle());
  if(request.id!==intent.postRequestId||request.tenant_id!==authority.tenantId||budget.tenant_id!==authority.tenantId||budget.id!==intent.postBudgetId
    ||request.method!=='POST'||request.resource_key!=='Contacts'||request.budget_id!==intent.postBudgetId
    ||request.token_version!==intent.postTokenVersion||request.phase!=='operation'
    ||budget.owner_key!==`campaign:${authority.campaignId}:${authority.batchId}:${authority.claimId}`||!['inflight','complete','unknown'].includes(request.state))
    throw error('The original Contact admission authority changed.');
  if(request.state==='inflight'&&(!Number.isFinite(Date.parse(request.deadline_at))||Date.parse(request.deadline_at)>Date.now()))
    throw error('The original Contact request is still in flight. Wait for its deadline before recovery.');
  return request;
}
function rawDetail(raw) {
  if(!raw||!uuid(raw.ContactID)||!text(raw.Name)||!['ACTIVE','ARCHIVED'].includes(raw.ContactStatus)||raw.MergedToContactID
    ||raw.HasValidationErrors===true||(raw.ValidationErrors!=null&&(!Array.isArray(raw.ValidationErrors)||raw.ValidationErrors.length))
    ||['AccountNumber','ContactNumber'].some(key=>raw[key]!=null&&typeof raw[key]!=='string'))throw error('The exact Contact detail is incomplete, merged or invalid.');
  return {id:uuid(raw.ContactID),name:raw.Name,status:raw.ContactStatus,accountNumber:raw.AccountNumber||'',contactNumber:raw.ContactNumber||''};
}

function noWriteHold(row, reason, receiptId=null, originalIntentId=null) {
  return {caseId:row.id,evidenceFingerprint:row.evidenceFingerprint,status:'needs_decision',reason,definitiveNoWrite:true,
    ...(receiptId?{receiptId:String(receiptId)}:{}),...(originalIntentId?{originalIntentId:String(originalIntentId)}:{})};
}
function rejectedContact(row,response) {
  if(!Array.isArray(response?.Contacts)||response.Contacts.length!==1)return false;
  const raw=response.Contacts[0];const restore=row.contactProposal.action==='restore';
  const exactIdentity=raw&&nameKey(raw.Name)===nameKey(row.contactProposal.Name)
    &&(restore?uuid(raw.ContactID)===uuid(row.targetId)&&raw.ContactStatus==='ARCHIVED'
      :(!raw.ContactID||raw.ContactID==='00000000-0000-0000-0000-000000000000')&&raw.ContactStatus!=='ACTIVE');
  return Boolean(exactIdentity&&raw.StatusAttributeString!=='OK'&&raw.HasErrors!==false&&raw.HasValidationErrors!==false
    &&(raw.HasErrors===true||raw.HasValidationErrors===true||raw.StatusAttributeString==='ERROR')
    &&Array.isArray(raw.ValidationErrors)&&raw.ValidationErrors.length
    &&raw.ValidationErrors.every(item=>typeof item?.Message==='string'&&item.Message.trim()));
}

export async function executeCampaignContactCase({case:row,currentAccounts,currentContacts,connection,client,actor,batch,env=process.env,fetchImpl=fetch,
  recovering=false,accountingFetch=xeroAccountingFetch,lockReader=acquireLifecycleLock,budgetId=null}={}) {
  if(!uuid(actor?.id)||!text(actor.email)||!uuid(batch?.id)||!uuid(batch?.claim_id)||row?.status!=='ready'||row?.category!=='contact'
    ||row.sourceObject!=='Account'||row.contactEvidence?.policyVersion!==CAMPAIGN_CONTACT_POLICY||!row.contactProposal
    ||!['create','restore'].includes(row.contactProposal.action)||connection?.tenantId!==row.contactEvidence.tenantId)throw error('An exact approved Contact case and actor are required.');
  const authority=await verifyClaim(client,actor,batch,row,connection.tenantId);
  const previous=await history(client,authority);
  const intents=previous.filter(event=>event.event_type==='campaign_contact_intent');
  if(recovering&&!intents.length)return noWriteHold(row,'No durable Contact intent exists, so this claim performed no Contact POST. Review and approve a new claim.');
  if(intents.length>1)throw error('Recovery requires exactly one original durable Contact intent.');
  if(intents.some(event=>Object.entries(authority).some(([key,value])=>event.fingerprints[key]!==value)
    ||event.fingerprints.policyVersion!==CAMPAIGN_CONTACT_POLICY||hash(event.fingerprints.proposal)!==hash(row.contactProposal)
    ||event.fingerprints.sourceFingerprint!==row.contactEvidence.sourceFingerprint))throw error('An earlier Contact operation has different evidence; resolve it before continuing.');
  const recovery=recovering||intents.length>0;
  const responseEvents=previous.filter(event=>event.event_type==='campaign_contact_response'&&event.fingerprints.intentId===intents[0]?.id);
  if(responseEvents.length>1)throw error('More than one provider response claims this Contact intent.');
  if(responseEvents[0]?.fingerprints.definitiveNoWrite===true&&responseEvents[0].fingerprints.outcomeUnknown===false)
    return noWriteHold(row,'The original Contact request conclusively made no change. Refresh and review this family again.',responseEvents[0].id,intents[0].id);
  if(!recovery)requireExternalActionGate('xero_contact_sync',env);
  const scopes=splitScopes(connection.scope);
  if(recovery?!scopes.includes('accounting.contacts')&&!scopes.includes('accounting.contacts.read'):!scopes.includes('accounting.contacts'))
    throw error(recovery?'Xero Contact read scope is required for exact recovery.':'Xero Contact write scope is required.','XERO_CAMPAIGN_CONTACT_SCOPE',403);
  validateInventory(currentAccounts,currentContacts,true);
  const family=currentAccounts.filter(account=>nameKey(account.name)===nameKey(row.accountName));
  if(hash(orderAccounts(family))!==row.contactEvidence.sourceFingerprint)throw error('The complete Account family changed after approval.');
  const state=familyState(family,currentAccounts,currentContacts);
  if(state.blockers.length)throw error(state.blockers[0]);
  const current=makeCase({tenantId:connection.tenantId,family,state,ownerId:row.ownerId,baselineAt:row.baselineAt});
  if(!recovery&&current.evidenceFingerprint!==row.evidenceFingerprint)throw error('The Contact identity or collision evidence changed after approval.');
  const lockId=randomUUID();const lock=await lockReader(client,lockId,actor,env);
  let postReceipt=null,verificationReceipt=null;
  const capture=phase=>data=>{if(phase==='post')postReceipt=data;else if(phase==='verification')verificationReceipt=data;};
  const call=(path,options,phase='operation')=>accountingFetch(connection,path,{env,fetchImpl,retryOnRateLimit:false,...(budgetId?{budgetId}:{}),...options,budgetPhase:phase,onResponse:capture(phase==='verification'?'verification':options.method==='POST'?'post':'preflight')});
  const readExact=async(id,phase='verification')=>{const response=await call(`/Contacts/${encodeURIComponent(id)}?includeArchived=true`,{method:'GET'},phase);
    if(!Array.isArray(response?.Contacts)||response.Contacts.length!==1||uuid(response.Contacts[0].ContactID)!==uuid(id))throw error('The exact Contact readback was incomplete.');rawDetail(response.Contacts[0]);return response.Contacts[0];};
  const readName=async(phase='operation')=>{
    const params=new URLSearchParams({where:`Name==${JSON.stringify(row.contactProposal.Name)}`,includeArchived:'true',page:'1',pageSize:'100'});
    const response=await call(`/Contacts?${params}`,{method:'GET'},phase);
    if(!Array.isArray(response?.Contacts)||response.Contacts.length>=100||response.pagination?.pageCount>1||response.Contacts.some(raw=>nameKey(raw.Name)!==nameKey(row.accountName)))throw error('The exact-name Contact search was incomplete.');
    const details=response.Contacts.map(rawDetail);if(new Set(details.map(item=>item.id)).size!==details.length)throw error('The Contact search repeats identities.');return details;
  };
  try {
    let intent=intents[0]?.fingerprints;let intentId=intents[0]?.id;let contactId=row.targetId;let before=null;let postResponse=null;let postError=null;let postUnknown=false;
    if(!recovery) {
      if(row.contactProposal.action==='restore') {
        before=await readExact(contactId,'operation');
        if(before.ContactStatus!=='ARCHIVED'||hash(identity(rawDetail(before)))!==row.contactEvidence.targetIdentityFingerprint)throw error('The archived Contact changed before restoration.');
      } else if((await readName()).length)throw error('A Contact with this exact legal name now exists. Refresh before continuing.');
      await verifyClaim(client,actor,batch,row,connection.tenantId);
      const originalBudgetId=budgetId||xeroSharedContext(connection).budgetId;
      if(!originalBudgetId||!Number.isSafeInteger(connection.tokenVersion)||connection.tokenVersion<1)throw error('Durable Contact budget and token authority are required before submission.');
      intent={...authority,policyVersion:CAMPAIGN_CONTACT_POLICY,proposal:row.contactProposal,sourceFingerprint:row.contactEvidence.sourceFingerprint,
        sourceIds:row.sourceIds,postRequestId:randomUUID(),postBudgetId:originalBudgetId,postTokenVersion:connection.tokenVersion,
        beforeContact:before,businessFingerprint:before?contactRestoreBusinessFingerprint(before):null,
        idempotencyKey:`campaign-contact-${hash([authority.claimId,row.id,row.evidenceFingerprint]).slice(0,40)}`};
      await verifyLease(client,lockId);
      intentId=await audit(client,actor,'campaign_contact_intent','intent',intent);
      await verifyClaim(client,actor,batch,row,connection.tenantId);
      await verifyLease(client,lockId);
      let submitted=false;
      try {
        requireExternalActionGate('xero_contact_sync',env);
        if(!splitScopes(connection.scope).includes('accounting.contacts'))throw error('Xero Contact write scope is required.','XERO_CAMPAIGN_CONTACT_SCOPE',403);
        const payload=row.contactProposal.action==='restore'?{ContactID:contactId,ContactStatus:'ACTIVE'}:{Name:row.contactProposal.Name};
        submitted=true;
        postResponse=await call('/Contacts?summarizeErrors=false',{method:'POST',body:{Contacts:[payload]},requestId:intent.postRequestId,idempotencyKey:intent.idempotencyKey});
      } catch(caught) {postError=caught;postReceipt=postReceipt||{requestId:caught?.details?.requestId||null,budgetId:caught?.details?.budgetId||null};}
      postUnknown=postError?.details?.outcomeUnknown===true;
      if(postReceipt?.requestId&&postReceipt.requestId!==intent.postRequestId)throw error('The Contact response belongs to another shared request.');
      const neverAdmitted=submitted&&postError&&!postReceipt?.status&&!await originalRequest(client,authority,intent);
      const definitiveNoWrite=neverAdmitted||!postUnknown&&(!submitted||rejectedContact(row,postResponse)
        ||postReceipt?.status===400&&Boolean(postReceipt.requestId)&&postError?.status===400&&postError?.code==='XERO_CONTACT_SYNC_XERO_REQUEST_FAILED');
      const responseId=await audit(client,actor,'campaign_contact_response',definitiveNoWrite?'rejected':postError?'uncertain':'received',
        {...authority,intentId,outcomeUnknown:neverAdmitted?false:postUnknown,submitted:submitted&&!neverAdmitted,definitiveNoWrite,providerStatus:postReceipt?.status||null,
          requestId:intent.postRequestId,response:postResponse,providerErrorCode:/^[A-Z_]{1,100}$/.test(postError?.code||'')?postError.code:null});
      if(definitiveNoWrite)return noWriteHold(row,submitted?'Xero conclusively rejected this Contact request; no Contact change occurred. Refresh and review this family again.'
        :'The posting gate or write scope prevented this Contact submission. Review and approve a new claim.',responseId,intentId);
    } else {
      postResponse=responseEvents[0]?.fingerprints.response||null;postReceipt={requestId:intent.postRequestId};
      postUnknown=responseEvents[0]?.fingerprints.outcomeUnknown===true;
    }
    const admission=await originalRequest(client,authority,intent);
    if(!admission){
      const receiptId=responseEvents[0]?.id||await audit(client,actor,'campaign_contact_response','rejected',
        {...authority,intentId,outcomeUnknown:false,submitted:false,definitiveNoWrite:true,requestId:intent.postRequestId,response:null});
      return noWriteHold(row,'The durable Contact intent was never admitted, so no Contact POST occurred. Review and approve a new claim.',receiptId,intentId);
    }
    if(postReceipt?.requestId&&postReceipt.requestId!==intent.postRequestId)throw error('The Contact response belongs to another shared request.');
    postReceipt={...postReceipt,requestId:intent.postRequestId};
    postUnknown=admission.outcome_unknown===true||admission.state==='unknown'||admission.state==='inflight';
    if(postResponse) {
      if(!Array.isArray(postResponse.Contacts)||postResponse.Contacts.length!==1)throw error('The provider response did not identify one exact Contact.','XERO_CAMPAIGN_CONTACT_UNCERTAIN',503);
      const detail=rawDetail(postResponse.Contacts[0]);
      if(detail.status!=='ACTIVE'||nameKey(detail.name)!==nameKey(row.accountName)||(contactId&&detail.id!==uuid(contactId)))throw error('The provider response identity differs from the approved Contact.','XERO_CAMPAIGN_CONTACT_UNCERTAIN',503);
      contactId=detail.id;
    }
    if(!contactId) {
      const found=await readName('verification');const active=found.filter(item=>item.status==='ACTIVE');
      if(active.length!==1)throw error('The prior create outcome is unconfirmed; no Contact was resent.','XERO_CAMPAIGN_CONTACT_UNCERTAIN',503);
      contactId=active[0].id;
    }
    const after=await readExact(contactId);const detail=rawDetail(after);
    const updatedContacts=[...currentContacts.filter(item=>uuid(item.id)!==contactId),detail];
    const final=familyState(family,currentAccounts,updatedContacts);
    if(detail.status!=='ACTIVE'||nameKey(detail.name)!==nameKey(row.accountName)||final.blockers.length||final.active.length!==1
      ||(row.contactProposal.action==='restore'&&(hash(identity(detail))!==row.contactEvidence.targetIdentityFingerprint||contactRestoreBusinessFingerprint(after)!==intent.businessFingerprint))) {
      throw error('Readback did not confirm the exact active Contact with preserved identity and business fields.','XERO_CAMPAIGN_CONTACT_UNCERTAIN',503);
    }
    const proof={...authority,policyVersion:CAMPAIGN_CONTACT_POLICY,intentId,postRequestId:postReceipt?.requestId||null,
      verificationRequestId:verificationReceipt?.requestId||null,xeroContactId:contactId,sourceFingerprint:row.contactEvidence.sourceFingerprint,
      verifiedContact:after,businessFingerprint:contactRestoreBusinessFingerprint(after),recovery};
    const verificationFingerprint=hash(proof);const receiptId=await audit(client,actor,'campaign_contact_verified','verified',{...proof,verificationFingerprint});
    if(postUnknown) {
      if(!verificationReceipt?.requestId)throw error('The verified shared Contact readback receipt is unavailable.');
      await xeroSharedContext(connection).sharedControl.resolveUnknown({tenantId:connection.tenantId,requestId:postReceipt.requestId,
        verificationRequestId:verificationReceipt.requestId,evidenceReference:`xero_financial_audit_events:${receiptId}`});
    }
    return {caseId:row.id,evidenceFingerprint:row.evidenceFingerprint,status:'reconciled',verificationFingerprint,receiptId,xeroContactId:contactId,
      verifiedContact:detail,sourceIds:row.sourceIds,action:recovery?'verified_prior_outcome':row.contactProposal.action,originalIntentId:intentId};
  } finally {await lock.release();}
}

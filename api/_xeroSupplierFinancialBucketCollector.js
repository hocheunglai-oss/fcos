import { randomUUID } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { sfQuery, sfQueryAll } from './_salesforce.js';
import { xeroAccountingFetch, splitScopes } from './_xeroContactSync.js';
import { readXeroSharedStatus, reserveXeroBudget, releaseXeroBudget, runWithXeroBudget } from './_xeroSharedControl.js';
import { createSupplierSalesforceReader, readSupplierControlRows } from './_xeroSupplierDocumentReadEvidence.js';
import { readCampaignDocumentLinkReadback } from './_xeroReconciliationLinkReadback.js';
import { loadDocumentCorrectionInvoicePages } from './_xeroDocumentCorrectionScope.js';
import { readPaidSupplierContacts, readPaidSupplierArchivedCredits, PAID_SUPPLIER_PAGED_LIMITS } from './_xeroPaidSupplierPagedRead.js';
import { completeGroupedAccountSnapshot } from './_xeroGroupedPreservationAdapter.js';
import { loadFinancialSafetyContext, safetySelectFields } from './_xeroDocumentSafety.js';
import { supplierFinancialSourcePayload } from './_xeroFinancialSync.js';
import { derivePetroleumOwnership } from './_xeroIssuedPetroleumOwnership.js';
import { paymentPostingKey } from './_xeroPaymentPosting.js';
import { copyPaidSupplierProofJson as copy } from './_xeroPaidSupplierProofJson.js';
import { issuedSupplierSfId as sf, issuedSupplierHash as hash, issuedSupplierCanonical as canonical } from './_xeroIssuedSupplierPreservation.js';
import { SUPPLIER_FINANCIAL_BUCKET_POLICY as POLICY, evaluateSupplierFinancialBucketPreservation as evaluate, supplierFinancialBucketDiagnostics } from './_xeroSupplierFinancialBucketPreservation.js';

const captures = new WeakMap(), HASH = /^[a-f\d]{64}$/;
const uuid = x => typeof x === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(x) && x !== '00000000-0000-0000-0000-000000000000' ? x.toLowerCase() : null;
const same = (a,b) => Boolean(sf(a) && sf(a) === sf(b));
const caseSource = (id,tenantId) => {
  const prefix=`${tenantId}:Supplier_Invoice__c:`;
  if(typeof id!=='string'||id.length>256||!id.startsWith(prefix))return null;
  const sourceId=id.slice(prefix.length);
  return sf(sourceId)?.startsWith('a06')&&id===`${prefix}${sourceId}`?sourceId:null;
};
const unique = xs => [...new Set(xs)].sort();
const quote = xs => xs.map(x=>`'${x}'`).join(',');
const aliases = (field,ids) => ids.map(id=>`${field}.like.${sf(id)}%`).join(',');
const freeze = value => { if(value && typeof value === 'object') { Object.values(value).forEach(freeze);Object.freeze(value); } return value; };
const instant = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const fail = (code='FINANCIAL_COLLECTION_INCOMPLETE') => Object.assign(new Error('Complete current supplier financial evidence is unavailable.'),{code});
const one = rows => { if(rows.length!==1)throw fail('FINANCIAL_DEPENDENCY_AMBIGUOUS');return rows[0]; };
const resolved = (claim,events) => { const rows=events.filter(r=>r.claim_id===claim.id).sort((a,b)=>b.sequence-a.sequence);return rows.length && new Set(rows.map(r=>r.sequence)).size===rows.length && ['confirmed','rejected'].includes(rows[0].status); };
export const supplierFinancialCollectionPrivateEvidence = result => captures.get(result) || null;

export function supplierFinancialCollectionForecast(cases,contacts) {
  if(!Number.isSafeInteger(cases)||cases<1||cases>25||!Number.isSafeInteger(contacts)||contacts<1||contacts>cases)throw fail('FINANCIAL_SCOPE_INVALID');
  const historyBatches=Math.ceil(contacts/PAID_SUPPLIER_PAGED_LIMITS.contactsPerQuery),contactPages=Math.floor(PAID_SUPPLIER_PAGED_LIMITS.contacts/1000)+1,invoicePages=11,creditPages=Math.floor(PAID_SUPPLIER_PAGED_LIMITS.creditNotes/1000)+1;
  const operationCalls=contactPages+historyBatches*(invoicePages+creditPages)+cases+4,readbackCalls=cases+4;
  return freeze({caseCount:cases,contactCount:contacts,historyBatches,contactPages,invoicePages,creditPages,totalCalls:operationCalls+readbackCalls+2,operationCalls,verificationCalls:readbackCalls+2,readbackCalls,recoveryCalls:2,
    minimumAvailableCalls:operationCalls+readbackCalls+2+200,reserve:200,maxConcurrent:2,callsPerMinute:45,automaticRetries:0,writeCalls:0});
}

async function savedCampaignCases(scope,deps,tenantId,evidence) {
  // Persisted case IDs are exact TEXT case keys, never UUID control row IDs.
  // The filtered +1 bound exposes unexpected rows without scanning a campaign.
  const response=await deps.client.from('xero_reconciliation_cases').select('*').eq('campaign_id',scope.campaignId).in('id',scope.caseIds).order('id').range(0,scope.caseIds.length);
  const rows=response?.data;
  if(response?.error||!Array.isArray(rows)||rows.length!==scope.caseIds.length||unique(rows.map(r=>r.id)).length!==rows.length
    ||rows.some(r=>r.campaign_id!==scope.campaignId||!scope.caseIds.includes(r.id)||!caseSource(r.id,tenantId)||r.case_key!==r.id
      ||r.evidence?.id!==r.id||r.evidence?.caseKey!==r.id||r.evidence?.sourceObject!=='Supplier_Invoice__c'
      ||r.id!==`${tenantId}:Supplier_Invoice__c:${r.evidence?.sourceId}`))throw fail('FINANCIAL_SAVED_SCOPE_CHANGED');
  const originals=rows.map(row=>copy({row}).row);evidence.push({table:'xero_reconciliation_cases',count:originals.length,fingerprint:hash(originals)});return originals;
}

async function savedSelection(scope,deps,actorId,tenantId,evidence) {
  const campaignResult=await deps.client.from('xero_reconciliation_campaigns').select('*').eq('id',scope.campaignId).eq('owner_id',actorId).eq('tenant_id',tenantId).maybeSingle();
  const campaign=campaignResult?.data;
  if(campaignResult?.error||!campaign||campaign.id!==scope.campaignId||uuid(campaign.owner_id)!==actorId||uuid(campaign.tenant_id)!==tenantId||campaign.revision!==scope.expectedRevision
    ||!uuid(campaign.review_run_id||campaign.run_id)||!instant(campaign.updated_at))throw fail('FINANCIAL_SAVED_SCOPE_CHANGED');
  const rows=(table,configure,belongs)=>readSupplierControlRows(deps.client,table,configure,belongs,evidence);
  const cases=await savedCampaignCases(scope,deps,tenantId,evidence);
  if(cases.length!==scope.caseIds.length)throw fail('FINANCIAL_SAVED_SCOPE_CHANGED');
  const sourceIds=cases.map(r=>r.evidence?.sourceId);
  if(sourceIds.some(id=>!sf(id)?.startsWith('a06')))throw fail('FINANCIAL_SCOPE_INVALID');
  const items=await rows('xero_financial_sync_items',q=>q.eq('run_id',campaign.review_run_id||campaign.run_id).eq('source_object','Supplier_Invoice__c').in('source_id',sourceIds),r=>r.run_id===(campaign.review_run_id||campaign.run_id)&&r.source_object==='Supplier_Invoice__c'&&sourceIds.includes(r.source_id));
  const selected=scope.caseIds.map(id=>{
    const row=one(cases.filter(r=>r.id===id)),e=row.evidence,item=one(items.filter(r=>r.source_id===e.sourceId)),source=item.source_payload,target=item.xero_payload;
    if(!['link_only','decision','correction_deferred'].includes(row.category)||row.status==='reconciled'||!HASH.test(row.evidence_fingerprint||'')||e.sourceObject!=='Supplier_Invoice__c'
      ||!uuid(e.targetId)||source?.salesforceObject!=='Supplier_Invoice__c'||source.salesforceId!==e.sourceId||source.xeroType!=='ACCPAY'||source.xeroCollection!=='Invoices'
      ||!sf(source.accountId)?.startsWith('001')||!sf(source.stemId)||!uuid(source.contactId)||source.currency!=='USD'||!HASH.test(source.sourceFingerprint||'')||!HASH.test(source.financialFingerprint||'')
      ||item.xero_document_id!==e.targetId||uuid(target?.id||target?.InvoiceID)!==uuid(e.targetId)||(target?.type||target?.Type)!=='ACCPAY'||!['PAID','AUTHORISED'].includes(target?.status||target?.Status)
      ||uuid(target?.contactId||target?.Contact?.ContactID)!==uuid(source.contactId)||source.matchEvidence?.candidates?.length>1||e.ownerId&&uuid(e.ownerId)!==actorId)throw fail('FINANCIAL_SAVED_IDENTITY_INVALID');
    return {row,item,source,target,sourceId:sf(e.sourceId),targetId:uuid(e.targetId),accountId:sf(source.accountId),stemId:sf(source.stemId),contactId:uuid(source.contactId)};
  });
  if(unique(selected.map(r=>r.sourceId)).length!==selected.length||unique(selected.map(r=>r.targetId)).length!==selected.length)throw fail('FINANCIAL_SCOPE_INVALID');
  return {campaign,selected,material:{contract:'saved_owned_supplier_financial_collection_scope_v1',campaignId:campaign.id,expectedRevision:campaign.revision,actorId,tenantId,
    campaignFingerprint:hash(campaign),caseIds:scope.caseIds,cases:selected.map(r=>({caseId:r.row.id,caseFingerprint:r.row.evidence_fingerprint,savedCaseHash:hash(r.row),savedItemHash:hash(r.item),sourceId:r.sourceId,targetId:r.targetId,accountId:r.accountId,stemId:r.stemId,contactId:r.contactId,
      originalSavedSourceFingerprint:r.source.sourceFingerprint,originalSavedFinancialFingerprint:r.source.financialFingerprint}))}};
}

async function boundedMap(rows,fn) {
  let next=0,failed=false,error;const result=new Array(rows.length);
  await Promise.all(Array.from({length:Math.min(2,rows.length)},async()=>{while(!failed&&next<rows.length){const i=next++;try{result[i]=await fn(rows[i]);}catch(e){failed=true;error??=e;}}}));
  if(error)throw error;return result;
}

async function sourceFacts(state,deps,sourceReads,guard) {
  const read=createSupplierSalesforceReader({query:deps.query||sfQuery,queryAll:deps.queryAll||sfQueryAll,evidence:sourceReads});
  const safeRead=async(...args)=>{guard();const rows=await read(...args);guard();return rows.map(row=>copy({row}).row);};
  const org=await safeRead('SELECT Id, IsSandbox FROM Organization',2,false);
  if(org.length!==1||org[0].Id!==fcosSalesforceEnvironment('production').orgId||org[0].IsSandbox!==false)throw fail('FINANCIAL_SOURCE_ORG_UNVERIFIED');
  const safety=copy(await(deps.loadSafetyContext||loadFinancialSafetyContext)());guard();
  if(!safety.fields||['Invoice__c','Supplier_Invoice__c','STEM__c','STEM_Line_Item__c','STEM_Extra_Cost__c','Payment__c'].some(k=>!Array.isArray(safety.fields[k])))throw fail('FINANCIAL_SOURCE_SCHEMA_UNVERIFIED');
  const accountRows=await safeRead('SELECT Id, Name, Company_Code__c, Inactive_Suspended__c, RecordType.DeveloperName FROM Account ORDER BY Id',100000);
  const accounts=completeGroupedAccountSnapshot({records:accountRows,totalSize:accountRows.length});if(!accounts.complete)throw fail('FINANCIAL_OWNER_SCOPE_INCOMPLETE');
  state.accounts=accounts.accounts.map(r=>({...r,id:sf(r.id)}));state.accountRows=accountRows;state.safety=safety;return {safeRead};
}

async function selectedSourceFacts(state,deps,sourceReads,safeRead) {
  const {selected,safety,ownerships}=state,sourceIds=unique(selected.map(r=>r.sourceId)),stemIds=unique(selected.map(r=>r.stemId)),owners=unique(ownerships.flatMap(r=>r.sourceAccountIds));
  if(owners.length>25)throw fail('FINANCIAL_SCOPE_BOUND');const extra=(object,fields)=>safetySelectFields(safety,object,fields);
  const parents=await safeRead(`SELECT Id, IsDeleted, Name, Supplier__c, Supplier__r.Name, Supplier__r.Company_Code__c, Supplier__r.Company__c, Supplier__r.Company__r.Full_Name__c, STEM__c, STEM__r.Name, STEM__r.KeyStem__c, STEM__r.RefCode__c, STEM__r.Delivery_Date__c, STEM__r.Vessel__c, STEM__r.Vessel__r.Name, STEM__r.LastModifiedDate, Invoice_Amount__c, Invoice_Date__c, Invoice_Due_Date__c, Payable_Balance__c, CreatedDate, LastModifiedDate${extra('Supplier_Invoice__c',['CurrencyIsoCode','Status__c','Invoice_Status__c','Cancelled__c'])} FROM Supplier_Invoice__c WHERE Supplier__c IN (${quote(owners)}) OR STEM__c IN (${quote(stemIds)}) ORDER BY Id`,5000);
  if(parents.some(r=>!owners.includes(sf(r.Supplier__c))&&!stemIds.includes(sf(r.STEM__c))))throw fail();
  const children=await safeRead(`SELECT Id, IsDeleted, Name, Supplier_Invoice__c, Buyer_Invoice__c, Original_Supplier__c, STEM__c, Cancelled__c, Product__c, Product__r.Name, Quantity_Delivered_Per_BDN__c, Quantity__c, Unit_of_Measure__c, Quantity_Max__c, Price_Per_Unit__c, Cost_Per_Unit__c, Total_Price__c, Unit_Sell_At__c, Unit_Buy_At__c, Total_Cost__c, LastModifiedDate${extra('STEM_Line_Item__c',['CurrencyIsoCode'])} FROM STEM_Line_Item__c WHERE Supplier_Invoice__c IN (${quote(sourceIds)}) ORDER BY Id`,2500);
  const charges=await safeRead(`SELECT Id, IsDeleted, Name, Description__c, Supplier_Invoice__c, Buyer_Invoice__c, Supplier__c, STEM__c, Cancelled__c, Product2Id__c, Product2Id__r.Name, Quantity_Delivered_Per_BDN__c, Quantity__c, Unit_of_Measure__c, Quantity_Range_Max__c, Unit_Price__c, Unit_Cost__c, Lumpsum_Price__c, Lumpsum_Cost__c, Line_Total__c, Line_Total_Buy__c, LastModifiedDate${extra('STEM_Extra_Cost__c',['CurrencyIsoCode'])} FROM STEM_Extra_Cost__c WHERE Supplier_Invoice__c IN (${quote(sourceIds)}) ORDER BY Id`,2500);
  if([...children,...charges].some(r=>!sourceIds.includes(sf(r.Supplier_Invoice__c))||typeof r.IsDeleted!=='boolean'||typeof r.Cancelled__c!=='boolean'))throw fail();
  const buyerIds=unique([...children,...charges].map(r=>sf(r.Buyer_Invoice__c)).filter(Boolean));
  const buyers=await safeRead(`SELECT Id, IsDeleted, Name, STEM__c, Proforma__c, Deprecated__c, Amount__c, Invoice_Date__c, Invoice_Due_Date__c, LastModifiedDate${extra('Invoice__c',['Delivery_Date__c','CurrencyIsoCode','Cancelled__c','Status__c','Invoice_Status__c'])} FROM Invoice__c WHERE STEM__c IN (${quote(stemIds)})${buyerIds.length?` OR Id IN (${quote(buyerIds)})`:''} ORDER BY Id`,5000);
  if(buyers.some(r=>!stemIds.includes(sf(r.STEM__c))&&!buyerIds.includes(sf(r.Id))))throw fail();
  const productIds=unique([...children,...charges].map(r=>sf(r.Product__c||r.Product2Id__c)).filter(Boolean));if(!productIds.length||productIds.length>100)throw fail('FINANCIAL_SCOPE_BOUND');
  const products=await safeRead(`SELECT Id, Name, ProductCode, Description, IsActive, LastModifiedDate, SystemModstamp, Family, IsDeleted FROM Product2 WHERE Id IN (${quote(productIds)}) ORDER BY Id`,100,false);
  if(products.length!==productIds.length||products.some(r=>!productIds.includes(sf(r.Id))||r.IsActive!==true||r.IsDeleted!==false))throw fail('FINANCIAL_PRODUCT_SCOPE_INCOMPLETE');
  // Payment__c has no Buyer_Invoice__c. These are conflict dependencies only.
  const fields=`Id, IsDeleted, Name, RecordType.DeveloperName, Supplier_Invoice__c, Remittance__c, STEM__c, Account__c, Bank__c, Is_Deposit__c, Is_Volume_Discount__c, Commission_Invoice__c, Amount__c, Date__c, Reference__c, CreatedDate, LastModifiedDate${extra('Payment__c',['CurrencyIsoCode'])}`;
  const payments=await safeRead(`SELECT ${fields} FROM Payment__c WHERE Supplier_Invoice__c IN (${quote(sourceIds)}) ORDER BY Id`,5000);
  if(payments.some(r=>!sourceIds.includes(sf(r.Supplier_Invoice__c))||typeof r.IsDeleted!=='boolean'||!Object.hasOwn(r,'Remittance__c')||r.Remittance__c!==null&&!sf(r.Remittance__c)))throw fail();
  const remittanceIds=unique(payments.map(r=>sf(r.Remittance__c)).filter(Boolean));let families=[];
  if(remittanceIds.length){families=await safeRead(`SELECT ${fields} FROM Payment__c WHERE Id IN (${quote(remittanceIds)}) OR Remittance__c IN (${quote(remittanceIds)}) ORDER BY Id`,5000);if(families.some(r=>!remittanceIds.includes(sf(r.Id))&&!remittanceIds.includes(sf(r.Remittance__c)))||remittanceIds.some(id=>families.filter(r=>same(r.Id,id)).length!==1))throw fail();}
  return {parents,children,charges,buyers,products,payments,families,sourceIds,stemIds,productIds,paymentIds:unique([...payments,...families].map(r=>sf(r.Id)))};
}

async function controlFacts(state,facts,deps,evidence) {
  const targets=state.selected.map(r=>r.targetId),ledgerIds=unique(state.targets.flatMap(r=>(r.Payments||[]).map(p=>uuid(p.PaymentID))).filter(Boolean));
  const rows=async(table,configure,belongs)=>(await readSupplierControlRows(deps.client,table,configure,belongs,evidence)).map(r=>copy({row:r}).row);
  const grants=await rows('xero_financial_product_mappings',q=>q.or(aliases('salesforce_product_id',facts.productIds)),r=>facts.productIds.includes(sf(r.salesforce_product_id)));
  const documents=await rows('xero_financial_document_mappings',q=>q.or(`${aliases('salesforce_id',facts.sourceIds)},${targets.map(id=>`xero_document_id.ilike.${id}`).join(',')}`),r=>facts.sourceIds.includes(sf(r.salesforce_id))||targets.includes(uuid(r.xero_document_id)));
  const corrections=await rows('xero_document_field_correction_claims',q=>q.eq('tenant_id',state.tenantId).in('xero_invoice_id',targets),r=>uuid(r.tenant_id)===state.tenantId&&targets.includes(uuid(r.xero_invoice_id)));
  const events=corrections.length?await rows('xero_document_field_correction_events',q=>q.in('claim_id',corrections.map(r=>r.id)),r=>corrections.some(c=>c.id===r.claim_id)&&['confirmed','rejected','uncertain'].includes(r.status)&&Number.isSafeInteger(r.sequence)&&r.sequence>0):[];
  const disputes=await rows('dispute_beta_cases',q=>q.or(aliases('stem_id',facts.stemIds)),r=>facts.stemIds.includes(sf(r.stem_id)));
  const mappingIds=documents.map(r=>r.id),parts=[facts.paymentIds.length?aliases('salesforce_payment_id',facts.paymentIds):'',...ledgerIds.map(id=>`xero_payment_id.ilike.${id}`),...mappingIds.map(id=>`document_mapping_id.eq.${id}`)].filter(Boolean);
  const references=parts.length?await rows('xero_financial_payment_mappings',q=>q.or(parts.join(',')),r=>facts.paymentIds.includes(sf(r.salesforce_payment_id))||ledgerIds.includes(uuid(r.xero_payment_id))||mappingIds.includes(r.document_mapping_id)):[];
  const posting=await rows('xero_financial_sync_runs',q=>q.eq('mode','payment_apply'),r=>r.mode==='payment_apply');
  return {grants,documents,corrections,events,disputes,references,posting};
}

function assemble(state,facts,controls,invoices,credits,settings,sourceReads) {
  const qf=[hash(sourceReads),hash(state.accountRows),hash(state.contactRows),hash(facts.parents),hash(facts.children),hash(facts.charges),hash(facts.buyers),hash(facts.products),hash({payments:facts.payments,families:facts.families}),hash({invoices,credits}),hash(settings),hash(controls)];
  return state.selected.map((selected,index)=>{
    const parent=one(facts.parents.filter(r=>same(r.Id,selected.sourceId))),target=one(state.targets.filter(r=>uuid(r.InvoiceID)===selected.targetId)),ownership=state.ownerships[index];
    if(!same(parent.Supplier__c,selected.accountId)||!same(parent.STEM__c,selected.stemId)||uuid(target.Contact?.ContactID)!==selected.contactId)throw fail('FINANCIAL_SELECTED_IDENTITY_CHANGED');
    const children=facts.children.filter(r=>same(r.Supplier_Invoice__c,parent.Id)),charges=facts.charges.filter(r=>same(r.Supplier_Invoice__c,parent.Id));
    const linked=unique([...children,...charges].map(r=>sf(r.Buyer_Invoice__c)).filter(Boolean)),buyers=facts.buyers.filter(r=>same(r.STEM__c,parent.STEM__c)||linked.includes(sf(r.Id)));
    const products=facts.products.filter(p=>[...children,...charges].some(r=>same(r.Product__c||r.Product2Id__c,p.Id))),productMappings=controls.grants.filter(r=>r.direction==='supplier'&&products.some(p=>same(p.Id,r.salesforce_product_id)));
    const payload=JSON.parse(JSON.stringify(supplierFinancialSourcePayload({parent,children,charges,buyers,safetyContext:state.safety,contacts:state.contacts,productMappings})));
    const source={orgId:fcosSalesforceEnvironment('production').orgId,salesforceObject:'Supplier_Invoice__c',parent,children,charges,buyers,products,safetyContext:state.safety,sourcePayload:payload,sourceFingerprint:payload.sourceFingerprint,financialFingerprint:payload.financialFingerprint};
    const sourceClaims=facts.parents.filter(r=>ownership.sourceAccountIds.includes(sf(r.Supplier__c))||same(r.STEM__c,parent.STEM__c));
    const accountIds=unique([...ownership.sourceAccountIds,...sourceClaims.filter(r=>same(r.STEM__c,parent.STEM__c)).map(r=>sf(r.Supplier__c))]);
    const accounts=state.accounts.filter(r=>accountIds.includes(sf(r.id)));if(accounts.length!==accountIds.length||accounts.length>25)throw fail('FINANCIAL_OWNER_SCOPE_INCOMPLETE');
    const targetClaims=invoices.filter(r=>uuid(r.Contact?.ContactID)===selected.contactId),creditClaims=credits.filter(r=>uuid(r.Contact?.ContactID)===selected.contactId);
    const payments=facts.payments.filter(r=>same(r.Supplier_Invoice__c,parent.Id)),remittanceIds=unique(payments.map(r=>sf(r.Remittance__c)).filter(Boolean)),families=facts.families.filter(r=>remittanceIds.includes(sf(r.Id))||remittanceIds.includes(sf(r.Remittance__c)));
    const localIds=unique([...payments,...families].map(r=>sf(r.Id))),paymentIds=(target.Payments||[]).map(r=>uuid(r.PaymentID));
    const mappings=controls.documents.filter(r=>same(r.salesforce_id,parent.Id)||uuid(r.xero_document_id)===selected.targetId);
    const identity={accounts,contacts:[ownership.contact],
      sourceClaims,targetClaims,creditClaims,sourceMappings:mappings.filter(r=>same(r.salesforce_id,parent.Id)),targetMappings:mappings.filter(r=>uuid(r.xero_document_id)===selected.targetId),
      referenceClaims:controls.references.filter(r=>localIds.includes(sf(r.salesforce_payment_id))||paymentIds.includes(uuid(r.xero_payment_id))||mappings.some(m=>m.id===r.document_mapping_id)),
      postingClaims:controls.posting.filter(r=>localIds.some(id=>r.idempotency_key===paymentPostingKey(state.tenantId,id))||uuid(r.control_totals?.paymentPosting?.tenantId)===state.tenantId&&(localIds.includes(sf(r.control_totals.paymentPosting.paymentId))||[r.control_totals.paymentPosting.reviewed?.xeroDocumentId,r.control_totals.paymentPosting.reviewed?.documentId].some(id=>uuid(id)===selected.targetId)||(r.control_totals.paymentPosting.observedPaymentIds||[]).some(id=>paymentIds.includes(uuid(id))))),
      disputes:[...controls.disputes.filter(r=>same(r.stem_id,parent.STEM__c)&&!['closed','resolved','cancelled'].includes(String(r.workflow_status||'').toLowerCase())),...controls.corrections.filter(r=>uuid(r.xero_invoice_id)===selected.targetId&&!resolved(r,controls.events))],
      selection:{contract:'supplier_financial_selected_identity_v1',tenantId:state.tenantId,salesforceOrgId:sf(source.orgId),sourceId:selected.sourceId,stemId:selected.stemId,accountId:selected.accountId,contactId:selected.contactId,targetId:selected.targetId,
        sourceFingerprint:source.sourceFingerprint,financialFingerprint:source.financialFingerprint,reviewedBy:state.actorId,reviewedAt:state.campaign.updated_at,basis:'saved_owned_campaign_exact_supplier_document_selection_v1'},
      coverage:{scope:'complete_selected_owner_union_v1',globalDiscoveryFingerprint:hash({accounts:state.accountRows,contacts:state.contactRows}),globalAccountCount:state.accounts.length,globalContactCount:state.contacts.length,sourceAccountIds:ownership.sourceAccountIds,stemIds:[selected.stemId],xeroContactIds:[selected.contactId],sourceQueryAll:true,sourceComplete:true,targetComplete:true,targetIncludesArchived:true,creditComplete:true,globalAccountsComplete:true,globalContactsComplete:true,claimsComplete:true,mappingsComplete:true,dependenciesComplete:true,sourceCount:sourceClaims.length,targetCount:targetClaims.length,creditCount:creditClaims.length,queryFingerprints:qf}};
    identity.coverageFingerprint=hash(identity);
    const codes=unique(productMappings.map(r=>r.xero_account_code));const input={policyVersion:POLICY,tenantId:state.tenantId,source,target,identity,organisation:settings.organisation,productMappings,accountTax:{accounts:settings.accounts.filter(r=>codes.includes(r.Code)),taxes:settings.taxes.filter(r=>r.TaxType==='NONE')},
      sourceDependencies:{payments,families,coverage:{contract:'complete_supplier_payment_family_scope_v1',complete:true,queryAll:true,sourceId:selected.sourceId,stemId:selected.stemId,accountId:selected.accountId,queryFingerprint:hash({payments,families,sourceReads:sourceReads.filter(r=>r.soql?.includes(' FROM Payment__c '))}),paymentCount:payments.length,familyCount:families.length}}};
    if(target.Status==='PAID'){const ids=(target.Payments||[]).map(r=>uuid(r.PaymentID));const ledgerPayments=state.payments.filter(r=>ids.includes(uuid(r.PaymentID))),ledgerAccounts=settings.accounts.filter(r=>ledgerPayments.some(p=>uuid(p.Account?.AccountID)===uuid(r.AccountID)));input.ledgerPaymentEvidence={payments:ledgerPayments,accounts:ledgerAccounts};}
    return freeze(copy(input));
  });
}

// Only the server dependency object can carry clients, credentials or identity.
// Neither client booleans nor saved monetary coincidence establish completeness.
export async function collectSupplierFinancialBucket(scope,deps={}) {
  const clock=deps.now||(()=>new Date().toISOString()),startedAt=clock(),receipts=[],sourceReads=[];let state,budget,calls=0,privateCapture;
  const base=()=>({policyVersion:POLICY,complete:false,actorId:state?.actorId||null,tenantId:state?.tenantId||null,scopeFingerprint:state?.scopeFingerprint||null,observation:{startedAt,endedAt:clock(),forecast:state?.forecast||null},cases:[],financialWrites:0,approvalGranted:false});
  let result;const {readStatus=readXeroSharedStatus,reserveBudget=reserveXeroBudget,releaseBudget=releaseXeroBudget,withBudget=runWithXeroBudget,accountingFetch=xeroAccountingFetch,env=process.env,fetchImpl=fetch}=deps;
  try {
    const clean=copy(scope),actorId=uuid(deps.accessContext?.profile?.id),connection=deps.connection,tenantId=uuid(connection?.tenantId);
    if(Object.keys(clean).sort().join(',')!=='campaignId,caseIds,expectedRevision'||!uuid(clean.campaignId)||!Number.isSafeInteger(clean.expectedRevision)||clean.expectedRevision<1||!Array.isArray(clean.caseIds)||clean.caseIds.length<1||clean.caseIds.length>25||clean.caseIds.some(id=>!caseSource(id,tenantId))||unique(clean.caseIds).length!==clean.caseIds.length||!actorId||!tenantId||!deps.client?.from||!instant(startedAt))throw fail('FINANCIAL_SCOPE_INVALID');
    if(!connection.accessToken||!Number.isSafeInteger(connection.tokenVersion)||connection.tokenVersion<1||!instant(connection.expiresAt)||Date.parse(connection.expiresAt)<=Date.parse(startedAt)+90000)throw fail('FINANCIAL_CONNECTION_UNVERIFIED');
    const scopes=splitScopes(connection.scope||'');if(!(scopes.includes('accounting.invoices')||scopes.includes('accounting.transactions'))||!scopes.includes('accounting.contacts')||!(scopes.includes('accounting.settings')||scopes.includes('accounting.settings.read'))||!(scopes.includes('accounting.payments')||scopes.includes('accounting.payments.read')||scopes.includes('accounting.transactions')))throw fail('FINANCIAL_CONNECTION_UNVERIFIED');
    state={...await savedSelection(clean,deps,actorId,tenantId,sourceReads),actorId,tenantId,connection};state.scopeFingerprint=hash(state.material);state.forecast=supplierFinancialCollectionForecast(clean.caseIds.length,unique(state.selected.map(r=>r.contactId)).length);
    const tokenVersion=connection.tokenVersion;const guard=()=>{if(deps.signal?.aborted||uuid(connection.tenantId)!==tenantId||connection.tokenVersion!==tokenVersion||!instant(clock())||Date.parse(clock())<Date.parse(startedAt)||Date.parse(clock())-Date.parse(startedAt)>600000||Date.parse(connection.expiresAt)<=Date.parse(clock())+90000)throw fail('FINANCIAL_COLLECTION_CANCELLED');};guard();
    const status=await readStatus(connection);if(status?.allowanceKnown!==true||!Number.isSafeInteger(status.availableCalls)||!Number.isSafeInteger(status.reservedCalls)||status.reservedCalls<0||status.dailyHold||status.retryAt||status.unresolvedWrites!==0||status.availableCalls-status.reservedCalls<state.forecast.minimumAvailableCalls)throw fail('FINANCIAL_QUOTA_HELD');
    budget=await reserveBudget(connection,{ownerKey:`supplier-financial-collection:${tenantId}:${state.scopeFingerprint}:${randomUUID()}`,operationCalls:state.forecast.operationCalls,verificationCalls:state.forecast.verificationCalls,ttlSeconds:600});if(!uuid(budget?.id))throw fail('FINANCIAL_RESERVATION_UNVERIFIED');
    const phaseCalls={operation:0,verification:0};const read=async(current,path,options={})=>{
      guard();const phase=options.budgetPhase||'operation';if(current!==connection||options.method&&options.method!=='GET'||!['operation','verification'].includes(phase)||++phaseCalls[phase]>(phase==='operation'?state.forecast.operationCalls:state.forecast.readbackCalls))throw fail('FINANCIAL_READ_BOUND');calls++;
      const response=await withBudget(connection,{budgetId:budget.id,budgetPhase:phase},()=>accountingFetch(connection,path,{...options,method:'GET',env,fetchImpl,budgetId:budget.id,budgetPhase:phase,callsPerMinute:45,maxConcurrent:2,transientRetryLimit:0,retryOnRateLimit:false,onResponse(event){
        if(event.method!=='GET'||event.pathName!==path||uuid(event.budgetId)!==uuid(budget.id)||!uuid(event.requestId)||!(event.status>=200&&event.status<300)||receipts.some(r=>r.requestId===event.requestId))throw fail('FINANCIAL_PROVIDER_RECEIPTS_INCOMPLETE');receipts.push({requestId:event.requestId,budgetId:budget.id,method:'GET',path,status:event.status,phase,tokenVersion,tenantId});}}));guard();
      if(!response||typeof response!=='object'||response.HasErrors===true||response.HasValidationErrors===true||response.ValidationErrors!==undefined&&(!Array.isArray(response.ValidationErrors)||response.ValidationErrors.length))throw fail();
      if(response.Pagination!==undefined&&response.pagination!==undefined&&canonical(response.Pagination)!==canonical(response.pagination))throw fail();return response.Pagination!==undefined&&response.pagination===undefined?{...response,pagination:response.Pagination}:response;
    };
    const exact=async phase=>{const r=await readCampaignDocumentLinkReadback({connection,targets:state.selected.map(r=>({collection:'Invoices',targetId:r.targetId})),budgetId:budget.id,env,fetchImpl,withBudget:(_c,o,fn)=>withBudget(connection,{...o,budgetPhase:phase},fn),accountingFetch:(c,p,o)=>read(c,p,{...o,budgetPhase:phase})});if(r.missingTargetIds.invoices.length||r.rawTargets.invoices.length!==state.selected.length)throw fail('FINANCIAL_TARGET_NOT_OBSERVED');return r.rawTargets.invoices.map(r=>copy({row:r}).row);};
    const settings=async phase=>{const org=await read(connection,'/Organisations',{budgetPhase:phase}),accounts=await read(connection,'/Accounts',{budgetPhase:phase}),taxes=await read(connection,'/TaxRates',{budgetPhase:phase});if(!Array.isArray(org.Organisations)||org.Organisations.length!==1||uuid(org.Organisations[0].OrganisationID)!==tenantId||org.Organisations[0].BaseCurrency!=='USD'||!Array.isArray(accounts.Accounts)||!Array.isArray(taxes.TaxRates))throw fail('FINANCIAL_PROVIDER_IDENTITY_UNVERIFIED');return copy({organisation:org.Organisations[0],accounts:accounts.Accounts,taxes:taxes.TaxRates});};
    const initial=await settings('operation');state.targets=await exact('operation');
    const paymentIds=unique(state.targets.filter(r=>r.Status==='PAID').flatMap(r=>(r.Payments||[]).map(p=>uuid(p.PaymentID))));if(paymentIds.some(id=>!id)||paymentIds.length>state.selected.length)throw fail('FINANCIAL_SETTLEMENT_CHANGED');
    const paymentRead=async phase=>boundedMap(paymentIds,async id=>{const r=await read(connection,`/Payments/${id}`,{budgetPhase:phase});if(!Array.isArray(r.Payments)||r.Payments.length!==1||uuid(r.Payments[0].PaymentID)!==id)throw fail('FINANCIAL_LEDGER_PAYMENT_INCOMPLETE');return copy({row:r.Payments[0]}).row;});state.payments=await paymentRead('operation');
    const {safeRead}=await sourceFacts(state,deps,sourceReads,guard);state.contactRows=await readPaidSupplierContacts(connection,read,{signal:deps.signal});state.contacts=state.contactRows.map(r=>({id:uuid(r.ContactID),name:r.Name,status:r.ContactStatus,contactNumber:r.ContactNumber??'',accountNumber:r.AccountNumber??'',...(r.MergedToContactID?{mergedToContactId:uuid(r.MergedToContactID)}:{})}));
    state.ownerships=state.selected.map(r=>derivePetroleumOwnership({tenantId,accountId:r.accountId,contactId:r.contactId,accounts:state.accounts,contacts:state.contacts,complete:true}));if(state.ownerships.some(r=>!r.eligible))throw fail('FINANCIAL_OWNER_SCOPE_INCOMPLETE');
    const facts=await selectedSourceFacts(state,deps,sourceReads,safeRead),controls=await controlFacts(state,facts,deps,sourceReads),invoices=[],credits=[],contactIds=unique(state.selected.map(r=>r.contactId));
    for(let offset=0;offset<contactIds.length;offset+=8){const group=contactIds.slice(offset,offset+8),where=`(${group.map(id=>`Contact.ContactID==Guid("${id}")`).join('||')})&&Type=="ACCPAY"`;invoices.push(...await loadDocumentCorrectionInvoicePages(connection,`/Invoices?${new URLSearchParams({where})}`,{accountingFetch:read}));credits.push(...await readPaidSupplierArchivedCredits(connection,group,read,{signal:deps.signal}));}
    if(unique(invoices.map(r=>uuid(r.InvoiceID))).length!==invoices.length||unique(credits.map(r=>uuid(r.CreditNoteID))).length!==credits.length||invoices.length+credits.length>10000||invoices.some(r=>r.Type!=='ACCPAY'||!contactIds.includes(uuid(r.Contact?.ContactID))))throw fail('FINANCIAL_HISTORY_INCOMPLETE');
    for(const target of state.targets)if(canonical(one(invoices.filter(r=>uuid(r.InvoiceID)===uuid(target.InvoiceID))))!==canonical(target))throw fail('FINANCIAL_HISTORY_TARGET_CHANGED');
    const inputs=assemble(state,facts,controls,invoices,credits,initial,sourceReads);
    if(canonical(await exact('verification'))!==canonical(state.targets)||canonical(await paymentRead('verification'))!==canonical(state.payments)||canonical(await settings('verification'))!==canonical(initial))throw fail('FINANCIAL_CURRENT_DEPENDENCY_CHANGED');
    const savedAgain=await savedSelection(clean,deps,actorId,tenantId,[]);if(hash(savedAgain.material)!==state.scopeFingerprint)throw fail('FINANCIAL_SAVED_SCOPE_CHANGED');
    const controlsAgain=await controlFacts(state,facts,deps,[]);if(canonical(controlsAgain)!==canonical(controls))throw fail('FINANCIAL_CURRENT_CONTROLS_CHANGED');guard();
    if(receipts.length!==calls||receipts.filter(r=>r.phase==='operation').length!==phaseCalls.operation||receipts.filter(r=>r.phase==='verification').length!==phaseCalls.verification)throw fail('FINANCIAL_PROVIDER_RECEIPTS_INCOMPLETE');
    const proofs=inputs.map(evaluate),endedAt=clock();privateCapture=freeze({scopeMaterial:state.material,inputs,proofs,sources:inputs.map(r=>r.source.sourcePayload),targets:state.targets,providerReceipts:receipts,sourceReads,
      identityOriginals:{accounts:state.accountRows,contacts:state.contactRows},currentProducts:facts.products,controls,fullHistory:{invoices,credits},collectionInterval:{startedAt,endedAt,atomicSnapshot:false},budget:{id:budget.id,tokenVersion,tenantId,forecast:state.forecast},providerCallCount:calls});
    result=freeze({...base(),complete:true,observation:{startedAt,endedAt,forecast:state.forecast},cases:proofs.map((p,i)=>({caseId:state.selected[i].row.id,sourceId:state.selected[i].sourceId,targetId:state.selected[i].targetId,proofValid:p.proofValid,blockers:supplierFinancialBucketDiagnostics(p).blockers}))});
  }catch(error){result=freeze({...base(),cases:state?.selected?.map(r=>({caseId:r.row.id,sourceId:r.sourceId,targetId:r.targetId,proofValid:false,blockers:[{code:typeof error?.code==='string'&&/^(FINANCIAL_|XERO_)[A-Z_]+$/.test(error.code)?error.code:'FINANCIAL_COLLECTION_INCOMPLETE',path:'collection'}]}))||[]});privateCapture=null;}
  finally{if(uuid(budget?.id)){try{await releaseBudget(state.connection,{budgetId:budget.id,reason:'Supplier financial read-only collection ended'});}catch{result=freeze({...base(),cases:state.selected.map(r=>({caseId:r.row.id,sourceId:r.sourceId,targetId:r.targetId,proofValid:false,blockers:[{code:'FINANCIAL_RESERVATION_RELEASE_HELD',path:'collection'}]}))});privateCapture=null;}}}
  if(privateCapture)captures.set(result,privateCapture);return result;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSupplierFinancialBucket, supplierFinancialCollectionPrivateEvidence as privateEvidence, supplierFinancialCollectionForecast as forecast } from '../api/_xeroSupplierFinancialBucketCollector.js';
import { financialFixture, ids, now, hash } from './xeroSupplierFinancialBucketPreservation.fixture.js';
import { issuedSupplierSfId as sf } from '../api/_xeroIssuedSupplierPreservation.js';

const clone = structuredClone;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid = (prefix,n) => prefix + String(n).padStart(12,'0');

// Synthetic complete server/provider snapshots. These mocks are not current
// provider authority, documentary verification, approval or a live campaign.
function model({ count=1, paid=0 }={}) {
  const fixtures=Array.from({length:count},(_,i)=>{
    const f=financialFixture({paid:i<paid});
    f.source.parent.Id=sid('a06',i+1);f.source.parent.Name=`SYN260${String(i+1).padStart(2,'0')}`;f.source.parent.STEM__c=sid('a0H',i+1);
    f.source.children.forEach((r,j)=>{r.Id=sid('a05',i*2+j+1);r.Supplier_Invoice__c=f.source.parent.Id;r.STEM__c=f.source.parent.STEM__c;r.Buyer_Invoice__c=sid('a0K',i+1);});
    f.source.charges.forEach(r=>{r.Id=sid('a04',i+1);r.Supplier_Invoice__c=f.source.parent.Id;r.STEM__c=f.source.parent.STEM__c;});
    f.source.buyers.forEach(r=>{r.Id=sid('a0K',i+1);r.STEM__c=f.source.parent.STEM__c;});
    f.target.InvoiceID=uuid(100+i);f.target.InvoiceNumber=`TARGET-${i+1}`;f.target.LineItems[0].LineItemID=uuid(300+i);
    f.input.sourceDependencies.payments.forEach((r,j)=>{r.Id=sid('a0S',i*2+j+1);r.Supplier_Invoice__c=f.source.parent.Id;r.STEM__c=f.source.parent.STEM__c;});
    if(i<paid){f.target.Payments[0].PaymentID=uuid(500+i);const p=f.input.ledgerPaymentEvidence.payments[0];p.PaymentID=f.target.Payments[0].PaymentID;p.Invoice.InvoiceID=f.target.InvoiceID;}
    // Old saved fingerprints remain their own historical evidence. The fresh
    // broader fields may produce different current acquisition fingerprints.
    Object.assign(f.source.sourcePayload,{salesforceId:f.source.parent.Id,stemId:f.source.parent.STEM__c});
    return f;
  });
  const first=fixtures[0],campaignId=uuid(700),runId=uuid(701),caseIds=fixtures.map(f=>`${ids.tenant}:Supplier_Invoice__c:${f.source.parent.Id}`);
  const tables={
    xero_reconciliation_campaigns:[{id:campaignId,owner_id:ids.observer,tenant_id:ids.tenant,revision:4,review_run_id:runId,updated_at:now}],
    xero_reconciliation_cases:fixtures.map((f,i)=>({id:caseIds[i],case_key:caseIds[i],campaign_id:campaignId,category:'decision',status:'needs_decision',evidence_fingerprint:hash(`saved-case-${i}`),evidence:{id:caseIds[i],caseKey:caseIds[i],sourceId:f.source.parent.Id,targetId:f.target.InvoiceID,sourceObject:'Supplier_Invoice__c',ownerId:ids.observer}})),
    xero_financial_sync_items:fixtures.map((f,i)=>({id:uuid(750+i),run_id:runId,source_object:'Supplier_Invoice__c',source_id:f.source.parent.Id,source_payload:{...clone(f.source.sourcePayload),sourceFingerprint:hash(`synthetic-historical-source-${i}`),financialFingerprint:hash(`synthetic-historical-financial-${i}`)},xero_document_id:f.target.InvoiceID,xero_payload:clone(f.target)})),
    xero_financial_product_mappings:clone(first.input.productMappings),xero_financial_document_mappings:[],xero_document_field_correction_claims:[],xero_document_field_correction_events:[],dispute_beta_cases:[],xero_financial_payment_mappings:[],xero_financial_sync_runs:[],
  };
  const products=[ids.product,ids.chargeProduct].map((Id,i)=>({Id,Name:i?'SYNTHETIC SURCHARGE':'SYNTHETIC RMG380 S0.5%',ProductCode:null,Description:null,IsActive:true,LastModifiedDate:now,SystemModstamp:now,Family:null,IsDeleted:false}));
  const sfRows={Organization:[{Id:first.source.orgId,IsSandbox:false}],Account:[{Id:ids.account,Name:first.identity.accounts[0].name,Company_Code__c:'HKEXAMPLE',Inactive_Suspended__c:false,RecordType:{DeveloperName:'Supplier'}}],
    Supplier_Invoice__c:fixtures.map(f=>clone(f.source.parent)),STEM_Line_Item__c:fixtures.flatMap(f=>clone(f.source.children)),STEM_Extra_Cost__c:fixtures.flatMap(f=>clone(f.source.charges)),Invoice__c:fixtures.flatMap(f=>clone(f.source.buyers)),Product2:products,
    Payment__c:fixtures.flatMap(f=>clone(f.input.sourceDependencies.payments))};
  const xero={organisation:clone(first.input.organisation),accounts:[clone(first.input.accountTax.accounts[0]),...(paid?[clone(first.input.ledgerPaymentEvidence.accounts[0])]:[])],taxes:clone(first.input.accountTax.taxes),
    contacts:[{ContactID:ids.contact,Name:first.identity.contacts[0].name,ContactStatus:'ACTIVE',ContactNumber:'',AccountNumber:''}],invoices:fixtures.map(f=>clone(f.target)),credits:[],payments:fixtures.filter((_,i)=>i<paid).flatMap(f=>clone(f.input.ledgerPaymentEvidence.payments))};
  const metrics={gets:[],sf:[],db:[],reserves:[],releases:[],maxConcurrent:0,inflight:0},hooks={};
  let request=1000;
  const client={from(table){const criteria=[],query={select(){return query;},eq(k,v){criteria.push(r=>r[k]===v);return query;},in(k,values){criteria.push(r=>values.includes(r[k]));return query;},or(){return query;},order(){return query;},range(a,b){query.slice=[a,b];return query;},maybeSingle(){query.single=true;return query;},then(resolve,reject){return Promise.resolve().then(()=>{metrics.db.push(table);hooks.db?.(table,metrics);let data=clone(tables[table]||[]).filter(r=>criteria.every(fn=>fn(r)));if(query.slice)data=data.slice(query.slice[0],query.slice[1]+1);return {data:query.single?data[0]??null:data,error:null};}).then(resolve,reject);}};return query;}};
  const query=async(soql,options)=>{
    const object=/ FROM ([A-Za-z0-9_]+)/.exec(soql)?.[1];metrics.sf.push({soql,options});hooks.sf?.(object,soql,metrics);let records=clone(sfRows[object]||[]);
    if(object==='Payment__c')records=records.filter(r=>soql.includes('WHERE Supplier_Invoice__c')?fixtures.some(f=>sf(r.Supplier_Invoice__c)===sf(f.source.parent.Id)):/ WHERE Id IN \(([^)]+)\)/.test(soql)&&(/ WHERE Id IN \(([^)]+)\)/.exec(soql)[1].includes(r.Id)||/ Remittance__c IN \(([^)]+)\)/.exec(soql)?.[1].includes(r.Remittance__c)));
    return hooks.sfResponse?.(object,records,soql)??{records,totalSize:records.length,done:true};
  };
  const connection={tenantId:ids.tenant,accessToken:'SYNTHETIC_SERVER_PRIVATE_TOKEN',tokenVersion:1,expiresAt:'2026-10-05T09:00:00.000Z',scope:'accounting.invoices accounting.contacts accounting.settings accounting.payments.read'};
  const deps={client,connection,accessContext:{profile:{id:ids.observer}},now:()=>now,query,queryAll:query,loadSafetyContext:async()=>clone(first.source.safetyContext),
    readStatus:async()=>({allowanceKnown:true,availableCalls:318,reservedCalls:0,unresolvedWrites:0,dailyHold:false}),
    reserveBudget:async(_c,o)=>{metrics.reserves.push(o);return {id:uuid(900)};},releaseBudget:async(_c,o)=>{metrics.releases.push(o);if(hooks.releaseError)throw Error('PRIVATE_RELEASE_REASON');},withBudget:async(_c,_o,fn)=>fn(),
    accountingFetch:async(c,path,o)=>{
      assert.equal(c,connection);assert.equal(o.method,'GET');assert.equal(o.maxConcurrent,2);assert.equal(o.callsPerMinute,45);assert.equal(o.transientRetryLimit,0);assert.equal(o.retryOnRateLimit,false);
      metrics.gets.push({path,phase:o.budgetPhase});metrics.maxConcurrent=Math.max(metrics.maxConcurrent,++metrics.inflight);await Promise.resolve();hooks.get?.(path,o,metrics);
      if(!hooks.omitReceipt)o.onResponse({method:'GET',pathName:path,budgetId:o.budgetId,status:200,requestId:hooks.duplicateReceipt?uuid(1000):uuid(request++)});
      const url=new URL(path,'https://synthetic.invalid');let r;
      if(url.pathname==='/Organisations')r={Organisations:[clone(xero.organisation)]};
      else if(url.pathname==='/Accounts')r={Accounts:clone(xero.accounts)};
      else if(url.pathname==='/TaxRates')r={TaxRates:clone(xero.taxes)};
      else if(url.pathname==='/Contacts')r={Contacts:clone(xero.contacts).slice((Number(url.searchParams.get('page'))-1)*1000,Number(url.searchParams.get('page'))*1000)};
      else if(url.pathname==='/Invoices'){const requested=url.searchParams.get('IDs')?.split(','),all=clone(xero.invoices).filter(row=>requested?requested.includes(row.InvoiceID):decodeURIComponent(path).includes(row.Contact.ContactID));r={Invoices:all};}
      else if(url.pathname==='/CreditNotes')r={CreditNotes:clone(xero.credits)};
      else if(url.pathname.startsWith('/Payments/'))r={Payments:clone(xero.payments).filter(row=>row.PaymentID===url.pathname.split('/').at(-1))};
      else assert.fail(`Unexpected nonfinancial path: ${path}`);
      const answer=hooks.response?.(r,path,o)??r;metrics.inflight--;return answer;
    }};
  return {scope:{campaignId,expectedRevision:4,caseIds},deps,tables,sfRows,xero,fixtures,metrics,hooks};
}
async function collect(m){return collectSupplierFinancialBucket(m.scope,m.deps);}
function held(r,code){assert.equal(r.complete,false);assert.equal(privateEvidence(r),null);if(code)assert.ok(r.cases.some(c=>c.blockers.some(b=>b.code===code)),JSON.stringify(r));}

test('AUTHORISED and PAID complete original snapshots are private, ordered and have no financial authority',async()=>{
  const m=model({count:2,paid:1});
  // Retain exact authoritative SF18 in the text key and saved item. Canonical
  // SF15 is used only for independently checked comparison/claim identities.
  const raw18=m.sfRows.Supplier_Invoice__c[0].Id+'AAA',textKey=`${ids.tenant}:Supplier_Invoice__c:${raw18}`;
  m.sfRows.Supplier_Invoice__c[0].Id=raw18;m.scope.caseIds[0]=textKey;
  for(const object of ['STEM_Line_Item__c','STEM_Extra_Cost__c','Payment__c'])for(const row of m.sfRows[object])if(sf(row.Supplier_Invoice__c)===sf(raw18))row.Supplier_Invoice__c=raw18;
  Object.assign(m.tables.xero_reconciliation_cases[0],{id:textKey,case_key:textKey});Object.assign(m.tables.xero_reconciliation_cases[0].evidence,{id:textKey,caseKey:textKey,sourceId:raw18});
  m.tables.xero_financial_sync_items[0].source_id=raw18;m.tables.xero_financial_sync_items[0].source_payload.salesforceId=raw18;
  const originalTargets=hash(m.xero.invoices),originalPayments=hash(m.xero.payments),r=await collect(m),p=privateEvidence(r);
  assert.equal(r.complete,true);assert.ok(p);assert.deepEqual(r.cases.map(c=>c.caseId),m.scope.caseIds);assert.ok(r.cases.every(c=>c.caseId===`${r.tenantId}:Supplier_Invoice__c:${p.inputs.find(x=>sf(x.source.parent.Id)===c.sourceId).source.parent.Id}`));assert.ok(r.cases.every(c=>c.proofValid),JSON.stringify(r.cases));
  assert.equal(r.financialWrites,0);assert.equal(r.approvalGranted,false);assert.equal(p.scopeMaterial.campaignId,m.scope.campaignId);assert.equal(p.scopeMaterial.expectedRevision,4);assert.deepEqual(p.scopeMaterial.caseIds,m.scope.caseIds);assert.equal(r.scopeFingerprint,hash(p.scopeMaterial));
  assert.equal(hash(p.targets),originalTargets);assert.equal(hash(p.inputs[0].ledgerPaymentEvidence.payments),originalPayments);assert.equal(p.proofs[0].evidence.accounting.settlement.status,'PAID');assert.equal(p.proofs[1].evidence.accounting.settlement.status,'AUTHORISED');
  assert.ok(p.proofs.every(x=>x.documentVerification==='UNVERIFIED'&&x.proposedPayload===null&&!x.workflowEligible));assert.equal(p.inputs[0].sourceDependencies.payments[1].Amount__c,0.46000000000001);
  assert.deepEqual(p.sources,p.inputs.map(input=>input.source.sourcePayload));assert.ok(p.sources.every(source=>source.currency==='USD'&&source.xeroType==='ACCPAY'&&source.salesforceObject==='Supplier_Invoice__c'));assert.equal(p.inputs[0].source.sourcePayload.sourceFingerprint,p.inputs[0].source.sourceFingerprint);assert.notEqual(p.inputs[0].source.sourceFingerprint,p.scopeMaterial.cases[0].originalSavedSourceFingerprint);
  assert.equal(privateEvidence(clone(r)),null);assert.ok(Object.isFrozen(p.inputs[0].source.parent));assert.doesNotMatch(JSON.stringify(r),/APIKey|PRIVATE_|LineItems|sourcePayload|Payments|accessToken/);
  assert.equal(p.providerReceipts.length,m.metrics.gets.length);assert.equal(m.metrics.releases.length,1);assert.ok(m.metrics.sf.every(q=>q.options.clean===true));assert.ok(m.metrics.sf.filter(q=>q.soql.includes(' FROM Payment__c ')).every(q=>!q.soql.includes('Buyer_Invoice__c')));
});

test('exact saved server scope rejects extra client authority, duplicate IDs, stale revision and foreign ownership before provider calls',async()=>{
  for(const alter of [m=>m.scope.complete=true,m=>m.scope.caseIds.push(m.scope.caseIds[0]),m=>m.scope.expectedRevision++,m=>m.scope.caseIds[0]=`${uuid(999)}:Supplier_Invoice__c:${m.fixtures[0].source.parent.Id}`,m=>m.tables.xero_reconciliation_cases[0].evidence.sourceId=sid('a06',90),m=>m.tables.xero_reconciliation_cases[0].case_key='foreign-case-key',m=>{const r=m.tables.xero_reconciliation_cases[0],key=r.id+'AAA';r.id=key;r.case_key=key;r.evidence.id=key;r.evidence.caseKey=key;m.scope.caseIds[0]=key;},m=>m.tables.xero_reconciliation_campaigns[0].owner_id=uuid(999),m=>m.tables.xero_reconciliation_cases[0].evidence.targetId=uuid(999),m=>m.tables.xero_financial_sync_items[0].xero_payload.Type='ACCREC',m=>m.tables.xero_financial_sync_items[0].source_payload.matchEvidence={candidates:[{},{}]}]){
    const m=model();alter(m);held(await collect(m));assert.equal(m.metrics.gets.length,0);assert.equal(m.metrics.reserves.length,0);
  }
});

test('remittance family closure retains deleted rows and subcent monetary originals only as conflict dependencies',async()=>{
  const m=model(),parent={Id:sid('a0S',90),IsDeleted:false,Supplier_Invoice__c:null,STEM__c:ids.stem,Account__c:ids.account,Is_Volume_Discount__c:false,Amount__c:'100.00000001',Remittance__c:null};
  m.sfRows.Payment__c[0].Remittance__c=parent.Id;m.sfRows.Payment__c.push(parent,{...parent,Id:sid('a0S',91),IsDeleted:true,Remittance__c:parent.Id});
  const r=await collect(m),p=privateEvidence(r);assert.equal(r.complete,true);assert.equal(r.cases[0].proofValid,true,JSON.stringify(r.cases));
  assert.deepEqual(p.inputs[0].sourceDependencies.families,m.sfRows.Payment__c.filter(row=>row.Id===parent.Id||row.Remittance__c===parent.Id));
  assert.equal(p.proofs[0].localClaimScope.sourceDependencyHash,hash({payments:p.inputs[0].sourceDependencies.payments,families:p.inputs[0].sourceDependencies.families}));assert.equal(p.proofs[0].localClaimScope.sourcePaymentIds.length,4);
});

test('incomplete query pages, duplicate original IDs, absent Product2 state and ambiguous global Contacts hold without capture',async()=>{
  for(const alter of [m=>m.hooks.sfResponse=(o,r)=>o==='Supplier_Invoice__c'?{records:r,totalSize:r.length+1,done:false}:undefined,m=>m.sfRows.STEM_Line_Item__c.push(clone(m.sfRows.STEM_Line_Item__c[0])),m=>delete m.sfRows.Product2[0].IsActive,m=>m.xero.contacts.push({...m.xero.contacts[0],ContactID:uuid(998)})]){
    const m=model();alter(m);held(await collect(m));assert.equal(m.metrics.releases.length,1);
  }
});

test('financial mismatch, active exact number collision and an unresolved dispute retain complete facts and explicitly held proof',async()=>{
  for(const [alter,code] of [
    [m=>m.sfRows.STEM_Line_Item__c[0].Total_Cost__c='10000.01','SOURCE_SIGNED_LINES_HEADER_MISMATCH'],
    [m=>m.sfRows.Supplier_Invoice__c.push({...clone(m.sfRows.Supplier_Invoice__c[0]),Id:sid('a06',90)}),'SOURCE_DOCUMENT_IDENTITY_COLLISION'],
    [m=>m.tables.dispute_beta_cases.push({id:uuid(950),stem_id:ids.stem,workflow_status:'Draft',status:'Open-Trader-Review'}),'LOCAL_OWNERSHIP_OR_UNRESOLVED_CLAIM'],
  ]){const m=model();alter(m);const r=await collect(m);assert.equal(r.complete,true);assert.equal(r.cases[0].proofValid,false);assert.ok(r.cases[0].blockers.some(b=>b.code===code),JSON.stringify(r.cases));assert.ok(privateEvidence(r));}
});

test('inactive old exact-number history and legitimate same STEM references remain original coverage without identity collision',async()=>{
  const m=model();m.sfRows.Supplier_Invoice__c.push({...clone(m.sfRows.Supplier_Invoice__c[0]),Id:sid('a06',90),IsDeleted:true});
  m.sfRows.Supplier_Invoice__c.push({...clone(m.sfRows.Supplier_Invoice__c[0]),Id:sid('a06',91),Name:'OTHER-SUPPLIER-OBLIGATION'});
  const r=await collect(m);assert.equal(r.complete,true);assert.equal(r.cases[0].proofValid,true,JSON.stringify(r.cases));assert.equal(privateEvidence(r).inputs[0].identity.sourceClaims.length,3);
});

test('full target/ledger/settings and saved scope/local grants are reread, holding every stale interval',async()=>{
  for(const [alter,code] of [
    [m=>m.hooks.response=(r,p,o)=>o.budgetPhase==='verification'&&p.startsWith('/Invoices?')?{...r,Invoices:r.Invoices.map(x=>({...x,UpdatedDateUTC:'2026-10-04T09:01:00Z'}))}:undefined,'FINANCIAL_CURRENT_DEPENDENCY_CHANGED'],
    [m=>m.hooks.response=(r,p,o)=>o.budgetPhase==='verification'&&p.startsWith('/Payments/')?{...r,Payments:r.Payments.map(x=>({...x,Reference:'changed'}))}:undefined,'FINANCIAL_CURRENT_DEPENDENCY_CHANGED'],
    [m=>m.hooks.response=(r,p,o)=>o.budgetPhase==='verification'&&p==='/Accounts'?{...r,Accounts:r.Accounts.map(x=>({...x,Name:'changed'}))}:undefined,'FINANCIAL_CURRENT_DEPENDENCY_CHANGED'],
    [m=>m.hooks.db=(t,metrics)=>{if(t==='xero_reconciliation_campaigns'&&metrics.db.filter(x=>x===t).length===2)m.tables[t][0].revision++;},'FINANCIAL_SAVED_SCOPE_CHANGED'],
    [m=>m.hooks.db=(t,metrics)=>{if(t==='xero_financial_product_mappings'&&metrics.db.filter(x=>x===t).length===2)m.tables[t][0].revision++;},'FINANCIAL_CURRENT_CONTROLS_CHANGED'],
  ]){const m=model({paid:1});alter(m);held(await collect(m),code);assert.equal(m.metrics.releases.length,1);}
});

test('missing receipts, duplicate requests, token change, cancellation and release failure never expose trusted capture',async()=>{
  for(const alter of [m=>m.hooks.omitReceipt=true,m=>m.hooks.duplicateReceipt=true,m=>m.hooks.get=()=>m.deps.connection.tokenVersion++,m=>{m.deps.signal={aborted:false};m.hooks.get=()=>{m.deps.signal.aborted=true;};},m=>m.hooks.releaseError=true]){
    const m=model({paid:1});alter(m);held(await collect(m));assert.equal(m.metrics.releases.length,1);
  }
});

test('expiry, required read scopes, quota uncertainty and 200-call reserve are prerequisite holds',async()=>{
  for(const alter of [m=>m.deps.connection.expiresAt=now,m=>m.deps.connection.scope='accounting.invoices accounting.contacts accounting.settings',m=>m.deps.readStatus=async()=>({allowanceKnown:false}),m=>m.deps.readStatus=async()=>({allowanceKnown:true,availableCalls:228,reservedCalls:0,unresolvedWrites:0})]){
    const m=model();alter(m);held(await collect(m));assert.equal(m.metrics.reserves.length,0);assert.equal(m.metrics.gets.length,0);
  }
});

test('25 suppliers with 19 existing PAID ledgers use bounded batch reads and retain every raw target',async()=>{
  const m=model({count:25,paid:19}),before=hash(m.xero.invoices),began=performance.now(),r=await collect(m),elapsedMs=performance.now()-began,p=privateEvidence(r);
  assert.equal(r.complete,true,JSON.stringify(r));assert.ok(r.cases.every(c=>c.proofValid),JSON.stringify(r.cases));assert.deepEqual(r.cases.map(c=>c.caseId),m.scope.caseIds);
  assert.equal(hash(p.targets),before);assert.equal(m.metrics.gets.length,49);assert.equal(m.metrics.gets.filter(x=>x.path.startsWith('/Payments/')).length,38);assert.ok(m.metrics.maxConcurrent<=2);assert.equal(r.observation.forecast.totalCalls,81);assert.equal(r.observation.forecast.minimumAvailableCalls,281);assert.ok(r.observation.forecast.totalCalls<=118);
  assert.ok(m.metrics.gets.filter(x=>x.path.includes('pageSize=')).every(x=>x.path.includes('pageSize=1000')));assert.ok(m.metrics.sf.every(x=>!/(ContentDocument|ContentVersion|Attachment)/.test(x.soql)));
  assert.equal(p.proofs.filter(x=>x.evidence.accounting.settlement.status==='PAID').length,19);assert.equal(p.proofs.filter(x=>x.evidence.accounting.settlement.status==='AUTHORISED').length,6);
  console.log(JSON.stringify({fixture:'synthetic25',elapsedMs:Number(elapsedMs.toFixed(3)),providerMockGETs:m.metrics.gets.length,providerCalls:0,sourceMockQueries:m.metrics.sf.length,databaseMockReads:m.metrics.db.length,maxConcurrent:m.metrics.maxConcurrent,forecast:r.observation.forecast,verified:25}));
});

test('forecast rejects invalid scope and uses separate 1000-page limits without old hundred-row credit expansion',()=>{
  assert.equal(forecast(25,7).totalCalls,81);assert.equal(forecast(25,9).totalCalls,98);assert.equal(forecast(1,1).totalCalls,33);
  for(const args of [[0,1],[26,1],[1,0],[1,2],[1.5,1]])assert.throws(()=>forecast(...args));
});

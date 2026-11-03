import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import { buildCampaignContactCases, executeCampaignContactCase } from '../api/_xeroReconciliationContacts.js';
import { fixtureXeroConnection, fixtureSharedControl } from './helpers/xeroSharedControl.js';
import { xeroAccountingFetch } from '../api/_xeroContactSync.js';

const tenantId='00000000-0000-4000-8000-000000000001';
const ownerId='00000000-0000-4000-8000-000000000002';
const targetId='00000000-0000-4000-8000-000000000003';
const id=n=>`001${String(n).padStart(12,'0')}AAA`;
const account=(n=1,overrides={})=>({id:id(n),name:'EXAMPLE SHIPPING LTD',companyCode:'',recordType:'Buyer',inactiveSuspended:false,...overrides});
const contact=(overrides={})=>({id:targetId,name:'EXAMPLE SHIPPING LTD',status:'ACTIVE',accountNumber:'',contactNumber:'',...overrides});
const baselineAt='2026-09-30T00:00:00.000Z';
function cases(accounts=[account()],contacts=[],extra={}) {return buildCampaignContactCases({tenantId,ownerId,baselineAt,accounts,contacts,complete:true,requiredAccountIds:[accounts[0]?.id||id(1)],...extra});}

test('same-name families create once without requiring CL keys and stay deterministic across input order',()=>{
  const accounts=[account(2,{name:' example   shipping ltd ',companyCode:'HKEXAMPLE'}),account(1)];
  const result=cases(accounts,[],{requiredAccountIds:accounts.map(row=>row.id)});
  assert.equal(result.length,1);assert.equal(result[0].status,'ready');assert.equal(result[0].sourceId,id(1));
  assert.equal(result[0].contactProposal.action,'create');assert.deepEqual(result[0].sourceIds,[id(1),id(2)]);
  assert.equal(cases(accounts.toReversed(),[],{requiredAccountIds:[id(2)]})[0].evidenceFingerprint,result[0].evidenceFingerprint);
  assert.equal(result[0].contactProposal.Name,'EXAMPLE SHIPPING LTD');
});

test('punctuation and legal suffixes never collapse into the same family',()=>{
  const accounts=[account(1,{name:'ACME LTD.'}),account(2,{name:'ACME LTD'}),account(3,{name:'ACME LIMITED'})];
  const result=cases(accounts,[],{requiredAccountIds:accounts.map(row=>row.id)});assert.equal(result.length,3);
});

test('one active exact-name Contact serves all family IDs, including an explicit family-member ID',()=>{
  const accounts=[account(1),account(2)];
  assert.deepEqual(cases(accounts,[contact({accountNumber:id(2)})]),[]);
  assert.deepEqual(cases(accounts,[contact(),contact({id:randomUUID(),status:'ARCHIVED'})]),[]);
  const restore=cases(accounts,[contact({status:'ARCHIVED',contactNumber:id(2)})])[0];
  assert.equal(restore.status,'ready');assert.equal(restore.contactProposal.action,'restore');assert.equal(restore.targetId,targetId);
});

for(const [label,accounts,contacts] of [
  ['multiple active',[account()],[contact(),contact({id:randomUUID()})]],
  ['multiple archived',[account()],[contact({status:'ARCHIVED'}),contact({id:randomUUID(),status:'ARCHIVED'})]],
  ['protected status',[account()],[contact({status:'GDPRREQUEST'})]],
  ['inactive family member',[account(),account(2,{inactiveSuspended:true})],[]],
  ['placeholder',[account(1,{name:'Unknown'})],[]],
  ['unsupported source',[account(1,{recordType:'Person'})],[]],
  ['foreign CL owner',[account(1,{companyCode:'HKFOO'}),account(2,{name:'OTHER LTD',companyCode:' hkfoo '})],[]],
  ['explicit foreign Account ID',[account(),account(2,{name:'OTHER LTD'})],[contact({accountNumber:id(2)})]],
  ['explicit missing Account ID',[account()],[contact({contactNumber:id(77)})]],
  ['foreign Contact claims CL',[account(1,{companyCode:'HKFOO'})],[contact({name:'OTHER LTD',contactNumber:'HKFOO'})]],
]) test(`${label} remains a specific decision instead of creating a duplicate`,()=>{
  const [result]=cases(accounts,contacts);assert.equal(result.status,'needs_decision');assert.ok(result.reason.length>20);
});

test('incomplete, duplicate and invalid inventory cannot authorise a proposal; missing referenced Account is explicit',()=>{
  assert.throws(()=>cases([account()],[],{complete:false}),/Complete/);
  assert.throws(()=>cases([account(),account()],[]),/duplicate-free/);
  assert.throws(()=>cases([account()], [contact(),contact()]),/duplicate-free/);
  const result=cases([account()],[],{requiredAccountIds:[id(99),id(99)]});assert.equal(result.length,1);assert.equal(result[0].status,'needs_decision');assert.equal(result[0].contactProposal,null);
});

test('repeated mixed Account ID and CL-key identifiers retain the complete original collision proof',()=>{
  const contactId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const accounts=[account(3,{name:'THIRD LTD',companyCode:id(1).slice(0,15)}),account(1,{name:'FIRST LTD',companyCode:' hk shared '}),
    account(2,{name:'SECOND LTD',companyCode:id(1)}),account(4,{name:'FOURTH LTD',companyCode:'HK SHARED'})];
  const contacts=[contact({id:contactId(10),name:'FIRST LTD',accountNumber:id(1),contactNumber:id(1).slice(0,15)}),
    contact({id:contactId(11),name:'SECOND LTD',accountNumber:` ${id(1)} `,contactNumber:' HK   SHARED '}),
    contact({id:contactId(12),name:'THIRD LTD',status:'ARCHIVED',accountNumber:id(1).slice(0,15),contactNumber:` ${id(1)} `}),
    contact({id:contactId(13),name:'UNRELATED LTD',accountNumber:'HK SHARED',contactNumber:' hk  shared '})];
  const result=cases(accounts,contacts,{requiredAccountIds:accounts.map(row=>row.id)});
  // Captured from the original uncached builder: every output field and exact
  // financial review fingerprint must remain unchanged, including owner ordering.
  assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'),'2da6244fef5325fb2e51cd173dc5cc5794f0b68cc4281d1c747a3f3cae19e288');
  assert.deepEqual(result.map(row=>row.contactEvidence.foreignAccounts.map(item=>item.id)),[
    [id(2),id(3),id(4)],[id(1),id(4)],[id(1),id(2)],[id(1)],
  ]);
  assert.deepEqual(result.map(row=>row.contactEvidence.contacts.map(item=>item.id)),[
    [10,11,12,13].map(contactId),[10,11,12].map(contactId),[10,12].map(contactId),[11,13].map(contactId),
  ]);
  assert.deepEqual(cases(accounts.toReversed(),contacts.toReversed(),{requiredAccountIds:accounts.map(row=>row.id)}),result);
});

test('owner caches remain request-local when the complete inventory changes',()=>{
  const contacts=[contact({accountNumber:'SHARED CODE'})];
  const first=cases([account(1,{companyCode:'SHARED CODE'})],contacts);
  assert.deepEqual(first,[]);
  const second=cases([account(1),account(2,{name:'FOREIGN LTD',companyCode:'SHARED CODE'})],contacts);
  assert.equal(second[0].status,'needs_decision');assert.deepEqual(second[0].contactEvidence.foreignAccounts.map(row=>row.id),[id(2)]);
});

test('snapshot-wide repeated identifiers scan owners once, and blanks never scan the Account inventory',()=>{
  const accountCount=120,contactCount=240;
  const accounts=Array.from({length:accountCount},(_,n)=>account(n+1,{name:`COMPANY ${n+1} LTD`,companyCode:n===0?'SHARED CODE':''}));
  const contacts=Array.from({length:contactCount},(_,n)=>contact({id:`00000000-0000-4000-8001-${String(n+1).padStart(12,'0')}`,
    name:`UNRELATED CONTACT ${n+1}`,accountNumber:' shared  code ',contactNumber:n%2?'':'   '}));
  let scans=0,predicates=0;
  Object.defineProperty(accounts,'filter',{value(predicate){scans++;return Array.prototype.filter.call(this,(...args)=>{predicates++;return predicate(...args);});}});
  const result=cases(accounts,contacts,{requiredAccountIds:accounts.map(row=>row.id)});
  assert.equal(result.length,accountCount);
  assert.equal(result[0].status,'needs_decision');assert.equal(result.at(-1).status,'ready');
  // One existing foreign-Account scan per family, plus one shared identifier
  // owner scan. The original builder performs C*(2F-1)+F whole-inventory scans.
  assert.equal(scans,accountCount+1);assert.equal(predicates,accountCount*(accountCount+1));
  const originalScans=contactCount*(2*accountCount-1)+accountCount;
  assert.ok(originalScans>scans*400,'Work reduction is deterministic, not a machine-dependent timing threshold');
});

function executorFixture({archived=false,failPost=false,sourceAccounts=[account()],contacts=null,postChange=null}={}) {
  const raw={ContactID:targetId,Name:sourceAccounts[0].name,ContactStatus:archived?'ARCHIVED':'ACTIVE',AccountNumber:'',ContactNumber:'',BankAccountDetails:'retained',CurrencyCode:'USD',TaxNumber:'retained',Addresses:[{AddressType:'POBOX',City:'Hong Kong'}]};
  const inventory=contacts|| (archived?[contact({status:'ARCHIVED'})]:[]);
  const row=cases(sourceAccounts,inventory)[0];const events=[];const calls=[];const resolutions=[];const requests=[];const outcomes=[];const budgetId=randomUUID();
  const batch={id:randomUUID(),claim_id:randomUUID(),campaign_id:randomUUID()};
  let existing=archived?[structuredClone(raw)]:[];let releaseCount=0;let leaseId=null;
  const client={rpc:async(name)=>{assert.equal(name,'xero_campaign_actor_v1');return{data:null,error:null};},from(table){
    const filters={};const builder={select(){return builder;},eq(key,value){filters[key]=value;return builder;},in(){return builder;},order(){return builder;},limit(){return builder;},
      async maybeSingle(){
        if(table==='xero_contact_lifecycle_locks')return{data:{run_id:leaseId,locked_until:new Date(Date.now()+900_000).toISOString()}};
        if(table==='xero_reconciliation_batches')return{data:{...batch,status:'running',category:'contact',claim_case_ids:[row.id],approved_by:ownerId,approved_at:baselineAt}};
        if(table==='xero_reconciliation_campaigns')return{data:{id:batch.campaign_id,tenant_id:tenantId}};
        if(table==='xero_reconciliation_cases')return{data:{id:row.id,evidence_fingerprint:row.evidenceFingerprint,evidence:row}};
        if(table==='xero_shared_requests')return{data:requests.find(request=>Object.entries(filters).every(([key,value])=>request[key]===value))||null,error:null};
        if(table==='xero_shared_budgets')return{data:{id:budgetId,tenant_id:tenantId,owner_key:`campaign:${batch.campaign_id}:${batch.id}:${batch.claim_id}`},error:null};
        throw Error(`Unexpected table ${table}`);
      },insert(event){const saved={...structuredClone(event),id:String(events.length+1)};events.push(saved);return{select:()=>({single:async()=>({data:{id:saved.id},error:null})})};},then(resolve,reject){const rows=table==='xero_reconciliation_events'?outcomes:events;return Promise.resolve({data:rows.filter(event=>Object.entries(filters).every(([key,value])=>key.includes('->>')?event[key.split('->>')[0]]?.[key.split('->>')[1]]===value:event[key]===value)),error:null}).then(resolve,reject);}};return builder;
  }};
  const accountingFetch=async(_connection,path,options)=>{
    calls.push({path,...options});
    if(options.method==='POST') {
      const intent=events.filter(event=>event.event_type==='campaign_contact_intent').at(-1).fingerprints;
      assert.equal(options.requestId,intent.postRequestId);
      requests.push({id:options.requestId,tenant_id:tenantId,budget_id:budgetId,token_version:1,resource_key:'Contacts',method:'POST',phase:'operation',
        state:failPost?'unknown':'complete',outcome_unknown:failPost,deadline_at:new Date(Date.now()-1000).toISOString()});
      if(archived){assert.deepEqual(options.body,{Contacts:[{ContactID:targetId,ContactStatus:'ACTIVE'}]});existing[0].ContactStatus='ACTIVE';}
      else {assert.deepEqual(options.body,{Contacts:[{Name:row.contactProposal.Name}]});existing=[{...raw,ContactStatus:'ACTIVE'}];}
      if(postChange)postChange(existing);
      if(failPost)throw Object.assign(Error('unknown'),{code:'XERO_WRITE_OUTCOME_UNKNOWN',details:{outcomeUnknown:true,requestId:options.requestId}});
      options.onResponse?.({requestId:options.requestId,budgetId,status:200});return{Contacts:structuredClone(existing)};
    }
    options.onResponse?.({requestId:randomUUID(),budgetId:randomUUID(),status:200});
    return {Contacts:structuredClone(existing)};
  };
  const connection=fixtureXeroConnection({...{tenantId,scope:'accounting.contacts'}},fixtureSharedControl({resolveUnknown:async facts=>resolutions.push(facts)}));
  const args={case:row,currentAccounts:sourceAccounts,currentContacts:inventory,connection,client,actor:{id:ownerId,email:'fixture@example.test'},batch,budgetId,
    env:{FCOS_ENABLE_XERO_CONTACT_SYNC:'true'},accountingFetch,lockReader:async(_client,id)=>{leaseId=id;return{release:async()=>{releaseCount++;}};}};
  return{row,events,calls,resolutions,requests,outcomes,args,get releases(){return releaseCount;},get currentContacts(){return existing.map(item=>({id:item.ContactID,name:item.Name,status:item.ContactStatus,accountNumber:item.AccountNumber,contactNumber:item.ContactNumber}));}};
}

test('create persists original intent, sends Name only, then records exact GET proof before reconciliation',async()=>{
  const f=executorFixture();const result=await executeCampaignContactCase(f.args);
  assert.equal(result.status,'reconciled');assert.equal(result.xeroContactId,targetId);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
  assert.equal(f.calls.at(-1).budgetPhase,'verification');assert.ok(f.calls.at(-1).path.includes(`/Contacts/${targetId}`));
  assert.deepEqual(f.events.map(event=>event.event_type),['campaign_contact_intent','campaign_contact_response','campaign_contact_verified']);
  assert.equal(result.receiptId,f.events.at(-1).id);assert.equal(f.events.at(-1).fingerprints.verifiedContact.BankAccountDetails,'retained');assert.equal(f.releases,1);
});

test('restore preserves all business fields and uses exact ID + ACTIVE only',async()=>{
  const f=executorFixture({archived:true});const result=await executeCampaignContactCase(f.args);assert.equal(result.status,'reconciled');
  assert.equal(f.events[0].fingerprints.beforeContact.ContactStatus,'ARCHIVED');assert.equal(f.events.at(-1).fingerprints.verifiedContact.ContactStatus,'ACTIVE');
  assert.equal(f.events[0].fingerprints.businessFingerprint,f.events.at(-1).fingerprints.businessFingerprint);
});

test('changed restored financial/business detail prevents a successful outcome',async()=>{
  const f=executorFixture({archived:true,postChange:rows=>{rows[0].BankAccountDetails='changed';}});
  await assert.rejects(executeCampaignContactCase(f.args),/preserved identity and business fields/);
  assert.equal(f.events.some(event=>event.event_type==='campaign_contact_verified'),false);assert.equal(f.releases,1);
});

test('unknown create recovers by readback and releases its hold only using the saved verified generated audit ID',async()=>{
  const f=executorFixture({failPost:true});const result=await executeCampaignContactCase(f.args);assert.equal(result.status,'reconciled');
  assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.calls.filter(call=>call.budgetPhase==='verification').length,2);
  assert.equal(f.resolutions.length,1);assert.equal(f.resolutions[0].evidenceReference,`xero_financial_audit_events:${result.receiptId}`);
});

test('recovery verifies original intent and active target without another POST',async()=>{
  const f=executorFixture({archived:true});await executeCampaignContactCase(f.args);const postCount=f.calls.filter(call=>call.method==='POST').length;
  const result=await executeCampaignContactCase({...f.args,recovering:true,currentContacts:f.currentContacts});
  assert.equal(result.action,'verified_prior_outcome');assert.equal(f.calls.filter(call=>call.method==='POST').length,postCount);
});

test('changed source, revoked gate, changed claim or missing recovery intent sends nothing',async()=>{
  const f=executorFixture();
  await assert.rejects(executeCampaignContactCase({...f.args,currentAccounts:[account(1,{companyCode:'NEW'})]}),/changed after approval/);
  await assert.rejects(executeCampaignContactCase({...f.args,env:{}}),/disabled/);
  await assert.rejects(executeCampaignContactCase({...f.args,batch:{...f.args.batch,claim_id:randomUUID()}}),/claim changed/);
  const held=await executeCampaignContactCase({...f.args,recovering:true});
  assert.equal(held.status,'needs_decision');assert.equal(held.definitiveNoWrite,true);
  assert.equal(f.calls.length,0);
});

test('a failed durable intent save prevents POST and still releases the lifecycle lease',async()=>{
  const f=executorFixture();const original=f.args.client.from.bind(f.args.client);
  f.args.client.from=table=>{const query=original(table);if(table==='xero_financial_audit_events')query.insert=()=>({select:()=>({single:async()=>({error:{message:'private storage error'}})})});return query;};
  await assert.rejects(executeCampaignContactCase(f.args),/durably verified/);
  assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.equal(f.releases,1);
});

test('source family grows or explicit foreign identity appears after approval, blocking POST',async()=>{
  const f=executorFixture();
  await assert.rejects(executeCampaignContactCase({...f.args,currentAccounts:[account(),account(2)]}),/family changed/);
  await assert.rejects(executeCampaignContactCase({...f.args,currentContacts:[contact({name:'OTHER',contactNumber:id(1)})]}),/different-name Xero Contact/);
  assert.equal(f.calls.length,0);
});

test('unresolved prior restoration remains read-only when target is still archived',async()=>{
  const f=executorFixture({archived:true});await executeCampaignContactCase(f.args);
  f.events.splice(1); // Simulate the original retained intent without a saved provider result.
  const reads=[];const accountingFetch=async(_connection,path,options)=>{reads.push({path,...options});assert.equal(options.method,'GET');return{Contacts:[{...f.events[0].fingerprints.beforeContact}]};};
  await assert.rejects(executeCampaignContactCase({...f.args,recovering:true,accountingFetch}),/Readback did not confirm/);
  assert.equal(reads.length,1);assert.equal(reads[0].budgetPhase,'verification');
});

test('refresh can verify a previously blocked family already active without proposing another Contact write',()=>{
  const family=buildCampaignContactCases({tenantId,ownerId,baselineAt,accounts:[account()],contacts:[contact()],complete:true,
    requiredAccountIds:[account().id],includeVerifiedAccountIds:[account().id]});
  assert.equal(family.length,1);assert.equal(family[0].status,'reconciled');assert.equal(family[0].contactProposal,null);
  assert.match(family[0].reason,/unique active Contact/);
});

test('no-intent Contact recovery closes a safe no-write hold without requiring current write gate or acquiring a lifecycle lease',async()=>{
  const f=executorFixture();
  const result=await executeCampaignContactCase({...f.args,recovering:true,env:{},currentAccounts:[]});
  assert.equal(result.status,'needs_decision');assert.equal(result.definitiveNoWrite,true);
  assert.match(result.reason,/no Contact POST/);assert.equal(result.receiptId,undefined);
  assert.equal(f.calls.length,0);assert.equal(f.events.length,0);assert.equal(f.releases,0);
});

test('conclusive Contact HTTP400 rejection records a decimal audit receipt and stays terminal during recovery',async()=>{
  const f=executorFixture();const original=f.args.accountingFetch;
  f.args.accountingFetch=async(connection,path,options)=>{
    if(options.method!=='POST')return original(connection,path,options);
    options.onResponse({status:400,requestId:options.requestId,budgetId:f.args.budgetId});
    throw Object.assign(Error('Validation rejected'),{status:400,code:'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED'});
  };
  const result=await executeCampaignContactCase(f.args);
  assert.equal(result.status,'needs_decision');assert.equal(result.definitiveNoWrite,true);
  assert.equal(result.receiptId,'2');assert.equal(result.originalIntentId,'1');
  assert.equal(f.events[1].fingerprints.providerStatus,400);assert.equal(f.events[1].fingerprints.outcomeUnknown,false);
  for(const event of f.events)event.id=Number(event.id);
  const recovered=await executeCampaignContactCase({...f.args,recovering:true,env:{}});
  assert.equal(recovered.receiptId,'2');assert.equal(recovered.originalIntentId,'1');assert.equal(recovered.definitiveNoWrite,true);
  assert.equal(f.releases,1);
});

test('a validation-looking Contact failure without a provider response receipt stays unknown and is never resent',async()=>{
  const f=executorFixture();let posts=0;
  f.args.accountingFetch=async(_connection,_path,options)=>{
    if(options.method==='POST'){posts++;f.requests.push({id:options.requestId,tenant_id:tenantId,budget_id:f.args.budgetId,token_version:1,resource_key:'Contacts',method:'POST',phase:'operation',state:'unknown',outcome_unknown:true});throw Object.assign(Error('Uncorrelated error'),{status:400,code:'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED'});}
    return{Contacts:[]};
  };
  await assert.rejects(executeCampaignContactCase(f.args),/outcome is unconfirmed/);
  assert.equal(f.events[1].fingerprints.definitiveNoWrite,false);
  await assert.rejects(executeCampaignContactCase({...f.args,recovering:true}),/outcome is unconfirmed/);
  assert.equal(posts,1);
});

test('Contact element rejections must uniquely confirm the submitted create or original archived restore identity',async()=>{
  for(const archived of [false,true])for(const ambiguous of [false,true]){
    const f=executorFixture({archived});const original=f.args.accountingFetch;
    f.args.accountingFetch=async(connection,path,options)=>{
      if(options.method!=='POST')return original(connection,path,options);
      f.requests.push({id:options.requestId,tenant_id:tenantId,budget_id:f.args.budgetId,token_version:1,resource_key:'Contacts',method:'POST',phase:'operation',state:'complete',outcome_unknown:false});
      return {Contacts:[{ContactID:archived?targetId:undefined,Name:ambiguous?'DIFFERENT LTD':f.row.accountName,
        ContactStatus:archived?'ARCHIVED':undefined,HasValidationErrors:true,ValidationErrors:[{Message:'Rejected by Xero.'}]}]};
    };
    if(ambiguous)await assert.rejects(executeCampaignContactCase(f.args),/incomplete|invalid/);
    else{
      const outcome=await executeCampaignContactCase(f.args);
      assert.equal(outcome.status,'needs_decision');assert.equal(outcome.definitiveNoWrite,true);
      assert.equal(f.releases,1);assert.equal(f.events.some(event=>event.event_type==='campaign_contact_verified'),false);
    }
  }
});

test('Contact recovery binds the complete original campaign claim authority instead of borrowing another claim receipt',async()=>{
  const f=executorFixture();await executeCampaignContactCase(f.args);
  f.events[0].fingerprints.claimId=randomUUID();
  await assert.rejects(executeCampaignContactCase({...f.args,recovering:true,currentContacts:f.currentContacts}),/different evidence/);
});

test('Contact journal writes and recovery use the actual generated bigint audit schema',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  const migration=await readFile(new URL('../supabase/migrations/20260829080726_xero_financial_sync.sql',import.meta.url),'utf8');
  const schema=migration.match(/create table if not exists public\.xero_financial_audit_events \([\s\S]*?\n\);/)[0];
  await db.exec('create table public.xero_financial_sync_runs(id uuid primary key);');await db.exec(schema);
  const f=executorFixture();const original=f.args.client.from.bind(f.args.client);
  f.args.client.from=table=>{
    const query=original(table);if(table!=='xero_financial_audit_events')return query;
    query.insert=row=>({select(){return this;},async single(){
      assert.equal(Object.hasOwn(row,'id'),false);
      const inserted=await db.query(`insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
        values($1,$2,$3,$4,$5,$6,$7) returning id`,[row.run_id,row.event_type,row.outcome,row.actor_id,row.actor_email,
        JSON.stringify(row.record_counts),JSON.stringify(row.fingerprints)]);
      f.events.push({...row,id:Number(inserted.rows[0].id)});return{data:inserted.rows[0],error:null};
    }});return query;
  };
  const first=await executeCampaignContactCase(f.args);
  assert.match(first.receiptId,/^[1-9][0-9]*$/);
  const recovered=await executeCampaignContactCase({...f.args,recovering:true,currentContacts:f.currentContacts});
  assert.equal(recovered.originalIntentId,'1');assert.match(recovered.verificationFingerprint,/^[a-f0-9]{64}$/);
  const saved=await db.query('select id,fingerprints from public.xero_financial_audit_events order by id');
  assert.equal(saved.rows.at(-1).fingerprints.intentId,'1');
});

test('exact original Contact recovery stays GET-only with posting gate disabled and Contacts read scope',async()=>{
  for(const archived of [false,true]){
    const f=executorFixture({archived});await executeCampaignContactCase(f.args);
    f.args.connection.scope='accounting.contacts.read';
    const before=f.calls.length;
    const result=await executeCampaignContactCase({...f.args,recovering:true,env:{},currentContacts:f.currentContacts});
    assert.equal(result.status,'reconciled');assert.equal(result.xeroContactId,targetId);
    assert.ok(f.calls.slice(before).length>0);assert.ok(f.calls.slice(before).every(call=>call.method==='GET'));
    assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
  }
});

test('disabled-gate Contact recovery still rejects absent read scope and changed source family',async()=>{
  const f=executorFixture({archived:true});await executeCampaignContactCase(f.args);
  f.args.connection.scope='accounting.settings.read';
  await assert.rejects(executeCampaignContactCase({...f.args,recovering:true,env:{},currentContacts:f.currentContacts}),/Contact read scope/);
  f.args.connection.scope='accounting.contacts.read';
  await assert.rejects(executeCampaignContactCase({...f.args,recovering:true,env:{},currentContacts:f.currentContacts,
    currentAccounts:[account(1,{companyCode:'CHANGED'})]}),/family changed/);
});

test('Contact write gate is checked again after the durable intent immediately before POST',async()=>{
  const f=executorFixture();const original=f.args.client.from.bind(f.args.client);
  f.args.client.from=table=>{
    const query=original(table);if(table!=='xero_financial_audit_events')return query;
    const insert=query.insert;
    query.insert=row=>{const result=insert(row);if(row.event_type==='campaign_contact_intent')f.args.env.FCOS_ENABLE_XERO_CONTACT_SYNC='false';return result;};
    return query;
  };
  const held=await executeCampaignContactCase(f.args);
  assert.equal(held.status,'needs_decision');assert.equal(held.definitiveNoWrite,true);
  assert.equal(f.events[1].fingerprints.submitted,false);
  assert.equal(f.calls.some(call=>call.method==='POST'),false);
});

test('native Contact admission survives a crash before observation and response journal, then resolves by GET only',async()=>{
  const f=executorFixture({archived:true});let raw={...f.events[0]?.fingerprints.beforeContact,
    ContactID:targetId,Name:f.row.accountName,ContactStatus:'ARCHIVED',AccountNumber:'',ContactNumber:'',
    BankAccountDetails:'retained',CurrencyCode:'USD',TaxNumber:'retained',Addresses:[{AddressType:'POBOX',City:'Hong Kong'}]};
  const fetches=[];let recovering=false;
  const control=fixtureSharedControl({
    admit:async args=>{
      for(const request of f.requests)if(request.state==='inflight'&&Date.parse(request.deadline_at)<=Date.now()){
        request.state='unknown';request.outcome_unknown=request.method!=='GET';
      }
      const requestId=args.requestId||randomUUID();
      if(args.method==='POST')assert.equal(requestId,f.events.at(-1).fingerprints.postRequestId);
      f.requests.push({id:requestId,tenant_id:tenantId,budget_id:args.budgetId,token_version:args.tokenVersion,method:args.method,
        resource_key:args.resourceKey,phase:args.budgetPhase,state:'inflight',outcome_unknown:false,deadline_at:new Date(Date.now()+60000).toISOString()});
      return{requestId};
    },observe:async args=>{
      const request=f.requests.find(row=>row.id===args.requestId);
      if(request.method==='POST'&&!recovering)throw Error('worker lost before observe committed');
      Object.assign(request,{state:'complete',response_status:args.status,outcome_unknown:args.outcomeUnknown});return{recorded:true};
    },resolveUnknown:async facts=>{
      const post=f.requests.find(row=>row.id===facts.requestId),verification=f.requests.find(row=>row.id===facts.verificationRequestId);
      assert.equal(post.outcome_unknown,true);assert.equal(verification.method,'GET');assert.equal(verification.phase,'verification');
      assert.equal(verification.response_status,200);assert.equal(verification.budget_id,post.budget_id);
      post.outcome_unknown=false;post.state='complete';f.resolutions.push(facts);return true;
    },
  });
  f.args.connection=fixtureXeroConnection({tenantId,scope:'accounting.contacts',accessToken:'synthetic'},control);
  f.args.accountingFetch=xeroAccountingFetch;
  f.args.fetchImpl=async(_url,options)=>{fetches.push(options.method);if(options.method==='POST')raw.ContactStatus='ACTIVE';return new Response(JSON.stringify({Contacts:[raw]}),{status:200});};
  await assert.rejects(executeCampaignContactCase(f.args),/still in flight/);
  assert.deepEqual(f.events.map(event=>event.event_type),['campaign_contact_intent']);
  const post=f.requests.find(request=>request.method==='POST');assert.equal(post.id,f.events[0].fingerprints.postRequestId);
  post.deadline_at=new Date(Date.now()-1000).toISOString();recovering=true;f.args.connection.scope='accounting.contacts.read';
  const result=await executeCampaignContactCase({...f.args,recovering:true,env:{}});
  assert.equal(result.status,'reconciled');assert.equal(f.resolutions.length,1);
  assert.equal(f.resolutions[0].requestId,post.id);assert.equal(post.outcome_unknown,false);assert.deepEqual(fetches,['GET','POST','GET']);
});

test('a new approved Contact claim can follow a prior conclusive rejection, while unresolved claims still block',async()=>{
  const f=executorFixture();const original=f.args.accountingFetch;let reject=true;
  f.args.accountingFetch=async(connection,path,options)=>{
    if(options.method==='POST'&&reject){reject=false;options.onResponse({status:400,requestId:options.requestId});
      throw Object.assign(Error('rejected'),{status:400,code:'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED'});}
    return original(connection,path,options);
  };
  assert.equal((await executeCampaignContactCase(f.args)).definitiveNoWrite,true);
  f.args.batch.claim_id=randomUUID();
  const result=await executeCampaignContactCase(f.args);assert.equal(result.status,'reconciled');assert.equal(result.action,'create');
  assert.equal(f.events.filter(event=>event.event_type==='campaign_contact_intent').length,2);
  const pending=executorFixture({failPost:true});await executeCampaignContactCase(pending.args);pending.args.batch.claim_id=randomUUID();
  await assert.rejects(executeCampaignContactCase(pending.args),/remains unresolved/);
});

test('prior verified Contact intent retires only with exact immutable committed case outcome',async()=>{
  for(const finished of [false,true]){
    const f=executorFixture();const result=await executeCampaignContactCase(f.args);
    if(finished)f.outcomes.push({campaign_id:f.args.batch.campaign_id,batch_id:f.args.batch.id,event_type:'case_outcome',evidence:result});
    f.args.batch.claim_id=randomUUID();
    if(finished){const held=await executeCampaignContactCase({...f.args,recovering:true});assert.equal(held.definitiveNoWrite,true);assert.equal(held.originalIntentId,undefined);}
    else await assert.rejects(executeCampaignContactCase({...f.args,recovering:true}),/remains unresolved/);
  }
});

test('actual complete Contact receipt avoids resolving a hold invented by lost observation response',async()=>{
  const f=executorFixture({failPost:true});const original=f.args.accountingFetch;
  f.args.accountingFetch=async(...args)=>{
    try{return await original(...args);}catch(error){
      if(args[2].method==='POST'){f.requests.at(-1).state='complete';f.requests.at(-1).outcome_unknown=false;}
      throw error;
    }
  };
  assert.equal((await executeCampaignContactCase(f.args)).status,'reconciled');
  assert.equal(f.events[1].fingerprints.outcomeUnknown,true);assert.equal(f.resolutions.length,0);
});

test('Contact recovery of a durable intent never admitted records terminal no-write proof for a new review',async()=>{
  const f=executorFixture();const original=f.args.client.from;let failResponse=true;
  f.args.client.from=table=>{
    const query=original(table);if(table!=='xero_financial_audit_events')return query;
    const insert=query.insert;query.insert=row=>{
      if(row.event_type==='campaign_contact_response'&&failResponse)return{select:()=>({single:async()=>({error:{message:'worker crashed before response journal'}})})};
      const result=insert(row);if(row.event_type==='campaign_contact_intent')f.args.env.FCOS_ENABLE_XERO_CONTACT_SYNC='false';return result;
    };return query;
  };
  await assert.rejects(executeCampaignContactCase(f.args),/durably verified/);
  assert.deepEqual(f.events.map(row=>row.event_type),['campaign_contact_intent']);assert.equal(f.requests.length,0);
  failResponse=false;f.args.connection.scope='accounting.contacts.read';
  const held=await executeCampaignContactCase({...f.args,recovering:true});
  assert.equal(held.definitiveNoWrite,true);assert.equal(held.originalIntentId,'1');assert.equal(f.events.at(-1).fingerprints.submitted,false);
  assert.equal(f.calls.some(call=>call.method==='POST'),false);
});

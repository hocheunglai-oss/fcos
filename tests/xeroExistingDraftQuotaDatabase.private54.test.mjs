import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {quotaDatabase,quotaFixture} from './xeroExistingDraftQuotaDatabase.fixture.js';

for(const native of[false,true])test(native?'native PostgreSQL17 scoped reserve exception':'PGlite scoped reserve exception',async t=>{
 const h=await quotaDatabase(t,native),{db}=h;
 const check=(name,fn,options)=>t.test(name,async()=>{await db.exec('reset role;begin');h.setTransaction(true);try{const f=await quotaFixture(db,options);await db.exec('set role service_role');await fn(f);}finally{h.setTransaction(false);await db.exec('rollback;reset role');}});
 await check('immutable owner-only grants, current operator and complete54 policy',async f=>{
  const p=await f.policy();assert.equal(p.reserveFloor,0);assert.equal(p.grantId,f.grantId);assert.ok(Date.parse(p.grantExpiresAt)>Date.now());
  const all=(await db.query('select target_id from public.xero_existing_draft_authorisation_approved_records order by target_id')).rows.map(r=>r.target_id);assert.equal((await f.policy(all)).reserveFloor,0);
  for(const role of['anon','authenticated','service_role'])assert.equal((await db.query("select has_table_privilege($1,'public.xero_existing_draft_quota_grants_v1','INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
  await assert.rejects(db.query('delete from public.xero_existing_draft_quota_grants_v1'),/permission denied/);
  await assert.rejects(db.query("select public.xero_existing_draft_quota_policy_v1($1,$2,'wrong@example.test',$3::uuid[])",[f.tenant,f.actor.id,f.ids]),/ACTOR_INVALID/);
  await assert.rejects(f.policy([randomUUID()]),/SCOPE_INVALID/);await assert.rejects(f.policy([...f.ids,...f.ids]),/SCOPE_INVALID/);
  await assert.rejects(db.query('select public.xero_existing_draft_quota_policy_v1($1,$2,$3,$4::uuid[])',[randomUUID(),f.actor.id,f.actor.email,f.ids]),/tenant changed/);
  await db.exec('reset role');await db.query('update public.user_profiles set active=false where id=$1',[f.actor.id]);await db.exec('set role service_role');await assert.rejects(f.policy(),/ACTOR_INVALID/);
 });
 await check('no grant retains200 and ordinary admission delegation',async f=>{
  assert.equal((await f.policy()).reserveFloor,200);await assert.rejects(f.reserve(),/RESERVE_PROTECTED/);
  const r=await f.admit({id:null},'/Organisations');await f.observe(r);assert.equal((await f.status()).availableCalls,229);
 },{grant:false,available:230});
 await check('preview atomic combined forecast and fixed counts',async f=>{
  await assert.rejects(f.reserve('preview'),/RESERVE_PROTECTED/);
  await db.query('update public.xero_shared_tenant_control set available_calls=57 where tenant_id=$1',[f.tenant]);
  const b=await f.reserve('preview');assert.equal(b.operationCalls,26);assert.equal(b.verificationCalls,0);assert.equal(b.reserveFloor,0);
 },{available:56});
 await check('replay matches immutable counts, scope, mode,TTL; normal conversion denied',async f=>{
  const b=await f.reserve();assert.equal(b.operationCalls,29);assert.equal(b.verificationCalls,2);assert.equal((await f.reserve('apply',{id:b.id})).id,b.id);
  await assert.rejects(f.reserve('apply',{id:b.id,ttl:601}),/SCOPE_INVALID/);await assert.rejects(f.reserve('preview',{id:b.id}),/REPLAY_MISMATCH/);
  await assert.rejects(db.query('update public.xero_shared_budgets set operation_remaining=operation_remaining+1 where id=$1',[b.id]),/BUDGET_IMMUTABLE/);
  await assert.rejects(db.query("update public.xero_shared_budgets set expires_at=clock_timestamp()+interval '1 day' where id=$1",[b.id]),/BUDGET_IMMUTABLE/);
  await assert.rejects(db.query("select public.xero_shared_release($1,$2,'bypass')",[f.tenant,b.id]),/BUDGET_IMMUTABLE/);
  await assert.rejects(db.query("select public.xero_shared_admit($1,$2,1,'GET','Invoices',$3,'operation')",[f.tenant,randomUUID(),b.id]),/RESERVE_PROTECTED|BUDGET_IMMUTABLE/);
  await assert.rejects(db.query("insert into public.xero_shared_requests(id,tenant_id,token_version,method,resource_key,budget_id,phase,deadline_at) values($1,$2,1,'GET','Invoices',$3,'operation',clock_timestamp()+interval '120 seconds')",[randomUUID(),f.tenant,b.id]),/REQUEST_INVALID/);
 },{available:1000});
 await check('existing normal budget cannot acquire exception scope',async f=>{
  const id=randomUUID();await db.query("select public.xero_shared_reserve($1,$2,'normal',1,1,600)",[f.tenant,id]);await assert.rejects(f.reserve('apply',{id}),/REPLAY_MISMATCH/);
 },{available:1000});
 await check('exact GET allowlist, query/page caps and rollback before provider',async f=>{
  const b=await f.reserve('preview');const before=await f.status();
  for(const path of['/Payments','/Invoices/'+randomUUID()+'?unitdp=4','/Invoices?page=12&pageSize=1000&order=InvoiceID+ASC&includeArchived=true&unitdp=4&summaryOnly=false','/Accounts?where=x','/Invoices?page=1&pageSize=1000&order=InvoiceID+ASC&includeArchived=true&unitdp=4&summaryOnly=false&where=x'])await assert.rejects(f.admit(b,path),/REQUEST_INVALID/);
  assert.equal((await f.status()).availableCalls,before.availableCalls);
  for(const path of['/Invoices?page=1&pageSize=1000&order=InvoiceID+ASC&includeArchived=true&unitdp=4&summaryOnly=false','/Contacts?includeArchived=true&order=ContactID+ASC&page=1&pageSize=1000','/CreditNotes?page=1&pageSize=1000&order=CreditNoteID+ASC&includeArchived=true&unitdp=4','/Accounts','/TaxRates',f.detail(f.ids[0])]){const r=await f.admit(b,path);await f.observe(r);await assert.rejects(f.admit(b,path),/REQUEST_INVALID/);}
  for(let i=0;i<2;i++){const r=await f.admit(b,'/Organisations');await f.observe(r);}await assert.rejects(f.admit(b,'/Organisations'),/REQUEST_INVALID/);
  await assert.rejects(f.admit(b,f.detail(f.ids[0]),{phase:'verification'}),/REQUEST_INVALID/);
 });
 await check('planned exact POST, status binding floor0 and journal verification',async f=>{
  const b=await f.reserve(),c=await f.claim();await f.bind(c,b);
  const payload={Invoices:[{InvoiceID:f.ids[0],Status:'AUTHORISED'}]};
  await assert.rejects(f.admit(b,f.detail(f.ids[0]),{id:f.request.requestId,method:'POST',payload:{Invoices:[{...payload.Invoices[0],Total:1}]}}),/REQUEST_INVALID/);
  await assert.rejects(f.admit(b,f.detail(f.ids[0]),{method:'POST',payload}),/REQUEST_INVALID/);
  const before=await f.snapshot();
  const r=await f.admit(b,f.detail(f.ids[0]),{id:f.request.requestId,method:'POST',payload});await f.observe(r,503,true);
  await new Promise(r=>setTimeout(r,3));
  const v=await f.admit(b,f.detail(f.ids[0]),{phase:'verification'});await f.observe(v);
  const e=await db.query('select count(*) n from public.xero_existing_draft_quota_requests_v1 where claim_id=$1',[c.id]);assert.equal(Number(e.rows[0].n),2);
  await f.release(b.id);assert.equal((await f.status()).reservedCalls,1);
  const observed={...f.before,Status:'AUTHORISED'},verification={requestId:v.requestId,budgetId:b.id,tokenVersion:1};
  const completed=await f.finish(c,'confirmed',observed,verification);assert.equal(completed.status,'confirmed');
  const replay=await f.finish(c,'confirmed',observed,verification);assert.equal(replay.id,completed.id);
  const after=await f.snapshot();assert.equal(after.events.length,1);assert.equal(after.mappings[0].xero_status,'AUTHORISED');assert.equal(after.items[0].status,'updated');
  const protectedMapping=m=>Object.fromEntries(Object.entries(m).filter(([k])=>!['xero_status','updated_at','last_reconciled_at'].includes(k)));
  assert.ok(JSON.stringify(protectedMapping(before.mappings[0]))===JSON.stringify(protectedMapping(after.mappings[0])),'Protected mapping facts remain identical');
  assert.equal(after.events[0].receipt.authorisations,1);assert.equal(after.events[0].receipt.payments,0);assert.equal(after.events[0].receipt.lineChanges,0);
  assert.equal((await db.query('select outcome_unknown unknown from public.xero_shared_requests where id=$1',[r.requestId])).rows[0].unknown,false);
  await f.policy();assert.equal((await f.status()).reservedCalls,0,'Terminal claim orphan escrow is retired');
 });
 await check('per-target verification cannot consume sibling entitlement',async f=>{
  const b=await f.reserve(),c=await f.claim();await f.bind(c,b);
  for(let i=0;i<2;i++){const r=await f.admit(b,f.detail(f.ids[0]),{phase:'verification'});await f.observe(r);}
  await assert.rejects(f.admit(b,f.detail(f.ids[0]),{phase:'verification'}),/REQUEST_INVALID/);
  assert.equal((await db.query('select verification_remaining n from public.xero_shared_budgets where id=$1',[b.id])).rows[0].n,2);
  await assert.rejects(f.admit(b,f.detail(f.ids[1]),{phase:'verification'}),/REQUEST_INVALID/);
 },{second:true});
 await check('release preserves uncertain claim only, recovery moves exact escrow',async f=>{
  const b=await f.reserve(),c=await f.claim();await f.bind(c,b);
  const payload={Invoices:[{InvoiceID:f.ids[0],Status:'AUTHORISED'}]},r=await f.admit(b,f.detail(f.ids[0]),{id:f.request.requestId,method:'POST',payload});await f.observe(r,503,true);
  const v=await f.admit(b,f.detail(f.ids[0]),{phase:'verification'});await f.observe(v);
  await f.release(b.id);assert.equal((await f.status()).reservedCalls,1);await f.release(b.id);assert.equal((await f.status()).reservedCalls,1);
  const recovery=await f.reserve('recovery',{claimId:c.id,targetIds:[f.ids[0]]});assert.equal(recovery.operationCalls,0);assert.equal(recovery.verificationCalls,1);assert.equal((await f.status()).reservedCalls,1);
  await assert.rejects(f.admit(recovery,'/Organisations',{phase:'verification'}),/REQUEST_INVALID/);
  await assert.rejects(f.admit(recovery,f.detail(f.ids[0]),{id:randomUUID(),method:'POST',payload}),/REQUEST_INVALID/);
  const read=await f.admit(recovery,f.detail(f.ids[0]),{phase:'verification'});await f.observe(read);
  assert.equal((await db.query('select public.xero_shared_resolve_unknown($1,$2,$3,$4) ok',[f.tenant,r.requestId,read.requestId,'scoped-test-journal'])).rows[0].ok,true);
  await f.release(recovery.id);assert.equal((await f.status()).reservedCalls,0);await assert.rejects(f.reserve('recovery',{claimId:c.id,targetIds:[f.ids[0]]}),/ESCROW_EXHAUSTED/);
 },{second:true});
 await check('crash without release retains capacity beyond execution deadline',async f=>{
  const b=await f.reserve(),c=await f.claim();await f.expireExecution(b);
  assert.equal((await f.status()).reservedCalls,31);
  await assert.rejects(f.admit(b,'/Organisations'),/BUDGET_EXHAUSTED/);await assert.rejects(f.bind(c,b),/BINDING_INVALID/);
  await f.policy();assert.equal((await f.status()).reservedCalls,2);
  const recovery=await f.reserve('recovery',{claimId:c.id});assert.equal(recovery.operationCalls,0);assert.equal(recovery.verificationCalls,2);await f.bind(c,recovery);
  const r=await f.admit(recovery,f.detail(f.ids[0]),{phase:'verification'});await f.observe(r);
  const rejected=await f.finish(c,'rejected',f.before,{requestId:r.requestId,budgetId:recovery.id,tokenVersion:1});assert.equal(rejected.status,'rejected');assert.equal(rejected.receipt.authorisations,0);
  const state=await f.snapshot();assert.equal(state.mappings[0].xero_status,'DRAFT');assert.equal(state.events.length,1);await f.release(recovery.id);assert.equal((await f.status()).reservedCalls,0);
 });
 await check('expired grant normal policy cannot start exception operation',async f=>{assert.equal((await f.policy()).reserveFloor,200);await assert.rejects(f.reserve(),/RESERVE_PROTECTED/);},{grantLifetime:-1});
 await check('owner appends non-overlapping renewal without changing financial approval',async f=>{
  await db.exec('reset role');const id=randomUUID();
  await db.query("insert into public.xero_existing_draft_quota_grants_v1 select $1,tenant_id,actor_id,actor_email,human_approval_sha256,reserve_intent_sha256,clock_timestamp(),clock_timestamp()+interval '1 hour' from public.xero_existing_draft_quota_grants_v1 where id=$2",[id,f.grantId]);
  await assert.rejects(db.query("insert into public.xero_existing_draft_quota_grants_v1 select $1,tenant_id,actor_id,actor_email,human_approval_sha256,reserve_intent_sha256,clock_timestamp(),clock_timestamp()+interval '1 hour' from public.xero_existing_draft_quota_grants_v1 where id=$2",[randomUUID(),id]),/GRANT_OVERLAP/);
  await assert.rejects(db.query("insert into public.xero_existing_draft_quota_grants_v1 select $1,tenant_id,actor_id,actor_email,'invalid',reserve_intent_sha256,clock_timestamp()+interval '2 hours',clock_timestamp()+interval '3 hours' from public.xero_existing_draft_quota_grants_v1 where id=$2",[randomUUID(),id]),/check constraint/);
  await db.exec('set role service_role');const p=await f.policy();assert.equal(p.reserveFloor,0);assert.equal(p.grantId,id);
 },{grantLifetime:-1});
 await check('grant expiry after binding deniesPOST but retains exact recovery',async f=>{
  const b=await f.reserve(),c=await f.claim();await f.bind(c,b);await new Promise(r=>setTimeout(r,1100));
  await assert.rejects(f.admit(b,f.detail(f.ids[0]),{id:f.request.requestId,method:'POST',payload:{Invoices:[{InvoiceID:f.ids[0],Status:'AUTHORISED'}]}}),/GRANT_EXPIRED/);
  await f.release(b.id);assert.equal((await f.status()).reservedCalls,2);assert.equal((await f.policy()).reserveFloor,200);
  const r=await f.reserve('recovery',{claimId:c.id});assert.equal(r.reserveFloor,0);const read=await f.admit(r,f.detail(f.ids[0]),{phase:'verification'});await f.observe(read);
 },{grantLifetime:1});
 await check('new financial intent denied after grant expiry',async f=>{
  await f.reserve();await new Promise(r=>setTimeout(r,1100));await assert.rejects(f.claim(),/GRANT_EXPIRED/);
  assert.equal(Number((await db.query('select count(*) n from public.xero_existing_draft_authorisation_claims')).rows[0].n),0);
 },{grantLifetime:1});
 await check('unknown write blocksPOST while claim verification GET remains permitted',async f=>{
  const b=await f.reserve(),c=await f.claim();await f.bind(c,b);const foreign=randomUUID();
  await db.query("insert into public.xero_shared_requests(id,tenant_id,token_version,method,resource_key,phase,state,outcome_unknown,deadline_at) values($1,$2,1,'GET','Invoices','operation','unknown',false,clock_timestamp())",[foreign,f.tenant]);
  await db.query("update public.xero_shared_requests set method='POST',outcome_unknown=true where id=$1",[foreign]);
  await assert.rejects(f.admit(b,f.detail(f.ids[0]),{id:f.request.requestId,method:'POST',payload:{Invoices:[{InvoiceID:f.ids[0],Status:'AUTHORISED'}]}}),/WRITE_OUTCOME_UNRESOLVED/);
  const r=await f.admit(b,f.detail(f.ids[0]),{phase:'verification'});await f.observe(r);
 });
 await check('capacity cannot spend reserved verification or another budget',async f=>{
  const b=await f.reserve(),before=await f.status();await db.query('update public.xero_shared_tenant_control set available_calls=30 where tenant_id=$1',[f.tenant]);
  await assert.rejects(f.admit(b,'/Accounts'),/RESERVE_PROTECTED/);
  assert.equal((await db.query('select operation_remaining n from public.xero_shared_budgets where id=$1',[b.id])).rows[0].n,29);assert.equal((await f.status()).reservedCalls,before.reservedCalls);
 });
 await check('provider allowance/deadline/version/concurrency limits remain enforced',async f=>{
  const b=await f.reserve();await assert.rejects(f.admit(b,'/Accounts',{version:2}),/CONNECTION_CHANGED/);
  await db.query("update public.xero_shared_tenant_control set retry_at=clock_timestamp()+interval '1 minute' where tenant_id=$1",[f.tenant]);await assert.rejects(f.admit(b,'/Accounts'),/RETRY_DEADLINE/);
  await db.query('update public.xero_shared_tenant_control set retry_at=null,daily_hold=true where tenant_id=$1',[f.tenant]);await assert.rejects(f.admit(b,'/Accounts'),/ALLOWANCE_UNKNOWN/);
  await db.query('update public.xero_shared_tenant_control set daily_hold=false where tenant_id=$1',[f.tenant]);const a=await f.admit(b,'/Accounts'),tax=await f.admit(b,'/TaxRates');await assert.rejects(f.admit(b,'/Organisations'),/INFLIGHT_LIMIT/);await f.observe(a);await f.observe(tax);
  await db.query("insert into public.xero_shared_requests(id,tenant_id,token_version,method,resource_key,phase,state,deadline_at) select gen_random_uuid(),$1,1,'GET','Accounts','operation','complete',clock_timestamp() from generate_series(1,43)",[f.tenant]);await assert.rejects(f.admit(b,'/Organisations'),/MINUTE_LIMIT/);
 });
 if(native)await t.test('independent connections serialize reservations and reject tenant lock inversion',async()=>{
  const f=await quotaFixture(db,{available:31});const other=await h.connectOther();await db.exec('set role service_role');await other.query('set role service_role');
  const sql='select public.xero_existing_draft_quota_reserve_v1($1,$2,$3,$4,$5::uuid[],\'apply\',$6,null,600) result',values=id=>[f.tenant,id,f.actor.id,f.actor.email,f.ids,f.runId];
  const results=await Promise.allSettled([db.query(sql,values(randomUUID())),other.query(sql,values(randomUUID()))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  await other.query('begin');await other.query("select pg_advisory_xact_lock(hashtextextended('xero.shared.'||$1,0))",[f.tenant]);await assert.rejects(f.policy(),/Active tenant admission/);await other.query('rollback');await db.exec('reset role');
 });
});

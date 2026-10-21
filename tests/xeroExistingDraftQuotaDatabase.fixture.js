import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {statusDatabase,seedStatus} from './xeroExistingDraftAuthorisationDatabase.fixture.js';
export const migration='20261006120000_xero_existing_draft_quota_exception_v1.sql';
export async function quotaDatabase(t,native){
 const h=await statusDatabase(t,native),raw=h.db;
 // Never include a private seed, SQL parameters or failing row in test output.
 const safe=async fn=>{try{return await fn();}catch(e){throw Object.assign(new Error(e.message),{code:e.code});}};
 const db={query:(...args)=>safe(()=>raw.query(...args)),exec:sql=>safe(()=>raw.exec(sql))};
 await db.exec("alter table public.user_profiles add column email text,add column active boolean not null default true;");
 await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 return {...h,db};
}
export async function quotaFixture(db,{grant=true,available=100,grantLifetime=3600,second=false}={}){
 const f=await seedStatus(db),tenant=f.approved.tenant_id,actor=f.actor;
 await db.query('update public.user_profiles set email=$2 where id=$1',[actor.id,actor.email]);
 await db.query('insert into public.xero_shared_tenant_control(tenant_id,allowance_known,available_calls) values($1,true,$2)',[tenant,available]);
 const grantId=randomUUID();
 if(grant)await db.query("insert into public.xero_existing_draft_quota_grants_v1(id,tenant_id,actor_id,actor_email,human_approval_sha256,reserve_intent_sha256,created_at,expires_at) values($1,$2,$3,$4,'f6ec43c03822df879641eabbfd98d1340841ef5f102bc2e720a0576ea273d004','7d2008f645eeb9219e3af1480c4088cc1d81dec8253f27b3c7fbdae9e419e9ed',clock_timestamp()-interval '2000 seconds',clock_timestamp()+make_interval(secs=>$5))",[grantId,tenant,actor.id,actor.email,grantLifetime]);
 const ids=[f.approved.target_id];let other;
 if(second){
  const a=(await db.query('select to_jsonb(a) row from public.xero_existing_draft_authorisation_approved_records a where target_id<>$1 order by target_id limit 1',[ids[0]])).rows[0].row;
  other=structuredClone(f.item);other.id=randomUUID();other.row_index=1;other.row_key='quota-sibling';other.idempotency_key=f.runId+':'+other.id;other.xero_document_id=a.target_id;other.source_object=a.source_object;other.source_id=a.source_id;
  await db.query("insert into public.xero_financial_sync_items select * from jsonb_populate_record(null::public.xero_financial_sync_items,$1::jsonb)",[JSON.stringify({...other,proposed_payload:'PLACEHOLDER'})]);
  await db.query("update public.xero_financial_sync_items set proposed_payload='null'::jsonb where id=$1",[other.id]);ids.push(a.target_id);
 }
 const policy=(targetIds=ids)=>(db.query('select public.xero_existing_draft_quota_policy_v1($1,$2,$3,$4::uuid[]) result',[tenant,actor.id,actor.email,targetIds])).then(r=>r.rows[0].result);
 const reserve=(mode='apply',{id=randomUUID(),targetIds=ids,ttl=600,claimId=null}={})=>(db.query('select public.xero_existing_draft_quota_reserve_v1($1,$2,$3,$4,$5::uuid[],$6,$7,$8,$9) result',[tenant,id,actor.id,actor.email,targetIds,mode,mode==='preview'?null:f.runId,claimId,ttl])).then(r=>r.rows[0].result);
 const release=(id)=>(db.query('select public.xero_existing_draft_quota_release_v1($1,$2,$3,$4,$5) result',[tenant,id,actor.id,actor.email,'Focused test release'])).then(r=>r.rows[0].result);
 const admit=(budget,path,{id=randomUUID(),method='GET',phase='operation',payload=null,version=1}={})=>(db.query('select public.xero_shared_admit_scoped_v1($1,$2,$3,$4,$5,$6,$7,null,$8,$9::jsonb) result',[tenant,id,version,method,path.match(/^\/([A-Za-z]+)/)?.[1]||'Invalid',budget.id,phase,path,payload===null?null:JSON.stringify(payload)])).then(r=>r.rows[0].result);
 const observe=(r,status=200,unknown=false)=>db.query("select public.xero_shared_observe($1,$2,$3,'{}'::jsonb,$4)",[tenant,r.requestId,status,unknown]);
 const status=()=>db.query('select public.xero_shared_status($1) result',[tenant]).then(r=>r.rows[0].result);
 const bind=(c,budget)=>{f.request.budgetId=budget.id;return db.query('select public.bind_xero_existing_draft_authorisation_request_v1($1,$2,$3,1,$4,$5) result',[c.id,f.request.requestId,budget.id,actor.id,actor.email]).then(r=>r.rows[0].result);};
 const detail=id=>'/Invoices/'+id+'?unitdp=4';
 // Owner-only synthetic time shift simulates elapsed600s without a real wait.
 const expireExecution=async budget=>{await db.exec('reset role;alter table public.xero_existing_draft_quota_scopes_v1 disable trigger quota_immutable;alter table public.xero_existing_draft_authorisation_claims disable trigger existing_draft_immutable');await db.query("update public.xero_existing_draft_quota_scopes_v1 set created_at=created_at-interval '601 seconds' where budget_id=$1",[budget.id]);await db.query("update public.xero_existing_draft_authorisation_claims set created_at=created_at-interval '601 seconds' where run_id=$1",[f.runId]);await db.exec('alter table public.xero_existing_draft_quota_scopes_v1 enable trigger quota_immutable;alter table public.xero_existing_draft_authorisation_claims enable trigger existing_draft_immutable;set role service_role');};
 return {...f,tenant,actor,grantId,ids,other,policy,reserve,release,admit,observe,status,bind,detail,expireExecution};
}

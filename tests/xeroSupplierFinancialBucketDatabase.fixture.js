import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import net from 'node:net';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';

const migrationName='20261111155103_xero_supplier_financial_bucket_link_v1.sql';
const policy='supplier_financial_bucket_preserve_v1';
const sha=value=>createHash('sha256').update(value).digest('hex');
const migrations=['20260827145608_xero_contact_sync.sql','20260829080726_xero_financial_sync.sql','20260923210832_xero_financial_selection_scope.sql','20260923213339_xero_payment_reference_link.sql','20260923222821_xero_grouped_preservation_link.sql','20260927175805_xero_issued_supplier_preservation_link.sql','20260927185526_xero_issued_petroleum_preservation_link.sql','20260927213024_xero_petroleum_inactive_source_ownership.sql','20260928033217_xero_issued_petroleum_attachment_preservation_v2.sql','20260928053229_xero_document_field_correction_journal.sql','20261111155100_xero_aggregate_supplier_preservation_v3.sql','20261111155101_xero_aggregate_supplier_component_literals_v3.sql','20261111155102_xero_settled_supplier_ledger_assert_v1.sql',migrationName];

export async function financialDatabase(t,native){
  let client,engine,connectOther;
  if(!native){
    engine=new PGlite();client={query:(sql,params)=>engine.query(sql,params),exec:sql=>engine.exec(sql)};
    t.after(()=>engine.close());
  }else{
    const bin='/opt/homebrew/opt/postgresql@17/bin/',executable=await realpath(bin+'postgres');
    const directory=await mkdtemp('/private/tmp/fcos-financial-bucket-pg17-');
    const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
    const calls=[],clients=[];let started=false;
    const run=(name,args,expected=0)=>{const at=new Date().toISOString(),result=spawnSync(bin+name,args,{encoding:'utf8'});calls.push({command:[bin+name,...args],at,exitCode:result.status,outputSha256:sha((result.stdout||'')+(result.stderr||''))});assert.equal(result.status,expected,result.stderr||result.stdout);return result.stdout;};
    t.after(async()=>{
      for(const c of clients){await c.query('rollback').catch(()=>{});await c.end();}
      if(started){
        const pid=(await readFile(directory+'/postmaster.pid','utf8')).split('\n')[0];
        const ps=spawnSync('ps',['-p',pid,'-o','command='],{encoding:'utf8'});
        assert.equal(ps.status,0);assert.ok(ps.stdout.trim().startsWith(executable+' -D '+directory+' '),'Only exact task-owned server may stop');
        run('pg_ctl',['-D',directory,'stop','-m','fast']);run('pg_ctl',['-D',directory,'status'],3);
      }
      if(process.env.FCOS_FINANCIAL_BUCKET_OUTPUT_DIR)await writeFile(process.env.FCOS_FINANCIAL_BUCKET_OUTPUT_DIR+'/native-cleanup.json',JSON.stringify({directory,port,taskOwned:true,stopped:started,calls},null,2)+'\n');
    });
    assert.match(run('postgres',['--version']),/PostgreSQL\) 17\.11/);
    run('initdb',['-D',directory,'-U','postgres','--auth=trust','--locale=C','--encoding=UTF8','--no-instructions']);
    run('pg_ctl',['-D',directory,'-l',directory+'/server.log','-o',`-F -p ${port} -h '' -k ${directory} -c max_connections=10`,'start','-w']);started=true;
    connectOther=async()=>{const c=new pg.Client({host:directory,port,user:'postgres',database:'postgres',application_name:'fcos_financial_bucket_'+randomUUID()});await c.connect();clients.push(c);await c.query("set statement_timeout='30s';set lock_timeout='5s'");return c;};
    client=await connectOther();assert.match((await client.query('show server_version')).rows[0].server_version,/^17\.11/);
  }
  let transaction=false;
  const exec=sql=>client.exec?client.exec(sql):client.query(sql);
  const query=async(sql,params)=>{
    if(!transaction)return client.query(sql,params);
    await exec('savepoint financial_fixture');
    try{const r=await client.query(sql,params);await exec('release savepoint financial_fixture');return r;}
    catch(error){await exec('rollback to savepoint financial_fixture;release savepoint financial_fixture');throw error;}
  };
  await exec('create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;create table public.user_profiles(id uuid primary key);');
  const load=async name=>exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/^create extension if not exists pgcrypto;$/m,''));
  await load('20260707163000_dispute_beta_workflow.sql');for(const name of migrations)await load(name);
  await exec("set statement_timeout='30s';set lock_timeout='5s'");
  return{db:{exec,query},connectOther,setTransaction:value=>{transaction=value;}};
}

// Hash-pinned complete synthetic proofs from the reviewed pure implementation.
// They are NOT current/provider evidence or financial approval.
import {issuedSupplierCanonical as canonical,issuedSupplierHash as hash} from '../api/_xeroIssuedSupplierPreservation.js';
const rpc='select public.link_xero_financial_bucket_document_v1($1,$2,$3,$4,$5,$6::jsonb,$7,$8) result';
function reviewFor(evidence,localClaimScope){
 return{policyVersion:policy,fingerprint:hash(evidence),evidenceFingerprint:hash(evidence),approvalMaterialHash:hash({policyVersion:policy,evidence,localClaimScope}),reviewFingerprint:hash('synthetic-financial-review'),legacyReviewFingerprint:hash('synthetic-legacy-review'),evidence,accountingCanonical:canonical(evidence),evidenceCanonical:canonical(evidence),localClaimScope,localClaimScopeCanonical:canonical(localClaimScope)};
}
// Seed the disposable database from fresh synthetic proof.
export async function seedFinancialWithFixture(db,f,{mutate=()=>{},processing=true}={}){
 mutate(f.proof.evidence,f.proof.localClaimScope);
 const a=f.proof.evidence.accounting,review={...reviewFor(f.proof.evidence,f.proof.localClaimScope),reviewFingerprint:f.review.reviewFingerprint,legacyReviewFingerprint:f.review.legacyReviewFingerprint},actor={id:a.identity.selection.reviewedBy,email:'finance@example.test'};
 const source={...structuredClone(a.source.sourcePayload),supplierFinancialReview:review,supplierFinancialPreservation:{policyVersion:policy,proofValid:true,workflowEligible:false,approvalGranted:false,accepted:false,documentVerification:'UNVERIFIED'}};
 const runId=randomUUID(),itemId=randomUUID(),at=new Date().toISOString();
 await db.query("insert into public.xero_contact_sync_connections(tenant_id,refresh_token) values($1,'synthetic-only')",[a.tenantId]);
 for(const m of a.productMappings)await db.query('insert into public.xero_financial_product_mappings(id,direction,salesforce_product_id,salesforce_product_name,xero_account_code,xero_tax_type,enabled,revision,approved_by,approved_by_email,approved_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[m.id,m.direction,m.salesforce_product_id,'synthetic product',m.xero_account_code,m.xero_tax_type,m.enabled,m.revision,m.approved_by,m.approved_by_email,m.approved_at]);
 if(processing){
   await db.query(`insert into public.xero_financial_sync_runs(id,idempotency_key,mode,status,revision,created_by,created_by_email,reviewed_by,reviewed_by_email,reviewed_at,control_totals) values($1::uuid,$1::uuid::text,'preview','processing',3,$2,$3,$2,$3,$4,$5)`,[runId,actor.id,actor.email,at,JSON.stringify({preservationPolicy:policy,workflowSnapshot:{tenantId:a.tenantId,includePayments:false}})]);
   await db.query(`insert into public.xero_financial_sync_items(id,run_id,row_index,row_key,source_object,source_id,source_type,source_document_number,currency,source_total,proposed_action,status,selected,source_payload,xero_payload,proposed_payload,xero_document_id,xero_document_status,idempotency_key,updated_at) values($1::uuid,$2,0,$1::uuid::text,'Supplier_Invoice__c',$3,'supplier_bill',$4,'USD',$5,'protected_legacy','selected',true,$6,$7,'null'::jsonb,$8,$9,$1::uuid::text,$10)`,[itemId,runId,a.sourceId,a.source.parent.Name,a.source.parent.Invoice_Amount__c,JSON.stringify(source),JSON.stringify(a.target),a.targetId,a.target.Status,at]);
 }
 const values=(overrides={})=>[runId,3,itemId,at,a.tenantId,JSON.stringify(review),actor.id,actor.email].map((v,i)=>Object.hasOwn(overrides,i)?overrides[i]:v);
 const link=async overrides=>(await db.query(rpc,values(overrides))).rows[0].result;
 const snapshot=async()=>(await db.query(`select (select jsonb_agg(to_jsonb(m) order by id) from public.xero_financial_document_mappings m) mappings,(select jsonb_agg(to_jsonb(i) order by id) from public.xero_financial_sync_items i) items,(select jsonb_agg(to_jsonb(a) order by id) from public.xero_financial_audit_events a) audits,(select jsonb_agg(to_jsonb(p) order by id) from public.xero_financial_payment_mappings p) payments,(select jsonb_agg(to_jsonb(r) order by id) from public.xero_financial_sync_runs r) runs`)).rows[0];
 return{...f,a,review,source,actor,runId,itemId,at,values,link,snapshot};
}

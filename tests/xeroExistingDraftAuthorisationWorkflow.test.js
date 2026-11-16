import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { draftFixture, draftFixtureAvailable } from './xeroExistingDraftAuthorisation.fixture.js';
import { previewEvidenceHash as hash } from '../api/_xeroPreviewPersistence.js';
import { buildExistingDraftAuthorisationEvidence, existingDraftAuthorisationHash } from '../api/_xeroExistingDraftAuthorisationPolicy.js';
import { existingDraftAuthorisationPreview as preview, existingDraftAuthorisationRead as read, existingDraftAuthorisationApply as apply, existingDraftAuthorisationRecover as recover } from '../api/_xeroExistingDraftAuthorisation.js';
import { existingDraftAuthorisationForecast, collectExistingDraftAuthorisation, readExistingDraftDetail } from '../api/_xeroExistingDraftAuthorisationCollector.js';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';
const copy=v=>JSON.parse(JSON.stringify(v));
const privateTest=(name,fn)=>test(name,{skip:!draftFixtureAvailable},fn);
function harness(){
 const f=draftFixture(),actor=f.actor,controls={},calls=[],tables={xero_financial_sync_runs:[],xero_financial_sync_items:[],xero_financial_audit_events:[],xero_shared_requests:[],xero_existing_draft_authorisation_claims:[]},captures=new WeakMap();let collections=0,currentTarget=copy(f.input.before);
 const client={from(table){const filters=[];let order,limit=Infinity;const result=()=>{let rows=(tables[table]||[]).filter(r=>filters.every(([k,v])=>r[k]===v));if(order)rows=[...rows].sort((a,b)=>a[order]-b[order]);return{data:copy(rows.slice(0,limit)),error:null};};const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(k){order=k;return q;},limit(n){limit=n;return q;},async maybeSingle(){const r=result();return{data:r.data.length===1?r.data[0]:null,error:null};},then(a,b){return Promise.resolve(result()).then(a,b);}};return q;},async rpc(name,p){calls.push({type:'rpc',name});if(name==='persist_xero_existing_draft_authorisation_preview_v1'){
 const run=copy(p.p_run),items=copy(p.p_items);run.status='ready_for_review';run.control_totals.workflowSnapshot.existingDraftPreviewPayloadHash=hash({run:p.p_run,items:p.p_items,reviewIdentity:p.p_review_identity});
 for(const k of ['created_at','updated_at','source_snapshot_at','xero_snapshot_at'])run[k]=run[k].replace(/Z$/,'+00:00');
 for(const item of items)for(const k of ['created_at','updated_at'])item[k]=item[k].replace(/Z$/,'+00:00');
 tables.xero_financial_sync_runs.push(run);tables.xero_financial_sync_items.push(...items);tables.xero_financial_audit_events.push({run_id:run.id,event_type:'existing_draft_authorisation_preview_published',outcome:'success',actor_id:actor.id,actor_email:actor.email,fingerprints:{payloadHash:run.control_totals.workflowSnapshot.existingDraftPreviewPayloadHash,reviewIdentity:p.p_review_identity}});
 controls.afterPublication?.(run,items,tables);if(controls.lostPublish)throw Error('PRIVATE_LOST_RESPONSE');return{data:{run:copy(run),items:copy(items)},error:null};}
 const run=tables.xero_financial_sync_runs.find(r=>r.id===p.p_run_id);assert.ok(run);assert.equal(run.revision,p.p_expected_revision);
 if(name==='authorise_xero_financial_sync_run_v1'){Object.assign(run,{status:'authorised',revision:run.revision+1,reviewed_by:p.p_actor_id,reviewed_by_email:p.p_actor_email,reviewed_at:new Date().toISOString()});tables.xero_financial_sync_items.forEach(r=>{if(p.p_selected_item_ids.includes(r.id))Object.assign(r,{selected:true,status:'selected'});});}
 else if(name==='start_xero_financial_sync_run_v1')Object.assign(run,{status:'processing',revision:run.revision+1});
 else if(name==='finish_xero_financial_sync_run_v1')Object.assign(run,{status:p.p_status,revision:run.revision+1});else assert.fail(name);
 return{data:copy(run),error:null};}};
 const deps={client,accessContext:{profile:actor},env:{FCOS_ENABLE_XERO_FINANCIAL_SYNC:'true'},collect:async({targetIds},options)=>{
 collections++;const input=copy(f.input);controls.changeCurrent?.(input,collections);const proof=buildExistingDraftAuthorisationEvidence(input);
 const collection={complete:true,actorId:actor.id,tenantId:input.current.tenantId,targetIds:copy(targetIds),observedAt:new Date().toISOString(),scopeFingerprint:hash(input),forecast:existingDraftAuthorisationForecast(targetIds.length,options.applying),financialWrites:0};
 controls.changeCollection?.(collection);const receipts=[];captures.set(collection,{items:[{...input,selection:proof.evidence?.selection||input.selection}],connection:{tenantId:input.current.tenantId,tokenVersion:1},budget:{id:randomUUID()},receipts,guard(){},async recheck(){calls.push({type:'source-recheck'});if(controls.preflightChanged)throw Error('Changed source');},async release(){calls.push({type:'release'});},async read(_c,path){calls.push({type:'GET',path});receipts.push({requestId:randomUUID(),budgetId:randomUUID(),tokenVersion:1,path});if(controls.lockedChanged&&calls.filter(c=>c.type==='GET').length===1)return{Invoices:[{...copy(currentTarget),AmountPaid:1}]};return{Invoices:[copy(currentTarget)]};}});return collection;},privateEvidence:c=>captures.get(c),
 async claim(_c,p){calls.push({type:'claim',args:copy(p)});if(controls.claimRejected)throw Object.assign(Error('Busy intent'),{code:'DRAFT_AUTHORISATION_INTENT_REJECTED'});return{id:randomUUID(),alreadyClaimed:false};},async bind(_c,p){calls.push({type:'bind',args:copy(p)});},withBudget(_c,_p,fn){return fn();},
 async accountingFetch(_c,path,options){calls.push({type:'POST',path,options:copy(options)});tables.xero_shared_requests.push({id:options.requestId,tenant_id:f.input.current.tenantId,state:controls.definiteReject?'complete':controls.unknown?'unknown':'complete',response_status:controls.definiteReject?422:200});if(controls.definiteReject)throw Error('Provider rejected');if(!controls.unknown)currentTarget.Status='AUTHORISED';if(controls.lostPost){currentTarget.Status='AUTHORISED';throw Error('Lost POST response');}return{Invoices:[copy(currentTarget)]};},
 async finish(_c,p){calls.push({type:'journal',args:copy(p)});if(p.status==='confirmed'){const row=tables.xero_financial_sync_items[0];Object.assign(row,{status:'updated',xero_document_status:'AUTHORISED',mutation_attempts:1});}return{status:p.status};}};
 return{f,actor,tables,calls,controls,deps,async preview(){return preview({targetIds:[f.targetId]},deps);},body(v){return{runId:v.run.id,revision:v.run.revision,reviewed:true,selectedItemIds:v.rows.map(r=>r.id)};}};
}
const postCount=h=>h.calls.filter(c=>c.type==='POST').length;
const safeResult=v=>assert.ok(!JSON.stringify(v).includes('PRIVATE_SYNTHETIC_PROVIDER_IDENTITY'));
privateTest('status-only execution verifies original full detail and journals once without sending financial fields',async()=>{
 const h=harness(),v=await h.preview();assert.equal(v.summary.eligible,1);safeResult(v);const out=await apply(h.body(v),h.deps);assert.equal(out.financialWrites,1);assert.equal(out.run.status,'completed');safeResult(out);
 const post=h.calls.find(c=>c.type==='POST');assert.equal(post.path,`/Invoices/${h.f.targetId}?unitdp=4`);assert.deepEqual(post.options.body,{Invoices:[{InvoiceID:h.f.targetId,Status:'AUTHORISED'}]});assert.equal(post.options.transientRetryLimit,0);assert.equal(post.options.retryOnRateLimit,false);assert.equal(postCount(h),1);assert.equal(h.calls.filter(c=>c.type==='journal').length,1);assert.equal(h.calls.filter(c=>c.type==='GET').length,2);
});
privateTest('lost publication response recovers exact saved review; altered audit or controls is held',async()=>{
 const h=harness();h.controls.lostPublish=true;assert.equal((await h.preview()).run.status,'ready_for_review');assert.equal(h.calls.filter(c=>c.name==='persist_xero_existing_draft_authorisation_preview_v1').length,1);
 for(const change of [(run)=>{run.control_totals.postingMode='draft';},(_run,_items,tables)=>{tables.xero_financial_audit_events[0].fingerprints.payloadHash=hash('changed');}]){const held=harness();held.controls.afterPublication=change;await assert.rejects(held.preview());assert.equal(postCount(held),0);}
});
privateTest('changed current source and stale revision are held before approval or POST',async()=>{
 const h=harness(),v=await h.preview();await assert.rejects(apply({...h.body(v),revision:v.run.revision+1},h.deps));h.controls.changeCurrent=(input,count)=>{if(count>1)input.source.reference+=' CHANGED';};await assert.rejects(apply(h.body(v),h.deps));assert.equal(postCount(h),0);assert.equal(h.calls.filter(c=>c.name==='authorise_xero_financial_sync_run_v1').length,0);
});
privateTest('under-claim source or settlement change releases only never-sent intent with zero writes',async()=>{
 for(const flag of ['preflightChanged','lockedChanged']){const h=harness(),v=await h.preview();h.controls[flag]=true;const out=await apply(h.body(v),h.deps);assert.equal(out.financialWrites,0);assert.equal(out.run.status,'partial');assert.equal(postCount(h),0);assert.equal(h.calls.find(c=>c.type==='journal').args.status,'rejected');}
});
privateTest('lost POST response with exact authorised readback completes without resend',async()=>{const h=harness(),v=await h.preview();h.controls.lostPost=true;const out=await apply(h.body(v),h.deps);assert.equal(out.financialWrites,1);assert.equal(postCount(h),1);});
privateTest('ambiguous unchanged readback retains processing barrier and never retries POST',async()=>{const h=harness(),v=await h.preview();h.controls.unknown=true;await assert.rejects(apply(h.body(v),h.deps),e=>e.code==='XERO_DRAFT_STATUS_OUTCOME_UNCERTAIN');assert.equal(postCount(h),1);assert.equal(h.tables.xero_financial_sync_runs[0].status,'processing');await assert.rejects(apply({...h.body(v),revision:3},h.deps));assert.equal(postCount(h),1);});
privateTest('definitive provider rejection with unchanged readback records zero posted amounts',async()=>{const h=harness(),v=await h.preview();h.controls.definiteReject=true;const out=await apply(h.body(v),h.deps);assert.equal(out.financialWrites,0);assert.equal(out.run.status,'partial');assert.equal(h.calls.find(c=>c.type==='journal').args.status,'rejected');});
privateTest('HTTP evidence or extra flags and cross-user read are rejected',async()=>{const h=harness();await assert.rejects(preview({targetIds:[h.f.targetId],proof:{}},h.deps));assert.equal(h.calls.length,0);const v=await h.preview();await assert.rejects(apply({...h.body(v),approvalGranted:true},h.deps));await assert.rejects(read({runId:v.run.id},{...h.deps,accessContext:{profile:{id:randomUUID(),email:'other@example.com'}}}));assert.equal(postCount(h),0);});
test('forecast reserves whole cohort plus verification/recovery; oversized cohort cannot proceed',()=>{const f=existingDraftAuthorisationForecast(5,true);assert.equal(f.minimumAvailableCalls,255);assert.equal(f.maxConcurrent,2);assert.equal(f.automaticRetries,0);assert.throws(()=>existingDraftAuthorisationForecast(26,true));});
test('full target reader rejects incomplete pages, foreign or duplicate invoice identities',async()=>{const id=randomUUID();for(const data of [{Invoices:[]},{Invoices:[{InvoiceID:randomUUID()}]},{Invoices:[{InvoiceID:id},{InvoiceID:id}]},{Invoices:[{InvoiceID:id}],pagination:{page:1,pageCount:2,itemCount:2}}])await assert.rejects(readExistingDraftDetail({},id,async()=>data));});
test('unauthenticated collector does not touch storage or providers',async()=>{await assert.rejects(collectExistingDraftAuthorisation({targetIds:[randomUUID()]},{client:{from(){assert.fail('No storage read');}}}));});
test('dedicated authorisation handlers require uncached Finance access',()=>{for(const name of ['xeroExistingDraftAuthorisationPreview','xeroExistingDraftAuthorisationRead','xeroExistingDraftAuthorisationApply','xeroExistingDraftAuthorisationRecover']){const p=registeredHandlerBehavior(name);assert.equal(p.capability,'xero_portal_manage');assert.equal(p.cache,'none');assert.equal(p.mutation,!name.endsWith('Read'));}});

privateTest('definite zero-effect intent contention holds the row and closes run without POST or an orphan processing barrier',async()=>{const h=harness(),v=await h.preview();h.controls.claimRejected=true;const out=await apply(h.body(v),h.deps);assert.equal(out.financialWrites,0);assert.equal(out.run.status,'partial');assert.equal(postCount(h),0);assert.equal(h.calls.filter(c=>c.type==='bind'||c.type==='journal').length,0);});

privateTest('an interrupted unbound intent recovers through GET only and closes as never sent',async()=>{
 const h=harness(),v=await h.preview();const claimId=randomUUID();let result='intent',binding;
 h.deps.claim=async(_c,p)=>{const claim={id:claimId,run_id:p.runId,run_revision:p.expectedRunRevision,item_id:p.itemId,tenant_id:p.tenantId,
  idempotency_key:p.idempotencyKey,evidence:copy(p.evidence),evidence_hash:existingDraftAuthorisationHash(p.evidence),target_id:h.f.targetId,actor_id:h.actor.id,actor_email:h.actor.email};
  h.tables.xero_existing_draft_authorisation_claims.push(claim);return{...claim,alreadyClaimed:false};};
 h.deps.bind=async()=>{throw Error('Interrupted before request binding');};
 await assert.rejects(apply(h.body(v),h.deps),/Interrupted/);assert.equal(postCount(h),0);assert.equal(h.tables.xero_financial_sync_runs[0].status,'processing');
 h.deps.readOutcome=async()=>({claim:h.tables.xero_existing_draft_authorisation_claims[0],request:binding,status:result});
 h.deps.getConnection=async()=>({tenantId:h.f.input.current.tenantId,tokenVersion:1,expiresAt:new Date(Date.now()+3600000).toISOString()});
 h.deps.readStatus=async()=>assert.fail('Recovery must use durable escrow reservation, not a stale203-call local threshold');
 h.deps.reserveBudget=async(_c,p)=>{assert.equal(p.client,h.deps.client);assert.deepEqual(p.actor,h.actor);assert.equal(p.mode,'recovery');assert.equal(p.claimId,claimId);assert.deepEqual(p.targetIds,[h.f.targetId]);assert.equal(p.ttlSeconds,600);return{id:randomUUID(),reserveFloor:0};};h.deps.releaseBudget=async(_c,p)=>{assert.equal(p.client,h.deps.client);assert.deepEqual(p.actor,h.actor);};
 h.deps.bind=async(_c,p)=>{binding={request_id:p.requestId,budget_id:p.budgetId,token_version:p.tokenVersion};return binding;};
 h.deps.accountingFetch=async(_c,path,o)=>{assert.equal(o.method,'GET');h.calls.push({type:'GET',path});o.onResponse({requestId:randomUUID(),budgetId:o.budgetId,pathName:path,method:'GET',status:200});return{Invoices:[copy(h.f.input.before)]};};
 h.deps.finish=async(_c,p)=>{result=p.status;h.calls.push({type:'journal',args:copy(p)});};
 const outcome=await recover({claimId},h.deps);assert.equal(outcome.status,'rejected');assert.equal(outcome.financialWrites,0);assert.equal(postCount(h),0);assert.equal(h.tables.xero_financial_sync_runs[0].status,'partial');
 const gets=h.calls.filter(c=>c.type==='GET').length;assert.equal((await recover({claimId},h.deps)).status,'rejected');assert.equal(h.calls.filter(c=>c.type==='GET').length,gets);
});

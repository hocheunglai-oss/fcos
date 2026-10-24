import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { financialFixture, hash } from './xeroSupplierFinancialBucketPreservation.fixture.js';
import { evaluateSupplierFinancialBucketPreservation } from '../api/_xeroSupplierFinancialBucketPreservation.js';
import { financialDatabase, seedFinancialWithFixture, reviewFor } from './xeroSupplierFinancialBucketDatabase.fixture.js';
import { verifyExistingDraftExecutionGate, invokeExistingDraftAction } from '../src/lib/xeroExistingDraftExecutionGate.js';
import { xeroAccountingFetch } from '../api/_xeroContactSync.js';
import { fixtureXeroConnection } from './helpers/xeroSharedControl.js';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';

const auth = () => ({ user: { id: 'operator', active: true, read_only_ci: false }, moduleAccess: { xero_portal: true }, capabilities: { xero_portal_manage: true }, deploymentCapabilities: { mutationsAllowed: true } });
const portal = () => ({ externalActions: { xero_financial_sync: { enabled: true } }, xero: { connected: true, scopeFlags: { invoices: true, contacts: true, paymentsRead: true, settingsRead: true } } });
test('each dedicated mutation obtains fresh user, ACL, deployment and portal gate before action; reads do not refresh Xero', async () => {
  const calls = []; const invoke = async (name, payload, options) => { calls.push({ name, payload, options }); return { data: name === 'authContext' ? auth() : name === 'xeroPortalStatus' ? portal() : { accepted: true } }; };
  const gate = () => verifyExistingDraftExecutionGate(invoke, 'operator');
  for (const name of ['xeroExistingDraftAuthorisationPreview','xeroExistingDraftAuthorisationApply','xeroExistingDraftAuthorisationRecover']) await invokeExistingDraftAction(invoke, gate, name, { exact: name });
  assert.deepEqual(calls.map(c => c.name), ['authContext','xeroPortalStatus','xeroExistingDraftAuthorisationPreview','authContext','xeroPortalStatus','xeroExistingDraftAuthorisationApply','authContext','xeroPortalStatus','xeroExistingDraftAuthorisationRecover']);
  assert.ok(calls.every(c => c.options.force === true && c.options.cache === false && c.options.invalidateCache === true));
  assert.ok(calls.filter(c => c.name === 'xeroPortalStatus').every(c => c.payload.forceRefresh === false));
  calls.length = 0; await invokeExistingDraftAction(invoke, gate, 'xeroExistingDraftAuthorisationApprovedScope'); assert.deepEqual(calls.map(c => c.name), ['xeroExistingDraftAuthorisationApprovedScope']);
});
test('revoked identity, management access, readonly deployment and disabled connection gate admit zero mutations', async () => {
  const changes = [a=>a.user.id='foreign',a=>a.user.active=false,a=>a.user.read_only_ci=true,a=>a.moduleAccess.xero_portal=false,a=>a.capabilities.xero_portal_manage=false,a=>a.deploymentCapabilities.mutationsAllowed=false];
  for (const change of changes) { const a=auth();change(a);const calls=[];const invoke=async name=>{calls.push(name);return {data:name==='authContext'?a:portal()};}; await assert.rejects(invokeExistingDraftAction(invoke,()=>verifyExistingDraftExecutionGate(invoke,'operator'),'xeroExistingDraftAuthorisationApply')); assert.deepEqual(calls,['authContext']); }
  for (const change of [p=>p.externalActions.xero_financial_sync.enabled=false,p=>p.xero.connected=false,p=>p.xero.refreshError='expired',p=>p.xero.scopeFlags.paymentsRead=false]) { const p=portal();change(p);const calls=[];const invoke=async name=>{calls.push(name);return {data:name==='authContext'?auth():p};};await assert.rejects(invokeExistingDraftAction(invoke,()=>verifyExistingDraftExecutionGate(invoke,'operator'),'xeroExistingDraftAuthorisationApply'));assert.deepEqual(calls,['authContext','xeroPortalStatus']); }
  await assert.rejects(invokeExistingDraftAction(()=>assert.fail('no transport'),null,'xeroExistingDraftAuthorisationApply'));
  await assert.rejects(invokeExistingDraftAction(()=>assert.fail('no transport'),null,'xeroFinancialSyncApply'));
});
test('explicit zero transient retries keeps a failed GET to one admitted request and rejects invalid retry controls', async () => {
  const connection=fixtureXeroConnection({accessToken:'synthetic',tenantId:'synthetic'});let calls=0;
  await assert.rejects(xeroAccountingFetch(connection,'/Contacts',{method:'GET',transientRetryLimit:0,env:{XERO_TRANSIENT_RETRY_LIMIT:'2'},fetchImpl:async()=>{calls++;return new Response('{}',{status:504});}}));assert.equal(calls,1);
  for (const transientRetryLimit of [-1,3,0.5,'0']) await assert.rejects(xeroAccountingFetch(connection,'/Contacts',{transientRetryLimit,fetchImpl:()=>assert.fail('no request')}),e=>e.code==='XERO_REQUEST_RETRY_INVALID');
});
test('all eight new handlers keep uncached Finance ACL and dedicated mutation classification',()=>{
 for(const name of ['xeroExistingDraftAuthorisationApprovedScope','xeroExistingDraftAuthorisationPreview','xeroExistingDraftAuthorisationRead','xeroExistingDraftAuthorisationApply','xeroExistingDraftAuthorisationRecover','xeroSupplierFinancialBucketPreview','xeroSupplierFinancialBucketRead','xeroSupplierFinancialBucketApply']){const p=registeredHandlerBehavior(name);assert.equal(p.capability,'xero_portal_manage');assert.equal(p.cache,'none');assert.equal(p.mutation,!name.endsWith('Read')&&!name.endsWith('ApprovedScope'));}
});
test('PGlite exact prerequisite chain supports financial-only original link/replay and private status guards',async t=>{
 const h=await financialDatabase(t,false),db=h.db;
 await db.exec((await readFile(new URL('../supabase/migrations/20261004114240_xero_aggregate_supplier_preview_null_v3.sql',import.meta.url),'utf8')).replace(/^create extension if not exists pgcrypto;$/m,''));
 for(const paid of [false,true])await t.test(paid?'PAID ledger retained':'AUTHORISED original retained',async()=>{
  await db.exec('reset role;begin');h.setTransaction(true);
  try{const input=financialFixture({paid}).input,proof=evaluateSupplierFinancialBucketPreservation(input);assert.equal(proof.proofValid,true,JSON.stringify(proof.blockers));const f=await seedFinancialWithFixture(db,{synthetic:true,proof,review:reviewFor(proof.evidence,proof.localClaimScope)});await db.exec('set role service_role');const before=await f.snapshot();const result=await f.link();assert.equal(result.financialWrites,0);assert.equal(result.documentVerification,'UNVERIFIED');const after=await f.snapshot();assert.equal(after.items[0].proposed_payload,null);assert.deepEqual(after.items[0].xero_payload,before.items[0].xero_payload);assert.deepEqual(after.payments,before.payments);assert.equal(after.mappings[0].retained_differences.financialBucketPreservation.documentVerification,'UNVERIFIED');assert.equal(hash(after.mappings[0].retained_differences.financialBucketPreservation.originalReview.evidence),proof.fingerprint);assert.equal((await f.link()).alreadyLinked,true);assert.deepEqual(await f.snapshot(),after);}
  finally{h.setTransaction(false);await db.exec('rollback;reset role');}
 });
 await db.exec("create function public.fcos_has_access(uuid,text) returns boolean language sql as $$select false$$;");
 for(const name of ['20260929170347_xero_shared_control.sql','20260929170953_xero_reconciliation_campaign.sql','20261004183427_xero_existing_draft_status_authorisation_v1.sql'])await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/^create extension if not exists pgcrypto;$/m,''));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from public.xero_existing_draft_authorisation_approved_records'));await db.exec('reset role');}
 const count=await db.query('select count(*)::int n from public.xero_existing_draft_authorisation_approved_records');assert.equal(count.rows[0].n,0,'No private54 seed or approval fabricated');
});

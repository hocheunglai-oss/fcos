import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { existingDraftAuthorisationApprovedScope as read } from '../api/_xeroExistingDraftAuthorisationScope.js';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';
function fixture(){
 const tenant=randomUUID(),actor={id:randomUUID(),email:'operator@example.com'};
 const approved=Array.from({length:54},(_,i)=>{const id=randomUUID();return{target_id:id,source_id:`a0K${String(i).padStart(12,'0')}`,source_object:'Invoice__c',selection:{record:{targetId:id,currency:'USD',total:'1.00'}},reviewed_target:{InvoiceNumber:`SYNTHETIC-${i}`,Contact:{Name:'SYNTHETIC COMPANY'},AccessToken:'PRIVATE_SYNTHETIC'}};});
 const tables={xero_existing_draft_authorisation_approved_records:approved,xero_financial_document_mappings:approved.map(r=>({id:randomUUID(),salesforce_object:r.source_object,salesforce_id:r.source_id,xero_document_id:r.target_id,xero_status:'DRAFT'})),xero_existing_draft_authorisation_claims:[]};
 const client={from(table){let limit=Infinity;const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit(n){limit=n;return q;},then(a,b){return Promise.resolve({data:tables[table].slice(0,limit),error:null}).then(a,b);}};return q;}};
 return{actor,approved,tables,deps:{client,accessContext:{profile:actor},readConnection:async()=>({tenantId:tenant,accessToken:'PRIVATE_SYNTHETIC'}),readQuotaPolicy:async()=>({reserveFloor:200,grantExpiresAt:null}),readStatus:async()=>({allowanceKnown:true,unresolvedWrites:0,availableCalls:318,reservedCalls:0,spendableCalls:118})}};
}
test('approved scope uses complete central data and exposes only business fields, with no provider calls',async()=>{const h=fixture();h.tables.xero_financial_document_mappings[0].xero_status='AUTHORISED';const result=await read({},h.deps);assert.equal(result.rows.length,54);assert.equal(result.completed,1);assert.equal(result.providerCalls,0);assert.equal(JSON.stringify(result).includes('PRIVATE_SYNTHETIC'),false);assert.equal(result.executionHeld,false);assert.deepEqual(registeredHandlerBehavior('xeroExistingDraftAuthorisationApprovedScope'),{cache:'none',externalAction:false,capability:'xero_portal_manage',mutation:false,audit:'none'});});
test('incomplete fixed scope and changed mapping ownership are never offered for execution',async()=>{const h=fixture();h.tables.xero_existing_draft_authorisation_approved_records.pop();await assert.rejects(read({},h.deps));const other=fixture();other.tables.xero_financial_document_mappings[0].salesforce_id='a0K999999999999';assert.equal((await read({},other.deps)).rows[0].status,'OWNERSHIP_HELD');});
test('unresolved intents block automatic progression and recovery identifies only the current actor records',async()=>{const h=fixture();h.tables.xero_existing_draft_authorisation_claims.push({id:randomUUID(),target_id:h.approved[0].target_id,run_id:randomUUID(),actor_id:randomUUID(),actor_email:'other@example.com',xero_existing_draft_authorisation_events:[]});let result=await read({},h.deps);assert.equal(result.executionHeld,true);assert.equal(result.unresolved.length,0);Object.assign(h.tables.xero_existing_draft_authorisation_claims[0],{actor_id:h.actor.id,actor_email:h.actor.email});result=await read({},h.deps);assert.equal(result.unresolved.length,1);h.tables.xero_existing_draft_authorisation_claims[0].xero_existing_draft_authorisation_events=[{status:'rejected'}];assert.equal((await read({},h.deps)).executionHeld,false);});
test('untrusted scope or missing actor is rejected before connection or storage access',async()=>{await assert.rejects(read({targetIds:[randomUUID()]},{readConnection(){assert.fail('No connection read');}}));});

test('cohort capacity covers both preview and apply before consuming provider calls',async()=>{const h=fixture();for(const [spendable,size]of [[118,5],[85,5],[84,4],[57,1],[56,0]]){h.deps.readStatus=async()=>({allowanceKnown:true,unresolvedWrites:0,spendableCalls:spendable,availableCalls:spendable+200,reservedCalls:0});assert.equal((await read({},h.deps)).maxSafeCohort,size);}h.deps.readStatus=async()=>({allowanceKnown:false,unresolvedWrites:0,spendableCalls:1000});assert.equal((await read({},h.deps)).maxSafeCohort,0);});

test('scoped capacity display uses conservative allowance and preserves ordinary reserve',async()=>{
  const h=fixture();h.deps.readStatus=async()=>({allowanceKnown:true,unresolvedWrites:0,availableCalls:270,reservedCalls:0,spendableCalls:70});
  assert.equal((await read({},h.deps)).maxSafeCohort,2);
  const expiry=new Date(Date.now()+3600000).toISOString();h.deps.readQuotaPolicy=async()=>({reserveFloor:0,grantExpiresAt:expiry});
  const out=await read({},h.deps);assert.equal(out.maxSafeCohort,5);assert.equal(out.allowance.reserve,0);assert.equal(out.allowance.spendableCalls,270);
  assert.equal(out.allowance.reserveException,true);assert.equal(out.allowance.reserveExceptionExpiresAt,expiry);
  h.deps.readStatus=async()=>({allowanceKnown:true,unresolvedWrites:0,availableCalls:270,reservedCalls:200,spendableCalls:900});
  assert.equal((await read({},h.deps)).maxSafeCohort,2);
});

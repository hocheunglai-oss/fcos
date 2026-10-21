import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { collectExistingDraftAuthorisation as collect } from '../api/_xeroExistingDraftAuthorisationCollector.js';
const org = fcosSalesforceEnvironment('production');
function harness() {
  const actor=randomUUID(),target=randomUUID(),tenant=randomUUID(),budget=randomUUID();
  const stats={provider:0,reserved:0,released:0,active:0,peak:0}; const controls={};
  const deps={accessContext:{profile:{id:actor,email:'operator@example.com'}},
    client:{from(){const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit(){return q;},then(a,b){return Promise.resolve({error:null,data:[{tenant_id:tenant,target_id:target,source_id:'a0K000000000001',source_object:'Invoice__c',selection:{},reviewed_target:{}}]}).then(a,b);}};return q;}},
    connection:{tenantId:tenant,tokenVersion:1,accessToken:'SYNTHETIC_TEST_ONLY',scope:'accounting.invoices accounting.contacts accounting.settings',expiresAt:new Date(Date.now()+3600000).toISOString()},
    query:async()=>({records:[{Id:controls.foreignOrg?'00D000000000001':org.orgId,IsSandbox:false}],totalSize:1}),
    readStatus:async()=>({allowanceKnown:true,availableCalls:controls.available ?? (controls.lowQuota?200:1000),reservedCalls:0,dailyHold:false,retryAt:null,unresolvedWrites:0}),
    readQuotaPolicy:async()=>({reserveFloor:controls.exception?0:200}),
    reserveBudget:async()=>{stats.reserved++;return{id:budget,reserveFloor:controls.exception?0:200};},releaseBudget:async()=>{stats.released++;},withBudget:(_c,_p,fn)=>fn(),
    loadInvoicePages:async(c,_p,{accountingFetch:read})=>(await read(c,'/Invoices')).Invoices,
    readContacts:async(c,read)=>(await read(c,'/Contacts')).Contacts,
    async accountingFetch(_c,path,options){stats.provider++;stats.active++;stats.peak=Math.max(stats.peak,stats.active);try {
      await new Promise(r=>setTimeout(r,1));
      if(!controls.noReceipt)options.onResponse({requestId:randomUUID(),budgetId:budget,method:'GET',pathName:path,status:200});
      if(controls.doubleReceipt)options.onResponse({requestId:randomUUID(),budgetId:budget,method:'GET',pathName:path,status:200});
      return path==='/Invoices'?{Invoices:[]}:path==='/Contacts'?{Contacts:[]}:path.startsWith('/CreditNotes?')?{CreditNotes:[]}:
        path==='/Organisations'?{Organisations:[{OrganisationID:tenant,BaseCurrency:'USD',OrganisationStatus:'ACTIVE'}]}:path==='/Accounts'?{Accounts:[]}:{TaxRates:[]};
    }finally{stats.active--;}}
  };
  return {deps,stats,controls,target};
}
test('foreign Salesforce organisation is held before any Xero request or reservation',async()=>{const h=harness();h.controls.foreignOrg=true;await assert.rejects(collect({targetIds:[h.target]},h.deps));assert.equal(h.stats.provider,0);assert.equal(h.stats.reserved,0);});
test('whole-batch quota rejection consumes no provider reads',async()=>{const h=harness();h.controls.lowQuota=true;await assert.rejects(collect({targetIds:[h.target]},h.deps),e=>e.code==='XERO_DRAFT_STATUS_QUOTA_HELD');assert.equal(h.stats.provider,0);assert.equal(h.stats.reserved,0);});
test('missing or repeated read receipts fail closed and release unused capacity',async()=>{for(const flag of ['noReceipt','doubleReceipt']){const h=harness();h.controls[flag]=true;await assert.rejects(collect({targetIds:[h.target]},h.deps));assert.equal(h.stats.released,1);assert.equal(h.stats.active,0);}});
test('all settings and discovery reads stay within two concurrent requests and drain before release',async()=>{const h=harness();h.deps.loadSources=async()=>{throw Error('END_OF_SYNTHETIC_DISCOVERY');};await assert.rejects(collect({targetIds:[h.target]},h.deps),/END_OF_SYNTHETIC_DISCOVERY/);assert.equal(h.stats.provider,6);assert.ok(h.stats.peak<=2);assert.equal(h.stats.active,0);assert.equal(h.stats.released,1);});
test('invalid or repeated source identities are held despite matching totalSize',async()=>{for(const records of [[{Id:'invalid',IsDeleted:false}],[{Id:'a0K000000000001',IsDeleted:false},{Id:'a0K000000000001',IsDeleted:false}]]){const h=harness();h.deps.queryAll=async()=>({records,totalSize:records.length});h.deps.loadSources=async(_c,_l,{querySalesforce})=>{await querySalesforce([{soql:'SELECT Id FROM Invoice__c'}]);assert.fail('Incomplete source accepted');};await assert.rejects(collect({targetIds:[h.target]},h.deps),/Complete read-only Salesforce/);assert.equal(h.stats.released,1);}});

test('scoped reserve exception still requires combined preview, apply and recovery funding',async()=>{
  const short=harness();short.controls.exception=true;short.controls.available=56;
  await assert.rejects(collect({targetIds:[short.target]},short.deps),e=>e.code==='XERO_DRAFT_STATUS_QUOTA_HELD');
  assert.equal(short.stats.provider,0);assert.equal(short.stats.reserved,0);
  const funded=harness();funded.controls.exception=true;funded.controls.available=57;
  funded.deps.loadSources=async()=>{throw Error('END_OF_FUNDED_DISCOVERY');};
  await assert.rejects(collect({targetIds:[funded.target]},funded.deps),/END_OF_FUNDED_DISCOVERY/);
  assert.equal(funded.stats.reserved,1);assert.equal(funded.stats.released,1);
});
test('no exception retains normal200 floor and policy/reservation drift fails before providers',async()=>{
  const normal=harness();normal.controls.available=256;
  await assert.rejects(collect({targetIds:[normal.target]},normal.deps),e=>e.code==='XERO_DRAFT_STATUS_QUOTA_HELD');assert.equal(normal.stats.provider,0);
  const drift=harness();drift.controls.exception=true;drift.deps.reserveBudget=async()=>({id:drift.target,reserveFloor:200});
  await assert.rejects(collect({targetIds:[drift.target]},drift.deps),/current scope/);assert.equal(drift.stats.provider,0);assert.equal(drift.stats.released,1);
});

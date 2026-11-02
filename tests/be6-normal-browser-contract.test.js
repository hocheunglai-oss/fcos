import test from 'node:test';
import assert from 'node:assert/strict';
import { BE6_COMPATIBILITY_NORMAL_MODULES, COMPATIBILITY_NORMAL_MODULES, be6CompatibilityNormalRequestAllowed,
  compatibilityNormalRequestAllowed, compatibilityNormalDataLoaded, compatibilityNormalReadResponse,
  createCompatibilityNormalResponseObserver, createCompatibilityNormalResponseSettlement, normalizeCompatibilityNormalDiagnostic,
} from '../scripts/runtime-compatibility-normal-role.mjs';
import { normalRoleRequestDiagnostic } from '../scripts/lib/normal-role-verification-transport.mjs';
const origin = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const spec = name => BE6_COMPATIBILITY_NORMAL_MODULES.find(row => row.module === name);
const response = (body, data, status = 200) => ({ request: () => ({ method: () => 'POST', postDataJSON: () => body }),
  url: () => `${origin}/api/functions/hedgeDeskEntity`, status: () => status, ok: () => status === 200, json: async () => data });
const snapshot = { physicals: [{}], swaps: [], mops: [], clearing: [], counterparties: [], invoices: [], capabilities: {} };

test('exact be6 catalogue retains all15 and keeps historical first-rollout paths/data contracts separate', () => {
  assert.deepEqual(BE6_COMPATIBILITY_NORMAL_MODULES.map(row => row.module), COMPATIBILITY_NORMAL_MODULES.map(row => row.module));
  assert.equal(BE6_COMPATIBILITY_NORMAL_MODULES.length, 15);
  assert.equal(spec('buyer_invoices').handler, 'salesforceBuyerInvoicesDue');
  assert.equal(COMPATIBILITY_NORMAL_MODULES.find(row => row.module === 'buyer_invoices').handler, 'buyerInvoiceCollectionList');
  assert.equal(spec('markets').handler, 'marketPulseSnapshot');
  assert.equal(COMPATIBILITY_NORMAL_MODULES.find(row => row.module === 'markets').handler, 'hedgeMarkets');
  assert.equal(compatibilityNormalDataLoaded(spec('hedge_desk'), {data:snapshot}).loaded, true);
  for (const bad of [{}, {physicals:[]}, {...snapshot,error:'private'}, {...snapshot,swaps:null}]) assert.equal(compatibilityNormalDataLoaded(spec('hedge_desk'), {data:bad}).loaded, false);
});

test('only exact bounded be6 buyer invoice read is additive; reconcile and mutation controls stay denied', () => {
  const read = (name,body,extra={}) => ({ url: `${origin}/api/functions/${name}`, method:'POST',body,...extra });
  assert.equal(be6CompatibilityNormalRequestAllowed(read('salesforceBuyerInvoicesDue',{daysAhead:7}),origin),true);
  assert.equal(compatibilityNormalRequestAllowed(read('salesforceBuyerInvoicesDue',{daysAhead:7}),origin),false);
  for (const body of [{},{daysAhead:'7'},{daysAhead:-1},{daysAhead:366},{daysAhead:7,force:false},{daysAhead:7,action:'list'},JSON.parse('{"daysAhead":7,"__proto__":{}}')]) assert.equal(be6CompatibilityNormalRequestAllowed(read('salesforceBuyerInvoicesDue',body),origin),false);
  for(const [name,body] of [['paymentCollectionsReconcile',{force:false}],['buyerInvoiceCollectionSave',{}],['hedgeDeskEntity',{action:'create',entity:'PhysicalTrade'}],['emailRouterBackgroundSync',{}]]) assert.equal(be6CompatibilityNormalRequestAllowed(read(name,body),origin),false);
  assert.equal(be6CompatibilityNormalRequestAllowed(read('salesforceBuyerInvoicesDue',{daysAhead:7},{method:'GET'}),origin),false);
  assert.equal(be6CompatibilityNormalRequestAllowed({...read('salesforceBuyerInvoicesDue',{daysAhead:7}),url:origin+'/api/functions/salesforceBuyerInvoicesDue?force=true'},origin),false);
  assert.deepEqual(normalRoleRequestDiagnostic({...read('salesforceBuyerInvoicesDue',{}),resourceType:'fetch'},origin),{category:'BUYER_INVOICES_DUE_READ',method:'POST',resourceType:'fetch'});
  assert.equal(normalRoleRequestDiagnostic(read('unreviewedFunction',{}),origin).category,'UNKNOWN');
});

test('shared hedge endpoint separately validates snapshot and AppConfig settings in either completion order', async () => {
  for(const reverse of [false,true]) {
    const responses=[],failures=[],diagnostics=[],settlement=createCompatibilityNormalResponseSettlement();
    const observed=createCompatibilityNormalResponseObserver(spec('hedge_desk'),settlement,responses,failures,diagnostics);
    const reads=[response({action:'snapshot'},{data:snapshot}),response({action:'list',entity:'AppConfig',sort:'-created_date',limit:1000},{data:[]})];
    for(const item of reverse?reads.reverse():reads) observed.observe(item);
    await settlement.settle();assert.deepEqual(failures,[]);assert.equal(responses.length,1);assert.equal(responses[0].rows,1);assert.equal(observed.state.settingsLoaded,true);
    assert.deepEqual(new Set(diagnostics.map(row=>row.selector)),new Set(['HEDGE_SNAPSHOT','HEDGE_SETTINGS']));
  }
  for(const bad of [response({action:'snapshot'},{data:[]}),response({action:'list',entity:'AppConfig',sort:'-created_date',limit:1000},{data:{}}),response({action:'list',entity:'PhysicalTrade',sort:'-created_date',limit:1000},{data:[]}),response({action:'snapshot'},{data:snapshot},503)]) {
    const responses=[],failures=[],settlement=createCompatibilityNormalResponseSettlement();
    const observed=createCompatibilityNormalResponseObserver(spec('hedge_desk'),settlement,responses,failures);
    observed.observe(bad);observed.observe(response({action:'snapshot'},{data:snapshot}));await settlement.settle();assert.ok(failures.length,'later success never erases earlier invalid mandatory read');
  }
});

test('market board requires actual complete published values, not a heading or empty products', () => {
  const data={complete:true,asOfDate:'2026-10-30',latestMopsPublicationDate:'2026-10-30',reportCompleteness:{complete:true},products:['hsfo380','vlsfo','lsmgo'].map(productKey=>({productKey,unit:productKey==='lsmgo'?'USD/BBL':'USD/MT',latestMops:{value:500,publicationDate:'2026-10-30'}}))};
  assert.deepEqual(compatibilityNormalDataLoaded(spec('markets'),data),{loaded:true,rows:3});
  for(const bad of [{...data,complete:false},{...data,products:[]},{...data,reportCompleteness:{complete:false}},{...data,products:data.products.map(row=>({...row,latestMops:{value:null}}))}])assert.equal(compatibilityNormalDataLoaded(spec('markets'),bad).loaded,false);
});

test('email non2xx remains fatal and retains only HTTP status and exact known API code', async () => {
  const secret='PRIVATE_BODY_TOKEN';
  const responses=[],failures=[],diagnostics=[],settlement=createCompatibilityNormalResponseSettlement();
  const observed=createCompatibilityNormalResponseObserver(spec('email_router'),settlement,responses,failures,diagnostics);
  observed.observe({url:()=>origin+'/api/functions/emailRouterList',status:()=>503,ok:()=>false,json:async()=>({error:secret,code:'EMAIL_ROUTER_MAILBOX_UNRESOLVED',mailbox:secret})});
  await settlement.settle();assert.deepEqual(failures,['DATA_NON_2XX']);
  const sanitized=normalizeCompatibilityNormalDiagnostic({stage:'MODULES',reason:'DATA_NON_2XX',dataResponses:diagnostics});
  assert.deepEqual(sanitized.dataResponses,[{module:'email_router',handler:'emailRouterList',status:503,selector:'PRIMARY',errorCode:'EMAIL_ROUTER_MAILBOX_UNRESOLVED'}]);
  assert.equal(JSON.stringify(sanitized).includes(secret),false);
  assert.deepEqual(await compatibilityNormalReadResponse(spec('email_router'),{ok:()=>false,json:async()=>({code:secret})}),{loaded:false,rows:null,reason:'DATA_NON_2XX'});
  const rejected=normalizeCompatibilityNormalDiagnostic({dataResponses:[{module:'email_router',handler:'emailRouterList',status:503,selector:'PRIMARY',errorCode:secret,url:secret,body:secret}]});
  assert.equal(JSON.stringify(rejected).includes(secret),false);
});

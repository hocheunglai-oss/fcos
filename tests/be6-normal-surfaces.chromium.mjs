import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import {posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {BE6_NORMAL_BROWSER_SHA} from '../scripts/lib/be6-normal-browser-contract.mjs';
import {BE6_COMPATIBILITY_NORMAL_MODULES, COMPATIBILITY_NORMAL_MODULES, be6CompatibilityNormalRequestAllowed,
  compatibilityNormalOpenSurface, compatibilityNormalSurfaceReason, compatibilityNormalDataLoaded,
  createCompatibilityNormalResponseObserver, createCompatibilityNormalResponseSettlement, compatibilityNormalModuleTerminalReason} from '../scripts/runtime-compatibility-normal-role.mjs';
import {be6NormalSurfaceUnavailable} from '../scripts/lib/be6-normal-browser-contract.mjs';
// Local-only actual immutable components and actual hooks/API serializers.
// Only appClient/auth/context/chrome integrations are replaced. Every network
// request aborts; explicit fixtures are never persisted as live acceptance.
const cwd=fileURLToPath(new URL('..',import.meta.url)),sha=BE6_NORMAL_BROWSER_SHA;
const tree=new Set(execFileSync('git',['ls-tree','-r','--name-only',sha,'src','shared','config'],{cwd,encoding:'utf8'}).trim().split('\n'));
const sources=new Map();
function source(path){if(!sources.has(path))sources.set(path,execFileSync('git',['show',`${sha}:${path}`],{cwd,encoding:'utf8'}));return sources.get(path);}
const stubs=new Map([
 ['src/api/appClient',`export const appClient={functions:{invoke:(name,body={})=>window.localFixtureInvoke(name,body),clearCache(){},invalidateCache(){}},entities:{}};`],
 ['src/lib/AuthContext',`export const useAuth=()=>({user:{id:'12345678-1234-1234-1234-123456789abc',user_type:'general_manager'},hasModuleAccess:()=>true,hasCapability:()=>false,isAdministrator:false,deploymentMutationAllowed:false,deploymentCapabilities:{mutationsAllowed:false}});`],
 ['src/components/common/SalesforceSyncBadge','export default()=>null;'],
 ['src/components/common/PageMethodology','export default()=>null;'],
 ['src/components/common/PageUserManual','export default()=>null;'],
 ['src/components/common/PaymentDataReliabilityBadge','export default()=>null;'],
 ['src/components/dashboard/StemDetailModal','export default()=>null;'],
]);
const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import Review from'@/pages/ReviewQueue';import Collections from'@/pages/PaymentCollections';import Markets from'@/pages/Markets';import HedgeDesk from'@/pages/HedgeDesk';
import DashboardStemTable from'@/components/dashboard/DashboardStemTable';import DashboardKpis from'@/components/dashboard/DashboardKpis';
import{Tabs,TabsList,TabsTrigger,TabsContent}from'@/components/ui/tabs';
function Dashboard({empty=false,hidden=false}){const[tab,setTab]=useState('overview');return <><h1>Dashboard</h1><DashboardKpis summary={{}}/><Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="stems">STEMs</TabsTrigger></TabsList><TabsContent value="overview">Overview</TabsContent><TabsContent value="stems"><div style={hidden?{display:'none'}:{}}><DashboardStemTable result={{stems:empty?[]:[{Id:'local-stem',Name:'LOCAL STEM'}],total:empty?0:1}} loading={false}/></div></TabsContent></Tabs></>}
let root;window.renderBe6=options=>{root?.unmount();root=createRoot(document.getElementById('root'));const page=options.kind==='review'?<Review/>:options.kind==='markets'?<Markets/>:options.kind==='hedge_desk'?<HedgeDesk/>:options.kind==='dashboard'?<Dashboard {...options}/>:<Collections/>;root.render(<MemoryRouter initialEntries={[options.route||'/']}>{page}</MemoryRouter>);};`;
let browser,bundle,correctedBundle,correctedReviewSource;let contexts=0,networkCalls=0;
async function compile(reviewOverride){
 const built=await build({stdin:{contents:entry,sourcefile:'be6-local-fixture.jsx',resolveDir:cwd,loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',logLevel:'silent',define:{'import.meta.env':'{}','import.meta.url':JSON.stringify('https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app/local-fixture.js')},loader:{'.css':'empty'},plugins:[{name:'immutable-be6',setup(api){
  api.onResolve({filter:/^(?:@\/|\.\.?\/)/},args=>{
   if(args.namespace!=='be6'&&!args.path.startsWith('@/'))return;
   const path=posix.normalize(args.path.startsWith('@/')?`src/${args.path.slice(2)}`:posix.join(posix.dirname(args.importer),args.path));
   if(stubs.has(path))return{path,namespace:'local-provider-fixture'};
   const file=[path,`${path}.js`,`${path}.jsx`,`${path}/index.js`,`${path}/index.jsx`].find(file=>tree.has(file));
   if(!file)throw Error(`Immutable dependency missing: ${path}`);
   return{path:file,namespace:'be6'};
  });
  api.onLoad({filter:/.*/,namespace:'be6'},args=>({contents:args.path.endsWith('.css')?'':args.path==='src/pages/ReviewQueue.jsx'&&reviewOverride?reviewOverride:source(args.path),loader:args.path.endsWith('.css')?'empty':args.path.endsWith('.jsx')?'jsx':'js',resolveDir:cwd}));
  api.onLoad({filter:/.*/,namespace:'local-provider-fixture'},args=>({contents:stubs.get(args.path),loader:'js',resolveDir:cwd}));
 }}]});return built.outputFiles[0].text;
}
before(async()=>{
 bundle=await compile();
 if(process.env.FCOS_REVIEW_CORRECTION_SOURCE){
  const contents=readFileSync(process.env.FCOS_REVIEW_CORRECTION_SOURCE,'utf8');
  const sha256=createHash('sha256').update(contents).digest('hex');
  assert.equal(sha256,process.env.FCOS_REVIEW_CORRECTION_SHA256,'local correction must bind exact reviewed source bytes');
  correctedReviewSource={path:process.env.FCOS_REVIEW_CORRECTION_SOURCE,sha256,liveCoverage:false};correctedBundle=await compile(contents);
 }
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();if(browser)assert.equal(browser.isConnected(),false);assert.equal(contexts,0);assert.equal(networkCalls,0);
 if(process.env.FCOS_BE6_SOURCE_PROOF)writeFileSync(process.env.FCOS_BE6_SOURCE_PROOF,JSON.stringify({kind:'local_immutable_be6_render_proof',candidateSha:sha,sourceHashes:Object.fromEntries([...sources].map(([path,content])=>[path,createHash('sha256').update(content).digest('hex')])),stubbedProviderEntrypoints:[...stubs.keys()],correctedReviewSource,nodeVersion:process.version,browserVersion:browser?.version(),liveCoverage:false,externalCalls:networkCalls,browserClosed:true},null,2)+'\n',{flag:'wx'});
});
const origin='https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const spec=kind=>BE6_COMPATIBILITY_NORMAL_MODULES.find(row=>row.module===kind);
const pulse={complete:true,asOfDate:'2026-10-30',latestMopsPublicationDate:'2026-10-30',currentMonth:'2026-10',reportCompleteness:{complete:true},products:['hsfo380','vlsfo','lsmgo'].map(productKey=>({productKey,unit:productKey==='lsmgo'?'USD/BBL':'USD/MT',latestMops:{value:productKey==='lsmgo'?80:500,publicationDate:'2026-10-30'}}))};
const snapshot={physicals:[],swaps:[],mops:[],clearing:[],counterparties:[],invoices:[],auditLogs:[],capabilities:{}};
const clearStem={Id:'local-review',Name:'LOCAL REVIEW',Delivery_Date__c:'2026-10-01',Total_Invoice_Amount__c:1000,Total_Invoiced_Amount_From_Suppliers__c:900,QLIK_Total_Profit__c:100};
async function fixture(options,run){const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});contexts++;
 const calls=[],failures=[],responses=[],errors=[],settlement=createCompatibilityNormalResponseSettlement(),observed=createCompatibilityNormalResponseObserver(spec(options.kind),settlement,responses,failures);
 await context.route('**/*',async route=>{if(route.request().resourceType()==='document'&&route.request().url()===origin+'/'){await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><style>.hidden{display:none} @media(min-width:768px){.md\\:block{display:block}.md\\:hidden{display:none}} .market-price-board__mobile{display:none}</style><main id="root"></main>'});return;}networkCalls++;await route.abort();});
 let page;try{page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('localFixtureInvoke',async(name,body)=>{
   calls.push({name,body});assert.equal(be6CompatibilityNormalRequestAllowed({url:origin+'/api/functions/'+name,method:'POST',body},origin),true,`actual candidate read policy: ${name}`);
   let data;
   if(name==='salesforceDashboardFiltered')data={recentStems:[options.exception?{...clearStem,QLIK_Total_Profit__c:-100}:clearStem]};
   else if(name==='exceptionReviewWorkflowList')data={byStemId:{},ownerOptions:[]};
   else if(name==='salesforceBuyerInvoicesDue')data={rows:[],today:'2026-10-30',dueThrough:'2026-11-06'};
   else if(name==='buyerInvoiceEmailSettingsGet')data={settings:{},capabilities:{canManageSettings:false}};
   else if(name==='incomingPaymentsList')data={rows:[],summary:{},settings:{thresholds:[]}};
   else if(name==='marketPulseSnapshot')data=options.badPulse?{...pulse,complete:false}:pulse;
   else if(name==='marketIntelligenceBrief')data={available:true,asOfDate:'2026-10-30',displayedDate:'2026-10-30',requestedDate:'2026-10-30',latestAvailableDate:'2026-10-30',sourceRefs:[],materialChanges:[],portDislocations:[],physicalPaperSignals:[],drivers:[],risks:[]};
   else if(name==='marketBookContext')data={rows:[],totals:{openPhysicalCount:0,liveHedgeCount:0},generatedAt:'2026-10-30T00:00:00Z'};
   else if(name==='marketIntradayTimeline')data={items:[],sessions:[],timeline:[]};
   else if(name==='hedgeDeskEntity')data={data:body.action==='snapshot'?snapshot:[]};
   else assert.fail(`Unexpected fixture read ${name}`);
   observed.observe({url:()=>origin+'/api/functions/'+name,status:()=>200,ok:()=>true,request:()=>({method:()=> 'POST',postDataJSON:()=>body}),json:async()=>data});
   await new Promise(resolve=>setTimeout(resolve,options.delay||0));return{data};
  });
  await page.goto(origin);
  await page.addScriptTag({content:options.correctedReview?correctedBundle:bundle});assert.deepEqual(errors,[]);await page.evaluate(options=>window.renderBe6(options),options);
  await run(page,{calls,failures,responses,observed,errors});if(!options.expectedPageError)assert.deepEqual(errors,[]);
  await page.close();await settlement.settle();
 }catch(error){throw new Error(String(error)+'\nLocal page errors: '+JSON.stringify(errors)+'\nCalls: '+JSON.stringify(calls)+'\nBody: '+(await page?.locator('body').innerText()),{cause:error});}finally{await context.close();contexts--;}
}
const reason=(kind,page,rows,timeoutMs=1000)=>compatibilityNormalSurfaceReason(spec(kind),page,{rows},'',{timeoutMs});

test('real be6 review validates classified empty queue from nonempty scanned data and preserves actual exception render bug',async()=>{
 await fixture({kind:'review',delay:35},async(page,state)=>{
  await page.getByText('1 STEMs scanned',{exact:true}).waitFor();await compatibilityNormalOpenSurface(spec('review'),page);
  assert.equal(await reason('review',page,1),null);assert.equal(await page.getByText('No exceptions found',{exact:true}).count(),1);
  assert.equal(state.calls.some(row=>row.name==='exceptionReviewWorkflowList'),true);
 });
 await fixture({kind:'review',exception:true,expectedPageError:true},async(page,state)=>{
  await page.waitForTimeout(800);assert.ok(state.errors.some(error=>error.includes('BUYER_FIELD is not defined')));
  assert.equal(compatibilityNormalModuleTerminalReason({failures:['PAGE_ERROR']}),'PAGE_ERROR','a real candidate render failure remains fatal');
 });
});
test('actual be6 PaymentCollections mounts exact invoice read and actual Incoming Payments heading with mutations disabled',async()=>{
 for(const kind of ['buyer_invoices','incoming_payments'])await fixture({kind,route:spec(kind).path,delay:35},async(page,state)=>{
  await page.getByRole('heading',{name:spec(kind).title}).first().waitFor();await compatibilityNormalOpenSurface(spec(kind),page);
  await page.getByText(kind==='buyer_invoices'?'No buyer invoices found':'No payments found',{exact:true}).waitFor();
  assert.equal(state.calls.some(row=>row.name===spec(kind).handler),true);assert.equal(state.calls.some(row=>row.name==='paymentCollectionsReconcile'),false);
  assert.equal(state.responses.some(row=>row.loaded),true);
  assert.equal(await reason(kind,page,0),null);
 });
});
test('real be6 Markets read-only page shows complete published board without an administrative Market tools control',async()=>{
 await fixture({kind:'markets',delay:35},async(page,state)=>{
  await page.getByRole('region',{name:'Market price board',exact:true}).waitFor();await compatibilityNormalOpenSurface(spec('markets'),page);
  assert.equal(await page.getByRole('button',{name:'Market tools',exact:true}).count(),0);
  assert.equal(await reason('markets',page,3),null);assert.equal(state.responses.some(row=>row.loaded),true);
  assert.equal(await be6NormalSurfaceUnavailable(page),false,'missing optional business values do not conceal a failed mandatory read');
 });
});
test('actual be6 HedgeDesk receives mandatory snapshot and AppConfig list independently and renders exposure empty state',async()=>{
 await fixture({kind:'hedge_desk',delay:35},async(page,state)=>{
  await page.getByText('No position exposure',{exact:true}).waitFor();await page.waitForTimeout(150);
  assert.equal(await reason('hedge_desk',page,0),null);assert.equal(state.observed.state.settingsLoaded,true);assert.deepEqual(state.failures,[]);
  assert.deepEqual(state.calls.filter(row=>row.name==='hedgeDeskEntity').map(row=>row.body.action).sort(),['list','snapshot']);
 });
});
test('real be6 Dashboard table validates selected STEM rows despite truthful unavailable KPIs and rejects hidden business data',async()=>{
 for(const hidden of [false,true])await fixture({kind:'dashboard',hidden},async page=>{
  await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();await compatibilityNormalOpenSurface(spec('dashboard'),page);
  assert.match(await page.locator('body').innerText(),/Unavailable/i);assert.equal(await be6NormalSurfaceUnavailable(page),false);
  assert.equal(await reason('dashboard',page,1,100),hidden?'UNAVAILABLE_SURFACE':null);
 });
});
test('separate root application correction renders real exception amounts and preserves raw CSV values',{skip:!process.env.FCOS_REVIEW_CORRECTION_SOURCE},async()=>{
 await fixture({kind:'review',exception:true,correctedReview:true,delay:35},async(page,state)=>{
  await page.getByText('1 STEMs scanned',{exact:true}).waitFor();await compatibilityNormalOpenSurface(spec('review'),page);
  assert.equal(await reason('review',page,1),null);
  assert.equal(await page.getByRole('cell',{name:'$1,000',exact:true}).count(),1);
  assert.equal(await page.getByRole('cell',{name:'$900',exact:true}).count(),1);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  const download=await downloadPromise;const csv=readFileSync(await download.path(),'utf8');
  assert.match(download.suggestedFilename(),/^exception_review_.*\.csv$/);assert.match(csv,/Buyer Invoice,Supplier Invoice,Gross Profit/);
  assert.match(csv,/,1000,900,-100(?:\n|$)/);assert.deepEqual(state.errors,[]);
 });
});
test('all source bindings stay immutable, no component fixture grants live fifteen-module evidence',()=>{
 assert.equal(sha,'be6daf6162480ca77ec8d4f04fe5aaa5b228a22c');assert.equal(BE6_COMPATIBILITY_NORMAL_MODULES.length,15);assert.equal(COMPATIBILITY_NORMAL_MODULES.length,15);
 for(const required of ['src/pages/ReviewQueue.jsx','src/pages/PaymentCollections.jsx','src/pages/BuyerInvoices.jsx','src/pages/IncomingPayments.jsx','src/pages/Markets.jsx','src/pages/HedgeDesk.jsx','src/hedge/hooks/useAppSettings.js','src/hedge/api/entities.js','src/hedge/views/market-intelligence/MarketDecisionBrief.jsx','src/components/markets/MarketPriceBoard.jsx','src/components/dashboard/DashboardStemTable.jsx'])assert.ok(sources.has(required),required);
});

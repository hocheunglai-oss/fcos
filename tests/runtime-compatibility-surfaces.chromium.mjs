import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { COMPATIBILITY_NORMAL_MODULES, compatibilityNormalOpenSurface, compatibilityNormalSurfaceReason } from '../scripts/runtime-compatibility-normal-role.mjs';
import { FIRST_RUNTIME_ROLLOUT } from '../scripts/lib/runtime-compatibility-release.mjs';

// This is local selector/render evidence, never provider data or live coverage.
// Actual frozen components are bundled from git, with provider entrypoints
// replaced by explicit local fixtures and every browser network request aborted.
const cwd = fileURLToPath(new URL('..', import.meta.url));
const sha = FIRST_RUNTIME_ROLLOUT.candidateSha;
const tree = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', sha, 'src'], { cwd, encoding: 'utf8' }).trim().split('\n'));
const sources = new Map();
function source(path) {
  if (!sources.has(path)) sources.set(path, execFileSync('git', ['show', `${sha}:${path}`], { cwd, encoding: 'utf8' }));
  return sources.get(path);
}
const workspace = source('src/hedge/views/MarketIntelligenceWorkspace.jsx');
const drawer = workspace.slice(workspace.indexOf('function MarketToolsDrawer('), workspace.indexOf('\nexport function MarketIntelligenceWorkspace('));
assert.match(drawer, /canManageMarketData && marketDataLoaded/);
assert.match(drawer, /<summary>Settlement MOPS control<\/summary>/);
assert.match(source('src/pages/DashboardSettings.jsx'), /TabsTrigger value="stems">STEMs/);
assert.match(source('src/pages/XeroPortal.jsx'), /<TabsContent value="receipts"/);
assert.match(source('src/pages/XeroPortal.jsx'), /<Table scrollLabel=\{copy.receipts.auditLabel\}>/);
assert.match(source('src/pages/Markets.jsx'), /canManageMarketData=\{pulse\?\.capabilities\?\.hedge_book_manage === true\}/);
const stubs = new Map([
  ['src/api/appClient', `export const appClient={functions:{invoke:async(name)=>{if(name!=='financeSettingsGet') {window.unexpectedProviderCalls++;throw Error('LOCAL_FIXTURE_UNEXPECTED');} await new Promise(r=>setTimeout(r,window.fixtureDelay||0));return {data:{settings:{annualInterestRatePct:3.5,bankChargesUsd:{UBS:10,DBS:20},revision:1},permissions:{canManageSettings:false}}};}}};`],
  ['src/hedge/api/entities', 'export const MopsPrice={};'],
  ['src/hedge/api/backendFunctions', "export const parseMopsPrice=()=>{window.unexpectedProviderCalls++;throw Error('LOCAL_FIXTURE_UNEXPECTED');};"],
  ['src/hedge/data/ActionsContext', 'export const useActions=()=>({});'],
  ['src/components/common/PageMethodology', 'export default ()=>null;'],
  ['src/components/common/SalesforceSyncBadge', 'export default ()=>null;'],
  ['src/components/workspace/WorkspaceChrome', 'export const useWorkspaceChromeRegistration=()=>null;'],
  ['src/components/ui/use-toast', 'export const useToast=()=>({toast:()=>{throw Error("UNEXPECTED_FIXTURE_MUTATION");}});'],
]);
const entry = `
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import EmailMessageList from '@/components/email-router/EmailMessageList';
import FinanceSettings from '@/components/settings/FinanceSettings';
import {MarketsView} from '@/hedge/views/MarketsView';
import {Drawer,Button} from '@/hedge/components/ui';
import {FileUp,RefreshCw} from 'lucide-react';
import {DEFAULT_GENERAL,hktToday} from '@/hedge/lib/domain';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '@/components/ui/table';
import {xeroPortalUiCopy} from '@/lib/xeroPortalUiCopy';
const MarketForwardCurves=()=>null,MarketDriversAlerts=()=>null;
${drawer}
const copy=xeroPortalUiCopy('en');
function Rows({hidden=false}) {return <TableBody><TableRow style={hidden?{display:'none'}:undefined}><TableCell>Local fixture business row</TableCell></TableRow></TableBody>;}
function Fixture({kind,delay=0,empty=false,hidden=false,manage=true,tools=true,old=false}) {
 const [ready,setReady]=useState(!delay),[toolsOpen,setToolsOpen]=useState(false);
 useEffect(()=>{const t=setTimeout(()=>setReady(true),delay);return()=>clearTimeout(t);},[delay]);
 const message={id:'local-fixture',subject:'Local fixture message',from:{name:'Local fixture sender'},sentAt:'2026-10-01T00:00:00Z'};
 if(kind==='dashboard')return <Tabs defaultValue="overview"><TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="stems">STEMs</TabsTrigger></TabsList><TabsContent value="overview"><Table><Rows/></Table></TabsContent><TabsContent value="stems">{ready?<Table><Rows hidden={hidden}/></Table>:<p>Loading STEMs</p>}</TabsContent></Tabs>;
 if(kind==='xero_portal')return <Tabs defaultValue="accounting"><TabsList><TabsTrigger value="accounting">Accounting</TabsTrigger><TabsTrigger value="receipts">{copy.tabs.receipts}</TabsTrigger></TabsList><TabsContent value="accounting"><Table><Rows/></Table></TabsContent><TabsContent value="receipts"><h2>{copy.receipts.auditTitle}</h2>{ready?<Table scrollLabel={copy.receipts.auditLabel}><TableHeader><TableRow><TableHead>{copy.receipts.receipt}</TableHead></TableRow></TableHeader>{empty?<TableBody><TableRow><TableCell>{copy.receipts.emptyTitle}</TableCell></TableRow></TableBody>:<Rows hidden={hidden}/>}</Table>:<p>Loading receipt audit</p>}</TabsContent></Tabs>;
 if(kind==='email_router')return <><div style={hidden?{display:'none'}:undefined}><EmailMessageList messages={ready&&!empty?[message]:[]} loading={!ready} folder="inbox" selectedBatchIds={new Set()}/></div><Table><Rows/></Table></>;
 if(kind==='settings')return <div style={hidden?{display:'none'}:undefined}><FinanceSettings/></div>;
 if(kind==='markets')return <>{tools?<Button onClick={()=>setToolsOpen(true)}>Market tools</Button>:null}<div style={hidden?{display:'none'}:undefined}><MarketToolsDrawer open={toolsOpen} onClose={()=>setToolsOpen(false)} data={{mops:empty?[]:[{id:'local-price',price_date:old?'2001-01-01':hktToday(),s380:410,s05:510,sgo:80,source:'Local fixture'}],mopsMonthVerifications:[]}} settings={{general:DEFAULT_GENERAL,forwardSpreads:{}}} canManageMarketData={manage} canManageAlertRules={!manage} canManageCurveCutover={false} marketDataLoaded={ready} marketDataLoading={!ready}/></div><Table><Rows/></Table></>;
}
let root;window.renderFrozen=options=>{root?.unmount();root=createRoot(document.getElementById('root'));window.fixtureDelay=options.delay||0;root.render(<Fixture {...options}/>);};
`;
let browser, bundle;
before(async () => {
  const built = await build({ stdin: { contents: entry, sourcefile: 'frozen-surface-fixture.jsx', resolveDir: cwd, loader: 'jsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    plugins: [{ name: 'immutable-frozen-components', setup(api) {
      api.onResolve({ filter: /^(?:@\/|\.\.?\/)/ }, args => {
        if (args.namespace !== 'frozen' && !args.path.startsWith('@/')) return;
        const path = posix.normalize(args.path.startsWith('@/') ? `src/${args.path.slice(2)}` : posix.join(posix.dirname(args.importer), args.path));
        if (stubs.has(path)) return { path, namespace: 'local-provider-fixture' };
        const file = [path, `${path}.js`, `${path}.jsx`, `${path}/index.js`, `${path}/index.jsx`].find(file => tree.has(file));
        if (!file) throw Error('Frozen fixture dependency missing');
        return { path: file, namespace: 'frozen' };
      });
      api.onLoad({ filter: /.*/, namespace: 'frozen' }, args => ({ contents: source(args.path), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js', resolveDir: cwd }));
      api.onLoad({ filter: /.*/, namespace: 'local-provider-fixture' }, args => ({ contents: stubs.get(args.path), loader: 'js', resolveDir: cwd }));
    } }],
  });
  bundle = built.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  assert.equal(browser?.isConnected(), false, 'Chromium session is closed');
  if (process.env.FCOS_SURFACE_TEST_SOURCE_PROOF) writeFileSync(process.env.FCOS_SURFACE_TEST_SOURCE_PROOF, `${JSON.stringify({ frozenCandidateSha: sha, sourceHashes: Object.fromEntries([...sources].map(([path, content]) => [path, createHash('sha256').update(content).digest('hex')])), stubbedProviderEntrypoints: [...stubs.keys()], liveCoverage: false, externalCalls: 0, browserClosed: true }, null, 2)}\n`, { flag: 'wx' });
});
async function fixture(options, run) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let externalCalls = 0;
  await context.route('**/*', async route => { externalCalls++; await route.abort(); });
  try {
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><body><main id="root"></main></body></html>');
    await page.evaluate(() => { window.unexpectedProviderCalls = 0; });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(options => window.renderFrozen(options), options);
    await page.waitForTimeout(25);
    await run(page);
    assert.equal(await page.evaluate(() => window.unexpectedProviderCalls), 0);
    assert.equal(externalCalls, 0, 'no provider or other network request');
    await page.close();
    assert.equal(context.pages().length, 0);
  } finally { await context.close(); }
}
const spec = module => COMPATIBILITY_NORMAL_MODULES.find(row => row.module === module);
const reason = (module, page, rows = 1, timeoutMs = 250) => compatibilityNormalSurfaceReason(spec(module), page, { rows }, '', { timeoutMs });

test('real frozen Radix tabs select STEMs and Receipts with visible scoped audit rows, including delayed paints', async () => {
  for (const kind of ['dashboard', 'xero_portal']) await fixture({ kind, delay: 120 }, async page => {
    if (kind === 'xero_portal') assert.equal(await reason(kind, page, 1, 0), 'UNAVAILABLE_SURFACE', 'Accounting rows cannot satisfy Receipts');
    await compatibilityNormalOpenSurface(spec(kind), page);
    assert.equal(await page.getByRole('tab', { name: kind === 'dashboard' ? 'STEMs' : 'Receipts', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await reason(kind, page), null);
  });
  await fixture({ kind: 'xero_portal', empty: true }, async page => {
    await compatibilityNormalOpenSurface(spec('xero_portal'), page);
    assert.equal(await reason('xero_portal', page, 0), null);
  });
  for (const kind of ['dashboard', 'xero_portal']) await fixture({ kind, hidden: true }, async page => {
    await compatibilityNormalOpenSurface(spec(kind), page);
    assert.equal(await reason(kind, page, 1, 0), 'MISSING_ROWS', 'hidden rows cannot satisfy real business data');
  });
});

test('actual frozen EmailMessageList button/time and inbox empty states require visible message UI', async () => {
  await fixture({ kind: 'email_router', delay: 120 }, async page => {
    assert.equal(await reason('email_router', page, 1, 0), 'MISSING_ROWS', 'unrelated table cannot satisfy message data');
    assert.equal(await reason('email_router', page), null);
    assert.equal(await page.locator('button:visible:has(time:visible)').count(), 1);
  });
  await fixture({ kind: 'email_router', delay: 300 }, async page => {
    assert.equal(await reason('email_router', page, 1, 50), 'MISSING_ROWS', 'a render beyond the bounded deadline cannot pass');
    assert.equal(await reason('email_router', page, 1, 500), null);
  });
  await fixture({ kind: 'email_router', empty: true }, async page => assert.equal(await reason('email_router', page, 0), null));
  for (const empty of [false, true]) await fixture({ kind: 'email_router', hidden: true, empty }, async page => {
    assert.equal(await reason('email_router', page, empty ? 0 : 1, 0), empty ? 'EMPTY_STATE_MISSING' : 'MISSING_ROWS');
  });
});

test('actual frozen FinanceSettings heading and accessible financing field appear after the local read paints', async () => {
  await fixture({ kind: 'settings', delay: 120 }, async page => {
    assert.equal(await page.getByRole('heading', { name: 'Finance', exact: true }).isVisible(), true);
    assert.equal(await reason('settings', page, null, 0), 'SETTINGS_FIELD_MISSING');
    assert.equal(await reason('settings', page, null), null);
    assert.equal(await page.getByLabel('Annual financing rate (%)', { exact: true }).inputValue(), '3.50');
  });
  await fixture({ kind: 'settings', hidden: true }, async page => assert.equal(await reason('settings', page, null), 'SETTINGS_FIELD_MISSING'));
});

test('actual frozen MarketsView and exact capability-gated drawer verify populated, empty, hidden and calendar-only MOPS surfaces', async () => {
  for (const empty of [false, true]) await fixture({ kind: 'markets', empty, delay: 120 }, async page => {
    await compatibilityNormalOpenSurface(spec('markets'), page);
    assert.equal(await reason('markets', page, empty ? 0 : 1, 0), 'ACCESS_MISSING', 'successful response can precede rendered MOPS controls');
    assert.equal(await reason('markets', page, empty ? 0 : 1), null);
    assert.equal(await page.locator('details[open]').filter({ has: page.locator('summary').filter({ hasText: /^Settlement MOPS control$/ }) }).count(), 1, 'real summary click opens the section');
  });
  await fixture({ kind: 'markets', tools: false, manage: false }, async page => assert.rejects(() => compatibilityNormalOpenSurface(spec('markets'), page), { message: 'ACCESS_MISSING' }));
  for (const options of [{ manage: false }, { hidden: true }]) await fixture({ kind: 'markets', ...options }, async page => {
    await compatibilityNormalOpenSurface(spec('markets'), page);
    assert.equal(await reason('markets', page, 1, 0), 'ACCESS_MISSING');
  });
  await fixture({ kind: 'markets', old: true }, async page => {
    await compatibilityNormalOpenSurface(spec('markets'), page);
    assert.equal(await reason('markets', page, 1, 0), 'MISSING_ROWS', 'publication calendar rows are not saved MOPS records');
  });
});

test('rendered fixture binds every compiled application source to the immutable candidate and never emits live coverage', () => {
  assert.equal(sha, 'ff8859b287009e20462c5c0cceff89ae12f13010');
  for (const required of ['src/components/email-router/EmailMessageList.jsx', 'src/hedge/views/MarketsView.jsx', 'src/components/settings/FinanceSettings.jsx', 'src/components/ui/tabs.jsx', 'src/components/ui/table.jsx']) assert.ok(sources.has(required));
  assert.ok([...sources.values()].every(value => /^[0-9a-f]{64}$/.test(createHash('sha256').update(value).digest('hex'))));
  assert.equal(COMPATIBILITY_NORMAL_MODULES.length, 15);
});

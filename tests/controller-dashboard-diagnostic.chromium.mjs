import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { REVIEW_REPAIR_COMPATIBILITY_NORMAL_MODULES, compatibilityNormalOpenSurface, compatibilityNormalSurfaceReason,
  compatibilityNormalModuleReadiness, createCompatibilityNormalResponseObserver, createCompatibilityNormalResponseSettlement } from '../scripts/runtime-compatibility-normal-role.mjs';
import { be6NormalSurfaceUnavailable } from '../scripts/lib/be6-normal-browser-contract.mjs';

// Exact frozen page, table and Radix tabs. Only external entrypoints/chrome are
// fixtures. No application source file or immutable candidate is changed.
const cwd = fileURLToPath(new URL('..', import.meta.url)), candidate = '75e7c09c637868efb90f5b5c5d8ada40a6ae03c6';
const origin = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const tree = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', candidate, 'src', 'shared', 'config'], { cwd, encoding: 'utf8' }).trim().split('\n'));
const sources = new Map(), spec = REVIEW_REPAIR_COMPATIBILITY_NORMAL_MODULES.find(x => x.module === 'dashboard');
const originalVerifierSource = execFileSync('git', ['show', 'f0ba230126e2f77a6eed5e6a433bf6d5a3ad3382:scripts/lib/be6-normal-browser-contract.mjs'], { cwd, encoding: 'utf8' });
const originalVerifier = await import('data:text/javascript;base64,' + Buffer.from(originalVerifierSource).toString('base64'));
const stubs = new Map([
  ['src/api/appClient', 'export const appClient={functions:{invoke:(name,body={})=>window.localDashboardInvoke(name,body),clearCache(){},invalidateCache(){}},entities:{}};'],
  ['src/lib/AuthContext', 'export const useAuth=()=>({user:{id:"LOCAL",user_type:"general_manager"},hasModuleAccess:()=>true,hasCapability:()=>false,isAdministrator:false,deploymentMutationAllowed:false});'],
  ['src/components/common/PageMethodology', 'export default()=>null;'],
  ['src/components/common/PaymentDataReliabilityBadge', 'export default()=>null;'],
  ['src/components/dashboard/StemDetailModal', 'export default()=>null;'],
]);
let browser, bundle, externalRequests = 0, contexts = 0, fixtureCalls = 0;
before(async () => {
  const result = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Dashboard from'@/pages/DashboardSettings';createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/?tab=stems']}><Dashboard/></MemoryRouter>);`, resolveDir: cwd, loader: 'jsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'import.meta.env': '{}', 'import.meta.url': JSON.stringify(origin + '/fixture.js') }, loader: { '.css': 'empty' },
    plugins: [{ name: 'exact-frozen-dashboard', setup(api) {
      api.onResolve({ filter: /^(?:@\/|\.\.?\/)/ }, args => {
        if (args.namespace !== 'frozen' && !args.path.startsWith('@/')) return;
        const p = posix.normalize(args.path.startsWith('@/') ? 'src/' + args.path.slice(2) : posix.join(posix.dirname(args.importer), args.path));
        if (stubs.has(p)) return { path: p, namespace: 'fixture' };
        const file = [p, p + '.js', p + '.jsx', p + '/index.js', p + '/index.jsx'].find(x => tree.has(x));
        if (!file) throw Error('FROZEN_DASHBOARD_DEPENDENCY_MISSING');
        return { path: file, namespace: 'frozen' };
      });
      api.onLoad({ filter: /.*/, namespace: 'frozen' }, args => {
        if (!sources.has(args.path)) sources.set(args.path, execFileSync('git', ['show', candidate + ':' + args.path], { cwd, encoding: 'utf8' }));
        return { contents: sources.get(args.path), loader: args.path.endsWith('.css') ? 'empty' : args.path.endsWith('.jsx') ? 'jsx' : 'js', resolveDir: cwd };
      });
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs.get(args.path), loader: 'js', resolveDir: cwd }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close(); assert.equal(browser?.isConnected(), false); assert.equal(contexts, 0); assert.equal(externalRequests, 0);
  if (process.env.FCOS_DASHBOARD_DIAGNOSTIC_PROOF) writeFileSync(process.env.FCOS_DASHBOARD_DIAGNOSTIC_PROOF, JSON.stringify({
    kind: 'LOCAL_exact75_Dashboard_Radix_diagnostic_render_v1', candidateSha: candidate,
    sourceHashes: Object.fromEntries([...sources].map(([p, s]) => [p, createHash('sha256').update(s).digest('hex')])),
    originalF0VerifierSha256: createHash('sha256').update(originalVerifierSource).digest('hex'),
    currentVerifierSha256: createHash('sha256').update(readFileSync(new URL('../scripts/lib/be6-normal-browser-contract.mjs', import.meta.url))).digest('hex'),
    stubbedEntrypoints: [...stubs.keys()], node: process.version, chromium: browser.version(), externalRequests, fixtureCalls,
    browserClosed: true, localMockOnly: true, liveQualification: false,
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
});
async function fixture({ empty = false, unavailable = false } = {}, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }); contexts++;
  const responses = [], failures = [], errors = [], settlement = createCompatibilityNormalResponseSettlement();
  const observed = createCompatibilityNormalResponseObserver(spec, settlement, responses, failures);
  await context.route('**/*', async route => {
    if (route.request().isNavigationRequest() && route.request().url() === origin + '/?tab=stems') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><style>.hidden{display:none}@media(min-width:768px){.md\\:block{display:block}.md\\:hidden{display:none}}[hidden]{display:none}</style><div id="root"></div>' });
    externalRequests++; await route.abort();
  });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.name));
    await page.exposeFunction('localDashboardInvoke', async name => {
      fixtureCalls++;
      assert.ok(['dashboardFilterOptions', 'dashboardSummary', 'dashboardStemList', 'dashboardAnalytics'].includes(name), 'NO_UNEXPECTED_PROVIDER_ENTRYPOINT');
      const data = name === 'dashboardFilterOptions' ? { options: [] } : name === 'dashboardSummary' ? { matchingCount: empty ? 0 : 1, complete: true, currencies: [] }
        : name === 'dashboardStemList' ? { stems: empty ? [] : [{ Id: 'LOCAL-STEM', Name: 'LOCAL STEM' }], matchingCount: empty ? 0 : 1, total: empty ? 0 : 1 }
          : { trend: { monthlyComparison: { rows: [] } }, rankings: {} };
      await new Promise(r => setTimeout(r, name === 'dashboardSummary' ? 70 : 30));
      const payload = { data, meta: { cacheStatus: unavailable && name === 'dashboardSummary' ? 'UNAVAILABLE' : 'MISS' } };
      observed.observe({ url: () => origin + '/api/functions/' + name, status: () => 200, ok: () => true, json: async () => payload });
      return payload;
    });
    await page.goto(origin + '/?tab=stems'); await page.addScriptTag({ content: bundle });
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    await compatibilityNormalOpenSurface(spec, page);
    const end = Date.now() + 5000;
    while (!await compatibilityNormalModuleReadiness(spec, page, responses, observed.state) && !failures.length && Date.now() < end) await page.waitForTimeout(20);
    assert.equal(await compatibilityNormalModuleReadiness(spec, page, responses, observed.state), true);
    assert.deepEqual(failures, []); assert.deepEqual(errors, []);
    await run(page, responses.find(x => x.loaded));
    await page.close(); await settlement.settle(); assert.deepEqual(errors, []);
  } finally { await context.close(); contexts--; }
}
test('exact75 actual Dashboard page/Radix/table accepts delayed real-shaped rows and honest empty response', async () => {
  for (const empty of [false, true]) await fixture({ empty }, async (page, loaded) => {
    assert.equal(await be6NormalSurfaceUnavailable(page), false);
    assert.equal(await originalVerifier.be6NormalSurfaceReason(spec, page, loaded), empty ? 'EMPTY_STATE_MISSING' : null);
    assert.equal(await compatibilityNormalSurfaceReason(spec, page, loaded, ''), null);
    assert.equal(await page.getByRole('tabpanel', { name: 'STEMs', exact: true }).isVisible(), true);
    if (empty) {
      const copies = page.getByRole('tabpanel', { name: 'STEMs', exact: true }).getByText('No STEMs match these filters. Reset a filter or select a wider period.', { exact: true });
      assert.equal(await copies.count(), 2); assert.equal(await copies.first().isVisible(), false); assert.equal(await copies.filter({ visible: true }).count(), 1);
      await copies.evaluateAll(nodes => nodes.forEach(node => { node.style.display = 'none'; }));
      const seen = []; assert.equal(await compatibilityNormalSurfaceReason(spec, page, loaded, '', { timeoutMs: 0, observe: x => seen.push(x) }), 'EMPTY_STATE_MISSING');
      assert.equal(seen[0].origin, 'DASHBOARD_EMPTY_STATE_MISSING');
    }
  });
});
test('exact75 unavailable badge and hidden STEMs panel retain failure with distinct safe branch origins', async () => {
  await fixture({ unavailable: true }, async page => {
    const seen = []; assert.equal(await be6NormalSurfaceUnavailable(page, x => seen.push(x)), true); assert.equal(seen[0].origin, 'DATA_UNAVAILABLE_BADGE');
  });
  await fixture({}, async (page, loaded) => {
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    const seen = []; assert.equal(await compatibilityNormalSurfaceReason(spec, page, loaded, '', { timeoutMs: 0, observe: x => seen.push(x) }), 'UNAVAILABLE_SURFACE');
    assert.equal(seen[0].origin, 'DASHBOARD_PANEL_HIDDEN');
  });
});

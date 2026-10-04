import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { acquireCompatibilityBrowserIsolation, COMPATIBILITY_BACKGROUND_SYNC_LOCK, compatibilityBrowserIsolationVerified,
  compatibilityTelemetryScriptExcluded, assertCompatibilityWorkspacePreferences } from '../scripts/lib/compatibility-browser-isolation.mjs';
import { COMPATIBILITY_NORMAL_MODULES, compatibilityNormalModuleTerminalReason } from '../scripts/runtime-compatibility-normal-role.mjs';
const origin = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const version = { commit: 'f'.repeat(40), deploymentId: 'dpl_offlineFixture', provenance: { sourceDigest: 'b'.repeat(64), releaseEligible: true } };
const harnessSha = 'c'.repeat(40);
const binding = { candidateUrl: origin, sha: version.commit, deploymentId: version.deploymentId, sourceDigest: version.provenance.sourceDigest, harnessSha };
const names = COMPATIBILITY_NORMAL_MODULES.map(row => row.module);
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture({ observed = version, contentType = 'application/json', setup } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const calls = { mockDocuments: 0, providerCalls: 0, forwardedWrites: 0 };
  if (setup) await setup(context);
  await context.route('**/*', async route => {
    const target = new URL(route.request().url());
    if (target.origin !== origin) { await route.abort(); assert.fail('Unexpected offline origin'); }
    if (route.request().method() !== 'GET') { await route.abort(); assert.fail('Unexpected offline write'); }
    calls.mockDocuments += 1;
    await route.fulfill({ status: 200, contentType, body: target.pathname === '/app-version.json' ? JSON.stringify(observed) : '<!doctype html><html><body>Offline lock contender</body></html>' });
  });
  return { context, calls };
}
const contender = page => page.evaluate(async name => {
  const channel = new BroadcastChannel('fcos:email-router-background-sync-events');
  try { return await navigator.locks.request(name, { ifAvailable: true }, lock => Boolean(lock)); }
  finally { channel.close(); }
}, COMPATIBILITY_BACKGROUND_SYNC_LOCK);

test('actual same-context holder excludes automatic synchronization across all 15 pages and explicitly releases', async () => {
  const { context, calls } = await fixture();
  let isolation;
  try {
    isolation = await acquireCompatibilityBrowserIsolation({ context, origin, version, harnessSha });
    for (const name of names) {
      await isolation.assertHeld(name, 'before');
      const page = await context.newPage();
      await page.goto(`${origin}/offline-${name}`);
      assert.equal(await contender(page), false, `${name} must not acquire sync lock`);
      await page.close();
      await isolation.assertHeld(name, 'after');
    }
    await isolation.assertHeld(undefined, 'final');
    await isolation.release();
    assert.equal(context.pages().length, 0, 'guardian is closed after explicit completion');
    const page = await context.newPage();
    await page.goto(`${origin}/after-release`);
    assert.equal(await contender(page), true, 'real lock is free after explicit release');
    await page.close();
    await context.close();
    const proof = isolation.evidence({ workspacePreferences: assertCompatibilityWorkspacePreferences({ preferences: { initialized: true } }),
      telemetryAbortedRequests: 0, blockedRequests: 0, contextClosed: true });
    assert.equal(compatibilityBrowserIsolationVerified(proof, binding, names), true);
    assert.deepEqual(calls, { mockDocuments: 17, providerCalls: 0, forwardedWrites: 0 });
  } finally { await context.close(); }
});

test('real Web Lock is scoped to the exact browser context storage partition', async () => {
  const a = await fixture(), b = await fixture();
  const isolation = await acquireCompatibilityBrowserIsolation({ context: a.context, origin, version, harnessSha });
  try {
    const same = await a.context.newPage(), separate = await b.context.newPage();
    await same.goto(`${origin}/same`); await separate.goto(`${origin}/separate`);
    assert.equal(await contender(same), false);
    assert.equal(await contender(separate), true);
    await isolation.release();
  } finally { await a.context.close(); await b.context.close(); }
});

test('guardian rejects changed provenance or HTML before acquiring a lock and closes itself', async () => {
  for (const settings of [{ observed: { ...version, commit: 'a'.repeat(40) } }, { contentType: 'text/html' },
    { observed: { ...version, provenance: { ...version.provenance, releaseEligible: false } } }]) {
    const { context } = await fixture(settings);
    try {
      await assert.rejects(() => acquireCompatibilityBrowserIsolation({ context, origin, version, harnessSha }), /guardian/i);
      assert.equal(context.pages().length, 0);
    } finally { await context.close(); }
  }
});

test('both real Web Locks and BroadcastChannel are required; unavailable capabilities fail closed', async () => {
  for (const capability of ['locks', 'BroadcastChannel']) {
    const { context } = await fixture({ setup: c => c.addInitScript(name => {
      if (name === 'locks') Object.defineProperty(navigator, 'locks', { value: undefined });
      else Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined });
    }, capability) });
    try {
      await assert.rejects(() => acquireCompatibilityBrowserIsolation({ context, origin, version, harnessSha }), /could not be acquired/);
      assert.equal(context.pages().length, 0);
    } finally { await context.close(); }
  }
});

test('existing holder prevents acquisition; guardian loss cannot produce accepted isolation evidence', async () => {
  const { context } = await fixture();
  const original = await acquireCompatibilityBrowserIsolation({ context, origin, version, harnessSha });
  try {
    await assert.rejects(() => acquireCompatibilityBrowserIsolation({ context, origin, version, harnessSha }), /could not be acquired/);
    assert.equal(context.pages().length, 1);
    await context.pages()[0].close();
    await assert.rejects(() => original.assertHeld('dashboard', 'before'), /lifetime/);
    await assert.rejects(() => original.release(), /lifetime/);
    const proof = original.evidence({ workspacePreferences: { initialized: true }, telemetryAbortedRequests: 0, blockedRequests: 0, contextClosed: true });
    assert.equal(compatibilityBrowserIsolationVerified(proof, binding, names), false);
  } finally { await context.close(); }
});

test('optional telemetry script is aborted before execution in actual Chromium; near variants are not exclusions', async () => {
  const { context } = await fixture();
  let excluded = 0, scriptFetches = 0;
  await context.route('**/_vercel/speed-insights/**', async route => {
    const request = route.request();
    if (compatibilityTelemetryScriptExcluded({ url: request.url(), method: request.method(), resourceType: request.resourceType() }, origin)) {
      excluded += 1; await route.abort();
    } else { scriptFetches += 1; await route.abort(); }
  });
  try {
    const page = await context.newPage(); await page.goto(`${origin}/offline`);
    await page.evaluate(async () => {
      const script = document.createElement('script'); script.src = '/_vercel/speed-insights/script.js';
      await new Promise(resolve => { script.onload = resolve; script.onerror = resolve; document.head.appendChild(script); });
    });
    assert.equal(excluded, 1); assert.equal(scriptFetches, 0);
    for (const altered of [{ url: `${origin}/_vercel/speed-insights/script.js?x=1` }, { url: 'https://foreign.example/_vercel/speed-insights/script.js' },
      { method: 'POST' }, { method: 'HEAD' }, { resourceType: 'fetch' }, { functionName: 'authContext' }, { body: {} }]) {
      assert.equal(compatibilityTelemetryScriptExcluded({ url: `${origin}/_vercel/speed-insights/script.js`, method: 'GET', resourceType: 'script', ...altered }, origin), false);
    }
  } finally { await context.close(); }
});



test('actual delayed application pageerror remains fatal after tentative successful coverage', async () => {
  const { context } = await fixture();
  try {
    const page = await context.newPage(), failures = [];
    page.on('pageerror', () => failures.push('PAGE_ERROR'));
    await page.goto(`${origin}/offline-late-error`);
    assert.equal(compatibilityNormalModuleTerminalReason({ failures }), null);
    const observed = page.waitForEvent('pageerror');
    await page.evaluate(() => { setTimeout(() => { throw new Error('Offline delayed page failure'); }, 0); });
    await observed;
    await page.close();
    assert.equal(compatibilityNormalModuleTerminalReason({ failures }), 'PAGE_ERROR');
  } finally { await context.close(); }
});

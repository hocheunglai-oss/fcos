import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  NAVIGATION_CACHE_POLICIES,
  navigationCacheDecision,
  navigationCacheOptions,
} from '../src/lib/navigationCachePolicy.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('defines separate operational, collaboration, and reference freshness windows', () => {
  assert.deepEqual(NAVIGATION_CACHE_POLICIES.operational, {
    freshMs: 180_000,
    maxStaleMs: 1_800_000,
  });
  assert.deepEqual(NAVIGATION_CACHE_POLICIES.collaboration, {
    freshMs: 30_000,
    maxStaleMs: 300_000,
  });
  assert.deepEqual(NAVIGATION_CACHE_POLICIES.reference, {
    freshMs: 600_000,
    maxStaleMs: 86_400_000,
  });
});

test('returns fresh, stale, expired, miss, and forced-bypass decisions at exact boundaries', () => {
  const policy = NAVIGATION_CACHE_POLICIES.operational;
  assert.equal(navigationCacheDecision({ ...policy, hasEntry: false }), 'miss');
  assert.equal(navigationCacheDecision({ ...policy, hasEntry: true, ageMs: policy.freshMs }), 'fresh');
  assert.equal(navigationCacheDecision({ ...policy, hasEntry: true, ageMs: policy.freshMs + 1 }), 'stale');
  assert.equal(navigationCacheDecision({ ...policy, hasEntry: true, ageMs: policy.maxStaleMs }), 'stale');
  assert.equal(navigationCacheDecision({ ...policy, hasEntry: true, ageMs: policy.maxStaleMs + 1 }), 'expired');
  assert.equal(navigationCacheDecision({ ...policy, hasEntry: true, force: true }), 'bypass');
});

test('builds navigation-aware invocation options and falls back to the operational policy', () => {
  const callback = () => {};
  assert.deepEqual(navigationCacheOptions('collaboration', callback), {
    cache: true,
    navigationAware: true,
    cacheTtlMs: 30_000,
    maxStaleMs: 300_000,
    onBackgroundUpdate: callback,
  });
  assert.equal(navigationCacheOptions('unknown').cacheTtlMs, 180_000);
});

test('the shared client isolates users, deduplicates requests, bounds memory, and bypasses server cache on Refresh', () => {
  const client = read('src/api/appClient.js');
  assert.match(client, /scope: data\?\.session\?\.user\?\.id \|\| 'anonymous'/);
  assert.match(client, /const cacheKey = rawCacheKey \? `\$\{authContext\.scope\}:\$\{rawCacheKey\}` : null/);
  assert.match(client, /inFlightFunctionRequests/);
  assert.match(client, /MAX_FUNCTION_CACHE_ENTRIES = 24/);
  assert.match(client, /functionCacheGeneration/);
  assert.match(client, /x-fcos-cache-bypass/);
  assert.match(client, /decision === 'stale'/);
  assert.match(client, /onBackgroundUpdate/);
  assert.match(client, /isMutationHandler\(name\)/);
});

test('page loaders use navigation policies while live workflows and mutations retain force behavior', () => {
  const operationalPages = [
    'src/pages/DashboardSettings.jsx',
    'src/pages/CashflowForecast.jsx',
    'src/pages/UnofficialCompensation.jsx',
    'src/pages/BrokerRegister.jsx',
  ];
  const collaborationPages = [
    'src/pages/BuyerInvoices.jsx',
    'src/pages/IncomingPayments.jsx',
    'src/pages/DisputeWorkflow.jsx',
    'src/pages/ProjectsTasks.jsx',
    'src/pages/GrowthCoaching.jsx',
    'src/pages/MyCommitments.jsx',
    'src/pages/FcosImprovements.jsx',
  ];
  for (const page of operationalPages) assert.match(read(page), /useNavigationAwareRequest\('operational'\)|useNavigationAwareRequest\("operational"\)/, page);
  for (const page of collaborationPages) assert.match(read(page), /useNavigationAwareRequest\('collaboration'\)|useNavigationAwareRequest\("collaboration"\)/, page);
  assert.match(read('src/pages/ReviewQueue.jsx'), /cache: false, force: options\.force/);
  assert.match(read('src/pages/PaymentCollections.jsx'), /paymentCollectionsReconcile[\s\S]*\{ force \}/);
});

test('data freshness is visible and explained to users', () => {
  const status = read('src/components/common/DataStatus.jsx');
  const methodologies = read('src/lib/pageMethodologies.js');
  assert.match(status, /status === 'STALE'/);
  assert.match(status, /label: 'Updating'/);
  assert.match(status, /Cached · Refresh failed/);
  assert.match(status, /showing cached data while a live refresh completes/);
  assert.match(methodologies, /Operational data stays fresh for three minutes/);
  assert.match(methodologies, /Refresh button always bypasses browser and server caches/);
});

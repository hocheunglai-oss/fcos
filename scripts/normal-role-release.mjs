import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { normalRoleReadRequest } from './lib/normal-role-read-requests.mjs';
import { createNormalRoleVerificationRoute } from './lib/normal-role-verification-transport.mjs';
import { canonicalFcosE2eCandidateUrl, resolveFcosE2eCandidate } from './verify-e2e-candidate.mjs';
import { collectRuntimeObservation } from './collect-preview-parity.mjs';

// Every pass needs a successful module data response and a rendered business
// surface. Headings alone, an invented zero, and denied/unavailable data fail.
export const NORMAL_ROLE_MODULES = Object.freeze([
  { module: 'dashboard', path: '/', handler: 'dashboardStemList', fields: ['stems'], title: /Dashboard/i },
  { module: 'markets', path: '/markets', handler: 'hedgeMarkets', fields: ['mops'], title: /Markets/i },
  { module: 'review', path: '/review', handler: 'salesforceDashboardFiltered', fields: ['recentStems'], title: /Exception Review/i, workflow: true },
  { module: 'disputes', path: '/disputes', handler: 'disputeWorkflowList', fields: ['rows'], title: /Dispute Workflow/i, workflow: true },
  { module: 'buyer_invoices', path: '/payment-collections?tab=collections', handler: 'buyerInvoiceCollectionList', fields: ['items'], title: /Payment Collections/i },
  { module: 'unofficial_compensation', path: '/unofficial-compensation', handler: 'unofficialCompensationList', fields: ['accounts'], title: /Unofficial Compensation|Agreed Compensation/i },
  { module: 'incoming_payments', path: '/payment-collections?tab=incoming', handler: 'incomingPaymentsList', fields: ['rows', 'payments'], title: /Payment Collections/i },
  { module: 'cashflow_forecast', path: '/cashflow-forecast', handler: 'cashflowForecast', fields: ['rows'], title: /Cashflow/i },
  { module: 'brokers', path: '/brokers', handler: 'salesforceBrokerRegister', fields: ['rows'], title: /Broker/i },
  { module: 'master_contracts', path: '/master-contracts', handler: 'masterContractsList', fields: ['contracts'], title: /Master Contracts/i },
  { module: 'special_terms', path: '/special-terms', handler: 'specialTermsSummaryList', fields: ['terms', 'items', 'rows'], title: /Special Terms/i },
  { module: 'hedge_desk', path: '/hedge-desk', handler: 'hedgeDeskEntity', fields: ['physicals'], title: /Hedge Desk|Position control/i },
  { module: 'xero_portal', path: '/xero-portal', handler: 'xeroIntegrityReport', fields: ['rows'], title: /Salesforce–Xero integrity/i },
  { module: 'email_router', path: '/email-router', handler: 'emailRouterList', fields: ['messages', 'items'], title: /Email Router/i },
  { module: 'settings', path: '/settings?section=finance', handler: 'financeSettingsGet', fields: [], title: /Finance settings|Settings/i },
]);

const XERO_INTEGRITY_COVERAGE = Object.freeze(['sales', 'bills', 'payments', 'contacts']);
const XERO_INTEGRITY_KINDS = new Set(['buyer_invoice', 'buyer_credit', 'supplier_bill', 'supplier_credit', 'payment', 'contact']);
const XERO_INTEGRITY_STATUSES = new Set(['matched', 'missing', 'mismatched', 'blocked', 'uncertain', 'unverified']);
const XERO_INTEGRITY_REQUEST_KEYS = new Set(['from', 'to', 'search', 'status', 'kind', 'page', 'pageSize', 'historyPage', 'historyPageSize']);

function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safeCount(value) { return Number.isSafeInteger(value) && value >= 0; }
function isoInstant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function normalRoleXeroIntegrityRequest(body) {
  if (!plainObject(body) || Object.keys(body).some(key => !XERO_INTEGRITY_REQUEST_KEYS.has(key))) return false;
  if (body.from !== undefined && !isoDate(body.from) || body.to !== undefined && body.to !== null && !isoDate(body.to)
    || body.from && body.to && body.from > body.to || body.search !== undefined && (typeof body.search !== 'string' || body.search.length > 200)
    || body.status !== undefined && !['all', ...XERO_INTEGRITY_STATUSES].includes(body.status)
    || body.kind !== undefined && !['all', ...XERO_INTEGRITY_KINDS].includes(body.kind)) return false;
  for (const key of ['page', 'historyPage']) if (body[key] !== undefined && (!Number.isSafeInteger(body[key]) || body[key] < 1 || body[key] > 100000)) return false;
  for (const key of ['pageSize', 'historyPageSize']) if (body[key] !== undefined && (!Number.isSafeInteger(body[key]) || body[key] < 1 || body[key] > 100)) return false;
  return true;
}

export function normalRolePortalActionsReadOnly(labels) {
  return Array.isArray(labels) && labels.every(label => typeof label === 'string'
    && !/\b(?:review|sync|upload|correct(?:ion)?|approve|apply|save|submit)\b/i.test(label));
}

export function normalRoleXeroPortalLoadFailed(alerts) {
  return !Array.isArray(alerts) || alerts.some(alert => typeof alert !== 'string'
    || /\b(?:access denied|saved evidence is unavailable|unsupported result|could not (?:load|read|verify)|temporarily unavailable|something went wrong)\b/i.test(alert));
}

export function normalRoleXeroReportIncludesSearch(report, search) {
  const needle = typeof search === 'string' ? search.trim().toLowerCase() : '';
  return Boolean(needle && Array.isArray(report?.rows) && report.rows.some(row =>
    [row.documentNumber, row.stemReference, row.accountName, row.reason].some(value => String(value || '').toLowerCase().includes(needle))));
}

function validIntegrityCoverage(report) {
  if (!Array.isArray(report.coverage) || report.coverage.length !== XERO_INTEGRITY_COVERAGE.length) return false;
  const coverage = new Map(report.coverage.map(row => [row?.key, row]));
  if (coverage.size !== XERO_INTEGRITY_COVERAGE.length || XERO_INTEGRITY_COVERAGE.some(key => !coverage.has(key))) return false;
  for (const key of XERO_INTEGRITY_COVERAGE) {
    const row = coverage.get(key);
    if (!plainObject(row) || typeof row.available !== 'boolean' || typeof row.complete !== 'boolean' || typeof row.notice !== 'string'
      || row.checkedAt !== null && !isoInstant(row.checkedAt)) return false;
    if (!row.available && (row.complete || row.total !== null)) return false;
    if (row.available && !safeCount(row.total)) return false;
    if (row.complete && !row.available) return false;
  }
  // A saved document report is the evidence source for the portal. Payment
  // capture may be unavailable or partial without making document evidence up.
  return coverage.get('sales').available === true && coverage.get('bills').available === true;
}

export function normalXeroIntegrityReportLoaded(payload) {
  const report = payload?.data ?? payload;
  if (!plainObject(report) || report.error || report.cancelled || report.status === 'unavailable' || report.schemaVersion !== 1
    || !isoInstant(report.generatedAt) || !plainObject(report.scope) || report.scope.dateBasis !== 'buyer_invoice_delivery_date'
    || report.scope.contactsDateBound !== false || report.scope.universeTotal !== null || !validIntegrityCoverage(report)
    || !Array.isArray(report.rows) || !Array.isArray(report.history) || !Array.isArray(report.currencyTotals) || !Array.isArray(report.notices)
    || !plainObject(report.pagination) || !plainObject(report.historyPagination) || !plainObject(report.metrics) || !plainObject(report.health)) return { loaded: false, rows: null };
  const metrics = ['checked', ...XERO_INTEGRITY_STATUSES];
  if (metrics.some(key => !(key in report.metrics))) return { loaded: false, rows: null };
  if (report.metrics.checked === null) {
    if (metrics.some(key => report.metrics[key] !== null)) return { loaded: false, rows: null };
  } else if (!safeCount(report.metrics.checked) || [...XERO_INTEGRITY_STATUSES].some(key => !safeCount(report.metrics[key]))
    || [...XERO_INTEGRITY_STATUSES].reduce((total, key) => total + report.metrics[key], 0) !== report.metrics.checked) return { loaded: false, rows: null };
  const pagination = report.pagination;
  if (!safeCount(pagination.page) || !safeCount(pagination.pageSize) || !safeCount(pagination.total) || typeof pagination.hasNext !== 'boolean'
    || pagination.page < 1 || pagination.pageSize < 1 || pagination.pageSize > 100 || report.rows.length > pagination.pageSize || report.rows.length > pagination.total) return { loaded: false, rows: null };
  if (report.metrics.checked !== null && pagination.total > report.metrics.checked) return { loaded: false, rows: null };
  if (report.rows.some(row => !plainObject(row) || typeof row.id !== 'string' || !row.id || !XERO_INTEGRITY_KINDS.has(row.kind)
    || !XERO_INTEGRITY_STATUSES.has(row.status) || !isoInstant(row.checkedAt) || !plainObject(row.sourceValues) || !plainObject(row.xeroValues)
    || !Array.isArray(row.differences))) return { loaded: false, rows: null };
  if (!report.currencyTotals.every(row => plainObject(row) && /^[A-Z]{3}$/.test(row.currency || '') && safeCount(row.recordCount))
    || !report.notices.every(value => typeof value === 'string')) return { loaded: false, rows: null };
  return { loaded: true, rows: report.rows.length, report };
}

export function normalRoleRequestAllowed({ url, method, body }, origin) {
  let target;
  try { target = new URL(url); } catch { return false; }
  const supabaseOrigin = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
  if (method === 'GET' || method === 'HEAD') {
    if (target.origin === supabaseOrigin) return /^\/auth\/v1\/user$/.test(target.pathname)
      || /^\/rest\/v1\/[A-Za-z][A-Za-z0-9_]*$/.test(target.pathname);
    if (target.origin !== origin) return false;
    // GET alone is not read authority: cron and other APIs can have side effects.
    if (target.pathname !== '/api' && !target.pathname.startsWith('/api/')) return true;
    return false;
  } else if (method !== 'POST') return false;
  if (target.origin !== origin || !target.pathname.startsWith('/api/functions/')) return false;
  const name = target.pathname.slice('/api/functions/'.length);
  if (!/^[A-Za-z][A-Za-z0-9]+$/.test(name)) return false;
  if (name === 'xeroIntegrityReport') return normalRoleXeroIntegrityRequest(body || {});
  return normalRoleReadRequest(name, body || {});
}

export function assertNormalRoleIdentity(auth, { approvedEmail } = {}) {
  const user = auth?.user;
  if (!approvedEmail || approvedEmail.toLowerCase() === FCOS_READ_ONLY_CI.email || user?.email?.toLowerCase() !== approvedEmail.toLowerCase()
    || user?.read_only_ci !== false || user?.active !== true || !/^[0-9a-f-]{36}$/.test(user.id || '')
    || !['normal', 'general_manager', 'administrator', 'manager', 'finance', 'operations', 'interoffice', 'viewer'].includes(user.user_type)) throw new Error('Normal-role verification requires the existing approved active non-CI identity, independently read from FCOS.');
  return { role: user.user_type, moduleAccess: auth.moduleAccess || {} };
}

export function normalModuleDataLoaded(spec, payload) {
  const data = payload?.data ?? payload;
  if (!data || typeof data !== 'object' || data.error || data.cancelled || data.status === 'unavailable') return { loaded: false, rows: null };
  if (spec.module === 'xero_portal') return normalXeroIntegrityReportLoaded(data);
  if (spec.module === 'settings') return { loaded: Boolean(data.settings && Number.isFinite(Number(data.settings.annualInterestRatePct))
    && Number.isFinite(Number(data.settings.bankChargesUsd?.UBS)) && Number.isFinite(Number(data.settings.bankChargesUsd?.DBS))), rows: null };
  for (const key of spec.fields) if (Array.isArray(data[key])) return { loaded: true, rows: data[key].length };
  return { loaded: false, rows: null };
}

function normalStorage(source, origin) {
  let state;
  try { state = JSON.parse(Buffer.from(source || '', 'base64').toString('utf8')); } catch { throw new Error('Approved private normal-role browser state is unavailable.'); }
  if (!Array.isArray(state.origins) || !Array.isArray(state.cookies) || state.origins.some(entry => entry.origin !== origin)
    || state.cookies.some(cookie => cookie.domain?.replace(/^\./, '') !== new URL(origin).hostname)) throw new Error('Private normal-role browser state must be restricted to the exact immutable Preview.');
  const key = `sb-${fcosConnectionIdentifier('supabase', 'Project ref')}-auth-token`;
  const entry = state.origins.find(item => item.origin === origin)?.localStorage?.find(item => item.name === key);
  let token;
  try { token = JSON.parse(entry.value).access_token; } catch { /* Expired/missing sessions stay blocked. */ }
  if (!token || typeof token !== 'string') throw new Error('An existing normal-role session is required; this harness cannot sign in or refresh credentials.');
  return { state, token };
}

export async function verifyNormalRoleRelease({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.FCOS_NORMAL_ROLE_E2E_ENABLED !== 'true' || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('Separate normal-role verification is disabled until its identity and protected environment are explicitly approved.');
  const url = canonicalFcosE2eCandidateUrl(env.FCOS_E2E_CANDIDATE_URL);
  const verified = await resolveFcosE2eCandidate({ candidateUrl: url, expectedCommit: env.FCOS_E2E_EXPECTED_COMMIT,
    githubToken: env.GITHUB_TOKEN, protectionBypass: env.FCOS_E2E_VERCEL_BYPASS, fetchImpl, maxWaitMs: 0 });
  const versionResponse = await fetchImpl(`${url}/app-version.json`, { redirect: 'error',
    headers: env.FCOS_E2E_VERCEL_BYPASS ? { 'x-vercel-protection-bypass': env.FCOS_E2E_VERCEL_BYPASS } : {}, signal: AbortSignal.timeout(20000) });
  const version = await versionResponse.json();
  if (!versionResponse.ok || versionResponse.redirected || version.commit !== verified.commit || !version.deploymentId
    || !/^[0-9a-f]{64}$/.test(version.provenance?.sourceDigest || '') || version.provenance.releaseEligible !== true) throw new Error('Normal-role verification requires exact clean deployment provenance.');
  const runtime = await collectRuntimeObservation({ url, deployment: { id: version.deploymentId, url, sha: verified.commit, createdAt: version.builtAt },
    sourceDigest: version.provenance.sourceDigest, token: env.FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN, protectionBypass: env.FCOS_E2E_VERCEL_BYPASS, fetchImpl });
  if (!runtime || runtime.safety.readOnly !== true || Object.values(runtime.safety.externalActions).some(value => value !== false)) throw new Error('Normal-role Preview verification requires fresh read-only runtime safety proof.');
  const { state, token } = normalStorage(env.FCOS_NORMAL_ROLE_STORAGE_STATE_BASE64, url);
  const response = await fetchImpl(`${url}/api/functions/authContext`, { method: 'POST', body: '{}', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
      ...(env.FCOS_E2E_VERCEL_BYPASS ? { 'x-vercel-protection-bypass': env.FCOS_E2E_VERCEL_BYPASS } : {}) } });
  if (!response.ok || response.redirected) throw new Error('The approved normal-role session could not be independently authenticated.');
  const identity = assertNormalRoleIdentity(await response.json(), { approvedEmail: env.FCOS_NORMAL_ROLE_APPROVED_EMAIL });
  let browser, context;
  const checks = [];
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    let blockedMutations = 0;
    await context.route('**/*', createNormalRoleVerificationRoute({ origin: url, protectionBypass: env.FCOS_E2E_VERCEL_BYPASS,
      requestAllowed: normalRoleRequestAllowed, onBlockedMutation: () => { blockedMutations += 1; } }));
    for (const spec of NORMAL_ROLE_MODULES) {
      if (identity.moduleAccess[spec.module] !== true) continue;
      const page = await context.newPage(), responses = [], failures = [];
      let reviewWorkflowLoaded = false;
      const mutationStart = blockedMutations;
      page.on('pageerror', () => failures.push('PAGE_ERROR'));
      page.on('response', async res => {
        if (spec.module === 'review' && new URL(res.url()).pathname === '/api/functions/exceptionReviewWorkflowList') {
          try { const data = await res.json(); reviewWorkflowLoaded = res.ok() && !data.error && data.byStemId !== null
            && typeof data.byStemId === 'object' && !Array.isArray(data.byStemId) && Array.isArray(data.ownerOptions); } catch { /* Unknown workflow stays blocked. */ }
        }
        if (new URL(res.url()).pathname !== `/api/functions/${spec.handler}`) return;
        try { if (res.ok()) responses.push(normalModuleDataLoaded(spec, await res.json())); } catch { failures.push('RESPONSE_INVALID'); }
      });
      try {
        await page.goto(`${url}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.getByRole('heading', { name: spec.title }).first().waitFor({ timeout: 30000 });
        const deadline = Date.now() + 30000;
        while (!responses.some(item => item.loaded) && Date.now() < deadline) await page.waitForTimeout(250);
        const loaded = responses.find(item => item.loaded);
        if (!loaded || failures.length || blockedMutations !== mutationStart || /\/login(?:\?|$)/.test(page.url())) continue;
        const body = await page.locator('body').innerText();
        if (spec.module !== 'xero_portal' && /Access denied|Something went wrong|temporarily unavailable|could not (?:load|read|verify)|Unavailable/i.test(body)) continue;
        if (spec.module === 'settings') {
          if (!await page.getByLabel(/Annual interest rate/i).count()) continue;
        } else if (spec.module === 'xero_portal') {
          // The portal must prove a genuine saved report, then exercise only its
          // read workflow: filter a rendered record and reveal its comparison.
          // No evidence is invented when the report has no usable row.
          if (!loaded.report || loaded.rows < 1) continue;
          const actionLabels = await page.locator('button, [role="button"]').evaluateAll(elements => elements.map(element =>
            [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title')].filter(Boolean).join(' ')));
          if (!normalRolePortalActionsReadOnly(actionLabels)) continue;
          const searchTerm = loaded.report.rows.map(row => [row.documentNumber, row.stemReference, row.accountName]
            .find(value => typeof value === 'string' && value.trim().length >= 2)).find(Boolean);
          if (!searchTerm) continue;
          const responseCount = responses.length;
          await page.getByLabel('Search records').fill(searchTerm);
          const searchDeadline = Date.now() + 30000;
          while (!responses.slice(responseCount).some(item => item.loaded) && Date.now() < searchDeadline) await page.waitForTimeout(250);
          const searched = responses.slice(responseCount).find(item => item.loaded);
          if (!searched?.report || !normalRoleXeroReportIncludesSearch(searched.report, searchTerm)) continue;
          const evidence = page.locator('section[aria-labelledby="evidence-heading"]');
          const renderedSearch = await evidence.locator('tbody tr').evaluateAll((rows, term) => rows.some(row =>
            (row.innerText || '').toLowerCase().includes(String(term).toLowerCase())), searchTerm);
          if (!renderedSearch) continue;
          const comparison = evidence.locator('details.xi-details').filter({ hasText: 'Compare values' }).first();
          if (!await comparison.count()) continue;
          await comparison.locator('summary').click();
          if (!await comparison.evaluate(node => node.open)) continue;
          const comparisonValues = comparison.locator('.xi-value-comparison');
          if (!await comparisonValues.count() || !await comparisonValues.getByText('Salesforce', { exact: true }).count()
            || !await comparisonValues.getByText('Xero', { exact: true }).count()) continue;
          if (normalRoleXeroPortalLoadFailed(await page.locator('[role="alert"]').allInnerTexts())) continue;
        } else if (loaded.rows === 0) {
          if (!/No (?:records|rows|items|invoices|payments|receipts|messages|contracts|terms|trades|positions|data|STEMs|matching|Dispute Workflow)/i.test(body)) continue;
        } else if (!await page.locator('table tbody tr').count()) continue;
        if (spec.workflow) {
          if (spec.module === 'review') {
            // Exercise read-only queue scope and confirm workflow state remains
            // rendered after filtering; no Save/Approve/Settle control is used.
            await page.getByRole('button', { name: 'All', exact: true }).click();
            if (!await page.locator('table tbody tr').count() && !/No .*found|No .*match/i.test(await page.locator('body').innerText())) continue;
            if (!reviewWorkflowLoaded || !responses.some(item => item.loaded)) continue;
          } else if (!/Workflow|Next owner/i.test(body) || loaded.rows === 0) continue;
        }
        checks.push({ module: spec.module, role: identity.role, result: 'pass', kind: spec.workflow ? 'workflow_read' : 'read',
          evidenceId: `normal-role:${env.GITHUB_RUN_ID}:${spec.module}` });
      } catch { /* Keep this module missing; never serialize private page errors. */ }
      finally { await page.close(); }
    }
    if (blockedMutations) throw new Error('The application attempted a non-read request during normal-role verification. It was blocked; no complete coverage can be published.');
  } finally { if (context) await context.close(); if (browser) await browser.close(); }
  const evidence = { schemaVersion: 1, candidateSha: verified.commit, candidateUrl: url, deploymentId: version.deploymentId,
    sourceDigest: version.provenance.sourceDigest, harnessSha: env.GITHUB_SHA, capturedAt: new Date().toISOString(), checks };
  if (!env.RUNNER_TEMP) throw new Error('A private runner evidence directory is required.');
  writeFileSync(join(env.RUNNER_TEMP, 'fcos-normal-role-evidence.json'), `${JSON.stringify(evidence)}\n`, { mode: 0o600, flag: 'wx' });
  if (checks.length !== NORMAL_ROLE_MODULES.length) throw new Error(`Normal-role coverage remains incomplete (${checks.length}/${NORMAL_ROLE_MODULES.length}). Missing or unavailable workflows stay blocked.`);
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyNormalRoleRelease().then(result => console.log(`Verified ${result.checks.length} normal-role read workflows for ${result.candidateSha}.`))
    .catch(() => { console.error('Normal-role verification blocked. Verify its separately approved identity, protected harness and exact read-only Preview; private diagnostics suppressed.'); process.exitCode = 1; });
}

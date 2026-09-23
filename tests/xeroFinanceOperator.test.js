import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/xero-finance-operator.mjs';
import { parseOperatorArgs, readHumanSessionFile, resolveOperatorOrigin, runXeroFinanceOperator } from '../scripts/lib/xero-finance-operator.mjs';

const userId = 'd1e772f5-9c10-4566-99b3-67f4c4e75a62';
const runId = '6119b7d1-e147-49c9-8fc0-4ad8495762ab';
const documentId = '8d69b57a-2b08-45af-a3cd-b85ec0a506cb';
const paymentId = 'a01000000000001AAA';
const tenantId = 'f0a97252-7bc7-47b6-a8cf-ef381671aeca';
const contactId = '0cb5d302-8f2d-4b08-8902-0553d01df644';
const fingerprint = 'a'.repeat(64);
const missingAccountId = '001000000000001AAA';
const contactRun = { id: runId, state: 'previewed', xero: { tenantId }, summary: { total: 2, blocked: 1 }, rows: [
  { id: 'xero-only-row', xeroContactId: contactId, xeroContactName: 'Independent Buyer', xeroContactStatus: 'ACTIVE',
    reason: 'used-unmatched-xero-contact', action: 'exception', status: 'blocked', identityFingerprint: fingerprint,
    identityDecision: null, access_token: 'SECRET' },
  { id: 'missing-contact-row', salesforceAccountId: missingAccountId, salesforceName: 'Missing Buyer',
    reason: 'missing-xero-contact', action: 'exception', status: 'blocked' },
] };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, role: 'authenticated', iss: 'https://pjforfvchygdyqfcgpmw.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
const auth = { user: { id: userId, email: 'finance@example.test', active: true, read_only_ci: false },
  moduleAccess: { xero_portal: true }, capabilities: { xero_portal_manage: true } };
const document = { id: documentId, documentNumber: 'INV-1', action: 'create_draft', status: 'eligible', currency: 'USD', total: 200,
  sourceFingerprint: 'source', reviewFingerprint: 'review', blockers: [] };
const payment = { salesforcePaymentId: paymentId, salesforcePaymentName: 'PAY-1', action: 'payment_apply', status: 'eligible',
  sourceFingerprint: 'payment-source', reviewFingerprint: 'payment-review', blockers: [] };
const preview = { run: { id: runId, status: 'ready_for_review', postingMode: 'draft', revision: 3 }, rows: [document],
  payments: { rows: [payment], summary: { total: 1 } }, summary: { total: 1, eligible: 1 } };

async function sessionFile(t, contents = token) {
  const dir = await mkdtemp(join(tmpdir(), 'fcos-xero-operator-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'session');
  await writeFile(path, contents, { mode: 0o600 });
  return path;
}

async function identityInputFile(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fcos-contact-identity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'reviewed.json');
  await writeFile(path, JSON.stringify({ tenantId, contactId, expectedRevision: 0, expectedFingerprint: fingerprint,
    evidenceNote: 'Reviewed Xero counterparty identity evidence.', evidenceReference: 'Case 42', reviewed: true, ...overrides }), { mode: 0o600 });
  return path;
}

function responses(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const name = new URL(url).pathname.split('/').at(-1);
    calls.push({ name, url, init });
    const data = overrides[name] ?? {
      authContext: auth,
      xeroPortalStatus: { xero: { connected: true }, externalActions: { xero_financial_sync: { enabled: true } } },
      xeroFinancialSyncLatest: { preview },
      xeroFinancialSyncPreview: { ...preview, postingMode: JSON.parse(init.body).postingMode,
        run: { ...preview.run, postingMode: JSON.parse(init.body).postingMode } },
      xeroFinancialSyncApply: { run: { ...preview.run, status: 'authorised', revision: 4 }, selectedCount: 1 },
      xeroFinancialSyncRun: { run: { ...preview.run, status: 'completed', revision: 5 }, summary: { total: 1, created: 1 }, outcomes: [{ id: documentId, status: 'created' }] },
      xeroFinancialPaymentApply: { summary: { total: 1, applied: 1 }, outcomes: [{ salesforcePaymentId: paymentId, status: 'applied' }] },
      xeroFinancialMappingsGet: { productMappings: [], bankMappings: [] },
      xeroPortalContactLifecycleLatest: { run: contactRun },
      xeroPortalContactLifecyclePreview: { run: contactRun },
      xeroContactIdentitySave: { decision: { tenant_id: tenantId, contact_id: contactId, fingerprint, decision: 'verified_xero_only', revision: 1,
        actor_id: userId, actor_email: auth.user.email, access_token: 'SECRET' }, refreshPreview: true },
      xeroContactRepairApply: { runId, summary: { total: 1, created: 1, existing: 0, blocked: 0, uncertain: 0 },
        outcomes: [{ rowId: 'missing-contact-row', status: 'created', xeroContactId: contactId, access_token: 'SECRET' }], refreshPreview: true },
    }[name];
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

const args = (file, ...command) => ['--session-file', file, ...command];

test('production origin is pinned; localhost requires an explicit test opt-in', () => {
  assert.equal(resolveOperatorOrigin(), 'https://fcos.fcuno.com');
  assert.throws(() => resolveOperatorOrigin('https://evil.example'), { code: 'ORIGIN_NOT_PINNED' });
  assert.throws(() => resolveOperatorOrigin('http://localhost:5174'), { code: 'ORIGIN_NOT_PINNED' });
  assert.equal(resolveOperatorOrigin('http://127.0.0.1:5174', true), 'http://127.0.0.1:5174');
  assert.throws(() => resolveOperatorOrigin('https://fcos.fcuno.com@evil.example'), { code: 'ORIGIN_INVALID' });
  assert.throws(() => resolveOperatorOrigin('https://fcos.fcuno.com/other'), { code: 'ORIGIN_INVALID' });
  assert.throws(() => parseOperatorArgs(['--session-file', '/tmp/session', '--token', 'secret', 'status']), { code: 'ARGUMENT_INVALID' });
  assert.throws(() => parseOperatorArgs(['--session-file', '/tmp/session', 'apply', runId]), { code: 'ARGUMENT_INVALID' });
});

test('session file must be owner-only, regular, unlinked, and a human JWT', async (t) => {
  const file = await sessionFile(t);
  assert.equal((await readHumanSessionFile(file)).subject, userId);
  await chmod(file, 0o644);
  await assert.rejects(readHumanSessionFile(file), { code: 'SESSION_UNSAFE' });
  await chmod(file, 0o600);
  const link = `${file}-link`;
  await symlink(file, link);
  await assert.rejects(readHumanSessionFile(link), { code: 'SESSION_UNSAFE' });
  const service = await sessionFile(t, `${encode({ alg: 'HS256' })}.${encode({ sub: userId, role: 'service_role' })}.signature`);
  await assert.rejects(readHumanSessionFile(service), { code: 'SESSION_UNSAFE' });
});

test('each command checks live active identity, module and capability before any finance call', async (t) => {
  const file = await sessionFile(t);
  for (const invalid of [
    { ...auth, user: { ...auth.user, active: false } },
    { ...auth, user: { ...auth.user, id: 'b5e998f5-9b54-478e-9ef1-01f6a457bf5d' } },
    { ...auth, user: { ...auth.user, read_only_ci: true } },
    { ...auth, moduleAccess: { xero_portal: false } },
    { ...auth, capabilities: { xero_portal_manage: false } },
  ]) {
    const { calls, fetchImpl } = responses({ authContext: invalid });
    await assert.rejects(runXeroFinanceOperator(args(file, 'preview'), { fetchImpl }), { code: 'FINANCE_ACCESS_DENIED' });
    assert.deepEqual(calls.map((call) => call.name), ['authContext']);
  }
});

test('preview and mappings use existing handlers, explicit mode, and narrow credential-free output', async (t) => {
  const file = await sessionFile(t, JSON.stringify({ access_token: token }));
  const { calls, fetchImpl } = responses({
    xeroFinancialMappingsGet: { productMappings: [{ direction: 'buyer', salesforceProductId: 'prod', xeroAccountCode: '41100', access_token: 'SECRET' }], bankMappings: [] },
  });
  const result = await runXeroFinanceOperator(args(file, '--show-rows', 'preview', '--mode', 'authorised'), { fetchImpl });
  assert.equal(result.run.postingMode, 'authorised');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { postingMode: 'authorised', includePayments: true, recordExactMatches: false });
  assert.equal(calls.at(-1).init.redirect, 'error');
  assert.equal(calls.at(-1).init.headers.authorization, `Bearer ${token}`);
  const mappings = await runXeroFinanceOperator(args(file, 'mappings', '--show-rows'), { fetchImpl });
  assert.equal(mappings.productMappingCount, 1);
  assert.doesNotMatch(JSON.stringify(mappings), /SECRET|access_token/);
  assert.doesNotMatch(JSON.stringify(result), /signature|access_token/);
});

test('apply and payments require explicit exact row IDs and never select every eligible row', async (t) => {
  const file = await sessionFile(t);
  const { calls, fetchImpl } = responses();
  const applied = await runXeroFinanceOperator(args(file, 'apply', runId, documentId), { fetchImpl });
  assert.equal(applied.selectedCount, 1);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).selectedItemIds, [documentId]);
  const paymentResult = await runXeroFinanceOperator(args(file, 'payments', runId, paymentId), { fetchImpl });
  assert.equal(paymentResult.summary.applied, 1);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).selectedPayments, [{ id: paymentId, sourceFingerprint: 'payment-source', reviewFingerprint: 'payment-review' }]);
  await assert.rejects(runXeroFinanceOperator(args(file, 'apply', runId, 'b890e5d2-f6bd-4567-a040-f7a68a4767b8'), { fetchImpl }), { code: 'ROW_NOT_ELIGIBLE' });
  assert.equal(calls.filter((call) => call.name === 'xeroFinancialSyncApply').length, 1);
});

test('run requires an already authorised saved run; uncertain mutation is never retried or logged', async (t) => {
  const file = await sessionFile(t);
  const fixture = responses();
  await assert.rejects(runXeroFinanceOperator(args(file, 'run', runId), { fetchImpl: fixture.fetchImpl }), { code: 'RUN_NOT_AUTHORISED' });
  assert.equal(fixture.calls.filter((call) => call.name === 'xeroFinancialSyncRun').length, 0);
  const authorised = { ...preview, run: { ...preview.run, status: 'authorised' } };
  let writes = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/xeroFinancialSyncLatest')) return new Response(JSON.stringify({ preview: authorised }), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/xeroFinancialSyncRun')) { writes += 1; throw new Error(`network failed ${token}`); }
    return fixture.fetchImpl(url, init);
  };
  await assert.rejects(runXeroFinanceOperator(args(file, 'run', runId), { fetchImpl }), { code: 'MUTATION_RESULT_UNKNOWN' });
  assert.equal(writes, 1);
  let stderr = '';
  const code = await main(args(file, 'run', runId), { fetchImpl, stdout: { write() {} }, stderr: { write(value) { stderr += value; } } });
  assert.equal(code, 1);
  assert.doesNotMatch(stderr, /signature|network failed|Bearer/);
});

test('contact status and preview expose reviewed identity coordinates without credentials', async (t) => {
  const file = await sessionFile(t);
  const { calls, fetchImpl } = responses();
  const status = await runXeroFinanceOperator(args(file, 'contacts', 'status', '--show-rows'), { fetchImpl });
  assert.equal(status.run.tenantId, tenantId);
  assert.equal(status.rows[0].identityFingerprint, fingerprint);
  assert.doesNotMatch(JSON.stringify(status), /SECRET|access_token/);
  const next = await runXeroFinanceOperator(args(file, 'contacts', 'preview', '--show-rows'), { fetchImpl });
  assert.equal(next.summary.total, 2);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { forceUsageRefresh: false, incrementalUsageRefresh: false });
});

test('verify and revoke require a reviewed owner-only file and current audited row', async (t) => {
  const file = await sessionFile(t);
  const input = await identityInputFile(t);
  const fixture = responses();
  const verified = await runXeroFinanceOperator(args(file, 'contacts', 'verify', '--input-file', input), { fetchImpl: fixture.fetchImpl });
  assert.equal(verified.decision, 'verified_xero_only');
  assert.deepEqual(JSON.parse(fixture.calls.at(-1).init.body), { tenantId, contactId, expectedRevision: 0,
    expectedFingerprint: fingerprint, evidenceNote: 'Reviewed Xero counterparty identity evidence.',
    evidenceReference: 'Case 42', reviewed: true, decision: 'verified_xero_only' });
  assert.doesNotMatch(JSON.stringify(verified), /SECRET|access_token|signature/);
  const current = structuredClone(contactRun);
  current.rows[0].identityDecision = { revision: 1, decision: 'verified_xero_only' };
  const revokeInput = await identityInputFile(t, { expectedRevision: 1 });
  const revocation = responses({ xeroPortalContactLifecycleLatest: { run: current },
    xeroContactIdentitySave: { decision: { tenant_id: tenantId, contact_id: contactId, fingerprint,
      decision: 'revoked', revision: 2, actor_id: userId, actor_email: auth.user.email }, refreshPreview: true } });
  await runXeroFinanceOperator(args(file, 'contacts', 'revoke', '--input-file', revokeInput), { fetchImpl: revocation.fetchImpl });
  assert.equal(JSON.parse(revocation.calls.at(-1).init.body).decision, 'revoked');
  const stale = responses({ xeroPortalContactLifecycleLatest: { run: { ...contactRun,
    rows: [{ ...contactRun.rows[0], identityFingerprint: 'b'.repeat(64) }, contactRun.rows[1]] } } });
  await assert.rejects(runXeroFinanceOperator(args(file, 'contacts', 'verify', '--input-file', input), { fetchImpl: stale.fetchImpl }), { code: 'CONTACT_IDENTITY_STALE' });
  assert.equal(stale.calls.some(({ name }) => name === 'xeroContactIdentitySave'), false);
  const badInput = await identityInputFile(t, { actor: 'impersonated' });
  await assert.rejects(runXeroFinanceOperator(args(file, 'contacts', 'verify', '--input-file', badInput), { fetchImpl: fixture.fetchImpl }), { code: 'IDENTITY_INPUT_INVALID' });
  await chmod(input, 0o644);
  await assert.rejects(runXeroFinanceOperator(args(file, 'contacts', 'verify', '--input-file', input), { fetchImpl: fixture.fetchImpl }), { code: 'IDENTITY_INPUT_INVALID' });
});

test('contact repair uses only explicit eligible rows and never retries uncertain writes', async (t) => {
  const file = await sessionFile(t);
  const fixture = responses();
  const repaired = await runXeroFinanceOperator(args(file, 'contact-repair', runId, 'missing-contact-row'), { fetchImpl: fixture.fetchImpl });
  assert.equal(repaired.summary.created, 1);
  assert.deepEqual(JSON.parse(fixture.calls.at(-1).init.body), { runId, rowIds: ['missing-contact-row'], reviewed: true });
  assert.doesNotMatch(JSON.stringify(repaired), /SECRET|access_token/);
  await assert.rejects(runXeroFinanceOperator(args(file, 'contact-repair', runId, 'xero-only-row'), { fetchImpl: fixture.fetchImpl }), { code: 'ROW_NOT_ELIGIBLE' });
  assert.throws(() => parseOperatorArgs(args(file, 'contact-repair', runId, ...Array.from({ length: 26 }, (_, i) => `row-${i}`))), { code: 'ARGUMENT_INVALID' });
  let writes = 0;
  const uncertainFetch = async (url, init) => {
    if (url.endsWith('/xeroContactRepairApply')) { writes += 1; throw new Error(`lost ${token}`); }
    return fixture.fetchImpl(url, init);
  };
  await assert.rejects(runXeroFinanceOperator(args(file, 'contact-repair', runId, 'missing-contact-row'), { fetchImpl: uncertainFetch }), { code: 'MUTATION_RESULT_UNKNOWN' });
  assert.equal(writes, 1);
});

test('financial row evidence is bounded, row-filtered, and excludes raw payloads and URLs', async (t) => {
  const file = await sessionFile(t);
  const reviewed = { ...document, salesforceObject: 'Invoice__c', salesforceId: 'a02000000000001AAA',
    accountId: '001000000000001AAA', accountName: 'Harbour Buyer', companyCode: 'CL-42', stemId: 'a03000000000001AAA',
    reviewFingerprint: 'b'.repeat(64), blockers: ['Finance must confirm the source date.'], warnings: ['Shared Xero Contact.'],
    differences: [{ field: 'total', xero: 198, salesforce: 200 }, { field: 'detailedLines',
      xero: [{ description: 'Bunker fuel', quantity: 1, unitAmount: 198, lineAmount: 198, accountCode: '41100', taxType: 'NONE', access_token: 'SECRET' }],
      salesforce: [{ description: 'Bunker fuel', quantity: 1, unitAmount: 200, lineAmount: 200, accountCode: '41100', taxType: 'NONE' }] }],
    xero: { id: 'ce2e2a11-813b-4d14-963b-71df7ec212c0', number: 'INV-1', status: 'DRAFT', total: 198, url: 'https://xero.test/private?access_token=SECRET' },
    matchEvidence: { basis: 'document_number', sharedAccounts: [{ accountId: '001000000000001AAA', accountName: 'Harbour Buyer' }],
      candidates: [{ id: 'ce2e2a11-813b-4d14-963b-71df7ec212c0', number: 'INV-1', total: 198, currency: 'USD' }] },
    proposedPayload: { access_token: 'SECRET' }, sourcePayload: { password: 'SECRET' } };
  const { fetchImpl } = responses({ xeroFinancialSyncLatest: { preview: { ...preview, rows: [reviewed] } } });
  const result = await runXeroFinanceOperator(args(file, 'status', '--show-rows', '--row-id', documentId), { fetchImpl });
  assert.equal(result.documents[0].salesforceId, 'a02000000000001AAA');
  assert.equal(result.documents[0].xeroDocumentId, 'ce2e2a11-813b-4d14-963b-71df7ec212c0');
  assert.equal(result.documents[0].reviewFingerprint, 'b'.repeat(64));
  assert.equal(result.documents[0].differences[1].xero[0].accountCode, '41100');
  assert.equal(result.documents[0].blockers[0], 'Finance must confirm the source date.');
  assert.doesNotMatch(JSON.stringify(result), /SECRET|access_token|password|xero\.test/);
  await assert.rejects(runXeroFinanceOperator(args(file, 'status', '--show-rows', '--row-id', 'absent-row'), { fetchImpl }), { code: 'ROW_NOT_FOUND' });
  assert.throws(() => parseOperatorArgs(args(file, 'status', '--row-id', documentId)), { code: 'ARGUMENT_INVALID' });
});

test('malformed successful mutation responses are uncertain and cannot report confirmation', async (t) => {
  const file = await sessionFile(t);
  const input = await identityInputFile(t);
  for (const identityResult of [{}, { decision: { tenant_id: tenantId, contact_id: contactId, fingerprint,
    decision: 'verified_xero_only', revision: 1, actor_id: 'wrong-actor', actor_email: auth.user.email }, refreshPreview: true }]) {
    await assert.rejects(runXeroFinanceOperator(args(file, 'contacts', 'verify', '--input-file', input),
      { fetchImpl: responses({ xeroContactIdentitySave: identityResult }).fetchImpl }), { code: 'MUTATION_RESULT_UNKNOWN' });
  }
  for (const repairResult of [{}, { runId, refreshPreview: true,
    outcomes: [{ rowId: 'different-row', status: 'created' }], summary: { total: 1, created: 1, existing: 0, blocked: 0, uncertain: 0 } }]) {
    await assert.rejects(runXeroFinanceOperator(args(file, 'contact-repair', runId, 'missing-contact-row'),
      { fetchImpl: responses({ xeroContactRepairApply: repairResult }).fetchImpl }), { code: 'MUTATION_RESULT_UNKNOWN' });
  }
  await assert.rejects(runXeroFinanceOperator(args(file, 'apply', runId, documentId),
    { fetchImpl: responses({ xeroFinancialSyncApply: {} }).fetchImpl }), { code: 'MUTATION_RESULT_UNKNOWN' });
  await assert.rejects(runXeroFinanceOperator(args(file, 'payments', runId, paymentId),
    { fetchImpl: responses({ xeroFinancialPaymentApply: {} }).fetchImpl }), { code: 'MUTATION_RESULT_UNKNOWN' });
  const authorised = { ...preview, run: { ...preview.run, status: 'authorised' } };
  await assert.rejects(runXeroFinanceOperator(args(file, 'run', runId),
    { fetchImpl: responses({ xeroFinancialSyncLatest: { preview: authorised }, xeroFinancialSyncRun: {} }).fetchImpl }), { code: 'MUTATION_RESULT_UNKNOWN' });
});

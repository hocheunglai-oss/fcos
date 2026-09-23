import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContactLifecycleRows,
  READABLE_USAGE_SOURCES,
  resolveUsageCacheForPreview,
  scanXeroContactUsageSource,
  verifyContactLifecycleArchiveUsage,
  XERO_CONTACT_USAGE_POLICY_VERSION,
  xeroContactUsageCacheKey,
  xeroPortalContactLifecycleApply,
  xeroPortalStatus,
} from '../api/_xeroPortal.js';

const connection = { tenantId: 'tenant-a', accessToken: 'test-token' };
const env = { XERO_CONTACT_SYNC_DELAY_MS: '0', XERO_TRANSIENT_RETRY_LIMIT: '0' };
const readableSources = READABLE_USAGE_SOURCES.filter((source) => !source.blocked);
const invoices = readableSources.find((source) => source.source === 'invoices');
const watermark = '2026-08-01T00:00:00.000Z';

function cacheRows(overrides = {}) {
  return readableSources.map((source) => ({
    source: xeroContactUsageCacheKey(connection.tenantId, source.source),
    label: source.label,
    status: 'complete',
    records_scanned: 0,
    records_with_contact: 0,
    contact_usage: [],
    scanned_at: watermark,
    ...overrides[source.source],
  }));
}

function historicalInvoices() {
  return {
    records_scanned: 12,
    records_with_contact: 12,
    contact_usage: [{ contactId: 'old-contact', source: 'invoices', records: 12, lastSeenAt: '2020-01-01T00:00:00.000Z' }],
  };
}

function cacheClient(rows = [], run = null) {
  const state = { rows: structuredClone(rows), writes: [], run };
  return {
    state,
    from(table) {
      const query = {
        select() { return this; }, eq() { return this; }, lt() { return this; }, order() { return this; }, limit() { return this; },
        update(row) { state.writes.push({ table, row }); return this; },
        async upsert(row) {
          assert.equal(table, 'xero_contact_usage_cache');
          assert.match(row.source, /^usage-v2:tenant-a:/);
          const index = state.rows.findIndex((cached) => cached.source === row.source);
          if (index >= 0) state.rows[index] = structuredClone(row);
          else state.rows.push(structuredClone(row));
          state.writes.push({ table, row: structuredClone(row) });
          return { data: row, error: null };
        },
        async maybeSingle() {
          const data = table === 'xero_contact_sync_connections' ? {
            tenant_id: connection.tenantId, access_token: 'test-token', refresh_token: 'test-refresh',
            expires_at: '2099-01-01T00:00:00.000Z', scope: 'accounting.contacts',
          } : table === 'xero_contact_lifecycle_runs' ? run
            : table === 'xero_contact_lifecycle_locks' ? { id: 'primary' } : null;
          return { data, error: null };
        },
        then(resolve, reject) {
          const data = table === 'xero_contact_usage_cache' ? state.rows
            : table === 'xero_contact_lifecycle_rows' ? run?.rows || [] : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body) };
}

function usageFetch(handler = () => null) {
  const requests = [];
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    const source = readableSources.find((candidate) => url.pathname.endsWith(candidate.pathName));
    assert.ok(source, `Unexpected Xero endpoint ${url.pathname}`);
    assert.equal(options.method, 'GET');
    const request = { source, url, headers: options.headers, page: Number(url.searchParams.get('page')) };
    requests.push(request);
    return await handler(request) || jsonResponse({ [source.collection]: [], pagination: { pageCount: 1, pageSize: 1000 } });
  };
  return { fetchImpl, requests };
}

function invoice(contactId, year = 2026) {
  return { InvoiceID: `invoice-${contactId}-${year}`, Contact: { ContactID: contactId }, Date: `${year}-01-01` };
}

function selectedArchive(contactId = 'candidate') {
  return [{ id: 'archive-row', action: 'archive', status: 'eligible', xeroContactId: contactId }];
}

async function trustedRun(client) {
  const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl: async () => assert.fail('Cache should be reused') });
  return { xero: { tenantId: connection.tenantId }, usageCache: result.summary, summary: { usagePolicyVersion: XERO_CONTACT_USAGE_POLICY_VERSION } };
}

test('unchanged incremental probes retain all historical counts and canonical source labels', async () => {
  const client = cacheClient(cacheRows({ invoices: historicalInvoices() }));
  const { fetchImpl, requests } = usageFetch();
  const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl, incrementalUsageRefresh: true });
  assert.equal(result.coverageComplete, true);
  assert.equal(result.xeroCalls, readableSources.length);
  assert.equal(result.summary.policyVersion, XERO_CONTACT_USAGE_POLICY_VERSION);
  assert.equal(result.summary.tenantId, connection.tenantId);
  assert.equal(result.summary.bySource.invoices.recordsScanned, 12);
  assert.equal(result.usageByContactId.get('old-contact')[0].records, 12);
  assert.equal(result.usageByContactId.get('old-contact')[0].source, 'invoices');
  assert.equal(result.usageByContactId.get('old-contact')[0].lastSeenAt, '2020-01-01T00:00:00.000Z');
  assert.ok(requests.every((request) => request.headers['If-Modified-Since'] === watermark));
  assert.deepEqual(client.state.rows[0].contact_usage, historicalInvoices().contact_usage);
  assert.equal(client.state.rows[0].records_scanned, 12);
});

test('a changed source rebuilds once without double counting and moves reassigned contacts', async () => {
  const client = cacheClient(cacheRows({ invoices: historicalInvoices() }));
  const { fetchImpl, requests } = usageFetch(({ source, headers }) => {
    if (source.source !== 'invoices') return null;
    return jsonResponse({
      Invoices: headers['If-Modified-Since'] ? [invoice('reassigned')] : [invoice('reassigned'), invoice('pre-2026', 2018)],
      pagination: { pageCount: 1 },
    });
  });
  const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl, incrementalUsageRefresh: true });
  assert.equal(result.coverageComplete, true);
  assert.deepEqual(requests.filter((request) => request.source.source === 'invoices').map((request) => request.headers['If-Modified-Since'] || null), [watermark, null]);
  assert.equal(result.summary.bySource.invoices.recordsScanned, 2);
  assert.equal(result.usageByContactId.get('reassigned')[0].records, 1);
  assert.equal(result.usageByContactId.has('old-contact'), false);
  const protectedRows = buildContactLifecycleRows([], [{ contactId: 'pre-2026', name: 'Historic', status: 'ACTIVE' }], result.usageByContactId, { usageCoverageComplete: result.coverageComplete });
  assert.equal(protectedRows[0].reason, 'used-unmatched-xero-contact');
  assert.ok(requests.every(({ url }) => !url.searchParams.has('where')));
  assert.equal(requests[0].url.searchParams.get('summaryOnly'), 'true');
  assert.equal(requests[0].url.searchParams.get('pageSize'), '1000');
});

test('a failed incremental probe preserves evidence and forces a full rebuild on retry', async () => {
  const client = cacheClient(cacheRows({ invoices: historicalInvoices() }));
  const failed = usageFetch(({ source }) => source.source === 'invoices' ? jsonResponse({ Message: 'Unavailable' }, { status: 500 }) : null);
  const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl: failed.fetchImpl, incrementalUsageRefresh: true });
  assert.equal(result.coverageComplete, false);
  assert.equal(result.summary.bySource.invoices.status, 'failed');
  assert.equal(result.usageByContactId.get('old-contact')[0].records, 12);
  assert.equal(client.state.rows[0].scanned_at, watermark);
  const retry = usageFetch(({ source, headers }) => {
    assert.equal(headers['If-Modified-Since'], undefined);
    return source.source === 'invoices' ? jsonResponse({ Invoices: [invoice('old-contact', 2016)], pagination: { pageCount: 1 } }) : null;
  });
  const rebuilt = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl: retry.fetchImpl });
  assert.equal(rebuilt.coverageComplete, true);
  assert.equal(retry.requests.length, 1);
  assert.equal(rebuilt.usageByContactId.get('old-contact')[0].records, 1);
});

test('a failed paginated rebuild retains the previous complete evidence and denies archive eligibility', async () => {
  const client = cacheClient(cacheRows({ invoices: historicalInvoices() }));
  const { fetchImpl } = usageFetch(({ source, headers, page }) => {
    if (source.source !== 'invoices') return null;
    if (headers['If-Modified-Since']) return jsonResponse({ Invoices: [invoice('new')], pagination: { pageCount: 1 } });
    if (page === 1) return jsonResponse({ Invoices: [invoice('new')], pagination: { pageCount: 2, pageSize: 1 } });
    return jsonResponse({ Message: 'Unavailable' }, { status: 500 });
  });
  const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl, incrementalUsageRefresh: true });
  assert.equal(result.summary.bySource.invoices.status, 'failed');
  assert.equal(result.summary.bySource.invoices.recordsScanned, 12);
  assert.equal(result.usageByContactId.get('old-contact')[0].records, 12);
  assert.equal(result.coverageComplete, false);
  const rows = buildContactLifecycleRows([], [{ contactId: 'candidate', name: 'Candidate', status: 'ACTIVE' }], result.usageByContactId, { usageCoverageComplete: result.coverageComplete });
  assert.equal(rows[0].reason, 'usage-scan-incomplete');
});

test('partial first scans and malformed API responses never establish complete coverage', async () => {
  const client = cacheClient(cacheRows().filter((row) => row.source !== xeroContactUsageCacheKey(connection.tenantId, 'invoices')));
  const { fetchImpl } = usageFetch(({ source, page }) => {
    if (source.source !== 'invoices') return null;
    return jsonResponse(page === 1 ? { Invoices: [invoice('historic', 2011)], pagination: { pageCount: 2 } } : {});
  });
  const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl });
  assert.equal(result.coverageComplete, false);
  assert.equal(result.summary.bySource.invoices.status, 'failed');
  assert.equal(result.usageByContactId.get('historic')[0].records, 1);
});

test('legacy versions and another tenant are rebuilt, while valid current caches are reused', async () => {
  for (const sourceKey of ['invoices', 'usage-v1:tenant-a:invoices', 'usage-v2:tenant-b:invoices']) {
    const rows = cacheRows({ invoices: { source: sourceKey, ...historicalInvoices() } });
    const client = cacheClient(rows);
    const { fetchImpl, requests } = usageFetch();
    const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl, incrementalUsageRefresh: true });
    const invoiceCalls = requests.filter((request) => request.source.source === 'invoices');
    assert.equal(invoiceCalls.length, 1);
    assert.equal(invoiceCalls[0].headers['If-Modified-Since'], undefined);
    assert.equal(result.usageByContactId.has('old-contact'), false);
    assert.equal(result.coverageComplete, true);
    assert.equal(client.state.rows.find((row) => row.source === sourceKey).records_scanned, 12);
  }
  const current = await trustedRun(cacheClient(cacheRows()));
  assert.equal(current.usageCache.coverageComplete, true);
});

test('cache status rejects unscoped or foreign evidence and never treats an empty cache as complete', async () => {
  const result = await xeroPortalStatus({}, {
    client: cacheClient(cacheRows().map((row) => ({ ...row, source: row.source.replace('tenant-a', 'tenant-b') }))),
    env: { ...env, XERO_CLIENT_ID: 'test-client', XERO_CLIENT_SECRET: 'test-secret' },
    fetchImpl: async () => assert.fail('Fresh status must not call Xero'),
  });
  assert.equal(result.usageCache.coverageComplete, false);
  assert.equal(result.usageCache.missingReadableSources, readableSources.length);
});

test('scan-start watermark catches changes made while a full scan is still running', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-01T00:00:00.000Z') });
  const client = cacheClient(cacheRows());
  const changedAt = Date.now() + 1000;
  let changedProbe = false;
  const initial = usageFetch(({ source }) => {
    if (source.source !== 'invoices') return null;
    t.mock.timers.tick(2000);
    return jsonResponse({ Invoices: [invoice('old')], pagination: { pageCount: 1 } });
  });
  await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl: initial.fetchImpl, forceUsageRefresh: true });
  assert.equal(client.state.rows[0].scanned_at, '2026-09-01T00:00:00.000Z');
  const incremental = usageFetch(({ source, headers }) => {
    if (source.source !== 'invoices') return null;
    const since = headers['If-Modified-Since'];
    if (since) {
      changedProbe = Date.parse(since) < changedAt;
      return jsonResponse({ Invoices: changedProbe ? [invoice('during-scan')] : [], pagination: { pageCount: 1 } });
    }
    return jsonResponse({ Invoices: [invoice('old'), invoice('during-scan')], pagination: { pageCount: 1 } });
  });
  const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl: incremental.fetchImpl, incrementalUsageRefresh: true });
  assert.equal(changedProbe, true);
  assert.equal(result.usageByContactId.get('during-scan')[0].records, 1);
});

test('server page-size clamping without pagination metadata cannot truncate history', async () => {
  const { fetchImpl, requests } = usageFetch(({ page }) => jsonResponse({ Invoices: page <= 2 ? [invoice(`contact-${page}`, 2010)] : [] }));
  const result = await scanXeroContactUsageSource(connection, invoices, null, { env, callsPerMinute: 0, fetchImpl });
  assert.equal(result.status, 'complete');
  assert.equal(result.recordsScanned, 2);
  assert.equal(requests.length, 3);
});

test('daily allowance reserve stops a rebuild without trusting the delta or attempting later sources', async () => {
  const client = cacheClient(cacheRows({ invoices: historicalInvoices() }));
  const { fetchImpl, requests } = usageFetch(() => jsonResponse({ Invoices: [invoice('new')], pagination: { pageCount: 1 } }, { headers: { 'x-daylimit-remaining': '200' } }));
  const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl, incrementalUsageRefresh: true });
  assert.equal(requests.length, 1);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.summary.bySource.invoices.status, 'failed');
  assert.equal(result.usageByContactId.get('old-contact')[0].records, 12);
  assert.match(result.summary.bySource.invoices.error, /daily allowance reserve/);
});

test('credit notes and nested credit-note payments both protect historical contacts', async () => {
  const client = cacheClient();
  const { fetchImpl } = usageFetch(({ source }) => {
    if (source.source === 'credit-notes') return jsonResponse({ CreditNotes: [{ CreditNoteID: 'historic-note', Contact: { ContactID: 'credit-only' }, Date: '2013-01-01' }], pagination: { pageCount: 1 } });
    if (source.source === 'payments') return jsonResponse({ Payments: [{ PaymentID: 'payment-1', Contact: { ContactID: 'payment-contact' }, CreditNote: { Contact: { ContactID: 'payment-contact' } } }], pagination: { pageCount: 1 } });
    return null;
  });
  const result = await resolveUsageCacheForPreview(client, connection, { env, callsPerMinute: 0, fetchImpl });
  assert.equal(result.coverageComplete, true);
  assert.equal(result.usageByContactId.get('credit-only')[0].source, 'credit-notes');
  assert.equal(result.usageByContactId.get('payment-contact')[0].records, 1);
  assert.equal(result.summary.bySource['credit-notes'].recordsScanned, 1);
  const rows = buildContactLifecycleRows([], [{ contactId: 'credit-only', name: 'Credit only', status: 'ACTIVE' }], result.usageByContactId, { usageCoverageComplete: true });
  assert.equal(rows[0].reason, 'used-unmatched-xero-contact');
});

test('legacy, mismatched-tenant and incomplete saved previews cannot start archive verification', async () => {
  const client = cacheClient(cacheRows());
  const run = await trustedRun(client);
  for (const invalid of [
    { ...run, summary: {} },
    { ...run, xero: { tenantId: 'tenant-b' } },
    { ...run, usageCache: { ...run.usageCache, policyVersion: 1 } },
    { ...run, usageCache: { ...run.usageCache, coverageComplete: false } },
    { ...run, usageCache: { ...run.usageCache, bySource: { ...run.usageCache.bySource, 'credit-notes': undefined } } },
  ]) {
    await assert.rejects(verifyContactLifecycleArchiveUsage(client, connection, invalid, selectedArchive(), { env, callsPerMinute: 0, fetchImpl: async () => assert.fail('Invalid preview must not call Xero') }), { code: 'XERO_PORTAL_ARCHIVE_USAGE_UNTRUSTED' });
  }
});

test('archive apply rechecks all sources and blocks contacts used since preview', async () => {
  const client = cacheClient(cacheRows());
  const run = await trustedRun(client);
  const { fetchImpl, requests } = usageFetch(({ source }) => source.source === 'credit-notes'
    ? jsonResponse({ CreditNotes: [{ CreditNoteID: 'note-1', Contact: { ContactID: 'candidate' } }], pagination: { pageCount: 1 } }) : null);
  await assert.rejects(verifyContactLifecycleArchiveUsage(client, connection, run, selectedArchive(), { env, callsPerMinute: 0, fetchImpl }), { code: 'XERO_PORTAL_ARCHIVE_CONTACT_USED' });
  assert.equal(requests.length, readableSources.length + 1);
  assert.equal(requests.filter((request) => request.source.source === 'credit-notes').length, 2);
});

test('archive verification accepts complete unchanged evidence and fails closed on a new read failure', async () => {
  const client = cacheClient(cacheRows());
  const run = await trustedRun(client);
  const complete = await verifyContactLifecycleArchiveUsage(client, connection, run, selectedArchive(), { env, callsPerMinute: 0, fetchImpl: usageFetch().fetchImpl });
  assert.equal(complete.coverageComplete, true);
  const failed = usageFetch(({ source }) => source.source === 'payments' ? jsonResponse({ Message: 'Forbidden' }, { status: 403 }) : null);
  await assert.rejects(verifyContactLifecycleArchiveUsage(client, connection, run, selectedArchive(), { env, callsPerMinute: 0, fetchImpl: failed.fetchImpl }), { code: 'XERO_PORTAL_ARCHIVE_USAGE_INCOMPLETE' });
  assert.equal(await verifyContactLifecycleArchiveUsage(client, connection, {}, [{ action: 'rename' }], { env, callsPerMinute: 0, fetchImpl: async () => assert.fail('Rename does not need archive usage verification') }), null);
});

test('the public apply handler rejects a legacy archive preview before any Xero read or write', async () => {
  const run = {
    id: 'legacy-run', state: 'previewed', xero: { tenantId: connection.tenantId }, summary: {}, usage_cache: { coverageComplete: true },
    rows: [{ row_id: 'archive-row', action: 'archive', status: 'eligible', xero_contact_id: 'candidate', xero_contact_name: 'Candidate' }],
  };
  const client = cacheClient(cacheRows(), run);
  await assert.rejects(xeroPortalContactLifecycleApply({ runId: run.id, rowIds: ['archive-row'], reviewed: true }, {
    client,
    env: { ...env, XERO_CLIENT_ID: 'test-client', XERO_CLIENT_SECRET: 'test-secret', FCOS_ENABLE_XERO_CONTACT_SYNC: 'true' },
    fetchImpl: async () => assert.fail('Legacy archive must never call Xero'),
  }), { code: 'XERO_PORTAL_ARCHIVE_USAGE_UNTRUSTED' });
  assert.equal(client.state.writes.every((write) => write.table === 'xero_contact_lifecycle_locks'), true);
});

test('premature empty pages, inconsistent totals, and repeated records fail closed', async () => {
  for (const mode of ['empty-before-last-page', 'total-mismatch', 'duplicate-id']) {
    const { fetchImpl } = usageFetch(({ page }) => {
      if (mode === 'total-mismatch') return jsonResponse({ Invoices: [invoice('only')], pagination: { pageCount: 1, itemCount: 2 } });
      if (mode === 'empty-before-last-page') return jsonResponse({ Invoices: [], pagination: { pageCount: 2, itemCount: 20 } });
      return jsonResponse({ Invoices: [invoice('repeated')], pagination: { pageCount: 2, itemCount: 2, page } });
    });
    const result = await scanXeroContactUsageSource(connection, invoices, null, { env, callsPerMinute: 0, fetchImpl });
    assert.equal(result.status, 'failed', mode);
    assert.match(result.error, /pagination|duplicate/);
  }
});

test('a full scan counts every page and rejects changing pagination totals', async () => {
  const complete = usageFetch(({ page }) => jsonResponse({ Invoices: [invoice(`contact-${page}`)], pagination: { pageCount: 2, itemCount: 2, pageSize: 1 } }));
  const completeResult = await scanXeroContactUsageSource(connection, invoices, null, { env, callsPerMinute: 0, fetchImpl: complete.fetchImpl });
  assert.equal(completeResult.status, 'complete');
  assert.equal(completeResult.recordsScanned, 2);
  const changed = usageFetch(({ page }) => jsonResponse({ Invoices: [invoice(`contact-${page}`)], pagination: { pageCount: 2, itemCount: page === 1 ? 2 : 3 } }));
  const changedResult = await scanXeroContactUsageSource(connection, invoices, null, { env, callsPerMinute: 0, fetchImpl: changed.fetchImpl });
  assert.equal(changedResult.status, 'failed');
  assert.match(changedResult.error, /pagination changed/);
});

test('malformed records without IDs cannot establish absence of historical usage', async () => {
  for (const malformed of [{}, null, { Contact: { ContactID: 'known-contact' } }]) {
    const { fetchImpl } = usageFetch(() => jsonResponse({ Invoices: [malformed], pagination: { pageCount: 1 } }));
    const result = await scanXeroContactUsageSource(connection, invoices, null, { env, callsPerMinute: 0, fetchImpl });
    assert.equal(result.status, 'failed');
    assert.match(result.error, /required identifier/);
  }
});


test('every nontransfer source fails closed when a transaction has no contact evidence', async () => {
  for (const source of readableSources) {
    const record = { [source.recordId]: 'unresolved-record', Type: 'SPEND' };
    if (source.source === 'payments') record.Invoice = { InvoiceID: 'linked-invoice-without-contact' };
    const { fetchImpl } = usageFetch(() => jsonResponse({ [source.collection]: [record], pagination: { pageCount: 1, itemCount: 1 } }));
    const result = await scanXeroContactUsageSource(connection, source, null, { env, callsPerMinute: 0, fetchImpl });
    assert.equal(result.status, 'failed', source.source);
    assert.match(result.error, /without readable contact evidence/);
  }
});

test('missing invoice and payment contact evidence prevents archive apply and retains protective history', async () => {
  for (const sourceName of ['invoices', 'payments']) {
    const client = cacheClient(cacheRows({ invoices: historicalInvoices() }));
    const run = await trustedRun(client);
    const { fetchImpl } = usageFetch(({ source }) => {
      if (source.source !== sourceName) return null;
      const record = { [source.recordId]: 'unresolved-record', Invoice: { InvoiceID: 'unresolved-document' } };
      return jsonResponse({ [source.collection]: [record], pagination: { pageCount: 1 } });
    });
    await assert.rejects(verifyContactLifecycleArchiveUsage(client, connection, run, selectedArchive(), { env, callsPerMinute: 0, fetchImpl }), { code: 'XERO_PORTAL_ARCHIVE_USAGE_INCOMPLETE' });
    assert.equal(client.state.rows.find((row) => row.source === xeroContactUsageCacheKey(connection.tenantId, sourceName)).status, 'failed');
    assert.deepEqual(client.state.rows[0].contact_usage, historicalInvoices().contact_usage);
  }
});

test('only explicit bank-transfer types may complete a usage scan without contacts', async () => {
  const source = readableSources.find((item) => item.source === 'bank-transactions');
  const { fetchImpl } = usageFetch(() => jsonResponse({
    BankTransactions: [
      { BankTransactionID: 'transfer-out', Type: 'SPEND-TRANSFER' },
      { BankTransactionID: 'transfer-in', Type: 'RECEIVE-TRANSFER' },
      { BankTransactionID: 'normal-spend', Type: 'SPEND', Contact: { ContactID: 'supplier' } },
    ],
    pagination: { pageCount: 1, itemCount: 3 },
  }));
  const result = await scanXeroContactUsageSource(connection, source, null, { env, callsPerMinute: 0, fetchImpl });
  assert.equal(result.status, 'complete');
  assert.equal(result.recordsScanned, 3);
  assert.equal(result.recordsWithContact, 1);
  assert.equal(result.contacts.get('supplier').records, 1);
  const falseTransfer = usageFetch(() => jsonResponse({ Invoices: [{ InvoiceID: 'not-a-bank-transfer', Type: 'SPEND-TRANSFER' }], pagination: { pageCount: 1 } }));
  const falseTransferResult = await scanXeroContactUsageSource(connection, invoices, null, { env, callsPerMinute: 0, fetchImpl: falseTransfer.fetchImpl });
  assert.equal(falseTransferResult.status, 'failed');
});


test('invalid or changing supplied pagination cannot certify complete history', async () => {
  for (const pagination of [
    { pageCount: -1 }, { pageCount: 1.5 }, { pageCount: 0 },
    { pageSize: 0 }, { pageSize: -100 }, { pageSize: 0.5 }, { itemCount: -1 },
  ]) {
    const { fetchImpl } = usageFetch(() => jsonResponse({ Invoices: [invoice('one')], pagination }));
    const result = await scanXeroContactUsageSource(connection, invoices, null, { env, callsPerMinute: 0, fetchImpl });
    assert.equal(result.status, 'failed');
    assert.match(result.error, /invalid pagination/);
  }
  for (const field of ['pageCount', 'pageSize']) {
    const { fetchImpl } = usageFetch(({ page }) => jsonResponse({ Invoices: [invoice(`page-${page}`)], pagination: { pageCount: 3, [field]: page === 1 ? 3 : 2 } }));
    const result = await scanXeroContactUsageSource(connection, invoices, null, { env, callsPerMinute: 0, fetchImpl });
    assert.equal(result.status, 'failed');
    assert.match(result.error, /pagination changed/);
  }
  const empty = usageFetch(() => jsonResponse({ Invoices: [], pagination: { pageCount: 0, itemCount: 0, pageSize: 1000 } }));
  assert.equal((await scanXeroContactUsageSource(connection, invoices, null, { env, callsPerMinute: 0, fetchImpl: empty.fetchImpl })).status, 'complete');
});

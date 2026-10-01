import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { integrityFilters, integrityDocumentRow, integrityCorrectionHistory, integrityPaymentSnapshot, xeroIntegrityReport } from '../api/_xeroIntegrityReport.js';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';
import { XERO_RECONCILIATION_VERSION } from '../api/_xeroFinancialSync.js';
import { compactPreviewPayments } from '../api/_xeroPreviewPayments.js';
import { partitionPreviewCheckpoint, previewCheckpointReference } from '../api/_xeroPreviewCheckpoint.js';
import { preparePreviewPersistence, previewEvidenceHash } from '../api/_xeroPreviewPersistence.js';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';

const NOW = Date.parse('2026-10-01T00:00:00Z');
const CHECKED = '2026-09-30T23:00:00Z';
const TENANT = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const SF_ORG = fcosSalesforceEnvironment('production').orgId;

function item(overrides = {}) {
  return { id: randomUUID(), run_id: 'run', row_index: 0, source_object: 'Invoice__c', source_id: 'a0K000000000001',
    source_type: 'buyer_invoice', source_document_number: '2026001', currency: 'USD', source_total: 100,
    proposed_action: 'link', status: 'linked', blockers: [], differences: [], xero_document_id: TARGET,
    source_payload: { documentNumber: '2026001', accountName: 'Buyer A', stemName: 'STEM 26/1', total: 100, signedTotal: 100,
      currency: 'USD', documentFieldProjection: { fields: { Date: '2026-09-30', InvoiceNumber: '2026001' },
        evidence: { dateSource: 'Invoice__c.Delivery_Date__c', refCode: '26/1' } }, refreshToken: 'NEVER_EXPOSE_TOKEN',
      bankAccount: { secret: 'NEVER_EXPOSE_BANK' } },
    xero_payload: { id: TARGET, invoiceNumber: '2026001', date: '2026-09-30', currency: 'USD', total: 100 }, ...overrides };
}

function fixture(overrides = {}) {
  const rows = overrides.items || [item()];
  const snapshot = { tenantId: TENANT, salesforceOrgId: SF_ORG, persistenceVersion: 1, expectedItemCount: rows.length,
    reconciliationVersion: XERO_RECONCILIATION_VERSION, complete: true, checkedAt: CHECKED, includePayments: false, ...overrides.snapshot };
  const data = {
    xero_contact_sync_connections: [{ id: 'primary', tenant_id: TENANT, tenant_name: 'Approved Xero', access_token: 'NOT_SELECTED' }],
    xero_financial_sync_runs: [{ id: 'run', mode: 'preview', status: 'ready_for_review', created_at: CHECKED,
      control_totals: { workflowSnapshot: snapshot } }], xero_financial_sync_items: rows,
    xero_contact_lifecycle_runs: [], xero_contact_lifecycle_rows: [], xero_document_field_correction_claims: [],
    xero_document_field_correction_events: [], xero_shared_tenant_control: [{ tenant_id: TENANT, allowance_known: true,
      available_calls: 500, observed_at: CHECKED, daily_hold: false }], ...overrides.data,
  };
  const calls = [];
  const get = (row, path) => path.split(/->>?/).reduce((value, key) => value?.[key], row);
  const client = {
    from(table) {
      const filters = []; const orders = []; let limit = null; let range = null; let single = false; let selected = null; let exact = false;
      const query = {
        select(fields, options) { assert.notEqual(fields, '*'); selected = fields; exact = options?.count === 'exact'; return query; },
        eq(key, value) { filters.push(row => get(row, key) === value); return query; },
        in(key, values) { filters.push(row => values.includes(get(row, key))); return query; },
        not(key, operator, value) { assert.equal(operator, 'in'); filters.push(row => !value.slice(1, -1).split(',').includes(get(row, key))); return query; },
        order(key, options = {}) { orders.push([key, options.ascending !== false]); return query; },
        limit(value) { limit = value; return query; },
        range(from, to) { assert.ok(to - from < 250); range = [from, to]; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          calls.push({ table, selected, range, single });
          let result = (data[table] || []).filter(row => filters.every(filter => filter(row)));
          for (const [key, asc] of orders.reverse()) result = [...result].sort((a, b) => (get(a, key) < get(b, key) ? -1 : get(a, key) > get(b, key) ? 1 : 0) * (asc ? 1 : -1));
          const count = exact ? result.length : null;
          if (range) result = result.slice(range[0], range[1] + 1);
          if (limit) result = result.slice(0, limit);
          const response = overrides.errors?.includes(table) ? { data: null, error: { message: 'RAW ERROR token=NEVER_EXPOSE_ERROR' } }
            : { data: single ? result[0] || null : result, count, error: null };
          return Promise.resolve(response).then(resolve, reject);
        },
      };
      for (const method of ['insert', 'update', 'upsert', 'delete']) query[method] = () => assert.fail(`Mutation attempted: ${method}`);
      return query;
    },
    rpc: () => assert.fail('Unexpected RPC'),
  };
  return { client, calls, data, snapshot };
}

test('read policy preserves Finance management and module authorization without external actions', async () => {
  assert.deepEqual(registeredHandlerBehavior('xeroIntegrityReport'), { mutation: false, cache: 'none', externalAction: false,
    capability: 'xero_portal_manage', audit: 'none' });
  const handlers = await readFile(new URL('../api/_xeroHandlers.js', import.meta.url), 'utf8');
  assert.match(handlers, /'xeroIntegrityReport'/);
  assert.match(handlers, /xeroIntegrityReport: wrap\(xeroIntegrityReport\)/);
});

test('filters default to 2026 and reject mutation payloads, tenant overrides, malformed dates and bounds', () => {
  assert.equal(integrityFilters().from, '2026-01-01');
  for (const body of [{ action: 'sync' }, { tenantId: TENANT }, { reviewed: true }, { from: '2026-02-30' },
    { from: '2026-10-01', to: '2026-09-01' }, { page: 0 }, { pageSize: 101 }, { search: 'x'.repeat(201) }, { status: 'complete' }]) {
    assert.throws(() => integrityFilters(body), { code: 'XERO_INTEGRITY_FILTER_INVALID' });
  }
});

test('saved evidence report is SELECT only and safe-projects credentials, raw errors and bank internals', async () => {
  const f = fixture(); const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.equal(report.schemaVersion, 1); assert.equal(report.metrics.checked, 1); assert.equal(report.metrics.matched, 1);
  assert.equal(report.currencyTotals[0].difference, 0); assert.equal(report.scope.universeTotal, null);
  assert.equal(report.rows[0].sourceUrl, 'https://fratellicosulich.my.salesforce.com/lightning/r/Invoice__c/a0K000000000001/view');
  assert.match(report.rows[0].xeroUrl, /^https:\/\/go\.xero\.com\//);
  assert.doesNotMatch(JSON.stringify(report), /NEVER_EXPOSE|refreshToken|bankAccount/);
  assert.ok(f.calls.every(row => row.selected && row.selected !== '*'));
  assert.equal(f.calls.length, 7);
  assert.equal(report.health.stale, false);
});

test('missing, blocked, mismatched, uncertain and pending links remain distinct; writes are not matches', async () => {
  const rows = [item(), item({ status: 'eligible' }), item({ status: 'created' }),
    item({ xero_document_id: null, xero_payload: {}, proposed_action: 'create_draft', status: 'eligible' }),
    item({ status: 'blocked', blockers: ['Exact account identity is ambiguous.'] }),
    item({ status: 'eligible', differences: [{ field: 'total', salesforce: 100, xero: 99 }] }),
    item({ error_code: 'XERO_WRITE_OUTCOME_UNKNOWN' })];
  const f = fixture({ items: rows }); const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.deepEqual(report.metrics, { checked: 7, matched: 1, missing: 1, mismatched: 1, blocked: 1, uncertain: 1, unverified: 2 });
  assert.equal(report.currencyTotals[0].xeroAmount, null, 'missing target is unknown, never zero');
});

test('empty snapshots show observed zero while absent/error/incompatible evidence stays unavailable', async () => {
  const empty = fixture({ items: [] }); const checked = await xeroIntegrityReport({}, { client: empty.client, now: NOW });
  assert.equal(checked.metrics.checked, 0); assert.equal(checked.coverage[0].available, true);
  for (const f of [fixture({ data: { xero_financial_sync_runs: [] } }), fixture({ errors: ['xero_financial_sync_runs'] }),
    fixture({ snapshot: { reconciliationVersion: 999 } }), fixture({ snapshot: { salesforceOrgId: 'other-org' } }),
    fixture({ snapshot: { persistenceVersion: 999 } })]) {
    const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
    assert.equal(report.metrics.checked, null); assert.equal(report.coverage[0].available, false);
    assert.ok(report.coverage[0].notice); assert.doesNotMatch(JSON.stringify(report), /RAW ERROR|NEVER_EXPOSE_ERROR/);
  }
});

test('exact tenant isolation excludes newer foreign snapshots and correction claims', async () => {
  const f = fixture(); f.data.xero_financial_sync_runs.unshift({ ...f.data.xero_financial_sync_runs[0], id: 'foreign',
    created_at: '2026-10-01T00:00:00Z', control_totals: { workflowSnapshot: { ...f.snapshot, tenantId: TARGET } } });
  f.data.xero_document_field_correction_claims.push({ id: 'foreign', tenant_id: TARGET, evidence: { raw: 'foreign' } });
  const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.equal(report.rows.length, 1); assert.equal(report.history.length, 0);
});

test('date filters use buyer-invoice date evidence and leave Contact identities date-independent', async () => {
  const undated = item(); delete undated.source_payload.documentFieldProjection;
  undated.source_payload.deliveryDate = '2026-09-30';
  const old = item(); old.source_payload.documentFieldProjection.fields.Date = '2025-12-31';
  const f = fixture({ items: [undated, old], data: {
    xero_contact_lifecycle_runs: [{ id: 'contact-run', row_count: 1, xero: { tenantId: TENANT }, created_at: CHECKED }],
    xero_contact_lifecycle_rows: [{ id: 'contact', run_id: 'contact-run', row_index: 0, action: 'keep', status: 'kept',
      salesforce_name: 'Same', xero_contact_name: 'Same', salesforce_account_id: '001000000000001', xero_contact_id: TARGET }],
  } });
  const report = await xeroIntegrityReport({ from: '2026-09-01', to: '2026-09-30' }, { client: f.client, now: NOW });
  assert.equal(report.metrics.checked, 1); assert.equal(report.rows[0].kind, 'contact');
  assert.ok(report.notices.some(value => /no verified date/.test(value)));
  assert.equal(report.scope.contactsDateBound, false);
});

test('saved projected header discrepancies override legacy classifier matches', () => {
  const value = item(); value.xero_payload.date = '2026-09-29';
  const row = integrityDocumentRow(value, CHECKED);
  assert.equal(row.status, 'mismatched');
  assert.deepEqual(row.differences, [{ field: 'Date', source: '2026-09-30', xero: '2026-09-29' }]);
});

test('durable links without captured target values are unverified and monetary drift remains visible', () => {
  assert.equal(integrityDocumentRow(item({ xero_payload: {} }), CHECKED).status, 'unverified');
  assert.equal(integrityDocumentRow(item({ xero_payload: { total: false, currency: 'USD' } }), CHECKED).status, 'unverified');
  const changed = item(); changed.xero_payload.total = 99;
  assert.equal(integrityDocumentRow(changed, CHECKED).status, 'mismatched');
  assert.deepEqual(integrityDocumentRow(changed, CHECKED).differences, [{ field: 'total', source: 100, xero: 99 }]);
  const currency = item(); currency.xero_payload.currency = 'HKD';
  assert.equal(integrityDocumentRow(currency, CHECKED).status, 'mismatched');
});

test('amounts stay currency-separated with signed credits and no payment double counting', async () => {
  const credit = item({ source_type: 'buyer_credit', source_total: 20, currency: 'USD' });
  credit.source_payload.signedTotal = -20; credit.xero_payload.total = 20;
  const hk = item({ currency: 'HKD', source_total: 50 }); hk.source_payload.signedTotal = 50; hk.xero_payload.total = 49; hk.xero_payload.currency = 'HKD';
  const f = fixture({ items: [item(), credit, hk], snapshot: { includePayments: true,
    payments: { tenantId: TENANT, rows: [{ salesforcePaymentId: 'a0p000000000001', paymentDate: '2026-09-30', amount: 100, currency: 'USD',
      status: 'protected', action: 'payment_link', xeroPaymentId: TARGET }] } } });
  const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.deepEqual(report.currencyTotals, [{ currency: 'HKD', sourceAmount: 50, xeroAmount: 49, difference: 1, recordCount: 1 },
    { currency: 'USD', sourceAmount: 80, xeroAmount: 80, difference: 0, recordCount: 2 }]);
  assert.equal(report.rows.find(row => row.kind === 'payment').status, 'unverified');
});

test('a target currency mismatch never becomes a cross-currency comparison or invented conversion', async () => {
  const value = item(); value.xero_payload.currency = 'HKD';
  const f = fixture({ items: [value] });
  const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.equal(report.rows[0].status, 'mismatched');
  assert.equal(report.currencyTotals[0].sourceAmount, 100);
  assert.equal(report.currencyTotals[0].xeroAmount, null);
  assert.equal(report.currencyTotals[0].difference, null);
});

test('pagination and search are stable bounded saved-evidence projections', async () => {
  const rows = Array.from({ length: 53 }, (_, i) => item({ row_index: i, source_document_number: `INV ${i}` }));
  const f = fixture({ items: rows });
  const second = await xeroIntegrityReport({ page: 2, pageSize: 25 }, { client: f.client, now: NOW });
  assert.equal(second.rows.length, 25); assert.deepEqual(second.pagination, { page: 2, pageSize: 25, total: 53, hasNext: true });
  const found = await xeroIntegrityReport({ search: 'inv 52' }, { client: f.client, now: NOW });
  assert.equal(found.rows.length, 1); assert.equal(found.metrics.checked, 53);
});

test('saved read cap exposes partial coverage and never reports full source-universe completion', async () => {
  const f = fixture({ items: Array.from({ length: 3001 }, (_, i) => item({ row_index: i })) });
  const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.equal(report.metrics.checked, 3000); assert.equal(report.coverage[0].complete, false);
  assert.ok(report.notices.some(value => /partial/.test(value))); assert.equal(report.scope.universeTotal, null);
  assert.equal(f.calls.filter(row => row.table === 'xero_financial_sync_items').length, 12);
});

test('stale/future observations never appear fresh and quota cannot grant execution', async () => {
  for (const time of ['2026-09-01T00:00:00Z', '2026-10-02T00:00:00Z']) {
    const f = fixture({ snapshot: { checkedAt: time }, data: { xero_shared_tenant_control: [{ tenant_id: TENANT,
      allowance_known: true, available_calls: 1000, observed_at: time }] } });
    const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
    assert.equal(report.health.stale, true); assert.equal(report.health.quota.available, false);
    assert.match(report.health.quota.notice, /no provider probe/);
  }
});

function correction(status = 'confirmed') {
  const before = { InvoiceID: TARGET, Type: 'ACCREC', InvoiceNumber: '2026001', Date: '2026-09-29', Total: 100,
    CurrencyCode: 'USD', Contact: { Name: 'Buyer A', bank: 'NEVER_EXPOSE_BANK' }, LineItems: [] };
  const expectedAfter = { ...before, Date: '2026-09-30' };
  const evidence = { policyVersion: 'document_field_correction_v1', before, expectedAfter,
    source: { documentNumber: '2026001', documentKind: 'buyer_invoice' }, projection: { header: { Date: '2026-09-30' } } };
  const outcome = { observed: expectedAfter, basis: 'exact_provider_readback' };
  const claim = { id: randomUUID(), tenant_id: TENANT, xero_invoice_id: TARGET, created_at: CHECKED,
    idempotency_key: `document_field_correction_v1:${TARGET}:item`, evidence, evidence_hash: previewEvidenceHash(evidence) };
  const event = { id: randomUUID(), claim_id: claim.id, sequence: '1', status, created_at: CHECKED, evidence: outcome,
    evidence_hash: previewEvidenceHash(outcome) };
  return { claim, event };
}

test('correction history requires latest exact hashed readback and safely exposes before/after only', () => {
  const { claim, event } = correction();
  const verified = integrityCorrectionHistory([claim], [event])[0];
  assert.equal(verified.readbackVerified, true); assert.equal(verified.batchId, TARGET);
  assert.equal(verified.before.date, '2026-09-29'); assert.equal(verified.after.date, '2026-09-30');
  assert.doesNotMatch(JSON.stringify(verified), /NEVER_EXPOSE|Contact|LineItems|evidence_hash/);
  for (const changed of [[], [{ ...event, status: 'uncertain' }], [{ ...event, evidence_hash: 'invalid' }],
    [{ ...event, evidence: { ...event.evidence, observed: { ...event.evidence.observed, Total: 99 } } }],
    [event, { ...event, sequence: '2', status: 'uncertain' }]]) {
    assert.equal(integrityCorrectionHistory([claim], changed)[0].readbackVerified, false);
  }
});

test('confirmed correction report freshness, search and history pagination use saved exact outcomes', async () => {
  const { claim, event } = correction();
  const f = fixture({ data: { xero_document_field_correction_claims: [claim], xero_document_field_correction_events: [event] } });
  const report = await xeroIntegrityReport({ search: '2026001', historyPageSize: 1 }, { client: f.client, now: NOW });
  assert.equal(report.history.length, 1); assert.equal(report.history[0].status, 'confirmed');
  assert.equal(report.health.lastSuccessfulSyncAt, null);
  assert.equal(report.health.lastConfirmedCorrectionAt, new Date(CHECKED).toISOString()); assert.equal(report.historyPagination.total, 1);
});

test('missing or corrupt compacted payments stay unavailable rather than zero or matched', async () => {
  const f = fixture({ snapshot: { includePayments: true, paymentsReference: { salesforceOrgId: SF_ORG } } });
  const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.equal(report.coverage.find(row => row.key === 'payments').total, null);
  assert.equal(report.coverage.find(row => row.key === 'payments').available, false);
  assert.ok(report.health.errors.some(row => row.code === 'XERO_INTEGRITY_PAYMENT_EVIDENCE_UNAVAILABLE'));
});

test('compacted payment hydration uses only audited read RPCs and verifies full captured hashes', async () => {
  const actor = randomUUID(); const id = randomUUID(); const runId = randomUUID();
  const options = { linkFirst: true, recordExactMatches: false, includePayments: true, cutoffDate: '2026-01-01', postingMode: 'draft', campaignId: null };
  const payments = { tenantId: TENANT, rows: [{ salesforcePaymentId: 'a0p000000000001', amount: 100, currency: 'USD', paymentDate: '2026-09-30' }] };
  const payload = { complete: true, snapshotStartedAt: CHECKED, provider: { payments, xero: { tenantId: TENANT },
    accountResponse: {}, taxResponse: {}, allMappings: {} }, automaticMappingPolicy: {}, callForecast: {}, rate: {} };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const { manifest, parts } = partitionPreviewCheckpoint(canonical(payload));
  const checkpoint = { id, revision: 2, state: 'captured', actor_id: actor, tenant_id: TENANT, salesforce_org_id: SF_ORG,
    reconciliation_version: XERO_RECONCILIATION_VERSION, input_options: options, input_evidence_hash: previewEvidenceHash('source'),
    payload_hash: previewEvidenceHash(payload), storage_hash: previewEvidenceHash('storage'), token_version: 1, captured_at: CHECKED,
    storage_version: 2, expires_at: '2026-09-30T23:15:00Z', payload };
  const snapshot = { tenantId: TENANT, complete: true, linkFirst: true, includePayments: true, payments, inventoryReference: previewCheckpointReference(checkpoint) };
  const run = { id: runId, created_by: actor, control_totals: { workflowSnapshot: compactPreviewPayments(snapshot, checkpoint) } };
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push(name);
    assert.ok(['xero_preview_checkpoint_load_v2', 'xero_preview_checkpoint_read_chunks_v2'].includes(name));
    assert.equal(args.p_run_id, runId); assert.equal(args.p_scope.tenantId, TENANT); assert.equal(args.p_scope.salesforceOrgId, SF_ORG);
    return { data: name === 'xero_preview_checkpoint_load_v2' ? { ...checkpoint, state: 'published', revision: 3, published_run_id: runId,
      payload: { storageVersion: 2, manifest, summary: { complete: true } } } : {
        chunks: parts.filter(part => part.ordinal > args.p_after_ordinal).slice(0, 2),
        hasMore: parts.some(part => part.ordinal > args.p_after_ordinal + 2) } };
  } };
  const hydrated = await integrityPaymentSnapshot(client, run);
  assert.deepEqual(hydrated.payments, payments); assert.equal(calls[0], 'xero_preview_checkpoint_load_v2');
  assert.ok(calls.slice(1).every(name => name === 'xero_preview_checkpoint_read_chunks_v2'));
  const corrupt = { rpc: async (name, args) => {
    const result = await client.rpc(name, args);
    if (name === 'xero_preview_checkpoint_read_chunks_v2') result.data.chunks = result.data.chunks.map(part => ({ ...part, payloadHash: 'invalid' }));
    return result;
  } };
  await assert.rejects(integrityPaymentSnapshot(corrupt, run));
});

test('checkpoint report RPC SQL and guard paths are read-only with unchanged authorization', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260930004000_xero_preview_checkpoint_chunks.sql', import.meta.url), 'utf8');
  for (const name of ['xero_preview_checkpoint_load_v2', 'xero_preview_checkpoint_read_chunks_v2']) {
    const definition = sql.split(`create function public.${name}`)[1].split('end $$;')[0];
    assert.doesNotMatch(definition, /\b(insert|update|delete)\b/i);
    assert.match(definition, /require_v2\([^;]+false\)/);
  }
});

test('representative saved report stays bounded with no provider calls', async t => {
  const f = fixture({ items: Array.from({ length: 750 }, (_, i) => item({ row_index: i })) });
  const started = performance.now(); const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  const elapsed = Math.round((performance.now() - started) * 100) / 100;
  assert.equal(report.metrics.checked, 750); assert.equal(f.calls.length, 9);
  t.diagnostic(JSON.stringify({ elapsedMs: elapsed, databaseSelects: f.calls.length, readRpcs: 0, rowsProcessed: 750, providerCalls: 0 }));
});

test('production persistence writer shape is reportable and its manifest count is required for saved rows loaded', async () => {
  const f = fixture(); const run = f.data.xero_financial_sync_runs[0];
  run.created_by = randomUUID();
  const prepared = preparePreviewPersistence(run, f.data.xero_financial_sync_items, { tenantId: TENANT,
    includePayments: false, salesforceOrgId: SF_ORG, inputEvidenceHash: previewEvidenceHash('source') });
  f.data.xero_financial_sync_runs = [prepared.p_run];
  const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.equal(report.coverage[0].available, true); assert.equal(report.coverage[0].complete, true);
  prepared.p_run.control_totals.workflowSnapshot.expectedItemCount += 1;
  const inconsistent = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.equal(inconsistent.coverage[0].complete, false);
  assert.ok(inconsistent.notices.some(value => /capture manifest/.test(value)));
});

test('missing Contact is not hidden as a generic block and recent run status never implies verified sync', async () => {
  const f = fixture({ data: {
    xero_contact_lifecycle_runs: [{ id: 'contact-run', row_count: 1, xero: { tenantId: TENANT }, created_at: CHECKED }],
    xero_contact_lifecycle_rows: [{ id: 'contact', run_id: 'contact-run', row_index: 0, action: 'exception', status: 'blocked',
      reason: 'missing-xero-contact', salesforce_name: 'Missing', salesforce_account_id: '001000000000001' }],
  } });
  const report = await xeroIntegrityReport({}, { client: f.client, now: NOW });
  assert.equal(report.rows.find(row => row.kind === 'contact').status, 'missing');
  assert.equal(report.health.recentRuns[0].readbackVerified, false); assert.equal(report.health.lastSuccessfulSyncAt, null);
});

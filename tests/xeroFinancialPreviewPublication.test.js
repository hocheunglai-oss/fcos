import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildFinancialClassifications, normalizeXeroInvoice, financialPreviewChanges, xeroFinancialSyncLatest, xeroFinancialSyncPreview, XERO_RECONCILIATION_VERSION } from '../api/_xeroFinancialSync.js';

// Stateful storage fake applies the actual query filters and injects failures at
// persistence boundaries, rather than reconstructing the publication algorithm.
function storage({ failAt, race } = {}) {
  const tables = {}; const calls = []; let itemChunks = 0;
  const client = { from(table) {
    let operation = 'select'; let values; let single = false; let order; let limit = Infinity; let start = 0; let end = Infinity;
    const filters = [];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      in(key, list) { filters.push(row => list.includes(row[key])); return query; },
      not(key, operator, value) {
        if (operator === 'in') filters.push(row => !value.slice(1, -1).split(',').includes(row[key]));
        else if (key === 'control_totals->workflowSnapshot') filters.push(row => row.control_totals?.workflowSnapshot != null);
        else throw new Error(`Unexpected filter ${key}:${operator}`);
        return query;
      },
      order(key, options = {}) { order = { key, ascending: options.ascending !== false }; return query; },
      limit(value) { limit = value; return query; },
      range(a, b) { start = a; end = b; return query; },
      maybeSingle() { single = true; return query; },
      insert(next) { operation = 'insert'; values = next; return query; },
      update(next) { operation = 'update'; values = next; return query; },
      upsert(next) { operation = 'upsert'; values = next; return query; },
      then(resolve, reject) {
        try {
          const stage = table === 'xero_financial_sync_items' && operation === 'insert' ? `items:${++itemChunks}`
            : table === 'xero_financial_sync_runs' && operation === 'update' ? values.status ? 'publish' : 'snapshot'
              : table === 'xero_financial_audit_events' && operation === 'insert' ? 'audit' : `${table}:${operation}`;
          calls.push({ table, operation, stage, values: structuredClone(values) });
          if (stage === 'publish' && race) Object.assign(tables.xero_financial_sync_runs[0], race);
          if (stage === failAt) return Promise.resolve({ data: null, error: { message: `Injected ${stage} failure` } }).then(resolve, reject);
          let matches = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
          if (order) matches.sort((a, b) => String(a[order.key]).localeCompare(String(b[order.key])) * (order.ascending ? 1 : -1));
          matches = matches.slice(start, Math.min(end + 1, limit));
          if (operation === 'insert' || operation === 'upsert') {
            matches = structuredClone(Array.isArray(values) ? values : [values]);
            (tables[table] ||= []).push(...matches);
          }
          if (operation === 'update') matches.forEach(row => Object.assign(row, structuredClone(values)));
          return Promise.resolve({ data: structuredClone(single ? matches[0] || null : matches), error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return query;
  } };
  return { client, tables, calls };
}

function fixture(options = {}) {
  const store = storage(options);
  const salesforce = { buyers: Array.from({ length: options.count ?? 205 }, (_, i) => ({
    Id: `invoice-${i}`, Name: `INV-${i}`, CurrencyIsoCode: 'USD', Amount__c: 100,
    Invoice_Date__c: '2026-09-01', Invoice_Due_Date__c: '2026-09-30',
    STEM__c: `stem-${i}`, STEM__r: { Name: `STEM-${i}` },
  })), suppliers: [], lines: [], extras: [], products: [], productRecords: [], fingerprintBasis: ['source'] };
  const xero = { documents: [], inactiveDocuments: [], contacts: [], organisation: { baseCurrency: 'USD' },
    paymentReadSnapshot: {}, fingerprintBasis: ['xero'], callCount: 2 };
  if (options.exact) {
    const buyer = salesforce.buyers[0];
    Object.assign(buyer, { File__c: '069000000000001AAA', Proforma__c: false, Deprecated__c: false });
    Object.assign(buyer.STEM__r, { Account__c: 'buyer', Account__r: { Name: 'Buyer' } });
    salesforce.lines.push({ Id: 'line', Buyer_Invoice__c: buyer.Id, Product__c: 'product', Product__r: { Name: 'Fuel' },
      Quantity__c: 1, Price_Per_Unit__c: 100, Total_Price__c: 100 });
    xero.contacts.push({ id: 'contact', name: 'Buyer', status: 'ACTIVE' });
    const productMappings = [{ id: 'mapping', enabled: true, direction: 'buyer', salesforce_product_id: 'product',
      xero_account_code: '200', xero_tax_type: 'NONE' }];
    store.tables.xero_financial_product_mappings = productMappings;
    const [source] = buildFinancialClassifications(salesforce, xero, { productMappings, documentMappings: [] }).rows;
    assert.equal(source.status, 'eligible');
    xero.documents.push(normalizeXeroInvoice({ ...source.proposedPayload, InvoiceID: randomUUID(), Total: 100, AmountDue: 100, AmountPaid: 0 }));
    assert.equal(buildFinancialClassifications(salesforce, xero, { productMappings, documentMappings: [] }).rows[0].action, 'link');
  }
  const paymentSnapshot = { rows: [], summary: { total: 0 } };
  const dependencies = { client: store.client, env: {},
    getConnection: async () => ({ scope: 'accounting.invoices accounting.contacts accounting.settings.read' }),
    loadSafetyContext: async () => ({}), loadSalesforce: async () => salesforce,
    loadPayments: async () => [], loadXero: async () => xero,
    querySalesforce: async () => { throw new Error('Buyer-only fixture must not query supplier files'); },
    accountingFetch: async (_connection, path) => ({ [path.slice(1)]: [] }),
    paymentPreview: async () => {
      if (options.failAt === 'payments') throw new Error('Injected payments failure');
      return paymentSnapshot;
    },
  };
  return { ...store, dependencies, paymentSnapshot };
}

for (const failAt of ['items:2', 'payments', 'snapshot', 'audit', 'publish']) {
  test(`preview stays unpublished after ${failAt} failure`, async () => {
    const f = fixture({ failAt });
    await assert.rejects(xeroFinancialSyncPreview({ includePayments: true }, f.dependencies),
      failAt === 'payments' ? /Injected payments failure/ : { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
    const run = f.tables.xero_financial_sync_runs[0];
    assert.equal(run.status, 'building');
    assert.equal(run.revision, 1);
    assert.equal((await xeroFinancialSyncLatest({}, { client: f.client })).preview, null);
    assert.equal(f.calls.filter(call => call.stage === 'publish').length, failAt === 'publish' ? 1 : 0);
    if (failAt === 'items:2') assert.equal(f.tables.xero_financial_sync_items.length, 100);
    if (failAt === 'audit' || failAt === 'publish') assert.deepEqual(run.control_totals.workflowSnapshot.payments, f.paymentSnapshot);
  });
}

test('complete preview publishes once after items, payment snapshot and completion audit', async () => {
  const f = fixture();
  const result = await xeroFinancialSyncPreview({ includePayments: true }, f.dependencies);
  assert.equal(result.run.status, 'ready_for_review');
  assert.equal(result.run.revision, 1);
  assert.equal(result.rows.length, 205);
  assert.equal(f.tables.xero_financial_sync_items.length, 205);
  assert.deepEqual(f.calls.filter(call => ['items:1', 'items:2', 'items:3', 'snapshot', 'audit', 'publish'].includes(call.stage)).map(call => call.stage),
    ['items:1', 'items:2', 'items:3', 'snapshot', 'audit', 'publish']);
  assert.equal(f.tables.xero_financial_audit_events[0].event_type, 'preview_completed');
  const saved = (await xeroFinancialSyncLatest({}, { client: f.client })).preview;
  assert.equal(saved.run.id, result.run.id);
  assert.equal(saved.rows.length, 205);
  assert.deepEqual(saved.payments, f.paymentSnapshot);
});

test('documents-only preview preserves its return shape and publishes after the audit', async () => {
  const f = fixture({ count: 1 });
  const result = await xeroFinancialSyncPreview({}, f.dependencies);
  assert.equal(result.run.status, 'ready_for_review');
  assert.equal(result.payments, null);
  assert.equal(result.rows.length, 1);
  assert.equal(result.postingMode, 'draft');
  assert.equal(result.summary.total, 1);
  assert.equal(f.calls.some(call => call.stage === 'snapshot'), false);
  assert.deepEqual(f.calls.filter(call => ['audit', 'publish'].includes(call.stage)).map(call => call.stage), ['audit', 'publish']);
});

for (const race of [{ status: 'cancelled' }, { revision: 2 }]) {
  test(`publication rejects a concurrent ${Object.keys(race)[0]} change`, async () => {
    const f = fixture({ race });
    await assert.rejects(xeroFinancialSyncPreview({ includePayments: true }, f.dependencies), { code: 'XERO_FINANCIAL_STALE_WRITE' });
    assert.notEqual(f.tables.xero_financial_sync_runs[0].status, 'ready_for_review');
    assert.equal((await xeroFinancialSyncLatest({}, { client: f.client })).preview, null);
  });
}

test('Latest ignores newer building/cancelled runs and preserves published execution history', async () => {
  for (const status of ['ready_for_review', 'authorised', 'processing', 'completed', 'partial', 'failed']) {
    const f = fixture({ count: 1 });
    const result = await xeroFinancialSyncPreview({ includePayments: true }, f.dependencies);
    const run = f.tables.xero_financial_sync_runs[0]; run.status = status;
    // Execution summaries count selected outcomes, not the complete population.
    run.classification_summary.total = 0;
    for (const hidden of ['building', 'cancelled']) f.tables.xero_financial_sync_runs.push({
      ...structuredClone(run), id: randomUUID(), status: hidden, created_at: '9999-01-01T00:00:00Z',
    });
    const latest = (await xeroFinancialSyncLatest({}, { client: f.client })).preview;
    assert.equal(latest.run.id, result.run.id);
    assert.equal(latest.run.status, status);
    assert.equal(latest.rows.length, 1);
  }
});

test('building, cancelled and non-preview snapshots always require a fresh check', async () => {
  for (const change of [{ status: 'building' }, { status: 'cancelled' }, { mode: 'payment_apply' }, { mode: 'document_apply' }]) {
    const f = fixture(); const id = randomUUID();
    f.tables.xero_financial_sync_runs = [{ id, mode: 'preview', status: 'ready_for_review', ...change,
      source_snapshot_at: new Date().toISOString(), control_totals: { workflowSnapshot: {
        reconciliationVersion: XERO_RECONCILIATION_VERSION,
        controlsFingerprint: createHash('sha256').update(JSON.stringify({ productMappings: [], documentMappings: [], bankMappings: [] })).digest('hex'),
        organisation: {},
      } },
    }];
    const result = await financialPreviewChanges(id, { client: f.client, connection: {},
      querySalesforce: async () => { throw new Error('Incomplete run must not probe Salesforce'); },
      accountingFetch: async () => { throw new Error('Incomplete run must not probe Xero'); },
    });
    assert.equal(result.changed, true);
    assert.deepEqual(f.calls.map(call => call.table), ['xero_financial_sync_runs']);
  }
});


test('requested exact-match writes must succeed before the preview can publish', async () => {
  const f = fixture({ count: 1, exact: true, failAt: 'xero_financial_document_mappings:upsert' });
  await assert.rejects(xeroFinancialSyncPreview({ recordExactMatches: true, includePayments: true }, f.dependencies),
    { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
  assert.equal(f.tables.xero_financial_sync_runs[0].status, 'building');
  assert.equal(f.calls.some(call => call.stage === 'publish'), false);
  assert.equal((await xeroFinancialSyncLatest({}, { client: f.client })).preview, null);
});

test('successful exact-match writes precede snapshot, audit and publication', async () => {
  const f = fixture({ count: 1, exact: true });
  const result = await xeroFinancialSyncPreview({ recordExactMatches: true, includePayments: true }, f.dependencies);
  assert.equal(result.run.status, 'ready_for_review');
  assert.equal(f.tables.xero_financial_document_mappings.length, 1);
  const stages = f.calls.map(call => call.stage);
  assert.ok(stages.indexOf('xero_financial_document_mappings:upsert') < stages.indexOf('snapshot'));
  assert.ok(stages.indexOf('snapshot') < stages.indexOf('audit'));
  assert.ok(stages.indexOf('audit') < stages.indexOf('publish'));
});

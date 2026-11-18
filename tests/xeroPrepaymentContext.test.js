import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadPrepaymentQueueCohort, loadPrepaymentQueueContext, loadPrepaymentSalesforceContext, loadXeroPrepaymentContextForStem,
  loadPrepaymentQueueSnapshot, loadPrepaymentQueuePaymentBridges, loadXeroPrepaymentReviewContext,
  loadPrepaymentSettlementSnapshot, resolvePrepaymentStemKey } from '../api/_xeroPrepaymentContext.js';
import { XERO_FINANCIAL_CUTOFF } from '../api/_xeroFinancialSync.js';
import { xeroPrepaymentEvidenceFingerprint } from '../api/_xeroPrepaymentCurrency.js';
import { prepaymentSourceFingerprint } from '../api/_xeroPrepaymentReconciliation.js';
import { allocation, fixture, id } from './fixtures/xeroPrepayment.js';

const stem = 'a01000000000001AAA';
const cashId = 'a02000000000001AAA';
const invoiceId = 'a03000000000001AAA';
const paymentId = 'a04000000000001AAA';
const allocationId = 'a05000000000001AAA';
const safetyContext = {
  fields: { Payment__c: ['Cash_Event__c', 'Buyer_Invoice__c', 'Payment_Currency__c'] },
};

function scopedFixture() {
  const source = fixture();
  allocation(source, { posted: false });
  const cash = { ...source.events[0], Id: cashId, STEM__c: stem, Currency__c: 'HKD' };
  const applied = { ...source.allocations[0], Id: allocationId, Cash_Event__c: cashId, Buyer_Invoice__c: invoiceId, Payment__c: paymentId };
  const invoice = { ...source.invoices[0], Id: invoiceId, STEM__c: stem };
  const payment = { ...source.payments[0], Id: paymentId, STEM__c: stem, Buyer_Invoice__c: invoiceId, Cash_Event__c: cashId };
  const rows = { Trade_Cash_Event__c: [cash], Trade_Cash_Allocation__c: [applied], Payment__c: [payment], Invoice__c: [invoice] };
  const calls = [];
  async function query(soql) {
    calls.push(soql);
    const object = soql.match(/\bFROM (\w+)/)[1];
    const records = rows[object];
    assert.ok(records, soql);
    return { records, totalSize: records.length, done: true };
  }
  return { rows, calls, query };
}

test('reads exact STEM cash, payment bridges and selected invoices with five Salesforce reads', async () => {
  const { query, calls } = scopedFixture();
  const graph = await loadPrepaymentSalesforceContext(stem.slice(0, 15), { query, safetyContext });
  assert.deepEqual(graph.events.map((row) => row.Id), [cashId]);
  assert.deepEqual(graph.allocations.map((row) => row.Id), [allocationId]);
  assert.deepEqual(graph.payments.map((row) => row.Id), [paymentId]);
  assert.deepEqual(graph.invoices.map((row) => row.Id), [invoiceId]);
  assert.equal(calls.length, 5);
  assert.match(calls.find((sql) => sql.includes('FROM Payment__c')), /WHERE STEM__c = 'a01000000000001'/);
  assert.match(calls.find((sql) => sql.includes('FROM Invoice__c WHERE Id IN')), /WHERE Id IN \('a03000000000001AAA'\)/);
});

test('rejects scope spill, missing final invoices and orphan bridge evidence', async () => {
  const fixtures = [
    [(rows) => { rows.Payment__c[0].STEM__c = 'a01000000000002AAA'; }, /mismatched payment STEM/],
    [(rows) => { rows.Invoice__c = []; }, /Invoice__c evidence is incomplete/],
    [(rows) => { rows.Trade_Cash_Event__c = []; rows.Trade_Cash_Allocation__c = []; }, /payment bridge is missing/],
  ];
  for (const [change, expected] of fixtures) {
    const { rows, query } = scopedFixture();
    change(rows);
    await assert.rejects(loadPrepaymentSalesforceContext(stem, { query, safetyContext }), expected);
  }
});

test('rejects missing schema and invalid input before requesting payment or invoice data', async () => {
  const { query, calls } = scopedFixture();
  await assert.rejects(loadPrepaymentSalesforceContext('invalid', { query, safetyContext }), /Invalid prepayment STEM/);
  assert.equal(calls.length, 0);
  await assert.rejects(loadPrepaymentSalesforceContext(stem, { query, safetyContext: {} }), /bridge fields are unavailable/);
  assert.equal(calls.length, 2);
});

test('verifies a normal payment and its managed allocation represent the same cash application', async () => {
  const { rows, calls, query } = scopedFixture();
  const context = { allocations: rows.Trade_Cash_Allocation__c, events: rows.Trade_Cash_Event__c };
  const read = (allocations) => loadPrepaymentQueuePaymentBridges({ context, cohort: { allocations } }, { query });
  const bridge = { paymentId: paymentId.slice(0, 15), cashEventId: cashId.slice(0, 15), allocationId: allocationId.slice(0, 15),
    inCohort: true, reversal: false };
  assert.deepEqual(await read([allocationId]), [bridge]);
  assert.equal(calls.length, 2);
  assert.match(calls.find(soql => soql.includes('FROM Payment__c')), /WHERE Id IN \('a04000000000001AAA'\)/);
  assert.deepEqual(await read([]), [{ ...bridge, inCohort: false }]);
  await assert.rejects(read([allocationId, allocationId.slice(0, 15)]), /invalid or duplicate/);
  await assert.rejects(read([invoiceId]), /missing from the cash graph/);
  assert.equal(calls.length, 4);
  rows.Payment__c[0].Cash_Event__c = invoiceId;
  await assert.rejects(read([allocationId]), /Payment cash event does not match/);
  rows.Payment__c = [];
  await assert.rejects(read([allocationId]), /Payment__c evidence is incomplete/);
});

function mappedContextFixture() {
  const { query } = scopedFixture();
  const tenant = id(9);
  const operation = {
    operation_id: id(20), tenant_id: tenant, cash_event_id: cashId, invoice_mapping_id: id(8),
    xero_prepayment_id: id(5), xero_bank_transaction_id: id(6),
  };
  const mapping = {
    id: id(8), salesforce_id: invoiceId.slice(0, 15), salesforce_object: 'Invoice__c',
    xero_document_id: id(7), xero_document_type: 'ACCREC',
  };
  const tables = {
    xero_financial_prepayment_operations: { records: [operation] },
    xero_financial_document_mappings: { records: [mapping] },
    xero_financial_payment_mappings: { records: [] },
    xero_financial_credit_allocations: { records: [] },
  };
  const databaseReads = [];
  const client = createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, options) => {
      const url = new URL(input);
      const table = url.pathname.split('/').at(-1);
      databaseReads.push(url);
      assert.equal(options.method, 'GET');
      assert.match(new Headers(options.headers).get('prefer'), /count=exact/);
      const { records, count = records.length } = tables[table];
      const start = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      const page = records.slice(start, start + limit);
      return Response.json(page, { headers: { 'content-range': page.length ? `${start}-${start + page.length - 1}/${count}` : `*/${count}` } });
    } },
  });
  const remote = {
    Invoices: { InvoiceID: id(7) },
    Prepayments: { PrepaymentID: id(5) },
    BankTransactions: { BankTransactionID: id(6) },
  };
  const xeroReads = [];
  const options = {
    query, safetyContext, client, connection: { tenantId: tenant }, env: { XERO_TENANT_ID: tenant },
    accountingFetch: async (connection, path, request) => {
      assert.equal(connection.tenantId, tenant);
      assert.equal(request.method, 'GET');
      xeroReads.push(path);
      const collection = path.split('/')[1];
      return { [collection]: [remote[collection]] };
    },
  };
  return { options, tables, databaseReads, xeroReads, remote };
}

test('scopes journal and mapping queries before reading three exact Xero records', async () => {
  const { options, databaseReads, xeroReads } = mappedContextFixture();
  const context = await loadXeroPrepaymentContextForStem(stem, options);
  assert.equal(context.operations.length, 1);
  assert.equal(context.documentMappings[0].salesforce_id, invoiceId.slice(0, 15));
  assert.deepEqual(xeroReads.sort(), [`/BankTransactions/${id(6)}`, `/Invoices/${id(7)}`, `/Prepayments/${id(5)}`]);
  assert.equal(databaseReads.length, 4);
  const filters = databaseReads.map((url) => url.searchParams);
  assert.deepEqual(filters.map((query) => query.get('or')), [
    `(cash_event_id.like.${cashId.slice(0, 15)}%)`,
    `(salesforce_id.like.${invoiceId.slice(0, 15)}%)`,
    `(salesforce_payment_id.like.${paymentId.slice(0, 15)}%)`,
    null,
  ]);
  assert.equal(filters[0].get('tenant_id'), `eq.${id(9)}`);
  assert.equal(filters[3].get('tenant_id'), `eq.${id(9)}`);
  assert.match(filters[3].get('invoice_mapping_id'), new RegExp(id(8)));
});

test('reads an exact two-STEM prepayment cohort with half the per-STEM calls, retaining unresolved operations', async () => {
  const otherStem = 'a01000000000002AAA';
  const otherCash = 'a02000000000002AAA';
  const tenantId = id(9);
  const { rows } = scopedFixture();
  const allEvents = [...rows.Trade_Cash_Event__c, { ...rows.Trade_Cash_Event__c[0], Id: otherCash, STEM__c: otherStem }];
  const operations = [{ operation_id: id(21), tenant_id: tenantId, cash_event_id: otherCash, status: 'unknown' }];
  const calls = { salesforce: 0, journal: 0 };
  const query = async (soql) => {
    calls.salesforce += 1;
    const selected = allEvents.filter((event) => soql.includes(`'${event.STEM__c}'`));
    const records = soql.includes('FROM Trade_Cash_Event__c') ? selected
      : rows.Trade_Cash_Allocation__c.filter((allocation) => selected.some((event) => event.Id === allocation.Cash_Event__c));
    return { done: true, records, totalSize: records.length };
  };
  const client = createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, options) => {
      calls.journal += 1;
      const url = new URL(input);
      assert.equal(url.pathname.split('/').at(-1), 'xero_financial_prepayment_operations');
      assert.equal(url.searchParams.get('tenant_id'), `eq.${tenantId}`);
      assert.equal(options.method, 'GET');
      const scope = url.searchParams.get('or');
      const selected = operations.filter((operation) => scope.includes(operation.cash_event_id.slice(0, 15)));
      return Response.json(selected, { headers: { 'content-range': selected.length ? '0-0/1' : '*/0' } });
    } },
  });
  const options = { client, tenantId, query };
  const separate = [await loadPrepaymentQueueContext(stem, options), await loadPrepaymentQueueContext(otherStem, options)];
  assert.deepEqual(calls, { salesforce: 4, journal: 2 });
  calls.salesforce = calls.journal = 0;
  const cohort = await loadPrepaymentQueueCohort([stem, otherStem], options);
  for (const key of ['events', 'allocations', 'operations']) {
    assert.deepEqual(cohort[key], separate.flatMap((context) => context[key]));
  }
  assert.deepEqual(calls, { salesforce: 2, journal: 1 });
  assert.equal(cohort.operations[0].status, 'unknown');
  await assert.rejects(loadPrepaymentQueueCohort([stem, stem.slice(0, 15)], options), /exact prepayment queue scope/);
  assert.deepEqual(calls, { salesforce: 2, journal: 1 });
});

test('finds post-cutoff allocations on older deposits and separates work membership from supporting history', async () => {
  const { options, databaseReads, xeroReads } = mappedContextFixture();
  const { rows } = scopedFixture();
  const event = { ...rows.Trade_Cash_Event__c[0], Payment_Date__c: '2025-12-30', CreatedDate: '2025-12-30T06:00:00.000Z',
    FX_Effective_At__c: '2025-12-30T00:00:00.000Z' };
  const allocation = { ...rows.Trade_Cash_Allocation__c[0], Allocation_Date__c: '2026-01-02',
    CreatedDate: '2026-01-02T03:00:00.000Z', Cash_Event__r: { STEM__c: stem } };
  const scope = { cutoff: XERO_FINANCIAL_CUTOFF, through: '2026-01-03T00:00:00.000Z' };
  const calls = [];
  const query = async (soql) => {
    calls.push(soql);
    const discovery = soql.includes('WHERE CreatedDate <=');
    if (discovery) {
      assert.match(soql, /CreatedDate <= 2026-01-03T00:00:00.000Z/);
      assert.match(soql, />= 2026-01-01/);
    }
    const object = soql.match(/\bFROM (\w+)/)[1];
    const records = {
      Trade_Cash_Allocation__c: [allocation],
      Trade_Cash_Event__c: discovery ? [] : [event],
      Invoice__c: rows.Invoice__c,
      Payment__c: rows.Payment__c.map(row => ({ ...row, Date__c: event.Payment_Date__c, Payment_FX_Effective_At__c: event.FX_Effective_At__c })),
    }[object];
    return { done: true, totalSize: records.length, records };
  };
  const snapshot = await loadPrepaymentQueueSnapshot(scope, { client: options.client, tenantId: id(9), query });
  assert.deepEqual(snapshot.cohort, { events: [], allocations: [allocationId] });
  assert.deepEqual(snapshot.context.events.map((row) => row.Id), [cashId]);
  assert.equal(snapshot.context.operations.length, 1);
  assert.deepEqual(snapshot.paymentBridges, [{ paymentId: paymentId.slice(0, 15), cashEventId: cashId.slice(0, 15),
    allocationId: allocationId.slice(0, 15), inCohort: true, reversal: false }]);
  assert.equal(calls.length, 6);
  assert.equal(databaseReads.length, 1);
  assert.equal(xeroReads.length, 0);
  const changedReadback = async (soql) => {
    const result = await query(soql);
    if (!soql.includes('WHERE CreatedDate <=') && soql.includes('FROM Trade_Cash_Allocation__c')) {
      return { ...result, records: [{ ...allocation, Allocation_Date__c: '2025-12-30' }] };
    }
    return result;
  };
  await assert.rejects(loadPrepaymentQueueSnapshot(scope, { client: options.client, tenantId: id(9), query: changedReadback }),
    /cohort changed/);
  calls.length = 0;
  await assert.rejects(loadPrepaymentQueueSnapshot({ ...scope, cutoff: '2025-01-01' },
    { client: options.client, tenantId: id(9), query }), /exact financial cutoff/);
  assert.equal(calls.length, 0);
  const truncated = async () => ({ done: false, totalSize: 0, records: [] });
  await assert.rejects(loadPrepaymentQueueSnapshot(scope, { client: options.client, tenantId: id(9), query: truncated }),
    /discovery is incomplete/);
});

test('settlement verifies both managed operations in one exact STEM readback', async () => {
  const raw = fixture();
  allocation(raw);
  const aliases = new Map([['cash', cashId], ['invoice', invoiceId], ['allocation', allocationId], ['payment-a', paymentId], ['stem', stem]]);
  const ledger = JSON.parse(JSON.stringify(raw), (_key, value) => aliases.get(value) ?? value);
  for (const [index, operation] of ledger.operations.entries()) {
    operation.source_kind = index ? 'cash_allocation' : 'cash_event';
    operation.source_hash = prepaymentSourceFingerprint(index ? ledger.allocations[0] : ledger.events[0]);
    operation.request_evidence.sourceFingerprint = operation.source_hash;
    operation.request_hash = xeroPrepaymentEvidenceFingerprint(operation.request_evidence);
  }
  const window = { cutoff: XERO_FINANCIAL_CUTOFF, through: '2026-09-12T00:00:00.000Z' };
  const snapshot = { ...window, tenantId: ledger.tenantId, context: ledger,
    cohort: { events: [cashId], allocations: [allocationId] }, paymentBridges: [] };
  let ledgerReads = 0;
  const options = {
    client: {}, tenantId: ledger.tenantId, env: {}, maxXeroReads: 0, now: () => Date.parse(window.through),
    loadQueue: async () => snapshot,
    readConnection: async () => ({ tenantId: ledger.tenantId, accessToken: 'fixture', expiresAt: '2026-09-12T00:30:00.000Z' }),
    loadLedger: async id => {
      assert.equal(id, stem);
      ledgerReads++;
      return ledger;
    },
  };
  const result = await loadPrepaymentSettlementSnapshot(window, options);
  assert.deepEqual(result.rows.map(({ status }) => status), ['reconciled', 'reconciled']);
  assert.equal(ledgerReads, 1);
  assert.equal(result.xeroReads, 0);
  await assert.rejects(loadPrepaymentSettlementSnapshot(window, { ...options, loadLedger: async () => ({
    ...ledger, xeroPrepayments: [{ ...ledger.xeroPrepayments[0], Allocations: [] }],
  }) }), /unknown or missing application/);
  const unsettled = { ...ledger, operations: [{ ...ledger.operations[1], status: 'unknown' }] };
  const pending = await loadPrepaymentSettlementSnapshot(window, { ...options,
    loadQueue: async () => ({ ...snapshot, context: unsettled }),
    readConnection: () => assert.fail('unresolved proofs do not read Xero'),
  });
  assert.deepEqual(pending.rows.map(({ status }) => status), ['held', 'unresolved']);
});

test('blocks incomplete, wrong-tenant and conflicting journal evidence before Xero calls', async () => {
  const cases = [
    [(tables) => { tables.xero_financial_prepayment_operations.count = 2; }, /history is incomplete/],
    [(tables) => { tables.xero_financial_prepayment_operations.records[0].tenant_id = id(50); }, /out-of-scope/],
    [(tables) => { tables.xero_financial_prepayment_operations.records[0].invoice_mapping_id = id(50); }, /conflicting/],
    [(tables) => { tables.xero_financial_payment_mappings.records.push({ id: id(30), salesforce_payment_id: paymentId, xero_payment_id: id(31) }); }, /bridge mapping/],
    [(tables) => { tables.xero_financial_credit_allocations.records.push({ operation_id: id(40), tenant_id: id(9), invoice_mapping_id: id(8), status: 'unknown' }); }, /unresolved credit allocation/],
  ];
  for (const [change, expected] of cases) {
    const { options, tables, xeroReads } = mappedContextFixture();
    change(tables);
    await assert.rejects(loadXeroPrepaymentContextForStem(stem, options), expected);
    assert.deepEqual(xeroReads, []);
  }
});

test('rejects mismatched Xero readback and an unpinned tenant', async () => {
  const { options, databaseReads, remote } = mappedContextFixture();
  await assert.rejects(loadXeroPrepaymentContextForStem(stem, { ...options, env: { XERO_TENANT_ID: id(50) } }), /verified Xero tenant/);
  assert.deepEqual(databaseReads, []);
  remote.Invoices.InvoiceID = id(50);
  await assert.rejects(loadXeroPrepaymentContextForStem(stem, options), /Exact Xero Invoices readback is incomplete/);
});

test('reads all scoped journal pages and deduplicates provider identities', async () => {
  const { options, tables, databaseReads, xeroReads } = mappedContextFixture();
  const journal = tables.xero_financial_prepayment_operations;
  journal.records = Array.from({ length: 251 }, (_, index) => ({ ...journal.records[0], operation_id: id(index + 500) }));
  const context = await loadXeroPrepaymentContextForStem(stem, options);
  assert.equal(context.operations.length, 251);
  const journalReads = databaseReads.filter((url) => url.pathname.endsWith('xero_financial_prepayment_operations'));
  assert.deepEqual(journalReads.map((url) => url.searchParams.get('offset')), ['0', '250']);
  assert.equal(xeroReads.length, 3);
  journal.records[250] = journal.records[0];
  await assert.rejects(loadXeroPrepaymentContextForStem(stem, options), /duplicate or out-of-scope/);
  assert.equal(xeroReads.length, 3);
});

function depositReviewFixture(currency = 'USD') {
  const tenantId = id(9);
  const contactId = id(3);
  const source = fixture();
  const cash = { ...source.events[0], Id: cashId, STEM__c: stem, Currency__c: currency };
  const policies = [{ tenant_id: tenantId, direction: 'Sell', currency, revision: 2 }];
  const bankMappings = [{ id: id(50), enabled: true }];
  const reads = [];
  const dbReads = [];
  const options = {
    connection: { tenantId, scope: 'accounting.settings.read' },
    client: createClient('https://fixture.invalid', 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, request) => {
        const url = new URL(input);
        dbReads.push(url);
        assert.equal(request.method, 'GET');
        const table = url.pathname.split('/').at(-1);
        if (table === 'xero_prepayment_posting_policies') return Response.json(policies[0]);
        assert.equal(table, 'xero_financial_bank_mappings');
        return Response.json(bankMappings, { headers: { 'content-range': '0-0/1' } });
      } },
    }),
    env: { XERO_TENANT_ID: tenantId },
    loadLedger: async (selectedStem) => {
      assert.equal(selectedStem, stem);
      return { tenantId, events: [cash], allocations: [], operations: [] };
    },
    loadInventory: () => assert.fail('A deposit must not scan the invoice inventory'),
    accountingFetch: async (_connection, path, request) => {
      reads.push(path);
      assert.equal(request.method, 'GET');
      if (path === '/Organisations') return { Organisations: [{ OrganisationID: id(59), BaseCurrency: 'USD' }] };
      if (path === `/Contacts/${contactId}`) return { Contacts: [{ ContactID: contactId }] };
      if (path === '/Accounts') return { Accounts: [{ AccountID: id(2) }] };
      if (path === '/TaxRates') return { TaxRates: [{ TaxType: 'NONE' }] };
      assert.match(path, /^\/BankTransactions\?/);
      return { BankTransactions: [], pagination: { page: 1, pageCount: 0, itemCount: 0 } };
    },
  };
  return { options, reads, dbReads, selection: { action: 'create', sourceId: cashId, contactId } };
}

test('deposit review reads only the selected contact, exact posting policy and two bounded searches', async () => {
  const { options, reads, dbReads, selection } = depositReviewFixture();
  const review = await loadXeroPrepaymentReviewContext(stem, selection, options);
  assert.equal(review.contacts[0].ContactID, selection.contactId);
  assert.equal(review.policies[0].revision, 2);
  assert.deepEqual(review.bankDiscovery, { complete: true, rows: [] });
  assert.equal(reads.length, 6);
  const search = reads.filter((path) => path.includes('?')).map((path) => new URL(path, 'https://fixture.invalid').searchParams.get('where'));
  assert.ok(search.some((filter) => filter.startsWith('Reference=="FCOS-')));
  assert.ok(search.some((filter) => filter.startsWith('Type=="RECEIVE-PREPAYMENT"&&Date==DateTime(')));
  const policy = dbReads.find((url) => url.pathname.endsWith('posting_policies')).searchParams;
  assert.equal(policy.get('tenant_id'), `eq.${id(9)}`);
  assert.equal(policy.get('direction'), 'eq.Sell');
  assert.equal(policy.get('currency'), 'eq.USD');
});

test('HKD deposit is blocked before loading Xero review and posting policy data', async () => {
  const { options, reads, dbReads, selection } = depositReviewFixture('HKD');
  await assert.rejects(loadXeroPrepaymentReviewContext(stem, selection, options),
    { code: 'XERO_PREPAYMENT_HKD_UNSUPPORTED' });
  assert.deepEqual(reads, []);
  assert.deepEqual(dbReads, []);
});

test('deposit context holds truncated legacy search, foreign tenant and unsupported settings scope', async () => {
  const { options, selection } = depositReviewFixture();
  await assert.rejects(loadXeroPrepaymentReviewContext(stem, selection, { ...options,
    accountingFetch: (connection, path, request) => path.startsWith('/BankTransactions?')
      ? { BankTransactions: [], pagination: { page: 1, pageCount: 2, itemCount: 101 } }
      : options.accountingFetch(connection, path, request),
  }), /deposit search was incomplete/);
  await assert.rejects(loadXeroPrepaymentReviewContext(stem, selection, { ...options,
    loadLedger: async () => ({ tenantId: id(12) }),
  }), /belongs to another tenant/);
  await assert.rejects(loadXeroPrepaymentReviewContext(stem, selection, { ...options,
    connection: { tenantId: id(9), scope: 'accounting.contacts' },
  }), /settings read access/);
});

test('allocation review holds when the invoice changes between exact read and the maintained inventory', async () => {
  const { options, selection } = depositReviewFixture();
  const source = {
    tenantId: id(9), events: [{ Id: cashId, STEM__c: stem, Kind__c: 'Payment' }],
    allocations: [{ Id: allocationId, Cash_Event__c: cashId, Buyer_Invoice__c: invoiceId }],
    operations: [{ cash_event_id: cashId, action: 'create', status: 'applied',
      request_evidence: { proposal: { evidence: { contactId: selection.contactId } } } }],
    documentMappings: [{ salesforce_id: invoiceId, salesforce_object: 'Invoice__c', xero_document_id: id(7) }],
    xeroInvoices: [{ InvoiceID: id(7), Status: 'AUTHORISED', UpdatedDateUTC: 'first' }],
  };
  let observed = 'second';
  let calls = 0;
  const review = () => loadXeroPrepaymentReviewContext(stem, { action: 'allocate', sourceId: allocationId }, {
    ...options,
    loadLedger: async () => source,
    loadInventory: async () => ({ tenantId: id(9), contactsComplete: true, contacts: [], documents: [{ id: id(7), updatedDateUTC: observed }], inactiveDocuments: [] }),
    loadDocuments: async (_cutoff, links, { xeroSnapshot }) => {
      calls++;
      assert.deepEqual(links, [{ category: 'link_only', sourceObject: 'Invoice__c', sourceId: invoiceId, targetId: id(7) }]);
      assert.equal(xeroSnapshot.documents[0].status, 'AUTHORISED');
      return { buyers: [], suppliers: [], lines: [], extras: [], documentLinkScope: { cases: links, complete: true } };
    },
    loadControls: async () => ({ productMappings: [], documentMappings: [] }),
  });
  await assert.rejects(review(), /invoice details contradict/);
  assert.equal(calls, 0);
  observed = 'first';
  assert.deepEqual((await review()).invoiceClassifications, []);
  assert.equal(calls, 1);
});

test('resolves one exact business STEM reference and rejects ambiguous or injected references', async () => {
  const key = 'HK2600100T';
  const record = { Id: stem, KeyStem__c: key };
  assert.equal(await resolvePrepaymentStemKey(key, async (soql) => {
    assert.match(soql, /WHERE KeyStem__c = 'HK2600100T' LIMIT 2/);
    return { records: [record], totalSize: 1 };
  }), stem);
  await assert.rejects(resolvePrepaymentStemKey(key, async () => ({ records: [record, record], totalSize: 2 })), /one exact record/);
  await assert.rejects(resolvePrepaymentStemKey("HK' OR Name", () => assert.fail('Invalid input must not query Salesforce')), /exact STEM reference/);
});

test('credit review reuses its exact invoice response and ignores only the matching unsent journal row', async () => {
  const { options, tables, xeroReads, remote } = mappedContextFixture();
  const current = { operation_id: id(40), tenant_id: id(9), invoice_mapping_id: id(8),
    credit_mapping_id: id(41), request_hash: 'a'.repeat(64), status: 'processing', send_started_at: null };
  tables.xero_financial_credit_allocations.records.push(current);
  const scoped = { ...options, verifiedInvoice: remote.Invoices, currentUnsentCredit: { ...current } };
  const context = await loadXeroPrepaymentContextForStem(stem, scoped);
  assert.deepEqual(context.creditAllocationLedger, []);
  assert.deepEqual(context.xeroInvoices, [remote.Invoices]);
  assert.deepEqual(xeroReads.sort(), [`/BankTransactions/${id(6)}`, `/Prepayments/${id(5)}`]);
  current.send_started_at = '2026-09-02T00:00:00Z';
  await assert.rejects(loadXeroPrepaymentContextForStem(stem, scoped), /unresolved credit allocation/);
  assert.equal(xeroReads.length, 2);
});

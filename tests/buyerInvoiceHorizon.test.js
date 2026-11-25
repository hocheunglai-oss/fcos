import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { buyerInvoiceDueCandidates, buyerInvoiceDueDateInRange } from '../api/_buyerInvoiceDates.js';
import { buyerInvoiceEmailSettingsPatch } from '../src/lib/buyerInvoiceEmailSettings.js';
import { buyerInvoiceDaysAhead, DEFAULT_BUYER_INVOICE_DAYS_AHEAD } from '../src/lib/buyerInvoiceHorizon.js';
import { PAYMENT_DATA_RELIABLE_FROM, paymentDataReliabilityMetadata, paymentDataReliableSoql } from '../src/lib/paymentDataReliability.js';

const [api, page] = await Promise.all([
  readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/BuyerInvoices.jsx', import.meta.url), 'utf8'),
]);
const deskAccount = 'a01000000000001AAA';
const access = { client: {}, profile: { id: 'test-user' } };
const dueToday = '2026-07-01';

function sourceFunction(source, name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} exists`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function pageAction(name) {
  const start = page.indexOf(`  const ${name} = `);
  assert.ok(start >= 0, `${name} exists`);
  return page.slice(start, page.indexOf('\n  };', start) + 5);
}

function fixture(name, fields) {
  return {
    Id: name, Name: name, Account__c: deskAccount, CreatedDate: '2026-06-01T00:00:00Z',
    Payment_Date__c: null, Due_Date_Override__c: false, Not_Cancelled_STEM_Line_Item_Quantity__c: 1,
    Receivable_Balance__c: 100, ...fields,
  };
}

const fixtures = [
  fixture('yesterday', { Delivery_Date__c: '2026-06-30', Payment_Term__c: '1 day' }),
  fixture('today', { Delivery_Date__c: dueToday, Payment_Term__c: '0 days' }),
  fixture('tomorrow', { Delivery_Date__c: '2026-07-02', Payment_Term__c: '1 day' }),
  fixture('cia-today', { Expected_Delivery_Date__c: '2026-07-02', Payment_Term__c: ' cia ' }),
  fixture('cia-tomorrow', { Expected_Delivery_Date__c: '2026-07-03', Payment_Term__c: 'CIA' }),
  fixture('negative-today', { Delivery_Date__c: '2026-07-10', Payment_Term__c: 'advance -9.9 days' }),
  fixture('negative-tomorrow', { Delivery_Date__c: '2026-07-03', Payment_Term__c: '-1 day' }),
  fixture('positive-tomorrow', { Delivery_Date__c: '2026-06-30', Payment_Term__c: '3 days' }),
  fixture('override-today', { Due_Date_Override__c: true, Invoice_Due_Date__c: dueToday, Delivery_Date__c: '2026-09-01', Payment_Term__c: '1 day' }),
  fixture('override-tomorrow', { Due_Date_Override__c: true, Invoice_Due_Date__c: '2026-07-02', Delivery_Date__c: dueToday, Payment_Term__c: '1 day' }),
  fixture('extra-only', { Not_Cancelled_STEM_Line_Item_Quantity__c: 0, Invoice_Due_Date__c: dueToday, Expected_Delivery_Date__c: '2026-07-02', Payment_Term__c: 'CIA' }),
  fixture('extra-override', { Not_Cancelled_STEM_Line_Item_Quantity__c: 0, Due_Date_Override__c: true, Invoice_Due_Date__c: dueToday }),
  fixture('other-account', { Account__c: 'another desk', Delivery_Date__c: dueToday, Payment_Term__c: '1 day' }),
  fixture('paid', { Payment_Date__c: dueToday, Delivery_Date__c: dueToday, Payment_Term__c: '1 day' }),
  fixture('unreliable', { Delivery_Date__c: '2025-12-31', Due_Date_Override__c: true, Invoice_Due_Date__c: dueToday }),
  fixture('invalid', { Due_Date_Override__c: true, Invoice_Due_Date__c: '2026-06-31' }),
];

// Interpret the small SOQL subset emitted by the real query against the
// fixtures, independently of the application's date calculation.
function selectFixtures(soql) {
  const where = soql.match(/\bWHERE\s+([\s\S]+?)\s+ORDER BY/)?.[1];
  assert.ok(where, 'the fixture query must contain a WHERE clause');
  const expression = where.replace(/(\w+)\s+(LIKE|!=|<=|>=|=|>)\s+('[^']*'|[\w:.-]+)/g,
    (_, field, operator, operand) => `match(${JSON.stringify(field)}, ${JSON.stringify(operator)}, ${JSON.stringify(operand)})`)
    .replace(/\bAND\b/g, '&&').replace(/\bOR\b/g, '||');
  const predicate = vm.runInNewContext(`match => ${expression}`);
  return fixtures.filter((row) => predicate((field, operator, operand) => {
    const actual = row[field] ?? null;
    const value = /^null$/i.test(operand) ? null : operand === 'true' ? true : operand === 'false' ? false : operand.replace(/^'|'$/g, '');
    if (operator === '=') return actual === value;
    if (operator === '!=') return actual !== value;
    if (actual == null) return false;
    if (operator === 'LIKE') return String(actual).toUpperCase().includes(value.slice(1, -1).toUpperCase());
    if (operator === '<=') return actual <= value;
    if (operator === '>=') return actual >= value;
    return actual > value;
  }));
}

function harness() {
  const state = { settings: { subject: 'Outstanding invoices', intro: 'Due through {{reportEnd}} ({{daysAhead}} days)' }, revision: 1, queries: [], snapshots: [], enriched: [], previews: [] };
  const names = [...new Set(fixtures.flatMap(Object.keys))];
  const fields = names.map((name) => name === 'Due_Date_Override__c' ? { name, type: 'boolean', nillable: false } : { name });
  const context = vm.createContext({
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : ['2026-06-30T16:15:00.000Z'])); }
    },
    URL, URLSearchParams,
    buyerInvoiceDaysAhead, DEFAULT_BUYER_INVOICE_DAYS_AHEAD, buyerInvoiceEmailSettingsPatch,
    buyerInvoiceDueCandidates, buyerInvoiceDueDateInRange,
    paymentDataReliableSoql, paymentDataReliabilityMetadata, PAYMENT_DATA_RELIABLE_FROM,
    safeSupabaseAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => ({ data: {} }) }) }) }) }),
    supabaseAdminClient: () => ({}),
    loadFinancialReportSettings: async () => ({ settings: state.settings, revision: state.revision, configured: true }),
    saveFinancialReportSettings: async (_client, _key, update) => {
      assert.equal(update.expectedRevision, state.revision);
      state.settings = update.settings;
      state.revision += 1;
      return { settings: state.settings, revision: state.revision, configured: true };
    },
    loadPaymentCollectionThresholds: async () => ({}), paymentCollectionThresholdCacheKey: () => 'test-threshold',
    salesforceObjectFields: async ({ objectName }) => ({ fields: objectName === 'stem__c' ? fields : [] }),
    interofficeStemAccessCondition: async (context) => {
      assert.equal(context, access);
      return `Account__c = '${deskAccount}'`;
    },
    accountInvoiceFormatFields: () => [], accountBrokerEmailFields: () => [], isSalesforceId: () => false,
    queryRows: async (query, options) => {
      assert.equal(options.limit, 10000);
      assert.match(query, /LIMIT 10000/);
      const selected = selectFixtures(query);
      state.queries.push(selected.map((row) => row.Id));
      return selected;
    },
    chunkIds: (ids) => { state.enriched.push(Array.from(ids)); return [ids]; },
    compositeQueryRows: async () => [[]], formatStemName: (stem) => stem.Name,
    paymentCollectionThresholdPolicy: () => ({}), paymentCollectionBalanceIsSettled: () => false,
    uniqueEmailList: (...values) => values.flat().filter(Boolean), combineBuyerBrokerRouting: () => ({}),
    earliestEtaDate: () => null, loadBuyerInvoiceCollectionMap: async () => ({}),
    loadBuyerInvoiceReminderRules: async () => ({ rules: [], available: true }), applyBuyerReminderRules: (rows) => rows,
    cachedSalesforceValue: async ({ loader, payload }) => {
      state.snapshots.push(payload.daysAhead);
      return { value: await loader() };
    },
    parseEmailList: (value, fallback) => value ?? fallback, parseStringList: (value, fallback) => value ?? fallback,
    normalizeSalesforceFieldPath: (value) => value, nextBuyerInvoiceScheduleRun: () => null,
    requireCapability: async () => {}, userHasCapability: async () => true,
    updateBuyerInvoiceEmailSettingsMeta: async (patch) => state.previews.push(patch),
    fcosPublicUrl: () => 'https://fcos.example', hasHtmlMarkup: () => false,
    sendOperationalMail: async () => assert.fail('a preview must never send mail'),
  });
  const defaults = api.slice(api.indexOf('const DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS ='), api.indexOf('const BUYER_INVOICE_COLLECTION_STATUSES ='));
  vm.runInContext(defaults, context);
  for (const name of [
    'dateOnly', 'addDays', 'daysBetween', 'escapeSoql', 'prpspDisplayStatus', 'splitBuyerTraderNames', 'traderEmailLookupKey',
    'salesforceBuyerInvoicesSnapshot', 'buyerInvoiceReportFromSnapshot', 'salesforceBuyerInvoicesDue', 'salesforceBuyerInvoicesDueTargeted',
    'normalizeBuyerInvoiceEmailSettings', 'buyerInvoiceEmailSettings', 'serializeBuyerInvoiceEmailSettingsRow',
    'loadStoredBuyerInvoiceEmailSettings', 'saveStoredBuyerInvoiceEmailSettings', 'buyerInvoiceEmailSettingsGet', 'buyerInvoiceEmailSettingsSave',
    'buyerInvoiceAppUrl', 'buyerInvoiceFilterUrl', 'money', 'escapeHtml', 'prettyDate', 'overdueSeverity', 'overdueDisplayValue', 'overdueEmailStyles',
    'renderBuyerInvoiceEmailContent', 'emailContentHtml', 'buyerTraderFilterHtml', 'buildBuyerInvoiceReportEmail', 'outstandingBuyerInvoicesEmailReport',
  ]) vm.runInContext(sourceFunction(api, name), context);
  return { state, context };
}

test('parses invoice horizons consistently', () => {
  for (const value of [0, '0', ' 0 ', '-5', -0.5]) assert.equal(buyerInvoiceDaysAhead(value), 0);
  for (const value of [null, undefined, '', '  ', 'invalid', NaN, Infinity, false, [], {}]) assert.equal(buyerInvoiceDaysAhead(value), 7);
  for (const value of [366, '1000']) assert.equal(buyerInvoiceDaysAhead(value), 365);
  assert.equal(buyerInvoiceDaysAhead('1.9'), 1);
});

test('URL, desktop request, settings roundtrip, snapshot and report preview agree at zero days', async () => {
  const { context, state } = harness();
  let list;
  let displayedRows;
  const ui = vm.createContext({
    buyerInvoiceDaysAhead, URLSearchParams,
    window: { location: { search: '?daysAhead=0' } },
    splitBuyerTraderNames: context.splitBuyerTraderNames,
    emailSettings: { daysAhead: 0 }, buyerTraderOptions: [], selectedBuyerTraders: [],
    setLoading: () => {}, setError: () => {}, setResponseMeta: () => {},
    setRows: (rows) => { displayedRows = rows; }, setMeta: (meta) => { list = meta; },
    requestInvoices: async ({ name, payload, apply }) => {
      assert.equal(name, 'salesforceBuyerInvoicesDue');
      assert.equal(payload.daysAhead, 0);
      apply({ data: await context.salesforceBuyerInvoicesDue(payload, null, access) });
    },
  });
  vm.runInContext(sourceFunction(page, 'readInitialFilters'), ui);
  assert.equal(ui.readInitialFilters().daysAhead, 0);
  for (const value of [0, '0']) {
    ui.emailSettings.daysAhead = value;
    const settings = vm.runInContext(`${pageAction('settingsForServer')}\nsettingsForServer()`, vm.createContext({ ...ui }));
    const saved = await context.buyerInvoiceEmailSettingsSave({ settings, expectedRevision: state.revision }, null, access);
    assert.equal(saved.settings.daysAhead, 0);
    assert.equal(state.settings.daysAhead, 0);
    assert.equal((await context.buyerInvoiceEmailSettingsGet({}, null, access)).settings.daysAhead, 0);
  }
  const rawSaved = await context.buyerInvoiceEmailSettingsSave({ settings: { daysAhead: '0' }, expectedRevision: state.revision }, null, access);
  assert.equal(rawSaved.settings.daysAhead, 0);
  state.settings.daysAhead = '0';
  assert.equal((await context.buyerInvoiceEmailSettingsGet({}, null, access)).settings.daysAhead, 0);
  ui.daysAhead = ui.readInitialFilters().daysAhead;
  await vm.runInContext(`${pageAction('loadRows')}\nloadRows()`, ui);
  const preview = await context.outstandingBuyerInvoicesEmailReport({ preview: true }, null, access);
  const fromString = await context.salesforceBuyerInvoicesDue({ daysAhead: '0' }, null, access);
  const targeted = await context.salesforceBuyerInvoicesDueTargeted({ daysAhead: '0' }, null, access);
  const expected = [
    ['yesterday', '2026-06-30', 'Overdue'],
    ['cia-today', dueToday, 'Due Today'], ['extra-override', dueToday, 'Due Today'],
    ['negative-today', dueToday, 'Due Today'], ['override-today', dueToday, 'Due Today'], ['today', dueToday, 'Due Today'],
  ];
  const summary = (report) => Array.from(report.rows, (row) => [row.stemId, row.buyerInvoiceDueDate, row.status]);
  for (const report of [list, preview.report, fromString, targeted]) {
    assert.equal(report.today, dueToday);
    assert.equal(report.daysAhead, 0);
    assert.equal(report.dueThrough, dueToday);
    assert.deepEqual(summary(report), expected);
  }
  assert.deepEqual(summary({ rows: displayedRows }), expected);
  assert.equal(preview.sent, false);
  assert.match(preview.email.text, /\(0 days\)/);
  assert.match(preview.email.html, /Due in 0 Days/);
  const reportUrl = new URL(preview.email.text.match(/Open all invoices: (\S+)/)[1]);
  ui.window.location.search = reportUrl.search;
  assert.equal(ui.readInitialFilters().daysAhead, 0);
  assert.deepEqual(state.snapshots, [0, 0, 0]);
  assert.equal(state.previews[0].last_preview_row_count, expected.length);
  for (const ids of state.queries) {
    assert.ok(ids.includes('cia-today') && ids.includes('negative-today'));
    assert.ok(!ids.includes('tomorrow') && !ids.includes('cia-tomorrow') && !ids.includes('other-account') && !ids.includes('paid'));
    assert.ok(ids.includes('negative-tomorrow') && ids.includes('positive-tomorrow') && ids.includes('extra-only') && ids.includes('invalid'));
  }
  for (const ids of state.enriched) assert.deepEqual([...ids].sort(), expected.map(([id]) => id).sort());

  const tomorrow = await context.salesforceBuyerInvoicesDue({ daysAhead: '1' }, null, access);
  assert.equal(tomorrow.dueThrough, '2026-07-02');
  assert.deepEqual(Array.from(tomorrow.rows.filter((row) => row.status === 'Due Soon'), (row) => row.stemId), [
    'cia-tomorrow', 'negative-tomorrow', 'override-tomorrow', 'positive-tomorrow', 'tomorrow',
  ]);
});

test('candidate selection retains legacy stored due dates without override metadata', () => {
  const { dueFields, dueCondition } = buyerInvoiceDueCandidates([
    { name: 'QLIK_Invoice_Due_Date__c' }, { name: 'Expected_Delivery_Date_Payment_Term__c' },
  ], dueToday);
  assert.deepEqual(dueFields, ['QLIK_Invoice_Due_Date__c', 'Expected_Delivery_Date_Payment_Term__c']);
  assert.doesNotMatch(dueCondition, /Due_Date_Override__c/);
  assert.equal(buyerInvoiceDueDateInRange({ QLIK_Invoice_Due_Date__c: dueToday }, dueToday), dueToday);
  assert.equal(buyerInvoiceDueDateInRange({ QLIK_Invoice_Due_Date__c: '2025-12-31' }, dueToday), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRemittanceInventory, enrichGroupRemittanceBankSources } from '../api/_xeroRemittanceInventory.js';
import { loadSalesforcePayments } from '../api/_xeroFinancialSync.js';
import { currentRemittanceSummary } from '../api/_xeroRemittanceSummary.js';
import { validateGroupRemittanceBankEvidence } from '../api/_xeroGroupRemittanceBankEvidence.js';

const key = (prefix, n) => `${prefix}${String(n).padStart(12, '0')}`;
const copy = value => structuredClone(value);
const complete = records => ({ records, totalSize: records.length });
const currency = () => ({ currency: 'USD', blockers: [] });
const withCurrency = row => ({ ...row, _currency: currency() });
const safety = { singleCurrency: false, fields: { Payment__c: ['CurrencyIsoCode'], Invoice__c: ['CurrencyIsoCode', 'Credit_Note__c'] } };
const longId = value => {
  let suffix = '';
  for (let block = 0; block < 3; block += 1) {
    let mask = 0;
    for (let bit = 0; bit < 5; bit += 1) if (/[A-Z]/.test(value[block * 5 + bit])) mask |= 1 << bit;
    suffix += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[mask];
  }
  return value + suffix;
};

// Independent raw provider fixtures: the loader and real proof evaluator, rather
// than fabricated eligibility flags, decide whether each family is supported.
function fixture() {
  const groupId = key('001', 1); const parentId = key('a0S', 1);
  const common = { IsDeleted: false, CreatedDate: '2026-01-02T00:00:00Z', LastModifiedDate: '2026-01-02T00:00:01Z',
    Date__c: '2026-01-02', Supplier_Invoice__c: null, Reference__c: null, Is_Deposit__c: false,
    Is_Volume_Discount__c: false, Commission_Invoice__c: null, CurrencyIsoCode: 'USD' };
  const parent = { ...common, Id: parentId, Name: 'Group receipt', RecordType: { DeveloperName: 'Receivable_Remittance' },
    Account__c: groupId, Amount__c: 100, Bank__c: 'UBS', Remittance__c: null, STEM__c: null };
  const siblings = [0, 1].map(n => ({ ...common, Id: key('a0S', n + 2), Name: `Allocation ${n + 1}`,
    RecordType: { DeveloperName: 'Receivable' }, Account__c: key('001', n + 2), Amount__c: 50,
    Bank__c: null, Remittance__c: parentId, STEM__c: key('a0H', n + 1) }));
  const account = (Id, Name, type, ParentId, company) => ({ Id, IsDeleted: false, Name,
    RecordType: { DeveloperName: type }, ParentId, Company_Code__c: company, Inactive_Suspended__c: false,
    LastModifiedDate: '2026-01-01T00:00:00Z' });
  const accounts = [account(groupId, 'GROUP - FC', 'Group', null, 'GROUP FC'),
    ...siblings.map((row, n) => account(row.Account__c, 'SAME LITERAL BUYER NAME', 'Buyer_Supplier', groupId, `DISTINCT ${n}`))];
  const invoices = siblings.map((row, n) => ({ Id: key('a0K', n + 1), IsDeleted: false, Name: `${20000 + n}T-INV-1`,
    STEM__c: row.STEM__c, STEM__r: { Account__c: row.Account__c }, Amount__c: 50,
    Proforma__c: false, Deprecated__c: false, Credit_Note__c: false, File__c: null,
    CreatedDate: '2025-12-30T00:00:00Z', LastModifiedDate: '2026-01-01T00:00:00Z',
    Invoice_Date__c: '2025-12-30', Invoice_Due_Date__c: '2026-01-13', CurrencyIsoCode: 'USD' }));
  return { parent, siblings, accounts, invoices, visible: copy([parent, ...siblings]) };
}

function harness(f, transform = () => null) {
  const calls = [];
  const invoke = async (channel, soql, options) => {
    const kind = /FROM Account\b/.test(soql) ? 'accounts' : /FROM Invoice__c\b/.test(soql) ? 'invoices'
      : /WHERE Remittance__c IN/.test(soql) ? 'siblings' : /WHERE Id IN/.test(soql) ? 'parents' : 'visible';
    calls.push({ channel, kind, soql, options });
    const records = kind === 'parents' ? [f.parent] : f[kind];
    return transform({ channel, kind, soql, options, records }) ?? complete(records);
  };
  return { calls, querySalesforce: (soql, options) => invoke('regular', soql, options),
    queryAll: (soql, options) => invoke('all', soql, options) };
}
const load = (f, h, context = safety) => loadSalesforcePayments('2026-01-01', context, h.querySalesforce, { queryAll: h.queryAll });
const assertHeld = rows => {
  const children = rows.filter(row => row.RecordType.DeveloperName === 'Receivable');
  assert.ok(children.length);
  for (const row of children) {
    assert.equal(row.Bank__c, null);
    assert.equal(row._groupBankEvidence, undefined);
    assert.ok(row._groupBankEvidenceBlocker || row._bankEvidenceBlocker);
    assert.equal(row._bankEvidence, undefined);
  }
};

test('real payment loader collects complete Group source proof without mutating raw bank or debtor identities', async () => {
  const f = fixture(); const before = copy(f); const h = harness(f); const rows = await load(f, h);
  assert.deepEqual(f, before);
  assert.equal(rows.length, 3);
  assert.equal(currentRemittanceSummary(rows[0]), null, 'different debtor Accounts remain outside header-summary policy');
  for (const row of rows.slice(1)) {
    assert.equal(row.Bank__c, null);
    assert.equal(row._bankEvidence, undefined);
    assert.equal(row._groupBankEvidence.bank, 'UBS');
    assert.equal(row._groupBankEvidence.debtorAccountId, row.Account__c);
    assert.equal(validateGroupRemittanceBankEvidence(row, row._groupBankEvidence).eligible, true);
    assert.deepEqual(row._buyerDocumentEvidence.blockers, []);
  }
  assert.notEqual(rows[1].Account__c, rows[2].Account__c);
  assert.equal(h.calls.filter(call => call.kind === 'parents').length, 1);
  assert.equal(h.calls.filter(call => call.kind === 'siblings').length, 1);
  assert.equal(h.calls.filter(call => call.channel === 'all' && call.kind === 'invoices').length, 1);
  for (const call of h.calls.filter(call => call.channel === 'all')) {
    assert.deepEqual(call.options, { clean: true, limit: 100000 });
    assert.doesNotMatch(call.soql, /(?:Date__c|CreatedDate)\s*[><=]|IsDeleted\s*=|Deprecated__c\s*=|Proforma__c\s*=/);
  }
  for (const call of h.calls.filter(call => call.kind === 'invoices')) {
    assert.match(call.soql, /Credit_Note__c/);
    assert.doesNotMatch(call.soql, /Is_Credit_Note__c|CreditNote__c/);
  }
  assert.deepEqual(rows[1]._groupBankEvidence.source.buyerDocumentInventories[0].creditFields, ['Credit_Note__c']);
});

test('all-years inventory binds nonvisible historical parent and sibling without adding visible payments', async () => {
  const f = fixture();
  for (const row of [f.parent, ...f.siblings]) row.Date__c = '2025-12-31';
  const visible = [withCurrency(copy(f.siblings[0]))]; const before = copy(visible); const h = harness(f);
  const inventory = await loadRemittanceInventory(visible, { queryAll: h.queryAll, fields: 'Id, Date__c, IsDeleted', withCurrency });
  assert.equal(inventory.complete, true);
  const rows = await enrichGroupRemittanceBankSources(visible, { inventory, queryAll: h.queryAll,
    invoiceCurrencyFields: ', CurrencyIsoCode, Credit_Note__c', creditFields: ['Credit_Note__c'], currencyForInvoice: currency });
  assert.equal(rows.length, 1);
  assert.deepEqual(visible, before);
  assert.equal(rows[0]._groupBankEvidence.source.parent.Date__c, '2025-12-31');
  assert.equal(rows[0]._groupBankEvidence.source.allocations.length, 2);
  assert.equal(validateGroupRemittanceBankEvidence(rows[0], rows[0]._groupBankEvidence).eligible, true);
  assert.ok(h.calls.every(call => !/\bWHERE.*(?:Date__c|CreatedDate)/.test(call.soql)));
});

const heldSources = [
  ['deleted parent', f => { f.parent.IsDeleted = true; }],
  ['deleted sibling', f => { f.siblings[1].IsDeleted = true; }],
  ['unknown sibling deletion', f => { delete f.siblings[1].IsDeleted; }],
  ['different visible sibling reference', f => { f.siblings[1].Reference__c = 'changed after visible read'; }],
  ['changed direct membership', f => { f.accounts[2].ParentId = key('001', 999); }],
  ['deleted debtor', f => { f.accounts[2].IsDeleted = true; }],
  ['inactive Group', f => { f.accounts[0].Inactive_Suspended__c = true; }],
  ['deleted buyer invoice', f => { f.invoices[1].IsDeleted = true; }],
  ['metadata-known missing credit flag', f => { delete f.invoices[1].Credit_Note__c; }],
  ['metadata-known credit flag', f => { f.invoices[1].Credit_Note__c = true; }],
  ['unlisted supplied credit flag', f => { f.invoices[1].CreditNote__c = true; }],
  ['hidden deprecated credit', f => { f.invoices.push({ ...copy(f.invoices[1]), Id: key('a0K', 999), Name: '20001T-CN-1', Deprecated__c: true }); }],
];
for (const [name, change] of heldSources) test(`injected loader holds entire Group family for ${name}`, async () => {
  const f = fixture(); change(f); const before = copy(f); const rows = await load(f, harness(f));
  assertHeld(rows); assert.deepEqual(f, before);
});

test('absent credit fields in current metadata are not invented and a recorded direct bank stays unchanged', async () => {
  const f = fixture(); f.invoices.forEach(row => { delete row.Credit_Note__c; });
  f.siblings[1].Bank__c = 'UBS'; f.visible = copy([f.parent, ...f.siblings]); const h = harness(f);
  const context = { ...safety, fields: { ...safety.fields, Invoice__c: ['CurrencyIsoCode'] } };
  const rows = await load(f, h, context);
  assert.equal(rows[1]._groupBankEvidence.bank, 'UBS');
  assert.deepEqual(rows[1]._groupBankEvidence.source.buyerDocumentInventories[0].creditFields, []);
  assert.equal(Object.hasOwn(rows[1]._groupBankEvidence.source.buyerDocumentInventories[0].records[0], 'Credit_Note__c'), false);
  assert.equal(rows[2].Bank__c, 'UBS');
  assert.equal(rows[2]._groupBankEvidence, undefined);
  assert.ok(h.calls.filter(call => call.kind === 'invoices').every(call => !/Credit_Note__c|CreditNote__c/.test(call.soql)));
});

test('legacy same-Account bank and informational header reuse one exact parent/child inventory', async () => {
  const f = fixture();
  for (const row of f.siblings) row.Account__c = f.parent.Account__c;
  for (const row of f.invoices) row.STEM__r.Account__c = f.parent.Account__c;
  f.visible = copy([f.parent, ...f.siblings]); const before = copy(f); const h = harness(f);
  const rows = await load(f, h);
  assert.ok(currentRemittanceSummary(rows[0]));
  for (const row of rows.slice(1)) {
    assert.equal(row.Bank__c, 'UBS');
    assert.equal(row._bankEvidence.source, 'Receivable_Remittance');
    assert.equal(row._groupBankEvidence, undefined);
  }
  assert.deepEqual(f, before, 'legacy enrichment changes returned objects only');
  assert.deepEqual(h.calls.map(call => `${call.channel}:${call.kind}`), ['regular:visible', 'all:parents', 'all:siblings', 'regular:invoices']);
});

const invalidResults = [
  ['missing result', () => null],
  ['error', records => ({ ...complete(records), error: 'unavailable' })],
  ['missing records', () => ({ totalSize: 0 })],
  ['missing total', records => ({ records })],
  ['fractional total', records => ({ records, totalSize: records.length + .5 })],
  ['truncated total', records => ({ records, totalSize: records.length + 1 })],
  ['explicit unfinished', records => ({ ...complete(records), done: false })],
  ['continuation URL', records => ({ ...complete(records), nextRecordsUrl: '/services/data/query/next' })],
];
for (const [name, result] of invalidResults) test(`family inventory rejects ${name} without retaining partial evidence`, async () => {
  const f = fixture(); const calls = [];
  const queryAll = async soql => { calls.push(soql); return /WHERE Id IN/.test(soql) ? complete([f.parent]) : result(f.siblings); };
  const inventory = await loadRemittanceInventory(f.visible, { queryAll, fields: 'Id, Remittance__c, IsDeleted', withCurrency });
  assert.equal(calls.length, 2);
  assert.equal(inventory.complete, false);
  assert.deepEqual(inventory.parents, []); assert.deepEqual(inventory.siblings, []);
});

const badScopes = [
  ['unscoped parent', f => { f.parent.Id = key('a0S', 999); }],
  ['unscoped child parent', f => { f.siblings[1].Remittance__c = key('a0S', 999); }],
  ['invalid child ID', f => { f.siblings[1].Id = 'not-an-id'; }],
  ['canonical duplicate children', f => { f.siblings.push({ ...copy(f.siblings[0]), Id: longId(f.siblings[0].Id) }); }],
  ['nested header as child', f => { f.siblings[1].Id = f.parent.Id; }],
];
for (const [name, change] of badScopes) test(`family inventory rejects ${name}`, async () => {
  const f = fixture(); change(f); const h = harness(f);
  const inventory = await loadRemittanceInventory(f.visible, { queryAll: h.queryAll, fields: 'Id, Remittance__c', withCurrency });
  assert.equal(inventory.complete, false); assert.deepEqual(inventory.parents, []); assert.deepEqual(inventory.siblings, []);
});

test('family inventory normalizes 15/18 identities, batches 50 parents, and discards earlier batches after a later failure', async () => {
  const parents = Array.from({ length: 51 }, (_, n) => ({ Id: key('a0S', n + 1), RecordType: { DeveloperName: 'Receivable_Remittance' } }));
  const visible = [...parents, { ...parents[0], Id: longId(parents[0].Id) }];
  for (const failSecond of [false, true]) {
    const calls = [];
    const queryAll = async soql => {
      calls.push(soql); const ids = [...soql.matchAll(/'([A-Za-z0-9]{15})'/g)].map(match => match[1]);
      assert.ok(ids.length <= 50);
      if (/WHERE Remittance__c IN/.test(soql)) return complete([]);
      const records = parents.filter(row => ids.includes(row.Id)).map(row => ({ ...row, Id: longId(row.Id) }));
      return failSecond && ids.length === 1 ? { records, totalSize: 2 } : complete(records);
    };
    const inventory = await loadRemittanceInventory(visible, { queryAll, fields: 'Id', withCurrency });
    assert.equal(calls.length, 4); assert.equal(inventory.parentIds.length, 51);
    assert.equal(inventory.complete, !failSecond);
    assert.equal(inventory.parents.length, failSecond ? 0 : 51);
  }
});

const badOwnership = [
  ['partial Accounts', ({ kind, records }) => kind === 'accounts' ? { records: records.slice(0, 2), totalSize: 3 } : null],
  ['duplicate canonical Account', ({ kind, records }) => kind === 'accounts' ? complete([records[0], records[1], { ...records[1], Id: longId(records[1].Id) }]) : null],
  ['unscoped Account', ({ kind, records }) => kind === 'accounts' ? complete([records[0], records[1], { ...records[2], Id: key('001', 999) }]) : null],
  ['partial deleted-inclusive invoices', ({ channel, kind, records }) => channel === 'all' && kind === 'invoices' ? { records, totalSize: records.length + 1 } : null],
  ['unfinished invoice query', ({ channel, kind, records }) => channel === 'all' && kind === 'invoices' ? { ...complete(records), done: false } : null],
  ['unscoped invoice STEM', ({ channel, kind, records }) => channel === 'all' && kind === 'invoices' ? complete([records[0], { ...records[1], STEM__c: key('a0H', 999) }]) : null],
  ['duplicate canonical invoice', ({ channel, kind, records }) => channel === 'all' && kind === 'invoices' ? complete([...records, { ...records[0], Id: longId(records[0].Id) }]) : null],
];
for (const [name, transform] of badOwnership) test(`real loader preserves a bank hold after ${name}`, async () => {
  const f = fixture(); const rows = await load(f, harness(f, transform)); assertHeld(rows);
});

test('incomplete shared family inventory does not perform Group Account/invoice reads or a second family fetch', async () => {
  const f = fixture(); const h = harness(f, ({ kind, records }) => kind === 'siblings' ? { ...complete(records), done: false } : null);
  assertHeld(await load(f, h));
  assert.equal(h.calls.filter(call => call.kind === 'parents').length, 1);
  assert.equal(h.calls.filter(call => call.kind === 'siblings').length, 1);
  assert.equal(h.calls.filter(call => call.kind === 'accounts').length, 0);
  assert.equal(h.calls.filter(call => call.channel === 'all' && call.kind === 'invoices').length, 0);
});

test('base payment truncation fails before any enrichment provider reads', async () => {
  for (const result of [
    { records: [], totalSize: 1 }, { records: [], totalSize: 0, done: false },
    { records: [], totalSize: 0, nextRecordsUrl: '/next' }, { records: [] },
  ]) {
    let baseCalls = 0; let enrichmentCalls = 0;
    await assert.rejects(loadSalesforcePayments('2026-01-01', safety, async () => { baseCalls += 1; return result; },
      { queryAll: async () => { enrichmentCalls += 1; throw new Error('must not read'); } }),
    error => error.code === 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE');
    assert.equal(baseCalls, 1); assert.equal(enrichmentCalls, 0);
  }
});

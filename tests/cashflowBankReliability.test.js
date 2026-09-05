import test from 'node:test';
import assert from 'node:assert/strict';
import { isEligibleCashflowBankPayment, loadCashflowRecordedPayments, loadCashflowBankOverview, parseCashflowBankStatementCsv, readCompleteBankRows, saveCashflowBankMatch } from '../api/_cashflowBankReconciliation.js';

const paymentId = 'a0P000000000001AAA';
const stemId = 'a0H000000000001AAA';
const payment = (overrides = {}) => ({ Id: paymentId, Name: 'Payment 1', RecordType: { DeveloperName: 'Receivable' },
  Amount__c: 100, Date__c: '2026-09-02', Bank__c: 'UBS', STEM__c: stemId,
  STEM__r: { Delivery_Date__c: '2026-09-01' }, Is_Deposit__c: false, Is_Volume_Discount__c: false,
  Commission_Invoice__c: null, ...overrides });

test('payment eligibility follows linked STEM cutover including HK Created fallback and exact identity', () => {
  assert.equal(isEligibleCashflowBankPayment(payment()), true);
  for (const overrides of [{ STEM__r: { Delivery_Date__c: '2025-12-31', Expected_Delivery_Date__c: '2026-09-01' } },
    { STEM__r: {} }, { STEM__c: null }, { Is_Deposit__c: true }, { Is_Deposit__c: undefined },
    { Is_Volume_Discount__c: true }, { Commission_Invoice__c: 'invoice' }, { Date__c: '2025-12-31' },
    { Supplier_Invoice__r: { STEM__c: 'a0H000000000002AAA' } }]) {
    assert.equal(isEligibleCashflowBankPayment(payment(overrides)), false, JSON.stringify(overrides));
  }
  assert.equal(isEligibleCashflowBankPayment(payment({ STEM__r: { CreatedDate: '2025-12-31T16:00:00Z' } })), true);
  assert.equal(isEligibleCashflowBankPayment(payment({ STEM__r: { CreatedDate: '2025-12-31T15:59:59Z' } })), false);
  assert.equal(isEligibleCashflowBankPayment(payment({ STEM__c: null, Supplier_Invoice__r: { STEM__c: stemId, STEM__r: { Expected_Delivery_Date__c: '2026-01-01' } } })), true);
});

test('recorded payments enforce relationship reliability in query and recheck returned rows', async () => {
  let sql;
  const result = await loadCashflowRecordedPayments('2025-01-01', '2026-09-30', async (value) => {
    sql = value;
    return { records: [payment(), payment({ STEM__r: { Delivery_Date__c: '2025-12-31' } })], totalSize: 2 };
  });
  assert.equal(result.length, 1);
  assert.match(sql, /STEM__r.Delivery_Date__c >= 2026-01-01/);
  assert.match(sql, /Supplier_Invoice__r.STEM__r.CreatedDate/);
  await assert.rejects(loadCashflowRecordedPayments('2026-01-01', '2026-09-30', async () => ({ records: [], totalSize: 100001 })), { code: 'CASHFLOW_BANK_INCOMPLETE' });
});

test('same-day CSV closing balance uses transaction evidence, never entry-hash order', () => {
  const options = { bankCode: 'UBS', currency: 'USD' };
  const first = '2026-09-01,100,1106,first';
  const last = '2026-09-01,-50,1056,last';
  const parse = (rows) => parseCashflowBankStatementCsv(`Date,Amount,Balance,Reference\n${rows}\n`, options);
  const ascending = parse(`${first}\n${last}`);
  assert.deepEqual(ascending.rows.map((row) => row.reference), ['first', 'last']);
  assert.equal(ascending.summary.closingBalance, 1056);
  assert.equal(parse(`${last}\n${first}`).summary.closingBalance, 1056);
  assert.equal(parse(`${first}\n2026-09-02,-50,,last`).summary.closingBalance, null);
  assert.match(parse(`${first}\n2026-09-02,-50,,last`).summary.closingBalanceWarning, /unavailable/);
});

function fakeClient(tables, { cap = 1000 } = {}) {
  let writes = 0;
  const client = {
    from(table) {
      const filters = [];
      let count = Infinity;
      const builder = {
        select: () => builder, order: () => builder,
        eq: (field, value) => { filters.push((row) => row[field] === value); return builder; },
        in: (field, values) => { filters.push((row) => values.includes(row[field])); return builder; },
        gte: (field, value) => { filters.push((row) => row[field] >= value); return builder; },
        lte: (field, value) => { filters.push((row) => row[field] <= value); return builder; },
        limit: (value) => { count = value; return builder; },
        range: async (from, to) => ({ data: (tables[table] || []).filter((row) => filters.every((filter) => filter(row))).slice(from, Math.min(to + 1, from + cap)) }),
        maybeSingle: async () => ({ data: (tables[table] || []).find((row) => filters.every((filter) => filter(row))) || null }),
        then: (resolve) => Promise.resolve({ data: (tables[table] || []).filter((row) => filters.every((filter) => filter(row))).slice(0, count) }).then(resolve),
      };
      return builder;
    },
    rpc: async () => { writes++; return { data: { id: 'match', match_status: 'confirmed' } }; },
  };
  return { client, writes: () => writes };
}
const account = { id: 'bank', bank_code: 'UBS', currency: 'USD', account_label: 'UBS USD', enabled: true, is_default_operating: true };

test('bank projection includes the full bridge from saved balance while table retains selected range', async () => {
  const { client } = fakeClient({
    cashflow_bank_accounts: [account],
    cashflow_bank_balance_snapshots: [{ id: 'balance', bank_account_id: 'bank', balance_date: '2026-08-01', available_balance: 1000 }],
    cashflow_bank_statement_entries: [
      { id: 'bridge', bank_account_id: 'bank', booking_date: '2026-08-15', amount: 200, currency: 'USD' },
      { id: 'current', bank_account_id: 'bank', booking_date: '2026-09-01', amount: -50, currency: 'USD' },
    ],
    cashflow_bank_planned_movements: [{ id: 'payroll', bank_account_id: 'bank', start_date: '2026-08-20', amount: 30, direction: 'outflow', recurrence: 'one_off', enabled: true }],
  }, { cap: 1 });
  const result = await loadCashflowBankOverview({ client, dateFrom: '2026-09-01', dateTo: '2026-09-30', payments: [] });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, 'current');
  assert.equal(result.statementEvidenceFrom, '2026-08-01');
  assert.equal(result.projections[0].projection.actualMovement, 150);
  assert.equal(result.projections[0].projection.plannedMovement, 0);
  assert.equal(result.projections[0].projection.projectedAvailableLiquidity, 1150);
});

test('bounded pagination detects server page caps and refuses partial totals at the ceiling', async () => {
  const { client } = fakeClient({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }, { cap: 1 });
  const make = () => client.from('rows').select('*').order('id');
  assert.equal((await readCompleteBankRows(make)).data.length, 3);
  await assert.rejects(readCompleteBankRows(make, { maximumRows: 2 }), { code: 'CASHFLOW_BANK_INCOMPLETE' });
});

test('confirmed bank matches cannot bypass live eligibility checks with an exact Payment id', async () => {
  for (const overrides of [{ STEM__r: { Delivery_Date__c: '2025-12-31' } }, { Is_Deposit__c: true }, { Commission_Invoice__c: 'commission' }, { Is_Volume_Discount__c: true }]) {
    const h = fakeClient({ cashflow_bank_accounts: [account], cashflow_bank_statement_entries: [{ id: 'entry', bank_account_id: 'bank', booking_date: '2026-09-02', amount: 100, currency: 'USD' }] });
    await assert.rejects(saveCashflowBankMatch({ statementEntryId: 'entry', salesforcePaymentId: paymentId }, { client: h.client, profile: {}, querySalesforce: async () => ({ records: [payment(overrides)] }) }), { code: 'CASHFLOW_BANK_PAYMENT_INELIGIBLE' });
    assert.equal(h.writes(), 0);
  }
});

test('an eligible exact match still saves once and wrong-currency evidence never saves', async () => {
  for (const currency of ['USD', 'HKD']) {
    const h = fakeClient({ cashflow_bank_accounts: [account], cashflow_bank_statement_entries: [{ id: 'entry', bank_account_id: 'bank', booking_date: '2026-09-02', amount: 100, currency }] });
    const operation = saveCashflowBankMatch({ statementEntryId: 'entry', salesforcePaymentId: paymentId }, { client: h.client, profile: {}, querySalesforce: async () => ({ records: [payment()] }) });
    if (currency === 'USD') { await operation; assert.equal(h.writes(), 1); }
    else { await assert.rejects(operation, { code: 'CASHFLOW_BANK_PAYMENT_MISMATCH' }); assert.equal(h.writes(), 0); }
  }
});

test('unrelated historical matches do not block a narrow account view and balances remain account-specific', async () => {
  const { client } = fakeClient({
    cashflow_bank_accounts: [account, { ...account, id: 'second', is_default_operating: false }],
    cashflow_bank_balance_snapshots: [
      { id: 'first-balance', bank_account_id: 'bank', balance_date: '2026-08-01', available_balance: 1000 },
      { id: 'second-balance', bank_account_id: 'second', balance_date: '2026-09-01', available_balance: 500 },
    ],
    cashflow_bank_statement_entries: [
      { id: 'old', bank_account_id: 'bank', booking_date: '2026-08-15', amount: 100, currency: 'USD' },
      { id: 'second-old', bank_account_id: 'second', booking_date: '2026-08-15', amount: 999, currency: 'USD' },
      { id: 'visible', bank_account_id: 'second', booking_date: '2026-09-02', amount: 50, currency: 'USD' },
    ],
    cashflow_bank_matches: Array.from({ length: 20001 }, (_, i) => ({ id: `match-${i}`, statement_entry_id: `unrelated-${i}` })),
  });
  const result = await loadCashflowBankOverview({ client, dateFrom: '2026-09-01', dateTo: '2026-09-30', payments: [] });
  assert.equal(result.projections.find((row) => row.account.id === 'bank').projection.projectedAvailableLiquidity, 1100);
  assert.equal(result.projections.find((row) => row.account.id === 'second').projection.projectedAvailableLiquidity, 550);
  assert.equal(result.entries.length, 1);
});

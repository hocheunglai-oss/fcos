import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStemFinance, createDashboardFinanceLoader, financeDate, financeToday, summarizeDashboardFinance, validateFinanceSnapshot } from '../api/_dashboardFinance.js';
import { createFinanceSettingsHandlers, validateAnnualInterestRate } from '../api/_dashboardFinanceSettings.js';

const settings = { annualInterestRatePct: 5, revision: 1 };
const buyer = '001000000000001'; const supplier = '001000000000002';
const stemId = 'a01000000000001'; const invoiceId = 'a02000000000001';
const stem = { id: stemId, currency: 'USD', netPnl: 10000, buyer: 110000, buyerAccountId: buyer, receivableBalance: 110000, deliveryDate: '2026-01-01' };
let sequence = 0;
const payment = (type, amount, date, patch = {}) => ({ id: `payment${++sequence}`, type, amount, date, stemId, currency: 'USD', accountId: type === 'Payable' ? supplier : buyer, ...patch });
const run = (payments, extra = {}, asOfDate = '2026-01-21', annualInterestRatePct = 5) => calculateStemFinance({ stem, payments, supplierAccountIds: [supplier], ...extra }, { annualInterestRatePct, asOfDate });

test('finance uses actual changing cash balances: agreed 219.18 example and settled cutoff', () => {
  const result = run([payment('Payable', 100000, '2026-01-01'), payment('Receivable', 40000, '2026-01-11'), payment('Receivable', 70000, '2026-01-21')], {
    stem: { ...stem, receivableBalance: 0 }, finalBuyerInvoiceIssued: true,
  }, '2026-06-01');
  assert.equal(result.financeCost, 219.18); assert.equal(result.ebit, 9780.82);
  assert.equal(result.status, 'settled'); assert.equal(result.throughDate, '2026-01-21');
});

test('finance retains advance receipts, offsets same-day events and never credits negative funding', () => {
  assert.equal(run([payment('Receivable', 110000, '2026-01-01'), payment('Payable', 100000, '2026-01-11')]).financeCost, 0);
  assert.equal(run([payment('Payable', 100000, '2026-01-01'), payment('Receivable', 110000, '2026-01-01')]).financeCost, 0);
  assert.equal(run([payment('Receivable', 50000, '2026-01-01'), payment('Payable', 100000, '2026-01-11')]).financeCost, 68.49);
});

test('finance accrues unpaid balances to the as-of date with Actual/365, including leap days', () => {
  const result = run([payment('Payable', 100000, '2026-01-01')], {}, '2026-01-31');
  assert.equal(result.financeCost, 410.96); assert.equal(result.accruing, true);
  assert.equal(run([payment('Payable', 36500, '2028-02-28')], { stem: { ...stem, deliveryDate: '2028-02-28' } }, '2028-03-01').financeCost, 10);
  assert.equal(run([payment('Payable', 100000, '2026-01-01')], {}, '2026-01-31', 0).financeCost, 0);
  assert.equal(run([payment('Payable', 100000, '2026-01-01')], {}, '2026-01-31', 10).financeCost, 821.92);
});

test('signed actual refunds change funding; remittances, noncash discounts and charges do not', () => {
  const payable = payment('Payable', 100000, '2026-01-01', { supplierInvoiceId: invoiceId });
  const result = run([payable, { ...payable }, payment('Payable', -50000, '2026-01-11', { supplierInvoiceId: invoiceId }),
    payment('Payable', 1000, '2026-01-12', { supplierInvoiceId: invoiceId, volumeDiscountId: 'discount1' }),
    payment('Payable_Remittance', 1000000, '2026-01-01'), payment('Receivable_Remittance', 1000000, '2026-01-01'),
    payment('Bank_Charge', 20, '2026-01-01'), payment('Write_Off', 10, '2026-01-01'), payment('Commission', 50, '2026-01-01')], {
    supplierInvoices: [{ id: invoiceId, stemId, supplierId: supplier, amount: 51000, balance: 0, currency: 'USD' }],
  });
  assert.equal(result.financeCost, 205.48); assert.equal(result.complete, true);
  const refund = run([payment('Payable', 100000, '2026-01-01'), payment('Receivable', 100000, '2026-01-01'), payment('Receivable', -50000, '2026-01-11')]);
  assert.equal(refund.financeCost, 68.49);
});

test('closed loss-making STEM stops at actual final receipt and does not finance the loss forever', () => {
  const result = run([payment('Payable', 100000, '2026-01-01'), payment('Receivable', 80000, '2026-01-11'), payment('Payable', 1000, '2026-02-01')], {
    stem: { ...stem, buyer: 80000, netPnl: -21000, receivableBalance: 0 }, finalBuyerInvoiceIssued: true,
  }, '2026-12-31');
  assert.equal(result.financeCost, 136.99); assert.equal(result.ebit, -21136.99); assert.equal(result.accruing, false);
});

test('signed reversals remain cash, while ambiguous reversed originals are unavailable', () => {
  const result = run([payment('Payable', 100000, '2026-01-01'), payment('Payable', -100000, '2026-01-11', { status: 'Reversed' })]);
  assert.equal(result.financeCost, 136.99); assert.equal(result.fundedBalance, 0);
  assert.equal(run([payment('Payable', 100000, '2026-01-01', { status: 'Reversed' })]).complete, false);
});

test('discount boolean, commission linkage and remittance provenance exclude noncash allocations', () => {
  const result = run([payment('Payable', 100000, '2026-01-01', { supplierInvoiceId: invoiceId }),
    payment('Payable', 1000, '2026-01-01', { supplierInvoiceId: invoiceId, isVolumeDiscount: true }),
    payment('Payable', 10000, '2026-01-01', { commissionInvoiceId: 'commission' }),
    payment('Payable', 100000, '2026-01-01', { isRemittance: true })], {
    supplierInvoices: [{ id: invoiceId, stemId, supplierId: supplier, amount: 101000, balance: 0, currency: 'USD' }],
  });
  assert.equal(result.complete, true); assert.equal(result.financeCost, 273.97);
});

test('a real prepayment keeps its original date and cash identity after invoice linking', () => {
  const prepayment = payment('Payable', 100000, '2026-01-01');
  const before = run([prepayment]);
  const linked = { ...prepayment, supplierInvoiceId: invoiceId };
  const after = run([linked, { ...linked }], {
    supplierInvoices: [{ id: invoiceId, stemId, supplierId: supplier, amount: 100000, balance: 0, currency: 'USD' }],
  });
  assert.equal(before.financeCost, 273.97); assert.equal(after.financeCost, before.financeCost);
  assert.equal(run([{ ...linked, isDeposit: true }]).complete, false);
  const synthetic = run([{ ...linked, isDeposit: true }], {
    supplierInvoices: [{ id: invoiceId, stemId, supplierId: supplier, amount: 100000, balance: 0, currency: 'USD' }],
  });
  assert.equal(synthetic.complete, false); assert.match(synthetic.issues.join(' '), /original cash funding/);
});

test('unresolved settlement and pre-cutover cash evidence cannot produce a complete EBIT', () => {
  const payments = [payment('Payable', 100000, '2026-01-01'), payment('Receivable', 110000, '2026-01-11')];
  assert.equal(run(payments, { stem: { ...stem, receivableBalance: 0 } }).complete, false);
  assert.equal(run([payment('Payable', 100000, '2025-12-31')]).complete, false);
  const refundAfterFinalReceipt = run([...payments, payment('Receivable', -1000, '2026-01-12'), payment('Write_Off', 1000, '2026-01-12')], {
    stem: { ...stem, receivableBalance: 0 }, finalBuyerInvoiceIssued: true,
  });
  assert.equal(refundAfterFinalReceipt.complete, false);
});

test('bank charges reconcile final settlement but never become buyer cash receipts', () => {
  const result = run([payment('Payable', 100000, '2026-01-01'), payment('Receivable', 109980, '2026-01-11'), payment('Bank_Charge', 20, '2026-01-11'), payment('Receivable', 0, '2026-01-12')], {
    stem: { ...stem, receivableBalance: 0 }, finalBuyerInvoiceIssued: true,
  });
  assert.equal(result.financeCost, 136.99); assert.equal(result.buyerCashReceived, 109980); assert.equal(result.status, 'settled');
});

test('multiple supplier payments and invoice links are reconciled without counting duplicated allocations', () => {
  const first = payment('Payable', 60000, '2026-01-01', { supplierInvoiceId: invoiceId });
  const second = payment('Payable', 40000, '2026-01-11', { supplierInvoiceId: 'a02000000000002', accountId: '001000000000003' });
  const result = run([first, second, { ...first }], { supplierInvoices: [
    { id: invoiceId, stemId, supplierId: supplier, amount: 60000, balance: 0, currency: 'USD' },
    { id: 'a02000000000002', stemId, supplierId: '001000000000003', amount: 40000, balance: 0, currency: 'USD' },
  ] });
  assert.equal(result.financeCost, 219.18);
  const conflict = run([first, { ...first, amount: 100 }]); assert.equal(conflict.complete, false);
});

test('missing, conflicting, cross-currency or legacy evidence withholds amounts rather than assuming zero', () => {
  const paid = payment('Payable', 100000, '2026-01-01');
  for (const result of [
    run([paid], { stem: { ...stem, deliveryDate: '2025-12-31' } }),
    run([paid], { sourceComplete: false }),
    run([{ ...paid, date: null }]), run([{ ...paid, date: '2026-02-30' }]), run([{ ...paid, date: '2027-01-01' }]),
    run([{ ...paid, currency: 'EUR' }]), run([{ ...paid, accountId: 'unknown' }]),
    run([{ ...paid, stemId: 'other' }]), run([{ ...paid, supplierInvoiceId: 'missing' }]),
    run([paid], { stem: { ...stem, netPnl: null } }),
    run([payment('Receivable', 100000, '2026-01-01')], { stem: { ...stem, receivableBalance: 0 }, finalBuyerInvoiceIssued: true }),
    run([paid], { stem: { ...stem, buyer: 100000, receivableBalance: 0 }, finalBuyerInvoiceIssued: true }),
    run([paid], { supplierInvoices: [{ id: invoiceId, stemId, supplierId: supplier, amount: 100000, balance: 0, currency: 'USD' }] }),
  ]) { assert.equal(result.complete, false); assert.equal(result.ebit, null); assert.equal(result.financeCost, null); assert.ok(result.issues.length); }
});

test('unpaid invoices without any actual supplier cash have zero finance cost; a cent owed remains open', () => {
  assert.equal(run([], { supplierInvoices: [{ id: invoiceId, stemId, supplierId: supplier, amount: 100000, balance: 100000, currency: 'USD' }] }).financeCost, 0);
  const result = run([payment('Payable', 100000, '2026-01-01'), payment('Receivable', 79999.99, '2026-01-11')], {
    stem: { ...stem, buyer: 80000, netPnl: -20000, receivableBalance: 0.01 }, finalBuyerInvoiceIssued: true,
  });
  assert.equal(result.accruing, true);
});

test('currency completeness is independent and aggregate cannot expose a covered subtotal as full EBIT', () => {
  const valid = run([payment('Payable', 100000, '2026-01-01')]);
  const summary = summarizeDashboardFinance([{ ...stem, finance: valid }, { ...stem, finance: { complete: false } }, { currency: 'EUR', finance: { ...valid, financeCost: 10, ebit: 90 } }], settings, '2026-01-21');
  assert.equal(summary.complete, false);
  assert.equal(summary.byCurrency.find((row) => row.currency === 'USD').ebit, null);
  assert.equal(summary.byCurrency.find((row) => row.currency === 'USD').missingEvidenceCount, 1);
  assert.equal(summary.byCurrency.find((row) => row.currency === 'EUR').ebit, 90);
  assert.equal(summarizeDashboardFinance([{ ...stem, finance: valid }], settings, '2026-01-21', { complete: false }).byCurrency[0].ebit, null);
});

test('Hong Kong calendar and rate revision lock a multi-page finance export', () => {
  assert.equal(financeToday(new Date('2026-01-01T16:01:00Z')), '2026-01-02');
  assert.equal(financeDate('2026-02-30'), null);
  validateFinanceSnapshot({ revision: 1, asOfDate: '2026-01-01' }, settings, '2026-01-01');
  for (const snapshot of [{ revision: 2, asOfDate: '2026-01-01' }, { revision: 1, asOfDate: '2026-01-02' }, {}]) {
    assert.throws(() => validateFinanceSnapshot(snapshot, settings, '2026-01-01'), { code: 'DASHBOARD_FINANCE_SNAPSHOT_CHANGED', status: 409 });
  }
});

function loaderFixture({ broken = false, directStem = true } = {}) {
  const schemas = {
    Payment__c: ['Id', 'STEM__c', 'Account__c', 'RecordTypeId', 'Amount__c', 'Date__c', 'Supplier_Invoice__c', 'Volume_Discount__c', 'Is_Volume_Discount__c', 'Is_Deposit__c', 'Commission_Invoice__c', 'Remittance__c'],
    Supplier_Invoice__c: ['Id', 'STEM__c', 'Supplier__c', 'Invoice_Amount__c', 'Payable_Balance__c'],
    STEM__c: ['Id', 'Account__c', 'QLIK_Receivable_Balance__c'],
    Invoice__c: ['Id', 'Name', 'STEM__c', 'Proforma__c', 'Deprecated__c'],
    STEM_Line_Item__c: ['Id', 'STEM__c', 'Original_Supplier__c', 'Supplier_Invoice__c', 'Cancelled__c'],
    STEM_Extra_Cost__c: ['Id', 'STEM__c', 'Supplier__c', 'Supplier_Invoice__c', 'Cancelled__c'],
  };
  const queries = [];
  const loader = createDashboardFinanceLoader({
    describeObject: async (name) => ({ fields: schemas[name].map((field) => ({ name: field })) }),
    queryAll: async (query) => {
      queries.push(query); if (broken) throw new Error('source down');
      const object = query.match(/ FROM (\w+) /)[1];
      if (object === 'STEM__c') return [{ Id: stemId, Account__c: buyer, QLIK_Receivable_Balance__c: 110000 }];
      if (object === 'Supplier_Invoice__c') return [{ Id: invoiceId, STEM__c: stemId, Supplier__c: supplier, Invoice_Amount__c: 100000, Payable_Balance__c: 0 }];
      if (object === 'Payment__c') {
        if (!directStem && query.includes('WHERE STEM__c')) return [];
        return [{ Id: 'a03000000000001', STEM__c: directStem ? stemId : null, Account__c: supplier, Supplier_Invoice__c: invoiceId, Amount__c: 100000, Date__c: '2026-01-01', RecordType: { DeveloperName: 'Payable' } }];
      }
      return [];
    },
  });
  return { loader, queries };
}

test('finance loader follows supplier invoice links, deduplicates reads and does not clip payment history to delivery scope', async () => {
  for (const directStem of [true, false]) {
    const { loader, queries } = loaderFixture({ directStem });
    const [row] = await loader([stem], settings, '2026-01-31');
    assert.equal(row.finance.financeCost, 410.96); assert.equal(row.netPnl, 10000);
    assert.ok(queries.some((query) => query.includes('FROM Payment__c WHERE Supplier_Invoice__c IN')));
    assert.ok(queries.every((query) => !/Date__c\s*[<>]|LIMIT|INSERT|UPDATE|DELETE/.test(query)));
  }
});

test('finance source failures retain the STEM and withhold its finance result', async () => {
  const { loader } = loaderFixture({ broken: true });
  const [row] = await loader([stem], settings, '2026-01-31');
  assert.equal(row.id, stem.id); assert.equal(row.netPnl, stem.netPnl); assert.equal(row.finance.complete, false);
});

test('financing rate validation rejects blanks, coerced booleans, out-of-range and excess precision', () => {
  for (const rate of [0, 5, '5.00', '100.00', 12.34]) assert.equal(validateAnnualInterestRate(rate), Number(rate));
  for (const rate of ['', ' ', null, true, {}, -1, 100.01, '5.001', '1e1', NaN, Infinity]) assert.throws(() => validateAnnualInterestRate(rate));
});

test('finance settings enforces permissions before reads/writes, actor ownership, stale revisions and invalidation', async () => {
  const calls = []; const row = { annual_interest_rate_pct: 5, revision: 1, updated_at: '2026-01-01' };
  const client = {
    from: () => { calls.push('read'); return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row }; } }; },
    rpc: async (name, args) => { calls.push({ name, args }); return args.p_expected_revision === row.revision ? { data: [{ ...row, annual_interest_rate_pct: args.p_annual_interest_rate_pct, revision: 2 }] } : { error: { code: '40001' } }; },
  };
  const profile = { id: 'actor' }; let manage = false; let dashboard = false;
  const handlers = createFinanceSettingsHandlers({ requireActiveUser: async () => ({ client, profile }), userHasCapability: async () => manage,
    userHasAnyModuleAccess: async () => dashboard, expireCache: async (tags) => calls.push({ tags }) });
  await assert.rejects(handlers.financeSettingsGet(), { status: 403 }); assert.equal(calls.length, 0);
  dashboard = true; assert.equal((await handlers.financeSettingsGet()).settings.annualInterestRatePct, 5);
  await assert.rejects(handlers.financeSettingsSave({ annualInterestRatePct: 7, expectedRevision: 1 }), { status: 403 });
  manage = true;
  await assert.rejects(handlers.financeSettingsSave({ annualInterestRatePct: 7, expectedRevision: 9 }), { code: 'FINANCE_SETTINGS_REVISION_CONFLICT', status: 409 });
  const saved = await handlers.financeSettingsSave({ annualInterestRatePct: 7, expectedRevision: 1, actorId: 'spoofed' });
  assert.equal(saved.settings.annualInterestRatePct, 7);
  assert.equal(calls.find((call) => call.args?.p_expected_revision === 1).args.p_actor_user_id, 'actor');
  assert.ok(calls.some((call) => call.tags?.includes('salesforce:dashboard')));
});

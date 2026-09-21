import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateRemittanceCharge, calculateReceiptBankCharge, calculateStemBankCharge, deductBankCharge } from '../api/_dashboardBankCharges.js';
import { calculateStemFinance, createDashboardFinanceLoader, summarizeDashboardFinance } from '../api/_dashboardFinance.js';
const bankChargesUsd = { UBS: 10, DBS: 15 };
const settings = { annualInterestRatePct: 5, bankChargesUsd, revision: 2 };
const asOfDate = '2026-09-21';
const parent = { id: 'a03000000000999', type: 'Payable_Remittance', date: '2026-01-01', amount: 100000, bank: 'UBS', currency: 'USD' };
const p = (id, amount, patch = {}) => ({ id, type: 'Payable', amount, date: '2026-01-01', currency: 'USD', bank: 'UBS', remittanceId: parent.id, ...patch });
const allocations = [p('a03000000000001', 60000), p('a03000000000002', 30000), p('a03000000000003', 10000)];
const allocate = (header = parent, children = allocations, fees = bankChargesUsd) => allocateRemittanceCharge(header, children, fees, asOfDate);
const calc = (payments, groups = new Map(), patch = {}) => calculateStemBankCharge({ payments, groups }, { bankChargesUsd, asOfDate, currency: 'USD', ...patch });

test('one bank charge spans all remittance allocations, independent of selected STEM/page/order', () => {
  const group = allocate(); const groups = new Map([[parent.id, group]]);
  assert.deepEqual([...group.allocations.values()], [600n, 300n, 100n]);
  assert.equal(calc([allocations[0]], groups).bankCharge, 6);
  assert.equal(calc([allocations[1]], groups).bankCharge, 3);
  assert.equal(calc([allocations[0], allocations[2], allocations[0]], groups).bankCharge, 7);
  assert.equal(calc(allocations, groups).bankChargeTransferCount, 1);
  assert.equal(calc(allocations, groups).bankCharge, 10);
  assert.deepEqual(allocate(parent, [...allocations].reverse()), group);
});

test('largest-remainder cents sum exactly to the fee, with deterministic allocation-ID ties', () => {
  const children = allocations.map((row) => ({ ...row, amount: 1 }));
  const group = allocate({ ...parent, amount: 3 }, children);
  assert.deepEqual([...group.allocations], [['a03000000000001', 334n], ['a03000000000002', 333n], ['a03000000000003', 333n]]);
  const tiny = allocate({ ...parent, amount: 3 }, children, { UBS: 0.01, DBS: 15 });
  assert.deepEqual([...tiny.allocations.values()], [1n, 0n, 0n]);
});

test('standalone actual payments incur configured UBS/DBS fees, deduplicate invoice reads and preserve prepayment identity', () => {
  const ubs = p('a03000000000001', 100, { remittanceId: null, date: '2025-12-20' });
  const dbs = p('a03000000000002', 100, { remittanceId: null, bank: 'DBS' });
  const result = calc([ubs, dbs, { ...ubs }]);
  assert.equal(result.bankCharge, 25); assert.equal(result.bankChargeTransferCount, 2);
  assert.equal(calc([{ ...ubs, supplierInvoiceId: 'invoice' }]).bankCharge, 10);
  assert.equal(calc([ubs], new Map(), { bankChargesUsd: { UBS: 12.25, DBS: 15 } }).bankCharge, 12.25);
});

test('refunds, noncash adjustments, cancelled payments and headers never create another outgoing charge', () => {
  const cash = p('a03000000000001', 100, { remittanceId: null });
  const others = [p('refund', -100, { status: 'Reversed' }), p('discount', 100, { isVolumeDiscount: true }),
    p('commission', 100, { commissionInvoiceId: 'commission' }), p('void', 100, { status: 'Void' }),
    p('writeoff', 100, { type: 'Write_Off' }), parent];
  assert.equal(calc([cash, ...others]).bankCharge, 10);
  assert.equal(calc(others).bankCharge, 0);
  assert.equal(calc([]).bankCharge, 0);
  assert.equal(calc([p('deposit', 100, { isDeposit: true })]).bankCharge, null);
});

test('unknown bank, malformed cash, unproven reversal and absent remittance are unavailable, never zero', () => {
  const cash = p('a03000000000001', 100, { remittanceId: null });
  for (const patch of [{ bank: null }, { bank: 'OTHER' }, { bank: 'toString' }, { date: '2026-02-30' },
    { date: '2027-01-01' }, { amount: null }, { status: 'Reversed' }, { remittanceId: parent.id }]) {
    const result = calc([{ ...cash, ...patch }]); assert.equal(result.bankChargeComplete, false); assert.equal(result.bankCharge, null);
  }
  assert.equal(calc([cash, { ...cash, amount: 200 }]).bankChargeComplete, false);
});

test('shared wires require reconciled full transfer evidence and consistent banks/currencies', () => {
  for (const header of [null, { ...parent, bank: null }, { ...parent, amount: 100001 }, { ...parent, date: null }, { ...parent, type: 'Receivable_Remittance' }]) {
    assert.equal(allocate(header).complete, false);
  }
  for (const patch of [{ bank: 'DBS' }, { currency: 'EUR' }, { amount: -1 }, { type: 'Unknown' }, { remittanceId: 'another' }]) {
    assert.equal(allocate(parent, [{ ...allocations[0], ...patch }, ...allocations.slice(1)]).complete, false);
  }
  assert.equal(allocate(parent, allocations.slice(1)).complete, false);
  assert.equal(allocate(parent, [...allocations, allocations[0]]).complete, true);
});

test('USD fees stay separate from other currencies without an invented FX conversion', () => {
  const cash = p('a03000000000001', 100, { remittanceId: null });
  const eur = calc([cash], new Map(), { currency: 'EUR' });
  assert.equal(eur.bankChargeUsd, 10); assert.equal(eur.bankCharge, null); assert.equal(eur.bankChargeComplete, false);
  assert.equal(calc([cash], new Map(), { currency: 'EUR', bankChargesUsd: { UBS: 0, DBS: 0 } }).bankCharge, 0);
});

test('EBIT deducts interest and bank charge once; known interest survives missing bank evidence', () => {
  const interest = { complete: true, financeCost: 219.18, ebit: 9780.82, issues: [], status: 'settled' };
  const known = deductBankCharge(interest, calc([p('cash', 100, { remittanceId: null })]));
  assert.equal(known.ebit, 9770.82); assert.equal(known.financeCost, 219.18); assert.equal(known.bankCharge, 10);
  const missing = deductBankCharge(interest, calc([p('cash', 100, { bank: null, remittanceId: null })]));
  assert.equal(missing.financeCost, 219.18); assert.equal(missing.ebit, null); assert.equal(missing.complete, false);
  const summary = summarizeDashboardFinance([{ currency: 'USD', netPnl: 10000, finance: known }, { currency: 'USD', netPnl: 10000, finance: missing }], settings, asOfDate);
  assert.equal(summary.byCurrency[0].verifiedEbit, 9770.82); assert.equal(summary.byCurrency[0].verifiedBankCharge, 10);
  assert.equal(summary.byCurrency[0].bankCharge, null); assert.deepEqual(summary.bankChargesUsd, bankChargesUsd);
});

function loaderFixture({ brokenGroups = false, receiptFee = false } = {}) {
  const fields = ['Id', 'STEM__c', 'Account__c', 'RecordTypeId', 'Amount__c', 'Date__c', 'Supplier_Invoice__c', 'Is_Volume_Discount__c', 'Is_Deposit__c', 'Commission_Invoice__c', 'Remittance__c', 'Bank__c',
    'Supplier__c', 'Invoice_Amount__c', 'Payable_Balance__c', 'QLIK_Receivable_Balance__c', 'Proforma__c', 'Deprecated__c', 'Original_Supplier__c', 'Cancelled__c'];
  const stem = { id: 'a01000000000001', currency: 'USD', netPnl: 10000, buyer: 110000, deliveryDate: '2026-01-01', deliveryDateSource: 'delivery' };
  const raw = (row) => ({ Id: row.id, STEM__c: stem.id, Account__c: '001000000000002', Amount__c: row.amount, Date__c: row.date, Bank__c: row.bank, Remittance__c: row.remittanceId, RecordType: { DeveloperName: row.type } });
  const queries = [];
  const loader = createDashboardFinanceLoader({ describeObject: async () => ({ fields: fields.map((name) => ({ name })) }), queryAll: async (query) => {
    queries.push(query);
    if (query.includes('FROM STEM__c')) return [{ Id: stem.id, Account__c: '001000000000001', QLIK_Receivable_Balance__c: 110000 }];
    if (query.includes('FROM STEM_Line_Item__c')) return [{ Id: 'line', STEM__c: stem.id, Original_Supplier__c: '001000000000002' }];
    if (!query.includes('FROM Payment__c')) return [];
    if (query.includes('WHERE Remittance__c')) { if (brokenGroups) throw new Error('unavailable'); return allocations.map(raw); }
    if (query.includes('WHERE Id')) return [raw(parent)];
    return [raw(allocations[0]), ...(receiptFee ? [{ ...raw(p('buyerfee', 25, { type: 'Bank_Charge', bank: null, remittanceId: null })), Account__c: '001000000000001' }] : [])];
  } });
  return { loader, stem, queries };
}

test('loader fetches full wire across out-of-scope allocations and still returns one selected STEM', async () => {
  const { loader, stem, queries } = loaderFixture();
  const rows = await loader([stem], settings, asOfDate);
  assert.equal(rows.length, 1); assert.equal(rows[0].finance.bankCharge, 6); assert.equal(rows[0].finance.complete, true);
  assert.equal(rows[0].finance.ebit, Math.round((10000 - rows[0].finance.financeCost - 6) * 100) / 100);
  assert.ok(queries.some((query) => query.includes('WHERE Remittance__c IN')));
  assert.ok(queries.every((query) => !/Date__c\s*[<>]|LIMIT|INSERT|UPDATE|DELETE/.test(query)));
});

test('remittance query failure preserves known interest while withholding affected EBIT', async () => {
  const { loader, stem } = loaderFixture({ brokenGroups: true });
  const [row] = await loader([stem], settings, asOfDate);
  assert.equal(typeof row.finance.financeCost, 'number'); assert.equal(row.finance.bankCharge, null); assert.equal(row.finance.ebit, null);
});

test('signed credits within a remittance reconcile its net value without another outgoing charge', () => {
  const children = [p('a03000000000001', 60000), p('a03000000000002', 40000), p('a03000000000003', -1000)];
  const group = allocate({ ...parent, amount: 99000 }, children);
  assert.equal(group.complete, true);
  const groups = new Map([[parent.id, group]]);
  assert.equal(calc(children, groups).bankCharge, 10);
  assert.equal(calc([children[0]], groups).bankCharge, 6);
  assert.equal(calc([children[2]], groups).bankCharge, 0);
});

const receiptSource = { stemId: 'a01000000000001', buyerAccountId: '001000000000001' };
const receiptContext = { asOfDate, currency: 'USD' };
const fee = (id, amount, patch = {}) => ({ id, amount, type: 'Bank_Charge', date: '2026-01-11',
  stemId: receiptSource.stemId, accountId: receiptSource.buyerAccountId, currency: 'USD', ...patch });
const receiptCalc = (payments, source = {}, context = {}) => calculateReceiptBankCharge({ ...receiptSource, payments, ...source }, { ...receiptContext, ...context });

test('receipt charges use recorded signed amounts once, without requiring a bank or applying defaults', () => {
  const charge = fee('fee1', 25);
  const result = receiptCalc([charge, { ...charge }, fee('refund', -5, { status: 'Reversed' }), fee('second', 18, { date: '2025-12-20' }),
    fee('void', 99, { status: 'Void' }), fee('writeoff', 99, { type: 'Write_Off' }), fee('receipt', 1000, { type: 'Receivable' })]);
  assert.equal(result.receiptBankCharge, 38); assert.equal(result.receiptBankChargeCount, 3); assert.equal(result.complete, true);
  assert.equal(receiptCalc([]).receiptBankCharge, 0);
  assert.equal(receiptCalc([fee('refund', -25)]).receiptBankCharge, -25);
});

test('receipt charges reject incomplete, conflicting, cross-buyer or cross-currency evidence', () => {
  const charge = fee('fee1', 25);
  for (const patch of [{ id: '' }, { stemId: 'other' }, { stemId: null }, { accountId: 'other' }, { supplierInvoiceId: 'invoice' },
    { currency: 'EUR' }, { amount: null }, { amount: true }, { date: '2026-02-30' }, { date: '2027-01-01' }, { status: 'Reversed' },
    { isDeposit: true }, { isVolumeDiscount: true }, { commissionInvoiceId: 'commission' }, { isRemittance: true }]) {
    const result = receiptCalc([{ ...charge, ...patch }]);
    assert.equal(result.complete, false, JSON.stringify(patch)); assert.equal(result.receiptBankCharge, null);
  }
  assert.equal(receiptCalc([charge, { ...charge, amount: 30 }]).complete, false);
  assert.equal(receiptCalc([], { sourceComplete: false }).receiptBankCharge, null);
  assert.equal(receiptCalc([charge], { buyerAccountId: null }).complete, false);
});

test('combined bank charge preserves currencies and never invents receipt FX', () => {
  const source = { ...receiptSource, payments: [fee('fee1', 25, { currency: 'EUR' })], groups: new Map() };
  const context = { bankChargesUsd, asOfDate, currency: 'EUR' };
  const receiptOnly = calculateStemBankCharge(source, context);
  assert.equal(receiptOnly.bankCharge, 25); assert.equal(receiptOnly.bankChargeUsd, null); assert.equal(receiptOnly.supplierBankChargeUsd, 0);
  const both = calculateStemBankCharge({ ...source, payments: [...source.payments, p('supplier', 100, { remittanceId: null, currency: 'EUR' })] }, context);
  assert.equal(both.bankCharge, null); assert.equal(both.receiptBankCharge, 25); assert.equal(both.supplierBankChargeUsd, 10);
  assert.equal(both.bankChargeUsd, null); assert.equal(both.bankChargeComplete, false);
});

test('EBIT deducts recorded receipt fees and supplier fees once without reducing actual buyer cash twice', () => {
  const stem = { id: receiptSource.stemId, buyerAccountId: receiptSource.buyerAccountId, buyer: 110000, receivableBalance: 0,
    netPnl: 10000, currency: 'USD', deliveryDate: '2026-01-01', deliveryDateSource: 'delivery' };
  const payments = [p('supplier', 100000, { remittanceId: null, stemId: stem.id, accountId: 'supplier' }),
    fee('receipt', 109975, { type: 'Receivable' }), fee('fee1', 25)];
  const interest = calculateStemFinance({ stem, payments, supplierAccountIds: ['supplier'], finalBuyerInvoiceIssued: true }, settingsWithDate());
  const bank = calculateStemBankCharge({ ...receiptSource, payments, groups: new Map() }, { bankChargesUsd, ...receiptContext });
  const result = deductBankCharge(interest, bank);
  assert.equal(result.complete, true); assert.equal(result.buyerCashReceived, 109975); assert.equal(result.financeCost, 136.99);
  assert.equal(result.supplierBankChargeUsd, 10); assert.equal(result.receiptBankCharge, 25); assert.equal(result.bankCharge, 35);
  assert.equal(result.bankChargeUsd, 35); assert.equal(result.ebit, 9828.01);
  const summary = summarizeDashboardFinance([{ currency: 'USD', netPnl: 10000, finance: result }], settings, asOfDate);
  assert.equal(summary.byCurrency[0].bankCharge, 35); assert.equal(summary.byCurrency[0].ebit, 9828.01);
});
function settingsWithDate() { return { annualInterestRatePct: 5, asOfDate }; }

test('loader validates receipt charge ownership and includes it in the shared supplier fee total', async () => {
  const baseline = loaderFixture(); const charged = loaderFixture({ receiptFee: true });
  const [before] = await baseline.loader([baseline.stem], settings, asOfDate);
  const [after] = await charged.loader([charged.stem], settings, asOfDate);
  assert.equal(after.finance.complete, true); assert.equal(after.finance.bankCharge, 31);
  assert.equal(after.finance.financeCost, before.finance.financeCost); assert.equal(after.finance.ebit, before.finance.ebit - 25);
});

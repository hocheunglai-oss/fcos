import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildIssuedSupplierRow,
  buildSupplierCreditStatement,
  buildUninvoicedSupplierRows,
  estimateUninvoicedSupplierChild,
  normalizeSupplierCreditScope,
  resolveSupplierInvoiceIdentity,
  supplierOpenUninvoicedRows,
} from '../api/_dashboardSupplierCreditStatement.js';

const accountId = '001000000000001AAA';
const groupMemberId = '001000000000002AAA';
const otherSupplierId = '001000000000003AAA';
const stemId = 'a01000000000001AAA';

test('supplier statement defaults to open scope', () => {
  assert.equal(normalizeSupplierCreditScope(), 'open');
  assert.equal(normalizeSupplierCreditScope('unexpected'), 'open');
  assert.equal(normalizeSupplierCreditScope('open_recent'), 'open_recent');
  assert.equal(normalizeSupplierCreditScope('all'), 'all');
});

test('Supplier Invoice identity prefers actual supplier and rejects conflicting linked children', () => {
  assert.deepEqual(resolveSupplierInvoiceIdentity({
    invoice: { Supplier__c: accountId },
    linkedSupplierAccountIds: [otherSupplierId],
    selectedAccountIds: [accountId],
  }), { status: 'included', supplierAccountId: accountId, source: 'actual_supplier' });

  const conflict = resolveSupplierInvoiceIdentity({
    invoice: { Supplier__c: otherSupplierId },
    linkedSupplierAccountIds: [accountId],
    selectedAccountIds: [accountId],
  });
  assert.equal(conflict.status, 'conflict');
  assert.match(conflict.warning, /conflicts/i);

  assert.deepEqual(resolveSupplierInvoiceIdentity({
    invoice: {},
    linkedSupplierAccountIds: [accountId],
    selectedAccountIds: [accountId],
  }), { status: 'included', supplierAccountId: accountId, source: 'linked_exact_supplier_child' });
});

test('uninvoiced supplier estimates prefer delivered BDN, then range maximum, then ordered quantity', () => {
  const delivered = estimateUninvoicedSupplierChild({
    Quantity_Delivered_Per_BDN__c: 80, Quantity__c: 100, Quantity_Max__c: 120,
    Is_Quantity_Range__c: true, Cost_Per_Unit__c: 500, CurrencyIsoCode: 'USD', _uom: 'MT',
  });
  assert.equal(delivered.amount, 40_000);
  assert.equal(delivered.basis, 'delivered_bdn');
  assert.equal(delivered.usesRangeMaximum, false);

  const maximum = estimateUninvoicedSupplierChild({
    Quantity_Delivered_Per_BDN__c: 0, Quantity__c: 100, Quantity_Max__c: 120,
    Is_Quantity_Range__c: true, Unit_Buy_At__c: 500, CurrencyIsoCode: 'USD', _uom: 'MT',
  });
  assert.equal(maximum.amount, 60_000);
  assert.equal(maximum.basis, 'range_max_quantity');
  assert.equal(maximum.usesRangeMaximum, true);

  const ordered = estimateUninvoicedSupplierChild({ Quantity__c: 100, Unit_Cost__c: 500, CurrencyIsoCode: 'USD', _uom: 'MT' });
  assert.equal(ordered.amount, 50_000);
  assert.equal(ordered.basis, 'ordered_quantity');
});

test('fixed extra costs need no UOM while per-unit and ambiguous rows fail closed', () => {
  const fixed = estimateUninvoicedSupplierChild({ Line_Total_Buy__c: 1_250, CurrencyIsoCode: 'USD' }, 'extra_cost');
  assert.equal(fixed.complete, true);
  assert.equal(fixed.amount, 1_250);
  assert.equal(fixed.basis, 'fixed');

  const perUnit = estimateUninvoicedSupplierChild({ Quantity__c: 2, Unit_Cost__c: 100, CurrencyIsoCode: 'USD' }, 'extra_cost');
  assert.equal(perUnit.complete, false);
  assert.match(perUnit.blockingReason, /unit of measure/i);

  const ambiguous = estimateUninvoicedSupplierChild({ _ambiguousInvoiceLinkage: true, CurrencyIsoCode: 'USD' });
  assert.equal(ambiguous.complete, false);
  assert.match(ambiguous.blockingReason, /double-counting/i);
});

test('issued invoice forecast uses scheduled, partial, then invoice due evidence without exceeding payable', () => {
  const row = buildIssuedSupplierRow({
    today: '2026-08-18',
    identity: { supplierAccountId: accountId, source: 'actual_supplier' },
    invoice: {
      Id: 'a02000000000001AAA', STEM__c: stemId, Name: 'SI-1', CurrencyIsoCode: 'USD',
      Invoice_Amount__c: 1_000, Payable_Balance__c: 600,
      Partial_Amount__c: 250, Partial_Invoice_Due_Date__c: '2026-08-25', Invoice_Due_Date__c: '2026-09-10',
    },
    stem: { Id: stemId, Name: 'HK2627001T' },
    cashflows: [{ Id: 'a03000000000001AAA', Scheduled_Payment_Date__c: '2026-08-20', Scheduled_Payment_Amount__c: 200 }],
  });
  assert.equal(row.currentExposure, 600);
  assert.deepEqual(row.forecastEvents.map(({ date, amount, source }) => ({ date, amount, source })), [
    { date: '2026-08-20', amount: 200, source: 'cashflow_scheduled_payment' },
    { date: '2026-08-25', amount: 250, source: 'partial_invoice_due' },
    { date: '2026-09-10', amount: 150, source: 'supplier_invoice_due' },
  ]);
  assert.equal(row.undatedAmount, 0);
});

test('uninvoiced rows group one STEM, supplier, and currency with expandable child evidence', () => {
  const rows = buildUninvoicedSupplierRows({
    today: '2026-08-18',
    stemsById: { [stemId]: { Id: stemId, Name: 'HK2627001T', Delivery_Date__c: '2026-08-20' } },
    children: [
      { Id: 'a04000000000001AAA', STEM__c: stemId, _supplierAccountId: accountId, _supplierName: 'SUPPLIER A', _kind: 'line_item', _label: 'VLSFO', _uom: 'MT', Quantity__c: 100, Cost_Per_Unit__c: 500, Payment_Term__c: '30 Days', CurrencyIsoCode: 'USD' },
      { Id: 'a05000000000001AAA', STEM__c: stemId, _supplierAccountId: accountId, _supplierName: 'SUPPLIER A', _kind: 'extra_cost', _label: 'Launch fee', Line_Total_Buy__c: 1_000, Payment_Term__c: '30 Days', CurrencyIsoCode: 'USD' },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].expectedSupplierCost, 51_000);
  assert.equal(rows[0].childEvidence.length, 2);
  assert.equal(rows[0].expectedPaymentDate, '2026-09-19');
});

test('supplier model separates Account and optional GROUP KPIs and builds descending stepAfter points', () => {
  const issued = buildIssuedSupplierRow({
    today: '2026-08-18', identity: { supplierAccountId: accountId, source: 'actual_supplier' },
    invoice: { Id: 'a02000000000001AAA', STEM__c: stemId, CurrencyIsoCode: 'USD', Invoice_Amount__c: 500, Payable_Balance__c: 500, Invoice_Due_Date__c: '2026-09-10' },
    stem: { Id: stemId, Name: 'A' },
  });
  const groupRow = buildIssuedSupplierRow({
    today: '2026-08-18', identity: { supplierAccountId: groupMemberId, source: 'actual_supplier' },
    invoice: { Id: 'a02000000000002AAA', STEM__c: 'a01000000000002AAA', CurrencyIsoCode: 'USD', Invoice_Amount__c: 300, Payable_Balance__c: 300, Invoice_Due_Date__c: '2026-09-20' },
    stem: { Id: 'a01000000000002AAA', Name: 'B' },
  });
  const model = buildSupplierCreditStatement({
    today: '2026-08-18', account: { Id: accountId, Name: 'SUPPLIER A' },
    group: { Id: '001000000000009AAA', Name: 'GROUP - SUPPLIER' },
    groupMembers: [{ Id: accountId }, { Id: groupMemberId }],
    issuedRows: [issued, groupRow], includeGroup: true,
  });
  assert.equal(model.kpis.account[0].totalExposure, 500);
  assert.equal(model.kpis.group[0].totalExposure, 800);
  assert.deepEqual(model.chart.currencies[0].account.points.map((point) => point.remaining), [500, 0]);
  assert.deepEqual(model.chart.currencies[0].group.points.map((point) => point.remaining), [800, 300, 0]);
});

test('incomplete estimates suppress only their currency total and payable forecast', () => {
  const incompleteRows = buildUninvoicedSupplierRows({
    today: '2026-08-18',
    stemsById: { [stemId]: { Id: stemId, Name: 'HK2627001T', Delivery_Date__c: '2026-08-20' } },
    children: [{
      Id: 'a04000000000001AAA', STEM__c: stemId, _supplierAccountId: accountId, _supplierName: 'SUPPLIER A',
      _kind: 'line_item', _label: 'VLSFO', Quantity__c: 100, CurrencyIsoCode: 'USD',
    }],
  });
  const eurInvoice = buildIssuedSupplierRow({
    today: '2026-08-18', identity: { supplierAccountId: accountId, source: 'actual_supplier' },
    invoice: { Id: 'a02000000000001AAA', STEM__c: stemId, CurrencyIsoCode: 'EUR', Invoice_Amount__c: 500, Payable_Balance__c: 500, Invoice_Due_Date__c: '2026-09-10' },
    stem: { Id: stemId, Name: 'A' },
  });
  const model = buildSupplierCreditStatement({
    today: '2026-08-18', account: { Id: accountId, Name: 'SUPPLIER A' }, issuedRows: [eurInvoice], uninvoicedRows: incompleteRows,
  });
  assert.equal(model.kpis.account.find((row) => row.currency === 'USD').complete, false);
  assert.equal(model.kpis.account.find((row) => row.currency === 'USD').totalExposure, null);
  assert.equal(model.chart.currencies.find((row) => row.currency === 'USD').complete, false);
  assert.equal(model.kpis.account.find((row) => row.currency === 'EUR').totalExposure, 500);
  assert.equal(model.chart.currencies.find((row) => row.currency === 'EUR').complete, true);
});

test('past-due issued payable remains as an unknown-date residual plateau', () => {
  const row = buildIssuedSupplierRow({
    today: '2026-08-18', identity: { supplierAccountId: accountId, source: 'actual_supplier' },
    invoice: { Id: 'a02000000000001AAA', STEM__c: stemId, CurrencyIsoCode: 'USD', Invoice_Amount__c: 500, Payable_Balance__c: 300, Invoice_Due_Date__c: '2026-08-10' },
    stem: { Id: stemId, Name: 'A' },
  });
  assert.equal(row.overdue, true);
  assert.equal(row.overdueAmount, 300);
  assert.equal(row.forecastEvents.length, 0);
  assert.equal(row.undatedAmount, 300);
  const model = buildSupplierCreditStatement({ today: '2026-08-18', account: { Id: accountId, Name: 'SUPPLIER A' }, issuedRows: [row] });
  assert.equal(model.chart.currencies[0].account.points.at(-1).remaining, 300);
  assert.equal(model.kpis.account[0].overdue, 300);
});

test('Open supplier scope excludes complete zero-value estimates but retains incomplete safeguards', () => {
  const rows = supplierOpenUninvoicedRows([
    { rowId: 'zero', exposureComplete: true, currentExposure: 0 },
    { rowId: 'payable', exposureComplete: true, currentExposure: 125 },
    { rowId: 'incomplete', exposureComplete: false, currentExposure: null },
  ]);
  assert.deepEqual(rows.map((row) => row.rowId), ['payable', 'incomplete']);
});

test('Supplier Credit Statement wiring preserves buyer compatibility, access scope, and inherited Dashboard filters', async () => {
  const [service, supplierService, directory, modal, ui, methodology] = await Promise.all([
    readFile(new URL('../api/_dashboardAccountCreditStatementService.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_dashboardSupplierCreditStatementService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/AccountCreditDirectory.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/AccountInsightModal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/SupplierCreditStatement.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pageMethodologies.js', import.meta.url), 'utf8'),
  ]);
  assert.match(service, /body\.side === 'supplier'/);
  assert.match(service, /body\.role === 'supplier'/);
  assert.match(supplierService, /loadAccountChain\(account\.Id, accountMap\)/);
  assert.match(supplierService, /isInterofficeExcluded/);
  assert.match(supplierService, /SUPPLIER_CREDIT_SCOPE_LIMIT/);
  assert.match(directory, /Supplier statements/);
  assert.doesNotMatch(directory, /Search Accounts|placeholder="Search Account/);
  assert.match(modal, /SupplierCreditStatement/);
  assert.match(modal, /dashboardScope\?\.filters/);
  assert.match(ui, /side: 'supplier'/);
  assert.match(ui, /Include GROUP/);
  assert.match(ui, /TOTAL PAYABLE EXPOSURE/);
  assert.match(ui, /BASIS MAX QTY/);
  assert.match(ui, /text\/html/);
  assert.match(ui, /numeric\(row\.currentExposure\) > 0\.005/);
  assert.match(methodology, /Supplier Credit Statement/);
});

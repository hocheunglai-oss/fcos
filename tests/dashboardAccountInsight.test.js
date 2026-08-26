import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateSupplierContribution,
  buildDashboardAccountInsight,
} from '../api/_dashboardAccountInsight.js';
import { dashboardAccountInsightExportInternals, generateDashboardAccountInsightExport } from '../api/_dashboardAccountInsightExport.js';
import { dashboardAccountInsightServiceInternals } from '../api/_dashboardAccountInsightService.js';

const BUYER = '001000000000001AAA';
const GROUP = '001000000000002AAA';
const SUPPLIER_A = '001000000000003AAA';
const SUPPLIER_B = '001000000000004AAA';
const STEM_A = 'a00000000000001AAA';
const STEM_B = 'a00000000000002AAA';

function stem(id, overrides = {}) {
  return {
    Id: id,
    Name: id === STEM_A ? 'HK260001T' : 'HK260002T',
    KeyStem__c: id === STEM_A ? 'HK260001T' : 'HK260002T',
    Account__c: BUYER,
    Account__r: {
      Name: 'Buyer One',
      Company_Code__c: 'BUY001',
      ParentId: GROUP,
      Parent: { Name: 'Buyer Group', Company_Code__c: 'GRP001' },
    },
    Delivery_Date__c: '2026-07-15',
    Expected_Delivery_Date__c: '2026-07-14',
    ETA_Start_Date__c: '2026-07-12',
    CreatedDate: '2026-07-01T00:00:00.000Z',
    Invoice_Due_Date__c: '2026-07-31',
    Original_Invoice_Sent_Date__c: '2026-07-01',
    Total_Invoice_Amount__c: 1100,
    Total_Invoiced_Amount_From_Suppliers__c: 900,
    Receivable_Balance__c: 600,
    CurrencyIsoCode: 'USD',
    Port__r: { Name: 'Singapore', Country__c: 'Singapore' },
    Vessel__r: { Name: 'TEST VESSEL' },
    Status__c: 'Delivered',
    Dispute_Status__c: 'No Dispute',
    ...overrides,
  };
}

function line(id, stemId, supplierId, quantity, sell, cost, overrides = {}) {
  return {
    Id: id,
    STEM__c: stemId,
    Original_Supplier__c: supplierId,
    Original_Supplier__r: { Name: 'Same Supplier Name', Company_Code__c: supplierId === SUPPLIER_A ? 'SUP-A' : 'SUP-B' },
    Product__c: '01t000000000001AAA',
    Product__r: { Name: 'VLSFO', Family: 'VLSFO', QuantityUnitOfMeasure: 'MT' },
    Quantity_Delivered_Per_BDN__c: quantity,
    Total_Price__c: sell,
    Total_Cost__c: cost,
    Supplier_Invoice__c: supplierId === SUPPLIER_A ? 'a03000000000001AAA' : 'a03000000000002AAA',
    Cancelled__c: false,
    Payment_Term__c: supplierId === SUPPLIER_A ? '30 days' : '45 days',
    ...overrides,
  };
}

function dataset(overrides = {}) {
  return {
    identity: { accountId: BUYER, name: 'Buyer One', clKey: 'BUY001', inactive: false, recordType: 'Buyer' },
    role: 'buyer',
    availableRoles: ['buyer'],
    period: { mode: 'dashboard_period', label: 'Jul 2026', windows: [], previousWindows: [] },
    scopeAccounts: [{ accountId: BUYER, name: 'Buyer One', clKey: 'BUY001', inactive: false, root: true, managerCount: 1 }],
    stems: [stem(STEM_A)],
    previousStems: [],
    lineItems: [
      line('a02000000000001AAA', STEM_A, SUPPLIER_A, 60, 600, 500, { Buyers_Brokers_Commission_Per_Unit__c: 1 }),
      line('a02000000000002AAA', STEM_A, SUPPLIER_B, 40, 400, 300, { Buyers_Brokers_Commission_Per_Unit__c: 1 }),
    ],
    previousLineItems: [],
    extraCosts: [],
    previousExtraCosts: [],
    buyerBrokers: [],
    previousBuyerBrokers: [],
    buyerPaymentsByStem: {},
    supplierInvoices: [],
    schema: {
      originalSupplierRelationship: 'Original_Supplier__r',
      extraCostSupplierField: 'Supplier__c',
      extraCostSupplierRelationship: 'Supplier__r',
      lineItemUomField: null,
      extraCostUomField: null,
      productUomField: 'QuantityUnitOfMeasure',
    },
    collectionByStem: {},
    workflows: { cases: [], parties: [], actions: [], instructions: [] },
    compensation: { accounts: [] },
    exceptions: { count: 0, overdue: 0, reasons: [] },
    specialTerms: { count: 0, terms: [] },
    warnings: [],
    truncated: false,
    meta: { salesforceFetchedAt: '2026-08-05T00:00:00.000Z' },
    ...overrides,
  };
}

test('allocates supplier contribution by exact Account ID and reconciles to the STEM profit', () => {
  const rows = allocateSupplierContribution({
    stem: stem(STEM_A),
    lineItems: dataset().lineItems,
    buyerAmount: 1100,
    supplierAmount: 900,
    brokerCommissions: 100,
    originalSupplierRelationship: 'Original_Supplier__r',
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, rows[1].name);
  assert.notEqual(rows[0].accountKey, rows[1].accountKey);
  assert.equal(rows.find((row) => row.accountKey === SUPPLIER_A.slice(0, 15)).grossProfit, 40);
  assert.equal(rows.find((row) => row.accountKey === SUPPLIER_B.slice(0, 15)).grossProfit, 60);
  assert.equal(rows.reduce((sum, row) => sum + row.grossProfit, 0), 100);
});

test('buyer-broker enrichment uses described fields and never assumes Commission_Lumpsum__c exists', () => {
  const fields = new Map([
    ['Id', { name: 'Id', type: 'id' }],
    ['STEM__c', { name: 'STEM__c', type: 'reference', referenceTo: ['STEM__c'] }],
    ['Buyer_Broker__c', {
      name: 'Buyer_Broker__c',
      type: 'reference',
      referenceTo: ['Account'],
      relationshipName: 'Buyer_Broker__r',
    }],
  ]);
  const accountFields = new Map([['Company_Code__c', { name: 'Company_Code__c' }]]);
  const config = dashboardAccountInsightServiceInternals.buyerBrokerQueryConfiguration(fields, accountFields);

  assert.deepEqual(config.fields, [
    'Id',
    'STEM__c',
    'Buyer_Broker__c',
    'Buyer_Broker__r.Name',
    'Buyer_Broker__r.Company_Code__c',
  ]);
  assert.equal(config.commissionField, null);
  assert.equal(config.warning, null);
});

test('buyer-broker enrichment selects a commission amount only when describe confirms it', () => {
  const fields = new Map([
    ['STEM__c', { name: 'STEM__c', type: 'reference', referenceTo: ['STEM__c'] }],
    ['Commission_Amount__c', { name: 'Commission_Amount__c', type: 'currency' }],
  ]);
  const config = dashboardAccountInsightServiceInternals.buyerBrokerQueryConfiguration(fields, new Map());

  assert.equal(config.commissionField, 'Commission_Amount__c');
  assert.ok(config.fields.includes('Commission_Amount__c'));
  assert.equal(config.warning, null);
});

test('loads Salesforce UOM and Product UOM fallbacks for extra costs', () => {
  const extraFields = new Map([
    ['Product2Id__c', { name: 'Product2Id__c', relationshipName: 'Product2Id__r' }],
    ['Unit_of_Measure__c', { name: 'Unit_of_Measure__c' }],
  ]);
  const fields = dashboardAccountInsightServiceInternals.extraCostSelectFields(
    extraFields,
    new Map(),
    new Map([['Family', { name: 'Family' }]]),
    { valid: false },
    { extraCostUomField: 'Unit_of_Measure__c', productUomField: 'QuantityUnitOfMeasure' },
  );

  assert.ok(fields.includes('Unit_of_Measure__c'));
  assert.ok(fields.includes('Product2Id__r.QuantityUnitOfMeasure'));
});

test('does not report fixed delivered extra costs as missing a financial UOM', () => {
  const result = buildDashboardAccountInsight(dataset({
    extraCosts: [{
      Id: 'a03000000000041AAA', STEM__c: STEM_A, Supplier__c: SUPPLIER_A,
      Quantity__c: 1, Quantity_Delivered_Per_BDN__c: 1,
      Line_Total__c: 200, Line_Total_Buy__c: 150,
      Supplier_Invoice__c: null, Cancelled__c: false,
    }],
  }), { today: '2026-08-16' });

  assert.equal(result.warnings.some((warning) => warning.includes('Salesforce UOM')), false);
});

test('uses an extra-cost Product UOM fallback for undelivered per-unit pricing', () => {
  const result = buildDashboardAccountInsight(dataset({
    stems: [stem(STEM_A, { Delivery_Date__c: null })],
    extraCosts: [{
      Id: 'a03000000000042AAA', STEM__c: STEM_A, Supplier__c: SUPPLIER_A,
      Quantity__c: 2, Unit_Price__c: 100, Unit_Cost__c: 80,
      Product2Id__r: { QuantityUnitOfMeasure: 'EA' },
      Supplier_Invoice__c: null, Cancelled__c: false,
    }],
  }), { today: '2026-08-16' });

  assert.equal(result.warnings.some((warning) => warning.includes('Salesforce UOM')), false);
});

test('combines repeated occurrences of one supplier ID and gives the final supplier any rounding residual', () => {
  const rows = allocateSupplierContribution({
    stem: stem(STEM_A),
    lineItems: [
      line('a02000000000003AAA', STEM_A, SUPPLIER_A, 10, 100, 80),
      line('a02000000000004AAA', STEM_A, SUPPLIER_A, 5, 50, 40),
      line('a02000000000005AAA', STEM_A, SUPPLIER_B, 1, 1, 1),
    ],
    buyerAmount: 200,
    supplierAmount: 150,
    brokerCommissions: 10,
    originalSupplierRelationship: 'Original_Supplier__r',
  });

  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.accountKey === SUPPLIER_A.slice(0, 15)).directRevenue, 150);
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.grossProfit, 0) - 40) < 1e-9);
});

test('excludes cancelled STEMs and child records from financial totals while retaining cancellation KPIs', () => {
  const cancelledStem = stem(STEM_B, {
    Status__c: 'Cancelled',
    Delivery_Date__c: null,
    Total_Invoice_Amount__c: 9999,
    Total_Invoiced_Amount_From_Suppliers__c: 7000,
  });
  const result = buildDashboardAccountInsight(dataset({
    stems: [stem(STEM_A), cancelledStem],
    lineItems: [
      ...dataset().lineItems,
      line('a02000000000006AAA', STEM_A, SUPPLIER_A, 500, 5000, 4000, { Cancelled__c: true }),
      line('a02000000000007AAA', STEM_B, SUPPLIER_A, 900, 9000, 7000),
    ],
  }), { today: '2026-08-05' });

  assert.equal(result.kpis.stemCount, 2);
  assert.equal(result.kpis.cancelledStems, 1);
  assert.equal(result.kpis.cancelledChildRecords, 1);
  assert.equal(result.kpis.turnover, 1100);
  assert.equal(result.kpis.totalVolumeMt, 100);
});

test('keeps currencies separate and does not publish a cross-currency Gross Profit total', () => {
  const result = buildDashboardAccountInsight(dataset({
    stems: [stem(STEM_A), stem(STEM_B, { CurrencyIsoCode: 'EUR', Total_Invoice_Amount__c: 600, Total_Invoiced_Amount_From_Suppliers__c: 500 })],
    lineItems: [
      ...dataset().lineItems,
      line('a02000000000008AAA', STEM_B, SUPPLIER_A, 20, 600, 500),
    ],
  }), { today: '2026-08-05' });

  assert.equal(result.kpis.multipleCurrencies, true);
  assert.equal(result.kpis.moneyByCurrency.length, 2);
  assert.equal(result.kpis.turnover, null);
  assert.equal(result.kpis.grossProfit, null);
  assert.ok(result.warnings.some((warning) => warning.includes('does not net currencies')));
});

test('preserves the pre-redesign parent-delivery quantity rule for STAR FLAME', () => {
  const starStem = stem(STEM_A, {
    Name: 'HK2627258T - STAR FLAME - HONG KONG',
    Delivery_Date__c: null,
    Expected_Delivery_Date__c: '2026-08-12',
    Total_Invoice_Amount__c: 0,
    Total_Invoiced_Amount_From_Suppliers__c: 100_940,
    QLIK_STEM_Line_Item_Total_Cost__c: 588_940,
    QLIK_Costs_Total_Cost__c: 0.5,
    QLIK_Total_Profit__c: 5_608.5,
  });
  const result = buildDashboardAccountInsight(dataset({
    stems: [starStem],
    lineItems: [
      line('a02000000000020AAA', STEM_A, SUPPLIER_A, null, 430_150, 427_000, {
        Quantity__c: 700, Quantity_Max__c: 900, Quantity_Delivered_Per_BDN__c: null,
        Is_Quantity_Range__c: true, Unit_Sell_At__c: 614.5, Unit_Buy_At__c: 610,
        Supplier_Invoice__c: null,
      }),
      line('a02000000000021AAA', STEM_A, SUPPLIER_B, 98, 102_949, 100_940, {
        Quantity__c: 50, Quantity_Max__c: 100, Is_Quantity_Range__c: true,
        Unit_Sell_At__c: 1_050.5, Unit_Buy_At__c: 1_030,
      }),
    ],
    extraCosts: [{
      Id: 'a03000000000020AAA', STEM__c: STEM_A, Supplier__c: SUPPLIER_B,
      Supplier__r: { Name: 'Same Supplier Name' }, Quantity__c: 1,
      Quantity_Delivered_Per_BDN__c: 1, Line_Total__c: 0, Line_Total_Buy__c: 0.5,
      Supplier_Invoice__c: null, Cancelled__c: false,
    }],
  }), { today: '2026-08-16' });

  assert.equal(result.stems.rows[0].grossProfit, -18_553);
  assert.equal(result.stems.rows[0].currency, 'USD');
  assert.equal(result.stems.rows[0].volumeMt, 875);
});

test('HK2627315T uses calculated buyer value while its final Buyer Invoice is not issued', () => {
  const result = buildDashboardAccountInsight(dataset({
    buyerInvoices: [],
    stems: [stem(STEM_A, {
      Name: 'HK2627315T - NEW GLOBAL - HONG KONG',
      KeyStem__c: 'HK2627315T',
      Delivery_Date__c: '2026-08-22',
      Total_Invoice_Amount__c: 0,
      Total_Invoiced_Amount_From_Suppliers__c: 344_050,
      Costs_Total__c: 1_274.91,
      QLIK_STEM_Line_Item_Total_Cost__c: 344_050,
      QLIK_Costs_Total_Cost__c: 267.51,
    })],
    lineItems: [
      line('a02000000000315AAA', STEM_A, SUPPLIER_A, 363, 295_119, 284_955),
      line('a02000000000316AAA', STEM_A, SUPPLIER_A, 53, 62_699, 59_095),
    ],
    extraCosts: [
      { Id: 'a03000000000315AAA', STEM__c: STEM_A, Supplier__c: SUPPLIER_A, Supplier__r: { Name: 'Agent' }, Quantity__c: 1, Line_Total__c: 1_000, Line_Total_Buy__c: 0, Cancelled__c: false },
      { Id: 'a03000000000316AAA', STEM__c: STEM_A, Supplier__c: SUPPLIER_A, Supplier__r: { Name: 'Agent' }, Quantity__c: 1, Line_Total__c: 267.51, Line_Total_Buy__c: 267.51, Cancelled__c: false },
      { Id: 'a03000000000317AAA', STEM__c: STEM_A, Supplier__c: SUPPLIER_A, Supplier__r: { Name: 'Agent' }, Quantity__c: 1, Line_Total__c: 7.4, Line_Total_Buy__c: 0, Cancelled__c: false },
    ],
  }), { today: '2026-08-26' });

  assert.equal(result.stems.rows[0].buyerInvoiceIssued, false);
  assert.equal(result.stems.rows[0].buyerAmountSource, 'calculated_unissued');
  assert.ok(Math.abs(result.stems.rows[0].turnover - 359_092.91) < 0.000001);
  assert.ok(Math.abs(result.stems.rows[0].grossProfit - 14_775.4) < 0.000001);
});

test('HK2627293T does not show a negative profit before its Buyer Invoice is issued', () => {
  const result = buildDashboardAccountInsight(dataset({
    buyerInvoices: [],
    stems: [stem(STEM_A, {
      Name: 'HK2627293T - COREBEST OL - HONG KONG',
      KeyStem__c: 'HK2627293T',
      Delivery_Date__c: '2026-08-25',
      Total_Invoice_Amount__c: 0,
      Total_Invoiced_Amount_From_Suppliers__c: 257_174.3,
      QLIK_STEM_Line_Item_Total_Cost__c: 257_174.3,
      QLIK_Costs_Total_Cost__c: 0.5,
    })],
    lineItems: [line('a02000000007293AAA', STEM_A, SUPPLIER_A, 1, 260_207.2, 257_174.3)],
    extraCosts: [{
      Id: 'a03000000007293AAA', STEM__c: STEM_A, Supplier__c: SUPPLIER_A,
      Supplier__r: { Name: 'Agent' }, Quantity__c: 1,
      Line_Total__c: 0, Line_Total_Buy__c: 0.5,
      Supplier_Invoice__c: null, Cancelled__c: false,
    }],
  }), { today: '2026-08-26' });

  assert.equal(result.stems.rows[0].buyerAmountSource, 'calculated_unissued');
  assert.ok(Math.abs(result.stems.rows[0].turnover - 260_207.2) < 0.000001);
  assert.ok(Math.abs(result.stems.rows[0].grossProfit - 3_032.4) < 0.000001);
});

test('does not double count invoiced extra costs already included in the supplier invoice total', () => {
  const result = buildDashboardAccountInsight(dataset({
    stems: [stem(STEM_A, {
      Name: 'HK2627193T',
      Total_Invoice_Amount__c: 511_525.38,
      Total_Invoiced_Amount_From_Suppliers__c: 511_190.37,
      QLIK_STEM_Line_Item_Total_Cost__c: 510_548.38,
      QLIK_Costs_Total_Cost__c: 641.99,
    })],
    lineItems: [line('a02000000000030AAA', STEM_A, SUPPLIER_A, 670.011, 510_883.39, 510_548.38)],
    extraCosts: [{
      Id: 'a03000000000030AAA', STEM__c: STEM_A, Supplier__c: SUPPLIER_A,
      Supplier__r: { Name: 'Same Supplier Name' }, Quantity__c: 1,
      Quantity_Delivered_Per_BDN__c: 1, Line_Total__c: 641.99, Line_Total_Buy__c: 641.99,
      Supplier_Invoice__c: 'a04000000000030AAA', Cancelled__c: false,
    }],
  }), { today: '2026-08-16' });

  assert.ok(Math.abs(result.stems.rows[0].grossProfit - 335.01) < 0.000001);
});

test('supplier role includes only the exact Account ID and its direct volume', () => {
  const supplierData = dataset({
    identity: { accountId: SUPPLIER_A, name: 'Same Supplier Name', clKey: 'SUP-A', inactive: false, recordType: 'Supplier' },
    role: 'supplier',
    availableRoles: ['supplier'],
    scopeAccounts: [{ accountId: SUPPLIER_A, name: 'Same Supplier Name', clKey: 'SUP-A', inactive: false, root: true, managerCount: 1 }],
  });
  const result = buildDashboardAccountInsight(supplierData, { today: '2026-08-05' });

  assert.equal(result.stems.total, 1);
  assert.equal(result.kpis.totalVolumeMt, 60);
  assert.equal(result.kpis.turnover, 660);
  assert.equal(result.kpis.supplierSpend, 560);
  assert.equal(result.kpis.grossProfit, 40);
  assert.equal(result.stems.rows[0].supplierAllocation.accountKey, SUPPLIER_A.slice(0, 15));
});

test('applies the established CIA rule and preserves live collection state per STEM', () => {
  const result = buildDashboardAccountInsight(dataset({
    buyerPaymentsByStem: {
      [STEM_A]: [{ paymentId: 'a04000000000001AAA', paymentDate: '2026-07-12', amount: 500, currency: 'USD' }],
    },
    collectionByStem: {
      [STEM_A]: { item: { status: 'Payment Advice Received', reconciliationState: 'advice_pending', adviceVerificationDate: '2026-08-04' }, events: [] },
    },
  }), { today: '2026-08-05' });

  assert.equal(result.payments.buyer.cia.partialCount, 1);
  assert.equal(result.payments.buyer.cia.byCurrency[0].partialValue, 500);
  assert.equal(result.payments.buyer.weightedDso, 11);
  assert.equal(result.collection.unverifiedPaymentAdvice, 1);
  assert.equal(result.stems.rows[0].collectionStatus, 'Payment Advice Received');
  assert.equal(result.stems.rows[0].reconciliationState, 'advice_pending');
});

test('uses live receivable balance for Full CIA and excludes future balances from aging', () => {
  const result = buildDashboardAccountInsight(dataset({
    stems: [stem(STEM_A, { Receivable_Balance__c: 0, Invoice_Due_Date__c: '2026-08-20' })],
    buyerPaymentsByStem: {
      [STEM_A]: [{ paymentId: 'a04000000000002AAA', paymentDate: '2026-07-12', amount: 500, currency: 'USD' }],
    },
  }), { today: '2026-08-05' });

  assert.equal(result.payments.buyer.cia.fullCount, 1);
  assert.deepEqual(result.payments.buyer.agingByCurrency[0], {
    currency: 'USD',
    days1to7: 0,
    days8to30: 0,
    days31to60: 0,
    days61to90: 0,
    over90: 0,
  });
});

test('counts disputes only for the exact Account party outside GROUP scope', () => {
  const result = buildDashboardAccountInsight(dataset({
    workflows: {
      cases: [
        { id: 'case-a', stem_id: STEM_A, workflow_status: 'Open', created_at: '2026-07-01' },
        { id: 'case-b', stem_id: STEM_A, workflow_status: 'Open', created_at: '2026-07-02' },
      ],
      parties: [
        { id: 'party-a', case_id: 'case-a', stem_id: STEM_A, account_id: BUYER },
        { id: 'party-b', case_id: 'case-b', stem_id: STEM_A, account_id: SUPPLIER_A },
      ],
      actions: [],
      instructions: [],
    },
  }), { today: '2026-08-05' });

  assert.equal(result.risk.dispute.open, 1);
});

test('GROUP insight excludes inactive descendants and their historical activity', () => {
  const groupData = dataset({
    identity: { accountId: GROUP, name: 'Buyer Group', clKey: 'GRP001', inactive: false, recordType: 'Group' },
    role: 'group',
    availableRoles: ['group'],
    scopeAccounts: [
      { accountId: GROUP, name: 'Buyer Group', clKey: 'GRP001', inactive: false, root: true, managerCount: 1 },
      { accountId: BUYER, name: 'Buyer One', clKey: 'BUY001', inactive: true, root: false, managerCount: 0 },
    ],
  });
  const result = buildDashboardAccountInsight(groupData, { today: '2026-08-05' });

  assert.equal(result.relationship.childCount, 0);
  assert.equal(result.relationship.inactiveChildCount, 0);
  assert.equal(result.relationship.tradingChildCount, 0);
  assert.equal(result.children.some((child) => child.accountId === BUYER), false);
  assert.equal(result.kpis.stemCount, 0);
});

test('builds Dashboard, trailing-12, and all-history date scopes', () => {
  const { insightPeriod } = dashboardAccountInsightServiceInternals;
  const dashboard = insightPeriod({ periodMode: 'dashboard_period', selectedYears: [2026], selectedMonths: [7] }, '2026-08-05');
  const trailing = insightPeriod({ periodMode: 'trailing_12' }, '2026-08-05');
  const history = insightPeriod({ periodMode: 'all_history' }, '2026-08-05');

  assert.deepEqual(dashboard.windows, [{ start: '2026-07-01', end: '2026-07-31' }]);
  assert.deepEqual(trailing.windows, [{ start: '2025-09-01', end: '2026-08-05' }]);
  assert.deepEqual(trailing.previousWindows, [{ start: '2024-09-01', end: '2025-08-31' }]);
  assert.deepEqual(history.windows, []);
});

test('creates analysis-ready CSV and a figure-rich PDF without empty legacy sections', () => {
  const insight = buildDashboardAccountInsight(dataset(), { today: '2026-08-05' });
  const csv = generateDashboardAccountInsightExport(insight, { format: 'csv', actorName: 'Test User', today: '2026-08-05' });
  const pdf = generateDashboardAccountInsightExport(insight, { format: 'pdf', actorName: 'Test User', today: '2026-08-05' });
  const csvText = csv.buffer.toString('utf8');

  assert.equal(csv.filename, '20260805 Buyer One BUY001 Account Insight.csv');
  assert.ok(csvText.startsWith('\uFEFFRow Type,Account Name'));
  assert.match(csvText, /STEM,Buyer One,BUY001,001000000000001AAA,buyer,HK260001T/);
  assert.match(csvText, /TOTALS,Buyer One/);
  const columnCounts = csvText.replace(/^\uFEFF/, '').split('\r\n').map((row) => row.split(',').length);
  assert.ok(columnCounts.every((count) => count === columnCounts[0]));
  assert.equal(pdf.filename, '20260805 Buyer One BUY001 Account Insight.pdf');
  assert.equal(pdf.buffer.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(pdf.buffer.length > 3000);
  assert.deepEqual(dashboardAccountInsightExportInternals.recentPerformanceRows(insight.kpis, 'USD')[0], [
    '2026-07', '1', '100 MT', 'USD 1,100.00', 'USD 100.00', '9.09%',
  ]);
  assert.equal(dashboardAccountInsightExportInternals.topStemRows(insight)[0][0], 'HK260001T');
  assert.equal(dashboardAccountInsightExportInternals.hasMeaningfulPayment(insight.payments.buyer.byCurrency[0], 'buyer'), true);
  assert.equal(dashboardAccountInsightExportInternals.hasMeaningfulPayment({ currency: 'USD' }, 'buyer'), false);
});

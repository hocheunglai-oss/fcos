import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardAccountInsight } from '../api/_dashboardAccountInsight.js';
import { generateDashboardAccountInsightExport } from '../api/_dashboardAccountInsightExport.js';

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

test('package mass remains unknown across totals and buyer comparisons while price uses native units', () => {
  const packageLine = line('package', STEM_A, SUPPLIER_A, 12, 600, 500, { Quantity__c: 15, Product__r: { Name: 'Lubricant', Family: 'Lubricants', QuantityUnitOfMeasure: 'PAIL' }, Price_Per_Unit__c: 50 });
  const result = buildDashboardAccountInsight(dataset({ lineItems: [packageLine, line('other', STEM_A, SUPPLIER_B, 40, 400, 300)], previousStems: [stem(STEM_B)], previousLineItems: [line('prev', STEM_B, SUPPLIER_A, 10, 100, 80)] }), { today: '2026-08-05' });
  const row = result.exportRows[0];
  assert.equal(row.volumeMt, null);
  assert.equal(row.orderedVolumeMt, null);
  assert.equal(row.deliveredVolumeMt, null);
  assert.equal(row.quantityVarianceMt, null);
  assert.equal(result.kpis.totalVolumeMt, null);
  assert.equal(result.kpis.underDeliveryRatePct, null);
  assert.equal(result.kpis.trend[0].volumeMt, null);
  assert.equal(result.comparisons.volumePct, null);
  assert.equal(result.kpis.missingVolumeStemCount, 1);
  assert.match(result.warnings[0], /Metric tonnes are unavailable/);
  assert.equal(row.products[0].nativeQuantity, 12);
  assert.equal(result.kpis.averagePrices.find((price) => price.product === 'Lubricant').averageSellPrice, 50);
});

test('supplier scope excludes other supplier packages and explicit zero mass stays known', () => {
  const packageLine = line('package', STEM_A, SUPPLIER_A, 12, 600, 500, { Quantity__c: 15, Product__r: { Name: 'Lubricant', Family: 'Lubricants', QuantityUnitOfMeasure: 'PAILS' } });
  const other = line('other', STEM_A, SUPPLIER_B, 40, 400, 300);
  const supplier = buildDashboardAccountInsight(dataset({ identity: { accountId: SUPPLIER_B, name: 'Supplier', clKey: 'SUP-B' }, role: 'supplier', availableRoles: ['supplier'], scopeAccounts: [{ accountId: SUPPLIER_B, name: 'Supplier', root: true }], lineItems: [packageLine, other] }), { today: '2026-08-05' });
  assert.equal(supplier.kpis.totalVolumeMt, 40);
  const zero = buildDashboardAccountInsight(dataset({ lineItems: [{ ...packageLine, Quantity_in_MT__c: 0 }] }), { today: '2026-08-05' });
  assert.equal(zero.kpis.totalVolumeMt, 0);
  assert.equal(zero.kpis.missingVolumeStemCount, 0);
  assert.equal(zero.exportRows[0].quantityVarianceMt, 0);
});

test('package mass warnings and unavailable values survive CSV and PDF exports', () => {
  const packageLine = line('package', STEM_A, SUPPLIER_A, 12, 600, 500, { Product__r: { Name: 'Lubricant', Family: 'Lubricants', QuantityUnitOfMeasure: 'PAIL' } });
  const result = buildDashboardAccountInsight(dataset({ lineItems: [packageLine] }), { today: '2026-08-05' });
  const csv = generateDashboardAccountInsightExport(result, { format: 'csv', today: '2026-08-05' }).buffer.toString('utf8');
  assert.match(csv, /Lubricants,Unavailable,/);
  assert.match(csv, /Metric tonnes are unavailable for 1 STEM/);
  const pdf = generateDashboardAccountInsightExport(result, { format: 'pdf', today: '2026-08-05' }).buffer.toString('latin1');
  assert.match(pdf, /Metric tonnes are unavailable for 1 STEM/);
});

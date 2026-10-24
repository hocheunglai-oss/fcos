import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { activeStemLineItems, visibleStemBuyerBrokers } from '../src/lib/stemLineVisibility.js';
import { nativeFinancialQuantity, financialQuantityValue } from '../api/_financialQuantity.js';
import { assertStemReadRequest } from '../shared/salesforceReadRequest.js';

const source = readFileSync(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
const stemId = 'a0H000000000001AAA';
const brokerId = '001000000000001AAA';
const secondaryId = '001000000000002AAA';
const line = (id, extra = {}) => ({
  Id: id, STEM__c: stemId, Name: id, Cancelled__c: false,
  Product__r: { Name: 'Active product', Family: 'Fuel' }, Quantity__c: 10,
  Unit_of_Measure__c: 'MT', Buyer_Broker__c: brokerId,
  Buyers_Brokers_Commission_Per_Unit__c: 2, Commission_Cost__c: 25, ...extra,
});
const actualFunction = (start, end, dependencies, name = start.match(/function (\w+)/)[1]) => vm.runInNewContext(
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))) + `\n${name}`,
  dependencies,
);

async function register(lines, { delivered = false } = {}) {
  const before = JSON.stringify(lines);
  const handler = actualFunction('function uniquePresentValues(', '\nasync function salesforceBrokerRegisterFull(', {
    activeStemLineItems, nativeFinancialQuantity,
    chunkIds: (ids) => ids.length ? [ids] : [],
    salesforceObjectFields: async () => ({ fields: [] }), findDashboardUomField: () => null,
    interofficeStemAccessCondition: async () => '',
    queryRows: async () => [{ Id: stemId, Name: 'HK2627141T fixture', Delivery_Date__c: delivered ? '2026-10-01' : null }],
    compositeQueryRows: async (specs) => specs.map(({ soql }) => {
      if (soql.includes('FROM STEM_Line_Item__c')) return lines;
      if (soql.includes('FROM STEM_Buyer_Broker__c')) return [{ Id: 'secondary-header', STEM__c: stemId, Buyer_Broker__c: secondaryId }];
      if (soql.includes('FROM Account')) return [{ Id: brokerId, Name: 'Primary broker' }, { Id: secondaryId, Name: 'Secondary broker' }];
      return [];
    }),
    paymentDataReliabilityState: () => ({ reliable: false }),
    paymentDataReliabilityMetadata: (excluded, included) => ({ excluded, included }),
    LEGACY_PAYMENT_DATA_LABEL: 'Historical payment data',
    brokerAmount: (rate, qty) => Number(rate || 0) * qty,
    numericValue: (v) => v == null ? null : Number(v), money: String,
    formatQuantityLabel: (qty, unit) => `${qty} ${unit}`, paymentDelayDays: () => null,
  }, 'salesforceBrokerRegisterUncached');
  const result = await handler({ limit: 2000 });
  assert.equal(JSON.stringify(lines), before);
  return JSON.parse(JSON.stringify(result));
}

test('active visibility excludes only explicit cancellation and never mutates source rows', () => {
  const rows = Object.freeze([Object.freeze(line('active')), Object.freeze(line('cancelled', { Cancelled__c: true })),
    Object.freeze({ Id: 'legacy' }), null]);
  assert.deepEqual(activeStemLineItems(rows).map((r) => r.Id), ['active', 'legacy']);
  assert.equal(rows.length, 4);
  assert.deepEqual(activeStemLineItems(null), []);
});

test('broker visibility requires a positive cancelled-child link and preserves active/shared/unlinked headers', () => {
  const cancelled = 'a0L000000000001AAA', active = 'a0L000000000002AAA';
  const brokers = Object.freeze([
    Object.freeze({ Id: 'hidden', Exported__c: true, STEM_Line_Item__r: { Id: cancelled.slice(0, 15) } }),
    Object.freeze({ Id: 'active', STEM_Line_Item__c: active }),
    Object.freeze({ Id: 'shared', Exported__c: true }),
    Object.freeze({ Id: 'unknown-link', STEM_Line_Item__c: 'a0L000000000003AAA' }),
  ]);
  assert.deepEqual(visibleStemBuyerBrokers(brokers, [line(cancelled, { Cancelled__c: true }), line(active)]).map((r) => r.Id),
    ['active', 'shared', 'unknown-link']);
  assert.equal(brokers.length, 4);
});

test('actual register filters cancelled primary and secondary commission before shared-broker grouping', async () => {
  const result = await register([line('active'), line('cancelled', {
    Cancelled__c: true, Quantity__c: 20, Buyers_Brokers_Commission_Per_Unit__c: 3, Commission_Cost__c: 80,
  })]);
  assert.deepEqual(result.rows.map(({ brokerType, commissionAmount, productQuantityLabel }) => ({ brokerType, commissionAmount, productQuantityLabel })), [
    { brokerType: 'Buyer Broker', commissionAmount: 20, productQuantityLabel: 'Fuel - 10 MT' },
    { brokerType: 'Secondary Buyer Broker', commissionAmount: 5, productQuantityLabel: 'Fuel - 10 MT' },
  ]);
});

test('reported four-line cancellation shape produces two visible lines and1140commission, not2280', async () => {
  // Minimal shape from root's2026-10-20 scoped read: cancelled300/80 replaced
  // by active300/80, with900/240 primary lumpsums and no secondary junctions.
  const lines = [true, false].flatMap((cancelled) => [300, 80].map((quantity) => line(`${cancelled}-${quantity}`, {
    Cancelled__c: cancelled, Quantity__c: quantity, Quantity_Delivered_Per_BDN__c: cancelled ? null : quantity,
    Buyers_Brokers_Commission_Per_Unit__c: 3, Buyers_Brokers_Commission_Lumpsum__c: quantity * 3,
    Commission_Cost__c: quantity * 3,
  })));
  assert.equal(activeStemLineItems(lines).length, 2);
  const result = await register(lines, { delivered: true });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].commissionAmount, 1140);
  assert.equal(result.rows[0].bdnQuantity, 380);
});

test('all cancelled supplier, buyer lumpsum and residual-secondary lines emit no commission rows', async () => {
  const result = await register([
    line('cancelled-buyer', { Cancelled__c: true, Buyers_Brokers_Commission_Lumpsum__c: 500, Exported__c: true }),
    line('cancelled-supplier', { Cancelled__c: true, Supplier_Broker__c: brokerId, Suppliers_Brokers_Commission_Per_Unit__c: 9 }),
  ]);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.warnings, []);
});

test('active supplier and buyer quantity/rate/lumpsum rules remain unchanged', async () => {
  const result = await register([line('active', {
    Supplier_Broker__c: brokerId, Suppliers_Brokers_Commission_Per_Unit__c: 4,
    Buyers_Brokers_Commission_Lumpsum__c: 99, Unit_of_Measure__c: 'L',
    Quantity_Delivered_Per_BDN__c: 8,
  })], { delivered: true });
  assert.deepEqual(result.rows.map((r) => [r.brokerType, r.commissionAmount, r.quantityUnit, r.bdnQuantity]), [
    ['Supplier Broker', 32, 'L', 8], ['Buyer Broker', 99, 'L', 8],
  ]);
});

async function detail(lines) {
  const before = JSON.stringify(lines), lookups = [], paymentQueries = [];
  const buyerHeader = { Id: 'unlinked-header', STEM__c: stemId, Buyer_Broker__c: brokerId, Commission_Lumpsum__c: 7, Exported__c: true };
  const handler = actualFunction('async function salesforceStemDetailUncached(', '\nasync function salesforceStemDetailFull(', {
    activeStemLineItems, visibleStemBuyerBrokers, assertStemReadRequest, resolveStemId: async () => stemId,
    sfRequest: async () => ({ Id: stemId, Name: 'History fixture', Delivery_Date__c: '2026-10-01', Total_Invoice_Amount__c: 100 }),
    cleanRecord: (record) => record,
    queryRows: async (soql) => {
      if (soql.includes('FROM STEM_Line_Item__c')) return lines;
      if (soql.includes('FROM STEM_Extra_Cost__c')) return [];
      if (soql.includes('FROM STEM_Buyer_Broker__c')) return [buyerHeader];
      if (soql.includes('FROM Invoice__c')) return [];
      return [];
    },
    isSalesforceId: (id) => typeof id === 'string' && id.length === 18,
    namesByIds: async (object, ids) => { lookups.push({ object, ids }); return Object.fromEntries(ids.map((id) => [id, id])); },
    buildBrokerCommissionGroups: () => ({}),
    paymentDataReliabilityState: () => ({ reliable: true }),
    stemPayableAmountCandidates: () => [100],
    salesforceObjectFields: async () => ({ fields: ['Id', 'Name', 'STEM__c', 'Date__c', 'Amount__c', 'Supplier_Invoice__c'].map((name) => ({ name })) }),
    firstAvailableField: () => 'Date__c', incomingPaymentSupplierInvoiceFields: () => ['Supplier_Invoice__c'],
    incomingPaymentReferenceFields: () => [], incomingPaymentDirectionFields: () => [], selectedFields: () => [],
    chunkIds: (ids) => ids.length ? [ids] : [], escapeSoql: (value) => value,
    compositeQueryRows: async (specs) => specs.map(({ soql }) => {
      paymentQueries.push(soql);
      return [{ Id: 'payment-on-cancelled-line', Supplier_Invoice__c: 'a0I000000000001AAA', Amount__c: 77, Date__c: '2026-10-02' }];
    }),
    incomingPaymentSupplierInvoiceId: (payment) => payment.Supplier_Invoice__c,
    resolveViaQuery: async () => 'Broker', financialQuantity: financialQuantityValue,
    lineSellAmount: (item) => item.Total_Price__c || 0, lineBuyAmount: (item) => item.Total_Cost__c || 0,
    extraSellAmount: () => 0, extraBuyAmount: () => 0,
    isFinalBuyerInvoice: () => false, resolveBuyerFinancialAmount: ({ salesforceAmount }) => ({ amount: salesforceAmount, source: 'Salesforce' }),
    resolvedBuyerInvoiceDueDate: () => null, paymentDataReliabilityMetadata: () => ({}),
  });
  const result = await handler({ stemId });
  assert.equal(JSON.stringify(lines), before);
  return { result: JSON.parse(JSON.stringify(result)), lookups, paymentQueries };
}

test('actual detail hides cancelled line projection while retaining its invoice/payment history and unlinked broker header', async () => {
  const { result, lookups, paymentQueries } = await detail([
    line('cancelled', { Cancelled__c: true, Supplier_Invoice__c: 'a0I000000000001AAA', Total_Cost__c: 77 }),
    line('active', { Supplier_Invoice__c: 'a0I000000000002AAA', Total_Cost__c: 23 }),
  ]);
  assert.deepEqual(result.lineItems.map((item) => item.Id), ['active']);
  assert.deepEqual(Array.from(lookups.find((r) => r.object === 'Supplier_Invoice__c').ids), ['a0I000000000001AAA', 'a0I000000000002AAA']);
  assert.ok(paymentQueries.some((q) => q.includes('a0I000000000001AAA')));
  assert.equal(result.supplierInvoicePayments[0].Id, 'payment-on-cancelled-line');
  assert.equal(result.supplierInvoicePayments[0].Amount__c, 77);
  assert.equal(result.buyerBrokers[0].Id, 'unlinked-header');
  assert.equal(result.buyerBrokers[0].Exported__c, true);
});

test('actual detail cache namespaces prevent reuse of old unfiltered server projections', async () => {
  const namespaces = [];
  const cachedSalesforceValue = async (options) => { namespaces.push(options.namespace); return { value: { marker: 'read-only' } }; };
  const detailFull = actualFunction('async function salesforceStemDetailFull(', '\nfunction uniquePresentValues(', {
    assertStemReadRequest, cachedSalesforceValue, salesforceStemDetailUncached: () => { throw Error('Unexpected loader'); },
  });
  const registerFull = actualFunction('async function salesforceBrokerRegisterFull(', '\nasync function hedgeCapabilities(', {
    cachedSalesforceValue, PAYMENT_DATA_RELIABLE_FROM: '2026-01-01', salesforceBrokerRegisterUncached: () => { throw Error('Unexpected loader'); },
  });
  await detailFull({ stemId }); await registerFull({});
  assert.deepEqual(namespaces, ['salesforce-stem-detail-v3-active-lines', 'salesforce-broker-register-v2-active-lines']);
});

function renderDetail(lines, buyerBrokers = []) {
  const createElement = React.createElement;
  const state = [null, { Id: stemId, Name: 'Fixture STEM', _Payment_Data_Reliable: false }, lines, [], buyerBrokers, [], [], [], [], false, null, {}, false, false, null];
  let index = 0;
  const box = ({ children }) => createElement('div', null, children), empty = () => null;
  const hookReact = { ...React, useState: (initial) => [index < state.length ? state[index++] : initial, () => {}], useEffect: () => {} };
  const actualRequire = createRequire(import.meta.url);
  const stubs = {
    react: hookReact, 'react-router-dom': { Link:box }, '@/components/common/StemContextLinks': { default:empty,__esModule:true }, '@/components/common/DataStatus': { default:empty,__esModule:true }, '@/api/appClient': { appClient: {} }, '@/lib/navigationCachePolicy': { navigationCacheOptions: () => ({}) },
    '@/components/ui/dialog': { Dialog: box, DialogContent: box, DialogHeader: box, DialogTitle: box },
    'date-fns': { format: String }, 'lucide-react': new Proxy({}, { get: () => empty }),
    '@/lib/displayValue': { numericValue: (v) => v == null ? null : Number(v), textValue: (v) => v == null ? '' : String(v) },
    '@/lib/authenticatedDownloadUrl': { useDownloadAuthToken: () => null, withDownloadAuth: (v) => v, documentPreviewKind:()=>null },
    '@/lib/documentSettings': { readDocumentSettings: () => ({}) },
    '@/components/common/PaymentDataReliabilityBadge': { default: empty, __esModule: true },
    '@/components/common/AuthenticatedDocumentPreview': { default: empty, AuthenticatedDocumentPreview:empty,AuthenticatedDocumentDownloadButton:empty,__esModule: true },
    '@/lib/paymentDataReliability': { LEGACY_PAYMENT_DATA_LABEL: 'Historical payment data' },
    '@/lib/stemLineVisibility': { activeStemLineItems, visibleStemBuyerBrokers },
  };
  const module = { exports: {} }, jsx = readFileSync(new URL('../src/components/dashboard/StemDetailModal.jsx', import.meta.url), 'utf8');
  const compiled = transformSync(jsx, { loader: 'jsx', format: 'cjs' }).code;
  vm.runInNewContext(compiled, { module, exports: module.exports, React, require: (name) => stubs[name] || actualRequire(name) });
  return renderToStaticMarkup(createElement(module.exports.default, { stemId, open: true, onClose: () => {} }));
}

test('real detail JSX hides cached cancelled rows/count/primary broker cells and cancelled-only optional columns', () => {
  const html = renderDetail([line('active', { _Product_Name: 'VISIBLE_PRODUCT' }), line('cancelled', {
    Cancelled__c: true, _Product_Name: 'HIDDEN_PRODUCT', _Supplier_Broker_Name: 'HIDDEN_BROKER', BDN_Company__c: 'CANCELLED_BDN',
  })]);
  assert.match(html, /Line Items \(1\)/);
  assert.match(html, /VISIBLE_PRODUCT/);
  assert.doesNotMatch(html, /HIDDEN_PRODUCT|HIDDEN_BROKER|CANCELLED_BDN|BDN Company/);
  assert.doesNotMatch(renderDetail([line('cancelled', { Cancelled__c: true })]), /Line Items \(/);
});

test('real detail JSX hides only explicitly cancelled-linked buyer broker rows and retains exported shared headers', () => {
  const html = renderDetail([line('cancelled', { Cancelled__c: true }), line('active')], [
    { Id: 'linked-cancelled', STEM_Line_Item__r: { Id: 'cancelled' }, _Buyer_Broker_Name: 'HIDDEN_LINKED_BROKER', Exported__c: true, Commission_Lumpsum__c: 50 },
    { Id: 'shared', _Buyer_Broker_Name: 'PRESERVED_SHARED_BROKER', Exported__c: true, Commission_Lumpsum__c: 7 },
  ]);
  assert.match(html, /Buyer Brokers \(1\)/);
  assert.match(html, /PRESERVED_SHARED_BROKER/);
  assert.doesNotMatch(html, /HIDDEN_LINKED_BROKER/);
});

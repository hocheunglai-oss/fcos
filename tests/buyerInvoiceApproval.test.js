import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buyerInvoiceApprovalFields,
  buyerInvoiceApprovalFxFields,
  buyerInvoiceApprovalProjection,
  buyerInvoiceSnapshotComparison,
} from '../api/_buyerInvoiceApproval.js';
import { variableChargeInternals } from '../api/_variableCharges.js';

function invoice(overrides = {}) {
  return {
    Id: 'a102x0000000001AAA', Name: '00001T-INV-1', STEM__c: 'a002x0000000001AAA',
    CurrencyIsoCode: 'USD', Amount__c: 5200, Invoice_Date__c: '2026-08-08',
    Delivery_Date__c: '2026-08-01', Invoice_Due_Date__c: '2026-09-07',
    File__c: 'https://example.test/files/0692x0000000001AAA',
    Proforma__c: false, Deprecated__c: false,
    _buyerInvoiceDocument: { Id: '0692x0000000001AAA', LatestPublishedVersionId: '0682x0000000001AAA' },
    ...overrides,
  };
}

function liveCase(overrides = {}) {
  return {
    stem: { Id: 'a002x0000000001AAA', Account__c: '0012x0000000001AAA', CurrencyIsoCode: 'USD', Payment_Term__c: '30 days' },
    allLineItems: [{
      Id: 'a012x0000000001AAA', Buyer_Invoice__c: 'a102x0000000001AAA', Product__c: '01t2x0000000001AAA',
      Product__r: { Name: 'VLSFO' }, Quantity__c: 10, Quantity_Delivered_Per_BDN__c: 10,
      Quantity_Max__c: 11, Unit_of_Measure__c: 'MT', Unit_Sell_At__c: 520, Total_Price__c: 5200,
      CurrencyIsoCode: 'USD',
    }],
    allExtraCosts: [{
      Id: 'a022x0000000001AAA', Buyer_Invoice__c: 'a102x0000000001AAA', Product2Id__c: '01t2x0000000002AAA',
      Product2Id__r: { Name: 'Agency fee' }, Description__c: 'Port agency', Quantity__c: 1,
      Quantity_Delivered_Per_BDN__c: 1, Quantity_Range_Max__c: 1, Unit_of_Measure__c: 'LS',
      Unit_Price__c: 100, Lumpsum_Price__c: 100, Line_Total__c: 100, CurrencyIsoCode: 'USD',
    }],
    ...overrides,
  };
}

test('buyer invoice JavaScript projection exactly mirrors the Apex field contract', async () => {
  const apex = await readFile(new URL('../force-app/main/default/classes/BuyerInvoiceApprovalService.cls', import.meta.url), 'utf8');
  const expected = {
    invoice: ['Id', 'Name', 'STEM__c', 'CurrencyIsoCode', 'Amount__c', 'Invoice_Date__c', 'Delivery_Date__c', 'Invoice_Due_Date__c', 'File__c'],
    stem: ['Id', 'Account__c', 'CurrencyIsoCode', 'Payment_Term__c'],
    line: ['Id', 'Product__c', 'Product__r.Name', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_Max__c', 'Unit_of_Measure__c', 'Unit_Sell_At__c', 'Total_Price__c', 'CurrencyIsoCode'],
    extra: ['Id', 'Product2Id__c', 'Product2Id__r.Name', 'Description__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_Range_Max__c', 'Unit_of_Measure__c', 'Unit_Price__c', 'Lumpsum_Price__c', 'Line_Total__c', 'CurrencyIsoCode'],
  };
  assert.deepEqual(buyerInvoiceApprovalFields, expected);
  for (const field of Object.values(expected).flat()) assert.match(apex, new RegExp(`'${field.replace(/\./g, '\\.')}'`));
});

test('buyer invoice snapshot comparison accepts an unchanged Apex-compatible projection', () => {
  const currentInvoice = invoice();
  const live = liveCase();
  currentInvoice.Buyer_Charge_Snapshot__c = JSON.stringify(buyerInvoiceApprovalProjection(currentInvoice, live));
  assert.deepEqual(buyerInvoiceSnapshotComparison(currentInvoice, live), { kind: 'snapshot', matches: true });
});

test('invoice source currency is compared even when the workflow objects retain their legacy shape', () => {
  const currentInvoice = invoice();
  const raw = liveCase();
  const separated = variableChargeInternals.separateInvoiceSource({
    stem: raw.stem,
    lineItems: raw.allLineItems,
    extraCosts: raw.allExtraCosts,
    allLineItems: raw.allLineItems,
    allExtraCosts: raw.allExtraCosts,
  });
  currentInvoice.Buyer_Charge_Snapshot__c = JSON.stringify(buyerInvoiceApprovalProjection(currentInvoice, separated));
  assert.equal(buyerInvoiceSnapshotComparison(currentInvoice, separated).matches, true);
  assert.equal(buyerInvoiceSnapshotComparison(currentInvoice, {
    ...separated,
    invoiceSource: {
      ...separated.invoiceSource,
      allLineItems: [{ ...separated.invoiceSource.allLineItems[0], CurrencyIsoCode: 'HKD' }],
    },
  }).matches, false);
});

test('snapshot projection retains null currency keys when an object does not expose CurrencyIsoCode', () => {
  const currentInvoice = invoice({ CurrencyIsoCode: undefined });
  const live = liveCase({
    stem: { ...liveCase().stem, CurrencyIsoCode: undefined },
    allLineItems: [{ ...liveCase().allLineItems[0], CurrencyIsoCode: undefined }],
    allExtraCosts: [{ ...liveCase().allExtraCosts[0], CurrencyIsoCode: undefined }],
  });
  const projection = buyerInvoiceApprovalProjection(currentInvoice, live);
  assert.equal(projection.invoice.CurrencyIsoCode, null);
  assert.equal(projection.stem.CurrencyIsoCode, null);
  assert.equal(projection.lines[0].CurrencyIsoCode, null);
  assert.equal(projection.extras[0].CurrencyIsoCode, null);
  currentInvoice.Buyer_Charge_Snapshot__c = JSON.stringify(projection);
  assert.equal(buyerInvoiceSnapshotComparison(currentInvoice, live).matches, true);
});

test('buyer invoice comparison normalizes Apex row ordering without accepting an unknown schema', () => {
  const currentInvoice = invoice();
  const live = liveCase({
    allLineItems: [
      { ...liveCase().allLineItems[0], Id: 'a012x0000000002AAA' },
      { ...liveCase().allLineItems[0], Id: 'a012x0000000001AAA' },
    ],
    allExtraCosts: [
      { ...liveCase().allExtraCosts[0], Id: 'a022x0000000002AAA' },
      { ...liveCase().allExtraCosts[0], Id: 'a022x0000000001AAA' },
    ],
  });
  const snapshot = buyerInvoiceApprovalProjection(currentInvoice, live);
  currentInvoice.Buyer_Charge_Snapshot__c = JSON.stringify({
    ...snapshot,
    lines: [...snapshot.lines].reverse(),
    extras: [...snapshot.extras].reverse(),
  });
  assert.equal(buyerInvoiceSnapshotComparison(currentInvoice, live).matches, true);
  currentInvoice.Buyer_Charge_Snapshot__c = JSON.stringify({ ...snapshot, extraField: 'not part of v1' });
  assert.equal(buyerInvoiceSnapshotComparison(currentInvoice, live).matches, false);
});

test('buyer invoice snapshot comparison fails closed for changed assignments, active content, PDF, or malformed data', () => {
  const currentInvoice = invoice();
  const live = liveCase();
  currentInvoice.Buyer_Charge_Snapshot__c = JSON.stringify(buyerInvoiceApprovalProjection(currentInvoice, live));
  assert.equal(buyerInvoiceSnapshotComparison(currentInvoice, {
    ...live,
    allLineItems: [{ ...live.allLineItems[0], Unit_Sell_At__c: 521 }],
  }).matches, false);
  assert.equal(buyerInvoiceSnapshotComparison(currentInvoice, { ...live, allLineItems: [] }).matches, false);
  assert.equal(buyerInvoiceSnapshotComparison(currentInvoice, {
    ...live,
    allExtraCosts: [{ ...live.allExtraCosts[0], Buyer_Invoice__c: 'a102x0000000002AAA' }],
  }).matches, false);
  assert.equal(buyerInvoiceSnapshotComparison({
    ...currentInvoice,
    _buyerInvoiceDocument: { ...currentInvoice._buyerInvoiceDocument, LatestPublishedVersionId: '0682x0000000002AAA' },
  }, live).matches, false);
  assert.equal(buyerInvoiceSnapshotComparison({ ...currentInvoice, Buyer_Charge_Snapshot__c: '{not json' }, live).matches, false);
});

test('Trading FX field selections match the Apex document, line and extra-cost contract', async () => {
  const apex = await readFile(new URL('../force-app/main/default/classes/BuyerInvoiceApprovalService.cls', import.meta.url), 'utf8');
  for (const [kind, key] of [['INVOICE', 'invoice'], ['LINE', 'row'], ['EXTRA', 'row']]) {
    const declaration = apex.match(new RegExp('List<String> FX_' + kind + '_FIELDS = new List<String>\\{([^}]+)\\}', 'u'));
    assert.ok(declaration);
    const fields = [...declaration[1].matchAll(/'([^']+)'/gu)].map(match => match[1]);
    assert.deepEqual(fields, buyerInvoiceApprovalFxFields[key]);
  }
  const describe = { fields: [{ name: 'Document_FX_Rate__c' }, { name: 'Document_Unexpected__c' }] };
  assert.equal(variableChargeInternals.optionalTradingFxFields(describe, buyerInvoiceApprovalFxFields.invoice), ', Document_FX_Rate__c');
  assert.equal(variableChargeInternals.optionalTradingFxFields({ fields: [] }, buyerInvoiceApprovalFxFields.invoice), '');
});

test('an Apex FX snapshot retains evidence pairing and rejects missing or changed source fields', () => {
  const ordinary = invoice();
  const live = liveCase();
  const ordinarySnapshot = buyerInvoiceApprovalProjection(ordinary, live);
  const fill = (fields, overrides) => Object.assign(Object.fromEntries(fields.map(field => [field, null])), overrides);
  const document = fill(buyerInvoiceApprovalFxFields.invoice, {
    Document_Currency__c: 'HKD', Document_FX_Rate__c: 7.8, Document_FX_Confirmed_At__c: '2026-08-01T04:05:06.000Z',
  });
  const rowA = fill(buyerInvoiceApprovalFxFields.row, { Sell_Currency__c: 'HKD', Sell_HKD_Unit_Price__c: 780 });
  const rowB = fill(buyerInvoiceApprovalFxFields.row, { Sell_Currency__c: 'HKD', Sell_HKD_Unit_Price__c: 1560 });
  const extra = fill(buyerInvoiceApprovalFxFields.row, {});
  const secondId = 'a012x0000000002AAA';
  const saved = {
    ...ordinarySnapshot,
    lines: [{ ...ordinarySnapshot.lines[0], Id: secondId }, ordinarySnapshot.lines[0]],
    fx: { version: 1, document, lines: [rowB, rowA], extras: [extra] },
  };
  const current = invoice({
    ...document, Document_FX_Confirmed_At__c: '2026-08-01T04:05:06.000+0000',
    Buyer_Charge_Snapshot__c: JSON.stringify(saved),
  });
  const source = {
    ...live,
    allLineItems: [
      { ...live.allLineItems[0], ...rowA },
      { ...live.allLineItems[0], ...rowB, Id: secondId },
      { ...live.allLineItems[0], Id: 'a012x0000000003AAA', Cancelled__c: true },
    ],
    allExtraCosts: [{ ...live.allExtraCosts[0], ...extra }],
  };
  assert.equal(buyerInvoiceSnapshotComparison(current, source).matches, true);
  const missing = { ...current };
  delete missing.Document_FX_Rate__c;
  assert.equal(buyerInvoiceSnapshotComparison(missing, source).matches, false);
  const changed = { ...source, allLineItems: [{ ...source.allLineItems[0], Sell_HKD_Unit_Price__c: 781 }, ...source.allLineItems.slice(1)] };
  assert.equal(buyerInvoiceSnapshotComparison(current, changed).matches, false);
  const malformed = { ...saved, fx: { ...saved.fx, lines: [rowA] } };
  assert.equal(buyerInvoiceSnapshotComparison({ ...current, Buyer_Charge_Snapshot__c: JSON.stringify(malformed) }, source).matches, false);
});

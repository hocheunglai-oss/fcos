import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinancialClassifications, buildXeroAccountingPayload } from '../api/_xeroFinancialSync.js';
import { accountingDecimalCents, accountingProductCents, accountingUnitNumber } from '../api/_xeroAccountingLineCents.js';
import { issuedSupplierWorkflowFixture } from './xeroIssuedSupplierPreservationFixtures.js';

function classify({ header = 10, total = 10, quantity = 2, unit = 5, buyer = false, otherLines = [], configure = () => {} } = {}) {
  const f = issuedSupplierWorkflowFixture();
  Object.assign(f.supplier, { Invoice_Amount__c: header });
  Object.assign(f.child, { Line_Total_Buy__c: total, Quantity_Delivered_Per_BDN__c: quantity, Quantity__c: quantity, Unit_Cost__c: unit });
  for (const [index, line] of otherLines.entries()) f.salesforce.extras.push({ ...f.child, Id: `a04000000000${String(index + 2).padStart(3, '0')}`, ...line });
  if (buyer) {
    Object.assign(f.supplier, { Amount__c: header, Proforma__c: false, Deprecated__c: false,
      STEM__r: { ...f.supplier.STEM__r, Account__c: f.ids.account, Account__r: f.supplier.Supplier__r } });
    f.salesforce.buyers = f.salesforce.suppliers;
    f.salesforce.suppliers = [];
    for (const child of f.salesforce.extras) Object.assign(child, { Buyer_Invoice__c: f.ids.source,
      Supplier_Invoice__c: null, Line_Total__c: child.Line_Total_Buy__c, Unit_Price__c: child.Unit_Cost__c });
    f.stored.productMappings[0].direction = 'buyer';
  }
  f.xero.documents = [];
  configure(f);
  const result = buildFinancialClassifications(f.salesforce, f.xero, f.stored);
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

function eligibleLine(input) {
  const row = classify(input);
  assert.equal(row.action, 'create_draft', JSON.stringify(row.blockers));
  assert.equal(row.status, 'eligible', JSON.stringify(row.blockers));
  assert.ok(row.proposedPayload);
  assert.deepEqual(row.proposedPayload, buildXeroAccountingPayload(row));
  return { row, line: row.proposedPayload.LineItems[0] };
}

test('exact decimal arithmetic rounds half-cent ties on magnitude', () => {
  assert.equal(accountingDecimalCents('596.295'), 59630n);
  assert.equal(accountingDecimalCents('-596.295'), -59630n);
  assert.equal(accountingProductCents('1192.59', '0.5'), 59630n);
  assert.equal(accountingProductCents('1318.333', '0.5'), 65917n);
  assert.equal(accountingProductCents('0.1', '0.1'), 1n);
  assert.equal(accountingUnitNumber('1.00005'), 1.0001);
  assert.equal(accountingUnitNumber('-1.00005'), -1.0001);
});

for (const buyer of [false, true]) {
  const label = buyer ? 'buyer' : 'supplier';
  test(`${label}: M2601025-shaped fractional authoritative child rounds to 596.30`, () => {
    const { row, line } = eligibleLine({ buyer, header: 596.30, total: 596.295, quantity: 1192.59, unit: 0.5 });
    assert.equal(line.Quantity, 1192.59);
    assert.equal(line.UnitAmount, 0.5);
    assert.equal(accountingProductCents(line.Quantity, line.UnitAmount), 59630n);
    assert.equal(row.total, 596.30);
  });

  test(`${label}: M2603033-shaped child remains held against a one-cent-lower header`, () => {
    const row = classify({ buyer, header: 659.16, total: 659.1665, quantity: 1318.333, unit: 0.5 });
    assert.equal(row.status, 'blocked');
    assert.equal(row.proposedPayload, null);
    assert.ok(row.blockers.includes('Detailed Salesforce lines total 659.17, not document amount 659.16.'));
  });

  test(`${label}: explicit 659.16 child overrides a quantity product that rounds to 659.17`, () => {
    const { line } = eligibleLine({ buyer, header: 659.16, total: 659.16, quantity: 1318.333, unit: 0.5 });
    assert.equal(line.Quantity, 1);
    assert.equal(line.UnitAmount, 659.16);
    assert.match(line.Description, /1318\.333 MT/);
  });

  test(`${label}: explicit amount one cent below a half-up product is retained exactly`, () => {
    const { line } = eligibleLine({ buyer, header: 596.29, total: 596.29, quantity: 1192.59, unit: 0.5 });
    assert.equal(line.Quantity, 1);
    assert.equal(line.UnitAmount, 596.29);
  });

  test(`${label}: missing authoritative line total uses exact decimal product`, () => {
    const { line } = eligibleLine({ buyer, header: 596.30, total: null, quantity: 1192.59, unit: 0.5 });
    assert.equal(line.Quantity, 1192.59);
    assert.equal(line.UnitAmount, 0.5);
  });

  test(`${label}: negative credit normalizes the line magnitude before reconciliation`, () => {
    const { row, line } = eligibleLine({ buyer, header: -596.30, total: -596.295, quantity: 1192.59, unit: -0.5 });
    assert.equal(row.xeroType, buyer ? 'ACCRECCREDIT' : 'ACCPAYCREDIT');
    assert.equal(line.Quantity, 1192.59);
    assert.equal(line.UnitAmount, 0.5);
  });
}

for (const [label, quantity, unit, total] of [
  ['quantity', 1.00005, 1000, 1000.05],
  ['unit', 100000, 0.00005, 5],
]) test(`four-decimal ${label} normalization must still represent the authoritative cents`, () => {
  const { line } = eligibleLine({ header: total, total, quantity, unit });
  assert.equal(line.Quantity, 1);
  assert.equal(line.UnitAmount, total);
  assert.ok(line.Description.includes(`${quantity} MT`));
});

test('safe four-decimal normalization preserves quantity when emitted cents remain exact', () => {
  const { line } = eligibleLine({ header: 1, total: 1, quantity: 1.00004, unit: 1 });
  assert.equal(line.Quantity, 1);
  assert.equal(line.UnitAmount, 1);
});

test('header reconciliation sums each rounded emitted line, without binary floating point sums', () => {
  const { row } = eligibleLine({ header: 0.30, total: 0.10, quantity: 1, unit: 0.10,
    otherLines: [{ Line_Total_Buy__c: 0.20, Unit_Cost__c: 0.20 }] });
  assert.deepEqual(row.proposedPayload.LineItems.map((line) => line.UnitAmount), [0.1, 0.2]);
});

test('two half-cent lines reconcile as two rounded line cents, not one rounded aggregate', () => {
  const { row } = eligibleLine({ header: 0.02, total: 0.005, quantity: 1, unit: 0.005,
    otherLines: [{ Line_Total_Buy__c: 0.005, Unit_Cost__c: 0.005 }] });
  assert.equal(row.proposedPayload.LineItems.length, 2);
  const mismatch = classify({ header: 0.01, total: 0.005, quantity: 1, unit: 0.005,
    otherLines: [{ Line_Total_Buy__c: 0.005, Unit_Cost__c: 0.005 }] });
  assert.equal(mismatch.status, 'blocked');
  assert.equal(mismatch.proposedPayload, null);
  assert.ok(mismatch.blockers.includes('Detailed Salesforce lines total 0.02, not document amount 0.01.'));
});

for (const total of [0, NaN, Infinity, 'invalid', true, '1000000000000', '10.0000000000001']) {
  test(`invalid or zero authoritative line ${String(total)} never yields a draft payload`, () => {
    const row = classify({ total });
    assert.equal(row.status, 'blocked');
    assert.equal(row.proposedPayload, null);
    assert.ok(row.lines.every((line) => Number.isFinite(line.quantity) && Number.isFinite(line.unitAmount)));
  });
}

test('existing signed ordinary adjustment lines reconcile with positive lines and retain their sign', () => {
  const { row } = eligibleLine({ header: 10, total: -5, quantity: 1, unit: -5,
    otherLines: [{ Line_Total_Buy__c: 15, Unit_Cost__c: 15 }] });
  assert.deepEqual(row.proposedPayload.LineItems.map((line) => line.UnitAmount), [-5, 15]);
});

test('an ordinary negative line cannot masquerade as a matching positive header', () => {
  const row = classify({ header: 10, total: -10, quantity: 2, unit: -5 });
  assert.equal(row.status, 'blocked');
  assert.equal(row.proposedPayload, null);
  assert.ok(row.blockers.includes('Detailed Salesforce lines total -10.00, not document amount 10.00.'));
});

for (const header of [0, NaN, Infinity, 'invalid', '1000000000000']) {
  test(`invalid or zero header ${String(header)} cannot yield a draft payload`, () => {
    const row = classify({ header });
    assert.equal(row.status, 'blocked');
    assert.equal(row.proposedPayload, null);
  });
}

test('supported upper amount boundary preserves exact cents; larger values fail closed', () => {
  assert.equal(accountingDecimalCents('999999999999.99'), 99999999999999n);
  assert.equal(accountingDecimalCents('999999999999.995'), null);
  assert.equal(accountingProductCents('999999999999.99', '2'), null);
  const { line } = eligibleLine({ header: '999999999999.99', total: '999999999999.99', quantity: 1, unit: null });
  assert.equal(line.Quantity, 1);
  assert.equal(line.UnitAmount, 999999999999.99);
});

function paidHalfCentMatch(change = () => {}) {
  return classify({ header: 596.30, total: 596.295, quantity: 1192.59, unit: 0.5, configure(f) {
    Object.assign(f.candidate, { invoiceNumber: f.supplier.Name, date: f.supplier.Invoice_Date__c,
      dueDate: f.supplier.Invoice_Due_Date__c, status: 'PAID', total: 596.30, amountPaid: 596.30, amountDue: 0 });
    Object.assign(f.candidate.lineItems[0], { Description: 'Historical trustee service', Quantity: 1, UnitAmount: 596.30, LineAmount: 596.30 });
    f.xero.documents = [f.candidate];
    change(f);
  } });
}

test('actual half-cent source matches a uniquely identified PAID 596.30 bill and displays 596.30 on both sides', () => {
  const row = paidHalfCentMatch();
  assert.equal(row.action, 'protected_legacy');
  assert.equal(row.status, 'eligible', JSON.stringify(row.blockers));
  assert.equal(row.proposedPayload, null);
  assert.equal(row.reviewRequired, true);
  assert.equal(row.matchEvidence.basis, 'document_number');
  const detail = row.differences.find((difference) => difference.field === 'detailedLines');
  assert.equal(detail.salesforce[0].lineAmount, 596.30);
  assert.equal(detail.xero[0].lineAmount, 596.30);
});

for (const providedAmount of [true, false]) test(`Xero quantity projection uses decimal half-up with LineAmount ${providedAmount ? 'provided' : 'absent'}`, () => {
  const row = paidHalfCentMatch((f) => {
    Object.assign(f.candidate.lineItems[0], { Quantity: 1192.59, UnitAmount: 0.5 });
    if (!providedAmount) delete f.candidate.lineItems[0].LineAmount;
  });
  assert.equal(row.status, 'eligible', JSON.stringify(row.blockers));
  assert.equal(row.proposedPayload, null);
  const detail = row.differences.find((difference) => difference.field === 'detailedLines');
  assert.equal(detail.salesforce[0].lineAmount, 596.30);
  assert.equal(detail.xero[0].lineAmount, 596.30);
});

for (const [label, change] of [
  ['one-cent different line economics', (f) => Object.assign(f.candidate.lineItems[0], { UnitAmount: 596.29, LineAmount: 596.29 })],
  ['authoritative amount disagrees by one cent with its quantity product', (f) => { f.candidate.lineItems[0].LineAmount = 596.29; }],
  ['quantity product disagrees by one cent with authoritative amount', (f) => { f.candidate.lineItems[0].UnitAmount = 596.29; }],
  ['invalid authoritative amount', (f) => { f.candidate.lineItems[0].LineAmount = 'invalid'; }],
  ['account difference', (f) => { f.candidate.lineItems[0].AccountCode = '51100'; }],
  ['tax treatment difference', (f) => { f.candidate.lineItems[0].TaxType = 'INPUT'; }],
  ['nonzero tax amount', (f) => { f.candidate.lineItems[0].TaxAmount = 0.01; }],
]) test(`decimal-correct protected evidence still holds ${label}`, () => {
  const row = paidHalfCentMatch(change);
  assert.equal(row.action, 'protected_legacy');
  assert.equal(row.status, 'protected');
  assert.equal(row.reviewRequired, false);
  assert.equal(row.proposedPayload, null);
  assert.ok(row.blockers.some((reason) => reason.includes('accounting-line amounts, account codes or tax treatment')));
});

test('decimal equivalence never resolves duplicate invoice identity', () => {
  const row = paidHalfCentMatch((f) => f.xero.documents.push({ ...structuredClone(f.candidate), id: '00000000-0000-4000-8000-000000000099' }));
  assert.equal(row.status, 'blocked');
  assert.equal(row.proposedPayload, null);
  assert.ok(row.blockers.some((reason) => reason.includes('More than one active Xero transaction')));
});

test('decimal equivalence never overrides a currency conflict on the exact invoice', () => {
  const row = paidHalfCentMatch((f) => { f.candidate.currency = 'EUR'; });
  assert.equal(row.status, 'blocked');
  assert.equal(row.proposedPayload, null);
  assert.ok(row.blockers.some((reason) => reason.includes('Xero currency EUR conflicts')));
});

test('protected signed ordinary adjustments keep their sign in accounting equivalence', () => {
  const row = classify({ header: 10, total: -5, quantity: 1, unit: -5,
    otherLines: [{ Line_Total_Buy__c: 15, Unit_Cost__c: 15 }], configure(f) {
      Object.assign(f.candidate, { invoiceNumber: f.supplier.Name, status: 'PAID', total: 10, amountDue: 0, amountPaid: 10,
        lineItems: [
          { Description: 'Historical adjustment', Quantity: 1, UnitAmount: -5, LineAmount: -5, AccountCode: '51106', TaxType: 'NONE' },
          { Description: 'Historical charge', Quantity: 1, UnitAmount: 15, LineAmount: 15, AccountCode: '51106', TaxType: 'NONE' },
        ] });
      f.xero.documents = [f.candidate];
    } });
  assert.equal(row.action, 'protected_legacy');
  assert.equal(row.status, 'eligible', JSON.stringify(row.blockers));
  assert.equal(row.proposedPayload, null);
  const amounts = row.differences.find((difference) => difference.field === 'detailedLines').salesforce.map((line) => line.lineAmount);
  assert.deepEqual(amounts.sort((left, right) => left - right), [-5, 15]);
});

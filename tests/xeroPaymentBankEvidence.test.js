import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRemittanceBankEvidence } from '../api/_xeroPaymentBankEvidence.js';
import { loadSalesforcePayments } from '../api/_xeroFinancialSync.js';

const id = (number) => `a01${String(number).padStart(12, '0')}`;
const parentId = id(1);
const base = { CurrencyIsoCode: 'USD', Account__c: id(100), Date__c: '2026-09-01',
  Is_Deposit__c: false, Is_Volume_Discount__c: false, Commission_Invoice__c: null,
  Supplier_Invoice__c: null, Remittance__c: null, Bank__c: null };
const parent = (changes = {}) => ({ ...base, Id: parentId, RecordType: { DeveloperName: 'Receivable_Remittance' },
  Amount__c: 100, Bank__c: 'UBS', ...changes });
const child = (number, changes = {}) => ({ ...base, Id: id(number), RecordType: { DeveloperName: 'Receivable' },
  Remittance__c: parentId, Amount__c: 50, ...changes });
const family = () => [child(2), child(3)];
const resolve = (payment = child(2), remittance = parent(), siblings = family(), complete = true) =>
  resolveRemittanceBankEvidence(payment, { parent: remittance, siblings, complete });

test('complete positive same-Account cash receipt supplies bank without changing the source payment', () => {
  const payment = child(2);
  const result = resolve(payment);
  assert.equal(payment.Bank__c, null);
  assert.equal(result.payment.Bank__c, 'UBS');
  assert.equal(result.payment._bankEvidence.parentId, parentId);
  assert.equal(result.payment._bankEvidence.siblingCount, 2);
  assert.equal(result.reason, null);
  const reordered = resolve(payment, parent(), family().reverse());
  assert.deepEqual(result.payment._bankEvidence, reordered.payment._bankEvidence);
  const direct = resolve(child(2, { Bank__c: 'DBS' }));
  assert.equal(direct.payment.Bank__c, 'DBS');
  assert.equal(direct.payment._bankEvidence, undefined);
});

test('incomplete or mismatched family identity never supplies a bank', () => {
  const scenarios = [
    [child(2), null, family(), true],
    [child(2), parent(), family(), false],
    [child(2), parent(), [child(3)], true],
    [child(2), parent(), [child(2), child(2)], true],
    [child(2), parent({ Id: id(9) }), family(), true],
    [child(2), parent({ Remittance__c: id(9) }), family(), true],
    [child(2), parent(), [child(2), child(3, { Remittance__c: id(9) })], true],
  ];
  for (const [payment, remittance, siblings, complete] of scenarios) {
    const result = resolve(payment, remittance, siblings, complete);
    assert.equal(result.payment.Bank__c, null);
    assert.ok(result.reason);
    assert.equal(result.payment._bankEvidence, undefined);
  }
});

test('dates, currency, Accounts, named banks and exact cent totals must agree across every allocation', () => {
  const scenarios = [
    [parent({ Date__c: '2026-09-02' }), family()],
    [parent({ CurrencyIsoCode: 'EUR' }), family()],
    [parent({ Account__c: id(101) }), family()],
    [parent(), [child(2), child(3, { Account__c: id(101) })]],
    [parent(), [child(2), child(3, { CurrencyIsoCode: 'EUR' })]],
    [parent(), [child(2), child(3, { Bank__c: 'DBS' })]],
    [parent({ Amount__c: 100.01 }), family()],
    [parent(), [child(2), child(3, { Amount__c: 49.99 })]],
    [parent(), [child(2), child(3, { Amount__c: 50.000000000003 })]],
  ];
  for (const [remittance, siblings] of scenarios) assert.ok(resolve(child(2), remittance, siblings).reason);
});

test('numeric Salesforce scale-two serialization noise resolves while raw values stay in evidence', () => {
  for (const amount of [16382.480000000003, 227519.15999999997, 53756.19999999998, 4055.679999999993]) {
    const payment = child(2, { Amount__c: amount });
    const cash = parent({ Amount__c: amount + 50 });
    const result = resolve(payment, cash, [payment, child(3)]);
    assert.equal(result.reason, null, `amount ${amount} should resolve`);
    assert.equal(result.payment.Amount__c, amount);
    assert.equal(result.payment._bankEvidence.amount, cash.Amount__c);
    const canonical = Number(amount.toFixed(2));
    if (amount !== canonical) {
      const canonicalPayment = child(2, { Amount__c: canonical });
      const canonicalCash = parent({ Amount__c: canonical + 50 });
      const canonicalResult = resolve(canonicalPayment, canonicalCash, [canonicalPayment, child(3)]);
      assert.notEqual(result.payment._bankEvidence.siblingsDigest, canonicalResult.payment._bankEvidence.siblingsDigest);
    }
  }
});

test('cent tolerance excludes material fractions, non-finite numbers and excess numeric error', () => {
  for (const amount of [1.005, 50.000000000003, 1000000.00000003,
    Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
    const payment = child(2, { Amount__c: amount });
    const result = resolve(payment, parent({ Amount__c: 100 }), [payment, child(3)]);
    assert.equal(result.payment.Bank__c, null);
    assert.match(result.reason, /invalid amount/i);
  }
  const mismatched = resolve(child(2), parent({ Amount__c: 100.01 }), family());
  assert.match(mismatched.reason, /total differs/i);
});

test('amount strings require exact positive scale-two decimal text', () => {
  const exact = child(2, { Amount__c: '50.00' });
  assert.equal(resolve(exact, parent({ Amount__c: '100.00' }), [exact, child(3, { Amount__c: '50' })]).reason, null);
  for (const amount of ['50.000', '50.000000000003', '1.005', '0', '-1.00', 'Infinity', '90071992547409.92']) {
    const payment = child(2, { Amount__c: amount });
    assert.ok(resolve(payment, parent(), [payment, child(3)]).reason, `string ${amount} must stay blocked`);
  }
});

test('negative, zero, net-credit, deposit, discount, commission and unsupported children remain blocked', () => {
  const variants = [
    { Amount__c: -50 }, { Amount__c: 0 }, { Amount__c: -0.01 },
    { Is_Deposit__c: true }, { Is_Volume_Discount__c: true },
    { Commission_Invoice__c: id(300) }, { RecordType: { DeveloperName: 'Payable' } },
    { RecordType: { DeveloperName: 'Receivable_Remittance' } }, { Is_Deposit__c: null },
  ];
  for (const variant of variants) assert.ok(resolve(child(2), parent(), [child(2), child(3, variant)]).reason);
  assert.ok(resolve(child(2), parent({ Amount__c: -100 }), family()).reason);
  assert.ok(resolve(child(2), parent({ Is_Deposit__c: true }), family()).reason);
});

test('loader fetches no family for named-bank or noncandidate rows and blocks truncated reads', async () => {
  const safety = { fields: { Payment__c: ['CurrencyIsoCode'] }, singleCurrency: false };
  const direct = child(2, { Bank__c: 'DBS' });
  let calls = 0;
  const loaded = await loadSalesforcePayments('2026-01-01', safety, async () => {
    calls += 1; return { records: [direct], totalSize: 1 };
  });
  assert.equal(calls, 1);
  assert.deepEqual(loaded[0].Bank__c, 'DBS');
  const query = async (soql) => {
    calls += 1;
    if (soql.includes('WHERE (Date__c')) return { records: [child(2)], totalSize: 1 };
    if (soql.includes('WHERE Id IN')) return { records: [parent()], totalSize: 1 };
    return { records: [child(2)], totalSize: 2 };
  };
  const blocked = await loadSalesforcePayments('2026-01-01', safety, query);
  assert.equal(calls, 4);
  assert.equal(blocked[0].Bank__c, null);
  assert.match(blocked[0]._bankEvidenceBlocker, /complete remittance/i);
});

test('loader uses all-sibling query without cutoff and resolves only an exact complete family', async () => {
  const safety = { fields: { Payment__c: ['CurrencyIsoCode'] }, singleCurrency: false };
  const queries = [];
  const rows = await loadSalesforcePayments('2026-01-01', safety, async (soql) => {
    queries.push(soql);
    if (soql.includes('WHERE (Date__c')) return { records: [child(2)], totalSize: 1 };
    if (soql.includes('WHERE Id IN')) return { records: [parent()], totalSize: 1 };
    return { records: family(), totalSize: 2 };
  });
  assert.equal(rows[0].Bank__c, 'UBS');
  assert.match(queries[2], /WHERE Remittance__c IN/);
  assert.doesNotMatch(queries[2], /2026-01-01/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { REMITTANCE_SUMMARY_POLICY, evaluateRemittanceSummary, currentRemittanceSummary, enrichRemittanceSummaries } from '../api/_xeroRemittanceSummary.js';

const short = (number, prefix = 'a0S') => `${prefix}${String(number).padStart(12, '0')}`;
const long = value => {
  let suffix = '';
  for (let block = 0; block < 3; block += 1) {
    let mask = 0;
    for (let bit = 0; bit < 5; bit += 1) if (/[A-Z]/.test(value[block * 5 + bit])) mask |= 1 << bit;
    suffix += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[mask];
  }
  return value + suffix;
};
const base = { Account__c: short(100, '001'), Date__c: '2026-09-27', CurrencyIsoCode: 'USD',
  Is_Deposit__c: false, Is_Volume_Discount__c: false, Commission_Invoice__c: null,
  Supplier_Invoice__c: null, STEM__c: null, Remittance__c: null, Bank__c: null,
  CreatedDate: '2026-09-27T02:00:00.000Z', LastModifiedDate: '2026-09-27T02:00:00.000Z' };
const parent = (changes = {}) => ({ ...base, Id: short(1), Name: 'header',
  RecordType: { DeveloperName: 'Payable_Remittance' }, Amount__c: 100, Bank__c: 'UBS', ...changes });
const child = (number, changes = {}) => ({ ...base, Id: short(number), Name: `allocation-${number}`,
  RecordType: { DeveloperName: 'Payable' }, Remittance__c: short(1), Amount__c: 50,
  Supplier_Invoice__c: short(200 + number, 'a06'), ...changes });
const family = () => [child(2), child(3)];
const evaluate = (p = parent(), children = family(), options = {}) => evaluateRemittanceSummary(p, {
  siblings: children, visiblePayments: [p, ...children], complete: true, headerUnmapped: true, ...options,
});
const assertBlocked = result => {
  assert.equal(result.eligible, false); assert.equal(result.evidence, null); assert.ok(result.blocker);
};
const fields = 'Id, Name, CreatedDate, RecordType.DeveloperName, Account__c, Amount__c, Date__c, Supplier_Invoice__c, STEM__c, Reference__c, Bank__c, Remittance__c, Is_Deposit__c, Is_Volume_Discount__c, Commission_Invoice__c, LastModifiedDate, CurrencyIsoCode';
const result = records => ({ records, totalSize: records.length });
const withCurrency = row => ({ ...row, _currency: { currency: row.CurrencyIsoCode, blockers: [] } });

test('positive exact complete Payable family is informational immutable evidence without a payment payload', () => {
  const p = parent(); const children = family(); const original = structuredClone([p, ...children]);
  const evaluated = evaluate(p, children);
  assert.equal(evaluated.eligible, true); assert.equal(evaluated.blocker, null);
  assert.equal(evaluated.evidence.policyVersion, REMITTANCE_SUMMARY_POLICY);
  assert.equal(evaluated.evidence.totalCents, '10000');
  assert.deepEqual(evaluated.evidence.allocationIds, [short(2), short(3)]);
  assert.equal(Object.isFrozen(evaluated.evidence.source.allocations), true);
  assert.equal(evaluated.proposedPayment, undefined); assert.equal(evaluated.status, undefined);
  assert.deepEqual([p, ...children], original);
  assert.deepEqual(evaluate(p, children.reverse()).evidence, evaluated.evidence);
  assert.deepEqual(currentRemittanceSummary({ ...p, _remittanceSummary: structuredClone(evaluated.evidence) }), evaluated.evidence);
});

test('Receivable requires exact STEM and no supplier invoice, with no inherited child banks', () => {
  const p = parent({ RecordType: { DeveloperName: 'Receivable_Remittance' } });
  const children = family().map(row => ({ ...row, Supplier_Invoice__c: null, STEM__c: short(400, 'a0H'), RecordType: { DeveloperName: 'Receivable' } }));
  assert.equal(evaluate(p, children).eligible, true);
  assert.equal(children[0].Bank__c, null);
  assertBlocked(evaluate(p, [{ ...children[0], STEM__c: null }, children[1]]));
  assertBlocked(evaluate(p, [{ ...children[0], Supplier_Invoice__c: short(201, 'a06') }, children[1]]));
});

test('unknown complete/unmapped flags, empty family and any existing header ownership remain held', () => {
  for (const options of [{ complete: false }, { complete: undefined }, { headerUnmapped: false }, { headerUnmapped: undefined }]) assertBlocked(evaluate(parent(), family(), options));
  assertBlocked(evaluate(parent(), []));
  assertBlocked(evaluateRemittanceSummary(parent(), { siblings: family(), visiblePayments: [parent(), ...family()], complete: true }));
});

test('parent and every child must retain valid dates, currency, Account and explicit supported flags', () => {
  const changes = [{ Account__c: null }, { Account__c: short(100) }, { Date__c: '2026-02-30' }, { Date__c: '2026-09-28' },
    { CurrencyIsoCode: 'usd' }, { CurrencyIsoCode: 'EUR' }, { _currency: { currency: 'EUR', blockers: [] } },
    { _currency: { currency: 'USD', blockers: ['unknown currency'] } }, { _currency: { currency: 'USD', blockers: {} } },
    { Is_Deposit__c: true }, { Is_Deposit__c: undefined }, { Is_Volume_Discount__c: true },
    { Is_Volume_Discount__c: undefined }, { Commission_Invoice__c: short(300) }, { Commission_Invoice__c: undefined }, { IsDeleted: true }];
  for (const change of changes) assertBlocked(evaluate(parent(), [child(2, change), child(3)]));
  for (const change of changes.filter(x => !Object.hasOwn(x, 'Date__c') || x.Date__c === '2026-02-30').filter(x => x.CurrencyIsoCode !== 'EUR')) assertBlocked(evaluate(parent(change), family()));
});

test('nested headers, missing invoice links, mixed types, conflicting banks and nonpositive or fractional amounts remain held', () => {
  for (const change of [{ Remittance__c: short(9) }, { Remittance__c: undefined }, { Bank__c: null }, { Bank__c: 123 },
    { Supplier_Invoice__c: short(200, 'a06') }, { Supplier_Invoice__c: undefined }, { RecordType: { DeveloperName: 'Payable' } }]) assertBlocked(evaluate(parent(change), family()));
  for (const change of [{ Remittance__c: short(9) }, { Remittance__c: null }, { Supplier_Invoice__c: null },
    { RecordType: { DeveloperName: 'Payable_Remittance' } }, { RecordType: { DeveloperName: 'Commission' } },
    { Bank__c: 'DBS' }, { Bank__c: 123 }]) assertBlocked(evaluate(parent(), [child(2, change), child(3)]));
  for (const amount of [0, -1, 50.005, 50.000000000003, Infinity, NaN, '5e1', '50.000', null]) {
    assertBlocked(evaluate(parent(), [child(2, { Amount__c: amount }), child(3)]));
  }
  assertBlocked(evaluate(parent({ Amount__c: 100.01 }), family()));
  assert.equal(evaluate(parent(), [child(2, { Bank__c: ' ubs ' }), child(3)]).eligible, true);
});

test('numeric binary tails may represent source cents but raw amounts remain bound in evidence', () => {
  const p = parent({ Amount__c: 16382.480000000003 });
  const children = [child(2, { Amount__c: 16332.480000000003 }), child(3)];
  const evaluated = evaluate(p, children);
  assert.equal(evaluated.eligible, true); assert.equal(evaluated.evidence.totalCents, '1638248');
  assert.equal(evaluated.evidence.source.parent.Amount__c, p.Amount__c);
  assert.equal(currentRemittanceSummary({ ...p, Amount__c: 16382.48, _remittanceSummary: evaluated.evidence }), null);
});

test('15/18 IDs identify the same exact source but duplicate or invalid canonical IDs fail', () => {
  const p = parent({ Id: long(short(1)), Account__c: long(base.Account__c) });
  const children = family().map(row => ({ ...row, Id: long(row.Id), Remittance__c: p.Id, Account__c: p.Account__c }));
  assert.equal(evaluate(p, children, { visiblePayments: [parent(), ...family()] }).eligible, true);
  assertBlocked(evaluate(parent(), [child(2), { ...child(2), Id: long(short(2)) }]));
  assertBlocked(evaluate(parent(), family(), { visiblePayments: [parent(), ...family(), { ...child(2), Id: long(short(2)) }] }));
  assertBlocked(evaluate(parent({ Id: short(1) + 'ZZZ' }), family()));
});

test('every inventory child and current parent must exist identically in visible scope; no hidden or omitted child', () => {
  assertBlocked(evaluate(parent(), family(), { visiblePayments: [parent(), child(2)] }));
  assertBlocked(evaluate(parent(), family(), { visiblePayments: [parent({ Reference__c: 'changed' }), ...family()] }));
  assertBlocked(evaluate(parent(), family(), { visiblePayments: [parent(), child(2, { LastModifiedDate: '2026-09-28T01:00:00Z' }), child(3)] }));
  assertBlocked(evaluate(parent(), family(), { visiblePayments: [parent(), child(2, { Remittance__c: short(9) }), child(3)] }));
  assertBlocked(evaluate(parent(), family(), { visiblePayments: [parent(), ...family(), child(4)] }));
  assertBlocked(evaluate(parent(), family(), { visiblePayments: [parent({ STEM__c: 'bad' }), ...family()] }));
  assertBlocked(evaluate(parent(), family(), { visiblePayments: [parent({ Remittance__c: undefined }), ...family()] }));
  assertBlocked(evaluate(parent(), family(), { visiblePayments: [parent(), child(2, { STEM__c: 'bad' }), child(3)] }));
});

test('replay rejects changed facts, policy, hashes, missing proof fields and partial/extra source', () => {
  const p = parent(); const proof = evaluate(p).evidence;
  for (const mutate of [x => { x.allocationCount = 1; }, x => { x.allocationIds.pop(); }, x => { x.totalCents = '9999'; },
    x => { x.policyVersion = 'other'; }, x => { x.fingerprint = '0'.repeat(64); }, x => { delete x.source; },
    x => { delete x.source.parent.Remittance__c; }, x => { x.source.allocations.pop(); },
    x => { x.source.allocations[0].Remittance__c = short(9); }, x => { x.source.allocations[0].Amount__c = 49.99; },
    x => { x.extra = true; }]) {
    const changed = structuredClone(proof); mutate(changed);
    assert.equal(currentRemittanceSummary({ ...p, _remittanceSummary: changed }), null);
  }
  for (const change of [{ Account__c: short(101, '001') }, { Remittance__c: short(9) }, { Is_Deposit__c: true },
    { Amount__c: 100.01 }, { Reference__c: 'new reference' }, { STEM__c: 'bad' }, { Supplier_Invoice__c: undefined },
    { _remittanceSummaryBlocker: 'held' }, { LastModifiedDate: '2026-09-28T00:00:00Z' }]) assert.equal(currentRemittanceSummary({ ...p, ...change, _remittanceSummary: proof }), null);
});

test('proof replay survives JSONB object-key ordering while array scope stays exact', () => {
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  const p = parent(); const proof = evaluate(p).evidence;
  assert.deepEqual(currentRemittanceSummary({ ...p, _remittanceSummary: reorder(proof) }), proof);
});

test('async helper accepts actual sfQuery complete shape and does exact all-years queries without touching children', async () => {
  const p = parent(); const children = family(); const visible = [p, ...children]; const requests = [];
  const enriched = await enrichRemittanceSummaries(visible, { fields, withCurrency, querySalesforce: async (query, options) => {
    requests.push({ query, options }); return query.includes('WHERE Remittance__c') ? result(children) : result([p]);
  } });
  assert.equal(requests.length, 2); assert.ok(requests.every(x => !x.query.includes('Date__c >=') && x.options.limit === 100000));
  assert.ok(currentRemittanceSummary(enriched[0]));
  assert.equal(enriched[1], children[0]); assert.equal(enriched[2], children[1]);
  assert.equal(children[0].Bank__c, null); assert.equal(p._remittanceSummary, undefined);
});

test('async helper rejects truncation, error, missing totals, continuation and unscoped/duplicate provider results', async () => {
  const p = parent(); const children = family(); const variants = [
    { ...result(children), done: false }, { ...result(children), nextRecordsUrl: '/next' },
    { ...result(children), totalSize: 3 }, { records: children }, { ...result(children), totalSize: '2' },
    { ...result(children), error: 'failed' }, result([child(2), child(2)]), result([child(2), child(3, { Remittance__c: short(9) })]),
  ];
  for (const bad of variants) {
    const enriched = await enrichRemittanceSummaries([p, ...children], { fields, withCurrency,
      querySalesforce: async query => query.includes('WHERE Remittance__c') ? bad : result([p]) });
    assert.equal(enriched[0]._remittanceSummary, undefined); assert.ok(enriched[0]._remittanceSummaryBlocker);
    assert.equal(enriched[1], children[0]);
  }
  for (const bad of [result([]), result([p, p]), result([parent({ Id: short(9) })])]) {
    const enriched = await enrichRemittanceSummaries([p, ...children], { fields, withCurrency,
      querySalesforce: async query => query.includes('WHERE Remittance__c') ? result(children) : bad });
    assert.ok(enriched[0]._remittanceSummaryBlocker);
  }
});

test('all 51 visible headers are batched by 50 and a later failed batch discards every stale proof', async () => {
  const parents = Array.from({ length: 51 }, (_, n) => parent({ Id: short(n + 1), Amount__c: 50 }));
  const children = parents.map((p, n) => child(n + 1000, { Remittance__c: p.Id }));
  const requests = [];
  const querySalesforce = async query => {
    requests.push(query); const ids = [...query.matchAll(/'(a0S\d{12})'/g)].map(x => x[1]);
    const rows = query.includes('WHERE Remittance__c') ? children.filter(x => ids.includes(x.Remittance__c)) : parents.filter(x => ids.includes(x.Id));
    return result(rows);
  };
  const enriched = await enrichRemittanceSummaries([...parents, ...children], { fields, withCurrency, querySalesforce });
  assert.equal(requests.length, 4); assert.equal(enriched.filter(currentRemittanceSummary).length, 51);
  assert.equal(requests[0].match(/'a0S/g).length, 50); assert.equal(requests[2].match(/'a0S/g).length, 1);
  const failed = await enrichRemittanceSummaries(enriched, { fields, withCurrency, querySalesforce: async query => {
    if (query.includes(`'${parents[50].Id}'`)) throw Error('network'); return querySalesforce(query);
  } });
  assert.equal(failed.filter(currentRemittanceSummary).length, 0);
  assert.equal(failed.filter(x => x._remittanceSummaryBlocker).length, 51);
});

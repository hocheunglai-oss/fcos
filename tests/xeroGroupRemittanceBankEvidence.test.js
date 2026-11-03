import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUP_REMITTANCE_BANK_POLICY, GROUP_REMITTANCE_BANK_MAX_BYTES,
  resolveGroupRemittanceBankEvidence, validateGroupRemittanceBankEvidence } from '../api/_xeroGroupRemittanceBankEvidence.js';
import { issuedSupplierHash } from '../api/_xeroIssuedSupplierPreservation.js';

const key = (prefix, n) => `${prefix}${String(n).padStart(12, '0')}`;
const clone = value => structuredClone(value);
const longId = value => {
  let suffix = '';
  for (let block = 0; block < 3; block += 1) {
    let mask = 0;
    for (let bit = 0; bit < 5; bit += 1) if (/[A-Z]/.test(value[block * 5 + bit])) mask |= 1 << bit;
    suffix += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[mask];
  }
  return value + suffix;
};
const mapIds = value => Array.isArray(value) ? value.map(mapIds) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapIds(v)]))
  : typeof value === 'string' && /^(?:001|a0S|a0K|a0H)\d{12}$/.test(value) ? longId(value) : value;
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])) : value;

function fixture(count = 2) {
  const groupId = key('001', 1); const parentId = key('a0S', 1);
  const common = { IsDeleted: false, CreatedDate: '2026-01-02T00:00:00Z', LastModifiedDate: '2026-01-02T00:00:01Z',
    Date__c: '2026-01-02', Supplier_Invoice__c: null, Reference__c: null, Is_Deposit__c: false,
    Is_Volume_Discount__c: false, Commission_Invoice__c: null, CurrencyIsoCode: 'USD', _currency: { currency: 'USD', blockers: [] } };
  const parent = { ...clone(common), Id: parentId, Name: 'Group receipt', RecordType: { DeveloperName: 'Receivable_Remittance' },
    Account__c: groupId, Amount__c: count * 50, Bank__c: 'UBS', Remittance__c: null, STEM__c: null };
  const siblings = Array.from({ length: count }, (_, n) => ({ ...clone(common), Id: key('a0S', n + 2), Name: `Allocation ${n + 1}`,
    RecordType: { DeveloperName: 'Receivable' }, Account__c: key('001', n + 2), Amount__c: 50,
    Bank__c: null, Remittance__c: parentId, STEM__c: key('a0H', n + 1) }));
  const account = (Id, Name, type, ParentId, company) => ({ Id, IsDeleted: false, Name,
    RecordType: { DeveloperName: type }, ParentId, Company_Code__c: company, Inactive_Suspended__c: false,
    LastModifiedDate: '2026-01-01T00:00:00Z' });
  const accounts = [account(groupId, 'GROUP - FRATELLI COSULICH', 'Group', null, 'GROUP - FC'),
    ...siblings.map((row, index) => account(row.Account__c, 'FRATELLI COSULICH UNIPESSOAL SA', 'Buyer_Supplier', groupId, `HK DISTINCT ${index}`))];
  const buyerDocumentInventories = siblings.map((row, index) => ({ stemId: row.STEM__c, complete: true, creditFields: ['Is_Credit_Note__c'],
    records: [{ Id: key('a0K', index + 1), IsDeleted: false, Name: `${index + 20000}T-INV-1`, STEM__c: row.STEM__c,
      STEM__r: { Account__c: row.Account__c }, Amount__c: 50, Proforma__c: false, Deprecated__c: false, Is_Credit_Note__c: false,
      CreatedDate: '2025-12-30T00:00:00Z', LastModifiedDate: '2026-01-01T00:00:00Z', Invoice_Date__c: '2025-12-30',
      Invoice_Due_Date__c: '2026-01-13', CurrencyIsoCode: 'USD', _currency: { currency: 'USD', blockers: [] } }] }));
  const options = { parent, siblings, visiblePayments: [parent, ...siblings], accounts, buyerDocumentInventories, complete: true };
  return { payment: siblings[0], options };
}
const evaluate = f => resolveGroupRemittanceBankEvidence(f.payment, f.options);
const rejected = f => { const result = evaluate(f); assert.equal(result.eligible, false); assert.equal(result.derivedBank, null); assert.equal(result.evidence, null); assert.ok(result.blocker); return result; };
const rehash = evidence => { const { fingerprint: _fingerprint, ...basis } = evidence;
  evidence.fingerprint = issuedSupplierHash({ policyVersion: GROUP_REMITTANCE_BANK_POLICY, component: 'evidence', value: basis }); return evidence; };

test('complete direct Group ownership derives source bank without changing or merging raw debtors', () => {
  const f = fixture(); const original = clone(f); const result = evaluate(f);
  assert.equal(result.eligible, true, result.blocker); assert.equal(result.derivedBank, 'UBS'); assert.deepEqual(f, original);
  const proof = result.evidence;
  assert.equal(proof.authority, 'salesforce_recorded_bank'); assert.equal(proof.totalCents, '10000');
  assert.equal(proof.source.allocations[0].Bank__c, null); assert.equal(proof.source.allocations[1].Bank__c, null);
  assert.equal(proof.source.accounts[1].Name, proof.source.accounts[2].Name);
  assert.notEqual(proof.source.accounts[1].Company_Code__c, proof.source.accounts[2].Company_Code__c);
  assert.notEqual(proof.source.allocations[0].Account__c, proof.source.allocations[1].Account__c);
  assert.equal(proof.selectedPaymentId, f.payment.Id); assert.equal(proof.groupAccountId, f.options.parent.Account__c);
  assert.equal(proof.debtorAccountId, f.payment.Account__c); assert.ok(Object.isFrozen(proof.source.accounts[0]));
  assert.deepEqual(validateGroupRemittanceBankEvidence(f.payment, proof), result);
});

test('valid 15/18 IDs, collection order and JSONB object-key order produce the same bounded proof', () => {
  const f = fixture(); const first = evaluate(f);
  const extended = mapIds(f); extended.options.siblings.reverse(); extended.options.accounts.reverse(); extended.options.buyerDocumentInventories.reverse();
  const second = evaluate(extended); assert.equal(second.eligible, true, second.blocker); assert.deepEqual(first.evidence, second.evidence);
  const jsonb = reverseKeys(JSON.parse(JSON.stringify(first.evidence)));
  assert.deepEqual(validateGroupRemittanceBankEvidence(extended.payment, jsonb).evidence, first.evidence);
  const selectedSecond = resolveGroupRemittanceBankEvidence(f.options.siblings[1], f.options);
  assert.equal(selectedSecond.evidence.familyFingerprint, first.evidence.familyFingerprint);
  assert.notEqual(selectedSecond.evidence.fingerprint, first.evidence.fingerprint);
});

const sourceCases = [
  ['unknown completeness', f => { f.options.complete = false; }],
  ['fabricated database authority', f => { f.options.headerUnmapped = true; }],
  ['absent selected deletion', f => { delete f.payment.IsDeleted; }],
  ['deleted sibling', f => { f.options.siblings[1].IsDeleted = true; }],
  ['unknown sibling deletion', f => { f.options.siblings[1].IsDeleted = null; }],
  ['negative sibling', f => { f.options.siblings[1].Amount__c = -50; }],
  ['zero sibling', f => { f.options.siblings[1].Amount__c = 0; }],
  ['deposit sibling', f => { f.options.siblings[1].Is_Deposit__c = true; }],
  ['unknown deposit', f => { delete f.options.siblings[1].Is_Deposit__c; }],
  ['discount sibling', f => { f.options.siblings[1].Is_Volume_Discount__c = true; }],
  ['commission sibling', f => { f.options.siblings[1].Commission_Invoice__c = key('a0K', 99); }],
  ['unknown commission', f => { delete f.options.parent.Commission_Invoice__c; }],
  ['supplier allocation', f => { f.options.siblings[1].Supplier_Invoice__c = key('a06', 1); }],
  ['wrong child type', f => { f.options.siblings[1].RecordType.DeveloperName = 'Receivable_Remittance'; }],
  ['wrong parent type', f => { f.options.parent.RecordType.DeveloperName = 'Receivable'; }],
  ['nested parent', f => { f.options.parent.Remittance__c = key('a0S', 999); }],
  ['wrong child parent', f => { f.options.siblings[1].Remittance__c = key('a0S', 999); }],
  ['absent STEM', f => { f.options.siblings[1].STEM__c = null; }],
  ['wrong STEM type', f => { f.options.siblings[1].STEM__c = key('001', 999); }],
  ['wrong Account type', f => { f.payment.Account__c = key('a0H', 999); }],
  ['bad checksum', f => { f.payment.Id += 'BAD'; }],
  ['invalid real date', f => { f.options.parent.Date__c = '2026-02-30'; }],
  ['different child date', f => { f.options.siblings[1].Date__c = '2026-01-03'; }],
  ['non USD parent', f => { f.options.parent.CurrencyIsoCode = 'EUR'; }],
  ['missing currency authority', f => { delete f.options.parent._currency; }],
  ['malformed currency blockers', f => { f.options.siblings[1]._currency.blockers = {}; }],
  ['blocked currency', f => { f.options.siblings[1]._currency.blockers = ['Unknown']; }],
  ['bank conflict', f => { f.options.siblings[1].Bank__c = 'DBS'; }],
  ['selected direct bank', f => { f.payment.Bank__c = 'UBS'; }],
  ['missing parent bank', f => { f.options.parent.Bank__c = null; }],
  ['nonstring bank', f => { f.options.parent.Bank__c = {}; }],
  ['control in bank', f => { f.options.parent.Bank__c = 'UBS\n'; }],
  ['one cent header difference', f => { f.options.parent.Amount__c += .01; }],
  ['duplicate child', f => { f.options.siblings.push(clone(f.payment)); }],
  ['duplicate visible canonical ID', f => { f.options.visiblePayments.push({ ...f.payment, Id: longId(f.payment.Id) }); }],
  ['hidden current child', f => { f.options.visiblePayments.push({ ...clone(f.payment), Id: key('a0S', 999) }); }],
  ['missing visible selected child', f => { f.options.visiblePayments = f.options.visiblePayments.filter(row => row.Id !== f.payment.Id); }],
  ['visible raw drift', f => { f.options.visiblePayments = clone(f.options.visiblePayments); f.options.visiblePayments[2].Reference__c = 'changed'; }],
  ['selected raw drift', f => { f.payment = { ...f.payment, Reference__c: 'changed' }; }],
];
for (const [name, change] of sourceCases) test(`whole-family source proof rejects ${name}`, () => { const f = fixture(); change(f); rejected(f); });

test('complete all-years parent and siblings outside the visible window remain bound without fabricated visibility', () => {
  for (const omitted of ['parent', 'sibling', 'both']) {
    const f = fixture(); const completeProof = evaluate(f).evidence;
    const hidden = new Set([
      ...(omitted !== 'sibling' ? [f.options.parent.Id] : []),
      ...(omitted !== 'parent' ? [f.options.siblings[1].Id] : []),
    ]);
    f.options.visiblePayments = f.options.visiblePayments.filter(row => !hidden.has(row.Id));
    const visibleBefore = clone(f.options.visiblePayments); const result = evaluate(f);
    assert.equal(result.eligible, true, `${omitted}: ${result.blocker}`);
    assert.deepEqual(result.evidence, completeProof);
    assert.deepEqual(f.options.visiblePayments, visibleBefore);
    assert.equal(result.evidence.source.allocations.length, 2);
    assert.equal(validateGroupRemittanceBankEvidence(f.payment, result.evidence).eligible, true);
  }
});

test('nonvisible family members still undergo complete amount, flag, membership and invoice checks', () => {
  for (const change of [
    f => { f.options.parent.Amount__c = 100.01; },
    f => { f.options.siblings[1].Amount__c = -50; },
    f => { f.options.siblings[1].Is_Deposit__c = true; },
    f => { f.options.accounts[2].ParentId = key('001', 999); },
    f => { f.options.buyerDocumentInventories[1].records[0].Name = '20001T-CN-1'; },
  ]) {
    const f = fixture(); f.options.visiblePayments = [f.payment]; change(f); rejected(f);
  }
});

test('every visible family overlap must agree, including historical parent and nonselected sibling facts', () => {
  for (const index of [0, 1, 2]) {
    const f = fixture(); f.options.visiblePayments = clone(f.options.visiblePayments);
    f.options.visiblePayments[index].Reference__c = 'conflicting current observation';
    assert.match(rejected(f).blocker, /visible family row differs/);
  }
});

const ownershipCases = [
  ['Group name without Group type', f => { f.options.accounts[0].RecordType.DeveloperName = 'Buyer'; }],
  ['inactive Group', f => { f.options.accounts[0].Inactive_Suspended__c = true; }],
  ['unknown Group state', f => { delete f.options.accounts[0].Inactive_Suspended__c; }],
  ['deleted debtor', f => { f.options.accounts[1].IsDeleted = true; }],
  ['unknown debtor deletion', f => { delete f.options.accounts[1].IsDeleted; }],
  ['inactive debtor', f => { f.options.accounts[1].Inactive_Suspended__c = true; }],
  ['supplier-only debtor', f => { f.options.accounts[1].RecordType.DeveloperName = 'Supplier'; }],
  ['Group as debtor', f => { f.options.accounts[1].RecordType.DeveloperName = 'Group'; }],
  ['missing direct membership', f => { f.options.accounts[1].ParentId = null; }],
  ['transitive-only membership', f => { f.options.accounts[1].ParentId = f.options.accounts[2].Id; }],
  ['malformed parent ID', f => { f.options.accounts[1].ParentId += 'BAD'; }],
  ['missing Account', f => { f.options.accounts.pop(); }],
  ['unrelated extra Account', f => { f.options.accounts.push({ ...clone(f.options.accounts[1]), Id: key('001', 999) }); }],
  ['duplicate canonical Account', f => { f.options.accounts[1].Id = longId(f.options.accounts[2].Id); }],
  ['missing invoice inventory', f => { f.options.buyerDocumentInventories.pop(); }],
  ['incomplete invoice inventory', f => { f.options.buyerDocumentInventories[0].complete = false; }],
  ['unknown schema credit field', f => { f.options.buyerDocumentInventories[0].creditFields = ['Unknown']; }],
  ['duplicate schema field', f => { f.options.buyerDocumentInventories[0].creditFields.push('Is_Credit_Note__c'); }],
  ['missing captured credit flag', f => { delete f.options.buyerDocumentInventories[0].records[0].Is_Credit_Note__c; }],
  ['null/unknown flag representation', f => { f.options.buyerDocumentInventories[0].records[0].Is_Credit_Note__c = 'false'; }],
  ['explicit credit', f => { f.options.buyerDocumentInventories[0].records[0].Is_Credit_Note__c = true; }],
  ['unlisted but supplied credit', f => { f.options.buyerDocumentInventories[0].records[0].CreditNote__c = true; }],
  ['CN literal name', f => { f.options.buyerDocumentInventories[0].records[0].Name = '20001T-CN-1'; }],
  ['deleted invoice', f => { f.options.buyerDocumentInventories[0].records[0].IsDeleted = true; }],
  ['unknown invoice deletion', f => { delete f.options.buyerDocumentInventories[0].records[0].IsDeleted; }],
  ['different invoice owner', f => { f.options.buyerDocumentInventories[0].records[0].STEM__r.Account__c = f.options.accounts[2].Id; }],
  ['different invoice STEM', f => { f.options.buyerDocumentInventories[0].records[0].STEM__c = key('a0H', 999); }],
  ['proforma-only inventory', f => { f.options.buyerDocumentInventories[0].records[0].Proforma__c = true; }],
  ['deprecated-only inventory', f => { f.options.buyerDocumentInventories[0].records[0].Deprecated__c = true; }],
  ['unknown proforma', f => { delete f.options.buyerDocumentInventories[0].records[0].Proforma__c; }],
  ['negative invoice', f => { f.options.buyerDocumentInventories[0].records[0].Amount__c = -50; }],
  ['non USD invoice', f => { f.options.buyerDocumentInventories[0].records[0]._currency.currency = 'EUR'; }],
  ['duplicate invoice claims', f => { const inv = f.options.buyerDocumentInventories[0]; inv.records.push({ ...clone(inv.records[0]), Id: key('a0K', 999) }); }],
  ['hidden deprecated credit', f => { const inv = f.options.buyerDocumentInventories[0]; inv.records.push({ ...clone(inv.records[0]), Id: key('a0K', 999), Name: '20000T-CN-1', Deprecated__c: true }); }],
  ['duplicate inventory', f => { f.options.buyerDocumentInventories.push(clone(f.options.buyerDocumentInventories[0])); }],
];
for (const [name, change] of ownershipCases) test(`current ownership proof rejects ${name}`, () => { const f = fixture(); change(f); rejected(f); });

test('known absent schema credit flags remain literal absence; old proforma facts remain bound', () => {
  const f = fixture(); const inv = f.options.buyerDocumentInventories[0]; inv.creditFields = []; delete inv.records[0].Is_Credit_Note__c;
  inv.records.push({ ...clone(inv.records[0]), Id: key('a0K', 999), Name: 'Old proforma', Proforma__c: true });
  const result = evaluate(f); assert.equal(result.eligible, true, result.blocker); assert.equal(result.evidence.source.buyerDocumentInventories[0].records.length, 2);
  assert.equal(Object.hasOwn(result.evidence.source.buyerDocumentInventories[0].records[0], 'Is_Credit_Note__c'), false);
});

test('distinct invoice per allocation rejects repeated same-STEM allocation despite exact total', () => {
  const f = fixture(); f.options.siblings[1].STEM__c = f.payment.STEM__c; f.options.siblings[1].Account__c = f.payment.Account__c;
  f.options.accounts.pop(); f.options.buyerDocumentInventories.pop(); assert.match(rejected(f).blocker, /same source invoice/);
});

test('partial invoice amount is not confused with family cash total or settlement authority', () => {
  const f = fixture(); f.options.buyerDocumentInventories[0].records[0].Amount__c = 100;
  const result = evaluate(f); assert.equal(result.eligible, true, result.blocker);
  assert.equal(result.evidence.source.allocations[0].Amount__c, 50);
  assert.equal(result.evidence.source.buyerDocumentInventories[0].records[0].Amount__c, 100);
  assert.equal(Object.hasOwn(result, 'proposedPayment'), false);
});

test('strict scale-two arithmetic retains only existing bounded numeric noise allowance', () => {
  for (const amount of [16382.480000000003, 227519.15999999997, 53756.19999999998, 4055.679999999993, '50.00']) {
    const f = fixture(); f.payment.Amount__c = amount; f.options.parent.Amount__c = Number(amount) + 50;
    const result = evaluate(f); assert.equal(result.eligible, true, `${amount}: ${result.blocker}`);
    assert.equal(result.evidence.source.allocations[0].Amount__c, amount);
  }
  for (const amount of [1.005, 50.000000000003, 1000000.00000003, Infinity, NaN, '50.000', '5e1', '-1', '0', '90071992547409.92']) {
    const f = fixture(); f.payment.Amount__c = amount; rejected(f);
  }
});

test('embedded validator rejects nulls, unknown authority, material tampering and stripped fields even with a new outer hash', () => {
  const f = fixture(); const proof = evaluate(f).evidence;
  for (const invalid of [null, [], {}, { ...clone(proof), policyVersion: 'unknown' }, { ...clone(proof), authority: 'legal_payer' },
    { ...clone(proof), approved: true }, { ...clone(proof), fingerprint: '0'.repeat(64) }]) {
    assert.equal(validateGroupRemittanceBankEvidence(f.payment, invalid).eligible, false);
  }
  const changes = [p => { p.totalCents = '10001'; }, p => { p.derivedBank = 'UBS'; }, p => { p.source.parent = null; },
    p => { p.source.allocations[1] = null; }, p => { p.source.accounts[1].ParentId = key('001', 999); },
    p => { p.source.buyerDocumentInventories[0].records[0].Is_Credit_Note__c = true; },
    p => { delete p.source.allocations[0].IsDeleted; }, p => { p.source.allocations[0].extraAuthority = true; },
    p => { p.source.accounts[0].Inactive_Suspended__c = null; }, p => { p.source.allocations[0].Amount__c = 49.99; },
    p => { p.source.buyerDocumentInventories[0].complete = false; }, p => { p.source.buyerDocumentInventories[0].extra = true; }];
  for (const change of changes) { const altered = clone(proof); change(altered); rehash(altered);
    assert.equal(validateGroupRemittanceBankEvidence(f.payment, altered).eligible, false); }
  assert.equal(validateGroupRemittanceBankEvidence({ ...f.payment, Reference__c: 'new' }, proof).eligible, false);
  assert.equal(validateGroupRemittanceBankEvidence({ ...f.payment, Bank__c: 'UBS' }, proof).eligible, false);
});

test('fresh independent family or ownership changes produce a different proof, without invented historical validity', () => {
  const f = fixture(); const before = evaluate(f).evidence;
  f.options.accounts[1].Company_Code__c = 'HK UPDATED';
  const after = evaluate(f).evidence; assert.notEqual(after.fingerprint, before.fingerprint);
  assert.notEqual(after.membershipFingerprint, before.membershipFingerprint);
  // A self-consistent saved proof is an immutable receipt, not a fresh provider read.
  assert.equal(validateGroupRemittanceBankEvidence(f.payment, before).eligible, true);
  assert.notEqual(after.fingerprint, validateGroupRemittanceBankEvidence(f.payment, before).evidence.fingerprint);
});

test('UTF-8 proof bound includes full family and rejects oversize instead of omitting children', () => {
  const small = fixture(16); const first = evaluate(small); assert.equal(first.eligible, true, first.blocker);
  const large = fixture(16);
  for (const row of large.options.accounts) row.Name = '海'.repeat(1000);
  assert.match(rejected(large).blocker, /UTF-8 size/);
  const proof = clone(first.evidence); proof.source.accounts[0].Name = '海'.repeat(GROUP_REMITTANCE_BANK_MAX_BYTES);
  assert.equal(validateGroupRemittanceBankEvidence(small.payment, proof).eligible, false);
});

test('malformed arrays and inputs fail closed without throwing', () => {
  for (const input of [null, undefined, [], {}, 1]) assert.doesNotThrow(() => {
    assert.equal(resolveGroupRemittanceBankEvidence(input, input).eligible, false);
    assert.equal(validateGroupRemittanceBankEvidence(input, input).eligible, false);
  });
  for (const name of ['siblings', 'visiblePayments', 'accounts', 'buyerDocumentInventories']) {
    for (const value of [null, {}, [], [null]]) { const f = fixture(); f.options[name] = value; rejected(f); }
  }
});

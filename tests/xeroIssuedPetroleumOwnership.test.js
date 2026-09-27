import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePetroleumOwnership, bindPetroleumOwnership, validatePetroleumOwnership, currentPetroleumOwnershipMatches,
  PETROLEUM_OWNERSHIP_POLICY, petroleumOwnershipFingerprint } from '../api/_xeroIssuedPetroleumOwnership.js';
import { issuedPetroleumFixture, issuedPetroleumOwnerFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';

const input = f => ({ tenantId: f.ids.tenant, accountId: f.ids.account, contactId: f.ids.contact,
  accounts: f.salesforce.groupedAccountSnapshot.accounts, contacts: f.xero.contacts, complete: true });
const uuid = '11111111-1111-4111-8111-111111111111';

test('legacy singleton receipt is byte-equivalent while the new proof retains every inactive owner', () => {
  const legacy = issuedPetroleumFixture().build();
  assert.equal(legacy.fingerprint, '5f83badf83d013bf405999b4022980f57838a6a702b258d59633b8ab043136d7');
  assert.equal(legacy.evidenceFingerprint, 'deda29ca0056df4a7eeeb556ce026782570ab87aac375a06b874fc640340cdc8');
  assert.equal(Object.hasOwn(legacy.evidence.accounting, 'identityOwnershipPolicy'), false);
  const f = issuedPetroleumOwnerFixture(); const snapshot = JSON.stringify(input(f));
  const result = f.build(); assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  const a = result.evidence.accounting;
  assert.equal(a.identityOwnershipPolicy, PETROLEUM_OWNERSHIP_POLICY);
  assert.deepEqual(a.identityOwnership.sourceAccountIds, ['001000000000001', '001000000000002']);
  assert.deepEqual(a.identityOwnership.queriedSourceAccountIds, a.identityOwnership.sourceAccountIds);
  assert.equal(a.identityOwnership.owners[1].recordType, 'Buyer');
  assert.equal(validatePetroleumOwnership(a, { ...input(f), coverageFingerprint: a.identityScope.coverageFingerprint }), true);
  assert.equal(currentPetroleumOwnershipMatches(a, input(f)), true);
  assert.equal(JSON.stringify(input(f)), snapshot);
});

for (const [name, change] of [
  ['another active owner', x => { x.accounts[1].inactiveSuspended = false; }],
  ['unknown owner state', x => { delete x.accounts[1].inactiveSuspended; }],
  ['malformed source ID', x => { x.accounts[1].id = '001bad'; }],
  ['bad18character checksum', x => { x.accounts[1].id += 'ZZZ'; }],
  ['duplicate own key', x => { x.accounts[1].companyCode = x.accounts[0].companyCode; }],
  ['duplicate Account', x => { x.accounts.push({ ...x.accounts[0] }); }],
  ['selected inactive', x => { x.accounts[0].inactiveSuspended = true; }],
  ['selected lacks HK key', x => { x.accounts[0].companyCode = 'SINGAPOREEXAMPLE'; }],
  ['duplicate active Contact', x => { x.contacts.push({ ...x.contacts[0], id: uuid }); }],
  ['separate archived owner Contact', x => { x.contacts.push({ ...x.contacts[0], id: uuid, status: 'ARCHIVED' }); }],
  ['alias key claims separate Contact', x => { x.contacts.push({ id: uuid, name: 'OTHER', status: 'ARCHIVED', contactNumber: x.accounts[1].companyCode }); }],
  ['explicit inactive owner ID', x => { x.contacts[0].contactNumber = x.accounts[1].id; }],
  ['explicit missing foreign ID', x => { x.contacts[0].accountNumber = '001000000000099'; }],
  ['malformed explicit ID', x => { x.contacts[0].accountNumber = '001invalid'; }],
  ['padded foreign explicit ID', x => { x.contacts[0].accountNumber = ' 001000000000099 '; }],
  ['padded selected explicit ID', x => { x.contacts[0].accountNumber = ' 001000000000001 '; }],
  ['explicit inactive owner key', x => { x.contacts[0].accountNumber = x.accounts[1].companyCode; }],
  ['explicit other global Account key', x => { x.accounts.push({ ...x.accounts[1], id: '001000000000003', name: 'OTHER', companyCode: 'HKOTHER' }); x.contacts[0].accountNumber = 'HKOTHER'; }],
  ['missing complete scope', x => { x.complete = false; }],
  ['merged target', x => { x.contacts[0].mergedToContactId = uuid; }],
]) test(`document-specific ownership rejects ${name}`, () => {
  const x = input(issuedPetroleumOwnerFixture()); change(x);
  assert.equal(derivePetroleumOwnership(x).eligible, false);
});

test('selected own ID/key and unrelated literal historic number remain unchanged', () => {
  for (const value of ['001000000000001', 'HKEXAMPLE', 'Historical0007']) {
    const x = input(issuedPetroleumOwnerFixture()); x.contacts[0].contactNumber = value;
    const result = derivePetroleumOwnership(x); assert.equal(result.eligible, true, JSON.stringify(result));
    assert.equal(result.contact.contactNumber, value);
  }
});

test('mixed-case Salesforce IDs use deterministic codepoint order, not locale order', () => {
  const x = input(issuedPetroleumOwnerFixture());
  x.accounts.push({ ...x.accounts[1], id: '00100000000000A', companyCode: 'HKOTHERALIAS' });
  x.accounts.push({ ...x.accounts[1], id: '00100000000000a', companyCode: 'HKOTHERALIAS2' });
  const result = derivePetroleumOwnership(x); assert.equal(result.eligible, true);
  const bound = bindPetroleumOwnership(result, { sourceAccountIds: result.sourceAccountIds, contentFingerprint: hash('scope') });
  assert.equal(validatePetroleumOwnership(bound, { ...x, coverageFingerprint: hash('scope') }), true);
});

for (const [name, change] of [
  ['missing policy', a => { delete a.identityOwnershipPolicy; }],
  ['missing proof', a => { delete a.identityOwnership; }],
  ['null policy', a => { a.identityOwnershipPolicy = null; }],
  ['unknown policy', a => { a.identityOwnershipPolicy = 'ignore_aliases'; }],
  ['null proof', a => { a.identityOwnership = null; }],
  ['malformed owners', a => { a.identityOwnership.owners = 'bad'; }],
  ['duplicate owners', a => { a.identityOwnership.owners.push(a.identityOwnership.owners[0]); }],
  ['missing alias coverage', a => { a.identityOwnership.queriedSourceAccountIds.pop(); }],
  ['extra unbound coverage', a => { a.identityOwnership.queriedSourceAccountIds.push('001000000000003'); }],
  ['wrong selected ID', a => { a.identityOwnership.selectedAccountId = '001000000000002'; }],
  ['tampered hash', a => { a.identityOwnership.accountContactFingerprint = hash('wrong'); }],
  ['tampered history', a => { a.identityOwnership.allYearsCoverageFingerprint = hash('wrong'); }],
]) test(`immutable ownership rejects ${name}`, () => {
  const f = issuedPetroleumOwnerFixture(); const a = structuredClone(f.build().evidence.accounting); change(a);
  assert.equal(validatePetroleumOwnership(a, { ...input(f), coverageFingerprint: a.identityScope.coverageFingerprint }), false);
});

test('rehashed owner reactivation cannot bypass independent structural checks', () => {
  const f = issuedPetroleumOwnerFixture(); const a = structuredClone(f.build().evidence.accounting);
  a.identityOwnership.owners[1].inactiveSuspended = false;
  a.identityOwnership.accountContactFingerprint = petroleumOwnershipFingerprint(f.ids.tenant, a.identityOwnership);
  assert.equal(validatePetroleumOwnership(a, { ...input(f), coverageFingerprint: a.identityScope.coverageFingerprint }), false);
});

test('binding requires the exact document owner union, never an unrelated batch union', () => {
  const f = issuedPetroleumOwnerFixture(); const facts = derivePetroleumOwnership(input(f));
  assert.equal(bindPetroleumOwnership(facts, { sourceAccountIds: [...facts.sourceAccountIds, '001000000000003'], contentFingerprint: hash('scope') }), null);
});

test('other archived Contact padded retained-owner IDs remain stronger competing claims', async t => {
  for (const key of ['contactNumber', 'accountNumber']) for (const index of [0, 1]) for (const padding of [' ', '\u00a0']) {
    await t.test(`${key} owner${index} ${padding === ' ' ? 'ASCII' : 'NBSP'}`, () => {
      const x = input(issuedPetroleumOwnerFixture());
      x.contacts.push({ id: uuid, name: 'UNRELATED HISTORICAL NAME', status: 'ARCHIVED', [key]: `${padding}${x.accounts[index].id}${padding}` });
      const result = derivePetroleumOwnership(x);
      assert.equal(result.eligible, false); assert.match(result.blockers[0].message, /another existing Contact/);
    });
  }
});

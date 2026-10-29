import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactRestoration } from '../api/_xeroContactRestorePolicy.js';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const account = { id: '001000000000001', name: 'EXAMPLE SUPPLY LTD', companyCode: 'HKEXAMPLE', recordType: 'Supplier', inactiveSuspended: false };
  const contact = { contactId: uuid(2), name: account.name, status: 'ARCHIVED', contactNumber: '', accountNumber: '', mergedToContactId: null };
  const accounts = [account]; const contacts = [contact];
  const options = { tenantId: uuid(1), accountsComplete: true, contactsComplete: true };
  return { account, contact, accounts, contacts, options, build: () => buildContactRestoration(account, accounts, contacts, options) };
}

test('unique own-name and own-key restoration retains inactive same-name aliases without propagating their keys', () => {
  const f = fixture();
  f.accounts.push({ ...f.account, id: '001000000000002', companyCode: 'HKRETIRED', inactiveSuspended: true });
  const marker = f.build();
  assert.equal(marker.eligible, true); assert.equal(marker.targetContactId, f.contact.contactId);
  assert.equal(marker.collisionEvidence.accounts.length, 2);
  f.contact.name = 'EXAMPLE';
  assert.equal(f.build().eligible, true);
  f.contacts.push({ ...f.contact, contactId: uuid(3), name: 'RETIRED' });
  assert.equal(f.build().eligible, false, 'the inactive alias cannot hide its own alternate Contact');
});

test('already active exact identity has the same review fingerprint but is not offered another restoration', () => {
  const f = fixture(); const before = f.build(); f.contact.status = 'ACTIVE'; const after = f.build();
  assert.equal(after.identityEligible, true); assert.equal(after.eligible, false);
  assert.equal(after.reviewFingerprint, before.reviewFingerprint);
});

test('identity ambiguities, incomplete snapshots and explicit foreign claims fail closed', async (t) => {
  const cases = [
    ['source key missing', (f) => { f.account.companyCode = ''; }],
    ['source key unsupported', (f) => { f.account.companyCode = 'SGEXAMPLE'; }],
    ['inactive source', (f) => { f.account.inactiveSuspended = true; }],
    ['unknown inactive state', (f) => { delete f.account.inactiveSuspended; }],
    ['placeholder', (f) => { f.account.name = 'Unknown'; }],
    ['unsupported source type', (f) => { f.account.recordType = 'Vessel'; }],
    ['duplicate key on inactive alias', (f) => { f.accounts.push({ ...f.account, id: '001000000000002', inactiveSuspended: true }); }],
    ['active same-name owner', (f) => { f.accounts.push({ ...f.account, id: '001000000000002', companyCode: 'HKOTHER' }); }],
    ['two direct Contacts', (f) => { f.contacts.push({ ...f.contact, contactId: uuid(3), name: 'EXAMPLE' }); }],
    ['another active direct Contact', (f) => { f.contacts.push({ ...f.contact, contactId: uuid(3), status: 'ACTIVE' }); }],
    ['number claim on another Contact', (f) => { f.contacts.push({ ...f.contact, contactId: uuid(3), name: 'OTHER', accountNumber: f.account.companyCode }); }],
    ['source ID claim on another Contact', (f) => { f.contacts.push({ ...f.contact, contactId: uuid(3), name: 'OTHER', contactNumber: f.account.id }); }],
    ['target names another Account', (f) => { f.accounts.push({ ...f.account, id: '001000000000002', name: 'OTHER', companyCode: 'HKOTHER', inactiveSuspended: true }); f.contact.accountNumber = 'HKOTHER'; }],
    ['deleted foreign Account number', (f) => { f.contact.accountNumber = '001000000000099'; }],
    ['missing foreign Contact number', (f) => { f.contact.contactNumber = '001000000000099AAA'; }],
    ['merged Contact', (f) => { f.contact.mergedToContactId = uuid(4); }],
    ['unsupported status', (f) => { f.contact.status = 'GDPRREQUEST'; }],
    ['duplicate Account ID', (f) => { f.accounts.push({ ...f.account }); }],
    ['duplicate Contact ID case alias', (f) => { f.contacts.push({ ...f.contact, contactId: f.contact.contactId.toUpperCase() }); }],
    ['Account completeness', (f) => { f.options.accountsComplete = false; }],
    ['Contact completeness', (f) => { f.options.contactsComplete = false; }],
    ['invalid tenant', (f) => { f.options.tenantId = 'invalid'; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const f = fixture(); change(f); const result = f.build();
    assert.equal(result.eligible, false); assert.equal(result.identityEligible, false); assert.ok(result.blockers.length);
  });
  assert.equal(buildContactRestoration(null, null, null).eligible, false);
});

test('own canonical Salesforce IDs and arbitrary historical numbers are preserved', () => {
  for (const value of ['001000000000001', '001000000000001AAA', 'HISTORICAL-987']) {
    const f = fixture(); f.contact.contactNumber = value; f.contact.accountNumber = value;
    assert.equal(f.build().eligible, true, value);
  }
});

test('collision evidence changes invalidate the preview without depending on unrelated Accounts', () => {
  const f = fixture(); const before = f.build();
  f.accounts.push({ ...f.account, id: '001000000000002', name: 'UNRELATED', companyCode: 'HKUNRELATED' });
  assert.equal(f.build().reviewFingerprint, before.reviewFingerprint);
  f.accounts[1].name = f.account.name; f.accounts[1].inactiveSuspended = true;
  assert.equal(f.build().eligible, true); assert.notEqual(f.build().reviewFingerprint, before.reviewFingerprint);
});

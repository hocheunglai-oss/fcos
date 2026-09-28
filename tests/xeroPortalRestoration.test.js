import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContactLifecycleRows, canApplyContactLifecycleRow, invalidateContactNameCacheAfterRestore, summarizeContactLifecycleRows } from '../api/_xeroPortal.js';
import { listXeroContactsComplete, listXeroContactsForRename } from '../api/_xeroContactSync.js';

const tenantId = '10000000-0000-4000-8000-000000000001';
const contactId = '20000000-0000-4000-8000-000000000001';
const account = { id: '001000000000001AAA', name: 'Existing Supplier Ltd', companyCode: 'HKSUPPLIER', recordType: 'Supplier', inactiveSuspended: false };
const contact = { contactId, name: account.name, status: 'ARCHIVED', contactNumber: '', accountNumber: '' };
const options = { tenantId, identityAccounts: [account], identityAccountsComplete: true, contactsComplete: true };

test('eligible archived Contact remains a dedicated exception and cannot enter rename/archive apply', () => {
  const [row] = buildContactLifecycleRows([account], [contact], new Map(), options);
  assert.equal(row.reason, 'archived-only-match');
  assert.equal(row.action, 'exception');
  assert.equal(row.status, 'blocked');
  assert.equal(row.restoration.eligible, true);
  assert.equal(row.restoration.targetContactId, contactId);
  assert.equal(row.xeroContactId, contactId);
  assert.equal(canApplyContactLifecycleRow(row), false);
  assert.equal(summarizeContactLifecycleRows([row], [contact], 1).restoreEligible, 1);
});

test('archived Contact marker fails closed for incomplete or merged identity evidence', () => {
  for (const patch of [{ identityAccountsComplete: false }, { contactsComplete: false }, { identityAccounts: undefined }]) {
    const [row] = buildContactLifecycleRows([account], [contact], new Map(), { ...options, ...patch });
    assert.equal(row.restoration.eligible, false);
    assert.equal(canApplyContactLifecycleRow(row), false);
  }
  const [row] = buildContactLifecycleRows([account], [{ ...contact, mergedToContactId: tenantId }], new Map(), options);
  assert.equal(row.restoration.eligible, false);
});

test('complete Contact reader retains merged status evidence and supports lifecycle balances without a second scan', async () => {
  const raw = { ContactID: contactId, Name: account.name, ContactStatus: 'ARCHIVED', MergedToContactID: tenantId, Balances: { AccountsPayable: { Outstanding: 25 } } };
  const connection = { accessToken: 'fixture-only', tenantId };
  let calls = 0;
  const config = { env: { XERO_CONTACT_SYNC_DELAY_MS: '0' }, fetchImpl: async () => {
    calls += 1; return new Response(JSON.stringify({ Contacts: [raw], pagination: { pageCount: 1, itemCount: 1 } }), { status: 200 });
  } };
  assert.equal((await listXeroContactsForRename(connection, config))[0].mergedToContactId, tenantId);
  const result = await listXeroContactsComplete(connection, { ...config, contactMapper: (row) => ({ balance: row.Balances.AccountsPayable.Outstanding }) });
  assert.deepEqual(result, { contacts: [{ balance: 25 }], xeroCalls: 1, complete: true });
  assert.equal(calls, 2);
});

test('restoration invalidates only the matching tenant cache and reports storage failure', async () => {
  const predicates = [];
  const client = { from(table) { assert.equal(table, 'xero_contact_name_cache'); return { delete() { return this; }, eq(field, value) { predicates.push([field, value]); return this; }, then(resolve) { resolve({ error: null }); } }; } };
  await invalidateContactNameCacheAfterRestore({ client, connection: { tenantId } });
  assert.deepEqual(predicates, [['id', 'primary'], ['tenant_id', tenantId]]);
  const failing = { from() { return { delete() { return this; }, eq() { return this; }, then(resolve) { resolve({ error: { message: 'unavailable' } }); } }; } };
  await assert.rejects(invalidateContactNameCacheAfterRestore({ client: failing, connection: { tenantId } }));
});

test('malformed pagination cannot certify a complete Contact list', async () => {
  for (const pagination of [[], 'truncated', 1, false]) {
    await assert.rejects(listXeroContactsComplete({ tenantId, accessToken: 'fixture-only' }, {
      env: { XERO_CONTACT_SYNC_DELAY_MS: '0' }, fetchImpl: async () => new Response(JSON.stringify({ Contacts: [], pagination }), { status: 200 }),
    }), { code: 'XERO_CONTACT_LIST_INCOMPLETE' });
  }
});

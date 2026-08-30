import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildContactAutoCreateRows,
  normalizeSalesforceContactSyncPayload,
  processSalesforceContactSyncWebhook,
  salesforceContactSyncSignature,
  validateSalesforceAccountForAutoCreate,
  validateSalesforceContactSource,
  verifySalesforceContactSyncRequest,
  xeroAccountingFetch,
} from '../api/_xeroContactSync.js';

const baseAccount = {
  id: '001000000000001AAA',
  name: 'BUNKER EXPRESS CO LTD',
  companyCode: 'HKBE',
  recordType: 'Supplier',
  inactiveSuspended: false,
};

function signedHeaders({ secret = 'shared-secret', body = '{}', eventId = 'evt-1', timestamp = '2026-08-27T12:00:00.000Z', orgId = '00D2x000000Ei4oEAC' } = {}) {
  return {
    'x-salesforce-org-id': orgId,
    'x-salesforce-contact-sync-event-id': eventId,
    'x-salesforce-contact-sync-timestamp': timestamp,
    'x-salesforce-contact-sync-signature': `sha256=${salesforceContactSyncSignature({ secret, timestamp, eventId, rawBody: body })}`,
  };
}

function memorySupabaseClient() {
  const inserts = [];
  const updates = [];
  return {
    inserts,
    updates,
    from(table) {
      return {
        insert(payload) {
          inserts.push({ table, payload });
          return Promise.resolve({ error: null });
        },
        update(patch) {
          return {
            eq(column, value) {
              updates.push({ table, patch, column, value });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test('Xero contact auto-create uses current Xero name matches only', () => {
  assert.deepEqual(
    buildContactAutoCreateRows([baseAccount], [{
      contactId: 'xero-name',
      name: 'BUNKER EXPRESS CO LTD',
      status: 'ACTIVE',
      contactNumber: '',
      accountNumber: '',
    }]).map((row) => [row.status, row.reason, row.matchField]),
    [['already-exists', 'xero-contact-exists', 'SalesforceName']],
  );

  assert.deepEqual(
    buildContactAutoCreateRows([baseAccount], [{
      contactId: 'xero-key',
      name: 'BE',
      status: 'ACTIVE',
      contactNumber: '',
      accountNumber: '',
    }]).map((row) => [row.status, row.reason, row.matchField]),
    [['already-exists', 'xero-contact-exists', 'ClKeyWithoutHk']],
  );

  assert.deepEqual(
    buildContactAutoCreateRows([baseAccount], [{
      contactId: 'xero-old-key',
      name: 'Some other name',
      status: 'ACTIVE',
      contactNumber: 'HKBE',
      accountNumber: 'HKBE',
    }]).map((row) => [row.status, row.reason]),
    [['pending', 'missing-xero-contact']],
  );
});

test('Xero contact auto-create blocks unsafe Salesforce and Xero cases', () => {
  assert.equal(validateSalesforceAccountForAutoCreate({ ...baseAccount, inactiveSuspended: true }), 'inactive-salesforce-account');
  assert.equal(validateSalesforceAccountForAutoCreate({ ...baseAccount, companyCode: 'SG123' }), 'non-hk-cl-key');
  assert.equal(validateSalesforceAccountForAutoCreate({ ...baseAccount, recordType: 'Other' }), 'unsupported-salesforce-record-type');

  const duplicateRows = buildContactAutoCreateRows([
    baseAccount,
    { ...baseAccount, id: '001000000000002AAA', companyCode: 'HKBE2' },
  ], []);
  assert.equal(duplicateRows.length, 2);
  assert.ok(duplicateRows.every((row) => row.status === 'skipped' && row.reason === 'duplicate-create-name'));

  const archivedRows = buildContactAutoCreateRows([baseAccount], [{
    contactId: 'archived-name',
    name: 'BUNKER EXPRESS CO LTD',
    status: 'ARCHIVED',
  }]);
  assert.deepEqual(archivedRows.map((row) => [row.status, row.reason]), [['skipped', 'archived-only-match']]);
});

test('Salesforce contact sync payload validation only accepts enabled Account lookup sources', () => {
  assert.equal(validateSalesforceContactSource({ objectApiName: 'Opportunity', fieldName: 'AccountId' }), '');
  assert.equal(validateSalesforceContactSource({ objectApiName: 'Supplier_Bid__c', fieldName: 'Suppliers_Broker__c' }), '');
  assert.equal(validateSalesforceContactSource({ objectApiName: 'STEM_Line_Item__c', fieldName: 'Original_Supplier__c' }), '');
  assert.equal(validateSalesforceContactSource({ objectApiName: 'STEM_Line_Item__c', fieldName: 'Account__c' }), 'unsupported-source-field');

  const normalized = normalizeSalesforceContactSyncPayload({
    records: [
      { objectApiName: 'STEM__c', recordId: 'a001', fieldName: 'Account__c', accountId: '001000000000001AAA', operation: 'insert' },
      { objectApiName: 'Unknown__c', recordId: 'a002', fieldName: 'Account__c', accountId: '001000000000002AAA', operation: 'insert' },
    ],
    accountIds: ['001000000000003AAA'],
  });
  assert.equal(normalized.payloadAccountCount, 3);
  assert.deepEqual(normalized.validSourceRecords.map((record) => record.accountId), ['001000000000001AAA', '001000000000003AAA']);
  assert.deepEqual(normalized.invalidRows.map((row) => row.reason), ['unsupported-source-field']);
});

test('Salesforce contact sync HMAC verification rejects stale, wrong-org, and invalid signatures', () => {
  const rawBody = JSON.stringify({ eventId: 'evt-1', records: [] });
  const headers = signedHeaders({ body: rawBody });
  assert.deepEqual(
    verifySalesforceContactSyncRequest({
      headers,
      rawBody,
      env: { SALESFORCE_CONTACT_SYNC_SECRET: 'shared-secret' },
      now: Date.parse('2026-08-27T12:00:30.000Z'),
    }),
    { orgId: '00D2x000000Ei4oEAC', eventId: 'evt-1', timestamp: '2026-08-27T12:00:00.000Z' },
  );

  assert.throws(
    () => verifySalesforceContactSyncRequest({
      headers: signedHeaders({ body: rawBody, orgId: '00D000000000000AAA' }),
      rawBody,
      env: { SALESFORCE_CONTACT_SYNC_SECRET: 'shared-secret' },
      now: Date.parse('2026-08-27T12:00:30.000Z'),
    }),
    (error) => error.status === 403 && error.code === 'XERO_CONTACT_SYNC_ORG_MISMATCH',
  );

  assert.throws(
    () => verifySalesforceContactSyncRequest({
      headers,
      rawBody,
      env: { SALESFORCE_CONTACT_SYNC_SECRET: 'shared-secret' },
      now: Date.parse('2026-08-27T12:10:00.000Z'),
    }),
    (error) => error.status === 401 && error.code === 'XERO_CONTACT_SYNC_STALE_TIMESTAMP',
  );

  assert.throws(
    () => verifySalesforceContactSyncRequest({
      headers: { ...headers, 'x-salesforce-contact-sync-signature': 'sha256=' + 'a'.repeat(64) },
      rawBody,
      env: { SALESFORCE_CONTACT_SYNC_SECRET: 'shared-secret' },
      now: Date.parse('2026-08-27T12:00:30.000Z'),
    }),
    (error) => error.status === 401 && error.code === 'XERO_CONTACT_SYNC_INVALID_SIGNATURE',
  );
});

test('Salesforce contact sync webhook is inert until the Xero external-action gate is enabled', async () => {
  const rawBody = JSON.stringify({ eventId: 'evt-1', records: [] });
  await assert.rejects(
    processSalesforceContactSyncWebhook({
      rawBody,
      headers: signedHeaders({ body: rawBody }),
      env: { SALESFORCE_CONTACT_SYNC_SECRET: 'shared-secret' },
      now: Date.parse('2026-08-27T12:00:30.000Z'),
      client: {},
      salesforceAccountLoader: async () => [],
    }),
    (error) => error.status === 409 && error.gate === 'xero_contact_sync',
  );
});

test('Salesforce contact sync skips Xero calls when no loaded account is eligible', async () => {
  const client = memorySupabaseClient();
  const rawBody = JSON.stringify({ eventId: 'evt-2', accountIds: [baseAccount.id] });
  const result = await processSalesforceContactSyncWebhook({
    rawBody,
    headers: signedHeaders({ body: rawBody, eventId: 'evt-2' }),
    env: {
      SALESFORCE_CONTACT_SYNC_SECRET: 'shared-secret',
      FCOS_ENABLE_XERO_CONTACT_SYNC: 'true',
    },
    now: Date.parse('2026-08-27T12:00:30.000Z'),
    client,
    salesforceAccountLoader: async () => [{ ...baseAccount, inactiveSuspended: true }],
    fetchImpl: async () => {
      throw new Error('Xero should not be called for ineligible accounts.');
    },
    xeroContactLister: async () => {
      throw new Error('Xero contacts should not be listed for ineligible accounts.');
    },
    xeroContactCreator: async () => {
      throw new Error('Xero contacts should not be created for ineligible accounts.');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.xero.estimatedReadCalls, 0);
  assert.equal(result.xero.createCalls, 0);
  assert.deepEqual(result.rows.map((row) => [row.status, row.reason]), [['skipped', 'inactive-salesforce-account']]);
  assert.equal(client.inserts.some((entry) => entry.table === 'xero_contact_sync_runs'), true);
});

test('Xero read requests retry transient gateway failures without retrying writes', async () => {
  const connection = { accessToken: 'access', tenantId: 'tenant' };
  let readCalls = 0;
  const readResult = await xeroAccountingFetch(connection, '/Contacts?page=1', {
    method: 'GET',
    retryOnRateLimit: true,
    env: { XERO_TRANSIENT_RETRY_DELAY_MS: '0' },
    fetchImpl: async () => {
      readCalls += 1;
      if (readCalls === 1) return jsonResponse({}, 504);
      return jsonResponse({ Contacts: [{ ContactID: 'contact-1' }] });
    },
  });
  assert.equal(readCalls, 2);
  assert.equal(readResult.Contacts[0].ContactID, 'contact-1');

  let writeCalls = 0;
  await assert.rejects(
    xeroAccountingFetch(connection, '/Contacts', {
      method: 'POST',
      body: { Contacts: [{ Name: 'Test' }] },
      env: { XERO_TRANSIENT_RETRY_DELAY_MS: '0' },
      fetchImpl: async () => {
        writeCalls += 1;
        return jsonResponse({}, 504);
      },
    }),
    (error) => error.status === 504 && error.code === 'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED',
  );
  assert.equal(writeCalls, 1);
});

test('Xero contact sync Supabase migration is service-role only and stores audit/cache state', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260827145608_xero_contact_sync.sql', import.meta.url), 'utf8');
  for (const table of [
    'xero_contact_sync_connections',
    'xero_contact_name_cache',
    'xero_contact_sync_events',
    'xero_contact_sync_runs',
    'xero_contact_sync_rows',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
  }
  assert.match(sql, /refresh_token text not null/);
  assert.match(sql, /event_id text primary key/);
  assert.match(sql, /request_payload jsonb not null/);
  assert.match(sql, /raw_row jsonb not null/);
});

test('Salesforce webhook route keeps raw body parsing and calls the contact-sync service', async () => {
  const source = await readFile(new URL('../api/salesforce/contact-sync.js', import.meta.url), 'utf8');
  assert.match(source, /bodyParser: false/);
  assert.match(source, /processSalesforceContactSyncWebhook/);
  assert.match(source, /X-FCOS-External-Action/);
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

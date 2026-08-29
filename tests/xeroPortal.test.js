import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildContactLifecycleRows,
  signXeroOAuthState,
  summarizeContactLifecycleRows,
  verifyXeroOAuthState,
  xeroPortalStatus,
} from '../api/_xeroPortal.js';

const sfAccount = {
  id: '001000000000001AAA',
  name: 'BUNKER EXPRESS CO LTD',
  companyCode: 'HKBE',
  recordType: 'Supplier',
};

function xeroContact(overrides = {}) {
  return {
    contactId: overrides.contactId || 'xero-1',
    name: overrides.name || 'BUNKER EXPRESS CO LTD',
    status: overrides.status || 'ACTIVE',
    contactNumber: overrides.contactNumber || '',
    accountNumber: overrides.accountNumber || '',
    accountsReceivableOutstanding: overrides.accountsReceivableOutstanding || 0,
    accountsPayableOutstanding: overrides.accountsPayableOutstanding || 0,
    ...overrides,
  };
}

test('Xero OAuth state is signed, time-bound, and rejects tampering', () => {
  const env = { XERO_OAUTH_STATE_SECRET: 'state-secret' };
  const now = Date.parse('2026-08-27T12:05:00.000Z');
  const state = signXeroOAuthState({
    issuedAt: '2026-08-27T12:00:00.000Z',
    redirectUri: 'https://fcos.fcuno.com/api/xero/callback',
  }, env);
  assert.equal(verifyXeroOAuthState(state, env, now).redirectUri, 'https://fcos.fcuno.com/api/xero/callback');
  assert.throws(
    () => verifyXeroOAuthState(`${state.slice(0, -2)}xx`, env, now),
    (error) => error.status === 401 && error.code === 'XERO_PORTAL_INVALID_STATE',
  );
  assert.throws(
    () => verifyXeroOAuthState(state, env, Date.parse('2026-08-27T12:30:01.000Z')),
    (error) => error.status === 401 && error.code === 'XERO_PORTAL_EXPIRED_STATE',
  );
});

test('Xero Portal status refreshes a stale access token before reporting expiry', async () => {
  const client = fakePortalStatusClient({
    tenant_id: 'tenant-1',
    tenant_name: 'FCOS Test',
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    expires_at: '2026-08-27T00:00:00.000Z',
    scope: 'accounting.contacts accounting.invoices accounting.attachments accounting.payments.read accounting.banktransactions.read',
    token_version: 4,
  });
  const requests = [];
  const result = await xeroPortalStatus({}, {
    client,
    env: {
      XERO_CLIENT_ID: 'client',
      XERO_CLIENT_SECRET: 'secret',
      FCOS_PUBLIC_URL: 'https://fcos.fcuno.com',
      SALESFORCE_INSTANCE_URL: 'https://fratellicosulich.my.salesforce.com',
    },
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).endsWith('/connect/token')) {
        return jsonResponse({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 1800,
          scope: 'accounting.contacts accounting.invoices accounting.attachments accounting.payments.read accounting.banktransactions.read',
        });
      }
      if (String(url).endsWith('/connections')) {
        return jsonResponse([{ tenantId: 'tenant-1', tenantName: 'FCOS Test' }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  assert.equal(result.xero.connected, true);
  assert.equal(result.xero.tenantName, 'FCOS Test');
  assert.equal(client.connection.access_token, 'new-access');
  assert.equal(client.connection.refresh_token, 'new-refresh');
  assert.notEqual(result.xero.expiresAt, '2026-08-27T00:00:00.000Z');
  assert.deepEqual(requests.map((url) => new URL(url).pathname), ['/connect/token']);
});

test('contact lifecycle keeps matched Salesforce contacts and ignores ContactNumber matching', () => {
  const rows = buildContactLifecycleRows([sfAccount], [
    xeroContact({ contactId: 'matched-by-name', name: 'BUNKER EXPRESS CO LTD' }),
    xeroContact({ contactId: 'reference-only', name: 'Other Name', contactNumber: 'HKBE', accountNumber: 'HKBE' }),
  ], new Map(), { usageCoverageComplete: true });

  assert.deepEqual(
    rows.map((row) => [row.xeroContactId, row.action, row.status, row.reason]),
    [
      ['reference-only', 'archive', 'eligible', 'unused-unmatched-xero-contact'],
      ['matched-by-name', 'keep', 'kept', 'unchanged-name'],
    ],
  );
});

test('contact lifecycle recognizes HK-stripped CL Key name and blocks ambiguous matches', () => {
  const keyRows = buildContactLifecycleRows([sfAccount], [
    xeroContact({ contactId: 'key-match', name: 'BE' }),
  ], new Map(), { usageCoverageComplete: true });
  assert.deepEqual(keyRows.map((row) => [row.action, row.status, row.matchField]), [['rename', 'eligible', 'ClKeyWithoutHk']]);

  const ambiguousRows = buildContactLifecycleRows([sfAccount], [
    xeroContact({ contactId: 'name-match', name: 'BUNKER EXPRESS CO LTD' }),
    xeroContact({ contactId: 'key-match', name: 'BE' }),
  ], new Map(), { usageCoverageComplete: true });
  assert.equal(ambiguousRows.find((row) => row.salesforceAccountId === sfAccount.id)?.reason, 'ambiguous-xero-name-match');
});

test('contact lifecycle never archives used contacts or contacts with incomplete usage coverage', () => {
  const usage = new Map([['used-contact', [{ source: 'invoices', label: 'Invoices, bills, and credit notes', records: 3 }]]]);
  const rows = buildContactLifecycleRows([], [
    xeroContact({ contactId: 'used-contact', name: 'USED ONLY' }),
    xeroContact({ contactId: 'unused-contact', name: 'UNUSED ONLY' }),
  ], usage, { usageCoverageComplete: true });
  assert.deepEqual(
    rows.map((row) => [row.xeroContactId, row.action, row.status, row.reason]),
    [
      ['unused-contact', 'archive', 'eligible', 'unused-unmatched-xero-contact'],
      ['used-contact', 'exception', 'blocked', 'used-unmatched-xero-contact'],
    ],
  );

  const incompleteRows = buildContactLifecycleRows([], [
    xeroContact({ contactId: 'maybe-unused', name: 'MAYBE UNUSED' }),
  ], new Map(), { usageCoverageComplete: false });
  assert.deepEqual(incompleteRows.map((row) => [row.action, row.status, row.reason]), [['exception', 'blocked', 'usage-scan-incomplete']]);
});

test('contact lifecycle summary counts archived, non-archived, and unmatched Xero contacts', () => {
  const contacts = [
    xeroContact({ contactId: 'active-a', name: 'ACTIVE A' }),
    xeroContact({ contactId: 'archived-a', name: 'ARCHIVED A', status: 'ARCHIVED' }),
  ];
  const rows = buildContactLifecycleRows([], contacts, new Map(), { usageCoverageComplete: true });
  const summary = summarizeContactLifecycleRows(rows, contacts, 0);
  assert.equal(summary.nonArchivedXeroContacts, 1);
  assert.equal(summary.archivedXeroContacts, 1);
  assert.equal(summary.unmatchedNonArchivedXeroContacts, 1);
  assert.equal(summary.archiveEligible, 1);
});

test('native Xero Portal migration is service-role only and creates private receipt storage', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260827191032_native_xero_portal.sql', import.meta.url), 'utf8');
  for (const table of [
    'xero_portal_receipts',
    'xero_contact_usage_cache',
    'xero_contact_lifecycle_locks',
    'xero_contact_lifecycle_runs',
    'xero_contact_lifecycle_rows',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
  }
  assert.match(sql, /insert into storage\.buckets/);
  assert.match(sql, /'xero-portal-receipts'/);
  assert.match(sql, /false,\n  10485760/);
  assert.match(sql, /'xero_portal'/);
  assert.match(sql, /'xero_portal_manage'/);
});

test('connected Xero users can refresh missing scopes without deleting the stored connection first', async () => {
  const ui = await readFile(new URL('../src/pages/XeroPortal.jsx', import.meta.url), 'utf8');
  assert.match(ui, /needsFinancialReconnect/);
  assert.match(ui, /Reconnect scopes/);
  assert.match(ui, /onClick=\{connectXero\}/);
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fakePortalStatusClient(initialConnection) {
  const state = {
    connection: { ...initialConnection },
  };
  const client = {
    get connection() {
      return state.connection;
    },
    from(table) {
      return new FakeQuery(table, state);
    },
  };
  return client;
}

class FakeQuery {
  constructor(table, state) {
    this.table = table;
    this.state = state;
    this.selected = '*';
  }

  select(value) {
    this.selected = value;
    return this;
  }

  eq() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle() {
    if (this.table === 'xero_contact_sync_connections') {
      if (this.selected === 'token_version') return { data: { token_version: this.state.connection.token_version || 0 }, error: null };
      return { data: this.state.connection, error: null };
    }
    return { data: null, error: null };
  }

  async upsert(row) {
    if (this.table === 'xero_contact_sync_connections') this.state.connection = { ...row };
    return { data: row, error: null };
  }

  then(resolve, reject) {
    return Promise.resolve(this.result()).then(resolve, reject);
  }

  result() {
    if (this.table === 'xero_contact_usage_cache') return { data: [], error: null };
    return { data: null, error: null };
  }
}

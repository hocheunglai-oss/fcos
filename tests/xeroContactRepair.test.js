import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { xeroContactRepairApply } from '../api/_xeroContactRepair.js';
import { listXeroContactsForRename } from '../api/_xeroContactSync.js';

function database(tables) {
  const writes = [];
  const client = { tables, writes, failAudit: false, failJournal: false, from(table) {
    const filters = []; let operation = 'select'; let values; let single = false; let begin = 0; let end = Infinity;
    const at = (row, key) => key.includes('->>') ? row[key.split('->>')[0]]?.[key.split('->>')[1]] : row[key];
    const query = {
      select: () => query, order: () => query, range: (a, b) => { begin = a; end = b; return query; },
      eq: (key, value) => { filters.push((row) => at(row, key) === value); return query; },
      in: (key, values) => { filters.push((row) => values.includes(at(row, key))); return query; },
      maybeSingle: () => { single = true; return query; },
      insert: (value) => { values = value; operation = 'insert'; return query; },
      update: (value) => { values = value; operation = 'update'; return query; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (operation === 'insert' && table === 'xero_financial_audit_events' && client.failAudit) return { error: { message: 'audit unavailable' } };
        if (operation === 'update' && table === 'xero_contact_lifecycle_rows' && client.failJournal) return { error: { message: 'journal unavailable' } };
        let rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row))).slice(begin, end + 1);
        if (operation === 'insert') { rows = [{ id: randomUUID(), ...structuredClone(values) }]; (tables[table] ||= []).push(...rows); }
        if (operation === 'update') rows.forEach((row) => Object.assign(row, structuredClone(values)));
        if (operation !== 'select') writes.push({ table, operation, values });
        return { data: single ? rows[0] || null : rows, error: null };
      }).then(resolve, reject); },
    }; return query;
  } }; return client;
}

function fixture() {
  const runId = randomUUID(); const tenantId = randomUUID();
  const account = { id: '001000000000001AAA', name: 'BUNKER EXPRESS CO LTD', companyCode: 'HKBE', recordType: 'Supplier', inactiveSuspended: false };
  const rowId = `sf-${account.id}`;
  const row = { id: randomUUID(), row_id: rowId, run_id: runId, action: 'exception', status: 'blocked', reason: 'missing-xero-contact',
    salesforce_account_id: account.id, salesforce_name: account.name, salesforce_cl_key: account.companyCode, salesforce_record_type: account.recordType, raw_row: {} };
  const tables = { xero_contact_lifecycle_runs: [{ id: runId, state: 'previewed', xero: { tenantId } }], xero_contact_lifecycle_rows: [row], xero_financial_audit_events: [], xero_contact_lifecycle_locks: [] };
  const client = database(tables); const creates = []; const contacts = []; const allAccounts = [account]; let releases = 0;
  const deps = { client, env: { FCOS_ENABLE_XERO_CONTACT_SYNC: 'true' }, accessContext: { profile: { id: randomUUID(), email: 'finance@example.test' } },
    connectionReader: async () => ({ tenantId, scope: 'accounting.contacts' }), accountReader: async () => [account], allAccountReader: async () => allAccounts,
    contactReader: async () => structuredClone(contacts), lockReader: async (_client, leaseId) => {
      tables.xero_contact_lifecycle_locks = [{ id: 'primary', run_id: leaseId, locked_until: new Date(Date.now() + 60000).toISOString() }];
      return { release: async () => { releases++; } };
    }, contactCreator: async (_connection, requested, key) => {
      creates.push({ requested, key });
      assert.ok(tables.xero_financial_audit_events.some((audit) => audit.event_type === 'contact_repair_intent'));
      assert.equal(row.raw_row.repair.state, 'intent');
      const contact = { contactId: randomUUID(), name: requested[0].name, status: 'ACTIVE' }; contacts.push(contact);
      return [{ rowId: requested[0].rowId, contactId: contact.contactId, name: contact.name, contactStatus: contact.status, success: true }];
    } };
  return { request: { runId, rowIds: [rowId], reviewed: true }, deps, account, row, contacts, allAccounts, creates, client, tables, tenantId, releases: () => releases };
}

test('reviewed missing contact gets durable intent then verified creation with stable idempotency and no webhook event', async () => {
  const f = fixture(); const result = await xeroContactRepairApply(f.request, f.deps);
  assert.equal(result.summary.created, 1); assert.equal(result.refreshPreview, true); assert.equal(f.creates.length, 1);
  assert.equal(f.row.raw_row.repair.state, 'created');
  assert.equal(f.row.raw_row.repair.idempotencyKey, `${f.creates[0].key}-create-1`);
  assert.deepEqual(f.tables.xero_financial_audit_events.map((row) => row.event_type), ['contact_repair_intent', 'contact_repair_outcome']);
  assert.ok(f.tables.xero_financial_audit_events.every((row) => row.run_id === null && row.actor_id === f.deps.accessContext.profile.id && row.fingerprints.lifecycleRunId === f.request.runId));
  assert.ok(f.client.writes.every((write) => !write.table.startsWith('xero_contact_sync_')));
  assert.equal(f.releases(), 1);
  const retry = await xeroContactRepairApply(f.request, f.deps);
  assert.equal(retry.summary.existing, 1); assert.equal(f.creates.length, 1);
});

test('actor, explicit review, valid saved selection and cap fail before provider creation', async () => {
  for (const request of [{ reviewed: false }, { runId: 'fake' }, { rowIds: [] }, { rowIds: ['missing'] }, { rowIds: Array.from({ length: 26 }, (_, i) => `row-${i}`) }]) {
    const f = fixture(); await assert.rejects(xeroContactRepairApply({ ...f.request, ...request }, f.deps)); assert.equal(f.creates.length, 0);
  }
  const f = fixture(); await assert.rejects(xeroContactRepairApply(f.request, { ...f.deps, accessContext: null }), { code: 'XERO_CONTACT_REPAIR_ACTOR_REQUIRED' });
  await assert.rejects(xeroContactRepairApply(f.request, { ...f.deps, env: {} }));
  assert.equal(f.creates.length, 0);
});

test('tenant drift, scope loss, incomplete contact list and lease expiry fail closed', async () => {
  const cases = [
    { connectionReader: async () => ({ tenantId: randomUUID(), scope: 'accounting.contacts' }) },
    { connectionReader: async () => ({ tenantId: null, scope: '' }) },
    { contactReader: async () => [{ contactId: 'invalid', status: 'ACTIVE' }] },
  ];
  for (const change of cases) { const f = fixture(); await assert.rejects(xeroContactRepairApply(f.request, { ...f.deps, ...change })); assert.equal(f.creates.length, 0); assert.equal(f.releases(), 1); }
  const f = fixture(); f.deps.contactReader = async () => { f.tables.xero_contact_lifecycle_locks[0].locked_until = '2020-01-01'; return []; };
  await assert.rejects(xeroContactRepairApply(f.request, f.deps), { code: 'XERO_CONTACT_REPAIR_LOCK_LOST' }); assert.equal(f.creates.length, 0);
});

test('fresh Salesforce identity changes, duplicate accounts and placeholders never create', async () => {
  for (const change of ['renamed', 'inactive', 'missing', 'duplicate', 'placeholder', 'cross-key']) {
    const f = fixture();
    if (change === 'renamed') f.account.name = 'RENAMED';
    if (change === 'inactive') f.account.inactiveSuspended = true;
    if (change === 'missing') f.deps.accountReader = async () => [];
    if (change === 'duplicate') f.allAccounts.push({ ...f.account, id: '001000000000002AAA' });
    if (change === 'placeholder') { f.account.name = 'Unknown'; f.row.salesforce_name = 'Unknown'; }
    if (change === 'cross-key') f.allAccounts.push({ ...f.account, id: '001000000000002AAA', name: 'BE', companyCode: 'HKOTHER' });
    const result = await xeroContactRepairApply(f.request, f.deps); assert.equal(result.summary.blocked, 1, change); assert.equal(f.creates.length, 0, change);
  }
});

test('existing active, archived and duplicate Xero identities are preserved without writes', async () => {
  for (const statuses of [['ACTIVE'], ['ARCHIVED'], ['ACTIVE', 'ACTIVE']]) {
    const f = fixture(); f.contacts.push(...statuses.map((status) => ({ contactId: randomUUID(), name: f.account.name, status })));
    const before = structuredClone(f.contacts); const result = await xeroContactRepairApply(f.request, f.deps);
    assert.equal(result.summary.existing, statuses.length === 1 && statuses[0] === 'ACTIVE' ? 1 : 0);
    assert.equal(f.creates.length, 0); assert.deepEqual(f.contacts, before);
  }
});

test('audit or journal failures prevent creation, and a written intent blocks a later new-preview retry', async () => {
  for (const key of ['failAudit', 'failJournal']) {
    const f = fixture(); f.client[key] = true;
    await assert.rejects(xeroContactRepairApply(f.request, f.deps), { code: 'XERO_CONTACT_REPAIR_STORAGE_FAILED' }); assert.equal(f.creates.length, 0);
    if (key === 'failJournal') { f.client[key] = false; const retry = await xeroContactRepairApply(f.request, f.deps); assert.equal(retry.summary.uncertain, 1); assert.equal(f.creates.length, 0); }
  }
});

test('uncertain provider outcomes never repeat creation, including after a new saved preview', async () => {
  const f = fixture(); let attempts = 0; f.deps.contactCreator = async () => { attempts++; throw new Error('network failed'); };
  assert.equal((await xeroContactRepairApply(f.request, f.deps)).summary.uncertain, 1);
  assert.equal((await xeroContactRepairApply(f.request, f.deps)).summary.uncertain, 1); assert.equal(attempts, 1);
  const newRun = randomUUID(); f.tables.xero_contact_lifecycle_runs.push({ ...f.tables.xero_contact_lifecycle_runs[0], id: newRun });
  f.tables.xero_contact_lifecycle_rows.push({ ...f.row, id: randomUUID(), run_id: newRun, raw_row: {} });
  assert.equal((await xeroContactRepairApply({ ...f.request, runId: newRun }, f.deps)).summary.uncertain, 1); assert.equal(attempts, 1);
  f.contacts.push({ contactId: randomUUID(), name: f.account.name, status: 'ACTIVE' });
  assert.equal((await xeroContactRepairApply({ ...f.request, runId: newRun }, f.deps)).summary.existing, 1); assert.equal(attempts, 1);
});

test('mismatched provider contact identity is uncertain and is never recorded as created', async () => {
  for (const result of [{ name: 'Different company' }, { contactId: 'invalid' }, { contactStatus: 'ARCHIVED' }, { rowId: 'different-row' }, { contactId: null }]) {
    const f = fixture(); f.deps.contactCreator = async () => [{ success: true, contactId: randomUUID(), name: f.account.name, contactStatus: 'ACTIVE', rowId: f.row.row_id, ...result }];
    const outcome = await xeroContactRepairApply(f.request, f.deps); assert.equal(outcome.summary.uncertain, 1); assert.equal(outcome.summary.created, 0);
  }
});

async function readContacts(pages) {
  let index = 0;
  return listXeroContactsForRename({ accessToken: 'test-only', tenantId: randomUUID() }, { env: { XERO_CONTACT_SYNC_DELAY_MS: '0' }, fetchImpl: async () => new Response(JSON.stringify(pages[index++]), { status: 200 }) });
}
const contactPage = (count = 100) => Array.from({ length: count }, () => ({ ContactID: randomUUID(), Name: 'Supplier', ContactStatus: 'ACTIVE' }));

test('complete contact scan verifies stable page totals and returns archived evidence', async () => {
  const first = contactPage(); const last = [{ ContactID: randomUUID(), Name: 'Archived', ContactStatus: 'ARCHIVED' }];
  const contacts = await readContacts([{ Contacts: first, pagination: { page: 1, pageSize: 100, pageCount: 2, itemCount: 101 } }, { Contacts: last, pagination: { page: 2, pageSize: 100, pageCount: 2, itemCount: 101 } }]);
  assert.equal(contacts.length, 101); assert.equal(contacts.at(-1).status, 'ARCHIVED');
});

test('malformed, truncated, duplicate, unstable and unbounded contact scans never become absence evidence', async () => {
  const first = contactPage();
  const cases = [[{}], [{ Contacts: [{ ContactID: randomUUID(), ContactStatus: 'ACTIVE' }] }], [{ Contacts: [{ Name: 'missing identity' }] }], [{ Contacts: first, pagination: { pageCount: 1001 } }],
    [{ Contacts: [], pagination: { pageCount: 2, itemCount: 200 } }], [{ Contacts: first, pagination: { pageCount: 2, itemCount: 101 } }, { Contacts: contactPage(1), pagination: { pageCount: 2, itemCount: 102 } }],
    [{ Contacts: first }, { Contacts: [first[0]] }], [{ Contacts: first, pagination: { pageCount: 2, itemCount: 101 } }, { Contacts: contactPage(1) }]];
  for (const pages of cases) await assert.rejects(readContacts(pages), { code: 'XERO_CONTACT_LIST_INCOMPLETE' });
});


test('contact and account number identity evidence blocks another creation even when names differ', async () => {
  for (const field of ['contactNumber', 'accountNumber']) {
    const f = fixture(); f.contacts.push({ contactId: randomUUID(), name: 'Historical company label', status: 'ARCHIVED', [field]: f.account.companyCode });
    const result = await xeroContactRepairApply(f.request, f.deps);
    assert.equal(result.summary.blocked, 1); assert.equal(f.creates.length, 0);
  }
});

test('a confirmed created identity cannot switch silently to a replacement contact on retry', async () => {
  const f = fixture(); await xeroContactRepairApply(f.request, f.deps);
  const confirmed = f.row.raw_row.repair.contactId;
  f.contacts[0].contactId = randomUUID();
  assert.equal((await xeroContactRepairApply(f.request, f.deps)).summary.blocked, 1);
  assert.equal(f.row.raw_row.repair.expectedContactId, confirmed);
  assert.equal((await xeroContactRepairApply(f.request, f.deps)).summary.blocked, 1);
  assert.equal(f.creates.length, 1);
});

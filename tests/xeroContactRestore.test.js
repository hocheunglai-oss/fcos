import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { xeroContactRestoreApply, restoreXeroContactStatus, readXeroContactForRestoration } from '../api/_xeroContactRestore.js';
import { buildContactRestoration } from '../api/_xeroContactRestorePolicy.js';

function database(tables) {
  const client = { tables, writes: [], failAudit: null, failJournal: null, from(table) {
    const filters = []; let operation = 'select'; let values; let single = false; let start = 0; let end = Infinity;
    const at = (row, key) => key.includes('->>') ? row[key.split('->>')[0]]?.[key.split('->>')[1]] : row[key];
    const query = { select: () => query, order: () => query, range: (a, b) => { start = a; end = b; return query; },
      eq: (key, value) => { filters.push((row) => at(row, key) === value); return query; },
      in: (key, entries) => { filters.push((row) => entries.includes(at(row, key))); return query; },
      maybeSingle: () => { single = true; return query; }, insert: (value) => { operation = 'insert'; values = value; return query; },
      update: (value) => { operation = 'update'; values = value; return query; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (operation === 'insert' && table === 'xero_financial_audit_events' && client.failAudit?.(values)) return { error: { message: 'audit unavailable' } };
        if (operation === 'update' && table === 'xero_contact_lifecycle_rows' && client.failJournal?.(values)) return { error: { message: 'journal unavailable' } };
        let rows = (tables[table] || []).filter((row) => filters.every((predicate) => predicate(row))).slice(start, end + 1);
        if (operation === 'insert') { rows = [{ id: randomUUID(), ...structuredClone(values) }]; (tables[table] ||= []).push(...rows); }
        if (operation === 'update') rows.forEach((row) => Object.assign(row, structuredClone(values)));
        if (operation !== 'select') client.writes.push({ table, operation, values: structuredClone(values) });
        return { data: single ? rows[0] || null : rows, error: null };
      }).then(resolve, reject); },
    }; return query;
  } }; return client;
}

function fixture() {
  const runId = randomUUID(); const tenantId = randomUUID(); const contactId = randomUUID();
  const account = { id: '001000000000001', name: 'EXAMPLE SUPPLY LTD', companyCode: 'HKEXAMPLE', recordType: 'Supplier', inactiveSuspended: false };
  const contacts = [{ contactId, name: account.name, status: 'ARCHIVED', contactNumber: '', accountNumber: '', mergedToContactId: null }];
  const accounts = [account];
  const raw = { ContactID: contactId, Name: account.name, ContactStatus: 'ARCHIVED', ContactNumber: '', AccountNumber: '',
    BankAccountDetails: 'fixture-bank', Addresses: [{ AddressType: 'STREET', City: 'Example' }], Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: '123' }],
    EmailAddress: 'office@example.test', PaymentTerms: { Bills: { Day: 30, Type: 'DAYSAFTERBILLDATE' } }, Balances: { AccountsPayable: { Outstanding: 125 } } };
  const marker = buildContactRestoration(account, accounts, contacts, { tenantId, accountsComplete: true, contactsComplete: true });
  assert.equal(marker.eligible, true);
  const row = { id: randomUUID(), row_id: `sf-${account.id}`, run_id: runId, action: 'exception', status: 'blocked', reason: 'archived-only-match',
    salesforce_account_id: account.id, salesforce_name: account.name, salesforce_cl_key: account.companyCode, salesforce_record_type: account.recordType,
    xero_contact_id: contactId, raw_row: { untouched: 'retained', restoration: marker } };
  const tables = { xero_contact_lifecycle_runs: [{ id: runId, state: 'previewed', xero: { tenantId } }], xero_contact_lifecycle_rows: [row],
    xero_contact_lifecycle_locks: [], xero_financial_audit_events: [] };
  const client = database(tables); const posts = []; const reads = []; let releases = 0; let callbacks = 0;
  const deps = { client, env: { FCOS_ENABLE_XERO_CONTACT_SYNC: 'true' }, accessContext: { profile: { id: randomUUID(), email: ' Finance@example.test ' } },
    connectionReader: async () => ({ tenantId, scope: 'accounting.contacts' }), accountReader: async () => accounts,
    contactReader: async () => structuredClone(contacts), contactDetailReader: async (_connection, id) => { reads.push(id); return structuredClone(raw); },
    lockReader: async (_client, leaseId) => { tables.xero_contact_lifecycle_locks = [{ id: 'primary', run_id: leaseId, locked_until: new Date(Date.now() + 60000).toISOString() }];
      return { release: async () => { releases++; } }; },
    contactUpdater: async (_connection, id, key) => {
      assert.equal(row.raw_row.restoration.journal.state, 'intent');
      assert.ok(tables.xero_financial_audit_events.some((event) => event.event_type === 'contact_restore_intent'));
      posts.push({ id, key }); raw.ContactStatus = 'ACTIVE'; contacts[0].status = 'ACTIVE'; return {};
    }, onRestored: async () => { callbacks++; } };
  const nextPreview = () => {
    const run = randomUUID(); const next = { ...structuredClone(row), id: randomUUID(), run_id: run,
      raw_row: { untouched: 'retained', restoration: structuredClone(marker) } };
    tables.xero_contact_lifecycle_runs.push({ id: run, state: 'previewed', xero: { tenantId } }); tables.xero_contact_lifecycle_rows.push(next);
    return { runId: run, rowIds: [next.row_id], reviewed: true };
  };
  return { request: { runId, rowIds: [row.row_id], reviewed: true }, deps, account, accounts, contacts, raw, row, tables, client,
    posts, reads, tenantId, contactId, marker, nextPreview, releases: () => releases, callbacks: () => callbacks };
}

test('same-ID restoration records intent before POST and independent readback before confirmed audit', async () => {
  const f = fixture(); const original = structuredClone(f.raw);
  const result = await xeroContactRestoreApply(f.request, f.deps);
  assert.equal(result.summary.restored, 1); assert.equal(result.financialWrites, 0); assert.equal(f.posts.length, 1); assert.equal(f.reads.length, 2);
  assert.equal(f.row.action, 'exception'); assert.equal(f.row.status, 'blocked'); assert.equal(f.row.raw_row.untouched, 'retained');
  assert.equal(f.row.raw_row.restoration.journal.state, 'restored'); assert.equal(f.callbacks(), 1); assert.equal(f.releases(), 1);
  assert.deepEqual(f.raw, { ...original, ContactStatus: 'ACTIVE' });
  assert.deepEqual(f.tables.xero_financial_audit_events.map((event) => event.event_type), ['contact_restore_intent', 'contact_restore_outcome']);
  assert.ok(f.tables.xero_financial_audit_events.every((event) => event.actor_id === f.deps.accessContext.profile.id
    && event.actor_email === 'finance@example.test' && event.record_counts.financialWrites === 0));
  assert.ok(f.client.writes.every((write) => ['xero_contact_lifecycle_rows', 'xero_financial_audit_events'].includes(write.table)));
  const retry = await xeroContactRestoreApply(f.request, f.deps);
  assert.equal(retry.summary.alreadyActive, 1); assert.equal(f.posts.length, 1);
});

test('same-ID business-only restore transport never sends a name, account number or accounting mutation', async () => {
  const contactId = randomUUID(); const calls = []; const connection = { tenantId: randomUUID(), accessToken: 'synthetic' };
  const fetchImpl = async (url, init) => { calls.push({ url, ...init }); return new Response(JSON.stringify({ Contacts: [{ ContactID: contactId, Name: 'Fixture', ContactStatus: 'ACTIVE' }] }), { status: 200 }); };
  await restoreXeroContactStatus(connection, contactId, `restore-${'a'.repeat(48)}`, { env: {}, fetchImpl });
  await readXeroContactForRestoration(connection, contactId, { env: {}, fetchImpl });
  assert.deepEqual(JSON.parse(calls[0].body), { Contacts: [{ ContactID: contactId, ContactStatus: 'ACTIVE' }] });
  assert.equal(calls[0].method, 'POST'); assert.ok(calls[0].url.endsWith('/Contacts?summarizeErrors=false'));
  assert.equal(calls[1].method, 'GET'); assert.ok(calls[1].url.includes(`/Contacts/${contactId}?includeArchived=true`));
  let attempts = 0;
  await assert.rejects(restoreXeroContactStatus(connection, contactId, `restore-${'b'.repeat(48)}`, { env: {}, fetchImpl: async () => {
    attempts++; return new Response('', { status: 429, headers: { 'retry-after': '0' } });
  } }));
  assert.equal(attempts, 1);
});

test('actor, gate, exact selection, saved action, tenant and scope fail before Contact mutation', async (t) => {
  for (const [name, change] of [
    ['actor', (f) => { f.deps.accessContext = null; }], ['gate', (f) => { f.deps.env = {}; }],
    ['review', (f) => { f.request.reviewed = false; }], ['run ID', (f) => { f.request.runId = 'wrong'; }],
    ['duplicate selection', (f) => { f.request.rowIds.push(f.row.row_id); }],
    ['selection cap', (f) => { f.request.rowIds = Array.from({ length: 26 }, (_, i) => `row-${i}`); }],
    ['missing selection', (f) => { f.request.rowIds = ['missing']; }], ['wrong action', (f) => { f.row.action = 'rename'; }],
    ['changed target', (f) => { f.row.xero_contact_id = randomUUID(); }], ['missing marker', (f) => { delete f.row.raw_row.restoration; }],
    ['tenant', (f) => { f.deps.connectionReader = async () => ({ tenantId: randomUUID(), scope: 'accounting.contacts' }); }],
    ['scope', (f) => { f.deps.connectionReader = async () => ({ tenantId: f.tenantId, scope: 'accounting.contacts.read' }); }],
  ]) await t.test(name, async () => {
    const f = fixture(); change(f); await assert.rejects(xeroContactRestoreApply(f.request, f.deps)); assert.equal(f.posts.length, 0);
  });
});

test('fresh complete identity and raw single-record checks block unsafe targets while retaining selected identity', async (t) => {
  for (const [name, change] of [
    ['source name', (f) => { f.account.name = 'NEW NAME'; }], ['source key', (f) => { f.account.companyCode = 'HKNEW'; }],
    ['inactive source', (f) => { f.account.inactiveSuspended = true; }], ['missing account', (f) => { f.accounts.length = 0; }],
    ['unknown inactivity', (f) => { delete f.account.inactiveSuspended; }],
    ['active alias', (f) => { f.accounts.push({ ...f.account, id: '001000000000002', companyCode: 'HKOTHER' }); }],
    ['new inactive alias since preview', (f) => { f.accounts.push({ ...f.account, id: '001000000000002', companyCode: 'HKOTHER', inactiveSuspended: true }); }],
    ['other active Contact', (f) => { f.contacts.push({ ...f.contacts[0], contactId: randomUUID(), status: 'ACTIVE' }); }],
    ['other archived Contact', (f) => { f.contacts.push({ ...f.contacts[0], contactId: randomUUID() }); }],
    ['incomplete Contacts', (f) => { f.deps.contactReader = async () => null; }],
    ['merged raw target', (f) => { f.raw.MergedToContactID = randomUUID(); }],
    ['wrong raw ID', (f) => { f.raw.ContactID = randomUUID(); }], ['raw name changed', (f) => { f.raw.Name = 'NEW NAME'; }],
    ['raw number changed', (f) => { f.raw.ContactNumber = 'OTHER'; }],
    ['raw read failed', (f) => { f.deps.contactDetailReader = async () => { throw new Error('offline'); }; }],
  ]) await t.test(name, async () => {
    const f = fixture(); change(f); const result = await xeroContactRestoreApply(f.request, f.deps);
    assert.equal(result.summary.blocked, 1); assert.equal(f.posts.length, 0);
    assert.equal(result.outcomes[0].salesforceAccountId, f.row.salesforce_account_id); assert.equal(result.outcomes[0].xeroContactId, f.contactId);
  });
});

test('inactive aliases present in the reviewed proof do not block an unchanged exact restoration', async () => {
  const f = fixture(); f.accounts.push({ ...f.account, id: '001000000000002', companyCode: 'HKRETIRED', inactiveSuspended: true });
  f.row.raw_row.restoration = buildContactRestoration(f.account, f.accounts, f.contacts, { tenantId: f.tenantId, accountsComplete: true, contactsComplete: true });
  assert.equal((await xeroContactRestoreApply(f.request, f.deps)).summary.restored, 1);
});

test('lease expiry or durable-intent storage failure prevents sending the POST', async (t) => {
  for (const [name, change] of [
    ['lease expired', (f) => { f.deps.contactDetailReader = async () => { f.tables.xero_contact_lifecycle_locks[0].locked_until = '2000-01-01'; return structuredClone(f.raw); }; }],
    ['intent audit', (f) => { f.client.failAudit = (value) => value.event_type === 'contact_restore_intent'; }],
    ['intent journal', (f) => { f.client.failJournal = (value) => value.raw_row.restoration.journal.state === 'intent'; }],
  ]) await t.test(name, async () => {
    const f = fixture(); change(f); await assert.rejects(xeroContactRestoreApply(f.request, f.deps)); assert.equal(f.posts.length, 0); assert.equal(f.releases(), 1);
  });
});

test('uncertain write is never resent by either the same preview or a later preview', async () => {
  const f = fixture(); f.deps.contactUpdater = async (_c, id, key) => { f.posts.push({ id, key }); throw new Error('timeout'); };
  const first = await xeroContactRestoreApply(f.request, f.deps); assert.equal(first.summary.uncertain, 1); assert.equal(f.posts.length, 1);
  assert.equal((await xeroContactRestoreApply(f.request, f.deps)).summary.uncertain, 1);
  assert.equal((await xeroContactRestoreApply(f.nextPreview(), f.deps)).summary.uncertain, 1); assert.equal(f.posts.length, 1);
  f.raw.ContactStatus = 'ACTIVE'; f.contacts[0].status = 'ACTIVE';
  const recovered = await xeroContactRestoreApply(f.nextPreview(), f.deps);
  assert.equal(recovered.summary.alreadyActive, 1); assert.equal(f.posts.length, 1);
  assert.equal(f.tables.xero_financial_audit_events.at(-1).fingerprints.resolvedOperationIds.length, 1);
});

test('lost POST response can be confirmed by independent readback without another POST', async () => {
  const f = fixture(); const updater = f.deps.contactUpdater;
  f.deps.contactUpdater = async (...args) => { await updater(...args); throw new Error('lost response'); };
  assert.equal((await xeroContactRestoreApply(f.request, f.deps)).summary.restored, 1); assert.equal(f.posts.length, 1);
});

test('changed business fields, missing readback and wrong readback identity remain uncertain', async (t) => {
  for (const [name, change] of [
    ['bank', (f) => { f.raw.BankAccountDetails = 'different'; }], ['address', (f) => { f.raw.Addresses[0].City = 'different'; }],
    ['unexpected new business field', (f) => { f.raw.NewBusinessField = 'different'; }], ['wrong ID', (f) => { f.raw.ContactID = randomUUID(); }],
    ['merged after update', (f) => { f.raw.MergedToContactID = randomUUID(); }],
    ['missing readback', () => {}],
  ]) await t.test(name, async () => {
    const f = fixture(); const updater = f.deps.contactUpdater;
    if (name === 'missing readback') f.deps.contactDetailReader = async () => {
      if (f.posts.length) throw new Error('offline');
      return structuredClone(f.raw);
    };
    f.deps.contactUpdater = async (...args) => { await updater(...args); change(f); };
    const result = await xeroContactRestoreApply(f.request, f.deps); assert.equal(result.summary.uncertain, 1); assert.equal(f.posts.length, 1);
    assert.equal(result.outcomes[0].xeroContactId, f.contactId); assert.equal(f.callbacks(), 0);
  });
});

test('provider observation drift does not masquerade as altered business fields', async () => {
  const f = fixture(); const updater = f.deps.contactUpdater;
  f.deps.contactUpdater = async (...args) => { await updater(...args); f.raw.UpdatedDateUTC = '/Date(1)/'; f.raw.Balances.AccountsPayable.Outstanding = 0; };
  assert.equal((await xeroContactRestoreApply(f.request, f.deps)).summary.restored, 1);
});

test('outcome storage or cache failure cannot cause a confirmed restoration to be resent', async () => {
  const f = fixture(); f.client.failAudit = (value) => value.event_type === 'contact_restore_outcome';
  await assert.rejects(xeroContactRestoreApply(f.request, f.deps)); assert.equal(f.posts.length, 1);
  f.client.failAudit = null; f.deps.onRestored = async () => { throw new Error('cache unavailable'); };
  const recovered = await xeroContactRestoreApply(f.request, f.deps);
  assert.equal(recovered.summary.alreadyActive, 1); assert.equal(f.posts.length, 1); assert.ok(recovered.outcomes[0].warning);
  f.raw.ContactStatus = 'ARCHIVED'; f.contacts[0].status = 'ARCHIVED';
  assert.equal((await xeroContactRestoreApply(f.nextPreview(), f.deps)).summary.uncertain, 1); assert.equal(f.posts.length, 1);
});

test('source or Contact drift keeps an unresolved cross-run intent visibly uncertain with its original evidence', async (t) => {
  for (const [name, change] of [
    ['source name', (f) => { f.account.name = 'CHANGED SOURCE'; }],
    ['global Contact identity', (f) => { f.contacts[0].name = 'CHANGED CONTACT'; }],
    ['raw Contact identity', (f) => { f.raw.AccountNumber = 'CHANGED'; }],
    ['single-record failure', (f) => { f.deps.contactDetailReader = async () => { throw new Error('offline'); }; }],
  ]) await t.test(name, async () => {
    const f = fixture(); f.deps.contactUpdater = async (_c, id, key) => { f.posts.push({ id, key }); throw new Error('lost response'); };
    assert.equal((await xeroContactRestoreApply(f.request, f.deps)).summary.uncertain, 1);
    const intent = structuredClone(f.tables.xero_financial_audit_events.find((event) => event.event_type === 'contact_restore_intent').fingerprints);
    change(f);
    const retry = await xeroContactRestoreApply(f.nextPreview(), f.deps);
    assert.equal(retry.summary.uncertain, 1); assert.equal(retry.summary.blocked, 0); assert.equal(f.posts.length, 1);
    assert.deepEqual(f.tables.xero_contact_lifecycle_rows.at(-1).raw_row.restoration.journal.pendingIntents, [intent]);
  });
});

test('failed outcome journal after successful readback leaves durable intent and permits only readback recovery', async () => {
  const f = fixture(); f.client.failJournal = (value) => value.raw_row.restoration.journal.state === 'restored';
  await assert.rejects(xeroContactRestoreApply(f.request, f.deps)); assert.equal(f.posts.length, 1);
  f.client.failJournal = null;
  assert.equal((await xeroContactRestoreApply(f.nextPreview(), f.deps)).summary.alreadyActive, 1); assert.equal(f.posts.length, 1);
});

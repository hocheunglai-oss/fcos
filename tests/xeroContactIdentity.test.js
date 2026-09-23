import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { contactIdentityDecision, contactIdentityFingerprint, loadContactIdentityDecisions, xeroContactIdentitySave } from '../api/_xeroContactIdentity.js';
import { buildContactLifecycleRows } from '../api/_xeroPortal.js';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';

const tenant = '00000000-0000-4000-8000-000000000001';
const contactId = '00000000-0000-4000-8000-000000000002';
const actor = { id: '00000000-0000-4000-8000-000000000003', email: 'finance@example.test' };
const contact = { contactId, name: 'Verified Port Agent', status: 'ACTIVE', contactNumber: '', accountNumber: '' };
const saved = { tenant_id: tenant, contact_id: contactId, decision: 'verified_xero_only', fingerprint: contactIdentityFingerprint(tenant, contact), revision: 1 };
const body = { tenantId: tenant, contactId, decision: 'verified_xero_only', expectedRevision: 0, expectedFingerprint: saved.fingerprint, reviewed: true, evidenceNote: 'Confirmed with supplier invoice and remittance.', evidenceReference: 'invoice:TEST-2026-01' };

test('verified Xero-only contacts remain kept; changed identities require review even when unused', () => {
  const options = { tenantId: tenant, identityDecisions: new Map([[contactId, saved]]) };
  const [verified] = buildContactLifecycleRows([], [contact], new Map(), options);
  assert.equal(verified.reason, 'verified-xero-only'); assert.equal(verified.action, 'keep');
  for (const change of [{ name: 'Renamed Agent' }, { contactNumber: 'new' }, { accountNumber: 'new' }]) {
    const [stale] = buildContactLifecycleRows([], [{ ...contact, ...change }], new Map(), options);
    assert.equal(stale.action, 'exception'); assert.equal(stale.reason, 'verification-stale');
  }
  assert.equal(contactIdentityDecision('other-tenant', contact, saved), null);
  assert.equal(contactIdentityDecision(tenant, contact, { ...saved, decision: 'revoked' }), null);
  const account = { id: '001000000000001AAA', name: contact.name, companyCode: 'HKAGENT', recordType: 'Supplier' };
  assert.notEqual(buildContactLifecycleRows([account], [contact], new Map(), options)[0].reason, 'verified-xero-only');
  const [newAccountOutsideDeliveryScope] = buildContactLifecycleRows([], [contact], new Map(), { ...options, identityAccounts: [account] });
  assert.equal(newAccountOutsideDeliveryScope.reason, 'verification-stale');
  assert.equal(newAccountOutsideDeliveryScope.action, 'exception');
});

function clientFixture() {
  const state = { saves: [], lease: null, loseLease: false };
  return { state, from(table) {
    assert.equal(table, 'xero_contact_lifecycle_locks');
    return { update(patch) { if (patch.run_id) state.lease = patch; return this; }, eq() { return this; }, lt() { return this; }, select() { return this; }, maybeSingle: async () => ({ data: state.loseLease ? { ...state.lease, locked_until: '2000-01-01' } : state.lease }), then: (resolve) => resolve({ error: null }) };
  }, rpc: async (name, values) => { state.saves.push({ name, values }); return { data: { ...saved, revision: 1 }, error: null }; } };
}
function options(client, contacts = [contact], accounts = []) {
  return { client, accessContext: { profile: actor }, connectionReader: async () => ({ tenantId: tenant }), contactReader: async () => contacts, accountReader: async () => accounts };
}

test('save requires reviewed identity evidence, live identity, human actor, and Finance capability', async () => {
  const client = clientFixture();
  await xeroContactIdentitySave({ ...body, actor: { id: 'fake' } }, options(client));
  assert.equal(client.state.saves[0].values.p_actor_id, actor.id);
  assert.equal(client.state.saves[0].values.p_fingerprint, saved.fingerprint);
  assert.equal(registeredHandlerBehavior('xeroContactIdentitySave').capability, 'xero_portal_manage');
  assert.equal(registeredHandlerBehavior('xeroContactIdentitySave').mutation, true);
  for (const patch of [{ reviewed: false }, { evidenceNote: 'none' }, { expectedRevision: -1 }, { evidenceReference: '' }]) {
    await assert.rejects(xeroContactIdentitySave({ ...body, ...patch }, options(client)), { status: 400 });
  }
  await assert.rejects(xeroContactIdentitySave(body, { ...options(client), accessContext: null }), { status: 403 });
  await assert.rejects(xeroContactIdentitySave({ ...body, expectedFingerprint: 'old' }, options(client)), { code: 'XERO_CONTACT_IDENTITY_STALE' });
  await assert.rejects(xeroContactIdentitySave(body, { ...options(client), connectionReader: async () => ({ tenantId: contactId }) }), /organization changed/);
  assert.equal(client.state.saves.length, 1);
  client.state.loseLease = true;
  await assert.rejects(xeroContactIdentitySave(body, options(client)), { code: 'XERO_CONTACT_IDENTITY_LOCK_LOST' });
  assert.equal(client.state.saves.length, 1);
});

test('Salesforce matches, duplicate Xero names, and placeholders cannot be approved as Xero-only', async () => {
  for (const [contacts, accounts] of [
    [[contact], [{ id: '001000000000001AAA', name: contact.name, companyCode: 'HKAGENT', recordType: 'Supplier' }]],
    [[contact, { ...contact, contactId: actor.id }], []],
    [[contact, { ...contact, contactId: actor.id, name: 'Verified   Port Agent' }], []],
    [[{ ...contact, accountNumber: 'HKKNOWN' }], [{ id: '001000000000001AAA', name: 'Different Company', companyCode: 'HKKNOWN', recordType: 'Supplier' }]],
    [[{ ...contact, contactNumber: '001000000000001' }], [{ id: '001000000000001AAA', name: 'Different Company', companyCode: 'HKKNOWN', recordType: 'Supplier' }]],
    [[{ ...contact, name: 'No Name' }], []],
  ]) {
    const client = clientFixture();
    await assert.rejects(xeroContactIdentitySave({ ...body, expectedFingerprint: contactIdentityFingerprint(tenant, contacts[0]) }, options(client, contacts, accounts)), /Resolve/);
    assert.equal(client.state.saves.length, 0);
  }
});

test('saved decisions read every page and remain scoped to the connected tenant', async () => {
  const seen = [];
  const client = { from: () => ({ select() { return this; }, eq(key, value) { assert.equal(key, 'tenant_id'); assert.equal(value, tenant); return this; }, order() { return this; }, range: async (start, end) => { seen.push([start, end]); return { data: start === 0 ? Array.from({ length: 1000 }, (_, i) => ({ contact_id: String(i) })) : [saved] }; } }) };
  assert.equal((await loadContactIdentityDecisions(client, tenant)).size, 1001);
  assert.deepEqual(seen, [[0, 999], [1000, 1999]]);
});

test('contact identity storage is service-only, revision checked and atomically audited', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
  // Supabase can grant service_role broad default privileges to newly created tables.
  await db.exec('alter default privileges in schema public grant all on tables to service_role; alter default privileges in schema public grant all on sequences to service_role;');
  await db.exec(await readFile(new URL('../supabase/migrations/20260923182327_xero_contact_identity_decisions.sql', import.meta.url), 'utf8'));
  const save = (revision, decision = 'verified_xero_only') => db.query('select * from save_xero_contact_identity_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)', [tenant, contactId, decision, saved.fingerprint, body.evidenceNote, body.evidenceReference, revision, actor.id, actor.email]);
  await db.exec('set role service_role');
  assert.equal((await save(0)).rows[0].revision, 1);
  await assert.rejects(save(0), /changed/);
  assert.equal((await save(1, 'revoked')).rows[0].revision, 2);
  assert.equal((await db.query('select count(*)::int n from xero_contact_identity_audit')).rows[0].n, 2);
  await assert.rejects(db.exec('delete from xero_contact_identity_audit'), /permission denied/);
  await assert.rejects(db.exec('update xero_contact_identity_audit set before_decision=null'), /permission denied/);
  await assert.rejects(db.exec('truncate xero_contact_identity_audit'), /permission denied/);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(save(2), /permission denied/);
    for (const table of ['xero_contact_identity_decisions', 'xero_contact_identity_audit']) await assert.rejects(db.exec(`select * from ${table}`), /permission denied/);
  }
});

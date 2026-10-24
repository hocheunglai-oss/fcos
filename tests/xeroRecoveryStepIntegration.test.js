import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createXeroRecoveryStepProtocol, prepareXeroRecoveryStepRequest, recoveryStepCanonicalJson as canonical,
  recoveryStepSha256 as hash } from '../scripts/lib/hosted-release/xero-recovery-step-protocol.mjs';
import { createXeroRecoveryStepResources } from '../scripts/lib/hosted-release/xero-recovery-step-actions.mjs';
import { xeroRateLimitSnapshot } from '../api/_xeroRateLimit.js';
import { readXeroSharedControlFixture } from './helpers/xero-recovery-fixture.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const TENANT = '10000000-0000-4000-8000-000000000001';
const ACTOR = '20000000-0000-4000-8000-000000000002';
const ORGANISATION = '70000000-0000-4000-8000-000000000007';
const ORIGINAL_ACCESS = 'FIXTURE_PRIVATE_ORIGINAL_ACCESS';
const ORIGINAL_REFRESH = 'FIXTURE_PRIVATE_ORIGINAL_REFRESH';
const ROTATED_ACCESS = 'FIXTURE_PRIVATE_ROTATED_ACCESS';
const ROTATED_REFRESH = 'FIXTURE_PRIVATE_ROTATED_REFRESH';
const SECRET = 'FIXTURE_PRIVATE_SERVICE_SECRET';
const BEARER = 'FIXTURE_PRIVATE_ACTOR_BEARER';
const ORIGIN = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const ORGANISATIONS_URL = 'https://api.xero.com/api.xro/2.0/Organisations';
const MIGRATIONS = ['20260929170347_xero_shared_control.sql', '20261018100701_xero_recovery_private_returned_token_custody.sql',
  '20261018103446_xero_recovery_durable_step_protocol.sql'];
const TABLE_COLUMNS = {
  xero_contact_sync_connections: ['id', 'tenant_id', 'tenant_name', 'token_version', 'expires_at', 'access_token', 'refresh_token', 'scope'],
  xero_token_refresh_leases: ['connection_id', 'tenant_id', 'lease_id', 'expected_version', 'state', 'expires_at'],
  xero_shared_probe_grants: ['id', 'tenant_id', 'consumed_at', 'expires_at', 'reason'],
  xero_shared_requests: ['id'], xero_recovery_token_custody: ['operation_id', 'state', 'approval_sha256'],
};
const RPCS = new Set(['xero_recovery_step_claim', 'xero_recovery_step_complete', 'xero_recovery_step_readback', 'xero_shared_status',
  'xero_recovery_custody_prepare', 'xero_refresh_claim', 'xero_recovery_custody_capture', 'xero_recovery_custody_finish',
  'xero_shared_authorize_probe', 'xero_shared_admit', 'xero_shared_observe']);
const quoted = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/); return `"${value}"`; };
const safe = value => assert.doesNotMatch(JSON.stringify(value), /FIXTURE_PRIVATE_|access_token|refresh_token|accessToken|refreshToken|authorization/);

async function fixture(t, { renew = false, unknownGet = false, loseComplete = null, abortToken = false, knownAtReserve = false } = {}) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.user_profiles(id uuid primary key,active boolean,user_type text);
    grant select on public.user_profiles to service_role;
    create table public.xero_contact_sync_connections(id text primary key,tenant_id text,tenant_name text,token_version integer,
      access_token text,refresh_token text,expires_at timestamptz,scope text,updated_at timestamptz);
    alter table public.xero_contact_sync_connections enable row level security;
    alter table public.xero_contact_sync_connections force row level security;
    revoke all on public.xero_contact_sync_connections from public,anon,authenticated,service_role;
    grant select,insert,update on public.xero_contact_sync_connections to service_role;`);
  for (const migration of MIGRATIONS) await db.exec(migration === '20260929170347_xero_shared_control.sql'
    ? await readXeroSharedControlFixture() : await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  const at = Date.now();
  const binding = { operationId: 'a'.repeat(64), ownerThreadId: '30000000-0000-4000-8000-000000000003', tenantId: TENANT, actorId: ACTOR,
    expectedVersion: 7, refreshLeaseId: '40000000-0000-4000-8000-000000000004', probeId: '50000000-0000-4000-8000-000000000005',
    requestId: '60000000-0000-4000-8000-000000000006', approvalSha256: 'b'.repeat(64), sourceSha256: 'c'.repeat(64), bindingSha256: 'd'.repeat(64),
    organisationIdentitySha256: null, issuedAt: at - 1000, notAfter: at + 600_000,
    // Fixture schema input only: this does not approve the proposed exception.
    credentialPreservationCompositeApproved: true };
  const planJson = canonical({ schemaVersion: 1, kind: 'fcos_xero_recovery_step_plan_v1', binding }), planSha256 = hash(planJson);
  await db.query('insert into public.user_profiles values($1,true,\'administrator\')', [ACTOR]);
  await db.query("insert into public.xero_contact_sync_connections values('primary',$1,'Fixture Organisation',7,$2,$3,$4,'offline_access accounting.settings',null)",
    [TENANT, ORIGINAL_ACCESS, ORIGINAL_REFRESH, new Date(at + (renew ? 30_000 : 3600_000)).toISOString()]);
  if (knownAtReserve) await db.query('insert into public.xero_shared_tenant_control(tenant_id,allowance_known,available_calls,day_remaining,app_day_remaining) values($1,true,200,200,200)', [TENANT]);
  const calls = [], auth = [], controllers = [], owners = [];
  let last = null, lose = loseComplete, oauthPosts = 0, accountingGets = 0, readOnlyGets = 0, tokenController;
  const response = (data, headers = {}) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
  const selectAsService = async (sql, values = [], readOnly = false) => {
    if (readOnly) await db.exec('begin transaction read only');
    await db.exec('set role service_role');
    try {
      const result = await db.query(sql, values);
      if (readOnly) {
        assert.equal((await db.query("select count(*)::integer as n from pg_locks where pid=pg_backend_pid() and locktype='advisory'")).rows[0].n, 0);
        readOnlyGets++;
      }
      await db.exec('reset role'); if (readOnly) await db.exec('commit'); return result;
    } catch (error) {
      if (readOnly) await db.exec('rollback'); else await db.exec('reset role');
      throw error;
    }
  };
  const fetchImpl = async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    const u = new URL(url), h = new Headers(init.headers);
    if (u.origin === ORIGIN) {
      assert.equal(h.get('apikey'), SECRET); assert.equal(h.get('authorization'), `Bearer ${SECRET}`);
      assert.equal(h.get('accept-profile'), 'public'); assert.equal(h.get('content-profile'), 'public');
      if (u.pathname.startsWith('/rest/v1/rpc/')) {
        const name = u.pathname.slice('/rest/v1/rpc/'.length); assert.ok(RPCS.has(name));
        const get = init.method === 'GET'; assert.equal(get, name === 'xero_recovery_step_readback');
        const args = get ? Object.fromEntries(u.searchParams) : JSON.parse(init.body);
        const keys = Object.keys(args); keys.forEach(key => assert.match(key, /^p_[a-z0-9_]+$/));
        const step = args.p_request_json ? JSON.parse(args.p_request_json).step : null;
        calls.push({ kind: 'rpc', name, method: init.method, step });
        const values = Object.values(args).map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value);
        const sql = `select public.${quoted(name)}(${keys.map((key, i) => `${quoted(key)}=>$${i + 1}`).join(',')}) as result`;
        let value;
        try { value = (await selectAsService(sql, values, get)).rows[0].result; }
        catch { return new Response(JSON.stringify({ code: 'FIXTURE_SQL_REFUSED' }), { status: 409, headers: { 'content-type': 'application/json' } }); }
        if (name === 'xero_recovery_step_complete' && step === lose) { lose = null; throw Error('FIXTURE_PRIVATE_LOST_COMPLETE_ACK'); }
        return response(value);
      }
      assert.equal(init.method, 'GET');
      const table = u.pathname.slice('/rest/v1/'.length), allowed = TABLE_COLUMNS[table]; assert.ok(allowed);
      const selected = u.searchParams.get('select').split(','); selected.forEach(key => assert.ok(allowed.includes(key)));
      assert.equal(u.searchParams.get('limit'), '2');
      const filters = [], values = [];
      for (const [key, expression] of u.searchParams) {
        if (['select', 'limit'].includes(key)) continue;
        assert.ok(allowed.includes(key));
        if (expression === 'is.null') { filters.push(`${quoted(key)} is null`); continue; }
        const split = expression.indexOf('.'), operator = expression.slice(0, split), value = expression.slice(split + 1);
        assert.ok(['eq', 'gt', 'like'].includes(operator)); values.push(operator === 'like' ? value.replaceAll('*', '%') : value);
        filters.push(`${quoted(key)} ${operator === 'eq' ? '=' : operator === 'gt' ? '>' : 'like'} $${values.length}`);
      }
      calls.push({ kind: 'rows', table, selected });
      return response((await selectAsService(`select ${selected.map(quoted).join(',')} from public.${quoted(table)} where ${filters.join(' and ')} limit 2`, values)).rows);
    }
    if (url === TOKEN_URL) {
      assert.equal(init.method, 'POST'); assert.equal(h.get('authorization'), `Basic ${Buffer.from('fixture-client:fixture-client-secret').toString('base64')}`);
      const body = new URLSearchParams(init.body); assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('refresh_token'), ORIGINAL_REFRESH);
      oauthPosts++; calls.push({ kind: 'provider', name: 'oauthToken' });
      if (abortToken) tokenController.abort();
      return response({ access_token: ROTATED_ACCESS, refresh_token: ROTATED_REFRESH, expires_in: 3600, scope: 'offline_access accounting.settings' });
    }
    assert.equal(url, ORGANISATIONS_URL); assert.equal(init.method, 'GET'); assert.equal(h.get('xero-tenant-id'), TENANT);
    assert.equal(h.get('authorization'), `Bearer ${renew ? ROTATED_ACCESS : ORIGINAL_ACCESS}`);
    accountingGets++; calls.push({ kind: 'provider', name: 'organisations' });
    if (unknownGet) throw Error('FIXTURE_PRIVATE_UNKNOWN_PROVIDER_RESPONSE');
    return response({ Organisations: [{ OrganisationID: ORGANISATION, Name: 'Fixture Organisation', OrganisationStatus: 'ACTIVE' }] },
      { 'x-daylimit-remaining': '500', 'x-appdaylimit-remaining': '480', 'x-minlimit-remaining': '59', 'x-appminlimit-remaining': '999' });
  };
  const owner = () => {
    const controller = new AbortController(); controllers.push(controller);
    const resources = createXeroRecoveryStepResources({ planJson, privateEnvironment: { SUPABASE_URL: ORIGIN, SUPABASE_SECRET_KEY: SECRET,
      XERO_CLIENT_ID: 'fixture-client', XERO_CLIENT_SECRET: 'fixture-client-secret' }, rateSnapshot: xeroRateLimitSnapshot, fetchImpl });
    const protocol = createXeroRecoveryStepProtocol({ planJson, store: resources.store, execute: resources.execute,
      authenticate: async input => {
        assert.equal(input.bearer, BEARER); assert.equal(input.actorId, ACTOR); assert.ok(input.signal instanceof AbortSignal); auth.push('fresh-fixture-actor-check');
        return { id: ACTOR, active: true, readOnlyCi: false, role: 'administrator', workspace: true, xeroPortalManage: true, capturedAt: Date.now() };
      } });
    const item = { controller, resources, protocol }; owners.push(item); return item;
  };
  const original = owner();
  const submit = async (step, { current = original, previous = last } = {}) => {
    const request = prepareXeroRecoveryStepRequest({ planJson, step, submissionId: randomUUID(), previousResultSha256: previous });
    if (step === 'tokenRenewAndCapture') tokenController = current.controller;
    const value = await current.protocol.submit({ rawRequestJson: request.requestJson, bearer: BEARER, signal: current.controller.signal });
    safe(value); last = value.resultSha256; return value;
  };
  const sequence = ['preflight', 'custodyPrepare', ...(renew ? ['refreshClaim', 'tokenRenewAndCapture', 'refreshFinish'] : []),
    'sessionVerify', 'probeGrant', 'probeAdmission', 'organisationsGet', 'probeObservation', 'finalRead'];
  const until = async step => { for (const item of sequence) { if (item === step) return; await submit(item); } throw Error('Unknown fixture step'); };
  const readback = async current => { const value = await current.protocol.readback({ bearer: BEARER, signal: current.controller.signal }); safe(value); return value; };
  const stored = async () => (await db.query('select public.xero_recovery_step_readback($1,$2) as result', [binding.operationId, planSha256])).rows[0].result;
  t.after(() => { controllers.forEach(controller => controller.abort()); });
  return { db, binding, planJson, planSha256, calls, auth, owners, owner, original, submit, until, sequence, readback, stored,
    get previous() { return last; }, get oauthPosts() { return oauthPosts; }, get accountingGets() { return accountingGets; }, get readOnlyGets() { return readOnlyGets; } };
}

async function stopped(operation) {
  await assert.rejects(operation, error => { safe({ message: error.message, ...error }); assert.equal(error.retryable, false); return true; });
}

for (const renew of [false, true]) test(`real JS/SQL integration: ${renew ? 'renewal' : 'fresh-session'} branch`, async t => {
  const f = await fixture(t, { renew });
  let last;
  for (const step of f.sequence) { last = await f.submit(step); assert.equal(last.step, step); }
  assert.equal(last.state, 'complete'); assert.equal(last.nextStep, null); assert.equal(last.qualificationAccepted, false);
  assert.equal(f.oauthPosts, renew ? 1 : 0); assert.equal(f.accountingGets, 1); assert.equal(f.auth.length, f.sequence.length);
  assert.deepEqual(f.original.resources.metrics(), { databaseRequests: renew ? 41 : 30, oauthPosts: renew ? 1 : 0, accountingGets: 1 });
  const primary = (await f.db.query("select token_version,access_token,refresh_token from public.xero_contact_sync_connections where id='primary'")).rows[0];
  assert.equal(primary.token_version, renew ? 8 : 7); assert.equal(primary.access_token, renew ? ROTATED_ACCESS : ORIGINAL_ACCESS);
  assert.equal(primary.refresh_token, renew ? ROTATED_REFRESH : ORIGINAL_REFRESH);
  const custody = (await f.db.query('select state,returned_access_token,returned_refresh_token from public.xero_recovery_token_custody')).rows[0];
  assert.equal(custody.state, renew ? 'finished' : 'prepared'); assert.equal(custody.returned_access_token, null); assert.equal(custody.returned_refresh_token, null);
  const shared = (await f.db.query('select public.xero_shared_status($1) as result', [TENANT])).rows[0].result;
  assert.equal(shared.allowanceKnown, true); assert.equal(shared.availableCalls, 480); assert.equal(shared.spendableCalls, 280);
  assert.equal(shared.reserve, 200); assert.equal(shared.inFlight, 0); assert.equal(shared.unresolvedWrites, 0);
  assert.deepEqual(last.result, { allowanceKnown: true, availableCalls: 480, spendableCalls: 280, reserve: 200, retryAt: null, observedAt: shared.rateLimit.observedAt });
  assert.equal((await f.db.query('select count(*)::integer as n from public.xero_shared_requests')).rows[0].n, 1);
  assert.equal((await f.db.query('select state from public.xero_shared_requests')).rows[0].state, 'complete');
  assert.equal((await f.db.query('select count(*)::integer as n from public.xero_recovery_step_acknowledgements')).rows[0].n, f.sequence.length);
});

test('lost complete acknowledgement resumes only through a fresh owner GET readback without repeating the Xero GET', async t => {
  const f = await fixture(t, { loseComplete: 'organisationsGet' }); await f.until('organisationsGet');
  await stopped(() => f.submit('organisationsGet'));
  assert.equal(f.accountingGets, 1); assert.equal((await f.stored()).nextStep, 'probeObservation');
  const endedAt = f.calls.length; await stopped(() => f.readback(f.original)); assert.equal(f.calls.length, endedAt);
  const freshOwner = f.owner(); const before = f.calls.length; const saved = await f.readback(freshOwner);
  assert.equal(f.readOnlyGets, 1); assert.deepEqual(f.calls.slice(before).map(call => [call.name, call.method]), [['xero_recovery_step_readback', 'GET']]);
  assert.equal(saved.state, 'ready'); assert.equal(saved.nextStep, 'probeObservation'); assert.equal(saved.executionAuthorityGranted, false);
  assert.equal(saved.lastResultSha256, hash(canonical(saved.checkpoint.organisationsGet)));
  await f.submit('probeObservation', { current: freshOwner, previous: saved.lastResultSha256 });
  assert.equal((await f.submit('finalRead', { current: freshOwner })).state, 'complete');
  assert.equal(f.accountingGets, 1); assert.equal(f.oauthPosts, 0);
});

test('unknown provider GET leaves both real stores unresolved and a new owner cannot replay it', async t => {
  const f = await fixture(t, { unknownGet: true }); await f.until('organisationsGet');
  const before = f.calls.length; await stopped(() => f.submit('organisationsGet'));
  assert.equal(f.accountingGets, 1);
  assert.equal(f.calls.slice(before).filter(call => call.name === 'xero_recovery_step_complete' || call.name === 'xero_shared_observe').length, 0);
  const receipt = (await f.db.query('select state,response_status,outcome_unknown from public.xero_shared_requests')).rows[0];
  assert.deepEqual(receipt, { state: 'inflight', response_status: null, outcome_unknown: false });
  const freshOwner = f.owner(); const saved = await f.readback(freshOwner);
  assert.equal(saved.state, 'submitted_unknown'); assert.equal(saved.currentStep, 'organisationsGet'); assert.equal(saved.nextStep, null);
  await stopped(() => f.submit('organisationsGet', { current: freshOwner, previous: saved.lastResultSha256 }));
  assert.equal(f.accountingGets, 1); assert.equal((await f.stored()).state, 'submitted_unknown');
});

test('approved reserve probe debits 200 to 199 on unknown GET without observation or replay', async t => {
  const f = await fixture(t, { unknownGet: true, knownAtReserve: true });
  await f.until('probeAdmission');
  const beforeAdmission = (await f.db.query('select public.xero_shared_status($1) as result', [TENANT])).rows[0].result;
  assert.equal(beforeAdmission.availableCalls, 200); assert.equal(beforeAdmission.reserve, 200); assert.equal(beforeAdmission.spendableCalls, 0);
  await f.submit('probeAdmission');
  const beforeGet = f.calls.length; await stopped(() => f.submit('organisationsGet'));
  assert.equal(f.accountingGets, 1); assert.equal(f.oauthPosts, 0);
  assert.equal(f.calls.slice(beforeGet).filter(call => call.name === 'xero_shared_observe' || call.name === 'xero_recovery_step_complete').length, 0);
  const after = (await f.db.query('select public.xero_shared_status($1) as result', [TENANT])).rows[0].result;
  assert.equal(after.allowanceKnown, true); assert.equal(after.availableCalls, 199); assert.equal(after.reserve, 200); assert.equal(after.spendableCalls, 0);
  assert.equal(after.inFlight, 1); assert.equal(after.minuteCalls, 1);
  const freshOwner = f.owner(); const saved = await f.readback(freshOwner);
  assert.equal(saved.state, 'submitted_unknown'); assert.equal(saved.nextStep, null);
  await stopped(() => f.submit('organisationsGet', { current: freshOwner, previous: saved.lastResultSha256 }));
  assert.equal(f.accountingGets, 1);
  assert.equal((await f.db.query('select available_calls from public.xero_shared_tenant_control')).rows[0].available_calls, 199);
  assert.equal(f.calls.slice(beforeGet).filter(call => call.name === 'xero_shared_observe').length, 0);
});

test('caller cancellation after admitted token dispatch captures once but cannot complete, finish or probe', async t => {
  // Exercising proposed exception mechanics with fixtures is not approval to use it.
  const f = await fixture(t, { renew: true, abortToken: true }); await f.until('tokenRenewAndCapture');
  const before = f.calls.length; await stopped(() => f.submit('tokenRenewAndCapture'));
  const tail = f.calls.slice(before);
  assert.equal(f.original.controller.signal.aborted, true); assert.equal(f.oauthPosts, 1); assert.equal(f.accountingGets, 0);
  assert.equal(tail.filter(call => call.name === 'xero_recovery_custody_capture').length, 1);
  assert.equal(tail.filter(call => ['xero_recovery_step_complete', 'xero_recovery_custody_finish', 'xero_shared_authorize_probe', 'xero_shared_admit'].includes(call.name)).length, 0);
  const custody = (await f.db.query('select state,returned_refresh_token from public.xero_recovery_token_custody')).rows[0];
  assert.equal(custody.state, 'captured'); assert.equal(custody.returned_refresh_token, ROTATED_REFRESH);
  assert.equal((await f.db.query("select token_version from public.xero_contact_sync_connections where id='primary'")).rows[0].token_version, 7);
  const saved = await f.readback(f.owner()); assert.equal(saved.state, 'submitted_unknown'); assert.equal(saved.currentStep, 'tokenRenewAndCapture');
  assert.equal(saved.checkpoint.tokenRenewAndCapture, undefined);
});

test('a real expired refresh lease refuses OAuth before dispatch and leaves the token step unknown', async t => {
  const f = await fixture(t, { renew: true }); await f.until('tokenRenewAndCapture');
  const lease = (await f.db.query("select lease_id,expected_version,state,expires_at from public.xero_token_refresh_leases where connection_id='primary'")).rows[0];
  assert.equal(lease.lease_id, f.binding.refreshLeaseId); assert.equal(lease.expected_version, 7); assert.equal(lease.state, 'refreshing');
  assert.ok(Date.parse(lease.expires_at) > Date.now() + 80_000 && Date.parse(lease.expires_at) <= Date.now() + 90_000);
  await f.db.exec("update public.xero_token_refresh_leases set expires_at=clock_timestamp()-interval '1 second'");
  const before = f.calls.length; await stopped(() => f.submit('tokenRenewAndCapture'));
  assert.equal(f.oauthPosts, 0); assert.equal(f.accountingGets, 0);
  assert.equal(f.calls.slice(before).filter(call => call.name === 'xero_recovery_custody_capture' || call.name === 'xero_recovery_step_complete').length, 0);
  assert.equal((await f.stored()).state, 'submitted_unknown');
});

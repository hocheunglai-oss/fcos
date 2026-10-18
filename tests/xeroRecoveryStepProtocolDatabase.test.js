import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

const MIGRATION = '20261018103446_xero_recovery_durable_step_protocol.sql';
const WINDOW_MIGRATION = '20261019190000_xero_recovery_v2_window.sql';
const TABLES = ['xero_recovery_step_operations', 'xero_recovery_step_attempts', 'xero_recovery_step_acknowledgements'];
const TENANT = '10000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const canonical = value => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
const hash = value => createHash('sha256').update(value).digest('hex');
const plan = (changes, version = 1) => {
  const now = Date.now();
  const value = { schemaVersion: version, kind: `fcos_xero_recovery_step_plan_v${version}`, binding: {
    operationId: 'a'.repeat(64), ownerThreadId: OTHER, tenantId: TENANT, actorId: '30000000-0000-4000-8000-000000000003',
    expectedVersion: 7, refreshLeaseId: '40000000-0000-4000-8000-000000000004', probeId: '50000000-0000-4000-8000-000000000005',
    requestId: '60000000-0000-4000-8000-000000000006', approvalSha256: 'b'.repeat(64), sourceSha256: 'c'.repeat(64),
    bindingSha256: 'd'.repeat(64), organisationIdentitySha256: null, issuedAt: now - 1000, notAfter: now + 600_000,
    credentialPreservationCompositeApproved: true, ...changes } };
  const json = canonical(value); return { value, json, sha: hash(json) };
};
const request = (p, step = 'preflight', previousResultSha256 = null, changes = {}) => {
  const value = { schemaVersion: 1, operationId: p.value.binding.operationId, planSha256: p.sha, step,
    submissionId: randomUUID(), previousResultSha256, ...changes };
  const json = canonical(value); return { value, json, sha: hash(json) };
};
const configured = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
const bindir = configured.status === 0 ? configured.stdout.trim() : null;
const nativeAvailable = bindir && existsSync(join(bindir, 'initdb'));

async function fixture(t, native) {
  let db, query, exec, newClient;
  if (native) {
    const directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'fcos-step-pg-'));
    const data = join(directory, 'data'), port = 54622;
    let started = false;
    const config = { host: directory, port, user: 'postgres', database: 'postgres' };
    t.after(async () => {
      await db?.end();
      if (started) execFileSync(join(bindir, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
      await rm(directory, { recursive: true, force: true });
    });
    execFileSync(join(bindir, 'initdb'), ['-D', data, '--username=postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
    execFileSync(join(bindir, 'pg_ctl'), ['-D', data, '-l', join(directory, 'server.log'), '-o', `-k ${directory} -h '' -p ${port}`, '-w', 'start'], { stdio: 'pipe' });
    started = true;
    db = new pg.Client(config); await db.connect(); query = (sql, values = []) => db.query(sql, values); exec = sql => db.query(sql);
    newClient = async () => { const client = new pg.Client(config); await client.connect(); return client; };
  } else {
    db = new PGlite(); query = (sql, values = []) => db.query(sql, values); exec = sql => db.exec(sql);
    t.after(() => db.close());
  }
  // Deliberately no credential columns and no provider executor in this fixture.
  // Domain results below simulate separately admitted actions; SQL passes prove
  // store invariants, not provider execution or the original Mac lease.
  await exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.xero_contact_sync_connections(id text primary key,tenant_id text,token_version integer,expires_at timestamptz);
    grant select on public.xero_contact_sync_connections to service_role;`);
  await exec(await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8'));
  const metadataSql = `select oid::text,proowner::text,proacl::text,prosecdef,proconfig from pg_proc where oid='public.xero_recovery_step_input(text,text,text,text)'::regprocedure`;
  const originalInputMetadata = (await query(metadataSql)).rows;
  await exec(await readFile(new URL(`../supabase/migrations/${WINDOW_MIGRATION}`, import.meta.url), 'utf8'));
  assert.deepEqual((await query(metadataSql)).rows, originalInputMetadata, 'Additive replacement preserves function identity, owner, ACL, invoker and search_path');
  const role = async (name, sql, values = [], client = { query }) => {
    assert.ok(['anon', 'authenticated', 'service_role'].includes(name));
    await client.query(`set role ${name}`);
    try { return await client.query(sql, values); } finally { await client.query('reset role'); }
  };
  const rpc = async (name, p, q, resultJson, client) => {
    assert.ok(['claim', 'complete', 'readback'].includes(name));
    const values = name === 'readback' ? [p.value.binding.operationId, p.sha] : [p.json, p.sha, q.json, q.sha];
    if (name === 'complete') values.push(resultJson);
    return (await role('service_role', `select public.xero_recovery_step_${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) as result`, values, client)).rows[0].result;
  };
  let expiry, renewed = false, last = null, p;
  const reset = async (renewalRequired = false, changes = {}) => {
    p = plan(changes); last = null; renewed = renewalRequired;
    expiry = new Date(Date.now() + (renewalRequired ? 30_000 : 3600_000)).toISOString();
    await exec(`truncate ${TABLES.map(x => `public.${x}`).join(',')},public.xero_contact_sync_connections`);
    await query("insert into public.xero_contact_sync_connections values('primary',$1,7,$2)", [TENANT, expiry]);
    return p;
  };
  const result = step => {
    const now = new Date().toISOString();
    const results = {
      preflight: { renewalRequired: renewed, tokenVersion: 7, expiresAt: expiry, observedAt: now },
      custodyPrepare: { state: 'prepared' }, refreshClaim: { state: 'claimed' }, tokenRenewAndCapture: { state: 'captured' },
      refreshFinish: { state: 'finished', tokenVersion: 8 }, sessionVerify: { tokenVersion: renewed ? 8 : 7, expiresAt: expiry },
      probeGrant: { notBefore: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString() },
      probeAdmission: { deadlineAt: new Date(Date.now() + 120_000).toISOString() },
      organisationsGet: { status: 200, snapshot: { dayRemaining: 500, rateLimitProblem: null, retryAfterSeconds: null, retryAt: null, dayResetAt: null, observedAt: now }, organisationIdentitySha256: 'e'.repeat(64), storedTenantNameMatches: true },
      probeObservation: { recorded: true }, finalRead: { allowanceKnown: true, availableCalls: 500, spendableCalls: 300, reserve: 200, retryAt: null, observedAt: now },
    };
    return results[step];
  };
  const steps = () => ['preflight', 'custodyPrepare', ...(renewed ? ['refreshClaim', 'tokenRenewAndCapture', 'refreshFinish'] : []), 'sessionVerify', 'probeGrant', 'probeAdmission', 'organisationsGet', 'probeObservation', 'finalRead'];
  const accept = async (step, raw) => {
    const q = request(p, step, last); const claimed = await rpc('claim', p, q);
    assert.equal(claimed.decision, 'execute'); assert.equal(claimed.state, 'submitted_unknown');
    const json = raw || canonical(result(step)); const completed = await rpc('complete', p, q, json);
    assert.equal(completed.resultSha256, hash(json)); last = completed.resultSha256;
    if (step === 'refreshFinish') {
      expiry = new Date(Date.now() + 3600_000).toISOString();
      await query("update public.xero_contact_sync_connections set token_version=8,expires_at=$1 where id='primary'", [expiry]);
    }
    return { q, json, completed };
  };
  const to = async step => { for (const item of steps()) { if (item === step) return; await accept(item); } throw Error('Unknown fixture step'); };
  const counts = async () => (await query(`select (select count(*)::integer from public.${TABLES[0]}) as operations,
    (select count(*)::integer from public.${TABLES[1]}) as attempts,(select count(*)::integer from public.${TABLES[2]}) as acknowledgements`)).rows[0];
  return { db, query, exec, role, rpc, reset, result, accept, to, steps, counts, newClient, get plan() { return p; }, get last() { return last; } };
}
async function refused(operation) {
  await assert.rejects(operation, error => {
    // PGlite attaches local input query/params; inspect server diagnostics only.
    const server = Object.fromEntries(['message', 'detail', 'hint', 'where', 'code'].map(key => [key, error[key]]));
    assert.doesNotMatch(JSON.stringify(server), /PRIVATE_SECRET|access_token|refresh_token|Bearer /); return true;
  });
}

for (const native of [false, true]) {
  test(`${native ? 'native PostgreSQL' : 'PGlite'} durable Xero recovery step protocol`,
    { skip: native && !nativeAvailable && process.env.FCOS_REQUIRE_NATIVE_XERO_STEPS !== '1' }, async t => {
      if (native) assert.ok(nativeAvailable, 'Native PostgreSQL is required by the explicit fixture gate.');
      const f = await fixture(t, native);
      const scenario = async (name, run, renewal = false, changes = {}) => t.test(name, async () => { await f.reset(renewal, changes); await run(); });

      await scenario('v1 unknown and its original raw plan cannot be converted to an extended v2 plan', async () => {
        const original = f.plan, q = request(original); await f.rpc('claim', original, q);
        const converted = plan({ ...original.value.binding, notAfter: original.value.binding.issuedAt + 1800000 }, 2);
        await refused(() => f.rpc('claim', converted, request(converted)));
        await refused(() => f.rpc('complete', converted, request(converted, 'preflight', null, { submissionId: q.value.submissionId }), canonical(f.result('preflight'))));
        const saved = await f.rpc('readback', original); assert.equal(saved.state, 'submitted_unknown');
        const row = (await f.query('select plan_json,plan_sha256 from public.xero_recovery_step_operations where operation_id=$1', [original.value.binding.operationId])).rows[0];
        assert.equal(row.plan_json, original.json); assert.equal(row.plan_sha256, original.sha);
        assert.deepEqual(await f.counts(), { operations: 1, attempts: 1, acknowledgements: 0 });
      });

      await scenario('v2 alone admits a 30-minute envelope while v1 and mixed versions retain their old refusal', async () => {
        const now = Date.now(), later = { issuedAt: now - 901000, notAfter: now + 899000 };
        const v1 = plan(later), v2 = plan(later, 2), excessive = plan({ issuedAt: now, notAfter: now + 1800001 }, 2);
        await refused(() => f.rpc('claim', v1, request(v1)));
        await refused(() => f.rpc('claim', excessive, request(excessive)));
        for (const change of [{ schemaVersion: 1 }, { schemaVersion: 3 }, { schemaVersion: null }, { schemaVersion: '2' },
          { kind: null }, { kind: 2 }, { kind: true }, { kind: [] }, { kind: {} }, { kind: '' }]) {
          const value = { ...v2.value, ...change }, json = canonical(value), mixed = { value, json, sha: hash(json) };
          await refused(() => f.rpc('claim', mixed, request(mixed)));
        }
        assert.deepEqual(await f.counts(), { operations: 0, attempts: 0, acknowledgements: 0 });
        const q = request(v2); assert.equal((await f.rpc('claim', v2, q)).decision, 'execute');
        assert.equal((await f.rpc('readback', v2)).state, 'submitted_unknown');
        await refused(() => f.rpc('claim', v2, q));
        // Existing approval uniqueness blocks a new v2 operation adopting this
        // outcome, and a changed deadline cannot acknowledge its original claim.
        const other = plan({ ...later, operationId: 'e'.repeat(64) }, 2);
        await refused(() => f.rpc('claim', other, request(other)));
        const changed = plan({ ...later, notAfter: later.notAfter - 1 }, 2);
        await refused(() => f.rpc('complete', changed, request(changed, 'preflight', null, { submissionId: q.value.submissionId }), canonical(f.result('preflight'))));
        assert.deepEqual(await f.counts(), { operations: 1, attempts: 1, acknowledgements: 0 });
        const complete = await f.rpc('complete', v2, q, canonical(f.result('preflight')));
        assert.equal(complete.state, 'ready'); assert.equal(complete.nextStep, 'custodyPrepare');
      });

      for (const renew of [false, true]) await scenario(`fixed ${renew ? 'renewal' : 'fresh-session'} branch completes without a replay route`, async () => {
        for (const step of f.steps()) await f.accept(step);
        const state = await f.rpc('readback', f.plan);
        assert.equal(state.state, 'complete'); assert.equal(state.nextStep, null); assert.equal(state.executionAuthorityGranted, false);
        assert.deepEqual(Object.keys(state.checkpoint).sort(), [...f.steps()].sort());
        assert.deepEqual(await f.counts(), { operations: 1, attempts: renew ? 11 : 8, acknowledgements: renew ? 11 : 8 });
        await refused(() => f.rpc('claim', f.plan, request(f.plan, 'preflight')));
      }, renew);

      await scenario('unknown final allowance remains a typed observation with nullable counters and timestamps', async () => {
        await f.to('finalRead');
        const raw = canonical({ allowanceKnown: false, availableCalls: null, spendableCalls: null, reserve: 200, retryAt: null, observedAt: null });
        await f.accept('finalRead', raw);
        const saved = await f.rpc('readback', f.plan);
        assert.equal(saved.state, 'complete'); assert.equal(saved.checkpoint.finalRead.allowanceKnown, false);
        assert.equal(saved.checkpoint.finalRead.availableCalls, null); assert.equal(saved.executionAuthorityGranted, false);
      });

      await scenario('session verification rejects a primary-version change without acknowledging the step', async () => {
        await f.to('sessionVerify'); const q = request(f.plan, 'sessionVerify', f.last); await f.rpc('claim', f.plan, q);
        await f.query("update public.xero_contact_sync_connections set token_version=8 where id='primary'");
        await refused(() => f.rpc('complete', f.plan, q, canonical(f.result('sessionVerify'))));
        assert.equal((await f.rpc('readback', f.plan)).state, 'submitted_unknown');
      });

      await scenario('claim is a durable unknown before any action; lost claim acknowledgement never authorizes another action', async () => {
        assert.deepEqual(await f.counts(), { operations: 0, attempts: 0, acknowledgements: 0 });
        const q = request(f.plan); await f.rpc('claim', f.plan, q);
        const state = await f.rpc('readback', f.plan);
        assert.equal(state.state, 'submitted_unknown'); assert.equal(state.nextStep, null); assert.deepEqual(state.checkpoint, {});
        await refused(() => f.rpc('claim', f.plan, q));
        await refused(() => f.rpc('claim', f.plan, request(f.plan)));
        await refused(() => f.rpc('claim', f.plan, request(f.plan, 'custodyPrepare')));
        assert.deepEqual(await f.counts(), { operations: 1, attempts: 1, acknowledgements: 0 });
      });

      await scenario('crash after the external action but before complete remains unknown and prevents action replay', async () => {
        let simulatedActions = 0;
        const q = request(f.plan); if ((await f.rpc('claim', f.plan, q)).decision === 'execute') simulatedActions++;
        // Simulate an action having happened, with its result/acknowledgement lost.
        await refused(() => f.rpc('claim', f.plan, request(f.plan)));
        assert.equal(simulatedActions, 1); assert.equal((await f.rpc('readback', f.plan)).state, 'submitted_unknown');
      });

      await scenario('lost complete acknowledgement is resolved by readback without repeating complete or the action', async () => {
        const q = request(f.plan); await f.rpc('claim', f.plan, q);
        const raw = JSON.stringify(f.result('preflight'), null, 2);
        await f.rpc('complete', f.plan, q, raw); // Deliberately ignore returned ack.
        const saved = await f.rpc('readback', f.plan);
        assert.equal(saved.state, 'ready'); assert.equal(saved.nextStep, 'custodyPrepare'); assert.equal(saved.lastResultSha256, hash(raw));
        await refused(() => f.rpc('complete', f.plan, q, raw));
        await refused(() => f.rpc('claim', f.plan, request(f.plan, 'custodyPrepare', hash(canonical(f.result('preflight'))))));
        // This separate request models separately admitted native-owner work.
        assert.equal((await f.rpc('claim', f.plan, request(f.plan, 'custodyPrepare', saved.lastResultSha256))).decision, 'execute');
      });

      await scenario('wrong step, submission, previous hash and request raw hash cannot advance an unknown submission', async () => {
        const q = request(f.plan); await f.rpc('claim', f.plan, q);
        for (const bad of [request(f.plan), request(f.plan, 'custodyPrepare'), { ...q, sha: 'f'.repeat(64) }])
          await refused(() => f.rpc('complete', f.plan, bad, canonical(f.result('preflight'))));
        assert.deepEqual(await f.counts(), { operations: 1, attempts: 1, acknowledgements: 0 });
      });

      await scenario('previous-result CAS rejects null or mismatched hashes on the next step', async () => {
        await f.accept('preflight');
        await refused(() => f.rpc('claim', f.plan, request(f.plan, 'custodyPrepare')));
        await refused(() => f.rpc('claim', f.plan, request(f.plan, 'custodyPrepare', 'f'.repeat(64))));
        assert.equal((await f.rpc('claim', f.plan, request(f.plan, 'custodyPrepare', f.last))).decision, 'execute');
      });

      for (const renew of [false, true]) await scenario('branch cannot be selected by a skipping caller', async () => {
        await f.accept('preflight'); await f.accept('custodyPrepare');
        const step = renew ? 'sessionVerify' : 'refreshClaim';
        await refused(() => f.rpc('claim', f.plan, request(f.plan, step, f.last)));
        assert.equal((await f.rpc('readback', f.plan)).nextStep, renew ? 'refreshClaim' : 'sessionVerify');
      }, renew);

      await scenario('same approval is globally exclusive across changed operations and immutable actor/plan bindings', async () => {
        const q = request(f.plan); await f.rpc('claim', f.plan, q);
        const other = plan({ operationId: 'e'.repeat(64) });
        await refused(() => f.rpc('claim', other, request(other)));
        for (const changes of [{ actorId: OTHER }, { ownerThreadId: TENANT }, { sourceSha256: 'f'.repeat(64) }, { approvalSha256: 'f'.repeat(64) }]) {
          const changed = plan({ ...f.plan.value.binding, ...changes });
          await refused(() => f.rpc('claim', changed, request(changed)));
        }
        assert.deepEqual(await f.counts(), { operations: 1, attempts: 1, acknowledgements: 0 });
      });

      await scenario('strict canonical plan/request bytes, raw SHA and schemas reject client fields and duplicates', async () => {
        const q = request(f.plan);
        const badPlanJson = f.plan.json.replace('"binding":', '"accessToken":"PRIVATE_SECRET","binding":');
        const duplicatePlan = f.plan.json.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
        for (const json of [badPlanJson, duplicatePlan, JSON.stringify(f.plan.value, null, 2)]) {
          const bad = { ...f.plan, json, sha: hash(json) };
          await refused(() => f.rpc('claim', bad, request(bad)));
        }
        await refused(() => f.rpc('claim', { ...f.plan, sha: 'f'.repeat(64) }, q));
        const badRequestJson = canonical({ ...q.value, actorId: OTHER });
        await refused(() => f.rpc('claim', f.plan, { ...q, json: badRequestJson, sha: hash(badRequestJson) }));
        assert.deepEqual(await f.counts(), { operations: 0, attempts: 0, acknowledgements: 0 });
      });

      await scenario('new finite plan window permits fifteen minutes and rejects stale or excessive windows', async () => {
        const now = Date.now(); const extended = plan({ issuedAt: now, notAfter: now + 900_000 });
        assert.equal((await f.rpc('claim', extended, request(extended))).decision, 'execute');
        for (const changes of [{ issuedAt: Date.now() - 1000, notAfter: Date.now() + 900_001 }, { issuedAt: Date.now() - 10_000, notAfter: Date.now() - 1 }]) {
          const bad = plan({ ...changes, operationId: 'e'.repeat(64), approvalSha256: 'f'.repeat(64) });
          await refused(() => f.rpc('claim', bad, request(bad)));
        }
      });

      for (const change of [r => ({ ...r, renewalRequired: !r.renewalRequired }), r => ({ ...r, observedAt: '2000-01-01T00:00:00.000Z' }),
        r => ({ ...r, observedAt: new Date(Date.now() + 60_000).toISOString() }), r => ({ ...r, expiresAt: new Date(Date.now() + 7200_000).toISOString() })])
        await scenario('preflight branch, freshness and actual primary expiry are independently checked', async () => {
          const q = request(f.plan); await f.rpc('claim', f.plan, q);
          await refused(() => f.rpc('complete', f.plan, q, canonical(change(f.result('preflight')))));
          assert.equal((await f.rpc('readback', f.plan)).state, 'submitted_unknown');
        });

      for (const step of ['preflight', 'custodyPrepare', 'refreshClaim', 'tokenRenewAndCapture', 'refreshFinish', 'sessionVerify', 'probeGrant', 'probeAdmission', 'organisationsGet', 'probeObservation', 'finalRead'])
        await scenario(`${step} rejects extra raw secret keys instead of persisting them`, async () => {
          await f.to(step); const q = request(f.plan, step, f.last); await f.rpc('claim', f.plan, q);
          const bad = { ...f.result(step), access_token: 'PRIVATE_SECRET' };
          if (step === 'organisationsGet') { delete bad.access_token; bad.snapshot.authorization = 'Bearer PRIVATE_SECRET'; }
          await refused(() => f.rpc('complete', f.plan, q, canonical(bad)));
          const saved = await f.rpc('readback', f.plan);
          assert.equal(saved.state, 'submitted_unknown'); assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_SECRET|access_token|authorization/);
        }, true);

      await scenario('expiry never takes over an unknown attempt and expired readback is SELECT-only', async () => {
        const short = plan({ issuedAt: Date.now() - 1000, notAfter: Date.now() + 180 });
        const q = request(short); await f.rpc('claim', short, q);
        await new Promise(resolve => setTimeout(resolve, 220));
        await refused(() => f.rpc('claim', short, request(short)));
        await refused(() => f.rpc('complete', short, q, canonical(f.result('preflight'))));
        await f.exec('begin transaction read only');
        try {
          const saved = await f.rpc('readback', short); assert.equal(saved.state, 'submitted_unknown'); assert.equal(saved.nextStep, null);
          assert.equal((await f.query("select count(*)::integer as n from pg_locks where pid=pg_backend_pid() and locktype='advisory'")).rows[0].n, 0);
        } finally { await f.exec('rollback'); }
      });

      await scenario('append-only rows cannot be mutated or removed and browser roles cannot inspect or execute', async () => {
        await f.accept('preflight');
        for (const table of TABLES) {
          for (const operation of [`update public.${table} set ${table === TABLES[0] ? "approval_sha256='f'" : table === TABLES[1] ? "step='finalRead'" : "result_json='{}'"}`, `delete from public.${table}`, `truncate public.${table} cascade`])
            await refused(() => f.role('service_role', operation));
          await refused(() => f.query(`delete from public.${table}`));
          for (const role of ['anon', 'authenticated']) await refused(() => f.role(role, `select * from public.${table}`));
          const acl = (await f.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass', [`public.${table}`])).rows[0];
          assert.deepEqual(acl, { relrowsecurity: true, relforcerowsecurity: true });
        }
        const funcs = (await f.query("select oid,proname,provolatile,prosecdef from pg_proc where pronamespace='public'::regnamespace and proname like 'xero_recovery_step_%'")).rows;
        for (const fn of funcs) {
          assert.equal(fn.prosecdef, false);
          for (const role of ['anon', 'authenticated']) assert.equal((await f.query("select has_function_privilege($1,$2,'EXECUTE') as permitted", [role, fn.oid])).rows[0].permitted, false);
        }
        assert.equal(funcs.find(x => x.proname === 'xero_recovery_step_readback').provolatile, 's');
        assert.equal((await f.rpc('readback', f.plan)).state, 'ready');
      });

      if (native) {
        const race = async operations => {
          const clients = await Promise.all(operations.map(() => f.newClient()));
          try { return await Promise.allSettled(operations.map((run, i) => run(clients[i]))); }
          finally { await Promise.all(clients.map(client => client.end())); }
        };
        await scenario('independent sessions claim once before either action can start', async () => {
          const q = request(f.plan), other = request(f.plan);
          const settled = await race([client => f.rpc('claim', f.plan, q, undefined, client), client => f.rpc('claim', f.plan, other, undefined, client)]);
          assert.deepEqual(settled.map(x => x.status).sort(), ['fulfilled', 'rejected']);
          assert.deepEqual(await f.counts(), { operations: 1, attempts: 1, acknowledgements: 0 });
        });
        await scenario('independent sessions cannot consume an approval with different operation IDs', async () => {
          const other = plan({ operationId: 'e'.repeat(64) });
          const settled = await race([client => f.rpc('claim', f.plan, request(f.plan), undefined, client), client => f.rpc('claim', other, request(other), undefined, client)]);
          assert.deepEqual(settled.map(x => x.status).sort(), ['fulfilled', 'rejected']);
          assert.deepEqual(await f.counts(), { operations: 1, attempts: 1, acknowledgements: 0 });
        });
        await scenario('independent complete calls append only one acknowledgement', async () => {
          const q = request(f.plan); await f.rpc('claim', f.plan, q); const raw = canonical(f.result('preflight'));
          const settled = await race([client => f.rpc('complete', f.plan, q, raw, client), client => f.rpc('complete', f.plan, q, raw, client)]);
          assert.deepEqual(settled.map(x => x.status).sort(), ['fulfilled', 'rejected']);
          assert.deepEqual(await f.counts(), { operations: 1, attempts: 1, acknowledgements: 1 });
        });
        await scenario('deadline is rechecked after waiting on the original-operation lock', async () => {
          const short = plan({ issuedAt: Date.now() - 1000, notAfter: Date.now() + 220 });
          const blocker = await f.newClient(), waiting = await f.newClient();
          try {
            await blocker.query('begin'); await blocker.query("select pg_advisory_xact_lock(hashtextextended('xero.recovery.step.'||$1,0))", [short.value.binding.operationId]);
            const pending = f.rpc('claim', short, request(short), undefined, waiting);
            await new Promise(resolve => setTimeout(resolve, 260)); await blocker.query('commit'); await refused(() => pending);
          } finally { await blocker.end(); await waiting.end(); }
          assert.deepEqual(await f.counts(), { operations: 0, attempts: 0, acknowledgements: 0 });
        });
        await scenario('a rolled-back global submission collision cannot return execute after the deadline', async () => {
          const short = plan({ issuedAt: Date.now() - 1000, notAfter: Date.now() + 240 });
          const q = request(short);
          const other = plan({ operationId: 'e'.repeat(64), approvalSha256: 'f'.repeat(64) });
          const otherRequest = request(other, 'preflight', null, { submissionId: q.value.submissionId });
          const blocker = await f.newClient(), waiting = await f.newClient();
          try {
            await blocker.query('begin');
            await blocker.query('insert into public.xero_recovery_step_operations(operation_id,approval_sha256,plan_json,plan_sha256) values($1,$2,$3,$4)',
              [other.value.binding.operationId, other.value.binding.approvalSha256, other.json, other.sha]);
            await blocker.query('insert into public.xero_recovery_step_attempts(submission_id,operation_id,ordinal,step,request_json,request_sha256) values($1,$2,0,\'preflight\',$3,$4)',
              [q.value.submissionId, other.value.binding.operationId, otherRequest.json, otherRequest.sha]);
            const pending = f.rpc('claim', short, q, undefined, waiting);
            await new Promise(resolve => setTimeout(resolve, 280)); await blocker.query('rollback');
            await refused(() => pending);
          } finally { await blocker.end(); await waiting.end(); }
          assert.deepEqual(await f.counts(), { operations: 0, attempts: 0, acknowledgements: 0 });
        });
      }
    });
}

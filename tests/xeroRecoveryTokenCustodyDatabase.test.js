import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readXeroSharedControlFixture } from './helpers/xero-recovery-fixture.mjs';

const MIGRATION = '20261018100701_xero_recovery_private_returned_token_custody.sql';
const TABLE = 'public.xero_recovery_token_custody';
const TENANT = '10000000-0000-4000-8000-000000000001';
const OWNER = '20000000-0000-4000-8000-000000000002';
const LEASE = '30000000-0000-4000-8000-000000000003';
const OTHER = '40000000-0000-4000-8000-000000000004';
const ACCESS = 'PRIVATE_RETURNED_ACCESS_TOKEN';
const REFRESH = 'PRIVATE_RETURNED_REFRESH_TOKEN';
const bindings = () => ['a'.repeat(64), OWNER, TENANT, 7, LEASE, 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)];
const returned = changes => ({ tenantId: TENANT, accessToken: ACCESS, refreshToken: REFRESH,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope: 'offline_access accounting.contacts', ...changes });
const configured = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
const bindir = configured.status === 0 ? configured.stdout.trim() : null;
const nativeAvailable = bindir && existsSync(join(bindir, 'initdb'));

async function database(t, native) {
  let db, query, exec, newClient;
  if (native) {
    const directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'fcos-custody-pg-'));
    const data = join(directory, 'data'), port = 54621;
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
    db = new pg.Client(config); await db.connect();
    query = (sql, values = []) => db.query(sql, values); exec = sql => db.query(sql);
    newClient = async () => { const client = new pg.Client(config); await client.connect(); return client; };
  } else {
    db = new PGlite(); query = (sql, values = []) => db.query(sql, values); exec = sql => db.exec(sql);
    t.after(() => db.close());
  }
  await exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.user_profiles(id uuid primary key,active boolean,user_type text);
    create table public.xero_contact_sync_connections(id text primary key,tenant_id text,token_version integer,
      access_token text,refresh_token text,expires_at timestamptz,scope text,updated_at timestamptz);
    alter table public.xero_contact_sync_connections enable row level security;
    alter table public.xero_contact_sync_connections force row level security;
    revoke all on public.xero_contact_sync_connections from public,anon,authenticated,service_role;
    grant select,insert,update on public.xero_contact_sync_connections to service_role;`);
  await exec(await readXeroSharedControlFixture());
  await exec(await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8'));
  const role = async (name, sql, values = [], client = { query }) => {
    if (!['anon', 'authenticated', 'service_role'].includes(name)) throw Error('Invalid fixture role');
    await client.query(`set role ${name}`);
    try { return await client.query(sql, values); } finally { await client.query('reset role'); }
  };
  const rpc = async (action, args = bindings(), connection, client) => {
    assert.ok(['prepare', 'capture', 'readback', 'finish'].includes(action));
    const values = action === 'capture' ? [...args, JSON.stringify(connection)] : args;
    const sql = `select public.xero_recovery_custody_${action}(${values.map((_, i) => `$${i + 1}`).join(',')}) as result`;
    return (await role('service_role', sql, values, client)).rows[0].result;
  };
  const reset = async () => {
    await exec(`truncate ${TABLE},public.xero_shared_requests,public.xero_shared_probe_grants,public.xero_shared_budgets,
      public.xero_shared_tenant_control,public.xero_token_refresh_leases,public.xero_contact_sync_connections;
      insert into public.xero_contact_sync_connections(id,tenant_id,token_version,access_token,refresh_token,expires_at,scope)
      values('primary','${TENANT}',7,'ORIGINAL_ACCESS','ORIGINAL_REFRESH',clock_timestamp()+interval '1 hour','original-scope');`);
  };
  const claim = async () => (await role('service_role', 'select public.xero_refresh_claim($1,$2,$3) as result', [TENANT, 7, LEASE])).rows[0].result;
  const captured = async connection => { await rpc('prepare'); await claim(); return rpc('capture', bindings(), connection || returned()); };
  const row = async () => (await query(`select * from ${TABLE}`)).rows[0];
  const primary = async () => (await query("select * from public.xero_contact_sync_connections where id='primary'")).rows[0];
  return { db, query, exec, rpc, role, reset, claim, captured, row, primary, newClient };
}

function sanitized(value) {
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_RETURNED|ORIGINAL_ACCESS|ORIGINAL_REFRESH|accessToken|refreshToken|returned_access_token|returned_refresh_token/);
}

async function refused(operation) {
  await assert.rejects(operation, error => {
    // PGlite adds its caller's query/params to Error after the engine returns.
    // Check actual PostgreSQL diagnostics, including non-enumerable message;
    // never treat a driver's local input echo as an RPC's returned payload.
    // Production adapters must likewise never serialize raw driver errors.
    sanitized(Object.fromEntries(['message', 'detail', 'hint', 'where', 'code', 'schema', 'table', 'column', 'constraint']
      .map(key => [key, error[key]])));
    return true;
  });
}

for (const native of [false, true]) {
  test(`${native ? 'native PostgreSQL' : 'PGlite'} private returned-token custody`,
    { skip: native && !nativeAvailable && process.env.FCOS_REQUIRE_NATIVE_XERO_CUSTODY !== '1' }, async t => {
      if (native) assert.ok(nativeAvailable, 'Native PostgreSQL is required by the explicit fixture gate.');
      const f = await database(t, native);
      const scenario = async (name, run) => t.test(name, async () => { await f.reset(); await run(); });

      await scenario('prepare before refresh claim, capture, and separate exact finish produce sanitized acknowledgements', async () => {
        const prepared = await f.rpc('prepare'); sanitized(prepared);
        assert.deepEqual(prepared, { operationId: bindings()[0], state: 'prepared', scopeConsumed: true, tokenPostReplayAllowed: false, executionAuthorityGranted: false });
        assert.equal((await f.query('select count(*)::integer as n from public.xero_token_refresh_leases')).rows[0].n, 0);
        assert.equal((await f.claim()).state, 'claimed');
        const connection = returned();
        const captured = await f.rpc('capture', bindings(), connection); sanitized(captured);
        assert.equal(captured.finishEligibilityAccepted, false);
        assert.equal((await f.primary()).token_version, 7);
        const readback = await f.rpc('readback'); sanitized(readback);
        assert.equal(readback.privateCapturePresent, true);
        const finished = await f.rpc('finish'); sanitized(finished);
        assert.equal(finished.tokenVersion, 8); assert.equal(finished.duplicateSecretsCleared, true);
        const primary = await f.primary(), row = await f.row();
        assert.equal(primary.token_version, 8); assert.equal(primary.access_token, ACCESS); assert.equal(primary.refresh_token, REFRESH);
        assert.equal(row.state, 'finished'); assert.equal(row.finished_version, 8);
        for (const key of ['returned_access_token', 'returned_refresh_token', 'returned_expires_at', 'returned_scope']) assert.equal(row[key], null);
        const final = await f.rpc('readback'); sanitized(final); assert.equal(final.state, 'finished'); assert.equal(final.privateCapturePresent, false);
        await refused(() => f.rpc('finish'));
        assert.equal((await f.primary()).token_version, 8);
      });

      await scenario('no-renew prepare is a consumed execution scope and never a fabricated finished connection', async () => {
        await f.rpc('prepare');
        const result = await f.rpc('readback'); sanitized(result);
        assert.equal(result.state, 'prepared'); assert.equal(result.scopeConsumed, true);
        assert.equal(result.tokenPostOutcome, 'not_recorded_do_not_replay');
        assert.equal(result.finishedVersion, null); assert.equal(result.privateCapturePresent, false);
        await refused(() => f.rpc('finish'));
        assert.equal((await f.primary()).token_version, 7);
      });

      await scenario('same approval cannot be reused with a different operation and lease; a distinct approval can use unchanged version', async () => {
        await f.rpc('prepare');
        await refused(() => f.rpc('prepare'));
        const other = bindings(); other[0] = 'e'.repeat(64); other[4] = OTHER;
        await refused(() => f.rpc('prepare', other));
        other[5] = 'f'.repeat(64);
        assert.equal((await f.rpc('prepare', other)).state, 'prepared');
        assert.equal((await f.query(`select count(*)::integer as n from ${TABLE}`)).rows[0].n, 2);
      });

      await scenario('wrong current version or malformed prepare binding never creates custody', async () => {
        for (const [index, value] of [[3, 8], [0, 'not-a-hash'], [5, 'not-a-hash'], [6, null], [7, 'A'.repeat(64)]]) {
          const args = bindings(); args[index] = value;
          await refused(() => f.rpc('prepare', args));
        }
        assert.equal((await f.query(`select count(*)::integer as n from ${TABLE}`)).rows[0].n, 0);
      });

      await scenario('capture/readback/finish cannot cross any immutable original binding', async () => {
        await f.captured();
        for (const [index, value] of [[0, 'e'.repeat(64)], [1, OTHER], [2, OTHER], [3, 8], [4, OTHER], [5, 'e'.repeat(64)], [6, 'e'.repeat(64)], [7, 'e'.repeat(64)]]) {
          const args = bindings(); args[index] = value;
          for (const action of ['capture', 'readback', 'finish']) await refused(() => f.rpc(action, args, returned()));
        }
        assert.equal((await f.primary()).token_version, 7); assert.equal((await f.row()).state, 'captured');
      });

      await scenario('capture is write once, rejects replay, and never overwrites a different returned rotation', async () => {
        await f.captured();
        await refused(() => f.rpc('capture', bindings(), returned()));
        await refused(() => f.rpc('capture', bindings(), returned({ accessToken: 'SECOND_ACCESS', refreshToken: 'SECOND_REFRESH' })));
        const row = await f.row(); assert.equal(row.returned_access_token, ACCESS); assert.equal(row.returned_refresh_token, REFRESH);
      });

      await scenario('malformed returned responses are sanitized and leave the prepared unknown unchanged', async () => {
        await f.rpc('prepare'); await f.claim();
        for (const connection of [null, [], {}, returned({ tenantId: OTHER }), returned({ accessToken: null }), returned({ refreshToken: '' }),
          returned({ accessToken: `${ACCESS}\n` }), returned({ refreshToken: REFRESH.repeat(1000) }), returned({ expiresAt: 'not-a-date' }),
          returned({ expiresAt: 'infinity' }), returned({ scope: null }), returned({ unexpected: ACCESS })]) {
          await refused(() => f.rpc('capture', bindings(), connection));
          assert.equal((await f.row()).state, 'prepared'); assert.equal((await f.row()).returned_refresh_token, null);
        }
      });

      await scenario('late capture preserves a returned response privately after identity/lease drift; finish still refuses', async () => {
        await f.rpc('prepare'); await f.claim();
        await f.query("update public.xero_contact_sync_connections set tenant_id=$1,token_version=8 where id='primary'", [OTHER]);
        await f.exec("update public.xero_token_refresh_leases set state='superseded'");
        assert.equal((await f.rpc('capture', bindings(), returned())).state, 'captured');
        await refused(() => f.rpc('finish'));
        assert.equal((await f.row()).returned_refresh_token, REFRESH);
        assert.equal((await f.primary()).tenant_id, OTHER); assert.equal((await f.primary()).token_version, 8);
      });

      await scenario('expired returned access still enters private custody but cannot bypass existing finish validation', async () => {
        await f.captured(returned({ expiresAt: '2000-01-01T00:00:00.000Z' }));
        await refused(() => f.rpc('finish'));
        assert.equal((await f.row()).state, 'captured'); assert.equal((await f.row()).returned_refresh_token, REFRESH);
        assert.equal((await f.primary()).token_version, 7);
      });

      await scenario('original uncertain refresh lease can finish the captured response without another OAuth request', async () => {
        await f.captured();
        await f.exec("update public.xero_token_refresh_leases set state='uncertain',expires_at=clock_timestamp()-interval '1 hour'");
        assert.equal((await f.rpc('finish')).tokenVersion, 8);
      });

      await scenario('wrong refresh lease refuses finish and retains both original primary and private capture', async () => {
        await f.captured();
        await f.query("update public.xero_token_refresh_leases set lease_id=$1 where connection_id='primary'", [OTHER]);
        await refused(() => f.rpc('finish'));
        assert.equal((await f.primary()).token_version, 7); assert.equal((await f.row()).state, 'captured');
      });

      await scenario('failure after existing finish rolls back primary, lease completion, and duplicate clearing together', async () => {
        await f.captured();
        await f.exec(`create function public.fixture_custody_failure() returns trigger language plpgsql as $$begin
          if new.state='finished' then raise exception 'fixture write failure'; end if; return new; end$$;
          create trigger fixture_custody_failure after update on ${TABLE} for each row execute function public.fixture_custody_failure();`);
        try {
          await refused(() => f.rpc('finish'));
          assert.equal((await f.primary()).token_version, 7); assert.equal((await f.primary()).refresh_token, 'ORIGINAL_REFRESH');
          assert.equal((await f.row()).state, 'captured'); assert.equal((await f.row()).returned_refresh_token, REFRESH);
          assert.equal((await f.query('select state from public.xero_token_refresh_leases')).rows[0].state, 'refreshing');
        } finally { await f.exec(`drop trigger fixture_custody_failure on ${TABLE}; drop function public.fixture_custody_failure()`); }
      });

      await scenario('RLS/ACLs deny browser roles all credentials and RPCs and deny service DELETE/TRUNCATE', async () => {
        await f.captured();
        const security = (await f.query(`select relrowsecurity,relforcerowsecurity from pg_class where oid='${TABLE}'::regclass`)).rows[0];
        assert.deepEqual(security, { relrowsecurity: true, relforcerowsecurity: true });
        const functions = (await f.query("select oid,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname like 'xero_recovery_custody_%' order by proname")).rows;
        assert.equal(functions.length, 5);
        for (const fn of functions) { assert.equal(fn.prosecdef, false); assert.deepEqual(fn.proconfig, ['search_path=""']); }
        for (const role of ['anon', 'authenticated']) {
          await refused(() => f.role(role, `select * from ${TABLE}`));
          for (const fn of functions) assert.equal((await f.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, fn.oid])).rows[0].allowed, false);
        }
        await refused(() => f.role('service_role', `delete from ${TABLE}`));
        await refused(() => f.role('service_role', `truncate ${TABLE}`));
        assert.equal((await f.role('service_role', `select returned_refresh_token from ${TABLE}`)).rows[0].returned_refresh_token, REFRESH, 'Only trusted credential-custody runtime can SELECT private rows.');
      });

      await scenario('direct service DML cannot rebind, overwrite capture, fabricate finish, or erase custody', async () => {
        await f.captured();
        await refused(() => f.role('service_role', `update ${TABLE} set owner_thread_id=$1`, [OTHER]));
        await refused(() => f.role('service_role', `update ${TABLE} set returned_refresh_token='SECOND_REFRESH'`));
        await refused(() => f.role('service_role', `update ${TABLE} set state='finished',finished_version=8,returned_access_token=null,returned_refresh_token=null,returned_expires_at=null,returned_scope=null`));
        assert.equal((await f.row()).state, 'captured'); assert.equal((await f.row()).returned_refresh_token, REFRESH);
      });

      if (native) {
        const concurrent = async operations => {
          const clients = await Promise.all(operations.map(() => f.newClient()));
          try { return await Promise.allSettled(operations.map((operation, i) => operation(clients[i]))); }
          finally { await Promise.all(clients.map(client => client.end())); }
        };
        await scenario('two independent sessions cannot consume the same approval twice', async () => {
          const other = bindings(); other[0] = 'e'.repeat(64); other[4] = OTHER;
          const results = await concurrent([client => f.rpc('prepare', bindings(), undefined, client), client => f.rpc('prepare', other, undefined, client)]);
          assert.deepEqual(results.map(x => x.status).sort(), ['fulfilled', 'rejected']);
          assert.equal((await f.query(`select count(*)::integer as n from ${TABLE}`)).rows[0].n, 1);
        });
        await scenario('two independent captures have one immutable winner', async () => {
          await f.rpc('prepare'); await f.claim();
          const results = await concurrent([client => f.rpc('capture', bindings(), returned(), client), client => f.rpc('capture', bindings(), returned({ refreshToken: 'SECOND_REFRESH' }), client)]);
          assert.deepEqual(results.map(x => x.status).sort(), ['fulfilled', 'rejected']);
          assert.ok([REFRESH, 'SECOND_REFRESH'].includes((await f.row()).returned_refresh_token));
        });
        await scenario('concurrent finish calls invoke the existing primary CAS only once', async () => {
          await f.captured();
          const results = await concurrent([client => f.rpc('finish', bindings(), undefined, client), client => f.rpc('finish', bindings(), undefined, client)]);
          assert.deepEqual(results.map(x => x.status).sort(), ['fulfilled', 'rejected']);
          assert.equal((await f.primary()).token_version, 8); assert.equal((await f.row()).state, 'finished');
          assert.equal((await f.row()).returned_refresh_token, null);
        });
      }
    });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { SCHEMA_QUERY, collectSchemaObservation } from '../scripts/lib/hosted-release/observations.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const available = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
const bindir = available.status === 0 ? available.stdout.trim() : null;

test('native schema observer detects access and executable relation drift with stable logical identities',
  { skip: !bindir && process.env.FCOS_REQUIRE_NATIVE_COORDINATOR_DATABASE !== '1' }, async t => {
    assert.ok(bindir, 'Native PostgreSQL is required for the schema observation gate.');
    const directory = await mkdtemp(join(tmpdir(), 'fcos-schema-observer-pg-'));
    const data = join(directory, 'data'), port = 54594;
    execFileSync(join(bindir, 'initdb'), ['-D', data, '--username=postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
    execFileSync(join(bindir, 'pg_ctl'), ['-D', data, '-l', join(directory, 'server.log'), '-o', `-k ${directory} -h '' -p ${port}`, '-w', 'start'], { stdio: 'pipe' });
    const db = new pg.Client({ host: directory, port, user: 'postgres', database: 'postgres' });
    t.after(async () => {
      await db.end();
      execFileSync(join(bindir, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
      await rm(directory, { recursive: true, force: true });
    });
    await db.connect();
    await db.query(`create role fcos_schema_reader nologin;
      create role fcos_release_observer login;
      create table public.ledger(id integer primary key, amount numeric not null);
      alter table public.ledger enable row level security;
      create policy ledger_read on public.ledger for select using (amount >= 0);
      create view public.ledger_view as select id, amount from public.ledger;
      create function public.ledger_guard() returns trigger language plpgsql as $$begin return new; end$$;
      create trigger ledger_guard before insert on public.ledger for each row execute function public.ledger_guard();
      set search_path = pg_catalog`);
    const snapshot = async () => (await db.query(SCHEMA_QUERY)).rows[0].snapshot;
    const initial = await snapshot(), initialHash = digest(initial);
    assert.equal(digest(await snapshot()), initialHash, 'Repeated reads preserve the fingerprint.');
    const changes = [
      ['disable RLS', 'alter table public.ledger disable row level security'],
      ['force RLS', 'alter table public.ledger force row level security'],
      ['relation privilege', 'grant select on public.ledger to fcos_schema_reader'],
      ['grant option', 'grant select on public.ledger to fcos_schema_reader with grant option'],
      ['column privilege', 'grant select (amount) on public.ledger to fcos_schema_reader'],
      ['schema privilege', 'revoke usage on schema public from public'],
      ['function privilege', 'revoke execute on function public.ledger_guard() from public'],
      ['empty function ACL', 'revoke all on function public.ledger_guard() from public, postgres'],
      ['empty relation ACL', 'revoke all on public.ledger from postgres'],
      ['view definition', 'create or replace view public.ledger_view as select id, amount from public.ledger where amount > 0'],
      ['view security option', 'alter view public.ledger_view set (security_invoker=true)'],
      ['disabled trigger', 'alter table public.ledger disable trigger ledger_guard'],
      ['trigger invocation mode', 'alter table public.ledger enable always trigger ledger_guard'],
      ['trigger definition', 'drop trigger ledger_guard on public.ledger; create trigger ledger_guard after insert on public.ledger for each row execute function public.ledger_guard()'],
    ];
    for (const [label, sql] of changes) await t.test(label, async () => {
      await db.query('begin');
      try { await db.query(sql); assert.notEqual(digest(await snapshot()), initialHash, `${label} must invalidate schema evidence.`); }
      finally { await db.query('rollback'); }
      assert.equal(digest(await snapshot()), initialHash, 'Rollback restores the original fingerprint.');
    });
    await t.test('ACL ordering and OID allocation do not manufacture schema drift', async () => {
      await db.query('begin');
      await db.query('grant select, insert on public.ledger to fcos_schema_reader');
      const first = digest(await snapshot()); await db.query('rollback');
      await db.query('begin'); await db.query('grant insert, select on public.ledger to fcos_schema_reader');
      assert.equal(digest(await snapshot()), first); await db.query('rollback');
      await db.query('create table public.oid_probe(value integer)');
      const before = digest(await snapshot());
      await db.query('drop table public.oid_probe; create table public.oid_probe(value integer)');
      assert.equal(digest(await snapshot()), before, 'Logical identity is independent of catalog OIDs.');
      await db.query('drop table public.oid_probe');
      assert.equal(digest(await snapshot()), initialHash);
    });
    await t.test('actual restricted observer accepts exact schema and rejects RLS drift', async () => {
      class LocalObserver extends pg.Client {
        constructor() { super({ host: directory, port, user: 'fcos_release_observer', database: 'postgres' }); }
      }
      const project = fcosConnectionIdentifier('supabase', 'Project ref');
      const manifest = { targets: { supabaseProject: project }, migration: { expectedSchemaSha256: initialHash } };
      const env = { FCOS_HOSTED_SCHEMA_DATABASE_URL: `postgresql://fcos_release_observer:fixture@db.${project}.supabase.co/postgres?sslmode=verify-full` };
      const proof = await collectSchemaObservation({ manifest, env, Client: LocalObserver });
      assert.equal(proof.sha256, initialHash); assert.equal(proof.readOnly, true);
      await db.query('alter table public.ledger disable row level security');
      await assert.rejects(collectSchemaObservation({ manifest, env, Client: LocalObserver }), { code: 'LIVE_SCHEMA_CHANGED' });
      await db.query('alter table public.ledger enable row level security');
    });
  });

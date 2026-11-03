import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { LOCAL_PLATFORM_FIXTURE_SQL, planMigrationVerification } from '../scripts/lib/migration-verification.mjs';
import { SCHEMA_QUERY } from '../scripts/lib/hosted-release/observations.mjs';
const history = new URL('../supabase/migration-history/', import.meta.url);
const record = JSON.parse(await readFile(new URL('qualification-source-upgrade-byte-collation.consolidation.json', history), 'utf8'));
const original = await readFile(new URL('../' + record.installedSource.path, import.meta.url), 'utf8');
const portable = await readFile(new URL('../' + record.portableSource.path, import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const oldGuard = " if c.singleton is distinct from true or c.epoch is distinct from 1 or c.mode is distinct from 'qualification'\n";
const guardStart = portable.indexOf(' -- The pristine branch must remain inert');
const guardEnd = portable.indexOf('  or c.operation_id is not null', guardStart);
const body = portable.replace(/\nbegin;\n/, '\n').replace(/\ncommit;\n?$/, '\n');
test('one explicit portable installer source retains exact installed history and function delta', () => {
  assert.equal(record.kind, 'fcos_qualification_collation_migration_source_consolidation_v1');
  assert.equal(record.migrationVersion, '20261022062147');
  assert.equal(record.migrationName, '20261022062147_qualification_source_upgrade_byte_collation.sql');
  assert.equal(record.installedSource.sha256, 'caafb98de24c52aa4c7e852a77d5b41e35c3e46e1a492dcd3a00e996369e3ef1');
  assert.equal(record.portableSource.sha256, '8b757783c2878cdb3b32a9ca4bbdb6cac8a6dfda44d680294dd2b5ed74f02208');
  assert.equal(hash(original), record.installedSource.sha256);
  assert.equal(hash(portable), record.portableSource.sha256);
  assert.ok(guardStart > 0 && guardEnd > guardStart);
  assert.equal(portable.slice(0, guardStart) + oldGuard + portable.slice(guardEnd), original);
  assert.equal(record.pristinePrivateTables.length, 39);
  for (const name of record.pristinePrivateTables) assert.ok(portable.slice(guardStart, guardEnd).includes('and not exists(select 1 from fcos_release_coordination.' + name + ')'));
  assert.equal(record.authorityChange, false);
  assert.equal(record.publicDataChange, false);
});
const configured = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
const configuredVersion = spawnSync('pg_config', ['--version'], { encoding: 'utf8' });
const executable = file => { try { accessSync(file, constants.X_OK); return true; } catch { return false; } };
const nativeAvailable = configured.status === 0 && configuredVersion.status === 0
  && /^PostgreSQL (?:16|17)\./.test(configuredVersion.stdout.trim())
  && ['initdb', 'pg_ctl', 'postgres'].every(name => executable(path.join(configured.stdout.trim(), name)));
test('complete clean migration tree keeps NULL/frozen inert and preserves source/permission/refusal guards', { skip: !nativeAvailable && process.env.FCOS_REQUIRE_NATIVE_COORDINATOR_DATABASE !== '1' }, async t => {
  assert.ok(nativeAvailable, 'Supported native PostgreSQL16/17 toolchain is required in explicit-native mode');
  const bin = configured.stdout.trim();
  const dir = await mkdtemp(path.join(tmpdir(), 'fcos-collation-clean-chain-'));
  const data = path.join(dir, 'data');
  const port = 54663;
  let started = false, admin, db;
  t.after(async () => {
    await db?.end(); await admin?.end();
    if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
    await rm(dir, { recursive: true, force: true });
  });
  execFileSync(path.join(bin, 'initdb'), ['-D', data, '--username=fcos_test_bootstrap', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(dir, 'server.log'), '-o', `-k ${dir} -h 127.0.0.1 -p ${port}`, '-w', 'start'], { stdio: 'pipe' }); started = true;
  admin = new pg.Client({ host: dir, port, user: 'fcos_test_bootstrap', database: 'postgres' }); await admin.connect();
  await admin.query('create role postgres login nosuperuser createdb createrole inherit nobypassrls;alter database postgres owner to postgres;create role anon;create role authenticated;create role service_role;create role authenticator;grant authenticator to postgres with admin option;grant set on parameter "pgrst.db_schemas" to postgres');
  db = new pg.Client({ host: dir, port, user: 'postgres', database: 'postgres' }); await db.connect();
  await db.query(LOCAL_PLATFORM_FIXTURE_SQL);
  const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
  const names = (await readdir(migrationDirectory)).filter(n => n.endsWith('.sql')).sort();
  const sources = await Promise.all(names.map(async name => ({ name, sql: await readFile(new URL(name, migrationDirectory), 'utf8') })));
  const baseline = JSON.parse(await readFile(new URL('../config/migration-verification-baseline.json', import.meta.url), 'utf8'));
  const plan = planMigrationVerification(sources, baseline);
  assert.ok(plan.pending.some(m => m.name === record.migrationName));
  assert.ok(!plan.baseline.some(m => m.name === record.migrationName));
  const applied = [];
  for (const m of sources) {
    if (m.name === record.migrationName) break;
    await db.query(m.sql); applied.push({ name: m.name, sha256: hash(m.sql) });
  }
  const snapshot = async () => {
    const tables = (await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='fcos_release_coordination' and c.relkind in ('r','p') order by c.relname collate \"C\"")).rows.map(r => r.relname);
    const counts = {};
    for (const name of tables) counts[name] = (await db.query('select count(*)::int n from fcos_release_coordination.' + pg.escapeIdentifier(name))).rows[0].n;
    const control = (await db.query('select to_jsonb(c) v from fcos_release_coordination.control c')).rows[0].v;
    const target = (await db.query("select oid::int,proowner::regrole::text owner,proacl::text acl,proconfig,prosecdef,encode(sha256(convert_to(prosrc,'UTF8')),'hex') body_sha256 from pg_proc where oid='fcos_release_coordination.qualification_source_upgrade_proof_valid(jsonb)'::regprocedure")).rows[0];
    const permissions = (await db.query("select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text owner,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='fcos_release_coordination' and c.relkind in ('r','p') order by c.relname collate \"C\"")).rows;
    return { control, counts, target, permissions, publicCatalog: (await db.query(SCHEMA_QUERY)).rows[0].snapshot };
  };
  const output = new URL('../outputs/qualification-collation-clean-chain-PREPARED/', import.meta.url); await mkdir(output, { recursive: true });
  const initial = await snapshot();
  assert.equal(initial.control.epoch, null); assert.equal(initial.control.mode, 'frozen');
  assert.deepEqual(Object.keys(initial.counts).filter(n => n !== 'control'), record.pristinePrivateTables);
  for (const [name, count] of Object.entries(initial.counts)) assert.equal(count, name === 'control' ? 1 : 0, name);
  assert.equal(initial.target.body_sha256, record.function.beforeBodySha256);
  await writeFile(new URL('native-clean-chain-prefix.actual.json', output), JSON.stringify({ kind:'qualification_collation_clean_chain_prefix_v1', migrationCount:names.length, priorApplied:applied, initial, originalInstalledSourceSha256:hash(original), portableSourceSha256:hash(portable), fixtureRoles:(await db.query("select rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname='postgres'")).rows, providerCalls:0, liveSqlCalls:0 }, null, 2)+'\n');
  await t.test('original installed source reproduces clean-state refusal without changes', async () => {
    try { await assert.rejects(db.query(original), /COORDINATION_SOURCE_UPGRADE_COLLATION_IN_USE/); } finally { await db.query('rollback'); }
    assert.deepEqual(await snapshot(), initial);
  });
  const cases = [
    ['NULL/qualification', "update fcos_release_coordination.control set mode='qualification'"],
    ['NULL/active', "update fcos_release_coordination.control set mode='active'"],
    ['epoch1/frozen', "insert into fcos_release_coordination.epochs values(1,'{}');update fcos_release_coordination.control set epoch=1"],
    ['epoch2/qualification', "insert into fcos_release_coordination.epochs values(2,'{}');update fcos_release_coordination.control set epoch=2,mode='qualification'"],
    ['pristine control with epoch history', "insert into fcos_release_coordination.epochs values(1,'{}')"],
    ['pristine control with permanent fence', "insert into fcos_release_coordination.auth_maintenance_fences(operation_id,tenant_id,client_sha256,evidence) values('SYNTHETIC-fence','00000000-0000-4000-8000-000000000001',repeat('a',64),'{}')"],
    ['unexpected private table', 'create table fcos_release_coordination.SYNTHETIC_unreviewed(id int)']
  ];
  for (const [label, setup] of cases) await t.test('nonpristine ' + label + ' refuses without mutation', async () => {
    await db.query('begin');
    try { await db.query(setup); await assert.rejects(db.query(body), /COORDINATION_SOURCE_UPGRADE_COLLATION_IN_USE/); } finally { await db.query('rollback'); }
    assert.deepEqual(await snapshot(), initial);
  });
  await t.test('changed source refuses even in pristine state', async () => {
    await db.query('begin');
    try {
      const def = (await db.query("select pg_get_functiondef('fcos_release_coordination.qualification_source_upgrade_proof_valid(jsonb)'::regprocedure) v")).rows[0].v;
      await db.query(def.replace('AS $function$', 'AS $function$\n-- SYNTHETIC source drift'));
      await assert.rejects(db.query(body), /COORDINATION_SOURCE_UPGRADE_COLLATION_SOURCE_DRIFT/);
    } finally { await db.query('rollback'); }
    assert.deepEqual(await snapshot(), initial);
  });
  await db.query(portable);
  const final = await snapshot();
  assert.equal(final.target.body_sha256, record.function.afterBodySha256);
  assert.deepEqual(final.control, initial.control); assert.deepEqual(final.counts, initial.counts); assert.deepEqual(final.permissions, initial.permissions); assert.deepEqual(final.publicCatalog, initial.publicCatalog);
  for (const key of ['oid','owner','acl','proconfig','prosecdef']) assert.deepEqual(final.target[key], initial.target[key]);
  try { await assert.rejects(db.query(portable), /COORDINATION_SOURCE_UPGRADE_COLLATION_SOURCE_DRIFT/); } finally { await db.query('rollback'); }
  assert.deepEqual(await snapshot(), final);
  const tail = sources.slice(sources.findIndex(m => m.name === record.migrationName) + 1);
  for (const m of tail) await db.query(m.sql);
  await writeFile(new URL('native-clean-chain-poststate.actual.json', output), JSON.stringify({ kind:'qualification_collation_clean_chain_poststate_v1', originalSourceRefused:true, nonpristineCasesPassed:cases.map(c=>c[0]), changedSourceRefused:true, replayRefused:true, initial, final, portableSourceSha256:hash(portable), completeOrderedTreeCount:names.length, providerCalls:0, liveSqlCalls:0 }, null, 2)+'\n');
  await writeFile(new URL('native-clean-chain.actual.json', output), JSON.stringify({ kind:'qualification_collation_clean_chain_native_v1', migrationCount:names.length, immutableBaselineCount:plan.baseline.length, initial, final, priorApplied:applied, finalSourceSha256:hash(portable), originalInstalledSourceSha256:hash(original), platformFixture:'Exact maintained LOCAL_PLATFORM_FIXTURE_SQL; real pgcrypto and PostgreSQL catalog/permissions. Supabase Auth/Storage/REST services are outside this database-migration proof.', providerCalls:0, liveSqlCalls:0 }, null, 2)+'\n');
});

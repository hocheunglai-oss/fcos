import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createSqlStore } from '../../supabase/functions/release-coordinator/index.ts';
import { digest } from '../../scripts/lib/hosted-release/json-contract.mjs';
import { bootstrapSql } from '../../scripts/lib/hosted-release/cutover-bootstrap.mjs';
import { planCompletionSql } from '../../scripts/lib/hosted-release/qualification-plan-completion.mjs';
import { sourceUpgradeSql } from '../../scripts/lib/hosted-release/qualification-source-upgrade.mjs';
import { SCHEMA_QUERY } from '../../scripts/lib/hosted-release/observations.mjs';
import { sourceUpgradeFixture } from './hosted-qualification-source-upgrade.mjs';

const config = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
const version = spawnSync('pg_config', ['--version'], { encoding: 'utf8' });
const executable = file => { try { accessSync(file, constants.X_OK); return true; } catch { return false; } };
export const nativeAvailable = config.status === 0 && version.status === 0
  && /^PostgreSQL (?:16|17)\./.test(version.stdout.trim())
  && ['initdb', 'pg_ctl', 'postgres'].every(name => executable(path.join(config.stdout.trim(), name)));
export const signature = 'fcos_release_coordination.qualification_source_upgrade_after_register(jsonb,jsonb)';
export const oldBody = '12cf5aae1d9e1e34ad9851a63403e03689014896b05d6b57bc9466daa426ec27';
export const newBody = '7c14d97bb20ae72b89d69e8092131540cb8db088a84aa369f2099c8086eb6629';
const migrationDirectory = new URL('../../supabase/migrations/', import.meta.url);
export async function contextMigration() {
  const names = (await readdir(migrationDirectory)).filter(name => name.endsWith('_qualification_source_upgrade_registration_context.sql'));
  assert.equal(names.length, 1, 'one registration-context migration');
  const sql = await readFile(new URL(names[0], migrationDirectory), 'utf8');
  return { name: names[0], sql, body: sql.replace(/\nbegin;\n/, '\n').replace(/\ncommit;\n?$/, '\n') };
}

/** Disposable native database, no provider connection or live credentials. */
export async function contextDatabase(t) {
  assert.ok(nativeAvailable, 'Supported native PostgreSQL16/17 is required in explicit-native mode');
  const bin = config.stdout.trim(), dir = await mkdtemp(path.join(tmpdir(), 'fcos-registration-context-'));
  const data = path.join(dir, 'data'), port = 54669;
  let started = false, admin, db, queryCount = 0;
  t.after(async () => {
    await db?.end(); await admin?.end();
    if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
    await rm(dir, { recursive: true, force: true });
  });
  execFileSync(path.join(bin, 'initdb'), ['-D', data, '--username=fcos_test_bootstrap', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  // Unique Unix socket directory, no TCP listener, and no global process cleanup.
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(dir, 'server.log'), '-o', `-k ${dir} -h '' -p ${port} -c shared_buffers=8MB -c max_connections=8`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  admin = new pg.Client({ host: dir, port, user: 'fcos_test_bootstrap', database: 'postgres' }); await admin.connect();
  await admin.query('create role postgres login nosuperuser createrole inherit nobypassrls;alter database postgres owner to postgres;create role anon;create role authenticated;create role service_role');
  db = new pg.Client({ host: dir, port, user: 'postgres', database: 'postgres' }); await db.connect();
  const query = db.query.bind(db); db.query = (...args) => { queryCount++; return query(...args); };
  const names = ['20261016190509_release_coordination.sql', '20261018112914_auth_maintenance_coordination.sql',
    '20261019171349_legacy_release_effect_containment.sql', '20261020080001_hosted_cutover_bootstrap.sql',
    '20261021101811_exact_7dc_public_metadata_quarantine.sql', '20261021193455_qualification_schema_recovery.sql',
    '20261021211917_qualification_plan_completion.sql'];
  const available = await readdir(migrationDirectory);
  for (const suffix of ['_qualification_source_upgrade.sql', '_qualification_source_upgrade_policy_route.sql', '_qualification_source_upgrade_byte_collation.sql']) {
    const matches = available.filter(name => name.endsWith(suffix)); assert.equal(matches.length, 1); names.push(matches[0]);
  }
  for (const name of names) await db.query(await readFile(new URL(name, migrationDirectory), 'utf8'));
  await admin.query('grant fcos_coordinator_runtime,anon,authenticated,service_role to postgres with inherit false,set true');
  let serial = 0;
  async function role(name, sql, parameters = []) {
    const save = `role_${++serial}`; await db.query(`savepoint ${save}`); await db.query(`set local role ${name}`);
    try { const value = await db.query(sql, parameters); await db.query('reset role'); await db.query(`release savepoint ${save}`); return value; }
    catch (error) { await db.query(`rollback to savepoint ${save}`); await db.query('reset role'); await db.query(`release savepoint ${save}`); throw error; }
  }
  // Native entrypoints retain their original RLS/ACL boundary; only prerequisites
  // use the explicitly privileged disposable operator role.
  const store = createSqlStore((sql, parameters) => role('fcos_coordinator_runtime', sql, parameters), { bootstrapAdmission: true });
  const result = async (sql, parameters = []) => (await db.query(sql, parameters)).rows[0].result;
  async function fails(sql, parameters, pattern) {
    const save = `refusal_${++serial}`; await db.query(`savepoint ${save}`);
    try { await assert.rejects(db.query(sql, parameters), pattern); }
    finally { await db.query(`rollback to savepoint ${save}`); await db.query(`release savepoint ${save}`); }
  }
  async function transaction(callback) { await db.query('begin'); try { return await callback(); } finally { await db.query('rollback'); } }
  async function metadata() {
    return (await db.query("select oid::int,proowner::regrole::text owner,proacl::text acl,proconfig,prosecdef,encode(sha256(convert_to(prosrc,'UTF8')),'hex') body,pg_get_functiondef(oid) definition from pg_proc where oid=$1::regprocedure", [signature])).rows[0];
  }
  async function state() {
    const tables = (await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='fcos_release_coordination' and c.relkind in ('r','p') order by c.relname collate \"C\"")).rows;
    const history = {};
    for (const { relname } of tables) history[relname] = (await db.query(`select count(*)::int count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text collate "C"),'[]'::jsonb)::text,'UTF8')),'hex') sha256 from fcos_release_coordination.${pg.escapeIdentifier(relname)} x`)).rows[0];
    const permissions = (await db.query("select c.relname,c.relowner::regrole::text owner,c.relacl::text acl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='fcos_release_coordination' and c.relkind in ('r','p') order by c.relname collate \"C\"")).rows;
    return { control: (await db.query('select to_jsonb(c) v from fcos_release_coordination.control c')).rows[0].v,
      history, permissions, publicCatalog: digest((await db.query(SCHEMA_QUERY)).rows[0].snapshot) };
  }
  async function fixture() {
    // The private protocol's schema digest is first checked against the real
    // unchanged public query; this explicit observation double supplies only the
    // previously approved production catalog prerequisite in the isolated DB.
    assert.equal((await db.query('select fcos_release_coordination.qualification_schema_recovery_catalog_digest() v')).rows[0].v,
      digest((await db.query(SCHEMA_QUERY)).rows[0].snapshot));
    await db.query("create or replace function fcos_release_coordination.qualification_schema_recovery_catalog_digest() returns text language sql stable set search_path=pg_catalog as $$select '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d'::text$$");
    let f = sourceUpgradeFixture();
    await db.query('select fcos_release_coordination.install_epoch(1,$1)', [f.activation]);
    await db.query('select fcos_release_coordination.admit_exact_7dc_publication_quarantine($1)', [f.quarantine]);
    for (const command of ['admit']) { const q = bootstrapSql(command, f.original); await result(q.query, q.parameters); }
    for (const a of f.original.actions) {
      for (const command of ['intent', 'record']) { const q = bootstrapSql(command, f.original, { actionId: a.id,
        evidence: { basis: 'native_ack', outcome: 'applied', requestSha256: digest(a.request), providerEvidenceSha256: f.H, rootReviewSha256: f.original.rootReviewSha256 } }); await result(q.query, q.parameters); }
    }
    { const q = bootstrapSql('finish', f.original); await result(q.query, q.parameters); }
    await result('select fcos_release_coordination.admit_qualification_schema_recovery($1) result', [f.recovery]);
    for (const a of f.recovery.actions) {
      await result('select fcos_release_coordination.qualification_schema_recovery_intent($1,$2,$3) result', [f.recovery.recoveryId, a.id, digest(f.recovery)]);
      await result('select fcos_release_coordination.record_qualification_schema_recovery($1,$2,$3,$4) result', [f.recovery.recoveryId, a.id, digest(f.recovery),
        { basis: 'native_ack', outcome: 'applied', requestSha256: digest(a.request), providerEvidenceSha256: f.H, rootReviewSha256: digest(f.recovery.rootReview) }]);
    }
    await result('select fcos_release_coordination.finish_qualification_schema_recovery($1,$2) result', [f.recovery.recoveryId, digest(f.recovery)]);
    for (const command of ['admit', 'intent', 'record', 'finish']) {
      const response = { completed: true, status: 204, exitCode: 0, bodyEmpty: true };
      const q = planCompletionSql(command, f.proof, { evidence: { basis: 'native_ack', outcome: 'applied', requestSha256: digest(f.proof.request), providerEvidenceSha256: digest(response), rootReviewSha256: digest(f.proof.rootReview), response } }); await result(q.query, q.parameters);
    }
    await db.query('begin');
    try { await store.request('register', { ...f.scope, manifest: f.manifest }, f.principal); await db.query('commit'); }
    catch (error) { await db.query('rollback'); throw error; }
    for (const cp of f.original.containmentProofs) await db.query('select fcos_release_coordination.admit_legacy_release_containment($1,$2)', [f.scope.releaseId, cp]);
    f = sourceUpgradeFixture(digest((await db.query('select to_jsonb(r) v from fcos_release_coordination.registrations r where release_id=$1', [f.scope.releaseId])).rows[0].v));
    const q = async (command, extra) => { const value = sourceUpgradeSql(command, f.upgrade, extra); return result(value.query, value.parameters); };
    await q('admit');
    for (const a of f.upgrade.actions) {
      if (a.id === 'dispatch') await q('finish-configuration', { closure: f.configuration });
      const intent = await q('intent', { actionId: a.id, ready: a.id === 'url_patch' ? f.ready : undefined });
      const response = { completed: true, status: a.id === 'policy_patch' || a.id === 'checker_deploy' ? 200 : 204, exitCode: 0,
        bodyEmpty: a.id !== 'policy_patch' && a.id !== 'checker_deploy', ...(a.id === 'checker_deploy' ? { deploymentId: f.ready.deploymentId, coordinatorUrl: f.ready.coordinatorUrl } : {}) };
      await q('record', { actionId: a.id, evidence: { basis: 'native_ack', outcome: 'applied', requestSha256: intent.requestSha256,
        providerEvidenceSha256: digest(response), rootReviewSha256: digest(f.upgrade.rootReview), response } });
      if (a.id === 'dispatch') await q('finish-dispatch', { closure: { kind: 'fcos_qualification_source_upgrade_dispatch_v1', accepted: true,
        operationId: f.upgrade.operationId, proofSha256: digest(f.upgrade), requestSha256: intent.requestSha256, providerEvidenceSha256: digest(response), sourceEvidenceSha256: f.H } });
    }
    const principal = { ...f.newPrincipal, environment: null, subject: `repo:${f.upgrade.policy.repository}:ref:${f.newPrincipal.ref}` };
    async function register(actor = principal) {
      await db.query('begin');
      try { const value = await store.request('register', { ...f.newScope, manifest: f.upgrade.manifest }, actor); await db.query('commit'); return value; }
      catch (error) { await db.query('rollback'); throw error; }
    }
    return { ...f, q, principal, register };
  }
  return { db, admin, store, role, fails, transaction, metadata, state, fixture, postgres: version.stdout.trim(), queryCount: () => queryCount };
}

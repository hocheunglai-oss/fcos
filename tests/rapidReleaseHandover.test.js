import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { auditHandover, applyHandover, performHandover, createHandoverPlan, handoverDigest, handoverPins, OLD_RELEASE_WORKFLOWS, assertHandoverConnection } from '../scripts/lib/rapid-release/handover.mjs';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const pins = handoverPins();
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create role fcos_coordinator_runtime;create role fcos_coordinator_owner;
    grant fcos_coordinator_owner to postgres;create schema fcos_release_coordination authorization fcos_coordinator_owner;
    create table fcos_release_coordination.control(singleton boolean primary key,epoch bigint,operation_id text,mode text,bootstrap_id text,recovery_id text,plan_completion_id text,source_upgrade_id text);
    insert into fcos_release_coordination.control values(true,1,null,'qualification',null,null,null,null);
    create table fcos_release_coordination.operations(operation_id text,phase text);
    create table fcos_release_coordination.operation_events(event_id bigint,operation_id text,state text);
    insert into fcos_release_coordination.operations values('old-unknown-preview','preview.create');
    create table fcos_release_coordination.imported_uncertainty(id text);insert into fcos_release_coordination.imported_uncertainty values('permanent-sentinel-preserved');
    create table public.financial_lock(id text);insert into public.financial_lock values('held');
    create function fcos_release_coordination.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'APPEND_ONLY';end$$;`);
  const query = db.query.bind(db);
  // pg.Client uses simple-query mode for the reviewed DDL bundle; PGlite exposes that as exec.
  db.query = (text, parameters) => text.startsWith('-- Controller-only') ? db.exec(text).then(result => result.at(-1)) : query(text, parameters);
  let plan, deployment = null, creates = 0, approved = true, retired = true, aliasAssigned = false, subscriberAvailable = true;
  const connection = { host: `db.${pins.projectRef}.supabase.co`, port: 5432, user: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: true } };
  const github = {
    identity: async () => ({ login: pins.account, repository: pins.repository }), execution: async () => ({ runId: 100, jobId: 101 }),
    verifyNativePlan: async ({ planHash, plan: value }) => { assert.equal(planHash, handoverDigest(value)); },
    eventSubscribers: async () => { if (!subscriberAvailable) throw Error('APP_SUBSCRIBER_SCOPE_MISSING'); return { inventory: [{ kind: 'workflow', path: 'workflow_dispatch-only' }], evidenceDigest: 'a'.repeat(64) }; },
    pages: async () => [],
    get: async path => {
      if (path.includes('/actions/variables/')) return { value: retired ? 'false' : 'true' };
      if (path.includes('/actions/workflows/')) return { id: OLD_RELEASE_WORKFLOWS.indexOf(path.split('/').at(-1)) + 1, state: retired ? 'disabled_manually' : 'active' };
      if (path.endsWith('/approvals')) return approved ? [{ id: 90, state: 'approved', user: { login: pins.account }, environments: [{ id: 1 }] }] : [];
      if (path.includes('/environments/')) return { id: 1, can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', reviewers: [{ reviewer: { login: pins.account } }] }] };
      if (path.includes('/actions/jobs/')) return { id: 101, run_id: 100, status: 'in_progress', name: 'handover-apply' };
      return { id: 100, head_sha: 'a'.repeat(40), event: 'workflow_dispatch', status: 'in_progress', actor: { login: pins.account }, repository: { full_name: pins.repository }, path: '.github/workflows/fcos-rapid-handover.yml' };
    },
    qualification: async () => ({ runId: 100, planHash: handoverDigest(plan), controllerSha: plan.controllerSha, candidateSha: plan.candidateSha,
      buildId: plan.buildId, artifactDigest: plan.artifactDigest, deploymentId: 'dpl_qualified', browser: { passed: true, login: true, restrictedAccess: true, normalRole: true, businessWrites: 0, deploymentId: 'dpl_qualified', buildId: plan.buildId } }),
    createDeployment: async request => { creates++; deployment = { id: 200, creator: { login: pins.account }, payload: request.payload }; return deployment; },
    findDeployment: async () => deployment,
  };
  const vercel = { project: async () => ({ id: pins.projectId, accountId: pins.teamId, autoAssignCustomDomains: false }),
    currentProduction: async () => ({ id: 'dpl_old' }),
    deployment: async () => ({ id: 'dpl_qualified', readyState: 'READY', target: 'production', projectId: pins.projectId, ownerId: pins.teamId, aliasAssigned,
      meta: { githubCommitSha: plan.candidateSha, fcosRapidBuildId: plan.buildId, fcosRapidArtifactDigest: plan.artifactDigest, fcosHandoverPlanHash: handoverDigest(plan) } }),
  };
  const input = { db, connection, github, vercel };
  const audit = await auditHandover(input);
  plan = createHandoverPlan({ audit, controllerSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), buildId: 'c'.repeat(64), artifactDigest: 'd'.repeat(64), handoverId: 'rapid-handover-test' });
  return { ...input, plan, audit, set approved(v) { approved = v; }, set retired(v) { retired = v; }, set aliasAssigned(v) { aliasAssigned = v; },
    set subscriberAvailable(v) { subscriberAvailable = v; }, get creates() { return creates; }, apply: phase => applyHandover({ ...input, plan, phase }) };
}

test('read-only audit pins target and preserves actual non-Production unknowns', async () => {
  const f = await fixture();
  try {
    assert.equal(f.audit.database.preservedOtherUnknowns.count, 1);
    assert.deepEqual(f.audit.database.unresolvedProduction, []);
    assert.throws(() => assertHandoverConnection({ ...f.connection, user: 'service_role' }), /PINNED_TLS/);
    assert.throws(() => assertHandoverConnection({ ...f.connection, host: 'db.other.supabase.co' }), /PINNED_TLS/);
    assert.equal((await f.db.query("select to_regclass('fcos_release_coordination.rapid_handover_receipts') as receipt")).rows[0].receipt, null);
    f.subscriberAvailable = false;
    await assert.rejects(auditHandover(f), /SUBSCRIBER_SCOPE_MISSING/);
  } finally { await f.db.close(); }
});

test('preparation is reversible and does not unfence legacy history or financial locks', async () => {
  const f = await fixture();
  try {
    f.approved = false;
    await assert.rejects(f.apply('prepare'), /PROTECTED_NATIVE_REVIEW_REQUIRED/);
    f.approved = true;
    await f.apply('prepare');
    assert.equal((await f.db.query('select mode from fcos_release_coordination.control')).rows[0].mode, 'frozen');
    await f.apply('prepare'); // same saved preparation is reusable
    await assert.rejects(f.db.query("update fcos_release_coordination.control set mode='active'"), /PERMANENTLY_FENCED/);
    await f.apply('abort');
    assert.equal((await f.db.query('select mode from fcos_release_coordination.control')).rows[0].mode, 'qualification');
    assert.equal((await f.db.query('select id from public.financial_lock')).rows[0].id, 'held');
    assert.equal((await f.db.query('select id from fcos_release_coordination.imported_uncertainty')).rows[0].id, 'permanent-sentinel-preserved');
  } finally { await f.db.close(); }
});

test('actual unresolved Production operation blocks preparation without changing its state', async () => {
  const f = await fixture();
  try {
    await f.db.query("insert into fcos_release_coordination.operations values('unresolved-stage','production.stage')");
    await assert.rejects(f.apply('prepare'), /HISTORY_OR_PRODUCTION_UNCERTAINTY_CHANGED/);
    assert.equal((await f.db.query('select mode from fcos_release_coordination.control')).rows[0].mode, 'qualification');
    assert.equal((await f.db.query('select count(*) as count from fcos_release_coordination.operations')).rows[0].count, 2);
  } finally { await f.db.close(); }
});

test('finalization requires actual retired entrypoints and an unaliased exact Production-config staged build', async () => {
  const f = await fixture();
  try {
    await f.apply('prepare');
    f.retired = false;
    await assert.rejects(f.apply('finalize'), /OLD_WRITERS_NOT_RETIRED/);
    f.retired = true; f.aliasAssigned = true;
    await assert.rejects(f.apply('finalize'), /REAL_STAGED_QUALIFICATION_REQUIRED/);
    f.aliasAssigned = false;
    const result = await f.apply('finalize');
    assert.equal(result.deploymentId, 200); assert.equal(f.creates, 1);
    await assert.rejects(f.apply('abort'), /FINALIZED_PERMANENT/);
    await assert.rejects(f.db.query("update fcos_release_coordination.control set mode='qualification'"), /PERMANENTLY_FENCED/);
    await assert.rejects(f.db.query('truncate fcos_release_coordination.control'), /PERMANENTLY_FENCED/);
    assert.equal((await f.apply('finalize')).reused, true); assert.equal(f.creates, 1);
  } finally { await f.db.close(); }
});

test('lost GitHub acknowledgement does not cause a duplicate handover deployment', async () => {
  const f = await fixture();
  try {
    await f.apply('prepare');
    let calls = 0;
    f.github.createDeployment = async () => { calls++; throw Error('acknowledgement lost'); };
    await assert.rejects(f.apply('finalize'), /acknowledgement lost/);
    await assert.rejects(f.apply('finalize'), /GITHUB_OUTCOME_RECONCILIATION_REQUIRED/);
    assert.equal(calls, 1);
  } finally { await f.db.close(); }
});

test('setup ownership permits stage only, with fresh native frozen readback', async () => {
  const f = await fixture();
  try {
    const result = await performHandover({ plan: f.plan, github: f.github, vercel: f.vercel, coordinator: { db: f.db, connection: f.connection },
      qualifyStage: async ({ ownershipVerifier }) => {
        await assert.rejects(ownershipVerifier({ phase: 'promote' }), /CANNOT_PROMOTE_OR_ROLLBACK/);
        await assert.rejects(ownershipVerifier({ phase: 'rollback' }), /CANNOT_PROMOTE_OR_ROLLBACK/);
        await ownershipVerifier({ phase: 'stage' }); return f.github.qualification();
      }, retireOldWriters: async () => {} });
    assert.equal(result.deploymentId, 200);
    const sql = readFileSync(new URL('../scripts/rapid-release/handover-guard.sql', import.meta.url), 'utf8');
    assert.doesNotMatch(sql, /update\s+public\.|delete\s+from|drop\s+(?:table|trigger)|install_epoch/i);
  } finally { await f.db.close(); }
});

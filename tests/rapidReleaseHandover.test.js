import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { auditHandover, applyHandover, performHandover, createHandoverPlan, handoverDigest, handoverPins, OLD_RELEASE_WORKFLOWS, assertHandoverConnection, assertHandoverDatabaseIdentity, assertHandoverActivation } from '../scripts/lib/rapid-release/handover.mjs';
import { verifyNativeHandoverDatabase } from '../scripts/lib/rapid-release/compatibility.mjs';
import { dummyDelegation } from './helpers/rapidDatabaseDelegationFixture.mjs';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const pins = handoverPins();
test('database transport admits only exact project-bound session pooling with verified TLS',()=>{
 const connection={host:'aws-0-ap-southeast-1.pooler.supabase.com',port:5432,user:`postgres.${pins.projectRef}`,database:'postgres',ssl:{rejectUnauthorized:true}};
 assertHandoverConnection(connection);
 for(const change of [{user:'postgres.other_project'},{user:'postgres'},{port:6543},{host:'other.pooler.supabase.com'},{ssl:{rejectUnauthorized:false}},{database:'other'}])
  assert.throws(()=>assertHandoverConnection({...connection,...change}),/PINNED_TLS/);
});
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
  let plan, active = null, rapidPending = 0, creates = 0, approved = true, retired = true, aliasAssigned = false, subscriberAvailable = true;
  const deployments = new Map();
  const connection = { host: `db.${pins.projectRef}.supabase.co`, port: 5432, user: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: true } };
  const github = {
    identity: async () => ({ login: pins.account, repository: pins.repository }), execution: async () => ({ runId: 100, jobId: 101 }),
    verifyNativePlan: async ({ planHash, plan: value }) => { assert.equal(planHash, handoverDigest(value)); },
    eventSubscribers: async () => { if (!subscriberAvailable) throw Error('APP_SUBSCRIBER_SCOPE_MISSING'); return { inventory: [{ kind: 'workflow', path: 'workflow_dispatch-only' }], evidenceDigest: 'a'.repeat(64) }; },
    pages: async () => [], rapidJournalAudit: async () => ({ digest: 'e'.repeat(64), unresolvedProduction: rapidPending }), activeHandover: async () => active,
    get: async path => {
      if (path.includes('/contents/')) return { type:'file', sha:'f'.repeat(40) };
      if (path.includes('/actions/variables/')) return { value: retired ? 'false' : 'true' };
      if (path.includes('/actions/workflows/')) return { id: OLD_RELEASE_WORKFLOWS.indexOf(path.split('/').at(-1)) + 1, state: retired ? 'disabled_manually' : 'active' };
      if (path.endsWith('/approvals')) return approved ? [{ id: 90, state: 'approved', user: { login: pins.account, id: 7 }, environments: [{ id: 1 }] }] : [];
      if (path.includes('/environments/')) return { id: 1, can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', reviewers: [{ reviewer: { login: pins.account } }] }] };
      if (path.includes('/actions/jobs/')) return { id: 101, run_id: 100, status: 'in_progress', name: 'handover-apply' };
      return { id: 100, head_sha: plan?.controllerSha || 'a'.repeat(40), event: 'workflow_dispatch', status: 'in_progress', actor: { login: pins.account }, repository: { full_name: pins.repository }, path: '.github/workflows/fcos-rapid-handover.yml' };
    },
    qualification: async () => ({ runId: 100, planHash: handoverDigest(plan), controllerSha: plan.controllerSha, candidateSha: plan.candidateSha,
      buildId: plan.buildId, artifactDigest: plan.artifactDigest, deploymentId: 'dpl_qualified', browser: { passed: true, login: true, restrictedAccess: true, normalRole: true, businessWrites: 0, deploymentId: 'dpl_qualified', buildId: plan.buildId } }),
    createDeployment: async request => { const deployment = { id: 200 + creates++, creator: { login: pins.account }, payload: request.payload }; deployments.set(request.payload.planHash, deployment); return deployment; },
    findDeployment: async ({ planHash }) => deployments.get(planHash),
  };
  const vercel = { project: async () => ({ id: pins.projectId, accountId: pins.teamId, autoAssignCustomDomains: false }),
    currentProduction: async () => ({ id: 'dpl_old' }),
    deployment: async () => ({ id: 'dpl_qualified', readyState: 'READY', target: 'production', projectId: pins.projectId, ownerId: pins.teamId, aliasAssigned,
      meta: { githubCommitSha: plan.candidateSha, fcosRapidBuildId: plan.buildId, fcosRapidArtifactDigest: plan.artifactDigest, fcosHandoverPlanHash: handoverDigest(plan) } }),
  };
  const input = { db, connection, github, vercel };
  const audit = await auditHandover(input);
  plan = createHandoverPlan({ audit, controllerSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), buildId: 'c'.repeat(64), artifactDigest: 'd'.repeat(64), handoverId: 'rapid-handover-test' });
  return { ...input, get plan() { return plan; }, set plan(value) { plan = value; }, audit,
    set active(value) { active = value; }, set rapidPending(value) { rapidPending = value; },
    async activate(result) {
      const audit = await auditHandover(input);
      const receipt = assertHandoverActivation({ plan, audit, deploymentId: result.deploymentId });
      active = { deploymentId: result.deploymentId, handoverId: plan.handoverId, planHash: handoverDigest(plan), controllerSha: plan.controllerSha,
        databaseReceiptId: receipt.databaseReceiptId, nativeCoordinatorReadbackDigest: receipt.evidenceDigest };
      return active;
    }, set approved(v) { approved = v; }, set retired(v) { retired = v; }, set aliasAssigned(v) { aliasAssigned = v; },
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

test('handover admits only factory-proven native delegation and preserves real CLI session identity', async () => {
  const f = await fixture();
  let delegated;
  try {
    delegated = await (await dummyDelegation(f.db)).open();
    const input = { ...f, ...delegated };
    const audit = await auditHandover(input);
    assert.equal(audit.database.preservedOtherUnknowns.count, 1);
    await applyHandover({ ...input, plan: f.plan, phase: 'prepare' });
    const row = (await delegated.db.query("select session_user,current_user,current_database() as database,current_setting('transaction_read_only') as read_only")).rows[0];
    assert.equal(row.session_user, 'cli_login_postgres');
    assert.equal(row.current_user, 'postgres');
    assert.equal(assertHandoverDatabaseIdentity(row, delegated.connection, { readOnly: false }), row);
    assert.throws(() => assertHandoverConnection({ ...delegated.connection }), /PINNED_TLS/);
    assert.throws(() => assertHandoverDatabaseIdentity(row, f.connection, { readOnly: false }), /DATABASE_IDENTITY_MISMATCH/);
  } finally { if (delegated) await delegated.db.end(); await f.db.close(); }
});

test('provider admission requires the current finalized private receipt, unchanged freeze and guard, and no unknown writes',async()=>{
 const f=await fixture();try{
  await f.apply('prepare');const finalized=await f.apply('finalize');
  const handover=(await f.github.findDeployment({planHash:handoverDigest(f.plan)})).payload;
  assert.equal((await verifyNativeHandoverDatabase(f.db,handover)).databaseReceiptId,handover.databaseReceiptId);
  await assert.rejects(verifyNativeHandoverDatabase(f.db,{...handover,databaseReceiptId:handover.databaseReceiptId+1}),/CURRENT_PERMANENT_HANDOVER_RECEIPT_REQUIRED/);
  await assert.rejects(verifyNativeHandoverDatabase(f.db,{...handover,nativeReview:{...handover.nativeReview,reviewer:'other'}}),/CURRENT_PERMANENT_HANDOVER_RECEIPT_REQUIRED/);
  await f.db.exec("insert into fcos_release_coordination.operations values('lost-production-ack','production.promote')");
  await assert.rejects(verifyNativeHandoverDatabase(f.db,handover),/CURRENT_PERMANENT_HANDOVER_RECEIPT_REQUIRED/);
  await f.db.exec("insert into fcos_release_coordination.operation_events values(999,'lost-production-ack','complete')");
  await verifyNativeHandoverDatabase(f.db,handover);
  await f.db.exec('alter table fcos_release_coordination.control disable trigger rapid_handover_control_no_truncate');
  await assert.rejects(verifyNativeHandoverDatabase(f.db,handover),/CURRENT_PERMANENT_HANDOVER_RECEIPT_REQUIRED/);
  assert.ok(finalized.deploymentId);
 }finally{await f.db.close();}
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

async function successor(f, suffix = 'successor') {
  const audit = await auditHandover(f);
  f.plan = createHandoverPlan({ audit, controllerSha: 'f'.repeat(40), candidateSha: 'b'.repeat(40), buildId: 'c'.repeat(64), artifactDigest: 'd'.repeat(64), handoverId: `rapid-handover-${suffix}` });
  return f.plan;
}
test('a qualified successor appends new receipts and switches the active version without unfreezing history', async () => {
  const f = await fixture();
  try {
    await f.apply('prepare'); const first = await f.apply('finalize'); const parent = await f.activate(first);
    const control = (await f.db.query('select to_jsonb(c) as value from fcos_release_coordination.control c')).rows[0].value;
    await successor(f); assert.deepEqual(f.plan.supersedes, parent);
    await f.apply('prepare'); const second = await f.apply('finalize'); const active = await f.activate(second);
    assert.equal(second.deploymentId, 201); assert.equal(f.creates, 2); assert.equal(active.controllerSha, 'f'.repeat(40));
    const rows = (await f.db.query("select * from fcos_release_coordination.rapid_handover_receipts where phase='finalized' order by receipt_id")).rows;
    assert.equal(rows.length, 2); assert.ok(Number(rows[1].receipt_id) > Number(rows[0].receipt_id));
    assert.deepEqual(rows[1].evidence.supersedes, parent);
    assert.deepEqual((await f.db.query('select to_jsonb(c) as value from fcos_release_coordination.control c')).rows[0].value, control);
    await assert.rejects(f.db.query("update fcos_release_coordination.control set mode='qualification'"), /PERMANENTLY_FENCED/);
    assert.equal((await f.db.query('select id from fcos_release_coordination.imported_uncertainty')).rows[0].id, 'permanent-sentinel-preserved');
    assert.equal((await f.db.query('select id from public.financial_lock')).rows[0].id, 'held');
  } finally { await f.db.close(); }
});
test('successors require the latest native activated parent and refuse an older or uncertain pointer', async () => {
  const f = await fixture();
  try {
    await f.apply('prepare'); const finalized = await f.apply('finalize');
    await assert.rejects(successor(f), /ACTIVE_PARENT_UNCERTAIN/); // DB committed, native activation absent.
    const parent = await f.activate(finalized); await successor(f);
    const correct = f.plan;
    f.plan = { ...correct, supersedes: { ...parent, databaseReceiptId: parent.databaseReceiptId - 1 } };
    await assert.rejects(f.apply('prepare'), /PARENT_CHANGED/);
    f.plan = correct; await f.apply('prepare');
    const audit = await auditHandover(f);
    assert.throws(() => createHandoverPlan({ audit, controllerSha: '0'.repeat(40), candidateSha: 'b'.repeat(40), buildId: 'c'.repeat(64), artifactDigest: 'd'.repeat(64), handoverId: 'rapid-other-plan' }), /OTHER_PREPARATION_UNRESOLVED/);
    await f.apply('abort');
    assert.equal((await f.db.query('select mode from fcos_release_coordination.control')).rows[0].mode, 'frozen');
    assert.equal(f.creates, 1);
  } finally { await f.db.close(); }
});
test('a new unresolved rapid provider intent blocks preparation and activation without changing any outcome', async () => {
  const f = await fixture();
  try {
    f.rapidPending = 1;
    await assert.rejects(f.apply('prepare'), /RAPID_OPERATION_OR_JOURNAL_CHANGED/);
    assert.equal((await f.db.query('select mode from fcos_release_coordination.control')).rows[0].mode, 'qualification');
    f.rapidPending = 0; await f.apply('prepare'); const result = await f.apply('finalize');
    f.rapidPending = 1; await assert.rejects(f.activate(result), /ACTIVATION_STATE_CHANGED/);
    assert.equal(f.creates, 1);
  } finally { await f.db.close(); }
});

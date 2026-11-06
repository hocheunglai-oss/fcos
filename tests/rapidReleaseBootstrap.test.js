import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { targets, digest } from '../scripts/lib/rapid-release/contract.mjs';
import { BOOTSTRAP_BRANCH, BOOTSTRAP_ENVIRONMENT, BootstrapJournal, auditBootstrap, bootstrapRequest,
  claimBootstrap, createBootstrapPlan, readBootstrapDatabase, runBootstrap } from '../scripts/lib/rapid-release/bootstrap.mjs';
import { bootstrapMain } from '../scripts/rapid-release-bootstrap.mjs';
import { dummyDelegation } from './helpers/rapidDatabaseDelegationFixture.mjs';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const pins = targets(), accountId = 7;
async function fixture() {
  const pg = new PGlite(), directory = mkdtempSync(join(tmpdir(), 'fcos-bootstrap-test-'));
  await pg.exec(`create role anon;create role authenticated;create role service_role;create role fcos_coordinator_runtime;create role fcos_coordinator_owner;
    grant fcos_coordinator_owner to postgres;create schema fcos_release_coordination authorization fcos_coordinator_owner;
    create table fcos_release_coordination.control(singleton boolean primary key,epoch bigint,operation_id text,mode text,bootstrap_id text,recovery_id text,plan_completion_id text,source_upgrade_id text);
    insert into fcos_release_coordination.control values(true,1,null,'qualification',null,null,null,null);
    create table fcos_release_coordination.operations(operation_id text,phase text);
    create table fcos_release_coordination.operation_events(event_id bigint,operation_id text,state text);
    insert into fcos_release_coordination.operations values('retained-preview-unknown','preview.create');
    create table fcos_release_coordination.imported_uncertainty(id text);insert into fcos_release_coordination.imported_uncertainty values('preserved');
    create table public.financial_lock(id text);insert into public.financial_lock values('held');`);
  // Each pg session holds the same native transaction boundary. PGlite's single
  // connection is serialized here, rather than pretending HTTP requests are a session.
  let tail = Promise.resolve();
  const session = () => {
    let release;
    return { async query(text, parameters) {
      if (text.startsWith('begin ')) { const previous = tail; tail = new Promise(resolve => { release = resolve; }); await previous; }
      try { return text.startsWith('-- One-time') ? (await pg.exec(text)).at(-1) : await pg.query(text, parameters); }
      finally { if (['commit','rollback'].includes(text)) { release?.(); release = null; } }
    } };
  };
  const f = { pg, directory, creates: 0, journalWrites: 0, bot: true, alias: 'dpl_old', source: { sha: 'a'.repeat(40), sourceDigest: 'b'.repeat(64), lockDigest: 'c'.repeat(64) },
    inventory: { repositoryId: 1278654816, installations: [{ id: 1, app_id: 2, slug: 'vercel' }], hooks: [], workflows: [{ id: 3, path: '.github/workflows/quality.yml' }] } };
  const records = [], deployments = [];
  const github = {
    read: async path => {
      const repo = { id: 1278654816, full_name: pins.repository, default_branch: 'main', permissions: { admin: true } };
      if (path === '/user') return { id: accountId, login: f.account || pins.account };
      if (path.endsWith(`/repos/${pins.repository}`)) return repo;
      if (path.includes('/pulls/')) return { number: 124, state: 'open', base: { ref: 'main', repo }, head: { sha: f.source.sha, ref: BOOTSTRAP_BRANCH, repo } };
      if (path.includes('/git/ref/')) return { object: { sha: f.source.sha } };
      if (path.includes('/check-runs?')) return { total_count: 1, check_runs: [{ id: 10, name: 'code-and-database', app: { id: 15368 }, head_sha: f.source.sha,
        status: 'completed', conclusion: f.qualityFailed ? 'failure' : 'success', details_url: `https://github.com/${pins.repository}/actions/runs/11/job/12` }] };
      if (path.includes('/actions/runs/')) return { id: 11, head_sha: f.source.sha, event: 'pull_request', repository: repo, head_repository: repo, path: '.github/workflows/quality.yml' };
      if (path.includes('/actions/jobs/')) return { id: 12, run_id: 11, head_sha: f.source.sha, name: 'code-and-database', status: 'completed', conclusion: 'success' };
      throw Error(`Unexpected native GET ${path}`);
    },
    inventory: async () => f.inventory,
    pages: async path => {
      if (path.includes(`environment=${BOOTSTRAP_ENVIRONMENT}`)) return records;
      if (path.includes('environment=Preview')) return f.bot && deployments.length ? [{ id: 90, sha: f.plan.controllerSha, environment: 'Preview', creator: { login: 'vercel[bot]' } }] : [];
      if (path.includes('/statuses?')) return [{ id: 91, creator: { login: 'vercel[bot]' }, state: 'success', environment_url: `https://${deployments[0].url}` }];
      throw Error('Unexpected journal/Preview GET');
    },
    write: async (_path, body) => {
      f.journalWrites++;
      assert.equal(body.environment, BOOTSTRAP_ENVIRONMENT); assert.equal(body.production_environment, false);
      assert.ok(readFileSync(f.journalPath, 'utf8').includes(body.payload.recordHash), 'Local durable intent precedes GitHub POST.');
      if (f.journalUnavailable) throw Error('ACK unknown before native object observed');
      records.push({ id: records.length + 1, sha: f.plan.controllerSha, environment: body.environment, creator: { login: pins.account, id: accountId }, payload: body.payload });
      if (f.journalLostAck) { f.journalLostAck = false; throw Error('lost ACK'); }
    },
  };
  const vercel = {
    identity: async () => ({ user: { username: pins.vercelAccount }, team: { id: pins.teamId, slug: pins.team } }),
    project: async () => ({ id: pins.projectId, accountId: pins.teamId, autoAssignCustomDomains: false, link: { type: 'github', repoId: 1278654816 } }),
    currentProduction: async () => ({ id: f.alias, alias: new URL(pins.origin).hostname, projectId: pins.projectId, teamId: pins.teamId }),
    findDeployments: async () => deployments.map(row => ({ id: row.id })),
    deployment: async id => ({ ...deployments.find(row => row.id === id), ...(f.deploymentOverride || {}) }),
    create: async body => {
      f.creates++; f.request = body;
      assert.deepEqual(Object.keys(body).sort(), ['gitSource','meta','name','project']);
      if (f.noProviderAck) throw Error('ACK unknown with no ID');
      deployments.push({ id: 'dpl_preview', name: 'fcos', target: null, ownerId: pins.teamId, projectId: pins.projectId, readyState: 'READY',
        url: `fcos-123456789-${pins.team}.vercel.app`, gitSource: body.gitSource,
        meta: { ...body.meta, githubCommitSha: body.gitSource.sha, githubCommitRef: body.gitSource.ref } });
      if (f.changeAliasAfterPost) f.alias = 'dpl_foreign';
      if (f.vercelLostAck) { f.vercelLostAck = false; throw Error('lost provider ACK'); }
    },
  };
  const connection = { host: `db.${pins.supabaseProject}.supabase.co`, port: 5432, user: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: true } };
  f.input = { github, vercel, connection, db: session(), sourceReader: async () => f.source };
  const audit = await auditBootstrap(f.input);
  f.plan = createBootstrapPlan({ source: audit.source, audit: audit.database, inventoryDigest: audit.inventoryDigest, quality: audit.quality, previousProductionId: audit.previousProductionId });
  f.journalPath = join(directory, 'journal.jsonl');
  f.input.plan = f.plan; f.input.journal = new BootstrapJournal({ path: f.journalPath, github, plan: f.plan, actorId: accountId });
  f.session = session; f.records = records;
  f.run = () => runBootstrap(f.input);
  f.close = async () => { await pg.close(); rmSync(directory, { recursive: true, force: true }); };
  return f;
}

test('bootstrap native delegation retains session identity and rejects copied proof before claim', async () => {
  const f = await fixture();
  let delegated;
  try {
    delegated = await (await dummyDelegation(f.pg)).open();
    const input = { ...f.input, ...delegated };
    assert.equal((await readBootstrapDatabase(input)).control.mode, 'qualification');
    await assert.rejects(claimBootstrap({ ...input, connection: { ...delegated.connection } }), /PINNED_TLS/);
    const claimed = await claimBootstrap(input);
    assert.equal(claimed.state.control.mode, 'frozen');
    const row = (await delegated.db.query('select session_user,current_user')).rows[0];
    assert.equal(row.session_user, 'cli_login_postgres');
    assert.equal(row.current_user, 'postgres');
  } finally { if (delegated) await delegated.db.end(); await f.close(); }
});

test('one-time bootstrap freezes only old release control and verifies real Git Preview proof', async () => {
  const f = await fixture(); try {
    const result = await f.run(); assert.equal(result.state, 'preview_ready_for_authenticated_release'); assert.equal(f.creates, 1);
    assert.deepEqual(f.request, bootstrapRequest(f.plan)); assert.equal(f.request.gitSource.prId, 124);
    const state = await readBootstrapDatabase(f.input);
    assert.deepEqual(state.control, { ...f.plan.controlPreimage, mode: 'frozen' }); assert.equal(state.receipts.length, 4);
    assert.equal((await f.pg.query('select * from public.financial_lock')).rows[0].id, 'held');
    assert.equal((await f.pg.query('select count(*)::int as n from fcos_release_coordination.operations')).rows[0].n, 1);
    assert.equal((await f.pg.query('select * from fcos_release_coordination.imported_uncertainty')).rows[0].id, 'preserved');
    await assert.rejects(f.pg.query("update fcos_release_coordination.control set mode='qualification'"), /OLD_WRITER_FENCED/);
    await assert.rejects(f.pg.query('truncate fcos_release_coordination.rapid_bootstrap_receipts'), /APPEND_ONLY/);
    const saved = f.journalWrites; await f.run(); assert.equal(f.creates, 1); assert.equal(f.journalWrites, saved);
  } finally { await f.close(); }
});

test('lost GitHub and Vercel acknowledgements reconcile original objects without duplicate submissions', async () => {
  const f = await fixture(); try {
    f.journalLostAck = true; f.vercelLostAck = true; await f.run(); assert.equal(f.creates, 1);
    await f.run(); assert.equal(f.creates, 1);
    assert.equal(f.records.filter(row => row.environment === 'Preview').length, 0, 'Bootstrap never fabricates native Preview proof.');
  } finally { await f.close(); }
});

test('a saved submission ticket with no provider ID remains uncertain and is never resubmitted', async () => {
  const f = await fixture(); try {
    f.noProviderAck = true; await assert.rejects(f.run(), /ORIGINAL_SUBMISSION_UNCERTAIN/); assert.equal(f.creates, 1);
    f.noProviderAck = false; await assert.rejects(f.run(), /ORIGINAL_SUBMISSION_UNCERTAIN/); assert.equal(f.creates, 1);
  } finally { await f.close(); }
});

test('crash after freeze resumes the exact receipt; crash before POST never reissues the ticket', async () => {
  const f = await fixture(); try {
    const original = f.input.journal.append.bind(f.input.journal); let crash = true;
    f.input.journal.append = async (event, data) => { if (crash && event === 'bootstrap.claimed') throw Error('simulated interruption'); return original(event, data); };
    await assert.rejects(f.run(), /simulated interruption/); assert.equal(f.creates, 0);
    crash = false; await f.run(); assert.equal(f.creates, 1);
  } finally { await f.close(); }
  const beforePost = await fixture(); try {
    let reads = 0;
    beforePost.input.sourceReader = async () => { reads++; if (reads === 2) throw Error('interrupted before POST'); return beforePost.source; };
    await assert.rejects(beforePost.run(), /interrupted before POST/); assert.equal(beforePost.creates, 0);
    beforePost.input.sourceReader = async () => beforePost.source;
    await assert.rejects(beforePost.run(), /ORIGINAL_SUBMISSION_UNCERTAIN/); assert.equal(beforePost.creates, 0);
  } finally { await beforePost.close(); }
});

test('concurrent native claims retain a single owner and reject another source or operation', async () => {
  const f = await fixture(); try {
    const claims = await Promise.all([claimBootstrap(f.input), claimBootstrap({ ...f.input, db: f.session() })]);
    assert.equal(claims[0].claim.receipt_id, claims[1].claim.receipt_id);
    assert.equal((await readBootstrapDatabase(f.input)).receipts.length, 1);
    await assert.rejects(claimBootstrap({ ...f.input, plan: { ...f.plan, operationId: 'fcos-bootstrap-11111111-1111-4111-8111-111111111111' } }), /FOREIGN_OR_CHANGED_FREEZE/);
  } finally { await f.close(); }
});

test('concurrent executors receive only one committed Vercel submission ticket', async () => {
  const f = await fixture(); try {
    const append = f.input.journal.append.bind(f.input.journal); let tail = Promise.resolve();
    // Serialize the shared local journal so the native SQL ticket is the race under test.
    f.input.journal.append = (...args) => { const result = tail.then(() => append(...args)); tail = result.catch(() => {}); return result; };
    const results = await Promise.allSettled([f.run(), runBootstrap({ ...f.input, db: f.session() })]);
    assert.ok(results.some(row => row.status === 'fulfilled')); assert.equal(f.creates, 1);
    assert.equal((await readBootstrapDatabase(f.input)).receipts.filter(row => row.phase === 'vercel_intent').length, 1);
  } finally { await f.close(); }
});

test('source/check/inventory/identity drift and foreign freezes stop before the first external write', async () => {
  for (const change of [f => { f.source = { ...f.source, sourceDigest: 'd'.repeat(64) }; }, f => { f.qualityFailed = true; },
    f => { f.inventory = { ...f.inventory, hooks: [{ id: 99 }] }; }, f => { f.account = 'wrong-account'; },
    async f => { await f.pg.query("update fcos_release_coordination.control set mode='frozen'"); },
    async f => { await f.pg.query("insert into fcos_release_coordination.operations values('unresolved-prod','production.stage')"); }]) {
    const f = await fixture(); try { await change(f); await assert.rejects(f.run()); assert.equal(f.creates, 0); assert.equal(f.journalWrites, 0); }
    finally { await f.close(); }
  }
});

test('missing bot proof, changed live alias or non-Preview native postimage cannot qualify', async () => {
  const f = await fixture(); try {
    f.bot = false; await assert.rejects(f.run(), /GENUINE_BOT_PREVIEW_MISSING/); assert.equal(f.creates, 1);
    f.bot = true; await f.run(); assert.equal(f.creates, 1);
    const writes = f.journalWrites;
    const proof = await runBootstrap({ ...f.input, journal: null, readbackOnly: true });
    assert.equal(proof.state, 'original_preview_readback'); assert.equal(f.journalWrites, writes);
  } finally { await f.close(); }
  for (const change of [f => { f.changeAliasAfterPost = true; }, f => { f.deploymentOverride = { target: 'production' }; }, f => { f.deploymentOverride = { gitSource: { sha: '0'.repeat(40), repoId: 1278654816 } }; }]) {
    const f = await fixture(); try { change(f); await assert.rejects(f.run(), /LIVE_ALIAS_CHANGED|DEPLOYMENT_MISMATCH/); assert.equal(f.creates, 1);
      assert.equal((await readBootstrapDatabase(f.input)).receipts.some(row => row.phase === 'preview_qualified'), false); }
    finally { await f.close(); }
  }
});

test('unknown journal ACK stops before coordination and is never blindly posted again', async () => {
  const f = await fixture(); try {
    f.journalUnavailable = true; await assert.rejects(f.run(), /JOURNAL_ACK_UNCERTAIN/);
    const writes = f.journalWrites; f.journalUnavailable = false; await assert.rejects(f.run(), /JOURNAL_ACK_UNCERTAIN/);
    assert.equal(f.journalWrites, writes); assert.equal(f.creates, 0); assert.equal((await readBootstrapDatabase(f.input)).control.mode, 'qualification');
  } finally { await f.close(); }
});

test('TLS/role flags and CLI hash arguments cannot grant setup authority', async () => {
  const f = await fixture(); try {
    await assert.rejects(runBootstrap({ ...f.input, connection: { ...f.input.connection, ssl: { rejectUnauthorized: false } } }), /PINNED_TLS/);
    await assert.rejects(runBootstrap({ ...f.input, connection: { ...f.input.connection, user: 'arbitrary_role', delegated: true } }), /PINNED_TLS/);
    await assert.rejects(bootstrapMain(['apply'], { privateInput: Buffer.from('must-not-use') }), /EXACT_PLAN_REQUIRED/);
    await assert.rejects(bootstrapMain(['apply','--plan','/nonexistent']), /ENOENT/);
    const path = join(f.directory,'plan.json'); writeFileSync(path,JSON.stringify(f.plan));
    await assert.rejects(bootstrapMain(['apply','--plan',path,'--journal',join(f.directory,'other.jsonl'),'--authorization-hash','true'],
      { privateInput: Buffer.from('must-not-use') }), /EXACT_SETUP_AUTHORIZATION_REQUIRED/);
    assert.notEqual(digest(f.plan), 'true'); assert.equal(f.creates, 0);
  } finally { await f.close(); }
});

test('guard tampering, expired plans and unavailable native inventory do not acquire new write authority', async () => {
  const f = await fixture(); try {
    await f.run(); const before = f.journalWrites;
    await f.pg.query('alter table fcos_release_coordination.control disable trigger rapid_bootstrap_control_guard');
    await assert.rejects(f.run(), /GUARD_CHANGED/); assert.equal(f.journalWrites, before); assert.equal(f.creates, 1);
    const privileges = (await f.pg.query("select has_table_privilege('fcos_coordinator_runtime','fcos_release_coordination.rapid_bootstrap_receipts','INSERT') as allowed")).rows[0];
    assert.equal(privileges.allowed, false);
  } finally { await f.close(); }
  const expired = await fixture(); try {
    expired.input.plan = { ...expired.plan, createdAt: new Date(Date.now()-172800000).toISOString(), expiresAt: new Date(Date.now()-86400000).toISOString() };
    await assert.rejects(expired.run(), /PLAN_EXPIRED/); assert.equal(expired.journalWrites, 0); assert.equal(expired.creates, 0);
  } finally { await expired.close(); }
  const missing = await fixture(); try {
    let calls = 0; missing.input.github.inventory = async () => { calls++; throw Error('NATIVE_APP_SCOPE_UNAVAILABLE'); };
    await assert.rejects(missing.run(), /NATIVE_APP_SCOPE_UNAVAILABLE/); assert.equal(calls, 1); assert.equal(missing.journalWrites, 0);
  } finally { await missing.close(); }
});

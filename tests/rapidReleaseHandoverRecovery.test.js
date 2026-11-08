import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { PGlite } from '@electric-sql/pglite';
import { closePreparedHandover } from '../scripts/rapid-release-handover-recovery.mjs';
import { bootstrapRequest, claimBootstrap, createBootstrapPlan, readBootstrapDatabase } from '../scripts/lib/rapid-release/bootstrap.mjs';
import { verifyLockedBootstrap } from '../scripts/lib/rapid-release/bootstrap-admission.mjs';
import { bootstrapSuccessorRef, bootstrapSuccessorRequest, createBootstrapSuccessorPlan } from '../scripts/lib/rapid-release/bootstrap-successor.mjs';
import { canonical, createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { handoverDigest, handoverPins, readHandoverSnapshot } from '../scripts/lib/rapid-release/handover.mjs';

const path = '.github/workflows/fcos-rapid-handover-recovery.yml';
const originalPath = '.github/workflows/fcos-rapid-handover.yml';
const environment = { name: 'fcos-production-release', id: 8, can_admins_bypass: false };
const pins = targets();
const owner = { login: pins.account, id: 7 }, bot = { login: 'github-actions[bot]', id: 4 };
const repo = { full_name: pins.repository, id: 1278654816, owner, default_branch: 'main', permissions: { admin: true } };
const review = { state: 'approved', user: owner, environments: [{ id: environment.id, name: environment.name }] };
const controllerSha = 'b'.repeat(40), recoverySha = 'c'.repeat(40), dispatcherSha = 'd'.repeat(40), originalDispatcherSha = 'e'.repeat(40);
const handoverBlob = 'f'.repeat(40), recoveryBlob = 'a'.repeat(40), stagedDeploymentId = 'dpl_staged';
const guardSql = readFileSync(new URL('../scripts/rapid-release/handover-guard.sql', import.meta.url), 'utf8');

async function fixture(t, { unstaged = false } = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create role fcos_coordinator_runtime; create role fcos_coordinator_owner;
    grant fcos_coordinator_owner to postgres;
    create schema fcos_release_coordination authorization fcos_coordinator_owner;
    create table fcos_release_coordination.control(singleton boolean primary key, epoch bigint, operation_id text,
      mode text, bootstrap_id text, recovery_id text, plan_completion_id text, source_upgrade_id text);
    insert into fcos_release_coordination.control values(true,1,null,'qualification',null,null,null,null);
    create table fcos_release_coordination.operations(operation_id text, phase text);
    create table fcos_release_coordination.operation_events(event_id bigint, operation_id text, state text);
    insert into fcos_release_coordination.operations values('older-preview','preview.create');
    create function fcos_release_coordination.reject_mutation() returns trigger language plpgsql as $$
      begin raise exception 'APPEND_ONLY'; end $$;`);
  const queries = [], f = { pg, queries, opens: 0, closes: 0 };
  const db = { async query(text, args) {
    queries.push(text);
    return text.startsWith('-- One-time') ? (await pg.exec(text)).at(-1) : pg.query(text, args);
  }, async end() { f.closes++; } };
  const connection = { host: `db.${pins.supabaseProject}.supabase.co`, port: 5432, user: 'postgres',
    database: 'postgres', ssl: { rejectUnauthorized: true } };
  const quality = { checkRunId: 10, runId: 11, jobId: 12 }, previousProductionId = 'dpl_old';
  const rootPlan = createBootstrapPlan({ source: { sha: 'a'.repeat(40), sourceDigest: 'a'.repeat(64), lockDigest: 'b'.repeat(64) },
    audit: await readBootstrapDatabase({ db, connection }), inventoryDigest: 'c'.repeat(64), previousProductionId, quality });
  await claimBootstrap({ db, connection, plan: rootPlan });
  const requestHash = digest(bootstrapRequest(rootPlan));
  const qualified = { deploymentId: 'dpl_preview', githubPreviewDeploymentId: 90, githubPreviewStatusId: 91 };
  for (const [phase, evidence] of [['vercel_intent', { requestHash }], ['vercel_observed', { requestHash, deploymentId: qualified.deploymentId }], ['preview_qualified', qualified]]) {
    await pg.query('insert into fcos_release_coordination.rapid_bootstrap_receipts(operation_id,phase,plan_hash,controller_sha,evidence) values($1,$2,$3,$4,$5::jsonb)',
      [rootPlan.operationId, phase, digest(rootPlan), rootPlan.controllerSha, JSON.stringify(evidence)]);
  }
  const rootProof = await verifyLockedBootstrap({ db, bootstrapPlan: rootPlan, controllerSha: rootPlan.controllerSha });
  const successor = createBootstrapSuccessorPlan({ bootstrapPlan: rootPlan, controllerSha,
    sourceDigest: 'd'.repeat(64), lockDigest: rootPlan.lockDigest, configurationDigest: 'e'.repeat(64), quality,
    patch: [{ path: 'api/safety.js', oldSha: '4'.repeat(40), newSha: '5'.repeat(40), oldMode: '100644', newMode: '100644' }] });
  const authentication = { runId: 25 }, successorReview = { deploymentId: 30, digest: 'f'.repeat(64) };
  const successorProof = { ...qualified, deploymentId: 'dpl_successor', authentication };
  const successorRequestHash = digest(bootstrapSuccessorRequest(successor));
  const tree = { sha: '1'.repeat(40) }, commits = new Map([[controllerSha, { sha: controllerSha, tree }]]);
  let successorHead = rootPlan.controllerSha;
  for (const [index, phase, data] of [
    [2, 'claimed', { requestHash: successorRequestHash }],
    [3, 'vercel_intent', { requestHash: successorRequestHash }],
    [4, 'vercel_observed', { requestHash: successorRequestHash, deploymentId: successorProof.deploymentId }],
    [5, 'qualified', successorProof],
  ]) {
    const state = { schemaVersion: 1, kind: 'fcos_bootstrap_successor_state', phase, plan: successor, review: successorReview, data, parentSha: successorHead };
    const sha = String(index).repeat(40);
    commits.set(sha, { sha, tree, message: canonical(state), parents: [{ sha: successorHead }] });
    successorHead = sha;
  }
  const reference = { schemaVersion: 2, kind: 'fcos_initial_bootstrap_successor_reference', bootstrap: rootProof.bootstrap, authentication,
    successor: { plan: successor, headSha: successorHead, review: successorReview, proof: successorProof } };
  const candidate = { sha: '6'.repeat(40), sourceDigest: '1'.repeat(64), lockDigest: '2'.repeat(64) };
  const manifest = createManifest({ candidate, controllerSha, paths: ['src/App.jsx'], releaseId: 'rapid-recovery-fixture',
    previous: { sha: '7'.repeat(40), deploymentId: previousProductionId, configurationDigest: '7'.repeat(64), schemaDigest: '8'.repeat(64) },
    publicEnvironment: { VITE_SUPABASE_URL: `https://${pins.supabaseProject}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'x'.repeat(25)}` } });
  const manifestHash = digest(manifest), buildId = manifest.build.buildId, artifactDigest = '3'.repeat(64);
  const build = { schemaVersion: 1, buildId, artifactDigest, candidateSha: candidate.sha, sourceDigest: candidate.sourceDigest,
    lockDigest: candidate.lockDigest, controllerSha, qualityPassed: true, performancePassed: true, node: manifest.build.node };
  const baseline = await readHandoverSnapshot(db);
  await pg.exec(guardSql);
  const prepared = await readHandoverSnapshot(db);
  const plan = { schemaVersion: 1, kind: 'fcos_rapid_handover_plan', handoverId: 'initial-handover-fixture', controllerSha,
    candidateSha: candidate.sha, buildId, artifactDigest, pins: handoverPins(), controlPreimage: baseline.control, historyDigest: baseline.historyDigest,
    guardSqlDigest: handoverDigest(guardSql), previousProductionId, financialAuthority: false, bootstrap: { plan: rootPlan, reference },
    rapidJournal: { digest: handoverDigest([]), unresolvedProduction: 0, ignoredQualification: { releaseId: manifest.releaseId, manifestHash } } };
  const parentEvidence = { controllerSha: '9'.repeat(40) };
  const parentPlanHash = '0'.repeat(64);
  if (unstaged) {
    delete plan.bootstrap;
    plan.supersedes = { deploymentId: 88, handoverId: 'active-parent', planHash: parentPlanHash,
      controllerSha: parentEvidence.controllerSha, databaseReceiptId: 1, nativeCoordinatorReadbackDigest: handoverDigest(parentEvidence) };
    await pg.query("insert into fcos_release_coordination.rapid_handover_receipts(handover_id,phase,plan_hash,evidence) values('active-parent','finalized',$1,$2::jsonb)",
      [parentPlanHash, JSON.stringify(parentEvidence)]);
  }
  const planHash = handoverDigest(plan), preparedReceiptId = unstaged ? 2 : 1, terminalRunId = 40, stageRecordId = unstaged ? 0 : 43, runId = 44;
  const stagedInput = unstaged ? 'none' : stagedDeploymentId;
  const originalRunId = 39, originalJobId = 47;
  const originalReview = { runId: originalRunId, jobId: originalJobId, dispatcherSha: originalDispatcherSha, workflowBlobSha: handoverBlob,
    reviewDigest: handoverDigest(review), reviewer: owner.login, reviewerId: owner.id, state: review.state, environment: environment.name,
    environmentId: environment.id, workflowPath: originalPath, observedAt: '2026-11-07T00:00:00Z', planHash };
  const originalEvidence = { review: originalReview, controllerSha, candidateSha: candidate.sha, buildId, artifactDigest,
    supersedes: plan.supersedes || null, historyDigest: plan.historyDigest, controlPreimage: plan.controlPreimage,
    ...(unstaged ? {} : { bootstrap: reference }), guardDigest: prepared.guard.digest,
    qualificationDigest: null };
  await pg.query("insert into fcos_release_coordination.rapid_handover_receipts(handover_id,phase,plan_hash,evidence) values($1,'prepared',$2,$3::jsonb)",
    [plan.handoverId, planHash, JSON.stringify(originalEvidence)]);
  const operationId = `${manifest.releaseId}-stage`, stageUrl = 'fcos-stage.vercel.app';
  const request = { buildId, artifactDigest, candidateSha: candidate.sha, previousDeploymentId: previousProductionId, target: 'production', skipDomain: true };
  const result = { id: stagedDeploymentId, url: `https://${stageUrl}`, buildId, artifactDigest, sha: candidate.sha, manifestHash, operationId, target: 'production' };
  let previousHash = null;
  const records = [['release.prepared', { manifest }], ['build.passed', build], ['stage.intent', { operationId, requestHash: digest(request), request }],
    ['stage.result', { operationId, outcome: 'applied', result }]].map(([event, data], sequence) => {
    const payload = { schemaVersion: 1, kind: 'fcos_rapid_release_event', releaseId: manifest.releaseId, manifestHash, previousHash, sequence, event, data };
    previousHash = digest(payload);
    return { id: stageRecordId - 3 + sequence, environment: 'fcos-release-journal-v1', sha: candidate.sha, creator: owner,
      payload: { ...payload, recordHash: previousHash } };
  });
  if (unstaged) records.splice(2);
  const original = { repository: repo, head_repository: repo, head_branch: 'main', actor: owner, triggering_actor: owner, event: 'workflow_dispatch',
    run_attempt: 1, head_sha: originalDispatcherSha, path: originalPath, status: 'completed', conclusion: 'failure',
    display_title: `FCOS rapid handover ${planHash} ${candidate.sha}`, updated_at: '2026-11-07T00:01:00Z' };
  const current = { ...original, id: runId, head_sha: dispatcherSha, path, status: 'in_progress', conclusion: null,
    display_title: `FCOS rapid handover abort ${planHash} ${recoverySha} ${preparedReceiptId} ${terminalRunId} ${stageRecordId} ${stagedInput}` };
  Object.assign(f, { records, current, original, originalEvidence, plan, planHash, originalRunId, terminalRunId, recoverySha, guard: prepared.guard,
    input: { plan, planHash, recoverySha, preparedReceiptId, terminalRunId, stageRecordId, stagedDeploymentId: stagedInput } });
  const github = {
    async read(requestPath) {
      if (requestPath === '/user') return owner;
      if (requestPath === '/users/github-actions%5Bbot%5D') return bot;
      if (requestPath === `/repos/${pins.repository}`) return repo;
      if (requestPath.endsWith('/approvals')) return f.noReview ? [] : [review];
      if (requestPath.includes('/environments/')) return { ...environment, protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: owner }] }] };
      if (unstaged && requestPath.endsWith('/FCOS_RAPID_RELEASE_ENABLED')) return { value: 'true' };
      if (unstaged && requestPath.endsWith('/FCOS_RAPID_RELEASE_HANDOVER_ID')) return { value: String(f.pointer || 88) };
      if (unstaged && requestPath.endsWith('/deployments/88')) return { id: 88, creator: owner,
        payload: { ...plan.supersedes, kind: 'fcos_rapid_release_handover', repository: pins.repository,
          projectId: pins.projectId, teamId: pins.teamId } };
      if (requestPath.includes('/actions/variables/')) return f.active;
      if (requestPath.includes('/actions/workflows/')) return requestPath.endsWith('fcos-rapid-handover.yml') ? { id: 49, path: originalPath } : null;
      if (requestPath.includes('/contents/')) return { type: 'file', sha: requestPath.includes(path) ? recoveryBlob : handoverBlob };
      if (requestPath.endsWith(`/runs/${runId}`)) return current;
      if (requestPath.endsWith(`/runs/${terminalRunId}`)) return { ...original, id: terminalRunId, ...(f.terminalChanged || {}) };
      if (requestPath.endsWith(`/runs/${originalRunId}`)) return { ...original, id: originalRunId };
      if (requestPath.includes('/git/commits/')) return commits.get(requestPath.split('/').at(-1));
      throw Error(`unexpected GitHub read: ${requestPath}`);
    },
    async pages(requestPath) {
      if (requestPath.endsWith('/deployments?environment=fcos-rapid-handover')) return f.finalized || [];
      if (requestPath.includes('/deployments?')) return f.records;
      if (requestPath.includes('/workflows/49/runs')) return [{ status: f.oldWriter || 'completed' }];
      if (requestPath.includes('/git/matching-refs/')) return [{ ref: bootstrapSuccessorRef(successor), object: { sha: f.successorHead || successorHead } }];
      const id = Number(requestPath.split('/').at(-2));
      return [{ id: id === originalRunId ? originalJobId : id + 100, run_id: id, head_sha: id === runId ? dispatcherSha : originalDispatcherSha,
        name: id === runId ? 'handover-abort' : 'handover-apply', status: id === runId ? 'in_progress' : 'completed', conclusion: 'failure' }];
    },
  };
  const vercel = {
    async discover(args) {
      assert.equal(args.requireAbsentHandoverPlanHash, planHash);
      assert.equal(args.operationId, operationId);
      return { outcome: f.stageOutcome || 'absent' };
    },
    async currentProduction() { return { id: f.live || previousProductionId }; },
    async project() { return { id: pins.projectId, accountId: pins.teamId, autoAssignCustomDomains: false }; },
    async rawDeployment() { return { id: stagedDeploymentId, url: stageUrl, target: 'production', projectId: pins.projectId, ownerId: pins.teamId,
      readyState: 'READY', aliasAssigned: f.aliased || false, meta: { githubCommitSha: candidate.sha, fcosRapidBuildId: buildId,
        fcosRapidArtifactDigest: artifactDigest, fcosHandoverPlanHash: planHash, fcosRapidManifestHash: manifestHash, fcosRapidOperationId: operationId } }; },
  };
  f.close = input => closePreparedHandover({ input: input || f.input, github, vercel, runId, dispatcherSha,
    openDatabase: async () => { f.opens++; return { db, connection }; } });
  return f;
}

test('protected recovery appends one receipt, preserves bootstrap control and reads back repeated closure', async t => {
  const f = await fixture(t);
  const count = f.queries.length;
  const closed = await f.close(), repeated = await f.close();
  assert.deepEqual(repeated, { ...closed, reused: true });
  assert.equal(closed.receiptId, 2);
  assert.equal(f.opens, 2);
  assert.equal(f.closes, 2);
  const writes = f.queries.slice(count).filter(sql => /^(insert|update|delete|truncate|alter|create|drop)\b/i.test(sql));
  assert.equal(writes.length, 1);
  assert.match(writes[0], /^insert into fcos_release_coordination\.rapid_handover_receipts/);
  const rows = (await f.pg.query('select phase,evidence from fcos_release_coordination.rapid_handover_receipts order by receipt_id')).rows;
  assert.deepEqual(rows.map(row => row.phase), ['prepared', 'aborted']);
  assert.deepEqual(rows[0].evidence, f.originalEvidence);
  assert.equal(handoverDigest(rows[1].evidence), closed.evidenceDigest);
  assert.equal(rows[1].evidence.closure.originalReceiptDigest, handoverDigest(f.originalEvidence));
  await assert.rejects(f.pg.query("update fcos_release_coordination.control set mode='qualification'"), /BOOTSTRAP_OLD_WRITER_FENCED/);
  await assert.rejects(f.pg.query("delete from fcos_release_coordination.rapid_handover_receipts where phase='aborted'"), /APPEND_ONLY/);
  assert.deepEqual((await readHandoverSnapshot(f.pg)).guard, f.guard);
});

test('native approval, stage journal and Production liveness must all resolve before database credentials', async t => {
  const f = await fixture(t);
  f.noReview = true;
  await assert.rejects(f.close(), /PROTECTED_REVIEW_REQUIRED/);
  f.noReview = false;
  f.terminalChanged = { conclusion: 'success' };
  await assert.rejects(f.close(), /ORIGINAL_TERMINAL_RUN_REQUIRED/);
  f.terminalChanged = null;
  f.oldWriter = 'waiting';
  await assert.rejects(f.close(), /OLD_WRITER_RUNNING/);
  f.oldWriter = null;
  f.live = stagedDeploymentId;
  await assert.rejects(f.close(), /ACTIVATION_OR_PRODUCTION_CHANGED/);
  f.live = null;
  f.aliased = true;
  await assert.rejects(f.close(), /STAGE_READBACK_MISMATCH/);
  f.aliased = false;
  f.finalized = [{ payload: { kind: 'fcos_rapid_release_handover', planHash: f.planHash } }];
  await assert.rejects(f.close(), /FINALIZED_DEPLOYMENT_EXISTS/);
  f.finalized = null;
  f.records = f.records.slice(0, -1);
  await assert.rejects(f.close(), /STAGE_RESULT_REQUIRED/);
  assert.equal(f.opens, 0);
});

test('the locked receipt, successor ledger and append-only trigger must match before inserting', async t => {
  const f = await fixture(t);
  await assert.rejects(f.close({ ...f.input, preparedReceiptId: 2 }), /PROTECTED_REVIEW_REQUIRED/);
  f.successorHead = '4'.repeat(40);
  await assert.rejects(f.close(), /BOOTSTRAP_SUCCESSOR_HEAD_CHANGED/);
  f.successorHead = null;
  await f.pg.query('alter table fcos_release_coordination.rapid_handover_receipts disable trigger rapid_handover_append_only');
  await assert.rejects(f.close(), /APPEND_ONLY_RECEIPT_REQUIRED/);
  assert.equal(f.opens, 2);
  assert.equal(f.closes, 2);
  assert.deepEqual((await f.pg.query('select phase from fcos_release_coordination.rapid_handover_receipts')).rows, [{ phase: 'prepared' }]);
});

test('workflow serializes recovery and admits exact protected installed source before credential use', async () => {
  const workflow = load(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
  assert.deepEqual(workflow.concurrency, { group: 'fcos-production-release', 'cancel-in-progress': false, queue: 'max' });
  const job = workflow.jobs['handover-abort'], steps = job.steps, script = steps[0].with.script;
  assert.equal(job.environment, environment.name);
  assert.match(steps[1].with.ref, /admit-recovery.outputs.controller_sha/);
  assert.ok(steps.slice(0, -1).every(step => !JSON.stringify(step).includes('secrets.')));
  const values = { RECOVERY_SHA: recoverySha, PLAN_JSON: JSON.stringify({ controllerSha, kind: 'fcos_rapid_handover_plan', bootstrap: { reference: { schemaVersion: 2 } } }),
    PREPARED_RECEIPT_ID: '1', TERMINAL_RUN_ID: '40', STAGE_RECORD_ID: '43', STAGED_DEPLOYMENT_ID: stagedDeploymentId };
  values.PLAN_HASH = handoverDigest(JSON.parse(values.PLAN_JSON));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let sourceChanged = false, quality = true, ancestor = true, protectedBranch = true, qualityPath = '.github/workflows/quality.yml', outputs = 0;
  const github = { rest: { repos: {
    get: async () => ({ data: repo }),
    getBranch: async () => ({ data: { protected: protectedBranch, commit: { sha: dispatcherSha } } }),
    compareCommits: async () => ({ data: { status: ancestor ? 'ahead' : 'diverged' } }),
    getContent: async ({ ref }) => ({ data: { type: 'file', sha: sourceChanged && ref === recoverySha ? handoverBlob : recoveryBlob } }),
  }, checks: { listForRef: async () => ({ data: { total_count: 1, check_runs: [{ head_sha: recoverySha, name: 'code-and-database',
    app: { id: 15368 }, status: 'completed', conclusion: quality ? 'success' : 'failure',
    details_url: `https://github.com/${pins.repository}/actions/runs/12/job/13` }] } }) }, actions: {
    getWorkflowRun: async () => ({ data: { id: 12, head_sha: recoverySha, repository: repo, head_repository: repo, event: 'pull_request', path: qualityPath } }),
    getJobForWorkflowRun: async () => ({ data: { id: 13, run_id: 12, head_sha: recoverySha, name: 'code-and-database', status: 'completed', conclusion: 'success' } }),
  } } };
  const run = () => new AsyncFunction('require', 'github', 'context', 'core', 'process', script)(createRequire(import.meta.url),
    github, { repo: { owner: owner.login, repo: 'fcos' }, actor: owner.login, sha: dispatcherSha }, { setOutput: () => outputs++ }, { env: values });
  await run();
  for (const mutate of [() => { sourceChanged = true; }, () => { sourceChanged = false; quality = false; },
    () => { quality = true; qualityPath = '.github/workflows/spoof.yml'; }, () => { qualityPath = '.github/workflows/quality.yml'; ancestor = false; },
    () => { ancestor = true; protectedBranch = false; }]) {
    mutate();
    await assert.rejects(run(), /QUALIFIED_INSTALLED_HANDOVER_RECOVERY_REQUIRED/);
  }
  assert.equal(outputs, 1);
});

test('unstaged successor recovery binds the active parent and rejects uncertain or recorded staging', async t => {
  const f = await fixture(t, { unstaged: true });
  f.stageOutcome = 'unknown';
  await assert.rejects(f.close(), /STAGE_ABSENCE_REQUIRED/);
  f.stageOutcome = null;
  const previous = f.records[1];
  const intent = { ...previous.payload, sequence: 2, previousHash: previous.payload.recordHash,
    event: 'stage.intent', data: { operationId: 'original-stage' } };
  delete intent.recordHash;
  f.records.push({ ...previous, id: previous.id + 1, payload: { ...intent, recordHash: digest(intent) } });
  await assert.rejects(f.close(), /STAGE_RESULT_REQUIRED/);
  f.records.pop();
  assert.equal(f.opens, 0);
  const closed = await f.close();
  assert.equal(closed.receiptId, 3);
  assert.deepEqual(await f.close(), { ...closed, reused: true });
  const rows = (await f.pg.query('select phase,evidence from fcos_release_coordination.rapid_handover_receipts order by receipt_id')).rows;
  assert.deepEqual(rows.map(row => row.phase), ['finalized', 'prepared', 'aborted']);
  assert.equal(rows[2].evidence.closure.stage.noSubmission, true);
});

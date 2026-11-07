import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digest, git, isDigest, isSha, requireCondition as check, targets, validateManifest } from './lib/rapid-release/contract.mjs';
import { assertBuildReceipt } from './lib/rapid-release/engine.mjs';
import { assertHandoverConnection, handoverDigest, handoverPins, handoverTransaction, OLD_RELEASE_WORKFLOWS, readHandoverSnapshot } from './lib/rapid-release/handover.mjs';
import { collectRapidJournalState } from './lib/rapid-release/handover-adapter.mjs';
import { assertPublicPayload, pendingOperations, validateChain } from './lib/rapid-release/journal.mjs';
import { verifyLockedBootstrapSuccessor } from './lib/rapid-release/bootstrap-successor.mjs';
import { createDatabaseCredentialIntentStore } from './lib/rapid-release/database-intent.mjs';
import { openPinnedDatabase } from './lib/rapid-release/database-connection.mjs';
import { vercelProvider } from './lib/rapid-release/providers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const recoveryPath = '.github/workflows/fcos-rapid-handover-recovery.yml';
const handoverPath = '.github/workflows/fcos-rapid-handover.yml';
const environmentName = 'fcos-production-release';
const journalEnvironment = 'fcos-release-journal-v1';
const terminal = ['failure', 'cancelled', 'timed_out'];
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => canonical(a) === canonical(b);
const base = () => `/repos/${targets().repository}`;
const deploymentId = value => /^dpl_[A-Za-z0-9]+$/.test(value || '');
const workflowPath = run => String(run?.path || '').split('@')[0];
const guardSqlDigest = handoverDigest(readFileSync(new URL('./rapid-release/handover-guard.sql', import.meta.url), 'utf8'));

function assertRecoveryTarget(input) {
  const { plan, planHash, recoverySha, preparedReceiptId, terminalRunId, stageRecordId, stagedDeploymentId } = input;
  assertPublicPayload(plan);
  check(isSha(recoverySha) && recoverySha !== plan?.controllerSha && positive(preparedReceiptId) && positive(terminalRunId)
    && positive(stageRecordId) && deploymentId(stagedDeploymentId) && isDigest(planHash) && handoverDigest(plan) === planHash
    && plan.schemaVersion === 1 && plan.kind === 'fcos_rapid_handover_plan' && /^[a-z0-9-]{8,96}$/.test(plan.handoverId || '')
    && isSha(plan.controllerSha) && isSha(plan.candidateSha) && isDigest(plan.buildId) && isDigest(plan.artifactDigest)
    && same(plan.pins, handoverPins()) && plan.financialAuthority === false && !plan.supersedes
    && plan.guardSqlDigest === guardSqlDigest && plan.controlPreimage?.mode === 'frozen'
    && plan.bootstrap?.reference?.schemaVersion === 2 && plan.bootstrap.reference.kind === 'fcos_initial_bootstrap_successor_reference'
    && plan.bootstrap.reference.successor?.plan?.controllerSha === plan.controllerSha
    && plan.rapidJournal?.unresolvedProduction === 0 && isDigest(plan.rapidJournal.ignoredQualification?.manifestHash)
    && deploymentId(plan.previousProductionId) && plan.previousProductionId !== stagedDeploymentId,
  'HANDOVER_RECOVERY_EXACT_BOOTSTRAP_PLAN_REQUIRED');
  return { planHash, recoverySha, preparedReceiptId, terminalRunId, stageRecordId, stagedDeploymentId };
}

async function sourceBlob(github, path, sha) {
  const file = await github.read(`${base()}/contents/${path}?ref=${sha}`);
  check(file?.type === 'file' && isSha(file.sha), 'HANDOVER_RECOVERY_NATIVE_WORKFLOW_REQUIRED');
  return file.sha;
}

function nativeRun(run, repo, path, title) {
  return run?.repository?.id === repo.id && run.head_repository?.id === repo.id && run.head_branch === repo.default_branch
    && run.actor?.id === repo.owner.id && run.actor.login === repo.owner.login && run.triggering_actor?.id === repo.owner.id
    && isSha(run.head_sha) && run.event === 'workflow_dispatch' && run.run_attempt === 1
    && workflowPath(run) === path && run.display_title === title;
}

async function verifyRecoveryReview({ input, binding, github, repo, runId, dispatcherSha }) {
  const { planHash, recoverySha, preparedReceiptId, terminalRunId, stageRecordId, stagedDeploymentId } = binding;
  const title = `FCOS rapid handover abort ${planHash} ${recoverySha} ${preparedReceiptId} ${terminalRunId} ${stageRecordId} ${stagedDeploymentId}`;
  const [run, jobs, approvals, environment, frozenBlob] = await Promise.all([
    github.read(`${base()}/actions/runs/${runId}`), github.pages(`${base()}/actions/runs/${runId}/jobs`, 'jobs'),
    github.read(`${base()}/actions/runs/${runId}/approvals`), github.read(`${base()}/environments/${environmentName}`),
    sourceBlob(github, recoveryPath, input.recoverySha),
  ]);
  const review = approvals.filter(row => row.state === 'approved' && row.user?.id === repo.owner.id && row.user.login === repo.owner.login
    && row.environments?.some(item => item.id === environment.id && item.name === environmentName));
  const [job] = jobs;
  check(positive(runId) && run.id === runId && nativeRun(run, repo, recoveryPath, title) && run.head_sha === dispatcherSha
    && run.status === 'in_progress' && jobs.length === 1 && positive(job.id) && job.name === 'handover-abort'
    && job.run_id === runId && job.head_sha === dispatcherSha && job.status === 'in_progress'
    && positive(environment.id) && environment.name === environmentName && environment.can_admins_bypass === false
    && environment.protection_rules?.some(rule => rule.type === 'required_reviewers'
      && rule.reviewers?.some(item => item.type === 'User' && item.reviewer?.id === repo.owner.id && item.reviewer.login === repo.owner.login))
    && review.length === 1 && await sourceBlob(github, recoveryPath, dispatcherSha) === frozenBlob,
  'HANDOVER_RECOVERY_PROTECTED_REVIEW_REQUIRED');
  return { runId, jobId: job.id, dispatcherSha, workflowBlobSha: frozenBlob, environmentId: environment.id,
    reviewDigest: handoverDigest(review[0]), reviewerId: repo.owner.id, observedAt: new Date().toISOString() };
}

async function verifyOriginalRun({ input, github, repo, runId, originalBlob }) {
  const title = `FCOS rapid handover ${input.planHash} ${input.plan.candidateSha}`;
  const [run, jobs] = await Promise.all([
    github.read(`${base()}/actions/runs/${runId}`), github.pages(`${base()}/actions/runs/${runId}/jobs`, 'jobs'),
  ]);
  const [job] = jobs;
  check(run.id === runId && nativeRun(run, repo, handoverPath, title) && run.status === 'completed' && terminal.includes(run.conclusion)
    && jobs.length === 1 && positive(job.id) && job.run_id === runId && job.head_sha === run.head_sha
    && job.name === 'handover-apply' && job.status === 'completed' && terminal.includes(job.conclusion)
    && await sourceBlob(github, handoverPath, run.head_sha) === originalBlob, 'HANDOVER_RECOVERY_ORIGINAL_TERMINAL_RUN_REQUIRED');
  return { run, job };
}

async function assertLegacyIdle(github) {
  const workflows = [...OLD_RELEASE_WORKFLOWS, 'fcos-rapid-handover.yml'];
  await Promise.all(workflows.map(async name => {
    const workflow = await github.read(`${base()}/actions/workflows/${name}`);
    if (!workflow) return;
    check(positive(workflow.id) && workflow.path === `.github/workflows/${name}`, 'HANDOVER_RECOVERY_WORKFLOW_TARGET_MISMATCH');
    const runs = await github.pages(`${base()}/actions/workflows/${workflow.id}/runs`, 'workflow_runs');
    check(runs.every(run => run.status === 'completed'), 'HANDOVER_RECOVERY_OLD_WRITER_RUNNING');
  }));
}

async function assertProductionUnchanged({ plan, github, vercel }) {
  const [enabled, pointer, current] = await Promise.all([
    github.read(`${base()}/actions/variables/FCOS_RAPID_RELEASE_ENABLED`),
    github.read(`${base()}/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID`),
    vercel.currentProduction(),
  ]);
  check(!pointer && (!enabled || enabled.value === 'false') && current.id === plan.previousProductionId,
    'HANDOVER_RECOVERY_ACTIVATION_OR_PRODUCTION_CHANGED');
}

async function assertNoFinalizedDeployment({ plan, planHash, github }) {
  const records = await github.pages(`${base()}/deployments?environment=fcos-rapid-handover`);
  check(!records.some(row => row.payload?.kind === 'fcos_rapid_release_handover'
    && (row.payload.handoverId === plan.handoverId || row.payload.planHash === planHash)), 'HANDOVER_RECOVERY_FINALIZED_DEPLOYMENT_EXISTS');
}

async function verifyObservedStage({ input, github, vercel, actorIds }) {
  const { plan, planHash, stageRecordId, stagedDeploymentId } = input;
  const { releaseId, manifestHash } = plan.rapidJournal.ignoredQualification;
  const records = await github.pages(`${base()}/deployments?environment=${journalEnvironment}`);
  const own = records.filter(row => row.payload?.releaseId === releaseId);
  check(own.every(row => row.environment === journalEnvironment && row.sha === plan.candidateSha
    && row.creator?.id === actorIds[0] && row.creator.login === targets().account),
    'HANDOVER_RECOVERY_STAGE_JOURNAL_TARGET_MISMATCH');
  const chain = validateChain(own, manifestHash, releaseId), payloads = chain.map(row => row.payload);
  check(same(payloads.map(row => row.event), ['release.prepared', 'build.passed', 'stage.intent', 'stage.result'])
    && own.length === chain.length && chain[3].id === stageRecordId && !pendingOperations(chain).length,
  'HANDOVER_RECOVERY_STAGE_RESULT_REQUIRED');
  const [{ data: { manifest } }, { data: build }, { data: intent }, { data }] = payloads;
  check(manifest && validateManifest(manifest) === manifestHash && manifest.controllerSha === plan.controllerSha
    && manifest.candidate.sha === plan.candidateSha && manifest.build.buildId === plan.buildId
    && manifest.previous.deploymentId === plan.previousProductionId && build?.artifactDigest === plan.artifactDigest,
  'HANDOVER_RECOVERY_STAGE_MANIFEST_MISMATCH');
  assertBuildReceipt(build, manifest);
  const request = { buildId: plan.buildId, artifactDigest: plan.artifactDigest, candidateSha: plan.candidateSha,
    previousDeploymentId: plan.previousProductionId, target: 'production', skipDomain: true };
  const operationId = `${releaseId}-stage`;
  check(same(intent, { operationId, requestHash: digest(request), request }), 'HANDOVER_RECOVERY_STAGE_RESULT_REQUIRED');
  const observed = data.result;
  check(data.operationId === operationId && data.outcome === 'applied' && observed?.id === stagedDeploymentId
    && observed.buildId === plan.buildId && observed.artifactDigest === plan.artifactDigest && observed.sha === plan.candidateSha
    && observed.manifestHash === manifestHash && observed.operationId === operationId && observed.target === 'production',
  'HANDOVER_RECOVERY_STAGE_RESULT_MISMATCH');
  const rapidJournal = await collectRapidJournalState({ pages: async () => records, manifest, actorIds });
  check(same(rapidJournal, plan.rapidJournal), 'HANDOVER_RECOVERY_OTHER_JOURNAL_CHANGED');
  const [project, staged] = await Promise.all([vercel.project(), vercel.rawDeployment(stagedDeploymentId)]);
  check(project.id === plan.pins.projectId && project.accountId === plan.pins.teamId && project.autoAssignCustomDomains === false
    && staged.id === stagedDeploymentId && staged.target === 'production' && staged.projectId === plan.pins.projectId
    && staged.ownerId === plan.pins.teamId && staged.readyState === 'READY' && staged.aliasAssigned === false
    && typeof staged.url === 'string' && observed.url === `https://${staged.url}`
    && staged.meta?.githubCommitSha === plan.candidateSha && staged.meta.fcosRapidBuildId === plan.buildId
    && staged.meta.fcosRapidArtifactDigest === plan.artifactDigest && staged.meta.fcosHandoverPlanHash === planHash
    && staged.meta.fcosRapidManifestHash === manifestHash && staged.meta.fcosRapidOperationId === operationId,
  'HANDOVER_RECOVERY_STAGE_READBACK_MISMATCH');
  return { manifestHash, operationId, stageRecordHash: chain[3].payload.recordHash, stagedDeploymentId };
}

async function assertAppendOnlyReceiptTable(db) {
  const { rows } = await db.query(`select c.relrowsecurity, pg_get_userbyid(c.relowner) as owner,
    t.tgenabled, pg_get_triggerdef(t.oid) as definition
    from pg_class c join pg_trigger t on t.tgrelid=c.oid
    where c.oid='fcos_release_coordination.rapid_handover_receipts'::regclass and t.tgname='rapid_handover_append_only'`);
  const [row] = rows;
  check(rows.length === 1 && row.relrowsecurity === true && row.owner === 'fcos_coordinator_owner' && row.tgenabled === 'O'
    && row.definition === 'CREATE TRIGGER rapid_handover_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON fcos_release_coordination.rapid_handover_receipts FOR EACH STATEMENT EXECUTE FUNCTION fcos_release_coordination.reject_mutation()',
  'HANDOVER_RECOVERY_APPEND_ONLY_RECEIPT_REQUIRED');
}

/** Closure grants no stage, writer retirement, activation, or qualification authority. */
export async function closePreparedHandover({ input, github, vercel, openDatabase, runId, dispatcherSha }) {
  const binding = assertRecoveryTarget(input), { plan, planHash } = input;
  const [owner, repo, bot] = await Promise.all([
    github.read('/user'), github.read(base()), github.read('/users/github-actions%5Bbot%5D'),
  ]);
  check(owner.login === targets().account && positive(owner.id) && repo.full_name === targets().repository
    && positive(repo.id) && repo.owner?.id === owner.id && repo.owner.login === owner.login && repo.permissions?.admin === true
    && positive(bot.id) && bot.login === 'github-actions[bot]', 'HANDOVER_RECOVERY_GITHUB_IDENTITY_REQUIRED');
  const review = await verifyRecoveryReview({ input, binding, github, repo, runId, dispatcherSha });
  const originalBlob = await sourceBlob(github, handoverPath, plan.controllerSha);
  const [terminalProof, stage] = await Promise.all([
    verifyOriginalRun({ input, github, repo, runId: binding.terminalRunId, originalBlob }),
    verifyObservedStage({ input, github, vercel, actorIds: [owner.id, bot.id] }),
    assertLegacyIdle(github), assertProductionUnchanged({ plan, github, vercel }), assertNoFinalizedDeployment({ plan, planHash, github }),
  ]);
  const { db, connection } = await openDatabase();
  try {
    return await handoverTransaction(db, connection, false, async () => {
      await db.query("set local lock_timeout='5s'");
      await db.query("set local statement_timeout='30s'");
      const state = await readHandoverSnapshot(db, true);
      const own = state.receipts.filter(row => row.handover_id === plan.handoverId);
      const prepared = own.find(row => row.phase === 'prepared'), closed = own.find(row => row.phase === 'aborted');
      check(state.historyDigest === plan.historyDigest && !state.unresolvedProduction.length && same(state.control, plan.controlPreimage)
        && prepared && Number(prepared.receipt_id) === binding.preparedReceiptId && own.every(row => row.plan_hash === planHash)
        && !state.receipts.some(row => row.phase === 'finalized' || row.phase === 'prepared' && row.handover_id !== plan.handoverId
          && !state.receipts.some(other => other.handover_id === row.handover_id && other.phase === 'aborted'))
        && state.guard?.triggers === 2 && state.guard.digest === prepared.evidence.guardDigest,
      'HANDOVER_RECOVERY_PREPARED_STATE_CHANGED');
      const original = prepared.evidence;
      check(original.controllerSha === plan.controllerSha && original.candidateSha === plan.candidateSha
        && original.buildId === plan.buildId && original.artifactDigest === plan.artifactDigest
        && original.historyDigest === plan.historyDigest && original.supersedes === null && original.qualificationDigest === null
        && same(original.controlPreimage, plan.controlPreimage) && same(original.bootstrap, plan.bootstrap.reference)
        && original.review?.planHash === planHash && original.review.reviewerId === owner.id && original.review.reviewer === owner.login
        && original.review.state === 'approved' && original.review.environment === environmentName
        && original.review.workflowPath === handoverPath && original.review.workflowBlobSha === originalBlob
        && positive(original.review.runId) && positive(original.review.jobId),
      'HANDOVER_RECOVERY_ORIGINAL_RECEIPT_MISMATCH');
      const preparation = original.review.runId === terminalProof.run.id ? terminalProof : await verifyOriginalRun({
        input, github, repo, runId: original.review.runId, originalBlob,
      });
      const approvals = await github.read(`${base()}/actions/runs/${preparation.run.id}/approvals`);
      check(preparation.run.head_sha === original.review.dispatcherSha && preparation.job.id === original.review.jobId
        && Date.parse(terminalProof.run.updated_at) >= Date.parse(original.review.observedAt)
        && approvals.filter(row => row.state === 'approved' && row.user?.id === owner.id
          && row.environments?.some(item => item.id === original.review.environmentId && item.name === environmentName)
          && handoverDigest(row) === original.review.reviewDigest).length === 1, 'HANDOVER_RECOVERY_ORIGINAL_RECEIPT_MISMATCH');
      await assertAppendOnlyReceiptTable(db);
      await verifyLockedBootstrapSuccessor({ db, github, bootstrapPlan: plan.bootstrap.plan,
        controllerSha: plan.controllerSha, reference: plan.bootstrap.reference });
      await assertProductionUnchanged({ plan, github, vercel });
      const closure = { kind: 'fcos_protected_initial_handover_abort', binding, stage, originalReceiptDigest: handoverDigest(original),
        terminalJobId: terminalProof.job.id, terminalConclusion: terminalProof.run.conclusion, guardDigest: state.guard.digest,
        controlDigest: handoverDigest(state.control) };
      if (closed) {
        check(same(closed.evidence.closure, closure), 'HANDOVER_RECOVERY_ABORT_RECEIPT_CONFLICT');
        return { phase: 'aborted', planHash, receiptId: Number(closed.receipt_id), evidenceDigest: handoverDigest(closed.evidence), reused: true };
      }
      const evidence = { closure, review };
      const inserted = await db.query(`insert into fcos_release_coordination.rapid_handover_receipts(handover_id,phase,plan_hash,evidence)
        values($1,'aborted',$2,$3::jsonb) returning receipt_id,phase,plan_hash,evidence`, [plan.handoverId, planHash, JSON.stringify(evidence)]);
      const [readback] = inserted.rows;
      const postimage = (await db.query('select to_jsonb(c) as control from fcos_release_coordination.control c where singleton')).rows[0]?.control;
      check(inserted.rows.length === 1 && positive(Number(readback.receipt_id)) && readback.phase === 'aborted'
        && readback.plan_hash === planHash && same(readback.evidence, evidence) && same(postimage, state.control),
      'HANDOVER_RECOVERY_NATIVE_POSTIMAGE_FAILED');
      return { phase: 'aborted', planHash, receiptId: Number(readback.receipt_id), evidenceDigest: handoverDigest(evidence), reused: false };
    });
  } finally { await db.end(); }
}

function nativeGithub(token, fetchImpl = fetch) {
  check(typeof token === 'string' && token.length > 10, 'HANDOVER_RECOVERY_GITHUB_CREDENTIAL_REQUIRED');
  async function read(path) {
    check(path === '/user' || path === '/users/github-actions%5Bbot%5D' || path === base() || path.startsWith(`${base()}/`),
      'HANDOVER_RECOVERY_GITHUB_TARGET_MISMATCH');
    const response = await fetchImpl(`https://api.github.com${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (response.status === 404 && /\/actions\/(variables|workflows)\//.test(path)) return null;
    check(response.ok, 'HANDOVER_RECOVERY_GITHUB_READ_REFUSED');
    return response.json();
  }
  return { read, async pages(path, key) {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const url = new URL(`https://api.github.com${path}`);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const value = await read(url.pathname + url.search), rows = key ? value[key] : value;
      check(Array.isArray(rows) && rows.length <= 100, 'HANDOVER_RECOVERY_GITHUB_PAGE_INVALID');
      all.push(...rows);
      if (rows.length < 100) {
        check((!key || value.total_count === all.length) && new Set(all.map(row => row.id)).size === all.length,
          'HANDOVER_RECOVERY_GITHUB_PAGINATION_INCOMPLETE');
        return all;
      }
    }
    throw Error('HANDOVER_RECOVERY_GITHUB_PAGINATION_INCOMPLETE');
  } };
}

async function openNativeDatabase(env) {
  const caFile = env.FCOS_HANDOVER_DATABASE_CA;
  check(caFile && Boolean(env.FCOS_HANDOVER_DATABASE_URL) !== Boolean(env.FCOS_RAPID_SUPABASE_ACCESS_TOKEN),
    'HANDOVER_RECOVERY_PRIVATE_TLS_CONNECTION_REQUIRED');
  if (env.FCOS_RAPID_SUPABASE_ACCESS_TOKEN) {
    const credential = { kind: 'supabase_management', token: env.FCOS_RAPID_SUPABASE_ACCESS_TOKEN };
    const source = { sha: git(root, ['rev-parse', 'HEAD']) };
    const intentStore = await createDatabaseCredentialIntentStore({ credential, directory: root, source, purpose: 'rapid_handover_recovery' });
    return openPinnedDatabase({ credential, caFile, intentStore });
  }
  const url = new URL(env.FCOS_HANDOVER_DATABASE_URL);
  check(url.protocol === 'postgresql:' && !url.search && !url.hash, 'HANDOVER_RECOVERY_PRIVATE_TLS_CONNECTION_REQUIRED');
  const connection = { host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true, ca: readFileSync(caFile, 'utf8') } };
  assertHandoverConnection(connection);
  const { Client } = await import('pg'), db = new Client(connection);
  try { await db.connect(); return { db, connection }; }
  catch (error) { await db.end(); throw error; }
}

async function main(env) {
  const input = { plan: JSON.parse(env.PLAN_JSON), planHash: env.PLAN_HASH, recoverySha: env.RECOVERY_SHA,
    preparedReceiptId: Number(env.PREPARED_RECEIPT_ID), terminalRunId: Number(env.TERMINAL_RUN_ID),
    stageRecordId: Number(env.STAGE_RECORD_ID), stagedDeploymentId: env.STAGED_DEPLOYMENT_ID };
  assertRecoveryTarget(input);
  check(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === targets().repository
    && git(root, ['rev-parse', 'HEAD']) === input.recoverySha && !git(root, ['status', '--porcelain', '--untracked-files=no']),
  'HANDOVER_RECOVERY_FROZEN_CONTROLLER_REQUIRED');
  const github = nativeGithub(env.FCOS_RAPID_HANDOVER_GITHUB_TOKEN);
  const { project, currentProduction, rawDeployment } = vercelProvider({ env });
  return closePreparedHandover({ input, github, vercel: { project, currentProduction, rawDeployment }, openDatabase: () => openNativeDatabase(env),
    runId: Number(env.GITHUB_RUN_ID), dispatcherSha: env.GITHUB_SHA });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.env).then(result => {
  console.log(JSON.stringify(result));
}).catch(error => {
  console.error(/^[A-Z][A-Z0-9_]+$/.test(error.code || error.message) ? error.code || error.message : 'HANDOVER_RECOVERY_FAILED_CHECKPOINT_PRESERVED');
  process.exitCode = 1;
});

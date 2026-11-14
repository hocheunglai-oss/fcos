import assert from 'node:assert/strict';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { LOCAL_MIRROR_ENVIRONMENT } from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';
import { readTradingFxPostQatRecovery, TRADING_FX_POST_QAT_STOPPED } from '../scripts/lib/rapid-release/trading-fx-post-qat-recovery.mjs';

const sha = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const otherHash = 'd'.repeat(64);
const policy = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const owner = { id: policy.publication.requiredAccountId, login: targets().account };
const bot = { id: 41898282, login: 'github-actions[bot]' };
const workflow = '.github/workflows/fcos-rapid-release.yml';
const releaseJournal = 'fcos-release-journal-v1';
const base = `/repos/${targets().repository}`;
const permissionName = 'Fcos_Trading_FX_Data';
const runId = 42;
const time = offset => new Date(Date.parse('2026-11-14T05:00:00.000Z') + offset * 1000).toISOString();
const locator = 88;
const priorClosure = 44;
const databaseClosure = 45;
const qatJob = '0AfBh000006jrJFKAY';

function createRelease(successor, planPatch = {}, candidatePatch = {}) {
  const plan = { migrations: [], salesforceFingerprint: hash, salesforceSourceTreeHash: otherHash, mirrorPublication: 'local-collaborator',
    backwardCompatible: true, xeroQualificationDeploymentId: 25, xeroQualificationDigest: hash,
    ...(successor ? { tradingFxPostQatRecoveryReceiptId: locator } : { tradingFxQatRecoveryReceiptId: priorClosure }), ...planPatch };
  return createManifest({ candidate: { sha, sourceDigest: hash, lockDigest: hash, ...candidatePatch },
    controllerSha: (successor ? 'b' : 'c').repeat(40), releaseId: successor ? 'trading-fx-post-qat-successor' : 'trading-fx-stopped-post-qat',
    previous: { deploymentId: 'dpl_previous', sha: 'f'.repeat(40), configurationDigest: hash, schemaDigest: otherHash },
    paths: ['force-app/main/default/classes/Example.cls', 'supabase/migrations/20990101000000_fixture.sql'],
    publicEnvironment: { VITE_SUPABASE_URL: `https://${targets().supabaseProject}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(25)}` },
    prerequisites: { adapter: 'trading-fx-prerequisites', adapterDigest: successor ? otherHash : hash, plan }, now: time(0) });
}

function fixture({ closurePatch = {}, closureCreator = owner, runPatch = {}, jobFailure = 'failure', mirrorPatch = {}, requestPatch = {},
  order = 'valid', priorApprovalAt = time(5), putProductionIntent = false, nestedPatch = {}, stopBeforeDeploy = false } = {}) {
  const prior = createRelease(false);
  const manifestHash = digest(prior);
  const operationId = `${prior.releaseId}-prerequisites`;
  const request = { planDigest: digest(prior.prerequisites), candidateSha: sha };
  const records = [];
  const append = (event, data, creator = bot, id = records.length + 101) => {
    const content = { kind: 'fcos_rapid_release_event', schemaVersion: 1, manifestHash, releaseId: prior.releaseId,
      sequence: records.length, previousHash: records.at(-1)?.payload.recordHash || null, event, data };
    const row = { id, creator, sha, environment: releaseJournal, created_at: time(records.length + 10), payload: { ...content, recordHash: digest(content) } };
    records.push(row);
    return row;
  };
  const checkpoint = (stage, operation, outcome, details = {}) => append('salesforce.checkpoint', { stage, operation, outcome, fingerprint: hash, evidenceDigest: hash, ...details });
  append('release.prepared', { manifest: prior });
  const staged = { id: 'dpl_staged', sha, buildId: prior.build.buildId, manifestHash, artifactDigest: hash };
  append('stage.intent', { operationId: 'stage' });
  append('stage.result', { operationId: 'stage', outcome: 'applied', result: staged });
  append('approval.accepted', { runId, approvedAt: priorApprovalAt, manifestHash, candidateSha: sha, buildId: prior.build.buildId,
    nativeReviewVerified: true, deploymentId: staged.id, previousDeploymentId: prior.previous.deploymentId, environment: 'fcos-production-release', reviewer: owner.login });
  const intent = append('prerequisites.intent', { operationId, requestHash: digest(request), request });
  const resolvedJob = (stage, operation, id, validationId = null) => {
    const job = { id, validationId, submittedAt: time(records.length), ...(operation === 'deployment' ? {} : { packageSha256: hash }) };
    if (operation !== 'bootstrap') checkpoint(stage, operation, 'pending', { job });
    return checkpoint(stage, operation, 'resolved', { job });
  };
  const deveeBootstrap = resolvedJob('devee', 'bootstrap', '0AfHF000007Gb9F0AS');
  const qatBootstrap = resolvedJob('qat', 'bootstrap', '0AfBh000006jq5RKAQ');
  const permissions = policy.environments.filter(({ key }) => ['devee', 'qat'].includes(key)).map(({ key, orgId }) =>
    checkpoint(key, 'permission:' + permissionName, 'resolved', { permission: { name: permissionName, orgId, prestate: true } }));
  const deveeValidation = resolvedJob('devee', 'validation', '0AfHF000007Gev70AC');
  const deveeDeployment = resolvedJob('devee', 'deployment', '0AfHF000007Gezy0AC', deveeValidation.payload.data.job.id);
  const qatValidationJob = () => resolvedJob('qat', 'validation', '0AfBh000006jr6LKAQ');
  const earlyQatValidation = order === 'qat-first' ? qatValidationJob() : null;
  const mirrorIntent = checkpoint('shared_mirror', 'publication', 'pending');
  const mirrorCommit = 'e'.repeat(40);
  const mirror = checkpoint('shared_mirror', 'publication', 'resolved', { mirror: { commit: mirrorCommit, pullRequest: 9 }, ...mirrorPatch });
  const qatValidation = earlyQatValidation || qatValidationJob();
  const qatDeployment = stopBeforeDeploy ? null : resolvedJob('qat', 'deployment', qatJob, qatValidation.payload.data.job.id);
  if (putProductionIntent) checkpoint('production', 'bootstrap', 'pending');
  checkpoint('production', 'restoration-checkpoint', 'evidence');
  const closure = append('prerequisites.result', { operationId, outcome: TRADING_FX_POST_QAT_STOPPED, originalRunId: runId, originalIntent: intent.id,
    databaseClosure, previousRecoveryClosure: priorClosure, mirrorReceipt: 90, qatDeploymentJob: qatJob, evidenceDigest: hash, ...closurePatch }, closureCreator, locator);
  closure.created_at = time(99);
  const branch = 'codex/mirror-fixture';
  const proof = { releaseMode: 'reviewed-manifest-incremental-v1', sourceTreeHash: otherHash, sourceEnvironment: 'devee',
    sourceDeploymentJobId: deveeDeployment.payload.data.job.id, repository: policy.publication.repository, account: owner.login,
    branch, commit: mirrorCommit, pullRequest: { state: 'OPEN', isDraft: true, number: 9, baseRefName: policy.publication.defaultBranch,
      headRefName: branch, headRefOid: mirrorCommit } };
  const mirrorRequest = { id: 91, sha, environment: LOCAL_MIRROR_ENVIRONMENT, creator: bot, created_at: mirrorIntent.created_at,
    payload: { version: 1, kind: 'fcos_local_mirror_request', manifestHash, controllerSha: prior.controllerSha, candidateSha: sha,
      runId, runAttempt: 1, mode: 'publish', fingerprint: hash, sourceTreeHash: otherHash, deveeOrgId: policy.environments[0].orgId,
      deploymentJobId: deveeDeployment.payload.data.job.id, validationJobId: deveeValidation.payload.data.job.id,
      repository: policy.publication.repository, repositoryId: policy.publication.repositoryId, intentHash: hash, expiresAt: time(120), ...requestPatch } };
  const mirrorReceipt = { id: 90, sha, environment: LOCAL_MIRROR_ENVIRONMENT, creator: owner, created_at: mirror.created_at,
    payload: { kind: 'fcos_local_mirror_receipt', requestId: 91, requestHash: digest(mirrorRequest.payload), repositoryId: policy.publication.repositoryId,
      proof, proofDigest: digest(proof) } };
  const run = { id: runId, repository: { full_name: targets().repository }, event: 'workflow_dispatch', path: workflow, actor: owner,
    run_attempt: 1, display_title: `FCOS rapid resume ${manifestHash} ${sha}`, status: 'completed', conclusion: 'failure', head_sha: 'c'.repeat(40), ...runPatch };
  const nested = { receipt: { id: priorClosure, payload: { data: { databaseClosure } } }, prior: { candidate: { sha: '0'.repeat(40) } },
    database: { operationId: 'trading-fx-original-prerequisites', operationDigest: hash, baselineSchemaDigest: hash, schemaDigest: otherHash },
    bootstrap: [deveeBootstrap, qatBootstrap], permissions, ...nestedPatch };
  const calls = [];
  const github = {
    async read(path) {
      if (path === `${base}/actions/runs/${runId}`) return run;
      if (path === `${base}/actions/runs/${runId}/attempts/1/jobs?per_page=100`) return { jobs: [{ name: 'go-live', status: 'completed', conclusion: jobFailure, completed_at: time(50) }] };
      if (path === `${base}/contents/${workflow}?ref=${prior.controllerSha}`) return { type: 'file', sha };
      assert.ok(path.startsWith(`${base}/deployments/`));
      return [closure, mirrorRequest, mirrorReceipt].find(row => path.endsWith('/' + row.id));
    },
    async pages(path) { assert.match(path, /deployments\?environment=fcos-release-journal-v1/); return [...records].reverse(); },
    async write() { assert.fail('Recovery reader attempted a provider write'); },
  };
  return { prior, nested, github, jobs: [deveeBootstrap, deveeValidation, deveeDeployment, qatBootstrap, qatValidation, qatDeployment],
    mirror: { checkpoint: mirror, receipt: mirrorReceipt, request: mirrorRequest }, permissions, calls,
    readQatRecovery: async input => { calls.push(input); assert.equal(input, prior); return nested; } };
}

function recover(f, manifest = createRelease(true)) {
  return readTradingFxPostQatRecovery({ manifest, github: f.github, receiptId: locator, ownerId: owner.id, readQatRecovery: f.readQatRecovery });
}

test('post-QAT recovery retains exact completed jobs, mirror, permissions and the original database lineage', async () => {
  const f = fixture();
  const result = await recover(f);
  assert.equal(result.prior, f.prior);
  assert.equal(result.nested, f.nested);
  assert.equal(result.database, f.nested.database);
  assert.equal(result.receipt.id, locator);
  assert.deepEqual(result.jobs, f.jobs);
  assert.deepEqual(result.permissions, f.permissions);
  assert.deepEqual(result.mirror, f.mirror);
  assert.deepEqual(f.calls, [f.prior]);
});

test('post-QAT recovery refuses a fabricated closure, nonterminal attempt, uncertain downstream action or mismatched checkpoints', async () => {
  for (const [changes, code] of [
    [{ closureCreator: bot }, 'TRADING_FX_POST_QAT_CLOSURE_REQUIRED'],
    [{ closurePatch: { originalIntent: 99 } }, 'TRADING_FX_POST_QAT_ORIGINAL_OPERATION_REQUIRED'],
    [{ runPatch: { status: 'in_progress' } }, 'TRADING_FX_POST_QAT_TERMINAL_RUN_REQUIRED'],
    [{ jobFailure: 'success' }, 'TRADING_FX_POST_QAT_TERMINAL_RUN_REQUIRED'],
    [{ priorApprovalAt: '2026-11-10T00:00:00Z' }, 'EXACT_PRODUCTION_AUTHORIZATION_REQUIRED'],
    [{ putProductionIntent: true }, 'TRADING_FX_POST_QAT_ORIGINAL_OPERATION_REQUIRED'],
    [{ stopBeforeDeploy: true }, 'TRADING_FX_POST_QAT_CHECKPOINT_REQUIRED'],
    [{ order: 'qat-first' }, 'TRADING_FX_POST_QAT_CHECKPOINT_ORDER_CHANGED'],
    [{ closurePatch: { qatDeploymentJob: '0AfBh000006jr6LKAQ' } }, 'TRADING_FX_POST_QAT_CHECKPOINT_ORDER_CHANGED'],
    [{ requestPatch: { runId: 999 } }, 'TRADING_FX_POST_QAT_ORIGINAL_MIRROR_REQUIRED'],
    [{ mirrorPatch: { mirror: { commit: sha, pullRequest: 9 } } }, 'TRADING_FX_POST_QAT_ORIGINAL_MIRROR_REQUIRED'],
    [{ closurePatch: { databaseClosure: 99 } }, 'TRADING_FX_POST_QAT_ORIGINAL_DATABASE_OR_BOOTSTRAP_REQUIRED'],
    [{ nestedPatch: { bootstrap: [] } }, 'TRADING_FX_POST_QAT_ORIGINAL_DATABASE_OR_BOOTSTRAP_REQUIRED'],
  ]) await assert.rejects(recover(fixture(changes)), { code });
});

test('post-QAT recovery only admits the same application and exact Salesforce and qualification plan', async () => {
  for (const manifest of [createRelease(true, {}, { sourceDigest: otherHash }), createRelease(true, { salesforceSourceTreeHash: hash }),
    createRelease(true, { xeroQualificationDeploymentId: 26 })]) {
    const f = fixture();
    await assert.rejects(recover(f, manifest), { code: 'TRADING_FX_POST_QAT_MANIFEST_CHANGED' });
    assert.equal(f.calls.length, 0);
  }
  await assert.rejects(recover(fixture(), createRelease(true, { tradingFxQatRecoveryReceiptId: priorClosure })),
    { code: 'TRADING_FX_POST_QAT_RECOVERY_LOCATOR_INVALID' });
});

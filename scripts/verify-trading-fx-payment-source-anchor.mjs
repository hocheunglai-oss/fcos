import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { githubConfigDirectory } from './fcos-connections.mjs';
import { executeSharedMirror } from './sync-salesforce-shared-repository.mjs';
import { REVIEWED_SALESFORCE_MODE, assertReviewedMirror } from './lib/salesforce-reviewed-release.mjs';
import { assertAuthorization, digest, git, isDigest, isSha, requireCondition, targets, validateManifest } from './lib/rapid-release/contract.mjs';
import { assertBuildReceipt, assertPreBootstrapProof, assertSmokeProof } from './lib/rapid-release/engine.mjs';
import { DeploymentJournal, pendingOperations } from './lib/rapid-release/journal.mjs';
import { readLocalMirrorDeployments, verifyLocalMirrorReceipt } from './lib/rapid-release/local-mirror-handoff.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './lib/rapid-release/providers.mjs';
import { TRADING_FX_FINAL_POSTEFFECT_ORIGINAL } from './lib/rapid-release/trading-fx-final-posteffect-checkpoint.mjs';
import { readTradingFxPaymentSuccessor } from './lib/rapid-release/trading-fx-payment-successor.mjs';
import { paymentSalesSupportRepairPackage, verifyPaymentSalesSupportRepairSource } from './lib/rapid-release/trading-fx-payment-profile-repair.mjs';
import { verifyTradingFxSalesSupportSandboxJob } from './lib/rapid-release/trading-fx-sales-support-transport.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const base = '/repos/' + targets().repository;
const repoId = 1278654816, ownerId = policy.publication.requiredAccountId, botId = 41898282;
const workflow = '.github/workflows/fcos-rapid-release.yml';
const environmentName = 'fcos-production-release', environmentId = 23178773471;
const order = 'devee-mirror-qat-production';
const anchor = Object.freeze({
  ref: 'refs/heads/codex/trading-fx-payment-verified-baseline',
  sourceCommit: '6299e728d8b1c9f948f2f0cfdc3c11267dc21ac2',
  sourceTreeHash: '3bd5b6775389cb691d9f8b0e5cb63e06bd48ca6971979de758c83dbe0a864104',
  application: 'b495d1bde6d06834c32212982c4597e20e6c7fe0',
  manifestHash: '2c7de589952ffc156e5a2c7fba249b965d239787ce2c26e0661e20dbb1f4741f',
  releaseId: 'trading-fx-payment-successor-recovery-pr220',
  runId: 43773922006,
  deploymentId: 'dpl_Eo9LRn23pWYK8az6mqk6AGuPKRWk',
  artifactDigest: '738c4b7b2a3e810907d7626c7c1768743fa922f686bc2c2a30a0d9bb66a5ca7c',
  buildId: 'f28cfa350076b193b18d35d61cf7e9f8b48528d6145d7312108392a1b7600e2c',
  controllerSha: '93fde738377ee653bc2685291a2842cbc856eeb3',
  dispatcherSha: '18ed6e6528a4117181d9014e3e90fe02cb46ddb9',
  correctionFingerprint: 'd5ed200e60ad6cbc2e9cf5191677c9746cc000e34abe647089e4d9d2445e7455',
  closureId: 7811304124,
});
const check = (condition, code) => requireCondition(condition, 'TRADING_FX_SOURCE_ANCHOR_' + code);
const data = row => row.payload.data;
const seq = row => row.payload.sequence;
const time = row => Date.parse(row.created_at);
const owner = actor => actor?.id === ownerId && actor.login === targets().account;
const bot = actor => actor?.id === botId && actor.login === 'github-actions[bot]';
const stages = ['devee', 'shared_mirror', 'qat', 'production'];
const operationId = stage => `salesforce:${stage}:sales-support-correction`;
const same = (left, right) => digest(left ?? null) === digest(right ?? null);

export function assertTradingFxSourceAnchorManifest(manifest) {
  const hash = validateManifest(manifest), plan = manifest.prerequisites?.plan;
  check(hash === anchor.manifestHash && manifest.releaseId === anchor.releaseId && manifest.candidate.sha === anchor.application
    && manifest.controllerSha === anchor.controllerSha && manifest.build.buildId === anchor.buildId
    && plan?.paymentRepair?.sourceCommit === anchor.sourceCommit && plan.paymentRepair.sourceTreeHash === anchor.sourceTreeHash
    && plan.paymentRepair.correctionFingerprint === anchor.correctionFingerprint
    && plan.tradingFxFinalPosteffectClosureReceiptId === anchor.closureId, 'MANIFEST_MISMATCH');
  return plan;
}

export function verifyTradingFxSourceAnchorRun({ run, jobs, reviews, environment, expected = anchor }) {
  const matches = reviews.filter(review => review.state === 'approved' && owner(review.user)
    && review.environments?.some(item => item.id === environmentId && item.name === environmentName));
  const goLive = jobs.jobs?.filter(job => job.name === 'go-live') ?? [];
  check(run.id === expected.runId && run.run_attempt === 1 && run.repository?.id === repoId && run.repository?.full_name === targets().repository
    && owner(run.actor) && owner(run.triggering_actor) && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === workflow
    && run.head_branch === 'main' && run.head_sha === expected.dispatcherSha && run.status === 'completed' && run.conclusion === 'success'
    && run.display_title === `FCOS rapid resume ${expected.manifestHash} ${expected.application}`
    && environment.id === environmentId && environment.name === environmentName && environment.can_admins_bypass === false
    && environment.protection_rules?.some(rule => rule.type === 'required_reviewers' && rule.reviewers?.some(row => owner(row.reviewer)))
    && matches.length === 1 && goLive.length === 1 && goLive[0].run_id === run.id && goLive[0].run_attempt === 1
    && goLive[0].status === 'completed' && goLive[0].conclusion === 'success'
    && Date.parse(goLive[0].started_at) <= Date.parse(goLive[0].completed_at), 'NATIVE_RUN_MISMATCH');
  return goLive[0];
}

// Source-publication subset of verify-payment-successor-trading-fx-live-completion.mjs.
// It trusts append-only native checkpoints and their original provider operation locators.
export function verifyTradingFxSourceAnchorJournal({ records, mirrorRecords, manifest, historical, run, goLive, expected = anchor }) {
  const { plan } = manifest.prerequisites, repair = plan.paymentRepair;
  const event = name => {
    const matches = records.filter(row => row.payload.event === name);
    check(matches.length === 1, 'JOURNAL_EVENT_MISMATCH');
    return matches[0];
  };
  check(records.every(row => bot(row.creator) && row.sha === expected.application && row.ref === row.sha
    && row.task === 'fcos-release-journal' && row.environment === 'fcos-release-journal-v1' && Number.isFinite(time(row))
    && !row.payload.event.startsWith('rollback.') && row.payload.event !== 'prerequisites.database_submitting')
    && pendingOperations(records).length === 0, 'JOURNAL_SCOPE_MISMATCH');
  const prepared = event('release.prepared'), build = event('build.passed'), stage = event('stage.result'), approval = event('approval.accepted');
  const prerequisiteResult = event('prerequisites.result'), prerequisites = event('prerequisites.passed'), smoke = event('prerequisites.smoke_passed');
  const prerequisiteIntent = event('prerequisites.intent');
  const intent = event('promote.intent'), promotion = event('promote.result'), observation = event('live.passed'), completion = event('release.complete');
  const staged = data(stage).result, applied = data(prerequisites), live = data(observation);
  assertBuildReceipt(data(build), manifest);
  assertPreBootstrapProof(data(event('stage.pre_bootstrap_passed')), manifest, staged);
  assertSmokeProof(data(smoke), manifest, staged);
  assertAuthorization(data(approval), manifest, staged, time(intent));
  const predecessor = historical.closed.result;
  const originalOperations = predecessor.completedOperations.filter(row => !stages.some(key => row.operationId === operationId(key)));
  const prerequisite = { planDigest: digest(manifest.prerequisites), candidateSha: expected.application };
  const promote = { deploymentId: staged.id, previousDeploymentId: manifest.previous.deploymentId, buildId: expected.buildId };
  check(historical.closed.closure.id === expected.closureId && predecessor.originalRunId === TRADING_FX_FINAL_POSTEFFECT_ORIGINAL.runId
    && predecessor.state === 'trading_fx_final_package_applied_payment_grant_pending'
    && same(data(prepared).manifest, manifest) && data(stage).outcome === 'applied'
    && staged.id === expected.deploymentId && staged.buildId === expected.buildId
    && staged.sha === expected.application && staged.artifactDigest === expected.artifactDigest && data(build).artifactDigest === expected.artifactDigest
    && data(approval).runId === expected.runId && data(approval).approvedAt === run.created_at
    && Date.parse(goLive.started_at) <= time(approval) && time(completion) <= Date.parse(goLive.completed_at)
    && applied.passed === true && applied.backwardCompatible === true && applied.manifestHash === expected.manifestHash
    && data(prerequisiteIntent).operationId === manifest.releaseId + '-prerequisites'
    && same(data(prerequisiteIntent).request, prerequisite) && data(prerequisiteIntent).requestHash === digest(prerequisite)
    && data(prerequisiteResult).operationId === data(prerequisiteIntent).operationId
    && data(prerequisiteResult).outcome === 'applied' && same(data(prerequisiteResult).result, applied)
    && same(applied.salesforce, { order, mirrorVerified: true, sourceTreeHash: plan.salesforceSourceTreeHash,
      correction: { fingerprint: expected.correctionFingerprint, sourceTreeHash: expected.sourceTreeHash, order } })
    && same(applied.completedOperations.slice(0, 1 + originalOperations.length), [predecessor.evidence.databaseOperation, ...originalOperations])
    && data(smoke).prerequisiteDigest === digest(applied) && data(smoke).modules.includes('buyer_invoices')
    && data(intent).operationId === manifest.releaseId + '-promote' && same(data(intent).request, promote) && data(intent).requestHash === digest(promote)
    && data(promotion).operationId === data(intent).operationId && data(promotion).outcome === 'applied'
    && data(promotion).result.id === staged.id && data(promotion).result.buildId === expected.buildId
    && live.passed === true && live.deploymentId === staged.id && live.buildId === expected.buildId
    && live.observationMs >= 300_000 && live.businessWrites === 0 && live.signing?.verified === true
    && live.signing.deploymentId === staged.id && live.signing.buildId === expected.buildId
    && live.signing.orgId === fcosSalesforceEnvironment('production').orgId && live.signing.businessWrites === 0
    && live.signing.rateEnvelopeDigest === data(smoke).signingRateDigest && data(completion).deploymentId === staged.id
    && [prepared, build, stage, approval, prerequisiteIntent, prerequisiteResult, prerequisites, smoke, intent, promotion, observation, completion]
      .every((row, index, rows) => index === 0 || seq(rows[index - 1]) < seq(row)),
  'RELEASE_EVIDENCE_MISMATCH');

  const checkpoints = records.filter(row => row.payload.event === 'salesforce.checkpoint');
  const resolved = checkpoints.filter(row => data(row).outcome === 'resolved');
  check(checkpoints.every(row => data(row).fingerprint === expected.correctionFingerprint)
    && resolved.length === stages.length && applied.completedOperations.length === originalOperations.length + 1 + stages.length,
  'CORRECTION_HISTORY_MISMATCH');
  const { profileDigest, manifestDigest } = paymentSalesSupportRepairPackage();
  const packageDigest = digest({ profileDigest, manifestDigest });
  const correction = stages.map((key, index) => {
    const row = resolved[index], checkpoint = data(row);
    check(checkpoint.stage === key && checkpoint.operation === (key === 'shared_mirror' ? 'publication' : 'sales-support-correction')
      && seq(prerequisiteIntent) < seq(row) && seq(row) < seq(prerequisiteResult) && isDigest(checkpoint.evidenceDigest)
      && same(applied.completedOperations[originalOperations.length + 1 + index],
        { operationId: operationId(key), evidenceDigest: checkpoint.evidenceDigest, verified: true, intentRecorded: true }),
    'CORRECTION_HISTORY_MISMATCH');
    if (key !== 'shared_mirror') check(checkpoint.job?.validationId === null && checkpoint.job.packageSha256 === packageDigest
      && /^0Af[A-Za-z0-9]{15}$/u.test(checkpoint.job.id) && time(approval) <= Date.parse(checkpoint.job.submittedAt)
      && Date.parse(checkpoint.job.submittedAt) <= time(row), 'CORRECTION_JOB_MISMATCH');
    return row;
  });
  const [devee, publication, qat, production] = correction, mirror = data(publication).mirror, job = data(devee).job;
  const mirrorIntent = checkpoints.filter(row => data(row).stage === 'shared_mirror' && data(row).operation === 'publication'
    && data(row).outcome === 'pending' && seq(devee) < seq(row) && seq(row) < seq(publication)).at(-1);
  check(isSha(mirror?.commit) && mirror.pullRequest === 9 && mirror.commit !== TRADING_FX_FINAL_POSTEFFECT_ORIGINAL.correctionMirrorCommit
    && mirrorIntent && isDigest(data(mirrorIntent).evidenceDigest)
    && new Set([devee, qat, production].map(row => data(row).job.id)).size === 3, 'MIRROR_OR_JOB_REUSED');
  const requests = mirrorRecords.filter(row => bot(row.creator) && row.payload?.kind === 'fcos_local_mirror_request'
    && row.payload.manifestHash === expected.manifestHash && row.payload.runId === expected.runId);
  const reviewed = { fingerprint: expected.correctionFingerprint, binding: { sourceTreeHash: expected.sourceTreeHash } };
  const mirrors = [['publish', devee, publication], ['check', qat, production], ['check', production, prerequisites]].map(([mode, min, max]) => {
    const modes = mode === 'publish' ? ['publish', 'recover'] : ['check'];
    const matches = requests.filter(row => modes.includes(row.payload.mode) && time(row) >= time(min) && time(row) <= time(max));
    const receipts = mirrorRecords.filter(row => owner(row.creator) && row.payload?.kind === 'fcos_local_mirror_receipt'
      && matches.some(request => request.id === row.payload.requestId) && time(row) <= time(max));
    check(receipts.length === 1, 'MIRROR_RECEIPT_MISMATCH');
    const receipt = receipts[0], request = matches.find(row => row.id === receipt.payload.requestId), binding = request.payload;
    check(binding.runAttempt === 1 && binding.controllerSha === expected.controllerSha && binding.candidateSha === expected.application
      && binding.correctionSourceSha === expected.sourceCommit && binding.deveeOrgId === fcosSalesforceEnvironment('devee').orgId
      && binding.deploymentJobId === job.id && binding.validationJobId === null
      && binding.intentHash === data(mode === 'publish' ? mirrorIntent : publication).evidenceDigest, 'MIRROR_REQUEST_MISMATCH');
    const proof = verifyLocalMirrorReceipt({ request: binding, requestDeployment: request, receiptDeployment: receipt, reviewed,
      workflowActorId: botId, publisherId: ownerId, now: time(receipt) });
    check(proof.commit === mirror.commit && proof.pullRequest.number === mirror.pullRequest, 'MIRROR_HEAD_MISMATCH');
    return receipt.id;
  });
  check(new Set(mirrors).size === 3 && repair.correctionFingerprint === expected.correctionFingerprint, 'MIRROR_RECEIPT_MISMATCH');
  return { mirror, job, mirrorReceipts: mirrors, lastRecordHash: completion.payload.recordHash };
}

function operatorGitHub(candidateSha) {
  const env = { ...process.env, GH_CONFIG_DIR: githubConfigDirectory({ repoRoot: root }), GH_HOST: 'github.com',
    GH_REPO: 'github.com/' + targets().repository, GH_PROMPT_DISABLED: '1' };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[name];
  const api = args => JSON.parse(execFileSync('gh', ['api', ...args], { env, encoding: 'utf8', timeout: 30000,
    maxBuffer: 24 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  return { candidateSha, read: path => api([path]), pages: path => api(['--paginate', '--slurp', path]).flat() };
}

async function readCurrentVersion() {
  const response = await fetch(targets().origin + '/app-version.json', { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  check(response.ok, 'LIVE_READBACK_FAILED');
  const version = await response.json();
  check(version.commit === anchor.application && version.buildId === anchor.buildId, 'LIVE_BUILD_CHANGED');
}

async function main() {
  const [candidate, sha, manifestFile, ...extra] = process.argv.slice(2);
  check(candidate && sha === anchor.sourceCommit && manifestFile && !extra.length, 'USAGE_CANDIDATE_SHA_MANIFEST');
  const cwd = resolve(candidate);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')), plan = assertTradingFxSourceAnchorManifest(manifest);
  const verifySource = () => {
    verifyPaymentSalesSupportRepairSource({ cwd, repair: plan.paymentRepair });
    check(git(cwd, ['merge-base', anchor.application, anchor.sourceCommit]) === anchor.application
      && JSON.parse(git(cwd, ['show', anchor.sourceCommit + ':vercel.json'])).git?.deploymentEnabled === false, 'SOURCE_SCOPE_CHANGED');
  };
  verifySource();
  const github = operatorGitHub(anchor.application);
  const [account, repo] = await Promise.all([github.read('/user'), github.read(base)]);
  check(owner(account) && repo.id === repoId && repo.full_name === targets().repository && owner(repo.owner)
    && repo.permissions?.push === true && repo.default_branch === 'main' && !repo.archived, 'IDENTITY_MISMATCH');
  const runPath = base + '/actions/runs/' + anchor.runId;
  const run = await github.read(runPath + '/attempts/1');
  check(run.id === anchor.runId && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'success', 'NATIVE_RUN_MISMATCH');
  const journal = new DeploymentJournal({ github, actorIds: [botId], releaseId: anchor.releaseId, manifestHash: anchor.manifestHash });
  const [jobs, reviews, environment, records, mirrors, historical] = await Promise.all([
    github.read(runPath + '/attempts/1/jobs?per_page=100'),
    github.read(runPath + '/approvals'), github.read(base + '/environments/' + environmentName),
    journal.read(), readLocalMirrorDeployments(github, anchor.application), readTradingFxPaymentSuccessor({ manifest, github }),
    assertFrozenWorkflow({ github, controllerSha: anchor.controllerSha, dispatcherSha: anchor.dispatcherSha }),
  ]);
  const goLive = verifyTradingFxSourceAnchorRun({ run, jobs, reviews, environment });
  const { mirror, job, mirrorReceipts, lastRecordHash } =
    verifyTradingFxSourceAnchorJournal({ records, mirrorRecords: mirrors, manifest, historical, run, goLive });
  await readCurrentVersion();
  const native = verifyTradingFxSalesSupportSandboxJob({ stage: 'devee', cwd, commandEnvironment: process.env,
    job, repair: plan.salesSupportRepair, paymentRepair: plan.paymentRepair });
  check(native.orgId === fcosSalesforceEnvironment('devee').orgId && native.jobId === job.id
    && native.packageSha256 === job.packageSha256 && native.proof?.verified === true, 'DEVEE_READBACK_MISMATCH');
  const report = executeSharedMirror({ mode: 'check', metadataRoot: join(cwd, policy.publication.sourceRoot), expectedHead: mirror,
    proofResolver(inventory) {
      verifySource();
      check(inventory.sourceTreeHash === anchor.sourceTreeHash, 'MIRROR_TREE_CHANGED');
      return { releaseMode: REVIEWED_SALESFORCE_MODE, deploymentJobId: job.id };
    } });
  assertReviewedMirror(report, { binding: { sourceTreeHash: anchor.sourceTreeHash } }, policy, job.id);
  check(report.commit === mirror.commit && report.pullRequest.number === mirror.pullRequest, 'MIRROR_HEAD_MISMATCH');
  await readCurrentVersion();
  verifySource();
  process.stdout.write(JSON.stringify({ ref: anchor.ref, sourceCommit: anchor.sourceCommit, sourceTreeHash: anchor.sourceTreeHash,
    runId: anchor.runId, liveApp: anchor.application, buildId: anchor.buildId, mirror, mirrorReceipts, lastRecordHash }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write((/^[A-Z][A-Z0-9_]+$/u.test(error.message) ? error.message : 'TRADING_FX_SOURCE_ANCHOR_VERIFICATION_FAILED') + '\n');
  process.exitCode = 1;
});

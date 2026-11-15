import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { verifyReviewedOrgInventory } from './lib/salesforce-reviewed-release.mjs';
import { assertNativeHandoverState, nativeCompatibilityReader } from './lib/rapid-release/compatibility.mjs';
import { digest, git, requireCondition as check, targets } from './lib/rapid-release/contract.mjs';
import { DeploymentJournal } from './lib/rapid-release/journal.mjs';
import { assertPermanentHandover, githubClient, nativeWorkflowPath, vercelProvider } from './lib/rapid-release/providers.mjs';
import { authenticateHostedSalesforce } from './lib/rapid-release/salesforce-hosted-auth.mjs';
import { verifyTradingFxSalesSupportReadGrants } from './lib/rapid-release/trading-fx-sales-support-transport.mjs';
import {
  TRADING_FX_NO_EFFECT_ORIGINAL as original,
  assertTradingFxNoEffectPreviousAttempt,
  buildTradingFxSalesSupportNoEffectPrerequisiteResult,
  buildTradingFxSalesSupportNoEffectProfileResult,
  readTradingFxSalesSupportNoEffectClosureState,
  verifyTradingFxSalesSupportNoEffectReadback,
} from './lib/rapid-release/trading-fx-sales-support-no-effect-checkpoint.mjs';

const workflow = '.github/workflows/fcos-rapid-trading-fx-sales-support-no-effect-closure.yml';
const title = `Close FCOS Trading FX ineffective profile correction ${original.runId}`;
const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const ownerId = policy.publication.requiredAccountId;
const actorIds = [ownerId, 41898282];
const repositoryId = 1278654816;
const repoPath = '/repos/' + targets().repository;
const approvalEnvironment = 'fcos-production-release';

async function authenticateRecoveryRun(env) {
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted'
    && env.GITHUB_REPOSITORY === targets().repository && /^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID || ''),
  'TRADING_FX_NO_EFFECT_TRUSTED_RUNNER_REQUIRED');
  const github = githubClient({ token: env.FCOS_RAPID_CLOSURE_GITHUB_TOKEN, candidateSha: original.candidateSha, actions: false });
  const { user, repo } = await github.identity();
  check(user.id === ownerId && user.login === targets().account && repo.id === repositoryId && repo.permissions.admin
    && repo.default_branch === 'main', 'TRADING_FX_NO_EFFECT_OWNER_REQUIRED');
  const runPath = repoPath + '/actions/runs/' + env.GITHUB_RUN_ID;
  const [native, branch, pointer, enabled, history, protection, reviews] = await Promise.all([
    github.read(runPath),
    github.read(repoPath + '/branches/' + repo.default_branch),
    github.read(repoPath + '/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID'),
    github.read(repoPath + '/actions/variables/FCOS_RAPID_RELEASE_ENABLED'),
    github.read(repoPath + '/actions/workflows/' + workflow.split('/').at(-1) + '/runs?event=workflow_dispatch&per_page=100'),
    github.read(repoPath + '/environments/' + approvalEnvironment),
    github.read(runPath + '/approvals'),
  ]);
  check(native.status === 'in_progress' && nativeWorkflowPath(native) === workflow && native.display_title === title
    && native.actor?.id === ownerId && native.triggering_actor?.id === ownerId && native.event === 'workflow_dispatch'
    && native.repository?.id === repo.id && native.head_branch === repo.default_branch && native.head_sha === env.GITHUB_SHA
    && branch.protected === true && branch.commit.sha === env.GITHUB_SHA && git(process.cwd(), ['rev-parse', 'HEAD']) === env.GITHUB_SHA
    && String(native.run_attempt) === env.GITHUB_RUN_ATTEMPT && pointer.value === String(original.handoverId)
    && enabled.value === 'true' && history.total_count === 1 && history.workflow_runs?.[0]?.id === native.id,
  'TRADING_FX_NO_EFFECT_EXECUTION_IDENTITY_MISMATCH');
  const rule = protection.protection_rules?.find(item => item.type === 'required_reviewers');
  const owner = person => person?.id === ownerId && person.login === targets().account;
  check(protection.id === 23178773471 && protection.name === approvalEnvironment && protection.can_admins_bypass === false
    && rule?.reviewers?.some(item => owner(item.reviewer))
    && Array.isArray(reviews) && reviews.some(review => review.state === 'approved' && owner(review.user)
      && review.environments?.some(item => item.id === protection.id && item.name === protection.name)),
  'TRADING_FX_NO_EFFECT_NATIVE_APPROVAL_REQUIRED');
  return { github, native };
}

async function checkPreviousAttempts({ github, native, profileReceipt }) {
  for (let attempt = 1; attempt < native.run_attempt; attempt++) {
    const previous = await github.read(repoPath + '/actions/runs/' + native.id + '/attempts/' + attempt + '/jobs?per_page=100');
    assertTradingFxNoEffectPreviousAttempt({ previous, runId: native.id, runAttempt: attempt, profileReceipt });
  }
}

async function verifyProduction({ github, checkpoint, env }) {
  const manifest = checkpoint.prior;
  const cwd = join(process.cwd(), 'original-application');
  check(git(cwd, ['rev-parse', 'HEAD']) === original.candidateSha && !git(cwd, ['status', '--porcelain']),
    'TRADING_FX_NO_EFFECT_APPLICATION_SOURCE_CHANGED');
  const handoverRecord = await github.read(repoPath + '/deployments/' + original.handoverId);
  check(handoverRecord.id === original.handoverId, 'TRADING_FX_NO_EFFECT_HANDOVER_CHANGED');
  const handover = assertPermanentHandover(handoverRecord, manifest, ownerId);
  const directory = mkdtempSync(join(tmpdir(), 'fcos-trading-fx-no-effect-'));
  let report, catalog, inventory;
  try {
    const commandEnvironment = authenticateHostedSalesforce({ directory, cwd, env: { ...env, HOME: directory },
      onlyProductionForSigningRead: true, requireMirrorCredential: false });
    const production = fcosSalesforceEnvironment('production');
    const input = manifest.prerequisites.plan;
    const plan = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: input.salesforceManifestPath, reviewPath: input.salesforceReviewPath });
    check(plan.fingerprint === input.salesforceFingerprint && plan.binding.sourceTreeHash === input.salesforceSourceTreeHash,
      'TRADING_FX_NO_EFFECT_SALESFORCE_SCOPE_CHANGED');
    const provider = cliSalesforceProvider({ cwd, policy, commandEnvironment });
    provider.verifyIdentity(production);
    report = await provider.report(production, checkpoint.productionCorrection.job.id);
    inventory = await verifyReviewedOrgInventory({ provider, environment: production, plan,
      expected: plan.nativeInventories.production.bootstrap, profileRecovery: 'before-correction' });
    catalog = verifyTradingFxSalesSupportReadGrants({ cwd, commandEnvironment, read: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const provider = vercelProvider({ manifest, env });
  const [observed] = await Promise.all([
    nativeCompatibilityReader({ provider, env })({ manifest }),
    assertNativeHandoverState({ handover, env }),
  ]);
  const baseline = { sha: observed.sha, deploymentId: observed.currentDeploymentId,
    configurationDigest: observed.configurationDigest, schemaDigest: observed.schemaDigest };
  return verifyTradingFxSalesSupportNoEffectReadback({ checkpoint, baseline, report, catalog, inventory, observedAt: new Date().toISOString() });
}

function requirePreflight({ stampPath, stamp, checkpoint, profileReceipt, phase }) {
  const { evidence, ...record } = JSON.parse(readFileSync(stampPath, 'utf8'));
  // A verified first receipt may already have been present at preflight, or
  // may have been appended by the immediately preceding step of this attempt.
  const fromThisAttempt = record.preflightProfileId === undefined && phase === 'append-prerequisites' && profileReceipt
    && digest(profileReceipt.payload.data) === digest(buildTradingFxSalesSupportNoEffectProfileResult({ checkpoint, evidence }));
  check(digest(record) === digest({ ...stamp, preflightProfileId: record.preflightProfileId })
    && (record.preflightProfileId === profileReceipt?.id || fromThisAttempt)
    && Date.parse(evidence.observedAt) <= Date.now() && Date.now() - Date.parse(evidence.observedAt) < 180000,
  'TRADING_FX_NO_EFFECT_PREFLIGHT_REQUIRED');
  return evidence;
}

async function appendOnce({ github, checkpoint, event, result, expectedPreviousHash, readback }) {
  const journal = new DeploymentJournal({ github, releaseId: checkpoint.prior.releaseId,
    manifestHash: checkpoint.manifestHash, actorIds });
  try { await journal.append(event, result, { expectedPreviousHash }); }
  catch { /* Read the original append below, including after a lost acknowledgement. */ }
  const receipt = readback(await readTradingFxSalesSupportNoEffectClosureState({ github }));
  check(receipt?.payload.previousHash === expectedPreviousHash && digest(receipt.payload.data) === digest(result),
    'TRADING_FX_NO_EFFECT_ACKNOWLEDGEMENT_UNCERTAIN');
  return receipt;
}

async function main(env) {
  const { github, native } = await authenticateRecoveryRun(env);
  const phase = env.FCOS_CLOSURE_PHASE;
  check(['preflight', 'append-profile', 'append-prerequisites'].includes(phase), 'TRADING_FX_NO_EFFECT_PHASE_REQUIRED');
  const { checkpoint, profileReceipt, receipt } = await readTradingFxSalesSupportNoEffectClosureState({ github });
  const summary = { originalRunId: checkpoint.runId, originalJob: checkpoint.productionCorrection.job.id, providerBusinessWrites: 0 };
  if (receipt) return { ...summary, profileReceiptId: profileReceipt.id, receiptId: receipt.id };
  const stampPath = join(env.RUNNER_TEMP, `fcos-trading-fx-no-effect-${native.id}-${native.run_attempt}.json`);
  const stamp = { nativeRunId: native.id, nativeAttempt: native.run_attempt, source: env.GITHUB_SHA,
    manifestHash: checkpoint.manifestHash, journalHead: checkpoint.lastRecordHash };
  if (phase === 'preflight') {
    await checkPreviousAttempts({ github, native, profileReceipt });
    const evidence = await verifyProduction({ github, checkpoint, env });
    writeFileSync(stampPath, JSON.stringify({ ...stamp, preflightProfileId: profileReceipt?.id, evidence }), { flag: 'wx', mode: 0o600 });
    return { ...summary, preflightVerified: true };
  }
  const evidence = requirePreflight({ stampPath, stamp, checkpoint, profileReceipt, phase });
  if (phase === 'append-profile') {
    if (profileReceipt) return { ...summary, profileReceiptId: profileReceipt.id };
    const result = buildTradingFxSalesSupportNoEffectProfileResult({ checkpoint, evidence });
    const saved = await appendOnce({ github, checkpoint, event: 'salesforce.checkpoint', result,
      expectedPreviousHash: checkpoint.lastRecordHash, readback: state => state.profileReceipt });
    return { ...summary, profileReceiptId: saved.id };
  }
  check(profileReceipt, 'TRADING_FX_NO_EFFECT_PROFILE_RECEIPT_REQUIRED');
  const result = buildTradingFxSalesSupportNoEffectPrerequisiteResult({ checkpoint, profileReceipt });
  const saved = await appendOnce({ github, checkpoint, event: 'prerequisites.result', result,
    expectedPreviousHash: profileReceipt.payload.recordHash, readback: state => state.receipt });
  return { ...summary, profileReceiptId: profileReceipt.id, receiptId: saved.id };
}

main(process.env).then(result => console.log(JSON.stringify(result))).catch(error => {
  const code = error?.code || error?.message;
  console.error(/^(?:TRADING_FX|JOURNAL|GITHUB|SALESFORCE)_[A-Z_]+$/u.test(code) ? code : 'TRADING_FX_NO_EFFECT_READBACK_FAILED');
  process.exitCode = 1;
});

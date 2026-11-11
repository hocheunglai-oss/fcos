import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { assertReviewedInputsUnchanged, cliSalesforceProvider, loadReviewedSalesforcePlan } from '../../deploy-salesforce-reviewed-manifest.mjs';
import { runReviewedMirror } from '../../sync-salesforce-reviewed-repository.mjs';
import { preflightSharedMirrorPublication } from '../../sync-salesforce-shared-repository.mjs';
import { openSalesforcePromotionJournal } from '../salesforce-promotion-journal.mjs';
import { assertReviewedJobReport, matchesSalesforceCheckpoint, reviewedJobExpectations, runReviewedSalesforceRelease, safeProjectFile } from '../salesforce-reviewed-release.mjs';
import { authenticateHostedSalesforce } from './salesforce-hosted-auth.mjs';
import { digest, git, requireCondition, targets } from './contract.mjs';
import { runPreBootstrapSmoke } from './smoke.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce');

export async function reconcileHostedSalesforceJob({ environment, jobId, reviewed, operation, submittedAt, validationJobId, packageSha256,
  provider, journal, now = () => new Date() }) {
  const target = policy.environments.find(item => item.key === environment.key);
  const reviewedBootstrap = operation === 'bootstrap' && validationJobId === null && reviewed.review?.bootstrap?.components?.length > 0
    && /^[a-f0-9]{64}$/u.test(reviewed.binding.bootstrapSha256 || '');
  requireCondition(target?.orgId === environment.orgId && (['validation', 'deployment'].includes(operation) || reviewedBootstrap),
    'SALESFORCE_HOSTED_RECOVERY_SCOPE_INVALID');
  const entries = await journal.readCheckpoints();
  const original = entries.find(item => item.fingerprint === reviewed.fingerprint && item.stage === target.key
    && item.operation === operation && ['pending', 'resolved'].includes(item.outcome)
    && item.job?.id === jobId && item.job.validationId === validationJobId && item.job.submittedAt === submittedAt
    && item.job.packageSha256 === packageSha256);
  requireCondition(original && /^[a-f0-9]{64}$/u.test(original.evidenceDigest || ''),
    'SALESFORCE_HOSTED_ORIGINAL_JOB_REQUIRED');
  await provider.verifyIdentity(target);
  const report = await provider.report(target, jobId);
  let quickValidation;
  if (operation === 'deployment' && Number(report.numberTestsTotal) === 0) {
    requireCondition(entries.some(item => item.fingerprint === reviewed.fingerprint && item.stage === target.key
      && item.operation === 'validation' && item.outcome === 'resolved' && item.job?.id === validationJobId
      && /^[a-f0-9]{64}$/u.test(item.evidenceDigest || '')), 'SALESFORCE_HOSTED_ORIGINAL_VALIDATION_REQUIRED');
    quickValidation = { id: validationJobId, report: await provider.report(target, validationJobId) };
  }
  const proof = assertReviewedJobReport(report, { environment: target, jobId,
    ...reviewedJobExpectations(reviewed, target, operation), quickValidation });
  const verifiedAt = now();
  const completed = Date.parse(proof.completedAt);
  requireCondition(completed >= Date.parse(submittedAt) - 30_000 && completed <= verifiedAt.getTime() + 30_000,
    'SALESFORCE_HOSTED_ORIGINAL_JOB_TIMING_INVALID');
  return { fingerprint: reviewed.fingerprint, orgId: target.orgId, jobId, operation,
    sourceTreeHash: reviewed.binding.sourceTreeHash, manifestSha256: reviewed.binding.manifestSha256,
    evidenceSha256: digest({ original, reportSha256: proof.reportSha256 }), verifiedAt: verifiedAt.toISOString() };
}

function hostedReviewedPlan(cwd, plan) {
  const project = JSON.parse(readFileSync(safeProjectFile(cwd, 'sfdx-project.json'), 'utf8'));
  requireCondition(project.namespace === '' && project.packageDirectories?.length === 1
    && project.packageDirectories[0].path === 'force-app' && project.packageDirectories[0].default === true,
  'SALESFORCE_HOSTED_PROJECT_SCOPE_INVALID');
  const reviewed = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: plan.salesforceManifestPath, reviewPath: plan.salesforceReviewPath });
  requireCondition(reviewed.fingerprint === plan.salesforceFingerprint
    && reviewed.binding.sourceTreeHash === plan.salesforceSourceTreeHash, 'SALESFORCE_HOSTED_PLAN_MISMATCH');
  const inputs = [reviewed.reviewAbsolute, reviewed.manifestAbsolute, reviewed.baselineWorkflowAbsolute, reviewed.bootstrapAbsolute]
    .filter(Boolean).map(file => relative(cwd, file));
  git(cwd, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', 'sfdx-project.json', ...inputs]);
  return reviewed;
}

function reviewedBootstrapFingerprint(reviewed, plan) {
  requireCondition(plan.deferSchemaDependentSmoke === true && reviewed.review.bootstrap
    && /^[a-f0-9]{64}$/u.test(reviewed.binding.bootstrapSha256 || ''),
    'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED');
  const fingerprint = digest({ salesforceFingerprint: reviewed.fingerprint, bootstrapSha256: reviewed.binding.bootstrapSha256 });
  requireCondition(fingerprint === plan.bootstrapFingerprint, 'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_MISMATCH');
  return fingerprint;
}

export async function verifyPreBootstrapStage({ manifest, staged, plan, salesforceCandidateDirectory: cwd, env }) {
  requireCondition(manifest.selection.salesforce && !manifest.selection.database && cwd && plan.backwardCompatible === true,
    'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED');
  const reviewed = hostedReviewedPlan(cwd, plan);
  return runPreBootstrapSmoke({ manifest, staged, env }, reviewedBootstrapFingerprint(reviewed, plan));
}

export async function applyReviewedPrerequisites({ manifest, approval, plan, salesforce, salesforceCandidateDirectory: cwd, env = process.env }) {
  const manifestHash = digest(manifest);
  requireCondition(manifest.selection.salesforce && !manifest.selection.database && plan.backwardCompatible === true
    && cwd && typeof salesforce?.journal?.readCheckpoints === 'function'
    && typeof salesforce?.ownership?.assert === 'function' && approval?.manifestHash === manifestHash
    && approval.nativeReviewVerified === true && approval.reviewer === targets().account,
  'SALESFORCE_HOSTED_REVIEW_REQUIRED');
  const reviewed = hostedReviewedPlan(cwd, plan);
  const schemaBootstrap = Boolean(reviewed.review.bootstrap);
  if (schemaBootstrap || plan.deferSchemaDependentSmoke) reviewedBootstrapFingerprint(reviewed, plan);

  const directory = mkdtempSync(join(tmpdir(), 'fcos-salesforce-hosted-'));
  const credentials = mkdtempSync(join(tmpdir(), 'fcos-salesforce-credentials-'));
  let finished = false;
  try {
    const commandEnvironment = authenticateHostedSalesforce({ directory: credentials, cwd, env });
    const journal = openSalesforcePromotionJournal({ directory, binding: reviewed.binding });
    try {
      const provider = cliSalesforceProvider({ cwd, policy, commandEnvironment });
      provider.reconcile = (environment, jobId, { operation, submittedAt, validationJobId, packageSha256 }) =>
        reconcileHostedSalesforceJob({ environment, jobId, reviewed, operation, submittedAt, validationJobId,
          packageSha256, provider, journal: salesforce.journal });
      provider.mirror = mode => runReviewedMirror({ mode, cwd, plan: reviewed, state: journal.state, policy,
        provider, ownership: salesforce.ownership });
      const authorization = {
        productionMutation: true, fingerprint: reviewed.fingerprint, manifestSha256: reviewed.binding.manifestSha256,
        sourceTreeHash: reviewed.binding.sourceTreeHash, orgIds: reviewed.binding.orgIds,
        authorizedBy: approval.reviewer, evidence: manifestHash,
        expiresAt: new Date(Date.parse(approval.approvedAt) + 86_400_000).toISOString(),
      };
      let mirrorPreflightPassed = false;
      const ownership = {
        async assert(binding) {
          if (!mirrorPreflightPassed) {
            preflightSharedMirrorPublication();
            mirrorPreflightPassed = true;
          }
          return salesforce.ownership.assert(binding);
        },
      };
      const run = mode => runReviewedSalesforceRelease({ plan: reviewed, mode, policy, journal, provider,
        ownership, externalJournal: salesforce.journal,
        authorization: mode === 'apply' ? authorization : null,
        assertUnchanged: () => assertReviewedInputsUnchanged(reviewed, { cwd, policy }) });
      const saved = await salesforce.journal.readCheckpoints();
      if (!saved.some(item => item.stage === 'production' && item.operation === 'preparation'
        && (item.preparation?.validationJobId || item.preparation?.status === 'awaiting-authorized-bootstrap'))) {
        requireCondition((await run('prepare')).mode === 'prepared', 'SALESFORCE_HOSTED_PREPARATION_REQUIRED');
      }
      requireCondition((await run('apply')).mode === 'applied', 'SALESFORCE_HOSTED_APPLY_REQUIRED');
      const completedOperations = (await salesforce.journal.readCheckpoints()).filter(item => item.outcome === 'resolved'
        && journal.state.stages[item.stage]?.[item.operation]?.status === 'Succeeded'
        && matchesSalesforceCheckpoint(journal.state.stages[item.stage][item.operation], item))
        .map(item => ({ operationId: `salesforce:${item.stage}:${item.operation}`, evidenceDigest: item.evidenceDigest,
          verified: true, intentRecorded: true }));
      const completedIds = new Set(completedOperations.map(item => item.operationId));
      requireCondition(completedIds.has('salesforce:shared_mirror:publication') && policy.environments.every(({ key }) =>
        completedIds.has(`salesforce:${key}:validation`) && completedIds.has(`salesforce:${key}:deployment`)
        && (!schemaBootstrap || completedIds.has(`salesforce:${key}:bootstrap`))
        && reviewed.binding.permissionSets.every(name => completedIds.has(`salesforce:${key}:permission:${name}`))),
      'SALESFORCE_HOSTED_COMPLETION_EVIDENCE_REQUIRED');
      finished = true;
      return { passed: true, manifestHash, backwardCompatible: true, completedOperations,
        salesforce: { order: 'devee-mirror-qat-production', mirrorVerified: true,
          sourceTreeHash: reviewed.binding.sourceTreeHash, fingerprint: reviewed.fingerprint } };
    } finally {
      journal.close();
    }
  } finally {
    rmSync(credentials, { recursive: true, force: true });
    if (finished) rmSync(directory, { recursive: true, force: true });
  }
}

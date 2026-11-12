import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { assertReviewedInputsUnchanged, cliSalesforceProvider, loadReviewedSalesforcePlan } from '../../deploy-salesforce-reviewed-manifest.mjs';
import { runReviewedMirror } from '../../sync-salesforce-reviewed-repository.mjs';
import { preflightSharedMirrorPublication } from '../../sync-salesforce-shared-repository.mjs';
import { openSalesforcePromotionJournal } from '../salesforce-promotion-journal.mjs';
import { assertReviewedJobReport, matchesSalesforceCheckpoint, reviewedJobExpectations, runReviewedSalesforceRelease, safeProjectFile, verifyReviewedOrgInventory } from '../salesforce-reviewed-release.mjs';
import { assertHostedSalesforceRunner, authenticateHostedSalesforce } from './salesforce-hosted-auth.mjs';
import { digest, git, isDigest, requireCondition, targets } from './contract.mjs';
import { awaitLocalMirrorReceipt, createLocalMirrorRequest, usesLocalCollaboratorMirror } from './local-mirror-handoff.mjs';
import { githubClient } from './providers.mjs';
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

export async function recoverReviewedDeveeBootstrap({ adoption, manifest, reviewed, provider, github, now = () => new Date() }) {
  const environment = policy.environments[0];
  const endpoint = '/repos/' + targets().repository + '/deployments/';
  const receipt = await github.read(endpoint + adoption.receiptId);
  const checkpoint = receipt?.payload?.data;
  const reference = checkpoint?.job;
  requireCondition(receipt?.id === adoption.receiptId && receipt.creator?.id === policy.publication.requiredAccountId
    && receipt.creator.login === targets().account && receipt.environment === 'fcos-release-journal-v1'
    && receipt.sha === manifest.candidate.sha && receipt.payload?.kind === 'fcos_rapid_release_event'
    && receipt.payload.event === 'salesforce.checkpoint' && receipt.payload.manifestHash !== digest(manifest)
    && checkpoint?.stage === 'devee' && checkpoint.operation === 'bootstrap' && checkpoint.outcome === 'resolved'
    && checkpoint.result === 'succeeded_no_change' && checkpoint.fingerprint === reviewed.fingerprint
    && /^[a-f0-9]{64}$/u.test(checkpoint.evidenceDigest || '') && Number.isSafeInteger(checkpoint.originalCheckpoint)
    && checkpoint.originalCheckpoint > 0 && reference?.id === adoption.jobId && reference.validationId === null
    && /^[a-f0-9]{64}$/u.test(reference.packageSha256 || '') && Number.isFinite(Date.parse(reference.submittedAt)),
  'SALESFORCE_DEVEE_BOOTSTRAP_RECEIPT_REQUIRED');

  const original = await github.read(endpoint + checkpoint.originalCheckpoint);
  requireCondition(original?.id === checkpoint.originalCheckpoint && original.creator?.id === 41898282
    && original.creator.login === 'github-actions[bot]' && original.environment === receipt.environment
    && original.sha === receipt.sha && original.payload?.kind === receipt.payload.kind
    && original.payload.releaseId === receipt.payload.releaseId && original.payload.manifestHash === receipt.payload.manifestHash
    && original.payload.event === 'salesforce.checkpoint' && original.payload.data?.stage === 'devee'
    && original.payload.data.operation === 'bootstrap' && original.payload.data.outcome === 'pending'
    && original.payload.data.fingerprint === checkpoint.fingerprint
    && digest(original.payload.data.job) === digest(reference), 'SALESFORCE_DEVEE_BOOTSTRAP_ORIGINAL_REQUIRED');

  const prepared = await provider.prepareBootstrap(environment, reviewed);
  try {
    requireCondition(prepared.packageSha256 === reference.packageSha256, 'SALESFORCE_DEVEE_BOOTSTRAP_PACKAGE_CHANGED');
  } finally { await prepared.cleanup(); }
  await provider.verifyIdentity(environment);
  const report = await provider.report(environment, reference.id);
  const proof = assertReviewedJobReport(report, { environment, jobId: reference.id,
    ...reviewedJobExpectations(reviewed, environment, 'bootstrap') });
  const completed = Date.parse(proof.completedAt);
  const successes = [report.details.componentSuccesses].flat();
  requireCondition(completed >= Date.parse(reference.submittedAt) - 30_000 && completed <= now().getTime() + 30_000
    && successes.filter(entry => ['CustomObject', 'CustomField', 'PermissionSet'].includes(entry.componentType))
      .every(entry => entry.changed === false && entry.created !== true && entry.deleted !== true), 'SALESFORCE_DEVEE_BOOTSTRAP_NO_CHANGE_REQUIRED');
  const inventory = await verifyReviewedOrgInventory({ provider, environment, plan: reviewed,
    expected: reviewed.nativeInventories.devee.bootstrap, now });
  const verifiedAt = now().toISOString();
  return { ...proof, fingerprint: reviewed.fingerprint, validationJobId: null, submittedAt: reference.submittedAt,
    packageSha256: reference.packageSha256, verifiedAt, reconciledAt: verifiedAt,
    recoveredEvidenceDigest: digest({ receiptId: receipt.id, originalCheckpoint: original.id,
      providerReportSha256: proof.reportSha256, inventoryReceiptSha256: inventory.evidenceSha256 }) };
}

export async function recoverReviewedDeveePromotion({ receiptId, manifest, reviewed, provider, github, now = () => new Date() }) {
  const environment = policy.environments[0];
  const endpoint = '/repos/' + targets().repository + '/deployments/';
  const operations = ['bootstrap', 'validation', 'deployment'];
  const receipt = await github.read(endpoint + receiptId);
  const result = receipt?.payload?.data;
  const references = result?.deveeCheckpoints;
  requireCondition(receipt?.id === receiptId && receipt.creator?.id === policy.publication.requiredAccountId
    && receipt.creator.login === targets().account && receipt.environment === 'fcos-release-journal-v1'
    && receipt.sha === manifest.candidate.sha && receipt.payload?.kind === 'fcos_rapid_release_event'
    && receipt.payload.event === 'prerequisites.result' && isDigest(receipt.payload.manifestHash)
    && receipt.payload.manifestHash !== digest(manifest) && result?.outcome === 'devee_verified_mirror_not_published'
    && result.salesforceFingerprint === reviewed.fingerprint && isDigest(result.evidenceDigest)
    && Array.isArray(references) && references.length === operations.length
    && new Set(references).size === operations.length && references.every(id => Number.isSafeInteger(id) && id > 0),
  'SALESFORCE_DEVEE_PROMOTION_RECEIPT_REQUIRED');
  const originals = await Promise.all(references.map(id => github.read(endpoint + id)));
  const jobs = originals.map((original, index) => {
    const checkpoint = original?.payload?.data;
    const operation = operations[index];
    const job = checkpoint?.job;
    requireCondition(original?.id === references[index] && original.creator?.id === 41898282
      && original.creator.login === 'github-actions[bot]' && original.environment === receipt.environment
      && original.sha === receipt.sha && original.payload?.kind === receipt.payload.kind
      && original.payload.releaseId === receipt.payload.releaseId && original.payload.manifestHash === receipt.payload.manifestHash
      && original.payload.event === 'salesforce.checkpoint' && checkpoint?.stage === 'devee'
      && checkpoint.operation === operation && checkpoint.outcome === 'resolved'
      && checkpoint.fingerprint === reviewed.fingerprint && isDigest(checkpoint.evidenceDigest)
      && /^0Af[A-Za-z0-9]{15}$/u.test(job?.id || '') && Number.isFinite(Date.parse(job.submittedAt))
      && (operation === 'deployment' ? job.packageSha256 === undefined : job.validationId === null && isDigest(job.packageSha256)),
    'SALESFORCE_DEVEE_PROMOTION_CHECKPOINT_REQUIRED');
    return job;
  });
  requireCondition(new Set(jobs.map(job => job.id)).size === jobs.length && jobs[2].validationId === jobs[1].id
    && jobs.every((job, index) => index === 0 || Date.parse(job.submittedAt) >= Date.parse(jobs[index - 1].submittedAt)),
  'SALESFORCE_DEVEE_PROMOTION_JOB_ORDER_REQUIRED');
  for (const [index, prepare] of [provider.prepareBootstrap, provider.prepareValidation].entries()) {
    const prepared = await prepare(environment, reviewed);
    try {
      requireCondition(prepared.packageSha256 === jobs[index].packageSha256, 'SALESFORCE_DEVEE_PROMOTION_PACKAGE_CHANGED');
    } finally { await prepared.cleanup(); }
  }

  await provider.verifyIdentity(environment);
  const reports = await Promise.all(jobs.map(job => provider.report(environment, job.id)));
  const inventory = await verifyReviewedOrgInventory({ provider, environment, plan: reviewed,
    expected: reviewed.nativeInventories.devee.final, now });
  return jobs.map((job, index) => {
    const operation = operations[index];
    const proof = assertReviewedJobReport(reports[index], { environment, jobId: job.id,
      ...reviewedJobExpectations(reviewed, environment, operation),
      ...(operation === 'deployment' ? { quickValidation: { id: jobs[1].id, report: reports[1] } } : {}) });
    const completed = Date.parse(proof.completedAt);
    const verifiedAt = now();
    requireCondition(completed >= Date.parse(job.submittedAt) - 30_000 && completed <= verifiedAt.getTime() + 30_000,
      'SALESFORCE_DEVEE_PROMOTION_JOB_TIMING_INVALID');
    return { operation, record: { ...proof, fingerprint: reviewed.fingerprint, validationJobId: job.validationId,
      submittedAt: job.submittedAt, verifiedAt: verifiedAt.toISOString(), reconciledAt: verifiedAt.toISOString(),
      ...(job.packageSha256 ? { packageSha256: job.packageSha256 } : {}),
      recoveredEvidenceDigest: digest({ receiptId, originalCheckpoint: references[index],
        providerReportSha256: proof.reportSha256, inventoryReceiptSha256: inventory.evidenceSha256 }) } };
  });
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
  requireCondition(reviewed.review.bootstrap && /^[a-f0-9]{64}$/u.test(reviewed.binding.bootstrapSha256 || ''),
    'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED');
  const fingerprint = digest({ salesforceFingerprint: reviewed.fingerprint, bootstrapSha256: reviewed.binding.bootstrapSha256 });
  requireCondition(fingerprint === plan.bootstrapFingerprint, 'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_MISMATCH');
  return fingerprint;
}

export async function verifyPreBootstrapStage({ manifest, staged, plan, salesforceCandidateDirectory: cwd, env }, { withDatabase = false } = {}) {
  const databaseSelected = withDatabase ? manifest.selection.database === true : !manifest.selection.database;
  requireCondition(manifest.selection.salesforce && databaseSelected && cwd && plan.backwardCompatible === true
    && plan.deferSchemaDependentSmoke === true,
    'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED');
  requireCondition(plan.mirrorPublication === undefined || usesLocalCollaboratorMirror(manifest), 'SALESFORCE_MIRROR_MODE_INVALID');
  const reviewed = hostedReviewedPlan(cwd, plan);
  return runPreBootstrapSmoke({ manifest, staged, env }, reviewedBootstrapFingerprint(reviewed, plan));
}

export async function applyReviewedPrerequisites(input) {
  return prepareReviewedSalesforcePrerequisites(input)();
}

export function prepareReviewedSalesforcePrerequisites({
  manifest, approval, plan, salesforce, salesforceCandidateDirectory: cwd, env = process.env,
}, { withDatabase = false } = {}) {
  const manifestHash = digest(manifest);
  const databaseSelected = withDatabase ? manifest.selection.database === true : !manifest.selection.database;
  requireCondition(manifest.selection.salesforce && databaseSelected && plan.backwardCompatible === true
    && cwd && typeof salesforce?.journal?.readCheckpoints === 'function'
    && typeof salesforce?.ownership?.assert === 'function' && approval?.manifestHash === manifestHash
    && approval.nativeReviewVerified === true && approval.reviewer === targets().account,
  'SALESFORCE_HOSTED_REVIEW_REQUIRED');
  const reviewed = hostedReviewedPlan(cwd, plan);
  const schemaBootstrap = Boolean(reviewed.review.bootstrap);
  if (schemaBootstrap || plan.deferSchemaDependentSmoke) {
    // Salesforce-only schema can qualify the full application before approval
    // when the staged application does not read the new metadata.
    requireCondition(plan.deferSchemaDependentSmoke === true
      || (!withDatabase && plan.deferSchemaDependentSmoke === false && plan.deferredModules === undefined),
    'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED');
    reviewedBootstrapFingerprint(reviewed, plan);
  }

  assertHostedSalesforceRunner(env);
  const localMirror = plan.mirrorPublication === 'local-collaborator';
  requireCondition(plan.mirrorPublication === undefined || (localMirror && usesLocalCollaboratorMirror(manifest)), 'SALESFORCE_MIRROR_MODE_INVALID');
  const adoption = plan.deveeBootstrapAdoption;
  requireCondition(adoption === undefined || (!withDatabase && schemaBootstrap && reviewed.nativeInventories?.devee?.bootstrap
    && adoption && Object.keys(adoption).length === 2 && Number.isSafeInteger(adoption.receiptId) && adoption.receiptId > 0
    && /^0Af[A-Za-z0-9]{15}$/u.test(adoption.jobId || '')), 'SALESFORCE_DEVEE_BOOTSTRAP_ADOPTION_INVALID');
  const promotionReceiptId = plan.deveePromotionAdoptionReceiptId;
  requireCondition(promotionReceiptId === undefined || (adoption === undefined && !withDatabase && schemaBootstrap && localMirror
    && reviewed.nativeInventories?.devee?.final && Number.isSafeInteger(promotionReceiptId) && promotionReceiptId > 0),
  'SALESFORCE_DEVEE_PROMOTION_ADOPTION_INVALID');
  return () => applyPreparedSalesforce({ manifest, manifestHash, approval, salesforce, cwd, env, reviewed, schemaBootstrap, localMirror, adoption, promotionReceiptId });
}

async function hostedLocalMirrorTransport({ manifest, approval, env, reviewed, salesforce }) {
  const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha, actions: true });
  const { user, repo } = await github.identity();
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  requireCondition(user.login === 'github-actions[bot]' && repo.owner?.id === policy.publication.requiredAccountId
    && Number(env.GITHUB_RUN_ID) === approval.runId && Number.isSafeInteger(runAttempt) && runAttempt > 0,
  'LOCAL_MIRROR_WORKFLOW_IDENTITY_REQUIRED');
  let sequence = 0;
  let verifiedCommit;
  return async (mode, deployment, intent) => {
    const receipt = await salesforce.ownership.assert({
      fingerprint: reviewed.fingerprint, stage: 'devee', orgId: deployment.orgId, operation: 'shared-publication',
    });
    if (mode === 'publish') {
      requireCondition(intent?.status === 'submitting' && intent.receiptId === receipt.receiptId,
        'LOCAL_MIRROR_PUBLICATION_INTENT_REQUIRED');
    }
    const checkpoint = (await salesforce.journal.readCheckpoints())
      .find(item => item.stage === 'shared_mirror' && item.operation === 'publication');
    requireCondition(checkpoint?.outcome === (mode === 'check' ? 'resolved' : 'pending')
      && (mode !== 'publish' || checkpoint.evidenceDigest === digest(intent)), 'LOCAL_MIRROR_PUBLICATION_CHECKPOINT_REQUIRED');
    const expiresAt = mode === 'publish' ? intent.receiptExpiresAt : receipt.expiresAt;
    const request = createLocalMirrorRequest({
      manifest, approval, reviewed, deployment, runAttempt, intentHash: checkpoint.evidenceDigest,
      expiresAt, mode, sequence: ++sequence,
    });
    const proof = await awaitLocalMirrorReceipt({
      github, request, reviewed, workflowActorId: user.id, publisherId: policy.publication.requiredAccountId,
    });
    requireCondition((!verifiedCommit || verifiedCommit === proof.commit)
      && (mode !== 'check' || (checkpoint.mirror?.commit === proof.commit && checkpoint.mirror?.pullRequest === proof.pullRequest.number)),
    'LOCAL_MIRROR_HEAD_CHANGED');
    verifiedCommit = proof.commit;
    await salesforce.ownership.assert({
      fingerprint: reviewed.fingerprint, stage: 'devee', orgId: deployment.orgId, operation: 'shared-publication',
    });
    return proof;
  };
}

async function applyPreparedSalesforce({ manifest, manifestHash, approval, salesforce, cwd, env, reviewed, schemaBootstrap, localMirror, adoption, promotionReceiptId }) {
  const saved = await salesforce.journal.readCheckpoints();
  const localTransport = localMirror ? await hostedLocalMirrorTransport({ manifest, approval, env, reviewed, salesforce }) : null;
  const directory = mkdtempSync(join(tmpdir(), 'fcos-salesforce-hosted-'));
  const credentials = mkdtempSync(join(tmpdir(), 'fcos-salesforce-credentials-'));
  let finished = false;
  try {
    const commandEnvironment = authenticateHostedSalesforce({ directory: credentials, cwd, env, requireMirrorCredential: !localMirror && saved.length === 0 });
    const journal = openSalesforcePromotionJournal({ directory, binding: reviewed.binding });
    try {
      const provider = cliSalesforceProvider({ cwd, policy, commandEnvironment });
      provider.reconcile = (environment, jobId, { operation, submittedAt, validationJobId, packageSha256 }) =>
        reconcileHostedSalesforceJob({ environment, jobId, reviewed, operation, submittedAt, validationJobId,
          packageSha256, provider, journal: salesforce.journal });
      if (adoption && !saved.some(item => item.stage === 'devee' && item.operation === 'bootstrap')) {
        const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha, actions: true });
        const record = await recoverReviewedDeveeBootstrap({ adoption, manifest, reviewed, provider, github });
        await assertReviewedInputsUnchanged(reviewed, { cwd, policy });
        const savedBootstrap = journal.update('devee', 'bootstrap', record);
        await salesforce.journal.checkpoint({ fingerprint: reviewed.fingerprint, stage: 'devee', operation: 'bootstrap', record: savedBootstrap });
      }
      if (promotionReceiptId && ['bootstrap', 'validation', 'deployment'].some(operation =>
        !saved.some(item => item.stage === 'devee' && item.operation === operation))) {
        const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha, actions: true });
        const recovered = await recoverReviewedDeveePromotion({ receiptId: promotionReceiptId, manifest, reviewed, provider, github });
        await assertReviewedInputsUnchanged(reviewed, { cwd, policy });
        for (const { operation, record } of recovered) {
          const previous = saved.find(item => item.stage === 'devee' && item.operation === operation);
          if (previous) {
            const job = previous.job;
            requireCondition(previous.outcome === 'resolved' && previous.fingerprint === reviewed.fingerprint
              && isDigest(previous.evidenceDigest) && job?.id === record.jobId && job.validationId === record.validationJobId
              && job.submittedAt === record.submittedAt && job.packageSha256 === record.packageSha256,
              'SALESFORCE_DEVEE_PROMOTION_CURRENT_CHECKPOINT_CHANGED');
            continue;
          }
          const checkpoint = journal.update('devee', operation, record);
          await salesforce.journal.checkpoint({ fingerprint: reviewed.fingerprint, stage: 'devee', operation, record: checkpoint });
        }
      }
      provider.mirror = localTransport
        ? (mode, { deveeDeployment }) => localTransport(mode, deveeDeployment, journal.state.stages.shared_mirror?.publication)
        : mode => runReviewedMirror({ mode, cwd, plan: reviewed, state: journal.state, policy,
          provider, ownership: salesforce.ownership });
      if (localTransport) {
        provider.readPendingMirror = ({ deveeDeployment }) => localTransport('recover', deveeDeployment);
      }
      const authorization = {
        productionMutation: true, fingerprint: reviewed.fingerprint, manifestSha256: reviewed.binding.manifestSha256,
        sourceTreeHash: reviewed.binding.sourceTreeHash, orgIds: reviewed.binding.orgIds,
        authorizedBy: approval.reviewer, evidence: manifestHash,
        expiresAt: new Date(Date.parse(approval.approvedAt) + 86_400_000).toISOString(),
      };
      let mirrorPreflightPassed = localMirror;
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

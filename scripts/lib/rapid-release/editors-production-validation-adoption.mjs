import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { assertReviewedJobReport, assertReviewedMirror, reviewedJobExpectations } from '../salesforce-reviewed-release.mjs';
import { digest, isDigest, requireCondition, validateManifest } from './contract.mjs';
import { originalEditorsProductionValidation, readStoppedEditorsProductionValidation } from './editors-production-validation-closure.mjs';
import { verifyLocalMirrorReceipt } from './local-mirror-handoff.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (left, right) => digest(left ?? null) === digest(right ?? null);
const dataOf = row => row?.payload?.data;
const closureField = 'editorsProductionValidationAdoptionReceiptId';
const validationLifetimeMs = 10 * 86_400_000;

export function assertEditorsProductionValidationSuccessor(manifest, predecessor) {
  validateManifest(manifest);
  const prior = predecessor.manifest;
  const closure = predecessor.receipt;
  const { [closureField]: locator, ...retainedPlan } = manifest.prerequisites?.plan ?? {};
  requireCondition(positive(locator) && closure?.id === locator && closure.payload?.manifestHash === validateManifest(prior)
    && manifest.selection.salesforce === true && !manifest.selection.database
    && manifest.prerequisites.adapter === 'salesforce-reviewed-manifest' && prior.prerequisites.adapter === manifest.prerequisites.adapter
    && manifest.controllerSha !== prior.controllerSha && manifest.releaseId !== prior.releaseId
    && Date.parse(manifest.createdAt) >= Date.parse(closure.created_at)
    && ['candidate', 'previous', 'paths', 'moduleInventory', 'selection', 'build'].every(field => same(manifest[field], prior[field]))
    && same(retainedPlan, prior.prerequisites.plan), 'EDITORS_ADOPTION_SUCCESSOR_CHANGED');
  return predecessor;
}

export async function readEditorsProductionValidationAdoption({ manifest, github }) {
  return assertEditorsProductionValidationSuccessor(manifest, await readStoppedEditorsProductionValidation({ github }));
}

export function assertEditorsAdoptionApproval({ recovery, approval, manifest }) {
  const { originalRunId, continuationRunId, closureRunId } = dataOf(recovery.receipt);
  requireCondition(approval?.nativeReviewVerified === true && approval.manifestHash === digest(manifest) && positive(approval.runId)
    && ![originalRunId, continuationRunId, closureRunId].includes(approval.runId)
    && /^dpl_[A-Za-z0-9]+$/u.test(approval.deploymentId || '') && approval.deploymentId !== recovery.staged.id
    && Date.parse(approval.approvedAt) > Date.parse(recovery.receipt.created_at),
  'EDITORS_ADOPTION_FRESH_APPROVAL_REQUIRED');
}

export function assertEditorsValidationUsable(record, now = Date.now()) {
  requireCondition(Date.parse(record?.completedAt) + validationLifetimeMs > now, 'EDITORS_ADOPTION_PRODUCTION_VALIDATION_EXPIRED');
}

async function readJobs({ environment, operations, recovery, reviewed, provider, now }) {
  const stage = environment.key;
  const rows = operations.map(operation => recovery.checkpoints[`${stage}:${operation}`]);
  const [validation] = rows;
  await provider.verifyIdentity(environment);
  const prepared = await provider.prepareValidation(environment, reviewed);
  try {
    requireCondition(prepared.packageSha256 === dataOf(validation)?.job?.packageSha256, 'EDITORS_ADOPTION_PACKAGE_CHANGED');
  } finally { await prepared.cleanup(); }
  const reports = await Promise.all(rows.map(row => provider.report(environment, dataOf(row).job.id)));
  return rows.map((row, index) => {
    const { job, operation, evidenceDigest } = dataOf(row);
    const proof = assertReviewedJobReport(reports[index], { environment, jobId: job.id,
      ...reviewedJobExpectations(reviewed, environment, operation),
      ...(operation === 'deployment' ? { quickValidation: { id: dataOf(validation).job.id, report: reports[0] } } : {}),
    });
    const verifiedAt = now();
    const completed = Date.parse(proof.completedAt);
    requireCondition(completed >= Date.parse(job.submittedAt) - 30_000 && completed <= verifiedAt.getTime() + 30_000,
      'EDITORS_ADOPTION_JOB_TIMING_CHANGED');
    return { stage, operation, record: { ...proof, fingerprint: reviewed.fingerprint, validationJobId: job.validationId,
      submittedAt: job.submittedAt, verifiedAt: verifiedAt.toISOString(), reconciledAt: verifiedAt.toISOString(),
      ...(job.packageSha256 ? { packageSha256: job.packageSha256 } : {}),
      recoveredEvidenceDigest: digest({ receiptId: recovery.receipt.id, originalCheckpoint: row.id,
        originalEvidenceDigest: evidenceDigest, reportSha256: proof.reportSha256 }),
    } };
  });
}

// The hosted engine rechecks final sandbox inventory and Production preimage before its
// first write. Its mirror check uses the original published head as the expected result.
export async function recoverEditorsProductionValidation({ recovery, reviewed, provider, saved, now = () => new Date() }) {
  const plan = recovery.manifest.prerequisites.plan;
  requireCondition(reviewed.fingerprint === plan.salesforceFingerprint && reviewed.binding.sourceTreeHash === plan.salesforceSourceTreeHash
    && reviewed.review.nativeDeveeDesktop?.caseSetDigest === plan.deveeDesktopCaseSetDigest && !reviewed.review.bootstrap
    && !reviewed.invoiceAppPlacement && reviewed.binding.permissionSets.length === 0
    && reviewed.nativeInventories?.devee?.final && reviewed.nativeInventories?.qat?.final && reviewed.nativeInventories?.production?.baseline,
  'EDITORS_ADOPTION_REVIEWED_SCOPE_CHANGED');
  const { checkpoints, mirror } = recovery;
  const original = dataOf(checkpoints['shared_mirror:publication']);
  const mirrorProof = verifyLocalMirrorReceipt({ request: mirror.request.payload, requestDeployment: mirror.request,
    receiptDeployment: mirror.receipt, reviewed, workflowActorId: originalEditorsProductionValidation.workflowActorId,
    publisherId: policy.publication.requiredAccountId, now: Date.parse(mirror.receipt.created_at) });
  const result = assertReviewedMirror(mirrorProof, reviewed, policy, dataOf(checkpoints['devee:deployment']).job.id);
  requireCondition(original.mirror.commit === result.commit && original.mirror.pullRequest === result.pullRequest.number,
    'EDITORS_ADOPTION_MIRROR_CHANGED');

  // An existing successor checkpoint must refer to the exact same historical operation.
  // Its own Production quick deploy, if already submitted, is reconciled by the normal engine.
  const originalProductionValidation = dataOf(checkpoints['production:validation']).job.id;
  for (const entry of saved) {
    const retained = dataOf(checkpoints[`${entry.stage}:${entry.operation}`]);
    if (retained) {
      requireCondition(entry.fingerprint === reviewed.fingerprint && entry.outcome === 'resolved' && isDigest(entry.evidenceDigest)
        && same(entry.job, retained.job) && same(entry.mirror, retained.mirror), 'EDITORS_ADOPTION_SUCCESSOR_CHECKPOINT_CHANGED');
    } else if (entry.stage === 'production' && ['preparation', 'deployment'].includes(entry.operation)) {
      const matches = entry.operation === 'preparation'
        ? entry.outcome === 'evidence' && entry.preparation?.validationJobId === originalProductionValidation
        : ['pending', 'resolved'].includes(entry.outcome) && entry.job?.validationId === originalProductionValidation
          && entry.job.id !== originalProductionValidation;
      requireCondition(matches && entry.fingerprint === reviewed.fingerprint && isDigest(entry.evidenceDigest),
        'EDITORS_ADOPTION_SUCCESSOR_CHECKPOINT_CHANGED');
    } else {
      requireCondition(entry.outcome === 'evidence', 'EDITORS_ADOPTION_SUCCESSOR_CHECKPOINT_CHANGED');
    }
  }

  const records = [];
  for (const environment of policy.environments) {
    const operations = environment.isSandbox ? ['validation', 'deployment'] : ['validation'];
    records.push(...await readJobs({ environment, operations, recovery, reviewed, provider, now }));
    if (environment.key === 'devee') records.push({ stage: 'shared_mirror', operation: 'publication', record: {
      status: 'Succeeded', result, verifiedAt: now().toISOString(),
      recoveredEvidenceDigest: digest({ receiptId: recovery.receipt.id, originalCheckpoint: checkpoints['shared_mirror:publication'].id,
        originalEvidenceDigest: original.evidenceDigest, publicationReceipt: mirror.receipt.id }),
    } });
  }
  if (!saved.some(entry => entry.stage === 'production' && entry.operation === 'deployment' && entry.job?.id)) {
    assertEditorsValidationUsable(records.at(-1).record, now().getTime());
  }
  return records;
}

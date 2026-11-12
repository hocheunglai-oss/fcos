import { setTimeout as sleep } from 'node:timers/promises';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { assertReviewedMirror } from '../salesforce-reviewed-release.mjs';
import { digest, isDigest, requireCondition, targets } from './contract.mjs';
import { assertPublicPayload } from './journal.mjs';

export const LOCAL_MIRROR_ENVIRONMENT = 'fcos-release-mirror-handoff-v1';
export const LOCAL_MIRROR_WINDOW_MS = 5 * 60_000;

const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const { publication } = policy;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const salesforceJob = value => typeof value === 'string' && /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u.test(value);

export function usesLocalCollaboratorMirror(manifest) {
  const { selection, prerequisites } = manifest;
  const adapter = prerequisites?.adapter;
  return prerequisites?.plan?.mirrorPublication === 'local-collaborator'
    && selection?.salesforce === true
    && ((selection.database === false && adapter === 'salesforce-reviewed-manifest')
      || (selection.database === true && adapter === 'trading-fx-prerequisites'));
}

export function createLocalMirrorRequest({ manifest, approval, reviewed, deployment, runAttempt, intentHash, expiresAt, mode = 'publish', sequence = 1, now = Date.now() }) {
  const manifestHash = digest(manifest);
  const deadline = Date.parse(expiresAt);
  const approvedAt = Date.parse(approval?.approvedAt);
  requireCondition(approval?.manifestHash === manifestHash && approval.nativeReviewVerified === true
    && ['publish', 'check', 'recover'].includes(mode) && positiveId(sequence)
    && positiveId(approval.runId) && positiveId(runAttempt) && sha(manifest.controllerSha) && sha(manifest.candidate?.sha)
    && isDigest(reviewed?.fingerprint) && isDigest(reviewed.binding?.sourceTreeHash) && isDigest(intentHash)
    && deployment?.status === 'Succeeded' && deployment.fingerprint === reviewed.fingerprint
    && deployment.orgId === reviewed.binding.orgIds?.devee && salesforceJob(deployment.jobId)
    && salesforceJob(deployment.validationJobId) && deployment.jobId !== deployment.validationJobId
    && approvedAt <= now && deadline <= approvedAt + 86_400_000
    && deadline > now && deadline <= now + LOCAL_MIRROR_WINDOW_MS,
  'LOCAL_MIRROR_REQUEST_INVALID');
  return {
    kind: 'fcos_local_mirror_request', manifestHash, controllerSha: manifest.controllerSha, candidateSha: manifest.candidate.sha,
    runId: approval.runId, runAttempt, mode, sequence, fingerprint: reviewed.fingerprint, sourceTreeHash: reviewed.binding.sourceTreeHash,
    deveeOrgId: deployment.orgId, deploymentJobId: deployment.jobId, validationJobId: deployment.validationJobId,
    repository: publication.repository, repositoryId: publication.repositoryId,
    intentHash, expiresAt: new Date(deadline).toISOString(),
  };
}

export function createLocalMirrorReceipt({ request, requestId, reviewed, report }) {
  requireCondition(positiveId(requestId) && request.fingerprint === reviewed?.fingerprint
    && request.sourceTreeHash === reviewed.binding.sourceTreeHash
    && request.repository === publication.repository && request.repositoryId === publication.repositoryId,
  'LOCAL_MIRROR_REPORT_BINDING_MISMATCH');
  assertReviewedMirror(report, reviewed, policy, request.deploymentJobId);
  const proof = {
    releaseMode: report.releaseMode, sourceTreeHash: report.sourceTreeHash, sourceEnvironment: report.sourceEnvironment,
    sourceDeploymentJobId: report.sourceDeploymentJobId, repository: report.repository, account: report.account,
    branch: report.branch, commit: report.commit,
    pullRequest: {
      number: report.pullRequest.number, state: report.pullRequest.state, isDraft: report.pullRequest.isDraft,
      baseRefName: report.pullRequest.baseRefName, headRefName: report.pullRequest.headRefName, headRefOid: report.pullRequest.headRefOid,
    },
  };
  assertPublicPayload(proof);
  return {
    kind: 'fcos_local_mirror_receipt', requestId, requestHash: digest(request), repositoryId: request.repositoryId,
    proof, proofDigest: digest(proof),
  };
}

export function verifyLocalMirrorRequest({ request, requestDeployment, workflowActorId, now = Date.now() }) {
  const deadline = Date.parse(request.expiresAt);
  requireCondition(deadline > now && deadline <= now + LOCAL_MIRROR_WINDOW_MS, 'LOCAL_MIRROR_REQUEST_EXPIRED');
  const requestedAt = Date.parse(requestDeployment?.created_at);
  requireCondition(positiveId(workflowActorId) && workflowActorId !== publication.requiredAccountId
    && request.kind === 'fcos_local_mirror_request' && request.repository === publication.repository
    && request.repositoryId === publication.repositoryId
    && positiveId(requestDeployment?.id) && requestDeployment.creator?.id === workflowActorId
    && requestDeployment.environment === LOCAL_MIRROR_ENVIRONMENT && requestDeployment.sha === request.candidateSha
    && requestedAt <= now && requestedAt < deadline && requestDeployment.payload
    && digest(requestDeployment.payload) === digest(request), 'LOCAL_MIRROR_REQUEST_NOT_NATIVE');
  return requestDeployment.id;
}

export function verifyLocalMirrorReceipt({ request, requestDeployment, receiptDeployment, reviewed, workflowActorId, publisherId, now = Date.now() }) {
  const requestId = verifyLocalMirrorRequest({ request, requestDeployment, workflowActorId, now });
  const deadline = Date.parse(request.expiresAt);
  const receipt = receiptDeployment?.payload;
  const requestedAt = Date.parse(requestDeployment.created_at);
  const publishedAt = Date.parse(receiptDeployment?.created_at);
  requireCondition(publisherId === publication.requiredAccountId && positiveId(receiptDeployment?.id)
    && receiptDeployment.creator?.id === publisherId
    && receiptDeployment.environment === LOCAL_MIRROR_ENVIRONMENT && receiptDeployment.sha === request.candidateSha
    && requestedAt <= publishedAt && publishedAt <= now && publishedAt < deadline
    && receipt?.kind === 'fcos_local_mirror_receipt' && receipt.requestId === requestId
    && receipt.requestHash === digest(request) && receipt.repositoryId === request.repositoryId
    && request.fingerprint === reviewed?.fingerprint && request.sourceTreeHash === reviewed.binding.sourceTreeHash
    && receipt.proof && digest(receipt.proof) === receipt.proofDigest, 'LOCAL_MIRROR_RECEIPT_MISMATCH');
  return assertReviewedMirror(receipt.proof, reviewed, policy, request.deploymentJobId);
}

export async function readLocalMirrorDeployments(github, candidateSha) {
  requireCondition(sha(candidateSha), 'LOCAL_MIRROR_CANDIDATE_INVALID');
  return github.pages(`/repos/${targets().repository}/deployments?environment=${LOCAL_MIRROR_ENVIRONMENT}&sha=${candidateSha}&per_page=100`);
}

// The caller owns serialization and persists intent before calling. An uncertain
// earlier submission can only be read back until its outcome is resolved.
export async function recordLocalMirrorDeployment({ github, candidateSha, actorId, payload, readbackOnly = false }) {
  requireCondition(sha(candidateSha) && positiveId(actorId)
    && ['fcos_local_mirror_request', 'fcos_local_mirror_receipt'].includes(payload?.kind), 'LOCAL_MIRROR_RECORD_INVALID');
  assertPublicPayload(payload);
  const lookup = async () => {
    const records = await readLocalMirrorDeployments(github, candidateSha);
    const matches = records.filter(record => record.environment === LOCAL_MIRROR_ENVIRONMENT && record.sha === candidateSha
      && record.creator?.id === actorId && record.payload && digest(record.payload) === digest(payload));
    requireCondition(matches.length <= 1, 'LOCAL_MIRROR_RECORD_DUPLICATE');
    return matches[0];
  };
  const existing = await lookup();
  if (existing) return existing;
  requireCondition(!readbackOnly, 'LOCAL_MIRROR_RECORD_ACK_UNCERTAIN');
  try {
    await github.write(`/repos/${targets().repository}/deployments`, {
      ref: candidateSha, task: 'fcos-local-mirror-handoff', auto_merge: false, required_contexts: [],
      environment: LOCAL_MIRROR_ENVIRONMENT, production_environment: false, transient_environment: false, payload,
    });
  } catch {
    // Resolve the original native write without sending another request.
  }
  const recorded = await lookup();
  requireCondition(recorded, 'LOCAL_MIRROR_RECORD_ACK_UNCERTAIN');
  return recorded;
}


// The hosted job retains the production concurrency slot while the operator
// publishes or rechecks the mirror through its isolated local GitHub session.
export async function awaitLocalMirrorReceipt({ github, request, reviewed, workflowActorId, publisherId,
  now = Date.now, pause = sleep }) {
  const requestDeployment = await recordLocalMirrorDeployment({
    github, candidateSha: request.candidateSha, actorId: workflowActorId, payload: request,
  });
  while (now() < Date.parse(request.expiresAt)) {
    const records = await readLocalMirrorDeployments(github, request.candidateSha);
    const receipts = records.filter(record => record.creator?.id === publisherId
      && record.payload?.kind === 'fcos_local_mirror_receipt' && record.payload.requestId === requestDeployment.id);
    requireCondition(receipts.length <= 1, 'LOCAL_MIRROR_RECEIPT_DUPLICATE');
    if (receipts.length) {
      return verifyLocalMirrorReceipt({
        request, requestDeployment, receiptDeployment: receipts[0], reviewed, workflowActorId, publisherId, now: now(),
      });
    }
    const remaining = Date.parse(request.expiresAt) - now();
    if (remaining > 0) await pause(Math.min(5000, remaining));
  }
  throw new Error('LOCAL_MIRROR_RECEIPT_WINDOW_ENDED');
}

import { setTimeout as delay } from 'node:timers/promises';
import { fcosSalesforceEnvironment, FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { digest, isDigest, isSha, requireCondition, targets } from './contract.mjs';
import { assertPublicPayload } from './journal.mjs';

const { publication } = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const devee = fcosSalesforceEnvironment('devee');
const actionsActorId = 41898282;
const releaseRepositoryId = 1278654816;
const jobId = /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u;
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const time = iso => typeof iso === 'string' && Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString() === iso;
export const DEVEE_DESKTOP_OPERATION = 'native-desktop-smoke';
export const DEVEE_DESKTOP_WINDOW_MS = 10 * 60_000;
export const DEVEE_DESKTOP_WORKFLOW = '.github/workflows/fcos-rapid-release.yml';
export const DEVEE_DESKTOP_REQUEST_KIND = 'fcos_devee_desktop_request';
export const DEVEE_DESKTOP_RECEIPT_KIND = 'fcos_devee_desktop_receipt';

export const editorDesktopCases = Object.freeze([
  'transport-source-both-orders', 'wrong-product-rejected', 'ordinary-usd-preview',
  'managed-hkd-rate-and-review', 'scoped-save-and-stale-response', 'normal-and-restricted-access',
]);
export const editorDesktopCaseSetDigest = digest({
  suite: 'salesforce-trading-fx-editors-v1', cases: editorDesktopCases, roles: ['normal', 'restricted'],
  approvedFixturesOnly: true, businessWrites: 0, financialRequests: 0, customerSends: 0,
});
const editorComponents = [
  'ApexClass:FcosTradeCurrencyService', 'LightningComponentBundle:fcbEditOfferLineItemModal',
  'LightningComponentBundle:fcbEditSupplierBidModal', 'LightningComponentBundle:fcbPromotedOfferLineItemExtraCosts',
  'LightningComponentBundle:fcbSupplierBidExtraCosts', 'LightningComponentBundle:fcosTradeCurrencyEditor',
];

export function requiresDeveeDesktopCheckpoint(manifest) {
  const prerequisites = manifest.prerequisites;
  return manifest.selection?.salesforce === true && manifest.selection.database === false
    && prerequisites?.adapter === 'salesforce-reviewed-manifest'
    && prerequisites.plan?.mirrorPublication === 'local-collaborator'
    && prerequisites.plan.deveeDesktopCaseSetDigest === editorDesktopCaseSetDigest;
}

export function requireDeveeDesktopApprovalRecord({ chain, request, requestDeployment, jobs }) {
  const goLive = jobs?.jobs?.filter(job => job.name === 'go-live') ?? [];
  const trusted = row => row.creator?.id === actionsActorId && row.creator.login === 'github-actions[bot]';
  const original = chain.filter(row => row.payload.event === 'approval.accepted');
  const accepted = chain.filter(row => ['approval.accepted', 'approval.reconfirmed'].includes(row.payload.event)
    && row.payload.data.runId === request.runId);
  requireCondition(request.runAttempt === 1 && goLive.length === 1 && goLive[0].status === 'in_progress'
    && goLive[0].run_id === request.runId && goLive[0].run_attempt === request.runAttempt
    && original.length === 1 && trusted(original[0]) && accepted.length === 1 && trusted(accepted[0]),
  'DEVEE_DESKTOP_OPERATOR_CURRENT_APPROVAL_RECEIPT_REQUIRED');
  const saved = accepted[0], recordedAt = Date.parse(saved.created_at);
  requireCondition(original[0].payload.sequence <= saved.payload.sequence
    && Date.parse(saved.payload.data.approvedAt) <= recordedAt && Date.parse(goLive[0].started_at) <= recordedAt
    && recordedAt <= Date.parse(requestDeployment.created_at), 'DEVEE_DESKTOP_OPERATOR_CURRENT_APPROVAL_RECEIPT_REQUIRED');
  return saved;
}

export function assertEditorDesktopReview(review, manifestComponents, nativeInventories) {
  const selection = review.nativeDeveeDesktop;
  if (selection === undefined) return;
  requireCondition(digest(selection) === digest({ caseSetDigest: editorDesktopCaseSetDigest })
    && review.nativeProjection === 'schema-free-apex-lightning' && !review.bootstrap
    && digest(manifestComponents) === digest(editorComponents) && nativeInventories?.devee?.final?.projectedNativeInventory === true,
  'DEVEE_DESKTOP_REVIEW_SCOPE_INVALID');
}

export function createDeveeDesktopRequest({ manifest, approval, reviewed, deployment, inventory, execution, workflowProof, now = Date.now() }) {
  const manifestHash = digest(manifest);
  const { user, repo, run } = execution;
  const approvedAt = Date.parse(approval?.approvedAt), approvalExpiresAt = approvedAt + 86_400_000;
  requireCondition(approval?.manifestHash === manifestHash && approval.nativeReviewVerified === true
    && approval.candidateSha === manifest.candidate.sha && approval.buildId === manifest.build.buildId
    && approval.reviewer === publication.requiredAccount && positiveId(approval.runId)
    && run.id === approval.runId && run.run_attempt === 1 && run.actor?.id === publication.requiredAccountId
    && run.actor?.login === publication.requiredAccount && run.event === 'workflow_dispatch'
    && run.status === 'in_progress' && run.repository?.id === repo.id && run.repository?.full_name === targets().repository
    && run.head_branch === repo.default_branch && String(run.path).split('@')[0] === DEVEE_DESKTOP_WORKFLOW
    && repo.id === releaseRepositoryId && repo.full_name === targets().repository && repo.owner?.id === publication.requiredAccountId
    && user.id === actionsActorId && user.login === 'github-actions[bot]'
    && workflowProof.kind === 'native_workflow_blob_match' && workflowProof.controllerSha === manifest.controllerSha
    && workflowProof.dispatcherSha === run.head_sha && workflowProof.path === DEVEE_DESKTOP_WORKFLOW && isSha(workflowProof.blobSha)
    && approvedAt <= now && approvalExpiresAt > now, 'DEVEE_DESKTOP_WORKFLOW_INVALID');
  requireCondition(reviewed.review.nativeDeveeDesktop?.caseSetDigest === editorDesktopCaseSetDigest
    && isDigest(reviewed.fingerprint) && isDigest(reviewed.binding.sourceTreeHash) && reviewed.binding.orgIds.devee === devee.orgId
    && deployment?.status === 'Succeeded' && deployment.orgId === devee.orgId && deployment.fingerprint === reviewed.fingerprint
    && jobId.test(deployment.jobId) && jobId.test(deployment.validationJobId) && deployment.jobId !== deployment.validationJobId
    && inventory.orgId === devee.orgId && inventory.inventoryHash === reviewed.nativeInventories.devee.final.inventoryHash
    && inventory.identity?.isSandbox === true && inventory.identity.username === devee.username
    && inventory.verificationMethod === 'metadata-api-reviewed-native-byte-inventory'
    && [inventory.inventoryHash, inventory.observedNativeInventoryHash, inventory.evidenceSha256].every(isDigest)
    && time(inventory.verifiedAt) && Date.parse(inventory.verifiedAt) <= now && now - Date.parse(inventory.verifiedAt) <= 300_000,
  'DEVEE_DESKTOP_POSTIMAGE_REQUIRED');
  return { kind: DEVEE_DESKTOP_REQUEST_KIND, caseSetDigest: editorDesktopCaseSetDigest, manifestHash, releaseId: manifest.releaseId,
    repositoryId: repo.id, controllerSha: manifest.controllerSha, candidateSha: manifest.candidate.sha,
    workflowPath: workflowProof.path, workflowBlobSha: workflowProof.blobSha, dispatcherSha: run.head_sha,
    workflowActorId: actionsActorId, operatorId: publication.requiredAccountId, runId: run.id, runAttempt: run.run_attempt,
    orgId: devee.orgId, fingerprint: reviewed.fingerprint, deploymentJobId: deployment.jobId, validationJobId: deployment.validationJobId,
    sourceTreeHash: reviewed.binding.sourceTreeHash, inventoryHash: inventory.inventoryHash,
    installedInventoryHash: inventory.observedNativeInventoryHash, inventoryReceiptDigest: inventory.evidenceSha256,
    expiresAt: new Date(Math.min(now + DEVEE_DESKTOP_WINDOW_MS, approvalExpiresAt)).toISOString() };
}

export function createDeveeDesktopReceipt({ request, requestId, report }) {
  const { caseSetDigest, startedAt, verifiedAt, cases, roles, businessWrites, financialRequests, customerSends,
    approvedFixturesOnly, syntheticFixtureWrites, fixturesRestored, evidenceDigest, orgId, isSandbox, deploymentJobId, validationJobId,
    sourceTreeHash, installedInventoryHash } = report ?? {};
  requireCondition(request.kind === DEVEE_DESKTOP_REQUEST_KIND && positiveId(requestId)
    && caseSetDigest === request.caseSetDigest && caseSetDigest === editorDesktopCaseSetDigest
    && orgId === devee.orgId && orgId === request.orgId && isSandbox === true
    && deploymentJobId === request.deploymentJobId && validationJobId === request.validationJobId
    && sourceTreeHash === request.sourceTreeHash && installedInventoryHash === request.installedInventoryHash
    && time(startedAt) && time(verifiedAt) && startedAt <= verifiedAt && verifiedAt < request.expiresAt
    && digest(roles ?? null) === digest(['normal', 'restricted'])
    && Array.isArray(cases) && cases.length === editorDesktopCases.length
    && editorDesktopCases.every((id, i) => cases[i]?.id === id && cases[i].passed === true && isDigest(cases[i].evidenceDigest))
    && businessWrites === 0 && financialRequests === 0 && customerSends === 0
    && approvedFixturesOnly === true && positiveId(syntheticFixtureWrites)
    && fixturesRestored === true && isDigest(evidenceDigest), 'DEVEE_DESKTOP_EVIDENCE_INVALID');
  const proof = { orgId, isSandbox, deploymentJobId, validationJobId, sourceTreeHash, installedInventoryHash,
    caseSetDigest, startedAt, verifiedAt, cases: cases.map(({ id, passed, evidenceDigest }) => ({ id, passed, evidenceDigest })),
    roles, businessWrites, financialRequests, customerSends, approvedFixturesOnly, syntheticFixtureWrites, fixturesRestored, evidenceDigest };
  assertPublicPayload(proof);
  return { kind: DEVEE_DESKTOP_RECEIPT_KIND, requestId, requestDigest: digest(request), proof, proofDigest: digest(proof) };
}

export function verifyDeveeDesktopRequest({ request, requestDeployment, environment, now = Date.now() }) {
  const requestCreated = Date.parse(requestDeployment?.created_at);
  const expiry = Date.parse(request.expiresAt);
  requireCondition(now < expiry && expiry <= now + DEVEE_DESKTOP_WINDOW_MS
    && request.kind === DEVEE_DESKTOP_REQUEST_KIND && request.workflowActorId === actionsActorId
    && request.operatorId === publication.requiredAccountId && positiveId(requestDeployment?.id)
    && requestDeployment.creator?.id === actionsActorId && requestDeployment.creator?.login === 'github-actions[bot]'
    && requestDeployment.environment === environment && requestDeployment.sha === request.candidateSha
    && digest(requestDeployment.payload ?? null) === digest(request) && requestCreated <= now && requestCreated < expiry,
  'DEVEE_DESKTOP_NATIVE_REQUEST_INVALID');
  return requestDeployment.id;
}

export function verifyDeveeDesktopReceipt({ request, requestDeployment, receiptDeployment, environment, now = Date.now() }) {
  const requestId = verifyDeveeDesktopRequest({ request, requestDeployment, environment, now });
  const requestCreated = Date.parse(requestDeployment.created_at);
  const receiptCreated = Date.parse(receiptDeployment?.created_at);
  const payload = receiptDeployment?.payload;
  requireCondition(positiveId(receiptDeployment?.id) && receiptDeployment.creator?.id === publication.requiredAccountId
    && receiptDeployment.creator?.login === publication.requiredAccount && receiptDeployment.environment === environment
    && receiptDeployment.sha === request.candidateSha && requestCreated <= receiptCreated && receiptCreated <= now
    && receiptCreated < Date.parse(request.expiresAt) && payload?.kind === DEVEE_DESKTOP_RECEIPT_KIND && payload.requestId === requestId
    && payload.proof && Date.parse(payload.proof.startedAt) >= requestCreated && Date.parse(payload.proof.verifiedAt) <= receiptCreated,
  'DEVEE_DESKTOP_NATIVE_RECEIPT_INVALID');
  const expected = createDeveeDesktopReceipt({ request, requestId, report: payload.proof });
  requireCondition(digest(expected) === digest(payload), 'DEVEE_DESKTOP_NATIVE_RECEIPT_INVALID');
  return { requestId, requestDigest: expected.requestDigest, proofId: receiptDeployment.id, proofDigest: expected.proofDigest };
}

export async function awaitDeveeDesktopReceipt({ request, recordRequest, readRecords, environment, now = Date.now, pause = delay }) {
  const requestDeployment = await recordRequest(request);
  verifyDeveeDesktopRequest({ request, requestDeployment, environment, now: now() });
  while (now() < Date.parse(request.expiresAt)) {
    const records = await readRecords();
    const receipts = records.filter(record => record.creator?.id === request.operatorId
      && record.payload?.kind === DEVEE_DESKTOP_RECEIPT_KIND && record.payload.requestId === requestDeployment.id);
    requireCondition(receipts.length <= 1, 'DEVEE_DESKTOP_NATIVE_RECEIPT_DUPLICATE');
    if (receipts.length === 1) return verifyDeveeDesktopReceipt({ request, requestDeployment, receiptDeployment: receipts[0], environment, now: now() });
    const remaining = Date.parse(request.expiresAt) - now();
    if (remaining > 0) await pause(Math.min(5000, remaining));
  }
  throw Object.assign(new Error('DEVEE_DESKTOP_EVIDENCE_WINDOW_ENDED'), { code: 'DEVEE_DESKTOP_EVIDENCE_WINDOW_ENDED' });
}

export async function recordVerifiedDeveeDesktopCheckpoint({ request, receipt, readInstalledInventory, journal }) {
  requireCondition(receipt.requestDigest === digest(request) && isDigest(receipt.proofDigest)
    && positiveId(receipt.requestId) && positiveId(receipt.proofId), 'DEVEE_DESKTOP_NATIVE_RECEIPT_INVALID');
  const current = await readInstalledInventory();
  requireCondition(current.orgId === request.orgId && current.inventoryHash === request.inventoryHash
    && current.observedNativeInventoryHash === request.installedInventoryHash && isDigest(current.evidenceSha256),
  'DEVEE_DESKTOP_POSTIMAGE_CHANGED');
  const checkpoint = await journal.checkpoint({ fingerprint: request.fingerprint, stage: 'devee', operation: DEVEE_DESKTOP_OPERATION,
    record: { status: 'observed', ...receipt, runId: request.runId, runAttempt: request.runAttempt,
      sourceTreeHash: request.sourceTreeHash, inventoryHash: request.inventoryHash, installedInventoryHash: request.installedInventoryHash,
      finalInventoryReceiptDigest: current.evidenceSha256, caseSetDigest: request.caseSetDigest } });
  requireCondition(checkpoint?.payload?.data?.desktop?.proofId === receipt.proofId, 'DEVEE_DESKTOP_CHECKPOINT_ACK_UNCERTAIN');
  return receipt;
}

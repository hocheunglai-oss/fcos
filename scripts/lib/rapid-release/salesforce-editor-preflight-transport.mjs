import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { digest, isDigest, targets } from './contract.mjs';
import { assertPublicPayload } from './journal.mjs';
import { editorDesktopCaseSetDigest, requiresDeveeDesktopCheckpoint } from './salesforce-devee-desktop-checkpoint.mjs';
import { EDITOR_PREFLIGHT_MAX_AGE_MS, verifyEditorPreflightEvidence } from './salesforce-editor-preflight-proof.mjs';

export const EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT = 'fcos-editor-native-attestation-v1';
export const EDITOR_PREFLIGHT_ATTESTATION_TASK = 'verify:editors-native-preflight';
const kind = 'fcos_editor_native_preflight_attestation';
const { publication } = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const devee = fcosSalesforceEnvironment('devee');
const positive = value => Number.isSafeInteger(value) && value > 0;
const jobId = value => /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u.test(value ?? '');
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fields = [
  'kind', 'schemaVersion', 'repository', 'candidateSha', 'sourceDigest', 'controllerSha', 'baselineSha',
  'sourceTreeHash', 'salesforceFingerprint', 'caseSetDigest', 'evidenceDigest',
  'qualificationValidationJobId', 'qualificationDeploymentJobId', 'installedInventoryHash',
  'cleanupEvidenceDigest', 'completedAt', 'expiresAt',
].sort();

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

export function hasEditorPreflightLocator(plan) {
  return Object.hasOwn(plan ?? {}, 'editorPreflightReceiptId') || Object.hasOwn(plan ?? {}, 'editorPreflightReceiptDigest');
}

function binding(manifest) {
  return {
    kind, schemaVersion: 1, repository: targets().repository, candidateSha: manifest.candidate.sha,
    sourceDigest: manifest.candidate.sourceDigest, controllerSha: manifest.controllerSha, baselineSha: manifest.previous.sha,
    sourceTreeHash: manifest.prerequisites.plan.salesforceSourceTreeHash,
    salesforceFingerprint: manifest.prerequisites.plan.salesforceFingerprint, caseSetDigest: editorDesktopCaseSetDigest,
  };
}

// The operator verifies privately retained case and provider evidence before
// publishing this compact attestation. Only digests and operational IDs leave that store.
export function createEditorPreflightAttestation({ manifest, proofInput, now = Date.now() }) {
  check(requiresDeveeDesktopCheckpoint(manifest), 'EDITOR_PREFLIGHT_LOCATOR_INVALID');
  const proof = verifyEditorPreflightEvidence({ ...proofInput, qualifiedAt: new Date(now).toISOString(), now });
  const expected = binding(manifest);
  check(proof.candidateSha === expected.candidateSha && proof.controllerSha === expected.controllerSha
    && proof.baselineSha === expected.baselineSha && proof.sourceTreeHash === expected.sourceTreeHash
    && proof.caseSetDigest === expected.caseSetDigest && isDigest(expected.sourceDigest)
    && isDigest(expected.salesforceFingerprint) && proofInput.expected.source.dependencyLockDigest === manifest.candidate.lockDigest,
  'EDITOR_PREFLIGHT_RELEASE_BINDING_INVALID');
  const { qualificationValidationJobId, qualificationDeploymentJobId, installedInventoryHash,
    cleanupEvidenceDigest, completedAt, expiresAt } = proof;
  const payload = { ...expected, evidenceDigest: proof.receiptDigest, qualificationValidationJobId,
    qualificationDeploymentJobId, installedInventoryHash, cleanupEvidenceDigest, completedAt, expiresAt };
  assertPublicPayload(payload);
  return payload;
}

export async function readEditorPreflightAttestation({ manifest, github, approvalAt, now = Date.now() }) {
  const plan = manifest.prerequisites?.plan;
  if (!requiresDeveeDesktopCheckpoint(manifest) && !hasEditorPreflightLocator(plan)) return null;
  const { editorPreflightReceiptId: id, editorPreflightReceiptDigest: proofDigest } = plan;
  check(requiresDeveeDesktopCheckpoint(manifest) && positive(id) && isDigest(proofDigest),
    'EDITOR_PREFLIGHT_LOCATOR_INVALID');
  const record = await github.read('/repos/' + targets().repository + '/deployments/' + id);
  return verifyEditorPreflightAttestation({ manifest, record, approvalAt, now });
}

export function verifyEditorPreflightAttestation({ manifest, record, approvalAt, now = Date.now() }) {
  const { editorPreflightReceiptId: id, editorPreflightReceiptDigest: proofDigest } = manifest.prerequisites.plan;
  check(requiresDeveeDesktopCheckpoint(manifest) && positive(id) && isDigest(proofDigest), 'EDITOR_PREFLIGHT_LOCATOR_INVALID');
  const repositoryPath = '/repos/' + targets().repository;
  const proof = record?.payload;
  const expected = binding(manifest);
  const created = Date.parse(record?.created_at);
  const completed = Date.parse(proof?.completedAt);
  const expires = Date.parse(proof?.expiresAt);
  check(record?.id === id && record.creator?.login === publication.requiredAccount
    && record.creator.id === publication.requiredAccountId && record.creator.type === 'User'
    && record.ref === expected.candidateSha && record.sha === expected.candidateSha
    && record.repository_url === 'https://api.github.com' + repositoryPath
    && record.environment === EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT && record.original_environment === record.environment
    && record.task === EDITOR_PREFLIGHT_ATTESTATION_TASK
    && record.production_environment === false && record.transient_environment === false
    && proof && digest(Object.keys(proof).sort()) === digest(fields) && digest(proof) === proofDigest
    && Object.entries(expected).every(([key, value]) => proof[key] === value)
    && [proof.evidenceDigest, proof.installedInventoryHash, proof.cleanupEvidenceDigest].every(isDigest)
    && jobId(proof.qualificationValidationJobId) && jobId(proof.qualificationDeploymentJobId)
    && proof.qualificationValidationJobId !== proof.qualificationDeploymentJobId
    && timestamp(proof.completedAt) && timestamp(proof.expiresAt)
    && completed <= created + 999 && created <= now && expires > now && expires - completed <= EDITOR_PREFLIGHT_MAX_AGE_MS,
  'EDITOR_PREFLIGHT_ATTESTATION_INVALID');
  check(approvalAt === undefined || (Date.parse(approvalAt) > created && Date.parse(approvalAt) <= now),
    'EDITOR_PREFLIGHT_QUALIFICATION_NOT_BEFORE_APPROVAL');
  return { ...proof, proofId: id, proofDigest };
}

export async function verifyEditorPreflightPostimage({ manifest, proof, reviewed, deployment, readInstalledInventory, now = Date.now() }) {
  check(proof && proof.candidateSha === manifest.candidate.sha && proof.controllerSha === manifest.controllerSha
    && proof.baselineSha === manifest.previous.sha && proof.caseSetDigest === editorDesktopCaseSetDigest
    && proof.proofId === manifest.prerequisites.plan.editorPreflightReceiptId
    && proof.proofDigest === manifest.prerequisites.plan.editorPreflightReceiptDigest
    && proof.salesforceFingerprint === reviewed.fingerprint && proof.sourceTreeHash === reviewed.binding.sourceTreeHash
    && Date.parse(proof.expiresAt) > now
    && deployment?.status === 'Succeeded' && deployment.orgId === devee.orgId && deployment.fingerprint === reviewed.fingerprint
    && jobId(deployment.jobId) && jobId(deployment.validationJobId) && deployment.jobId !== deployment.validationJobId
    && deployment.jobId !== proof.qualificationDeploymentJobId,
  'EDITOR_PREFLIGHT_PROMOTION_BINDING_INVALID');
  const installed = await readInstalledInventory();
  check(installed?.orgId === devee.orgId && installed.identity?.isSandbox === true && installed.identity.username === devee.username
    && installed.verificationMethod === 'metadata-api-reviewed-native-byte-inventory'
    && installed.inventoryHash === reviewed.nativeInventories?.devee?.final?.inventoryHash
    && installed.observedNativeInventoryHash === proof.installedInventoryHash && isDigest(installed.evidenceSha256)
    && timestamp(installed.verifiedAt) && Math.abs(Date.parse(installed.verifiedAt) - now) <= 300_000,
  'EDITOR_PREFLIGHT_DEVEE_POSTIMAGE_CHANGED');
  return { proofId: proof.proofId, proofDigest: proof.proofDigest, finalInventoryReceiptDigest: installed.evidenceSha256 };
}

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { decodePreviewCoordinationArchive } from './preview-email-coordination-archive.mjs';
import { decodeCoordinationBackendResultArchive } from './coordination-backend-result-archive.mjs';

// Protected material is deliberately outside the control digest: its immutable
// bytes are bound by the separately reviewed action and the signed grant.
export const PREVIEW_COORDINATION_ACTION_VARIABLE = 'FCOS_PREVIEW_EMAIL_COORDINATION_ACTION';
export const COORDINATION_BACKEND_REVIEW_PATH = '.github/compatibility-admission/04ee-coordination-backend-review.json';
export const COORDINATION_PROOF_SOURCE_FILES = Object.freeze([
  '.github/workflows/release-coordination-proof.yml', 'scripts/release-coordination-proof.mjs',
  'scripts/lib/release-coordination-proof-worker.mjs', 'scripts/release-coordinator-local.mjs',
  'scripts/lib/release-coordination.mjs', 'scripts/lib/release-coordination-trust.mjs',
  'scripts/lib/release-coordination-controls.mjs', 'scripts/lib/release-evidence.mjs',
  'scripts/lib/release-production.mjs', 'scripts/lib/release-readiness.mjs',
  'scripts/lib/preview-email-coordination.mjs', 'scripts/lib/preview-email-coordination-archive.mjs',
  'config/fcosConnections.js', 'config/fcosCiIdentity.js', 'package.json', 'package-lock.json',
]);
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const repository = fcosConnectionIdentifier('github', 'Repository');
const operator = fcosConnectionIdentifier('github', 'Required account');
const need = value => { if (!value) throw new Error('Exact coordination action and actual closed backend proof required.'); };
const verifiedProofs = new WeakMap();
const backendStableFiles = ['.github/workflows/release-coordination-proof.yml', 'scripts/release-coordination-proof.mjs',
  'scripts/lib/release-coordination-proof-worker.mjs', 'scripts/lib/preview-email-coordination-archive.mjs', 'package-lock.json'];
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function rawRecord(raw, limit = 262144) {
  need(typeof raw === 'string' && Buffer.byteLength(raw) > 0 && Buffer.byteLength(raw) <= limit);
  const value = JSON.parse(raw); need(value && typeof value === 'object' && !Array.isArray(value));
  return { value, text: raw, sha256: digest(Buffer.from(raw)) };
}
function file(record, path) {
  need(record?.type === 'file' && record.path === path && record.encoding === 'base64' && sha(record.sha));
  const bytes = Buffer.from(record.content, 'base64'); need(bytes.length <= 262144
    && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === record.sha);
  return rawRecord(bytes.toString('utf8'));
}
/** Public codec only. An accepted DTO never creates a live capability. */
export function assertCoordinationBackendReview(raw) {
  const record = rawRecord(raw), r = record.value;
  need(r.schemaVersion === 1 && r.kind === 'fcos_exact_04ee_closed_backend_review' && r.accepted === true
    && r.grantsActivation === false && r.privateSigningAuthority === false && r.productionDeploymentAuthority === false);
  const acceptance = rawRecord(r.acceptanceText), closure = rawRecord(r.closureText), a = acceptance.value, c = closure.value;
  need(a.kind === 'root_accepted_actual_pr105_artifact_backend_proof_v1' && a.accepted === true
    && c.kind === 'root_reviewed_actual_pr105_artifact_backend_proof_operation_closure_v1' && c.accepted === true
    && c.actualBackendAcceptance?.sha256 === acceptance.sha256 && equal(a.binding, c.binding)
    && a.binding.repository === repository && sha(a.binding.harnessSha) && positive(a.binding.runId) && positive(a.binding.jobId)
    && c.operationConsumed === true && c.replayPermitted === false && c.backendProofPrerequisiteComplete === true
    && c.previewActivationAuthority === false && c.privateSigningAuthority === false && c.productionDeploymentAuthority === false
    && a.actualPersonalReviewVerified === true && a.concurrencyOneWinnerOneRefusal === true && a.duplicateRefused === true
    && a.crashGetOnlyRecovered === true && a.immutableReadbackVerified === true && a.archiveDigestsMatchedActualProviderMetadata === true
    && a.backendActivationAuthority === false && a.privateSigningAuthority === false && a.productionDeploymentAuthority === false
    && Object.values(c.materialAcceptance || {}).length === 8 && Object.values(c.materialAcceptance).every(value => value === true)
    && equal(c.lease, a.actualReport?.rootAction?.lease)
    && c.originalActionPublication?.sha256 === a.actionPublication?.sha256
    && c.actualTerminalBoundary?.sha256 === a.terminalBoundary?.sha256
    && c.lease.operationId === `fcos-release-coordination-proof-${a.binding.runId}`
    && c.lease.bindingSha256 === digest(JSON.stringify(a.binding)) && c.lease.providerAuthorityGranted === false
    && c.lease.coordinationOnly === true && c.lease.uncertainOutcomeRequiresReadback === true
    && a.actualReport.rootAction.authorizedBy === operator && hash(a.actualReport.rootAction.actionAuthorizationSha256)
    && a.actualReport.rootAction.authorizedAt <= Date.parse(a.actualReport.capturedAt)
    && Date.parse(a.actualReport.capturedAt) <= Date.parse(a.originalDeadline)
    && Date.parse(a.actualReport.capturedAt) <= Date.parse(a.at) && Date.parse(a.at) <= Date.parse(c.at));
  need(Array.isArray(r.sources) && r.sources.length === COORDINATION_PROOF_SOURCE_FILES.length
    && new Set(r.sources.map(row => row.path)).size === r.sources.length
    && COORDINATION_PROOF_SOURCE_FILES.every(path => r.sources.some(row => row.path === path && hash(row.sha256)
      && ['100644', '100755'].includes(row.mode))));
  return freeze({ ...record, acceptance, closure });
}
/** Exact original operation action. Pure comparison only; the fixed collector
 * obtains this from the protected environment and also requires the real key. */
export function assertPreviewCoordinationAction(raw, binding, backendReviewSha256, now = Date.now()) {
  const record = rawRecord(raw, 65536), a = record.value;
  need(a.schemaVersion === 1 && a.kind === 'root_admitted_preview_coordination_action' && a.action === 'issue-preview-coordination'
    && a.purpose === 'FCOS-EXACT-04EE-COORDINATION-GRANT-V1\0' && a.authorizedBy === operator
    && a.target?.repository === repository && a.target.environment === 'fcos-runtime-compatibility-release'
    && a.target.workflow === '.github/workflows/preview-email-proof-build.yml'
    && a.target.projectId === fcosConnectionIdentifier('vercel', 'Project ID') && a.target.teamId === fcosConnectionIdentifier('vercel', 'Team ID')
    && hash(a.scriptSha256) && hash(a.actionAuthorizationEvidenceSha256) && hash(a.implementationAuthoritySha256)
    && positive(a.authorizedAt) && a.authorizedAt <= now && now - a.authorizedAt < 600000
    && positive(a.privateReadinessAt) && a.privateReadinessAt <= a.authorizedAt && now - a.privateReadinessAt < 2700000
    && a.backendReviewSha256 === backendReviewSha256 && hash(backendReviewSha256)
    && a.privateReadinessAt >= Math.max(binding.issuanceObservedAt, Date.parse(binding.intentAt))
    && equal(a.binding, binding) && a.previewOnly === true && a.productionAuthorized === false
    && a.authorityBasis?.localReviewGrantsAuthority === false && a.authorityBasis.kind === 'existing_direct_human_authorization'
    && Array.isArray(a.authorityBasis.citations) && a.authorityBasis.citations.length > 0
    && hash(a.rootReview?.sha256) && hash(a.independentReview?.sha256) && a.rootReview.sha256 !== a.independentReview.sha256);
  return freeze(record);
}
/** Byte comparison only. The hosted collector supplies actual fixed GETs;
 * caller rows can validate data here but can never create a capability. */
export function assertPreviewCoordinationPublicationCurrent({ action, grant }, { actionText, envelopeText }) {
  need(action?.name === PREVIEW_COORDINATION_ACTION_VARIABLE && grant?.name === 'FCOS_PREVIEW_EMAIL_COORDINATION_GRANT'
    && typeof actionText === 'string' && typeof envelopeText === 'string'
    && action.value === actionText && grant.value === envelopeText);
  return true;
}
/** Fixed caller supplies only its authenticated GET transport. This returns
 * data; neither this helper nor any injectable fixture brands a capability. */
export async function collectCoordinationBackendProof(reads, harnessSha) {
  need(sha(harnessSha)); const base = `repos/${repository}`;
  // Cache only within this authenticated transport identity. Injectable pure
  // fixture reads can never populate a production collector's cache.
  const cache = verifiedProofs.get(reads);
  if (cache?.harnessSha === harnessSha) {
    for (const row of cache.stableSources) need(digest(readFileSync(new URL(`../../${row.path}`, import.meta.url))) === row.sha256);
    return cache.proof;
  }
  const review = assertCoordinationBackendReview(file(await reads.json(`${base}/contents/${COORDINATION_BACKEND_REVIEW_PATH}?ref=${harnessSha}`), COORDINATION_BACKEND_REVIEW_PATH).text);
  const { binding, actualReport } = review.acceptance.value;
  const stableSources = review.value.sources.filter(row => backendStableFiles.includes(row.path));
  for (const row of stableSources) need(digest(readFileSync(new URL(`../../${row.path}`, import.meta.url))) === row.sha256);
  const tree = await reads.json(`${base}/git/trees/${binding.harnessSha}?recursive=1`);
  need(tree.truncated === false && Array.isArray(tree.tree));
  for (const row of review.value.sources) {
    const entries = tree.tree.filter(entry => entry.path === row.path);
    need(entries.length === 1 && entries[0].mode === row.mode && entries[0].type === 'blob');
    const remote = await reads.json(`${base}/contents/${row.path}?ref=${binding.harnessSha}`);
    need(remote?.type === 'file' && remote.path === row.path && remote.encoding === 'base64' && sha(remote.sha));
    const bytes = Buffer.from(remote.content, 'base64'); need(bytes.length <= 16 * 1024 * 1024 && digest(bytes) === row.sha256
      && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === remote.sha && remote.sha === entries[0].sha);
  }
  const run = await reads.json(`${base}/actions/runs/${binding.runId}`);
  need(run.id === binding.runId && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'success'
    && run.event === 'workflow_dispatch' && run.head_sha === binding.harnessSha && run.head_branch === 'main'
    && run.repository?.full_name === repository && run.head_repository?.full_name === repository
    && ['.github/workflows/release-coordination-proof.yml', '.github/workflows/release-coordination-proof.yml@main'].includes(run.path)
    && [run.actor, run.triggering_actor].every(actor => actor?.login === operator && positive(actor.id)));
  const job = await reads.json(`${base}/actions/jobs/${binding.jobId}`);
  need(job.id === binding.jobId && job.run_id === binding.runId && job.run_attempt === 1 && job.head_sha === binding.harnessSha
    && job.name === 'proof' && job.status === 'completed' && job.conclusion === 'success'
    && Date.parse(actualReport.capturedAt) >= Date.parse(job.started_at) && Date.parse(actualReport.capturedAt) <= Date.parse(job.completed_at)
    && Date.parse(review.acceptance.value.originalDeadline) === Math.min(Date.parse(run.run_started_at), Date.parse(job.started_at)) + 1800000);
  const approvals = await reads.json(`${base}/actions/runs/${binding.runId}/approvals`);
  need(Array.isArray(approvals) && approvals.filter(a => a.state === 'approved' && a.user?.id === run.actor.id
    && a.user.login === operator && a.environments?.some(e => e.name === 'fcos-production-release')).length === 1);
  const observed = {};
  for (const phase of ['concurrent', 'crash', 'result']) {
    const name = `fcos-coordination-proof-${phase}-${binding.runId}`, expected = review.acceptance.value.archives?.[name];
    need(positive(expected?.metadata?.id) && hash(expected.archive?.sha256));
    const artifact = await reads.json(`${base}/actions/artifacts/${expected.metadata.id}`);
    need(artifact.id === expected.metadata.id && artifact.name === name && artifact.expired === false
      && artifact.workflow_run?.id === binding.runId && artifact.workflow_run.head_sha === binding.harnessSha
      && artifact.digest === `sha256:${expected.archive.sha256}` && artifact.created_at === expected.metadata.created_at);
    const archive = await reads.archive(`${base}/actions/artifacts/${artifact.id}/zip`); need(digest(archive) === expected.archive.sha256);
    observed[phase] = phase === 'result' ? decodeCoordinationBackendResultArchive(archive, binding.runId) : decodePreviewCoordinationArchive(archive);
  }
  need(equal(observed.result, actualReport) && equal(actualReport.binding, binding) && equal(actualReport.rootAction?.binding, binding)
    && actualReport.concurrency === 'one-winner-one-refusal' && actualReport.duplicate === 'refused'
    && actualReport.uncertainChildOutcome === 'GET-only-recovered' && actualReport.immutableReadback === true
    && actualReport.grantsActivation === false && actualReport.deploymentAuthority === false
    && ['concurrent', 'crash'].every(phase => observed[phase].kind === 'fcos_artifact_backend_exclusivity_probe'
      && equal(observed[phase].binding, binding) && observed[phase].marker === (phase === 'crash' ? 'crash' : actualReport.artifacts[0].marker)));
  const proof = freeze({ reviewSha256: review.sha256, acceptanceSha256: review.acceptance.sha256, closureSha256: review.closure.sha256,
    originalProofBinding: binding, originalActionSha256: digest(JSON.stringify(actualReport.rootAction)), observed: true });
  verifiedProofs.set(reads, { harnessSha, proof, stableSources }); return proof;
}

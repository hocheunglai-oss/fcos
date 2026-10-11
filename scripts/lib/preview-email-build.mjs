import { ENROLLED_AUTHORITY_MODE, ENROLLED_AUTHORITY_MODE_VARIABLE, ENROLLED_AUTHORITY_ENABLE, ENROLLED_AUTHORITY_RECEIPT, ENROLLED_AUTHORITY_SECRET,
  verifyEnrollmentReceipt, enrolledAuthorityContext } from './preview-vercel-enrollment.mjs';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { assertProtectedDefault, RELEASE_REPOSITORY, readEvidenceArchive } from './release-evidence.mjs';
import { RELEASE_MAX_AGE_MS } from './release-readiness.mjs';
import { canonicalFcosE2eCandidateUrl } from '../verify-e2e-candidate.mjs';
import { PREVIEW_EMAIL_BUILD_CONTROL_FILES } from './preview-email-build-controls.mjs';
import { githubProviderFresh, githubProviderTimestamp } from './github-provider-timestamp.mjs';
import { SUCCESSOR_LIVE_CONTRACT, successorLiveSelection, successorEmailContract, successorLiveBinding,
  successorLiveControlBinding, successorLiveRemoteControls } from './runtime-compatibility-successor-live.mjs';
export { PREVIEW_EMAIL_BUILD_CONTROL_FILES } from './preview-email-build-controls.mjs';

export const PREVIEW_EMAIL_BUILD_WORKFLOW = '.github/workflows/preview-email-proof-build.yml';
export const PREVIEW_EMAIL_BUILD_ENVIRONMENT = 'fcos-runtime-compatibility-release';
export const PREVIEW_EMAIL_BUILD_ENABLE = 'FCOS_PREVIEW_EMAIL_BUILD_ENABLED';
export const PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLE = 'FCOS_PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLED';
export const PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_FILENAME = 'fcos-preview-vercel-authority-probe.json';
export const PREVIEW_EMAIL_INTENT_FILENAME = 'fcos-preview-email-intent.json';
export const PREVIEW_EMAIL_BUILD_FILENAME = 'fcos-preview-email-build.json';
const contractBytes = readFileSync(new URL('../../config/legacy-email-baseline-proof.json', import.meta.url));
const contract = JSON.parse(contractBytes);
const digest = value => createHash('sha256').update(value).digest('hex');
export const PREVIEW_EMAIL_CONTRACT_SHA256 = digest(contractBytes);
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const positive = value => Number.isSafeInteger(value) && value > 0;
const fresh = (value, now) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 30000 && now - Date.parse(value) <= RELEASE_MAX_AGE_MS;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const trustedIntentRecords = new WeakSet();
const freezeRecord = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freezeRecord); Object.freeze(value); } return value; };
const projectId = fcosConnectionIdentifier('vercel', 'Project ID');
const teamId = fcosConnectionIdentifier('vercel', 'Team ID');
const operator = fcosConnectionIdentifier('github', 'Required account');
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const operation = value => new RegExp(`^fcos-preview-email-[1-9][0-9]*-${uuid}$`).test(value || '');
const failure = message => { throw new Error(message); };
const immutable = value => { try { return canonicalFcosE2eCandidateUrl(value) === value; } catch { return false; } };

export function previewEmailBuildContract(candidateSha, { admission, now = Date.now() } = {}) {
  return candidateSha === SUCCESSOR_LIVE_CONTRACT.candidateSha ? successorEmailContract(admission, now)
    : { contract, contractSha256: PREVIEW_EMAIL_CONTRACT_SHA256 };
}

export function previewEmailBuildCandidate(candidateSha, { admission, now = Date.now() } = {}) {
  if (candidateSha === SUCCESSOR_LIVE_CONTRACT.candidateSha) return structuredClone(successorLiveSelection(admission, candidateSha, now).candidate);
  const rows = contract.preview?.candidates?.filter(row => row.sha === candidateSha) || [];
  if (contract.schemaVersion !== 1 || rows.length !== 1 || !sha(candidateSha)
    || !hash(rows[0].sourceDigest) || !hash(rows[0].lockHash)) failure('An exact reviewed Preview email candidate is required.');
  return structuredClone(rows[0]);
}

export function previewEmailBuildControlRevision(cwd, { admission, sourceCwd, now = Date.now() } = {}) {
  if (admission !== undefined) {
    const selected = successorLiveSelection(admission, SUCCESSOR_LIVE_CONTRACT.candidateSha, now);
    const controls = successorLiveControlBinding({ trustedCwd: cwd, sourceCwd });
    successorLiveBinding(selected, { sha: selected.candidate.sha, ...controls }, now);
    return controls.previewControlRevision;
  }
  return digest(`fcos-preview-email-build-controls-v1\0${JSON.stringify(PREVIEW_EMAIL_BUILD_CONTROL_FILES.map(file => {
    if (!lstatSync(join(cwd, file)).isFile()) failure('Preview build controls must be regular reviewed files.');
    return [file, digest(readFileSync(join(cwd, file)))];
  }))}`);
}
async function remoteControlRevision(reads, harnessSha, { admission, now = Date.now() } = {}) {
  if (admission !== undefined) {
    const selected = successorLiveSelection(admission, SUCCESSOR_LIVE_CONTRACT.candidateSha, now);
    if (selected.harnessSha !== harnessSha) failure('Successor controls must use their actual protected harness.');
    return successorLiveRemoteControls({ reads, admission: selected, now });
  }
  const rows = [];
  for (const file of PREVIEW_EMAIL_BUILD_CONTROL_FILES) {
    const value = await reads.json(`repos/${RELEASE_REPOSITORY}/contents/${file}?ref=${harnessSha}`);
    if (value?.type !== 'file' || value.encoding !== 'base64' || typeof value.content !== 'string') failure('Protected Preview build source is unavailable.');
    const bytes = Buffer.from(value.content, 'base64');
    if (file === 'config/legacy-email-baseline-proof.json' && digest(bytes) !== PREVIEW_EMAIL_CONTRACT_SHA256) failure('The current protected contract differs from this collector.');
    rows.push([file, digest(bytes)]);
  }
  return digest(`fcos-preview-email-build-controls-v1\0${JSON.stringify(rows)}`);
}

/** No target, clone, files, environment or build settings are accepted. Vercel's
 * Git-source POST defaults to Preview and uses only its project configuration. */
export function createPreviewEmailBuildRequest({ candidateSha, runId, operationId, admission, now = Date.now() } = {}) {
  const candidate = previewEmailBuildCandidate(candidateSha, { admission, now });
  if (!positive(runId) || !operation(operationId) || !operationId.startsWith(`fcos-preview-email-${runId}-`)) failure('Preview operation identity is invalid.');
  const [org, repo] = RELEASE_REPOSITORY.split('/');
  return { name: fcosConnectionIdentifier('vercel', 'Project'), project: projectId,
    gitSource: { type: 'github', org, repo, ref: candidate.branch, sha: candidate.sha },
    meta: { fcosPreviewEmailBuildOperation: operationId } };
}

function assertRecordSnapshot(snapshot, now) {
  if (!exact(snapshot, ['capturedAt', 'projectId', 'teamId', 'complete', 'records']) || !fresh(snapshot.capturedAt, now)
    || snapshot.projectId !== projectId || snapshot.teamId !== teamId || snapshot.complete !== true
    || !Array.isArray(snapshot.records) || snapshot.records.length > 10000) failure('Complete fresh pinned environment metadata is required.');
  const ids = new Set();
  for (const row of snapshot.records) {
    if (!exact(row, ['id', 'key', 'type', 'target', 'gitBranch', 'createdAt', 'updatedAt', 'comment'])
      || !/^[A-Za-z0-9_-]{1,200}$/.test(row.id || '') || ids.has(row.id) || !/^[A-Za-z_][A-Za-z0-9_]{0,200}$/.test(row.key || '')
      || !['plain', 'encrypted', 'sensitive', 'system'].includes(row.type) || !Array.isArray(row.target) || !row.target.length
      || new Set(row.target).size !== row.target.length || row.target.some(value => !['production', 'preview', 'development'].includes(value))
      || row.gitBranch !== null && (typeof row.gitBranch !== 'string' || !row.gitBranch || row.gitBranch.length > 250)
      || !positive(row.createdAt) || !positive(row.updatedAt) || row.updatedAt < row.createdAt || row.updatedAt > now + 30000
      || row.comment !== null && (typeof row.comment !== 'string' || row.comment.length > 1000)) failure('Environment metadata is incomplete, duplicated or not redacted.');
    ids.add(row.id);
  }
  return snapshot;
}
function assertSelectedRecords(snapshot, candidate, createdAt, now, admission) {
  const { contract: selectedContract } = previewEmailBuildContract(candidate.sha, { admission, now });
  assertRecordSnapshot(snapshot, now);
  const keys = { FCOS_MICROSOFT_TENANT_ID: candidate.tenantRecordId, FCOS_MICROSOFT_CLIENT_ID: candidate.clientRecordId,
    FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET: candidate.attachmentRecordId };
  for (const [key, id] of Object.entries(keys)) {
    const rows = snapshot.records.filter(row => row.key === key && row.gitBranch === candidate.branch && row.target.includes('preview'));
    const row = rows.length === 1 ? rows[0] : null;
    if (!row || row.id !== id || row.target.length !== 1 || row.target[0] !== 'preview' || row.updatedAt > createdAt
      || row.type !== (key === 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET' ? 'sensitive' : 'plain')) failure('Exact branch-specific Preview record selection is unverified.');
    if (key === 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET' && row.comment !== `Dedicated read-only Preview signing key ${selectedContract.preview.attachmentOperationId}; no Production credential copied`) failure('Independent Preview signing record provenance is unverified.');
  }
  for (const [key, pin] of Object.entries(contract.baseline.records)) {
    const rows = snapshot.records.filter(row => row.key === key && row.target.includes('production'));
    const row = rows.length === 1 ? rows[0] : null;
    if (!row || row.id !== pin.id || row.type !== 'sensitive' || row.gitBranch !== null || row.target.length !== 1
      || row.createdAt !== pin.createdAt || row.updatedAt !== pin.updatedAt) failure('Retained Production email record continuity changed.');
  }
}

/** The supplied adapter must already be authenticated and target locked. This
 * function never returns provider values, and refuses truncated/unknown paging. */
export async function collectPreviewEmailEnvironmentRecords({ api, now = Date.now() } = {}) {
  if (typeof api !== 'function') failure('A verified pinned provider GET adapter is required.');
  const records = [], cursors = new Set();
  let cursor = null;
  for (let page = 0; page < 100; page++) {
    const value = await api(`/v9/projects/${projectId}/env?decrypt=false${cursor === null ? '' : `&until=${encodeURIComponent(cursor)}`}`);
    if (!Array.isArray(value?.envs) || value.envs.length > 10000 || value.truncated === true || value.hasMore === true && !value.pagination?.next
      || value.projectId && value.projectId !== projectId || value.teamId && value.teamId !== teamId) failure('Environment pagination or provider target is unverified.');
    for (const row of value.envs) {
      if (row.projectId && row.projectId !== projectId || row.teamId && row.teamId !== teamId || row.customEnvironmentIds?.length) failure('Environment metadata belongs to an unexpected target.');
      records.push({ id: row.id, key: row.key, type: row.type, target: Array.isArray(row.target) ? [...row.target].sort() : row.target,
        gitBranch: row.gitBranch ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt, comment: row.comment ?? null });
    }
    const pagination = value.pagination;
    if (pagination && (!exact(pagination, ['count', 'next', 'prev']) || !Number.isSafeInteger(pagination.count) || pagination.count !== value.envs.length)) failure('Unrecognized environment pagination cannot establish completeness.');
    const next = pagination?.next;
    if (next === undefined || next === null) {
      const snapshot = { capturedAt: new Date(now).toISOString(), projectId, teamId, complete: true, records: records.sort((a, b) => String(a.id).localeCompare(String(b.id))) };
      return assertRecordSnapshot(snapshot, now);
    }
    if (!positive(next) || cursors.has(next) || !value.envs.length) failure('Environment pagination cursor is invalid or repeated.');
    cursors.add(next); cursor = next;
  }
  failure('Environment pagination did not complete within the bounded scan.');
}

function assertIntent(intent, now, admission, purpose = 'original_operation') {
  const { contractSha256 } = previewEmailBuildContract(intent?.candidate?.sha, { admission, now });
  if (!exact(intent, ['schemaVersion', 'kind', 'candidate', 'harnessSha', 'contractSha256', 'controlRevision', 'operationId', 'runId', 'request', 'requestSha256', 'intentAt', 'environmentRecords'])
    || intent.schemaVersion !== 1 || intent.kind !== 'fcos_preview_email_intent' || !sha(intent.harnessSha)
    || intent.contractSha256 !== contractSha256 || !hash(intent.controlRevision) || !positive(intent.runId)
    || !fresh(intent.intentAt, now)) failure('Trusted durable Preview intent is invalid or stale.');
  const selected = previewEmailBuildCandidate(intent.candidate?.sha, { admission, now });
  if (selected.sha === SUCCESSOR_LIVE_CONTRACT.candidateSha) {
    const live = successorLiveBinding(admission,
      { ...intent.candidate, harnessSha: intent.harnessSha, previewControlRevision: intent.controlRevision }, now);
    // Downstream receipt validation is data-only and still requires genuine
    // archived build/signer/normal proof. Every original intent/execution path
    // instead binds this same original first Preview run and dispatch.
    if (purpose !== 'downstream_receipt' && (live.runId !== intent.runId || live.runAttempt !== 1
      || live.workflow !== PREVIEW_EMAIL_BUILD_WORKFLOW || Date.parse(intent.intentAt) < Date.parse(live.dispatchedAt))) {
      failure('Successor intent must use its own original first Preview admission.');
    }
  }
  if (!exact(intent.candidate, ['sha', 'branch', 'sourceDigest', 'lockHash'])
    || !equal(intent.candidate, { sha: selected.sha, branch: selected.branch, sourceDigest: selected.sourceDigest, lockHash: selected.lockHash })
    || !equal(intent.request, createPreviewEmailBuildRequest({ candidateSha: selected.sha, runId: intent.runId, operationId: intent.operationId, admission, now }))
    || intent.requestSha256 !== digest(JSON.stringify(intent.request))) failure('Preview request has an override or differs from the immutable contract.');
  assertSelectedRecords(intent.environmentRecords, selected, Date.parse(intent.intentAt), now, admission);
  return selected;
}
export function createPreviewEmailBuildIntent({ candidateSha, harnessSha, controlRevision, runId, operationId, records, admission, now = Date.now() } = {}) {
  const selected = previewEmailBuildCandidate(candidateSha, { admission, now });
  const { contractSha256 } = previewEmailBuildContract(candidateSha, { admission, now });
  if (candidateSha === SUCCESSOR_LIVE_CONTRACT.candidateSha) {
    const live = successorLiveSelection(admission, candidateSha, now);
    if (live.workflow !== PREVIEW_EMAIL_BUILD_WORKFLOW || live.runId !== runId) failure('Initial successor intent requires its actual first Preview dispatch.');
  }
  const request = createPreviewEmailBuildRequest({ candidateSha, runId, operationId, admission, now });
  const intent = { schemaVersion: 1, kind: 'fcos_preview_email_intent',
    candidate: { sha: selected.sha, branch: selected.branch, sourceDigest: selected.sourceDigest, lockHash: selected.lockHash },
    harnessSha, contractSha256, controlRevision, operationId, runId,
    request, requestSha256: digest(JSON.stringify(request)), intentAt: new Date(now).toISOString(), environmentRecords: records };
  assertIntent(intent, now, admission); return intent;
}

export function assertPreviewEmailBuildReceipt({ receipt, binding, records, admission, now = Date.now() } = {}) {
  if (!exact(receipt, ['schemaVersion', 'kind', 'candidate', 'harnessSha', 'contractSha256', 'controlRevision', 'operationId', 'runId', 'request', 'requestSha256', 'intentAt', 'capturedAt', 'deployment', 'environmentRecords'])
    || receipt.kind !== 'fcos_preview_email_build' || !fresh(receipt.capturedAt, now)
    || Date.parse(receipt.capturedAt) < Date.parse(receipt.intentAt)) failure('Preview build receipt is invalid or stale.');
  const { capturedAt: _capturedAt, deployment, ...intent } = receipt;
  intent.kind = 'fcos_preview_email_intent';
  const selected = assertIntent(intent, now, admission, 'downstream_receipt');
  if (!exact(deployment, ['id', 'url', 'sha', 'target', 'state', 'createdAt', 'projectId', 'teamId', 'operationId'])
    || !/^dpl_[A-Za-z0-9]+$/.test(deployment.id || '')
    || !immutable(deployment.url)
    || deployment.sha !== selected.sha || deployment.target !== 'preview' || deployment.state !== 'READY'
    || deployment.projectId !== projectId || deployment.teamId !== teamId || deployment.operationId !== receipt.operationId
    || !positive(deployment.createdAt) || deployment.createdAt < Date.parse(receipt.intentAt)
    || deployment.createdAt > Date.parse(receipt.capturedAt) || deployment.id === contract.baseline.deploymentId
    || binding?.sha !== selected.sha || binding.sourceDigest !== selected.sourceDigest || binding.lockHash !== selected.lockHash
    || binding.harnessSha !== receipt.harnessSha || binding.deploymentId !== deployment.id || binding.candidateUrl !== deployment.url) failure('Preview build receipt does not bind the exact deployment and reviewed source.');
  assertSelectedRecords(records, selected, deployment.createdAt, now, admission);
  if (!equal(receipt.environmentRecords.records, records.records)) failure('Preview or Production configuration changed since the durable intent.');
  return true;
}

function assertEnvironmentReview({ environment, run, jobs, approvals, trusted, candidateSha, completed, now }) {
  const rules = environment?.protection_rules?.filter(row => row.type === 'required_reviewers') || [];
  const rule = rules.length === 1 ? rules[0] : null, reviewer = rule?.reviewers?.length === 1 ? rule.reviewers[0] : null;
  if (FCOS_RELEASE_APPROVAL_POLICY.mode !== 'single_operator' || environment?.name !== PREVIEW_EMAIL_BUILD_ENVIRONMENT || !positive(environment.id)
    || environment.can_admins_bypass !== false || rule?.prevent_self_review !== false || reviewer?.type !== 'User'
    || reviewer.reviewer?.login !== operator || !positive(reviewer.reviewer.id)
    || environment.deployment_branch_policy?.protected_branches !== true || environment.deployment_branch_policy?.custom_branch_policies !== false) failure('Preview build requires its existing non-bypassable human-review environment.');
  if (run?.repository?.full_name !== RELEASE_REPOSITORY || run.head_repository?.full_name !== RELEASE_REPOSITORY
    || run.head_branch !== trusted.branch || run.head_sha !== trusted.sha || run.event !== 'workflow_dispatch' || run.run_attempt !== 1
    || ![PREVIEW_EMAIL_BUILD_WORKFLOW, `${PREVIEW_EMAIL_BUILD_WORKFLOW}@${trusted.branch}`].includes(run.path)
    || !positive(run.id) || !githubProviderTimestamp(run.run_started_at) || Date.parse(run.run_started_at) > now + 30000
    || run.name !== 'FCOS protected Preview email proof build' || run.display_title !== `Review FCOS Preview email source ${candidateSha}`
    || run.actor?.login !== operator || run.triggering_actor?.login !== operator
    || run.actor?.id !== reviewer.reviewer.id || run.triggering_actor?.id !== reviewer.reviewer.id
    || (completed === 'intent' ? !['in_progress', 'completed'].includes(run.status)
      : completed ? run.status !== 'completed' || run.conclusion !== 'success' : run.status !== 'in_progress')) failure('The exact first protected workflow run is required.');
  const reviews = (Array.isArray(approvals) ? approvals : []).filter(row => row.environments?.some(env => env.id === environment.id && env.name === environment.name));
  if (reviews.length !== 1 || reviews[0].state !== 'approved' || reviews[0].user?.login !== operator || reviews[0].user?.id !== reviewer.reviewer.id) failure('One exact human environment approval is required.');
  // Environment approval can leave a workflow queued for hours. Only the exact
  // first-attempt, environment-gated proof job start establishes execution age.
  // An archive upload or a workflow updated_at cannot rejuvenate that job.
  const job = Array.isArray(jobs) && jobs.length === 1 ? jobs[0] : null;
  const jobCompleted = job?.status === 'completed';
  if (!positive(job?.id) || job.run_id !== run.id || job.run_attempt !== 1 || job.name !== 'proof'
    || job.workflow_name !== 'FCOS protected Preview email proof build'
    || job.head_sha !== trusted.sha || job.head_branch !== trusted.branch || !githubProviderFresh(job.started_at, RELEASE_MAX_AGE_MS, now)
    || Date.parse(job.started_at) < Date.parse(run.run_started_at)
    || (completed === 'intent' ? !['in_progress', 'completed'].includes(job.status)
      : completed ? !jobCompleted || job.conclusion !== 'success' : job.status !== 'in_progress')
    || jobCompleted && (!githubProviderTimestamp(job.completed_at) || Date.parse(job.completed_at) < Date.parse(job.started_at)
      || Date.parse(job.completed_at) > now + 30000
      || !['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'startup_failure'].includes(job.conclusion))
    || !jobCompleted && (job.conclusion !== null || job.completed_at !== null)) failure('The exact fresh first-attempt approved proof job is required.');
  return { reviewerId: reviewer.reviewer.id, runId: run.id, environmentId: environment.id };
}

function previewEmailProtectionData({ repository, branch, protection, environment, variables, secrets, run, jobs, approvals, oidcClaims, candidateSha, harnessSha, controlRevision, admission, mode = 'build', now = Date.now() } = {}, receiptRequired = true) {
  if (!['build', 'diagnose-authority', 'verify-authority'].includes(mode)) failure('Unknown protected Preview operation.');
  const trusted = assertProtectedDefault(repository, branch, protection);
  previewEmailBuildCandidate(candidateSha, { admission, now });
  const { contractSha256 } = previewEmailBuildContract(candidateSha, { admission, now });
  if (candidateSha === SUCCESSOR_LIVE_CONTRACT.candidateSha) {
    const selected = successorLiveBinding(admission, { sha: candidateSha, harnessSha, previewControlRevision: controlRevision }, now);
    if (selected.runId !== run?.id || selected.workflow !== PREVIEW_EMAIL_BUILD_WORKFLOW) failure('Protected successor review must use this admission dispatch.');
  }
  const approved = assertEnvironmentReview({ environment, run, jobs, approvals, trusted, candidateSha, completed: false, now });
  const readOnlyAuthority = ['diagnose-authority', 'verify-authority'].includes(mode);
  const pins = { [PREVIEW_EMAIL_BUILD_ENABLE]: readOnlyAuthority ? 'false' : 'true',
    ...(readOnlyAuthority ? { [PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLE]: 'true' } : {}),
    FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED: 'false',
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_SHA: candidateSha, FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_HARNESS_SHA: harnessSha,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTRACT_SHA256: contractSha256,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTROL_SHA256: controlRevision };
  for (const [name, value] of Object.entries(pins)) {
    const rows = variables?.variables?.filter(row => row.name === name) || [];
    if (rows.length !== 1 || rows[0].value !== value) failure('Preview build activation and exact source/control pins are unavailable.');
  }
  const tokenIds = variables?.variables?.filter(row => row.name === 'FCOS_RELEASE_VERCEL_TOKEN_ID') || [];
  if (tokenIds.length !== 1 || !/^[A-Za-z0-9_-]{1,200}$/.test(tokenIds[0].value || '') || harnessSha !== trusted.sha || !hash(controlRevision)) failure('A reviewed scoped provider credential and current protected harness are required.');
  for (const name of ['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN']) {
    if (secrets?.secrets?.filter(row => row.name === name).length !== 1) failure('Dedicated existing protected credentials are unavailable.');
  }
  if (oidcClaims?.iss !== 'https://token.actions.githubusercontent.com' || oidcClaims.aud !== 'fcos-production-release'
    || oidcClaims.repository !== RELEASE_REPOSITORY || oidcClaims.repository_id !== String(repository.id)
    || oidcClaims.sub !== `repo:${RELEASE_REPOSITORY}:environment:${PREVIEW_EMAIL_BUILD_ENVIRONMENT}`
    || oidcClaims.workflow_ref !== `${RELEASE_REPOSITORY}/${PREVIEW_EMAIL_BUILD_WORKFLOW}@refs/heads/${trusted.branch}`
    || oidcClaims.workflow_sha !== trusted.sha || oidcClaims.sha !== trusted.sha || oidcClaims.ref !== `refs/heads/${trusted.branch}`
    || oidcClaims.run_id !== String(run.id) || oidcClaims.run_attempt !== '1' || oidcClaims.event_name !== 'workflow_dispatch'
    || !Number.isFinite(oidcClaims.exp) || oidcClaims.exp * 1000 <= now) failure('Signed Actions identity does not authorize this exact Preview workflow.');
  const oneVariable = name => { const rows = variables?.variables?.filter(row => row.name === name) || [];
    if (rows.length > 1) failure('Duplicate enrolled authority controls.'); return rows[0]?.value; };
  const selected = oneVariable(ENROLLED_AUTHORITY_MODE_VARIABLE);
  if (selected !== undefined && !['legacy-current-v1', ENROLLED_AUTHORITY_MODE].includes(selected)) failure('Unknown Preview authority mode.');
  const authorityMode = selected || 'legacy-current-v1';
  if (candidateSha === SUCCESSOR_LIVE_CONTRACT.candidateSha && authorityMode !== ENROLLED_AUTHORITY_MODE) failure('Exact successor Preview requires signed issuance-bound authority.');
  let enrollmentId, authorityEnvelope;
  if (mode === 'verify-authority' && authorityMode !== ENROLLED_AUTHORITY_MODE) failure('Read-only enrollment verification requires its explicit authority mode.');
  if (authorityMode === ENROLLED_AUTHORITY_MODE && mode !== 'diagnose-authority') {
    enrollmentId = oneVariable('FCOS_PREVIEW_VERCEL_ENROLLMENT_ID');
    authorityEnvelope = oneVariable(ENROLLED_AUTHORITY_RECEIPT);
    if (oneVariable(ENROLLED_AUTHORITY_ENABLE) !== 'true' || !new RegExp(`^${uuid}$`).test(enrollmentId || '')
      || (receiptRequired ? typeof authorityEnvelope !== 'string' : authorityEnvelope !== undefined && typeof authorityEnvelope !== 'string')
      || typeof authorityEnvelope === 'string' && authorityEnvelope.length > 16384
      || secrets?.secrets?.filter(row => row.name === ENROLLED_AUTHORITY_SECRET).length !== 1) failure('Approved enrolled credential and signed run receipt are unavailable.');
  }
  return { ...approved, harnessSha: trusted.sha, reviewedTokenId: tokenIds[0].value, authorityMode, enrollmentId, authorityEnvelope };
}

export function assertPreviewEmailBuildProtection(options) {
  return previewEmailProtectionData(options, true);
}

/** Wait data only: full existing protection and genuine original admission are
 * mandatory before the first polling callback. This cannot grant a write claim.
 * The native caller re-reads full protected state before using the returned row.
 * No receipt, old-run receipt or renewed timestamps can authorize a Preview. */
export async function waitForPreviewEmailAttestation(options = {}) {
  const { protection, operation, now = () => Date.now() } = options;
  const startedAt = now(), { admission, candidateSha } = protection || {};
  const selected = successorLiveSelection(admission, candidateSha, startedAt);
  if (candidateSha !== SUCCESSOR_LIVE_CONTRACT.candidateSha || !['create', 'readback', 'verify-authority'].includes(operation)) failure('Exact original receipt handoff required.');
  const reviewed = previewEmailProtectionData({ ...protection, now: startedAt }, false);
  if (reviewed.authorityMode !== ENROLLED_AUTHORITY_MODE) failure('Existing issuance-bound credential required.');
  const { readVariables, privateEnrollment, token, sleep = ms => new Promise(done => setTimeout(done, ms)) } = options;
  const context = enrolledAuthorityContext({ repositoryId: protection.repository.id, environmentId: reviewed.environmentId,
    runId: reviewed.runId, harnessSha: protection.harnessSha, controlRevision: protection.controlRevision,
    contractSha256: selected.contractSha256, candidateSha, operation });
  const deadline = Math.min(startedAt + 600000, protection.oidcClaims.exp * 1000,
    Date.parse(selected.context.provisionedAt) + 2700000,
    ...[selected.dispatchedAt, protection.jobs[0].started_at, ...Object.values(selected.reviewedAt)].map(time => Date.parse(time) + 1800000));
  let variables = protection.variables;
  while (now() < deadline) {
    successorLiveSelection(admission, candidateSha, now());
    const current = previewEmailProtectionData({ ...protection, variables, now: now() }, false);
    const raw = current.authorityEnvelope;
    if (typeof raw === 'string') {
      let envelope; try { envelope = JSON.parse(raw); } catch { failure('Run receipt handoff unavailable; private diagnostics suppressed.'); }
      if (equal(envelope?.receipt?.context, context)) {
        verifyEnrollmentReceipt({ envelope: raw, privateEnrollment, token, reviewedTokenId: reviewed.reviewedTokenId,
          enrollmentId: reviewed.enrollmentId, context, now: now() });
        if (now() >= deadline) failure('Original receipt handoff expired.');
        return variables;
      }
    }
    await sleep(Math.min(10000, deadline - now()));
    if (now() >= deadline) break;
    variables = await readVariables();
  }
  failure('Original receipt handoff expired; no Preview authority granted.');
}

export function previewEmailBuildDeployment(raw, intent, { ready = true } = {}) {
  const [owner, repo] = RELEASE_REPOSITORY.split('/');
  if (!raw || raw.projectId !== projectId || raw.ownerId !== teamId && raw.teamId !== teamId
    || raw.name !== fcosConnectionIdentifier('vercel', 'Project') || raw.target !== null
    || raw.meta?.githubCommitSha !== intent.candidate.sha || raw.meta?.githubCommitRef !== intent.candidate.branch
    || raw.meta?.githubCommitOrg !== owner || raw.meta?.githubCommitRepo !== repo
    || raw.meta?.fcosPreviewEmailBuildOperation !== intent.operationId || !/^dpl_[A-Za-z0-9]+$/.test(raw.id || '')
    || !immutable(`https://${raw.url}`)
    || !positive(raw.createdAt) || raw.createdAt < Date.parse(intent.intentAt) || ready && raw.readyState !== 'READY') failure('Provider readback is not the exact operation-bound Git-source Preview.');
  // The trusted request excludes these fields. Provider echoes cannot add them.
  if (raw.meta?.fcosReleaseOperation || raw.deploymentId || raw.gitSource?.sha && raw.gitSource.sha !== intent.candidate.sha) failure('Unexpected clone or release operation in Preview readback.');
  return { id: raw.id, url: `https://${raw.url}`, sha: intent.candidate.sha, target: 'preview', state: raw.readyState,
    createdAt: raw.createdAt, projectId, teamId, operationId: intent.operationId };
}

export async function readPreviewEmailBuildVersion(deployment, { bypass, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${deployment.url}/app-version.json`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {} });
  if (!response.ok || response.redirected || response.url && response.url !== `${deployment.url}/app-version.json`) failure('Immutable Preview source receipt is unavailable.');
  return response.json();
}
function assertVersion(version, intent, deployment) {
  if (version?.commit !== intent.candidate.sha || version.provenance?.commit !== intent.candidate.sha
    || version.provenance.sourceDigest !== intent.candidate.sourceDigest || version.provenance.releaseEligible !== true
    || version.provenance.sourceDigestAlgorithm !== 'sha256:fcos-vercel-source-v1' || version.gitDirty !== version.provenance.gitDirty
    || version.provenance.gitDirty !== false && !(version.provenance.sourceAttested === true
      && (version.provenance.gitDirty === null || version.provenance.sanitizedCheckout === true))
    || version.deploymentId !== deployment.id) failure('Actual Preview build source attestation differs from the reviewed candidate.');
}

async function paginatedGithub(reads, endpoint, field) {
  const rows = [], ids = new Set(); let total;
  for (let page = 1; page <= 100; page++) {
    const result = await reads.json(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(result?.[field]) || !Number.isSafeInteger(result.total_count) || result.total_count < 0 || result.total_count > 10000 || total !== undefined && total !== result.total_count) failure('Complete GitHub archive metadata is unavailable.');
    total = result.total_count;
    for (const row of result[field]) { if (!positive(row.id) || ids.has(row.id)) failure('GitHub pagination repeated or omitted archive records.'); ids.add(row.id); rows.push(row); }
    if (rows.length === result.total_count) return rows;
    if (!result[field].length || rows.length > result.total_count) failure('GitHub metadata scan is incomplete.');
  }
  failure('GitHub metadata scan exceeded its bounded pagination.');
}
export async function collectPreviewEmailBuildJobs({ reads, runId } = {}) {
  if (!positive(runId)) failure('Exact first-attempt Preview proof job identity is required.');
  return paginatedGithub(reads, `repos/${RELEASE_REPOSITORY}/actions/runs/${runId}/attempts/1/jobs`, 'jobs');
}
async function protectedSource(reads) {
  const user = await reads.json('user');
  if (user?.login !== operator || !positive(user.id)) failure('Pinned human GitHub collector identity is required.');
  const repository = await reads.json(`repos/${RELEASE_REPOSITORY}`);
  const branch = await reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}`);
  const protection = await reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}/protection`);
  const trusted = assertProtectedDefault(repository, branch, protection);
  return { repository, branch, protection, trusted };
}
async function verifiedArchive({ reads, source, run, candidateSha, filename, name, now, completed, unpack }) {
  const jobs = await collectPreviewEmailBuildJobs({ reads, runId: run.id });
  assertEnvironmentReview({ environment: await reads.json(`repos/${RELEASE_REPOSITORY}/environments/${PREVIEW_EMAIL_BUILD_ENVIRONMENT}`),
    run, jobs,
    approvals: await reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${run.id}/approvals`), trusted: source.trusted, candidateSha, completed, now });
  const artifacts = await paginatedGithub(reads, `repos/${RELEASE_REPOSITORY}/actions/runs/${run.id}/artifacts`, 'artifacts');
  const matches = artifacts.filter(row => row.name === name && row.expired === false);
  const artifact = matches.length === 1 ? matches[0] : null;
  if (!artifact || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== source.trusted.sha) failure('The exact protected workflow archive is unavailable.');
  const archive = await reads.archive(`repos/${RELEASE_REPOSITORY}/actions/artifacts/${artifact.id}/zip`);
  if (!Buffer.isBuffer(archive) || artifact.digest !== `sha256:${digest(archive)}`) failure('Protected archive digest verification failed.');
  return { payload: unpack(archive, filename), artifact, archiveDigest: digest(archive), job: jobs[0] };
}

export async function collectTrustedPreviewEmailIntent({ reads, runId, candidateSha, admission, now = Date.now(), unpack = readEvidenceArchive, completed = false, withTrust = false } = {}) {
  if (candidateSha === SUCCESSOR_LIVE_CONTRACT.candidateSha) previewEmailBuildCandidate(candidateSha, { admission, now });
  if (!positive(runId)) failure('Original approved Preview build run is required.');
  const source = await protectedSource(reads);
  const run = await reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${runId}`);
  if (run?.id !== runId) failure('Original approved Preview intent must use its exact provider run.');
  const result = await verifiedArchive({ reads, source, run, candidateSha, filename: PREVIEW_EMAIL_INTENT_FILENAME,
    name: `fcos-preview-email-intent-${runId}`, now, completed, unpack });
  const intent = result.payload;
  assertIntent(intent, now, admission, completed === 'intent' && !withTrust ? 'downstream_receipt' : 'original_operation');
  if (intent.runId !== runId || intent.candidate.sha !== candidateSha || intent.harnessSha !== source.trusted.sha
    || intent.controlRevision !== await remoteControlRevision(reads, source.trusted.sha, { admission, now })) failure('Durable intent is not bound to the current protected controls.');
  if (!withTrust) return intent;
  if (candidateSha !== SUCCESSOR_LIVE_CONTRACT.candidateSha) failure('Coordination trust records are exclusive to exact successor operations.');
  const record = freezeRecord({ intent, trust: { repositoryId: source.repository.id, runId, runAttempt: 1, jobId: result.job.id,
    jobStartedAt: result.job.started_at, artifactId: result.artifact.id, archiveDigest: result.archiveDigest,
    harnessSha: source.trusted.sha, workflow: run.path.split('@')[0], dispatchedAt: run.run_started_at } });
  trustedIntentRecords.add(record);
  return record;
}

export function assertTrustedPreviewEmailIntentRecord(record, { admission, now = Date.now() } = {}) {
  if (!trustedIntentRecords.has(record)) failure('Original intent must come from the actual protected archive collector.');
  assertIntent(record.intent, now, admission);
  const selected = successorLiveSelection(admission, SUCCESSOR_LIVE_CONTRACT.candidateSha, now);
  if (selected.runId !== record.trust.runId || selected.runId !== record.intent.runId || record.trust.runAttempt !== 1
    || selected.runAttempt !== record.trust.runAttempt || selected.workflow !== PREVIEW_EMAIL_BUILD_WORKFLOW
    || record.trust.workflow !== selected.workflow || record.trust.dispatchedAt !== selected.dispatchedAt
    || record.trust.harnessSha !== selected.harnessSha || Date.parse(record.trust.jobStartedAt) < Date.parse(selected.dispatchedAt)
    || Date.parse(record.intent.intentAt) < Date.parse(record.trust.jobStartedAt)
    || !githubProviderFresh(record.trust.jobStartedAt, RELEASE_MAX_AGE_MS, now)) failure('Original proof run/job/dispatch changed or expired; archive capture cannot renew it.');
  return record;
}

export async function collectTrustedPreviewEmailBuild({ reads, api, binding, records, admission, now = Date.now(), unpack = readEvidenceArchive,
  readVersion = readPreviewEmailBuildVersion } = {}) {
  if (binding?.sha === SUCCESSOR_LIVE_CONTRACT.candidateSha) successorLiveBinding(admission, binding, now);
  const source = await protectedSource(reads);
  if (binding?.harnessSha !== source.trusted.sha) failure('Preview evidence must use the current protected main harness.');
  const runs = await paginatedGithub(reads, `repos/${RELEASE_REPOSITORY}/actions/workflows/preview-email-proof-build.yml/runs?event=workflow_dispatch&status=success`, 'workflow_runs');
  const liveRecords = records || await collectPreviewEmailEnvironmentRecords({ api, now });
  const expectedControl = await remoteControlRevision(reads, source.trusted.sha, { admission, now });
  for (const run of runs) {
    if (run.head_sha !== source.trusted.sha || !fresh(run.updated_at, now)) continue;
    try {
      const result = await verifiedArchive({ reads, source, run, candidateSha: binding.sha, filename: PREVIEW_EMAIL_BUILD_FILENAME,
        name: `fcos-preview-email-build-${binding.sha}`, now, completed: true, unpack });
      const receipt = result.payload;
      assertPreviewEmailBuildReceipt({ receipt, binding, records: liveRecords, admission, now });
      if (receipt.controlRevision !== expectedControl) failure('Preview archive controls differ from protected main.');
      const raw = await api(`/v13/deployments/${receipt.deployment.id}`);
      const deployment = previewEmailBuildDeployment(raw, receipt);
      if (!equal(deployment, receipt.deployment)) failure('Immutable provider readback changed after archive capture.');
      assertVersion(await readVersion(deployment), receipt, deployment);
      const intent = await collectTrustedPreviewEmailIntent({ reads, runId: receipt.runId, candidateSha: binding.sha, admission, now, unpack, completed: 'intent' });
      const { capturedAt: _capturedAt, deployment: _deployment, ...intentFields } = receipt; intentFields.kind = 'fcos_preview_email_intent';
      if (!equal(intentFields, intent)) failure('Build receipt differs from its durable approved intent.');
      return { receipt, trust: { runId: run.id, artifactId: result.artifact.id, harnessSha: source.trusted.sha,
        archiveDigest: result.archiveDigest, capturedAt: receipt.capturedAt } };
    } catch { /* A mismatched archive cannot grant authority; keep seeking exact proof. */ }
  }
  failure('Trusted exact Preview build evidence is unavailable.');
}

/** Only the first protected workflow invocation may POST once. Recovery runs
 * use readback and can never call create, even when no deployment is found. */
export async function runControlledPreviewEmailBuild({ intent, mode, authority, journal, create, discover, waitReady,
  collectRecords, readVersion, admission, coordination, now = () => Date.now() } = {}) {
  assertIntent(intent, now(), admission);
  if (!['create', 'readback'].includes(mode)) failure('Use a controlled first creation or readback-only recovery.');
  const successor = intent.candidate.sha === SUCCESSOR_LIVE_CONTRACT.candidateSha;
  // Dynamic import avoids the data-codec/collector cycle. Only the fixed native
  // collector's private WeakMap can admit this original operation. A DTO,
  // signature fixture, callback or cloned claim cannot enter the write path.
  const coordinator = successor && mode === 'create' ? await import('./preview-email-coordination-collector.mjs') : null;
  if (coordinator) coordinator.assertHostedPreviewCoordinationClaim(coordination, intent);
  await authority(intent);
  let raw = await discover(intent);
  if (!raw && mode === 'create') {
    await journal({ phase: 'create_requested', operationId: intent.operationId, capturedAt: new Date(now()).toISOString() });
    if (coordinator) await coordinator.consumeHostedPreviewCoordinationClaim(coordination, intent);
    try { raw = await create(intent.request); }
    catch { raw = await discover(intent); }
  }
  if (!raw) {
    await journal({ phase: 'delivery_uncertain', operationId: intent.operationId, capturedAt: new Date(now()).toISOString() });
    failure('Preview creation outcome is uncertain. Recover this original intent by readback; never submit it again.');
  }
  previewEmailBuildDeployment(raw, intent, { ready: false });
  raw = await waitReady(raw);
  const deployment = previewEmailBuildDeployment(raw, intent);
  await authority(intent);
  const records = await collectRecords();
  assertVersion(await readVersion(deployment), intent, deployment);
  const receipt = { ...intent, kind: 'fcos_preview_email_build', capturedAt: new Date(now()).toISOString(), deployment };
  assertPreviewEmailBuildReceipt({ receipt, binding: { ...intent.candidate, harnessSha: intent.harnessSha,
    deploymentId: deployment.id, candidateUrl: deployment.url }, records, admission, now: now() });
  await journal({ phase: 'complete', operationId: intent.operationId, deploymentId: deployment.id, capturedAt: receipt.capturedAt });
  return receipt;
}

import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { SUCCESSOR_LIVE_CONTRACT, successorLiveSelection, collectSuccessorLiveOperationAdmission } from './runtime-compatibility-successor-live.mjs';
import { ENROLLMENT_FIXED_TARGET, assertEnrollmentMetadata, ENROLLMENT_KEYCHAIN_SERVICE, ENROLLED_AUTHORITY_MODE,
  ENROLLED_AUTHORITY_RECEIPT, signEnrollmentReceipt, enrolledAuthorityContext } from './preview-vercel-enrollment.mjs';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { FCOS_CONNECTION_POLICY } from '../../config/fcosConnections.js';
import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { githubReleaseReads, RELEASE_REPOSITORY } from './release-evidence.mjs';
import { assertReleaseCoordinatorSource } from '../release-coordinator-local.mjs';
import { collectPreviewEmailBuildJobs } from './preview-email-build.mjs';
import { githubProviderFresh } from './github-provider-timestamp.mjs';

// This consumer selects only the existing issuance-receipt purpose/domain.
// It contains no coordination signature, token issuance or provider adapter.
export const SUCCESSOR_ATTEST_PURPOSE = 'existing-preview-vercel-run-authority-exact04ee-v1';
export const SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256 = '2bb8591f79b76b92f917ae7fcc1720d73757b613771812e9e220db015bdd1a18';
const policy = SUCCESSOR_LIVE_CONTRACT;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = () => { throw new Error('Exact successor attestation admission failed; private diagnostics suppressed.'); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const successorAttestationHash = value => createHash('sha256').update(value).digest('hex');
const publicationAdmissions = new WeakMap();
const requiredSecrets = ['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_VERCEL_ENROLLMENT'];
const allowedSecrets = [...requiredSecrets, 'FCOS_E2E_VERCEL_BYPASS', 'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN', 'FCOS_RELEASE_RUNTIME_TOKEN'];
const reference = value => exact(value, ['path', 'sha256']) && typeof value.path === 'string'
  && value.path.startsWith('/Users/vincex/Documents/FCOS/.fcos-cli/') && !value.path.split('/').includes('..') && hash(value.sha256);

// Metadata includes the complete collection, including unrelated existing secrets.
// This is a comparison surface, never a secret creation/replacement allowlist.
export function successorAttestationSecretMetadata(rows, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length < requiredSecrets.length || rows.length > allowedSecrets.length) fail();
  const names = new Set();
  for (const row of rows) {
    if (!exact(row, ['name', 'created_at', 'updated_at']) || !allowedSecrets.includes(row.name) || names.has(row.name)) fail();
    names.add(row.name);
    for (const value of [row.created_at, row.updated_at]) {
      if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
        || !positive(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))
        || Date.parse(value) > now) fail();
    }
    if (Date.parse(row.created_at) > Date.parse(row.updated_at)) fail();
  }
  if (requiredSecrets.some(name => !names.has(name))) fail();
  return rows.map(row => ({ ...row })).sort((a, b) => a.name.localeCompare(b.name));
}

export function successorAttestationPlan() {
  return { schemaVersion: 1, kind: 'fcos_exact_04ee_existing_receipt_attestation_plan', enabledByDefault: false,
    implementedThrough: 'fixed native admission, canonical permanent intent and existing credential receipt publication',
    target: ENROLLMENT_FIXED_TARGET, purpose: SUCCESSOR_ATTEST_PURPOSE, providerCalls: 0, privateReads: 0,
    publicationInstalled: true, previewAuthorized: false, productionAuthorized: false,
    requiresFreshExistingEnrollmentAndExactPrivateAction: true, automaticRetry: false, automaticLeaseRelease: false };
}

/** Runs before even constructing authenticated collectors. A personal approval
 * does not become an opaque source/material admission or a canonical lease. */
export function assertSuccessorAttestationApproval({ approval: value, nonce, scriptSha256, now = Date.now() } = {}) {
  const keys = ['schemaVersion', 'action', 'purpose', 'authorized', 'authorizedBy', 'authorizationEvidence', 'authorizedAt',
    'attestorNewPurposeAuthorized', 'scriptSha256', 'canonicalHelperSha256', 'nonce', 'target', 'candidateSha', 'sourceDigest',
    'lockHash', 'harnessSha', 'controlRevision', 'configurationRevision', 'contractSha256', 'enrollmentId', 'tokenId',
    'expiresAt', 'leaseDeadline', 'runId', 'runAttempt', 'operation', 'secretMetadata', 'privateReadinessAt',
    'privateActionEvidence', 'rootReview', 'independentReview', 'authorityBasis', 'enrollmentStateSha256',
    'jobId', 'jobStartedAt', 'dispatchedAt', 'operationId'];
  if (!exact(value, keys) || value.schemaVersion !== 1 || value.action !== 'attest' || value.purpose !== SUCCESSOR_ATTEST_PURPOSE
    || value.authorized !== true || value.authorizedBy !== fcosConnectionIdentifier('github', 'Required account')
    || typeof value.authorizationEvidence !== 'string' || !value.authorizationEvidence.trim() || value.authorizationEvidence.length > 2048
    || !positive(value.authorizedAt) || value.authorizedAt > now || now - value.authorizedAt > 3600000
    || !positive(value.privateReadinessAt) || value.privateReadinessAt > value.authorizedAt || now - value.privateReadinessAt >= 2700000
    || ![value.privateActionEvidence, value.rootReview, value.independentReview].every(reference)
    || value.rootReview.sha256 === value.independentReview.sha256
    || !exact(value.authorityBasis, ['kind', 'localReviewGrantsAuthority', 'citations'])
    || value.authorityBasis.kind !== 'existing_direct_human_authorization' || value.authorityBasis.localReviewGrantsAuthority !== false
    || !Array.isArray(value.authorityBasis.citations) || !value.authorityBasis.citations.length || value.authorityBasis.citations.length > 10
    || !value.authorityBasis.citations.every(reference)
    || !hash(value.enrollmentStateSha256) || !positive(value.jobId)
    || ![value.jobStartedAt, value.dispatchedAt].every(time => githubProviderFresh(time, 1800000, now))
    || Date.parse(value.jobStartedAt) < Date.parse(value.dispatchedAt)
    || value.operationId !== `fcos-preview-vercel-attestation-${value.runId}-${nonce}`
    || value.attestorNewPurposeAuthorized !== true || !hash(scriptSha256) || value.scriptSha256 !== scriptSha256
    || value.canonicalHelperSha256 !== SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256
    || !uuid(nonce) || value.nonce !== nonce || !uuid(value.enrollmentId) || !same(value.target, ENROLLMENT_FIXED_TARGET)
    || value.candidateSha !== policy.candidateSha || value.sourceDigest !== policy.sourceDigest || value.lockHash !== policy.lockHash
    || !sha(value.harnessSha) || ![value.controlRevision, value.configurationRevision, value.contractSha256].every(hash)
    || !/^[A-Za-z0-9_-]{1,200}$/.test(value.tokenId || '') || value.tokenId === 'current'
    || ![value.expiresAt, value.leaseDeadline, value.runId].every(positive) || value.runAttempt !== 1
    || value.expiresAt <= now || value.expiresAt > value.leaseDeadline || value.expiresAt - now > 86400000
    || !['verify-authority', 'create', 'readback'].includes(value.operation)) fail();
  successorAttestationSecretMetadata(value.secretMetadata, now);
  return value;
}

// Exclude evidence/review references to avoid a self-referential review hash.
// Every other original action field (including all nonsecret metadata) is bound.
export function successorAttestationActionBinding(approval) {
  const { privateActionEvidence, rootReview, independentReview, authorityBasis, ...binding } = approval;
  return successorAttestationHash(JSON.stringify(binding));
}

export function assertSuccessorAttestationPrivateAction(a, evidence, reviews, now = Date.now()) {
  const bindingSha256 = successorAttestationActionBinding(a);
  if (evidence?.kind !== 'direct_human_existing_preview_vercel_attestation_authority'
    || evidence.authorizedBy !== fcosConnectionIdentifier('github', 'Required account') || evidence.purpose !== SUCCESSOR_ATTEST_PURPOSE
    || evidence.authorizedAt !== a.authorizedAt || evidence.privateReadinessAt !== a.privateReadinessAt
    || evidence.sourceCommit !== a.harnessSha || evidence.scriptSha256 !== a.scriptSha256 || evidence.bindingSha256 !== bindingSha256
    || ['existingCapsuleReadAuthorized', 'existingMetadataReaderAuthorized', 'privateKeyAccessAuthorized', 'actualSigningAuthorized', 'protectedReceiptPublicationAuthorized'].some(key => evidence[key] !== true)
    || evidence.enrollmentAuthorized !== false || evidence.previewExecutionAuthorized !== false || evidence.productionAuthorized !== false
    || !Array.isArray(reviews) || reviews.length !== 2 || now - a.privateReadinessAt >= 2700000) fail();
  const reviewers = new Set();
  for (const role of ['root', 'independent']) {
    const matches = reviews.filter(row => row?.role === role), r = matches[0];
    if (matches.length !== 1 || r.kind !== 'existing_preview_vercel_attestation_action_material_review' || r.accepted !== true
      || r.sourceCommit !== a.harnessSha || r.scriptSha256 !== a.scriptSha256 || r.bindingSha256 !== bindingSha256
      || typeof r.reviewerId !== 'string' || !r.reviewerId || reviewers.has(r.reviewerId)
      || !positive(r.reviewedAt) || r.reviewedAt < a.authorizedAt || r.reviewedAt > now || r.reviewedAt - a.authorizedAt > 600000
      || now - r.reviewedAt > 1800000 || r.grantsPrivateAuthority !== false) fail();
    reviewers.add(r.reviewerId);
  }
  return true;
}

export function assertSuccessorAttestationEnrollment(a, state, capsule, metadata, now = Date.now()) {
  if (state?.schemaVersion !== 1 || state.phase !== 'enrolled_disabled' || state.productionAuthorized !== false || !sha(state.sourceSha)
    || state.enrollmentId !== a.enrollmentId || state.tokenId !== a.tokenId || state.expiresAt !== a.expiresAt
    || !same(successorAttestationSecretMetadata(state.secretMetadata, now), successorAttestationSecretMetadata(a.secretMetadata, now))) fail();
  if (capsule !== undefined) {
    if (typeof capsule !== 'string' || Buffer.byteLength(capsule) > 4096) fail();
    const parsed = JSON.parse(capsule), c = parsed?.enrollment;
    if (!exact(parsed, ['enrollment', 'binding']) || typeof parsed.binding !== 'string'
      || Buffer.from(parsed.binding, 'base64url').length !== 32 || Buffer.from(parsed.binding, 'base64url').toString('base64url') !== parsed.binding
      || !exact(c, ['schemaVersion', 'enrollmentId', 'repository', 'environment', 'teamId', 'projectId', 'tokenId', 'createdAt', 'expiresAt'])
      || c.schemaVersion !== 1 || ['repository', 'environment', 'teamId', 'projectId'].some(key => c[key] !== ENROLLMENT_FIXED_TARGET[key])
      || !positive(c.createdAt) || c.createdAt > now || c.expiresAt <= now || c.expiresAt <= c.createdAt || c.expiresAt - c.createdAt > 86400000
      || c.enrollmentId !== a.enrollmentId || c.tokenId !== a.tokenId || c.expiresAt !== a.expiresAt) fail();
    if (metadata !== undefined) assertEnrollmentMetadata(metadata, c, now);
  }
  return true;
}

export function assertSuccessorAttestationPinnedKey(raw) {
  const key = createPrivateKey(raw);
  if (key.asymmetricKeyType !== 'ed25519'
    || createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64') !== FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64) fail();
  return key;
}

export function bindSuccessorAttestationAdmission({ approval, nonce, scriptSha256, admission, now = Date.now() } = {}) {
  const value = assertSuccessorAttestationApproval({ approval, nonce, scriptSha256, now });
  const selected = successorLiveSelection(admission, policy.candidateSha, now);
  if (selected.workflow !== ENROLLMENT_FIXED_TARGET.workflow || selected.runId !== value.runId
    || selected.harnessSha !== value.harnessSha || selected.contractSha256 !== value.contractSha256
    || selected.context.previewControlRevision !== value.controlRevision
    || selected.context.configurationRevision !== value.configurationRevision) fail();
  return selected;
}

/** Only the fixed native path below mints this process-local identity after
 * independently authenticated source and canonical permanent consumption.
 * No exported constructor, caller DTO, callback or serialized lease can mint it. */
export function requireSuccessorAttestationPublicationAdmission(value) {
  if (!publicationAdmissions.has(value)) throw Object.assign(new Error('Actual canonical publication admission required; private diagnostics suppressed.'),
    { code: 'EXACT_SUCCESSOR_CANONICAL_PUBLICATION_ADMISSION_REQUIRED' });
  return publicationAdmissions.get(value);
}

export async function runSuccessorAttestationAdmission(options = {}) {
  const { action = 'plan', approval, nonce, scriptSha256, now = () => Date.now() } = options;
  if (action === 'plan') return successorAttestationPlan();
  if (action !== 'attest') fail();
  const originalApproval = freeze(structuredClone(assertSuccessorAttestationApproval({ approval, nonce, scriptSha256, now: now() })));
  try {
    const { collectAdmission, preflightFixedReads } = options;
    const admission = await collectAdmission();
    bindSuccessorAttestationAdmission({ approval: originalApproval, nonce, scriptSha256, admission, now: now() });
    await preflightFixedReads(originalApproval, admission);
    bindSuccessorAttestationAdmission({ approval: originalApproval, nonce, scriptSha256, admission, now: now() });
  } catch { fail(); }
  requireSuccessorAttestationPublicationAdmission();
}

// Fixed native executable boundary. No injected adapters, clocks, keys, URLs or
// transports enter this path. Pure exported checks above grant no capability.
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PRIMARY = '/Users/vincex/Documents/FCOS';
const APPROVALS = `${PRIMARY}/.fcos-cli/preview-vercel-successor-attestation`;
const ENTRY = join(ROOT, 'scripts/preview-vercel-successor-attest.mjs');
const GH = '/Users/vincex/.local/gh/current/bin/gh';
const NATIVE_FETCH = globalThis.fetch.bind(globalThis);
const ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/Users/vincex', GH_HOST: 'github.com', GH_REPO: RELEASE_REPOSITORY,
  GH_CONFIG_DIR: `${PRIMARY}/.fcos-cli/github` });
const BASE = `repos/${RELEASE_REPOSITORY}`, ENVIRONMENT = `${BASE}/environments/${ENROLLMENT_FIXED_TARGET.environment}`;
function command(binary, args, input, timeout = 30000) {
  try { return execFileSync(binary, args, { cwd: ROOT, env: ENV, input, encoding: 'utf8', timeout,
    maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { fail(); }
}
function ownedRead(path, limit = 65536) {
  if (typeof path !== 'string' || resolve(path) !== path) fail();
  for (let p = path; p !== '/'; p = resolve(p, '..')) if (lstatSync(p).isSymbolicLink()) fail();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.size > limit) fail();
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}
function pinned(ref) {
  if (!reference(ref)) fail();
  const text = ownedRead(ref.path);
  if (successorAttestationHash(text) !== ref.sha256) fail();
  return JSON.parse(text);
}
function actionAdmission(nonce) {
  const info = lstatSync(APPROVALS);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(APPROVALS) !== APPROVALS
    || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) fail();
  const text = ownedRead(join(APPROVALS, `approval-${nonce}.json`));
  const a = freeze(JSON.parse(text)), scriptSha256 = successorAttestationHash(readFileSync(ENTRY));
  // Complete pure check precedes all authenticated adapters and evidence reads.
  assertSuccessorAttestationApproval({ approval: a, nonce, scriptSha256 });
  assertSuccessorAttestationPrivateAction(a, pinned(a.privateActionEvidence), [pinned(a.rootReview), pinned(a.independentReview)]);
  for (const citation of a.authorityBasis.citations) pinned(citation);
  assertReleaseCoordinatorSource(ROOT, a.harnessSha);
  return { approval: a, text, sha256: successorAttestationHash(text) };
}
function readExistingEnrollment(a) {
  const path = `${PRIMARY}/.fcos-cli/preview-vercel-enrollment/${a.enrollmentId}/state.json`, raw = ownedRead(path, 32768);
  if (successorAttestationHash(raw) !== a.enrollmentStateSha256) fail();
  const state = JSON.parse(raw);
  assertSuccessorAttestationEnrollment(a, state);
  return state;
}
function collection(result, key) {
  if (!Array.isArray(result?.[key]) || result.total_count !== result[key].length || result[key].length > 100
    || new Set(result[key].map(row => row.name)).size !== result[key].length) fail();
  return result[key];
}
function variable(rows, name) {
  const matches = rows.filter(row => row.name === name);
  if (matches.length > 1 || matches.length === 1 && typeof matches[0].value !== 'string') fail();
  return matches[0]?.value;
}
async function publicPreflight(reads, a) {
  const user = await reads.json('user');
  if (user?.login !== fcosConnectionIdentifier('github', 'Required account') || !positive(user.id)) fail();
  const repository = await reads.json(BASE);
  if (repository.full_name !== RELEASE_REPOSITORY || repository.owner?.login !== user.login || repository.owner?.id !== user.id
    || repository.default_branch !== 'main' || !positive(repository.id) || repository.permissions?.admin !== true) fail();
  const environment = await reads.json(ENVIRONMENT), rules = environment.protection_rules?.filter(row => row.type === 'required_reviewers');
  const reviewer = rules?.length === 1 && rules[0].reviewers?.length === 1 ? rules[0].reviewers[0] : null;
  if (environment.name !== ENROLLMENT_FIXED_TARGET.environment || !positive(environment.id) || environment.can_admins_bypass !== false
    || reviewer?.type !== 'User' || reviewer.reviewer?.login !== user.login || reviewer.reviewer.id !== user.id
    || rules[0].prevent_self_review !== false || environment.deployment_branch_policy?.protected_branches !== true
    || environment.deployment_branch_policy?.custom_branch_policies !== false) fail();
  const variables = collection(await reads.json(`${ENVIRONMENT}/variables?per_page=100`), 'variables');
  const secrets = collection(await reads.json(`${ENVIRONMENT}/secrets?per_page=100`), 'secrets');
  const pins = { FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED: 'false', FCOS_PREVIEW_VERCEL_ISSUANCE_AUTHORITY_ENABLED: 'true',
    FCOS_PREVIEW_VERCEL_AUTHORITY_MODE: ENROLLED_AUTHORITY_MODE,
    FCOS_PREVIEW_EMAIL_BUILD_ENABLED: a.operation === 'verify-authority' ? 'false' : 'true',
    FCOS_PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLED: a.operation === 'verify-authority' ? 'true' : 'false',
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_SHA: a.candidateSha, FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_HARNESS_SHA: a.harnessSha,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTROL_SHA256: a.controlRevision, FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTRACT_SHA256: a.contractSha256,
    FCOS_RELEASE_VERCEL_TOKEN_ID: a.tokenId, FCOS_PREVIEW_VERCEL_ENROLLMENT_ID: a.enrollmentId };
  for (const [name, expected] of Object.entries(pins)) if (variable(variables, name) !== expected) fail();
  const repositoryVariables = collection(await reads.json(`${BASE}/actions/variables?per_page=100`), 'variables');
  for (const name of ['FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED', 'FCOS_PREVIEW_EMAIL_BUILD_ENABLED',
    'FCOS_PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLED', 'FCOS_PREVIEW_VERCEL_ISSUANCE_AUTHORITY_ENABLED']) {
    if (![undefined, 'false'].includes(variable(repositoryVariables, name))) fail();
  }
  const metadata = successorAttestationSecretMetadata(secrets.map(({ name, created_at, updated_at }) => ({ name, created_at, updated_at })));
  if (!same(metadata, successorAttestationSecretMetadata(a.secretMetadata))) fail();
  const run = await reads.json(`${BASE}/actions/runs/${a.runId}`);
  if (run?.id !== a.runId || run.repository?.full_name !== RELEASE_REPOSITORY || run.head_repository?.full_name !== RELEASE_REPOSITORY
    || run.head_sha !== a.harnessSha || run.head_branch !== 'main' || run.run_attempt !== 1 || run.event !== 'workflow_dispatch'
    || ![ENROLLMENT_FIXED_TARGET.workflow, `${ENROLLMENT_FIXED_TARGET.workflow}@main`].includes(run.path) || run.status !== 'in_progress'
    || run.actor?.id !== user.id || run.triggering_actor?.id !== user.id || run.actor?.login !== user.login || run.triggering_actor?.login !== user.login
    || run.display_title !== `Review FCOS Preview email source ${a.candidateSha}`) fail();
  const approvals = await reads.json(`${BASE}/actions/runs/${a.runId}/approvals`);
  const jobs = await collectPreviewEmailBuildJobs({ reads, runId: a.runId });
  assertSuccessorAttestationProtectedReview(a, { user, environment, run, approvals, jobs });
  for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
    const result = await reads.json(`${BASE}/actions/runs?status=${status}&per_page=100`);
    if (!Array.isArray(result?.workflow_runs) || result.total_count !== result.workflow_runs.length || result.workflow_runs.length > 100
      || result.workflow_runs.some(row => /(?:preview-email-proof-build|production-release|runtime-compatibility-release)\.yml(?:@|$)/.test(row.path)
        && row.id !== a.runId)) fail();
  }
  if ((await reads.json(`${BASE}/git/ref/heads/${encodeURIComponent(policy.branch)}`)).object?.sha !== a.candidateSha) fail();
  const priorReceipt = variable(variables, ENROLLED_AUTHORITY_RECEIPT);
  return freeze({ repositoryId: repository.id, environmentId: environment.id, secretMetadata: metadata,
    reviewerId: user.id, jobId: jobs[0].id, jobStartedAt: jobs[0].started_at, dispatchedAt: run.run_started_at,
    priorReceiptSha256: priorReceipt === undefined ? null : successorAttestationHash(priorReceipt) });
}
export function assertSuccessorAttestationProtectedReview(a, { user, environment, run, approvals, jobs }, now = Date.now()) {
  const reviews = (Array.isArray(approvals) ? approvals : []).filter(row => row.environments?.some(e => e.id === environment.id && e.name === environment.name));
  const job = Array.isArray(jobs) && jobs.length === 1 ? jobs[0] : null;
  if (user?.login !== fcosConnectionIdentifier('github', 'Required account') || !positive(user.id)
    || environment?.name !== ENROLLMENT_FIXED_TARGET.environment || !positive(environment.id)
    || run?.id !== a.runId || run.name !== 'FCOS protected Preview email proof build'
    || reviews.length !== 1 || reviews[0].state !== 'approved' || reviews[0].user?.login !== user.login || reviews[0].user?.id !== user.id
    || run.run_started_at !== a.dispatchedAt || !githubProviderFresh(run.run_started_at, 1800000, now)
    || job?.id !== a.jobId || job.run_id !== a.runId || job.run_attempt !== 1 || job.name !== 'proof'
    || job.workflow_name !== 'FCOS protected Preview email proof build' || job.head_sha !== a.harnessSha || job.head_branch !== 'main'
    || job.status !== 'in_progress' || job.conclusion !== null || job.completed_at !== null || job.started_at !== a.jobStartedAt
    || !githubProviderFresh(job.started_at, 1800000, now) || Date.parse(job.started_at) < Date.parse(run.run_started_at)) fail();
  return true;
}
function actualProjection(actual) {
  const { capturedAt, ...admission } = actual.admission;
  return { actionSha256: actual.action.sha256, admission, public: actual.public,
    enrollmentStateSha256: actual.action.approval.enrollmentStateSha256 };
}
function assertOriginalCurrent(original, current) {
  if (original.action.text !== current.action.text || !same(actualProjection(original), actualProjection(current))) fail();
  bindSuccessorAttestationAdmission({ approval: original.action.approval, nonce: original.action.approval.nonce,
    scriptSha256: original.action.approval.scriptSha256, admission: original.admission });
}
async function collectActual(nonce) {
  const action = actionAdmission(nonce), a = action.approval;
  const reads = githubReleaseReads({ command: GH, env: ENV }, { cwd: ROOT });
  const admission = await collectSuccessorLiveOperationAdmission({ reads, sourceCwd: ROOT, trustedCwd: ROOT, runId: a.runId });
  bindSuccessorAttestationAdmission({ approval: a, nonce, scriptSha256: a.scriptSha256, admission });
  const checked = await publicPreflight(reads, a);
  if (admission.dispatchedAt !== a.dispatchedAt) fail();
  const state = readExistingEnrollment(a);
  // Original timestamps remain untouched by local admission or key consent.
  bindSuccessorAttestationAdmission({ approval: a, nonce, scriptSha256: a.scriptSha256, admission });
  return { action, admission, public: checked, state };
}

// Dedicated metadata-only helper mirrors the historical bounded fixed GET. It
// exposes no issuance/provider-mutation adapter and is inert until invoked.
export async function readSuccessorEnrollmentTokenMetadata({ tokenId, token, fetchImpl = globalThis.fetch } = {}) {
  if (typeof tokenId !== 'string' || tokenId === 'current' || !/^[A-Za-z0-9_-]{1,200}$/.test(tokenId)
    || typeof token !== 'string' || !token || /\s/.test(token) || token.length > 4096) fail();
  const body = await fixedVercelRead(`/v5/user/tokens/${tokenId}`, token, fetchImpl);
  if (!body?.token || typeof body.token !== 'object' || Array.isArray(body.token) || body.token.id !== tokenId) fail();
  return body.token;
}
async function fixedVercelRead(path, token, fetchImpl = NATIVE_FETCH) {
  try {
    const url = `https://api.vercel.com${path}`;
    const response = await fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${token}` },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.redirected !== false || response.url !== url || response.status !== 200
      || !response.headers.get('content-type')?.includes('application/json')) fail();
    const reader = response.body?.getReader(); if (!reader) fail();
    const chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 1024 * 1024) fail(); chunks.push(value); } }
    finally { try { await reader.cancel(); } catch { /* Never inspect private transport exceptions. */ } }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { fail(); }
}
async function retainedProduction(readerToken) {
  const target = ENROLLMENT_FIXED_TARGET, baseline = JSON.parse(readFileSync(join(ROOT, 'config/legacy-email-baseline-proof.json'))).baseline;
  const user = await fixedVercelRead('/v2/user', readerToken);
  if (user.user?.username !== fcosConnectionIdentifier('vercel', 'Account')) fail();
  const project = await fixedVercelRead(`/v9/projects/${target.projectId}?teamId=${target.teamId}`, readerToken);
  const production = await fixedVercelRead(`/v13/deployments/${baseline.deploymentId}?teamId=${target.teamId}`, readerToken);
  const enabled = JSON.parse(readFileSync(join(ROOT, 'vercel.json'))).git?.deploymentEnabled;
  if (project.id !== target.projectId || project.accountId !== target.teamId || project.name !== fcosConnectionIdentifier('vercel', 'Project')
    || project.link?.type !== 'github' || `${project.link.org}/${project.link.repo}` !== target.repository || project.link.productionBranch !== 'main'
    || project.targets?.production?.id !== baseline.deploymentId || project.autoAssignCustomDomains !== false
    || !Array.isArray(project.link.deployHooks) || project.link.deployHooks.length
    || !(enabled === false || enabled && typeof enabled === 'object' && (enabled.main === false || !Object.hasOwn(enabled, 'main') && enabled['*'] === false))
    || production.id !== baseline.deploymentId || production.projectId !== target.projectId || production.ownerId !== target.teamId
    || production.target !== 'production' || production.readyState !== 'READY' || production.meta?.githubCommitSha !== baseline.sha
    || `https://${production.url}` !== baseline.url) fail();
}
function claimPublication(original) {
  const a = original.action.approval;
  const result = JSON.parse(command('/usr/bin/python3', ['-I', join(ROOT, 'scripts/lib/preview-vercel-successor-attestation-ledger.py'),
    '--claim-approved', a.nonce], undefined, 180000));
  if (result.operationId !== a.operationId || !hash(result.consumptionSha256) || !same(result.actual, actualProjection(original))) fail();
  const lease = result.lease;
  if (!exact(lease, ['epoch', 'objective', 'ownerThreadId', 'operationId', 'bindingSha256', 'leaseId',
    'coordinationOnly', 'providerAuthorityGranted', 'uncertainOutcomeRequiresReadback'])
    || lease.epoch !== 'production-reconciliation-20261005' || lease.objective !== 'production'
    || lease.ownerThreadId !== '01a0f08b-7fcb-7870-9edc-343e16052b62' || lease.operationId !== a.operationId
    || lease.bindingSha256 !== successorAttestationHash(`FCOS-EXACT-04EE-ATTESTATION-LEASE-V1\0${JSON.stringify(actualProjection(original))}`)
    || !uuid(lease.leaseId) || lease.coordinationOnly !== true || lease.providerAuthorityGranted !== false || lease.uncertainOutcomeRequiresReadback !== true) fail();
  const identity = Object.freeze({}); publicationAdmissions.set(identity, freeze(result)); return identity;
}
function assertClaimCurrent(identity, original) {
  const claimed = requireSuccessorAttestationPublicationAdmission(identity), a = original.action.approval;
  const result = JSON.parse(command('/usr/bin/python3', ['-I', join(ROOT, 'scripts/lib/preview-vercel-successor-attestation-ledger.py'),
    '--read-consumed', a.nonce], undefined, 180000));
  if (!same(result, claimed)) fail();
  return claimed;
}
async function executeFixed(original) {
  const a = original.action.approval, nonce = a.nonce;
  const identity = claimPublication(original); // O_EXCL+fsync and canonical lease precede private credentials.
  assertOriginalCurrent(original, await collectActual(nonce));
  assertClaimCurrent(identity, original);
  const compile = mkdtempSync(join(tmpdir(), 'fcos-existing-attestation-key-'));
  try {
    const binary = join(compile, 'fcos-keychain');
    command('/usr/bin/swiftc', [join(ROOT, 'scripts/fcos-keychain-migrate.swift'), '-module-cache-path', join(compile, 'modules'), '-o', binary]);
    const info = lstatSync(binary);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || info.nlink !== 1) fail();
    assertOriginalCurrent(original, await collectActual(nonce)); assertClaimCurrent(identity, original);
    const capsule = command(binary, ['get', `${FCOS_CONNECTION_POLICY.keychainAccount}:${a.enrollmentId}`, ENROLLMENT_KEYCHAIN_SERVICE]);
    assertSuccessorAttestationEnrollment(a, original.state, capsule);
    const privateKey = command(binary, ['get', FCOS_CONNECTION_POLICY.keychainAccount, FCOS_CONNECTION_POLICY.attestation.privateKeyService]);
    assertSuccessorAttestationPinnedKey(privateKey);
    // Original private readiness/material/run clocks are rechecked after consent.
    assertOriginalCurrent(original, await collectActual(nonce)); assertClaimCurrent(identity, original);
    const readerService = FCOS_CONNECTION_POLICY.providers.find(row => row.id === 'vercel').keychainService;
    const readerToken = command(binary, ['get', FCOS_CONNECTION_POLICY.keychainAccount, readerService]);
    if (!readerToken || /\s/.test(readerToken) || readerToken.length > 4096) fail();
    await retainedProduction(readerToken);
    const metadata = await readSuccessorEnrollmentTokenMetadata({ tokenId: a.tokenId, token: readerToken, fetchImpl: NATIVE_FETCH });
    const observedAt = Date.now();
    assertOriginalCurrent(original, await collectActual(nonce)); assertClaimCurrent(identity, original);
    assertSuccessorAttestationEnrollment(a, readExistingEnrollment(a), capsule, metadata);
    if (Date.now() - observedAt >= 600000) fail();
    const context = enrolledAuthorityContext({ repositoryId: original.public.repositoryId, environmentId: original.public.environmentId,
      runId: a.runId, harnessSha: a.harnessSha, controlRevision: a.controlRevision, contractSha256: a.contractSha256,
      candidateSha: a.candidateSha, operation: a.operation });
    const envelope = signEnrollmentReceipt({ privateEnrollment: capsule, metadata, context, privateKey, now: observedAt,
      expiresAt: Math.min(observedAt + 600000, a.expiresAt, a.leaseDeadline, a.privateReadinessAt + 2700000,
        Date.parse(original.admission.context.provisionedAt) + 2700000,
        ...[original.admission.dispatchedAt, a.jobStartedAt,
          ...Object.values(original.admission.reviewedAt)].map(time => Date.parse(time) + 1800000)) });
    const text = JSON.stringify(envelope);
    assertOriginalCurrent(original, await collectActual(nonce)); assertClaimCurrent(identity, original);
    await retainedProduction(readerToken);
    // Private/provider latency cannot renew observation or any original clock.
    assertOriginalCurrent(original, await collectActual(nonce)); assertClaimCurrent(identity, original);
    if (Date.now() >= envelope.receipt.expiresAt) fail();
    // Exactly one fixed receipt upsert, with no caller-selected name/path/body.
    const receiptPath = `${ENVIRONMENT}/variables/${ENROLLED_AUTHORITY_RECEIPT}`;
    const rows = collection(JSON.parse(command(GH, ['api', '--method', 'GET', `${ENVIRONMENT}/variables?per_page=100`])), 'variables');
    const before = variable(rows, ENROLLED_AUTHORITY_RECEIPT), exists = before !== undefined;
    if ((exists ? successorAttestationHash(before) : null) !== original.public.priorReceiptSha256) fail();
    const currentAction = actionAdmission(nonce);
    if (currentAction.text !== original.action.text) fail();
    bindSuccessorAttestationAdmission({ approval: a, nonce, scriptSha256: a.scriptSha256, admission: original.admission });
    assertClaimCurrent(identity, original);
    if (Date.now() >= envelope.receipt.expiresAt) fail();
    command(GH, ['api', '--method', exists ? 'PATCH' : 'POST', exists ? receiptPath : `${ENVIRONMENT}/variables`, '--input', '-'],
      JSON.stringify({ name: ENROLLED_AUTHORITY_RECEIPT, value: text }));
    const after = JSON.parse(command(GH, ['api', '--method', 'GET', receiptPath]));
    if (after.name !== ENROLLED_AUTHORITY_RECEIPT || after.value !== text || Date.now() >= envelope.receipt.expiresAt) fail();
    const secrets = collection(JSON.parse(command(GH, ['api', '--method', 'GET', `${ENVIRONMENT}/secrets?per_page=100`])), 'secrets');
    if (!same(successorAttestationSecretMetadata(secrets.map(({ name, created_at, updated_at }) => ({ name, created_at, updated_at }))),
      successorAttestationSecretMetadata(a.secretMetadata))) fail();
    return { kind: 'fcos_exact_04ee_existing_receipt_attested', attested: true, receiptSha256: successorAttestationHash(text),
      runId: a.runId, runAttempt: 1, operation: a.operation, observedAt, expiresAt: envelope.receipt.expiresAt,
      leaseId: requireSuccessorAttestationPublicationAdmission(identity).lease.leaseId, retainedLease: true, replayForbidden: true,
      secretMetadataPreserved: true, activationPerformed: false, previewAuthorized: false, productionAuthorized: false };
  } finally { rmSync(compile, { recursive: true, force: true }); }
}
export async function runFixedSuccessorAttestation(args) {
  if (!Array.isArray(args) || args.length !== 2 || !['--attest-approved', '--validate-ledger-admission'].includes(args[0])
    || !uuid(args[1]) || process.platform !== 'darwin' || process.env.NODE_OPTIONS || process.env.NODE_PATH || process.execArgv.length
    || !process.argv[1] || resolve(process.argv[1]) !== ENTRY) fail();
  try {
    const actual = await collectActual(args[1]);
    if (args[0] === '--validate-ledger-admission') return { kind: 'fcos_actual_successor_attestation_ledger_admission',
      nonce: args[1], actual: actualProjection(actual) };
    return await executeFixed(actual);
  } catch { fail(); }
}

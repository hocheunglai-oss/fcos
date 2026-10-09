import { readFileSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DefaultArtifactClient } from '@actions/artifact';
import { decodePreviewCoordinationArchive } from './preview-email-coordination-archive.mjs';
import { FCOS_CONNECTION_POLICY } from '../../config/fcosConnections.js';
import { githubReleaseReads, assertReleaseGitHubAccount, RELEASE_REPOSITORY } from './release-evidence.mjs';
import { githubReleaseOidc } from './release-production.mjs';
import { SUCCESSOR_LIVE_CONTRACT, collectSuccessorLiveOperationAdmission, successorLiveRemoteControls,
  successorLiveControlBinding, successorLiveBinding } from './runtime-compatibility-successor-live.mjs';
import { collectPreviewEmailBuildJobs, collectTrustedPreviewEmailIntent, assertPreviewEmailBuildProtection,
  assertTrustedPreviewEmailIntentRecord, collectPreviewEmailEnvironmentRecords } from './preview-email-build.mjs';
import { ENROLLED_AUTHORITY_SECRET, ENROLLED_AUTHORITY_RECEIPT, collectEnrolledPreviewAuthority,
  ENROLLED_AUTHORITY_MODE, enrolledAuthorityContext, verifyEnrollmentReceipt } from './preview-vercel-enrollment.mjs';
import { PREVIEW_COORDINATION_TARGET as target, PREVIEW_COORDINATION_VARIABLE, PREVIEW_COORDINATION_FILENAME,
  requirePreviewCoordinationProtectedActions, coordinationHash, coordinationSame, coordinationFailure,
  normalizeCoordinationEnvelope, coordinationBindingFromOriginal, verifyCoordinationGrantData, coordinationClaimName } from './preview-email-coordination.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const base = `repos/${RELEASE_REPOSITORY}`, environmentPath = `${base}/environments/${target.environment}`;
const originalContexts = new WeakSet(), claimContexts = new WeakMap(), consumed = new WeakSet();
let uploadAttempted = false;
const positive = value => Number.isSafeInteger(value) && value > 0;
const pinnedKey = FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64;
const nativeFetch = globalThis.fetch.bind(globalThis);
const fixedGh = hosted => githubReleaseReads({ command: hosted ? '/usr/bin/gh' : '/Users/vincex/.local/gh/current/bin/gh',
  env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, GH_HOST: 'github.com', GH_REPO: RELEASE_REPOSITORY,
    ...(hosted ? { GH_TOKEN: process.env.GH_TOKEN } : { GH_CONFIG_DIR: '/Users/vincex/Documents/FCOS/.fcos-cli/github' }) } }, { cwd: ROOT });
async function all(reads, path, field) {
  const rows = [], ids = new Set(); let total;
  for (let page = 1; page <= 100; page++) {
    const response = await reads.json(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(response?.[field]) || !Number.isSafeInteger(response.total_count) || response.total_count < 0 || response.total_count > 10000
      || total !== undefined && response.total_count !== total) coordinationFailure();
    total = response.total_count;
    for (const row of response[field]) {
      const key = field === 'artifacts' ? row.id : row.name;
      if (!key || ids.has(key)) coordinationFailure(); ids.add(key); rows.push(row);
    }
    if (rows.length === total) return { [field]: rows };
    if (!response[field].length || rows.length > total) coordinationFailure();
  }
  coordinationFailure();
}
const variable = (rows, name) => { const matches = rows.variables.filter(row => row.name === name);
  if (matches.length !== 1 || typeof matches[0].value !== 'string') coordinationFailure(); return matches[0].value; };
function actualHostedIdentity() {
  const env = process.env, runId = Number(env.GITHUB_RUN_ID), workspace = resolve(env.GITHUB_WORKSPACE || '/');
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY || !positive(runId)
    || env.GITHUB_RUN_ATTEMPT !== '1' || env.GITHUB_JOB !== 'proof' || env.FCOS_E2E_EXPECTED_COMMIT !== SUCCESSOR_LIVE_CONTRACT.candidateSha
    || realpathSync(ROOT) !== join(workspace, 'trusted') || realpathSync(env.FCOS_RELEASE_SOURCE_DIRECTORY || '/') !== join(workspace, 'candidate')
    || !env.GH_TOKEN || !env.VERCEL_TOKEN || !env[ENROLLED_AUTHORITY_SECRET]) coordinationFailure();
  return { runId, sourceCwd: join(workspace, 'candidate') };
}
async function fixedVercelGet(path) {
  const baseline = JSON.parse(readFileSync(new URL('../../config/legacy-email-baseline-proof.json', import.meta.url))).baseline;
  const metadata = `/v9/projects/${target.projectId}/env?decrypt=false`;
  if (path !== `/v13/deployments/${baseline.deploymentId}` && path !== metadata
    && !(path.startsWith(`${metadata}&until=`) && /^[1-9][0-9]*$/.test(path.slice(`${metadata}&until=`.length)))) coordinationFailure();
  const url = new URL(path, 'https://api.vercel.com'); url.searchParams.set('teamId', target.teamId);
  try {
    const response = await nativeFetch(url.href, { method: 'GET', headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.status !== 200 || response.redirected !== false || response.url !== url.href
      || !response.headers.get('content-type')?.includes('application/json')) coordinationFailure();
    const reader = response.body?.getReader(); if (!reader) coordinationFailure();
    const chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 8 * 1024 * 1024) coordinationFailure(); chunks.push(value); } } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { coordinationFailure(); }
}
async function actualOriginal(reads, runId, sourceCwd) {
  const admission = await collectSuccessorLiveOperationAdmission({ reads, runId, sourceCwd, trustedCwd: ROOT, now: Date.now() });
  if (admission.runId !== runId || admission.runAttempt !== 1 || admission.workflow !== target.workflow) coordinationFailure();
  await successorLiveRemoteControls({ reads, admission, now: Date.now() });
  const original = await collectTrustedPreviewEmailIntent({ reads, runId, candidateSha: SUCCESSOR_LIVE_CONTRACT.candidateSha,
    admission, now: Date.now(), withTrust: true });
  assertTrustedPreviewEmailIntentRecord(original, { admission, now: Date.now() });
  return { admission, original };
}

// Local issuer uses actual public state only; its private action guard executes
// before calling this fixed constructor. No caller transport/decoder/clock.
export async function collectLocalPreviewCoordinationEvidence(runId) {
  if (arguments.length !== 1 || !positive(runId) || process.platform !== 'darwin') coordinationFailure();
  const reads = fixedGh(false); assertReleaseGitHubAccount(reads);
  const actual = await actualOriginal(reads, runId, ROOT);
  const variables = await all(reads, `${environmentPath}/variables`, 'variables');
  const issuanceEnvelope = variable(variables, ENROLLED_AUTHORITY_RECEIPT);
  const receipt = normalizeCoordinationEnvelope(issuanceEnvelope, 16384).value.receipt;
  const environment = await reads.json(environmentPath), repository = await reads.json(base);
  if (repository.id !== actual.original.trust.repositoryId || repository.permissions?.admin !== true
    || environment.id !== receipt?.context?.environmentId) coordinationFailure();
  const pins = { FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED: 'false', FCOS_PREVIEW_EMAIL_BUILD_ENABLED: 'true',
    FCOS_PREVIEW_VERCEL_ISSUANCE_AUTHORITY_ENABLED: 'true', FCOS_PREVIEW_VERCEL_AUTHORITY_MODE: ENROLLED_AUTHORITY_MODE,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_SHA: actual.admission.candidate.sha,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_HARNESS_SHA: actual.admission.harnessSha,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTROL_SHA256: actual.admission.context.previewControlRevision,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTRACT_SHA256: actual.admission.contractSha256,
    FCOS_RELEASE_VERCEL_TOKEN_ID: receipt?.enrollment?.tokenId, FCOS_PREVIEW_VERCEL_ENROLLMENT_ID: receipt?.enrollment?.enrollmentId };
  for (const [name, expected] of Object.entries(pins)) if (typeof expected !== 'string' || variable(variables, name) !== expected) coordinationFailure();
  const secrets = await all(reads, `${environmentPath}/secrets`, 'secrets');
  const names = ['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_VERCEL_ENROLLMENT'];
  if (secrets.secrets.length !== names.length || secrets.secrets.some(row => !names.includes(row.name))) coordinationFailure();
  const secretMetadata = secrets.secrets.map(({ name, created_at, updated_at }) => ({ name, created_at, updated_at }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...actual, issuanceEnvelope, secretMetadata };
}
async function actualHostedContext() {
  const identity = actualHostedIdentity(), reads = fixedGh(true); assertReleaseGitHubAccount(reads);
  const { admission, original } = await actualOriginal(reads, identity.runId, identity.sourceCwd);
  if (process.env.GITHUB_SHA !== admission.harnessSha) coordinationFailure();
  const repository = await reads.json(base), branch = await reads.json(`${base}/branches/${encodeURIComponent(repository.default_branch)}`);
  const protection = await reads.json(`${base}/branches/${encodeURIComponent(repository.default_branch)}/protection`);
  const environment = await reads.json(environmentPath), variables = await all(reads, `${environmentPath}/variables`, 'variables');
  const secrets = await all(reads, `${environmentPath}/secrets`, 'secrets'), run = await reads.json(`${base}/actions/runs/${identity.runId}`);
  const approvals = await reads.json(`${base}/actions/runs/${identity.runId}/approvals`), jobs = await collectPreviewEmailBuildJobs({ reads, runId: identity.runId });
  const oidcClaims = await githubReleaseOidc({ env: process.env });
  const approved = assertPreviewEmailBuildProtection({ repository, branch, protection, environment, variables, secrets, run, jobs, approvals,
    oidcClaims, candidateSha: SUCCESSOR_LIVE_CONTRACT.candidateSha, harnessSha: admission.harnessSha,
    controlRevision: admission.context.previewControlRevision, admission, now: Date.now() });
  if (approved.runId !== identity.runId || (await reads.json(`${base}/git/ref/heads/${encodeURIComponent(admission.candidate.branch)}`)).object?.sha !== admission.candidate.sha) coordinationFailure();
  const issuance = { envelope: approved.authorityEnvelope, privateEnrollment: process.env[ENROLLED_AUTHORITY_SECRET], token: process.env.VERCEL_TOKEN,
    reviewedTokenId: approved.reviewedTokenId, enrollmentId: approved.enrollmentId,
    context: enrolledAuthorityContext({ repositoryId: repository.id, environmentId: approved.environmentId, runId: identity.runId,
      harnessSha: admission.harnessSha, controlRevision: admission.context.previewControlRevision,
      contractSha256: admission.contractSha256, candidateSha: admission.candidate.sha, operation: 'create' }) };
  // Exact keys are constructed here; callers cannot spread in a test public key.
  verifyEnrollmentReceipt({ ...issuance, publicKeySpkiBase64: pinnedKey, now: Date.now() });
  const authority = await collectEnrolledPreviewAuthority({ ...issuance, publicKeySpkiBase64: pinnedKey,
    deploymentConfiguration: JSON.parse(readFileSync(join(identity.sourceCwd, 'vercel.json'))), fetchImpl: nativeFetch });
  const baseline = JSON.parse(readFileSync(new URL('../../config/legacy-email-baseline-proof.json', import.meta.url))).baseline;
  const retained = await fixedVercelGet(`/v13/deployments/${baseline.deploymentId}`);
  if (authority.project.targets?.production?.id !== baseline.deploymentId || retained.id !== baseline.deploymentId || retained.projectId !== target.projectId
    || retained.ownerId !== target.teamId && retained.teamId !== target.teamId || retained.target !== 'production' || retained.readyState !== 'READY'
    || retained.meta?.githubCommitSha !== baseline.sha || `https://${retained.url}` !== baseline.url) coordinationFailure();
  const records = await collectPreviewEmailEnvironmentRecords({ api: fixedVercelGet, now: Date.now() });
  if (!coordinationSame(records.records, original.intent.environmentRecords.records)) coordinationFailure();
  const binding = coordinationBindingFromOriginal({ admission, original, issuanceEnvelope: issuance.envelope, now: Date.now() });
  const envelopeText = variable(variables, PREVIEW_COORDINATION_VARIABLE);
  const verifiedGrant = verifyCoordinationGrantData({ envelope: envelopeText, expected: binding, publicKeySpkiBase64: pinnedKey, now: Date.now() });
  const context = { reads, admission, original, binding, issuance, envelopeText, verifiedGrant, identity, oidcClaims };
  originalContexts.add(context); return context;
}
function recheck(context) {
  if (!originalContexts.has(context) || actualHostedIdentity().runId !== context.binding.runId || context.oidcClaims.exp * 1000 <= Date.now()) coordinationFailure();
  const controls = successorLiveControlBinding({ trustedCwd: ROOT, sourceCwd: context.identity.sourceCwd });
  successorLiveBinding(context.admission, { sha: SUCCESSOR_LIVE_CONTRACT.candidateSha, ...controls }, Date.now());
  verifyEnrollmentReceipt({ ...context.issuance, publicKeySpkiBase64: pinnedKey, now: Date.now() });
  const binding = coordinationBindingFromOriginal({ admission: context.admission, original: context.original, issuanceEnvelope: context.issuance.envelope, now: Date.now() });
  if (!coordinationSame(binding, context.binding)) coordinationFailure();
  return verifyCoordinationGrantData({ envelope: context.envelopeText, expected: binding, publicKeySpkiBase64: pinnedKey, now: Date.now() });
}
export async function collectHostedPreviewCoordinationStatus() {
  if (arguments.length) coordinationFailure();
  const context = await actualHostedContext(); recheck(context);
  const prior = await all(context.reads, `${base}/actions/runs/${context.binding.runId}/artifacts`, 'artifacts');
  return { schemaVersion: 1, kind: 'fcos_preview_coordination_read_only_status', grantSha256: context.verifiedGrant.envelopeSha256,
    leaseId: context.verifiedGrant.grant.lease.leaseId, expiresAt: context.verifiedGrant.grant.expiresAt,
    originalRunId: context.binding.runId, alreadyConsumed: prior.artifacts.some(row => row.name === coordinationClaimName(context.binding)),
    protectedActionsInstalled: false, previewAuthorized: false, productionAuthorized: false, mutations: 0 };
}

/** Future guarded production path: fixed account/transport/decoder/wall-clock,
 * original runtime identity, real key and one SDK invocation. SDK service calls
 * can retry internally; no HTTP-count or backend-exclusivity proof is inferred. */
export async function collectHostedPreviewCoordinationClaim() {
  if (arguments.length) coordinationFailure();
  requirePreviewCoordinationProtectedActions();
  if (uploadAttempted) coordinationFailure(); uploadAttempted = true;
  const context = await actualHostedContext(), name = coordinationClaimName(context.binding);
  const prior = await all(context.reads, `${base}/actions/runs/${context.binding.runId}/artifacts`, 'artifacts');
  if (prior.artifacts.some(row => row.name === name)) coordinationFailure();
  const current = await collectTrustedPreviewEmailIntent({ reads: context.reads, runId: context.binding.runId,
    candidateSha: SUCCESSOR_LIVE_CONTRACT.candidateSha, admission: context.admission, now: Date.now(), withTrust: true });
  if (!coordinationSame(current, context.original)) coordinationFailure(); recheck(context);
  const payload = { schemaVersion: 1, kind: 'fcos_exact_04ee_immutable_consumption', binding: context.binding,
    grantSha256: context.verifiedGrant.envelopeSha256, leaseId: context.verifiedGrant.grant.lease.leaseId,
    consumptionSha256: context.verifiedGrant.grant.consumptionSha256, possibleSubmission: true, replayForbidden: true };
  const directory = mkdtempSync(join(tmpdir(), 'fcos-coordination-upload-'));
  const stdout = process.stdout.write, stderr = process.stderr.write; let created;
  try {
    const path = join(directory, PREVIEW_COORDINATION_FILENAME); writeFileSync(path, `${JSON.stringify(payload)}\n`, { flag: 'wx', mode: 0o600, flush: true });
    process.stdout.write = () => true; process.stderr.write = () => true;
    created = await new DefaultArtifactClient().uploadArtifact(name, [path], directory, { retentionDays: 30, compressionLevel: 0 });
  } catch { coordinationFailure(); }
  finally { process.stdout.write = stdout; process.stderr.write = stderr; rmSync(directory, { recursive: true, force: true }); }
  const rows = await all(context.reads, `${base}/actions/runs/${context.binding.runId}/artifacts`, 'artifacts');
  const matches = rows.artifacts.filter(row => row.name === name), artifact = matches.length === 1 ? matches[0] : null;
  if (!positive(created?.id) || !artifact || artifact.id !== created.id || artifact.expired !== false
    || artifact.workflow_run?.id !== context.binding.runId || artifact.workflow_run?.head_sha !== context.binding.harnessSha
    || artifact.digest !== `sha256:${created.digest}`) coordinationFailure();
  const archive = await context.reads.archive(`${base}/actions/artifacts/${artifact.id}/zip`);
  if (artifact.digest !== `sha256:${coordinationHash(archive)}` || !coordinationSame(decodePreviewCoordinationArchive(archive), payload)) coordinationFailure();
  recheck(context);
  const claim = Object.freeze({ kind: 'fcos_exact_04ee_collected_coordination_claim', artifactId: artifact.id,
    archiveSha256: coordinationHash(archive), grantSha256: payload.grantSha256, providerAuthorityGranted: false });
  claimContexts.set(claim, context); return claim;
}
export function consumeHostedPreviewCoordinationClaim(claim) {
  if (arguments.length !== 1 || !claimContexts.has(claim) || consumed.has(claim)) coordinationFailure();
  requirePreviewCoordinationProtectedActions(); recheck(claimContexts.get(claim)); consumed.add(claim);
  return { coordinationClaimConsumed: true, providerAuthorityGranted: false };
}

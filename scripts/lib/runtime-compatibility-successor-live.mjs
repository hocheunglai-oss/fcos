import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { assertProtectedDefault, assertReleaseGitHubAccount, RELEASE_REPOSITORY } from './release-evidence.mjs';
import { verifyRuntimeCompatibilitySuccessorSource } from '../verify-runtime-compatibility-successor.mjs';
import { collectBuildProvenance } from './build-provenance.mjs';
import { PREVIEW_EMAIL_BUILD_CONTROL_FILES } from './preview-email-build.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const bytes = readFileSync(new URL('../../config/runtime-compatibility-successor-live.json', import.meta.url));
export const SUCCESSOR_LIVE_CONTRACT_SHA256 = 'aecc93e6152c23b0bee23834f045cc2a6ae8a9fd9057c205080c6ade7614a5c0';
export function assertSuccessorLiveContractBytes(value) {
  if (!Buffer.isBuffer(value) || digest(value) !== SUCCESSOR_LIVE_CONTRACT_SHA256) throw new Error('Exact successor live contract bytes differ.');
  return JSON.parse(value.toString('utf8'));
}
export const SUCCESSOR_LIVE_CONTRACT = freeze(assertSuccessorLiveContractBytes(bytes));
const policy = SUCCESSOR_LIVE_CONTRACT;
const activeRoot = fileURLToPath(new URL('../..', import.meta.url));
const historical = JSON.parse(readFileSync(new URL('../../config/legacy-email-baseline-proof.json', import.meta.url)));
const verified = new WeakSet();
const sha = value => /^[0-9a-f]{40}$/.test(value || '');
const hash = value => /^[0-9a-f]{64}$/.test(value || '');
const id = value => /^[A-Za-z0-9_-]{1,200}$/.test(value || '');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fresh = (value, seconds, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value
  && Date.parse(value) <= now && now - Date.parse(value) <= seconds * 1000;
const fail = code => { throw Object.assign(new Error('Exact successor live admission failed; no action authority is granted.'), { code }); };

export const SUCCESSOR_LIVE_CONTROL_FILES = Object.freeze([
  'config/runtime-compatibility-successor-live.json', 'scripts/lib/runtime-compatibility-successor-live.mjs',
  'scripts/lib/runtime-compatibility-successor-adapter.mjs',
  'config/runtime-compatibility-successor-source.json', 'scripts/verify-runtime-compatibility-successor.mjs',
  'scripts/lib/runtime-compatibility-successor.mjs',
]);

// Review/context material is intentionally outside this allowlist: its bytes
// are bound separately below, so neither a context nor a review hashes itself.
export const SUCCESSOR_LIVE_HARNESS_FILES = Object.freeze([...new Set([
  ...PREVIEW_EMAIL_BUILD_CONTROL_FILES, ...SUCCESSOR_LIVE_CONTROL_FILES,
  'scripts/runtime-compatibility-release.mjs', 'scripts/lib/runtime-compatibility-release.mjs',
  'scripts/lib/runtime-compatibility.mjs', 'scripts/verify-runtime-compatibility.mjs',
  'scripts/collect-preview-parity.mjs', 'scripts/runtime-compatibility-normal-role.mjs',
  'scripts/lib/runtime-compatibility-observation.mjs', 'scripts/lib/normal-role-read-requests.mjs',
  'scripts/lib/normal-role-verification-transport.mjs', 'scripts/lib/compatibility-browser-isolation.mjs',
  '.github/workflows/runtime-compatibility-release.yml', '.github/workflows/runtime-compatibility-normal-role.yml',
  '.github/workflows/quality.yml', '.github/workflows/authenticated-release.yml', '.github/workflows/normal-role-release.yml',
  'scripts/normal-role-release.mjs', 'playwright.config.js', 'tests/compatibility-browser-isolation.chromium.mjs',
  'AGENTS.md', '.codex/config.toml', '.codex/setup.mjs', '.codex/control-validation.mjs', '.codex/control-policy.json',
  '.codex/README.md', '.codex/environments/environment.toml', '.codex/environments/environment-2.toml',
])].sort());
const candidateControlFiles = Object.freeze([
  'config/fcosConnections.js', 'config/fcosCiIdentity.js', 'vercel.json', 'package.json', 'package-lock.json',
  'AGENTS.md', '.codex/config.toml', '.codex/setup.mjs', '.codex/control-validation.mjs', '.codex/control-policy.json',
  '.codex/README.md', '.codex/environments/environment.toml', '.codex/environments/environment-2.toml',
]);

// The unchanged provenance collector inherits its subprocess environment. Do
// not let ambient Git selection/configuration change the repository it sees.
// Presentation-only variables cannot select Git objects or configuration.
const presentationGitEnvironment = new Set(['GIT_PAGER', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_TERMINAL_PROMPT']);
function isolatedGit(cwd) {
  return (args, input) => execFileSync('git', ['--no-replace-objects', ...args], { cwd, timeout: 30000,
    maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], input,
    env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' } });
}
function repositoryIdentity(git, cwd) {
  const root = realpathSync(git(['rev-parse', '--show-toplevel']).toString('utf8').trim());
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}']).toString('utf8').trim();
  if (root !== realpathSync(cwd) || !sha(head)) fail('EXACT_SUCCESSOR_REPOSITORY_ROOT_HEAD_REQUIRED');
  return { root, head };
}
function rawHarnessFiles(git, commit) {
  const commitBody = git(['cat-file', 'commit', commit]);
  if (createHash('sha1').update(`commit ${commitBody.length}\0`).update(commitBody).digest('hex') !== commit) fail('EXACT_SUCCESSOR_RAW_HARNESS_COMMIT_REQUIRED');
  const entries = git(['ls-tree', '-rz', '--full-tree', commit, '--', ...SUCCESSOR_LIVE_HARNESS_FILES]).toString('utf8').split('\0').filter(Boolean);
  const files = new Map(entries.map(entry => {
    const separator = entry.indexOf('\t'), [mode, type, oid] = entry.slice(0, separator).split(' ');
    if (separator < 0 || !['100644', '100755'].includes(mode) || type !== 'blob' || !sha(oid)) fail('EXACT_SUCCESSOR_RAW_HARNESS_BLOBS_REQUIRED');
    return [entry.slice(separator + 1), { mode, oid }];
  }));
  if (files.size !== SUCCESSOR_LIVE_HARNESS_FILES.length || SUCCESSOR_LIVE_HARNESS_FILES.some(file => !files.has(file))) fail('EXACT_SUCCESSOR_RAW_HARNESS_BLOBS_REQUIRED');
  const objects = git(['cat-file', '--batch'], `${[...files.values()].map(file => file.oid).join('\n')}\n`);
  let offset = 0;
  for (const file of files.values()) {
    const end = objects.indexOf(10, offset), header = objects.subarray(offset, end).toString('utf8').split(' '), size = Number(header[2]);
    if (end < offset || header.length !== 3 || header[0] !== file.oid || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0
      || end + 1 + size >= objects.length || objects[end + 1 + size] !== 10) fail('EXACT_SUCCESSOR_RAW_HARNESS_BLOBS_REQUIRED');
    file.body = objects.subarray(end + 1, end + 1 + size);
    if (createHash('sha1').update(`blob ${size}\0`).update(file.body).digest('hex') !== file.oid) fail('EXACT_SUCCESSOR_RAW_HARNESS_BLOBS_REQUIRED');
    offset = end + 2 + size;
  }
  if (offset !== objects.length) fail('EXACT_SUCCESSOR_RAW_HARNESS_BLOBS_REQUIRED');
  return files;
}

export function successorLiveControlBinding({ trustedCwd, sourceCwd } = {}) {
  if (Object.keys(process.env).some(key => key.startsWith('GIT_') && !presentationGitEnvironment.has(key))) fail('EXACT_SUCCESSOR_AMBIENT_GIT_OVERRIDE_FORBIDDEN');
  const trustedGit = isolatedGit(trustedCwd), git = isolatedGit(sourceCwd);
  const identity = repositoryIdentity(trustedGit, trustedCwd), sourceIdentity = repositoryIdentity(git, sourceCwd);
  const expectedRemotes = [ `https://github.com/${RELEASE_REPOSITORY}.git`, `https://github.com/${RELEASE_REPOSITORY}`, `git@github.com:${RELEASE_REPOSITORY}.git` ];
  const trustedRemote = trustedGit(['remote', 'get-url', 'origin']).toString('utf8').trim();
  if (!expectedRemotes.includes(trustedRemote)) fail('EXACT_SUCCESSOR_HARNESS_REPOSITORY_REQUIRED');
  const remote = git(['remote', 'get-url', 'origin']).toString('utf8').trim();
  if (!expectedRemotes.includes(remote)) fail('EXACT_SUCCESSOR_SOURCE_REPOSITORY_REQUIRED');
  if (git(['rev-parse', '--verify', `${policy.candidateSha}^{commit}`]).toString('utf8').trim() !== policy.candidateSha) fail('EXACT_SUCCESSOR_RAW_SOURCE_COMMIT_REQUIRED');
  const committed = rawHarnessFiles(trustedGit, identity.head);
  const trusted = SUCCESSOR_LIVE_HARNESS_FILES.map(file => {
    const path = join(trustedCwd, file), info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) fail('EXACT_SUCCESSOR_REGULAR_CONTROLS_REQUIRED');
    const content = readFileSync(path), sourceHash = digest(content), blob = committed.get(file);
    if (!content.equals(blob.body) || blob.mode !== (info.mode & 0o111 ? '100755' : '100644')) fail('EXACT_SUCCESSOR_COMMITTED_CONTROL_BYTES_REQUIRED');
    if (sourceHash !== digest(readFileSync(join(activeRoot, file)))) fail('EXACT_SUCCESSOR_EXECUTING_HARNESS_BYTES_REQUIRED');
    return [file, sourceHash];
  });
  // Even replacements outside the allowlist could falsify full-tree clean
  // provenance in the unchanged collector. Refuse that state entirely.
  if (trustedGit(['for-each-ref', '--format=%(refname)', 'refs/replace/']).length) fail('EXACT_SUCCESSOR_REPLACEMENT_REFS_FORBIDDEN');
  const harness = collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true });
  if (harness.releaseEligible !== true || harness.gitDirty !== false || harness.commit !== identity.head) fail('EXACT_SUCCESSOR_CLEAN_HARNESS_REQUIRED');
  const candidate = candidateControlFiles.map(file => [file, digest(git(['show', `${policy.candidateSha}:${file}`]))]);
  for (const [actual, expected] of [[repositoryIdentity(trustedGit, trustedCwd), identity], [repositoryIdentity(git, sourceCwd), sourceIdentity]]) {
    if (actual.root !== expected.root || actual.head !== expected.head) fail('EXACT_SUCCESSOR_REPOSITORY_IDENTITY_CHANGED');
  }
  const closure = JSON.stringify({ trusted, candidate });
  return { harnessSha: identity.head,
    previewControlRevision: digest(`fcos-exact-04ee-preview-controls-v1\0${closure}`),
    configurationRevision: digest(`fcos-exact-04ee-release-controls-v1\0${closure}`),
    controlFiles: { trusted, candidate }, harnessSourceDigest: harness.sourceDigest };
}

/** Source-only receipt validation is deliberately separate from material admission.
 * Entrypoints recompute this receipt with the unchanged immutable source verifier. */
export function assertSuccessorLiveSource(proof) {
  const scope = proof?.scope, original = scope?.stages?.[0];
  if (proof?.schemaVersion !== 1 || proof.receiptKind !== 'fcos_exact_compatibility_successor_source_preparation'
    || proof.candidateSha !== policy.candidateSha || proof.candidateGitTree !== policy.candidateGitTree
    || proof.candidateCanonicalTreeSha256 !== policy.candidateTreeHash
    || proof.candidateCanonicalTreeAlgorithm !== 'sha256:ordered-git-blob-tree-v1'
    || proof.sourceVerified !== true || proof.liveProof !== false || proof.productionAuthorized !== false
    || proof.credentialAuthority !== false || proof.mutations !== 0 || scope?.sourceVerified !== true
    || scope.manifestSha256 !== policy.sourceManifestSha256 || scope.candidateCommit !== policy.candidateSha
    || scope.candidateTree !== policy.candidateGitTree || scope.preservation?.existingUi !== false
    || scope.preservation.originalGuardDispatch !== true || scope.preservation.canonicalControls !== true
    || scope.stages.length !== 3 || scope.stages[1].independentDispatchTransformationVerified !== true
    || original?.receiptKind !== 'fcos_runtime_compatibility_scope' || original.scopeVerified !== true
    || original.candidateCommit !== policy.historicalCandidateSha || original.baseCommit !== historical.baseline.sha
    || proof.observationSources?.sourceVerified !== true || proof.observationSources.candidateSha !== policy.candidateSha) fail('EXACT_SUCCESSOR_SOURCE_REQUIRED');
  return { sourceVerified: true, candidateSha: policy.candidateSha, candidateTreeHash: policy.candidateTreeHash,
    existingUi: false, liveProof: false, productionAuthorized: false, credentialAuthority: false, mutations: 0 };
}

function material(raw, file) {
  if (raw?.type !== 'file' || raw.path !== file || raw.encoding !== 'base64' || typeof raw.content !== 'string' || !sha(raw.sha)) fail('EXACT_SUCCESSOR_MATERIAL_UNAVAILABLE');
  const body = Buffer.from(raw.content, 'base64');
  if (!body.length || body.length > 32768 || createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex') !== raw.sha) fail('EXACT_SUCCESSOR_MATERIAL_BLOB_MISMATCH');
  try { return { body, value: JSON.parse(body.toString('utf8')), sha256: digest(body) }; }
  catch { fail('EXACT_SUCCESSOR_MATERIAL_SCHEMA'); }
}

/** Pure material check. It does not turn caller-supplied review booleans into
 * authority. Only collectSuccessorLiveAdmission can mint the opaque selection,
 * after reading these exact bytes from the actual protected harness Git tree. */
export function assertSuccessorLiveMaterials({ context, reviews, binding, now = Date.now() } = {}) {
  const value = context?.value;
  const intact = record => Buffer.isBuffer(record?.body) && digest(record.body) === record.sha256
    && JSON.stringify(JSON.parse(record.body.toString('utf8'))) === JSON.stringify(record.value);
  const keys = ['schemaVersion', 'kind', 'contractSha256', 'candidateSha', 'branch', 'sourceDigest', 'lockHash',
    'candidateGitTree', 'candidateTreeHash', 'previewControlRevision', 'configurationRevision', 'provisionedAt',
    'attachmentOperationId', 'records', 'operation'];
  if (!exact(value, keys) || value.schemaVersion !== 1 || value.kind !== 'fcos_exact_04ee_live_context'
    || value.contractSha256 !== SUCCESSOR_LIVE_CONTRACT_SHA256 || !hash(context.sha256) || !intact(context)
    || ['candidateSha', 'branch', 'sourceDigest', 'lockHash', 'candidateGitTree', 'candidateTreeHash'].some(key => value[key] !== policy[key])
    || !sha(binding?.harnessSha) || binding.sha !== policy.candidateSha || binding.sourceDigest !== policy.sourceDigest
    || binding.lockHash !== policy.lockHash || binding.candidateTreeHash !== policy.candidateTreeHash
    || !hash(binding.previewControlRevision) || !hash(binding.configurationRevision)
    || value.previewControlRevision !== binding.previewControlRevision || value.configurationRevision !== binding.configurationRevision
    || !fresh(value.provisionedAt, policy.maxAgeSeconds.provisioning, now)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.attachmentOperationId || '')
    || !exact(value.records, ['tenantRecordId', 'clientRecordId', 'attachmentRecordId'])
    || !Object.values(value.records).every(id) || new Set(Object.values(value.records)).size !== 3
    || Object.values(value.records).some(record => Object.values(historical.baseline.records).some(pin => pin.id === record))
    || !exact(value.operation, ['id', 'phase'])
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.operation.id || '')
    || value.operation.phase !== 'prepared') fail('EXACT_SUCCESSOR_LIVE_CONTEXT_REQUIRED');
  if (!Array.isArray(reviews) || reviews.length !== 2) fail('EXACT_SUCCESSOR_TWO_MATERIAL_REVIEWS_REQUIRED');
  const reviewers = new Set();
  for (const role of ['root', 'independent']) {
    const matches = reviews.filter(row => row.value?.role === role), review = matches[0]?.value;
    if (matches.length !== 1 || !hash(matches[0].sha256) || !intact(matches[0])
      || !exact(review, ['schemaVersion', 'kind', 'role', 'reviewer', 'disposition', 'contextSha256', 'candidateSha', 'sourceDigest', 'lockHash', 'previewControlRevision', 'configurationRevision', 'reviewedAt'])
      || review.schemaVersion !== 1 || review.kind !== 'fcos_exact_04ee_live_material_review' || review.disposition !== 'accepted'
      || typeof review.reviewer !== 'string' || !/^\/[a-z0-9_/.-]{1,200}$/.test(review.reviewer) || reviewers.has(review.reviewer)
      || review.contextSha256 !== context.sha256 || !fresh(review.reviewedAt, policy.maxAgeSeconds.artifact, now)
      || Date.parse(review.reviewedAt) < Date.parse(value.provisionedAt)
      || ['candidateSha', 'sourceDigest', 'lockHash', 'previewControlRevision', 'configurationRevision'].some(key => review[key] !== value[key])) fail('EXACT_SUCCESSOR_TWO_MATERIAL_REVIEWS_REQUIRED');
    reviewers.add(review.reviewer);
  }
  return true;
}

export async function collectSuccessorLiveAdmission({ reads, binding, sourceCwd, trustedCwd, now = Date.now() } = {}) {
  // A caller's sourceVerified flag or serialized pass file cannot mint selection.
  assertSuccessorLiveSource(verifyRuntimeCompatibilitySuccessorSource({ cwd: sourceCwd, candidateCommit: policy.candidateSha }));
  const controls = successorLiveControlBinding({ trustedCwd, sourceCwd });
  if (['harnessSha', 'previewControlRevision', 'configurationRevision'].some(key => binding?.[key] !== controls[key])) fail('EXACT_SUCCESSOR_ACTUAL_CONTROL_BINDING_REQUIRED');
  assertReleaseGitHubAccount(reads);
  const repository = await reads.json(`repos/${RELEASE_REPOSITORY}`);
  const branch = await reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}`);
  const trusted = assertProtectedDefault(repository, branch,
    await reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}/protection`));
  if (binding?.harnessSha !== trusted.sha) fail('EXACT_SUCCESSOR_CURRENT_HARNESS_REQUIRED');
  if (!Number.isSafeInteger(binding.runId) || binding.runId < 1) fail('EXACT_SUCCESSOR_DISPATCH_REQUIRED');
  const run = await reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${binding.runId}`);
  if (run?.id !== binding.runId || run.repository?.full_name !== RELEASE_REPOSITORY || run.head_repository?.full_name !== RELEASE_REPOSITORY
    || run.head_sha !== trusted.sha || run.head_branch !== trusted.branch || run.event !== 'workflow_dispatch' || run.run_attempt !== 1
    || !['in_progress', 'completed'].includes(run.status) || !fresh(run.run_started_at, policy.maxAgeSeconds.dispatch, now)
    || !['.github/workflows/preview-email-proof-build.yml', '.github/workflows/runtime-compatibility-normal-role.yml', '.github/workflows/runtime-compatibility-release.yml']
      .some(path => [path, `${path}@${trusted.branch}`].includes(run.path))) fail('EXACT_SUCCESSOR_DISPATCH_REQUIRED');
  const rows = {};
  for (const [role, file] of Object.entries(policy.materials)) rows[role] = material(
    await reads.json(`repos/${RELEASE_REPOSITORY}/contents/${file}?ref=${trusted.sha}`), file);
  assertSuccessorLiveMaterials({ context: rows.context, reviews: [rows.root, rows.independent], binding, now });
  const context = rows.context.value;
  const contractSha256 = digest(`fcos-exact-04ee-live-material-v1\0${SUCCESSOR_LIVE_CONTRACT_SHA256}\0${rows.context.sha256}\0${rows.root.sha256}\0${rows.independent.sha256}`);
  const admission = freeze({ schemaVersion: 1, kind: 'fcos_exact_04ee_collector_admission', harnessSha: trusted.sha,
    contractSha256, capturedAt: new Date(now).toISOString(), dispatchedAt: run.run_started_at, runId: run.id,
    workflow: run.path.split('@')[0], context,
    reviewedAt: { root: rows.root.value.reviewedAt, independent: rows.independent.value.reviewedAt },
    materialHashes: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.sha256])),
    candidate: { sha: policy.candidateSha, branch: policy.branch, sourceDigest: policy.sourceDigest, lockHash: policy.lockHash, ...context.records },
    previewAuthorized: false, productionAuthorized: false, credentialAuthority: false, mutations: 0 });
  verified.add(admission);
  return admission;
}

// Revalidate the ages without accepting a cloned or caller-created selection.
export function successorLiveSelection(admission, candidateSha = policy.candidateSha, now = Date.now()) {
  if (!verified.has(admission) || candidateSha !== policy.candidateSha || !fresh(admission.capturedAt, policy.maxAgeSeconds.artifact, now)
    || !fresh(admission.context.provisionedAt, policy.maxAgeSeconds.provisioning, now)
    || !fresh(admission.dispatchedAt, policy.maxAgeSeconds.dispatch, now)
    || !['root', 'independent'].every(role => fresh(admission.reviewedAt[role], policy.maxAgeSeconds.artifact, now))) fail('EXACT_SUCCESSOR_TRUSTED_SELECTION_REQUIRED');
  return admission;
}

export function successorEmailContract(admission, now = Date.now()) {
  const selected = successorLiveSelection(admission, policy.candidateSha, now);
  return { contract: { ...historical, preview: { ...historical.preview, attachmentOperationId: selected.context.attachmentOperationId,
    candidates: [selected.candidate] } }, contractSha256: selected.contractSha256 };
}

export function successorLivePlan() {
  return { schemaVersion: 1, kind: 'fcos_exact_04ee_live_admission_plan', candidateSha: policy.candidateSha,
    existingUi: false, sourceVerificationSeparate: true, collectorImplemented: true, ready: false,
    requiredProtectedMaterials: policy.materials, contractSha256: SUCCESSOR_LIVE_CONTRACT_SHA256,
    blockers: ['EXACT_SUCCESSOR_PROTECTED_MATERIALS_UNOBSERVED', 'EXACT_SUCCESSOR_LIVE_EVIDENCE_UNOBSERVED', 'EXACT_SUCCESSOR_SHARED_COORDINATOR_REQUIRED'],
    previewAuthorized: false, productionAuthorized: false, credentialAuthority: false, mutations: 0, limitation: policy.limitation };
}

export function rejectSuccessorUncoordinatedMutation() {
  fail('EXACT_SUCCESSOR_SHARED_COORDINATOR_REQUIRED');
}

export const SUCCESSOR_RUNTIME_ROLLOUT = freeze({ candidateSha: policy.candidateSha,
  previousSha: historical.baseline.sha, previousDeploymentId: historical.baseline.deploymentId, previousUrl: historical.baseline.url });

export function successorProviderPins() {
  return { projectId: fcosConnectionIdentifier('vercel', 'Project ID'), teamId: fcosConnectionIdentifier('vercel', 'Team ID') };
}

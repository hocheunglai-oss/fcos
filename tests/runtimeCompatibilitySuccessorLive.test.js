import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { verifyRuntimeCompatibilitySuccessorSource } from '../scripts/verify-runtime-compatibility-successor.mjs';
import { collectBuildProvenance } from '../scripts/lib/build-provenance.mjs';
import { SUCCESSOR_LIVE_CONTRACT as policy, SUCCESSOR_LIVE_CONTRACT_SHA256, assertSuccessorLiveContractBytes,
  assertSuccessorLiveSource, assertSuccessorLiveMaterials, collectSuccessorLiveAdmission,
  successorLiveSelection, successorEmailContract, successorLivePlan,
  SUCCESSOR_LIVE_HARNESS_FILES, successorLiveControlBinding } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { successorLiveCollectionContract, successorLivePreviewRequest, executeSuccessorLiveAdapter, successorLiveNormalCoverageVerified } from '../scripts/lib/runtime-compatibility-successor-adapter.mjs';
import { previewEmailBuildCandidate, previewEmailBuildContract, createPreviewEmailBuildRequest, createPreviewEmailBuildIntent,
  assertPreviewEmailBuildReceipt, runControlledPreviewEmailBuild, PREVIEW_EMAIL_CONTRACT_SHA256 } from '../scripts/lib/preview-email-build.mjs';
import { collectTrustedPreviewEmailIntent, assertTrustedPreviewEmailIntentRecord } from '../scripts/lib/preview-email-build.mjs';
import { coordinationBindingFromOriginal } from '../scripts/lib/preview-email-coordination.mjs';
import { previewEmailSignerEnabled, previewEmailSignerSourceHashes, previewEmailSignerSourceProof,
  collectPreviewEmailSignerEvidence, previewEmailSignerEvidenceVerified, PREVIEW_EMAIL_SIGNER_BODY,
  PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID } from '../scripts/lib/preview-email-signer.mjs';
import { legacyEmailCandidate, assertLegacyEmailBaselineProof, LEGACY_EMAIL_BASELINE_CONTRACT } from '../scripts/lib/legacy-email-baseline-proof.mjs';
import { PREVIEW_PARITY_POLICY as parityPolicy, evaluatePreviewParity } from '../scripts/lib/preview-parity.mjs';
import { compatibilityOperationScopeVerified, assertCompatibilityNormalArtifact, createRuntimeCompatibilityPreflight,
  executeRuntimeCompatibilityRelease } from '../scripts/lib/runtime-compatibility-release.mjs';
import { copyBoundSource, installPortableObjects, controlManifest, controlManifestBytes, validateControlManifest, controlPack } from './helpers/runtimeCompatibilitySuccessorPortable.mjs';
import { SUCCESSOR_ATTEST_PURPOSE, SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256, successorAttestationPlan,
  bindSuccessorAttestationAdmission, runSuccessorAttestationAdmission } from '../scripts/lib/preview-vercel-successor-attestation.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const now = Date.parse('2026-10-09T02:00:00.000Z'), iso = value => new Date(value).toISOString();
const digest = value => createHash('sha256').update(value).digest('hex');
const repository = { id: 7, full_name: fcosConnectionIdentifier('github', 'Repository'), default_branch: 'main' };
// A small clean offline Git fixture contains the exact actual allowlisted
// harness bytes. It has no operational credentials and is never published.
const trustedCwd = mkdtempSync(join(tmpdir(), 'fcos-04ee-clean-harness-'));
after(() => rmSync(trustedCwd, { recursive: true, force: true }));
for (const file of SUCCESSOR_LIVE_HARNESS_FILES) {
  copyBoundSource(trustedCwd, file);
}
const git = args => execFileSync('git', ['-c', 'init.templateDir=', '-c', 'commit.gpgsign=false', ...args], { cwd: trustedCwd,
  env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Offline fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Offline fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
  stdio: ['ignore', 'pipe', 'pipe'] });
git(['init', '--quiet']); git(['remote', 'add', 'origin', `https://github.com/${repository.full_name}.git`]);
// Import exact offline public objects into this fresh repository. No shared
// FCOS object store, alternates, remote fetch or hosted history is required.
installPortableObjects(trustedCwd);
const sourceProof = verifyRuntimeCompatibilitySuccessorSource({ cwd: trustedCwd, candidateCommit: policy.candidateSha });
git(['add', '--all']); git(['commit', '--quiet', '-m', 'Exact public control-byte fixture']);
const controls = successorLiveControlBinding({ trustedCwd, sourceCwd: trustedCwd });
const harnessSha = controls.harnessSha, operationId = 'fcos-preview-email-99-12345678-1234-4123-8123-123456789abc';
const record = value => { const body = Buffer.from(`${JSON.stringify(value)}\n`); return { body, value, sha256: digest(body) }; };
function fixture(runId = 99) {
  const binding = { sha: policy.candidateSha, sourceDigest: policy.sourceDigest, lockHash: policy.lockHash,
    candidateTreeHash: policy.candidateTreeHash, harnessSha, previewControlRevision: controls.previewControlRevision, configurationRevision: controls.configurationRevision, runId };
  const context = record({ schemaVersion: 1, kind: 'fcos_exact_04ee_live_context', contractSha256: SUCCESSOR_LIVE_CONTRACT_SHA256,
    candidateSha: policy.candidateSha, branch: policy.branch, sourceDigest: policy.sourceDigest, lockHash: policy.lockHash,
    candidateGitTree: policy.candidateGitTree, candidateTreeHash: policy.candidateTreeHash,
    previewControlRevision: binding.previewControlRevision, configurationRevision: binding.configurationRevision,
    provisionedAt: iso(now - 60000), attachmentOperationId: '11111111-1111-4111-8111-111111111111',
    records: { tenantRecordId: 'FIXTURE_TENANT', clientRecordId: 'FIXTURE_CLIENT', attachmentRecordId: 'FIXTURE_SIGNER' },
    operation: { id: '22222222-2222-4222-8222-222222222222', phase: 'prepared' } });
  const reviews = ['root', 'independent'].map(role => record({ schemaVersion: 1, kind: 'fcos_exact_04ee_live_material_review',
    role, reviewer: role === 'root' ? '/root' : '/root/independent_review', disposition: 'accepted', contextSha256: context.sha256,
    candidateSha: policy.candidateSha, sourceDigest: policy.sourceDigest, lockHash: policy.lockHash,
    previewControlRevision: binding.previewControlRevision, configurationRevision: binding.configurationRevision, reviewedAt: iso(now - 30000) }));
  const rows = { context, root: reviews[0], independent: reviews[1] }, calls = [];
  const run = { id: runId, repository, head_repository: repository, head_sha: harnessSha, head_branch: 'main', event: 'workflow_dispatch',
    path: '.github/workflows/preview-email-proof-build.yml', run_attempt: 1, status: 'in_progress', run_started_at: iso(now - 10000) };
  const branch = { name: 'main', protected: true, commit: { sha: harnessSha } };
  const protection = { enforce_admins: { enabled: true }, required_status_checks: { strict: true,
    checks: FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context => ({ context, app_id: FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId })) } };
  const reads = { json(endpoint) {
    calls.push(endpoint);
    if (endpoint === 'user') return { id: 1, login: fcosConnectionIdentifier('github', 'Required account') };
    if (endpoint === `repos/${repository.full_name}`) return repository;
    if (endpoint.endsWith('/branches/main')) return branch;
    if (endpoint.endsWith('/branches/main/protection')) return protection;
    if (endpoint.endsWith(`/actions/runs/${runId}`)) return run;
    for (const [role, file] of Object.entries(policy.materials)) if (endpoint === `repos/${repository.full_name}/contents/${file}?ref=${harnessSha}`) {
      const body = rows[role].body;
      return { type: 'file', path: file, encoding: 'base64', content: body.toString('base64'),
        sha: createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex') };
    }
    throw new Error('Unrecognized fixture-only read.');
  } };
  return { binding, context, reviews, rows, reads, run, branch, protection, calls };
}
function replaceContext(value, alter) {
  alter(value.context.value); value.context = record(value.context.value); value.rows.context = value.context;
  value.reviews = value.reviews.map(review => record({ ...review.value, contextSha256: value.context.sha256 }));
  value.rows.root = value.reviews[0]; value.rows.independent = value.reviews[1];
}

test('portable exact source uses immutable272 plus exactly3 frozen control blobs and rejects supplement tampering', () => {
  assert.equal(controlManifest.objects.length, 3); assert.equal(controlManifest.mandatoryCandidateControls.length, 13);
  assert.equal(controls.controlFiles.candidate.length, 13);
  assert.deepEqual(controls.controlFiles.candidate.map(([file, sha]) => [file, sha]),
    controlManifest.mandatoryCandidateControls.map(row => [row.path, row.sha256]));
  assert.throws(() => validateControlManifest(Buffer.concat([controlManifestBytes, Buffer.from(' ')])), /manifest differs/);
  for (const bytes of [controlPack.subarray(0, controlPack.length - 12), Buffer.from(controlPack)]) {
    if (bytes.length === controlPack.length) bytes[bytes.length - 1] ^= 1;
    const directory = mkdtempSync(join(tmpdir(), 'fcos-invalid-control-pack-'));
    try {
      execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', '--bare', directory]);
      assert.throws(() => execFileSync('git', ['--no-replace-objects', '--git-dir', directory, 'index-pack', '--stdin'],
        { input: bytes, stdio: ['pipe', 'pipe', 'pipe'] }));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('real GitHub seconds timestamps bind genuine original intent/job and cannot be renewed or cross-run mixed', async () => {
  const value = fixture(); value.run.run_started_at = '2026-10-09T01:59:50Z';
  const admission = await collectSuccessorLiveAdmission({ ...value, sourceCwd: trustedCwd, trustedCwd, now });
  assert.equal(admission.dispatchedAt, value.run.run_started_at);
  const records = successorRecords(admission), intent = createPreviewEmailBuildIntent({ candidateSha: policy.candidateSha,
    harnessSha, controlRevision: controls.previewControlRevision, runId: 99, operationId, records, admission, now });
  const reviewer = { id: 1, login: fcosConnectionIdentifier('github', 'Required account') };
  Object.assign(value.run, { name: 'FCOS protected Preview email proof build', display_title: `Review FCOS Preview email source ${policy.candidateSha}`,
    actor: reviewer, triggering_actor: reviewer });
  const environment = { id: 5, name: 'fcos-runtime-compatibility-release', can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer }] }] };
  const job = { id: 9, run_id: 99, run_attempt: 1, name: 'proof', workflow_name: value.run.name, head_sha: harnessSha,
    head_branch: 'main', started_at: '2026-10-09T01:59:52Z', completed_at: null, conclusion: null, status: 'in_progress' };
  const directory = mkdtempSync(join(tmpdir(), 'fcos-original-intent-'));
  let archive;
  try {
    writeFileSync(join(directory, 'fcos-preview-email-intent.json'), JSON.stringify(intent));
    execFileSync('/usr/bin/zip', ['-q', 'archive.zip', 'fcos-preview-email-intent.json'], { cwd: directory });
    archive = readFileSync(join(directory, 'archive.zip'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const artifact = { id: 7, name: 'fcos-preview-email-intent-99', expired: false,
    workflow_run: { id: 99, head_sha: harnessSha }, digest: `sha256:${digest(archive)}` };
  const originalReads = value.reads.json;
  value.reads.json = endpoint => {
    if (endpoint.endsWith('/actions/runs/99/attempts/1/jobs?per_page=100&page=1')) return { total_count: 1, jobs: [job] };
    if (endpoint.endsWith('/environments/fcos-runtime-compatibility-release')) return environment;
    if (endpoint.endsWith('/actions/runs/99/approvals')) return [{ state: 'approved', user: reviewer, environments: [environment] }];
    if (endpoint.endsWith('/actions/runs/99/artifacts?per_page=100&page=1')) return { total_count: 1, artifacts: [artifact] };
    for (const [file] of admission.controlFiles.trusted) if (endpoint === `repos/${repository.full_name}/contents/${file}?ref=${harnessSha}`) {
      const body = readFileSync(join(trustedCwd, file)); return { type: 'file', path: file, encoding: 'base64', content: body.toString('base64'),
        sha: createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex') };
    }
    return originalReads(endpoint);
  };
  value.reads.archive = endpoint => { assert.ok(endpoint.endsWith('/actions/artifacts/7/zip')); return archive; };
  const args = { reads: value.reads, runId: 99, candidateSha: policy.candidateSha, admission, now, withTrust: true };
  const original = await collectTrustedPreviewEmailIntent(args);
  assert.equal(assertTrustedPreviewEmailIntentRecord(original, { admission, now }).trust.jobStartedAt, job.started_at);
  const issuance = `  ${JSON.stringify({ receipt: { context: { repositoryId: 7, environmentId: 5, runId: 99, runAttempt: 1,
    operation: 'create', harnessSha, candidateSha: policy.candidateSha, controlRevision: intent.controlRevision,
    contractSha256: admission.contractSha256 }, observedAt: now, issuedAt: now, expiresAt: now + 600000 } })}\n`;
  const binding = coordinationBindingFromOriginal({ admission, original, issuanceEnvelope: issuance, now });
  assert.equal(binding.jobStartedAt, job.started_at); assert.equal(binding.dispatchedAt, value.run.run_started_at);
  assert.equal(binding.issuanceEnvelopeSha256, digest(issuance));
  assert.throws(() => assertTrustedPreviewEmailIntentRecord(structuredClone(original), { admission, now }));
  const other = fixture(100), otherAdmission = await collectSuccessorLiveAdmission({ ...other, sourceCwd: trustedCwd, trustedCwd, now });
  assert.throws(() => assertTrustedPreviewEmailIntentRecord(original, { admission: otherAdmission, now }));
  await assert.rejects(() => collectTrustedPreviewEmailIntent({ ...args, admission: otherAdmission }));
  assert.throws(() => coordinationBindingFromOriginal({ admission: otherAdmission, original, issuanceEnvelope: issuance, now }));
  for (const alter of [() => { job.started_at = '2026-10-09T01:29:59Z'; }, () => { job.run_attempt = 2; },
    () => { job.workflow_name = value.run.display_title; }]) {
    const before = structuredClone(job); alter(); await assert.rejects(() => collectTrustedPreviewEmailIntent(args)); Object.assign(job, before);
  }
  assert.throws(() => successorLiveSelection(admission, policy.candidateSha, now + 1800001));
  for (const timestamp of ['2026-10-09T01:29:59Z', '2026-10-09T02:00:01Z', '2026-02-30T01:59:50Z']) {
    const changed = fixture(); changed.run.run_started_at = timestamp;
    await assert.rejects(() => collectSuccessorLiveAdmission({ ...changed, sourceCwd: trustedCwd, trustedCwd, now }));
  }
});

test('genuine exact admission reaches fixed attest preflight but cannot grant private/publication access', async () => {
  const value = fixture(), admission = await collectSuccessorLiveAdmission({ ...value, sourceCwd: trustedCwd, trustedCwd, now });
  const nonce = '11111111-1111-4111-8111-111111111111', scriptSha256 = 'e'.repeat(64);
  const approval = { schemaVersion: 1, action: 'attest', purpose: SUCCESSOR_ATTEST_PURPOSE, authorized: true,
    authorizedBy: fcosConnectionIdentifier('github', 'Required account'), authorizationEvidence: 'OFFLINE PERSONAL APPROVAL FIXTURE',
    authorizedAt: now - 1000, attestorNewPurposeAuthorized: true, scriptSha256, canonicalHelperSha256: SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256,
    nonce, target: successorAttestationPlan().target, candidateSha: policy.candidateSha, sourceDigest: policy.sourceDigest, lockHash: policy.lockHash,
    harnessSha: admission.harnessSha, controlRevision: admission.context.previewControlRevision, configurationRevision: admission.context.configurationRevision,
    contractSha256: admission.contractSha256, enrollmentId: '22222222-2222-4222-8222-222222222222', tokenId: 'OFFLINE_EXISTING_TOKEN',
    expiresAt: now + 3600000, leaseDeadline: now + 3600000, runId: 99, runAttempt: 1, operation: 'create',
    secretMetadata: ['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_VERCEL_ENROLLMENT',
      'FCOS_E2E_VERCEL_BYPASS', 'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN', 'FCOS_RELEASE_RUNTIME_TOKEN'].map(name => ({ name,
      created_at: iso(now - 60000), updated_at: iso(now - 10000) })),
    privateReadinessAt: now - 2000, enrollmentStateSha256: '1'.repeat(64),
    privateActionEvidence: { path: '/Users/vincex/Documents/FCOS/.fcos-cli/OFFLINE-authority.json', sha256: '2'.repeat(64) },
    rootReview: { path: '/Users/vincex/Documents/FCOS/.fcos-cli/OFFLINE-root.json', sha256: '3'.repeat(64) },
    independentReview: { path: '/Users/vincex/Documents/FCOS/.fcos-cli/OFFLINE-independent.json', sha256: '4'.repeat(64) },
    authorityBasis: { kind: 'existing_direct_human_authorization', localReviewGrantsAuthority: false,
      citations: [{ path: '/Users/vincex/Documents/FCOS/.fcos-cli/OFFLINE-citation.json', sha256: '5'.repeat(64) }] },
    jobId: 100, jobStartedAt: iso(now - 10000), dispatchedAt: iso(now - 15000),
    operationId: `fcos-preview-vercel-attestation-99-${nonce}` };
  const input = { approval, nonce, scriptSha256, admission, now };
  assert.equal(bindSuccessorAttestationAdmission(input), admission);
  for (const changed of [structuredClone(admission), undefined]) assert.throws(() => bindSuccessorAttestationAdmission({ ...input, admission: changed }));
  for (const alter of [a => { a.runId++; }, a => { a.harnessSha = 'f'.repeat(40); }, a => { a.controlRevision = 'f'.repeat(64); },
    a => { a.configurationRevision = 'f'.repeat(64); }, a => { a.contractSha256 = 'f'.repeat(64); }]) {
    const altered = structuredClone(approval); alter(altered); assert.throws(() => bindSuccessorAttestationAdmission({ ...input, approval: altered }));
  }
  assert.throws(() => bindSuccessorAttestationAdmission({ ...input, now: now + 1800001 }));
  let fixedReads = 0, privateAccesses = 0;
  const forbidden = new Proxy({}, { get() { privateAccesses++; assert.fail('Private/provisioning/publication adapters must remain absent.'); } });
  await assert.rejects(() => runSuccessorAttestationAdmission({ action: 'attest', approval, nonce, scriptSha256,
    collectAdmission: async () => admission, preflightFixedReads: async a => { fixedReads++; assert.equal(Object.isFrozen(a), true); },
    io: forbidden, now: () => now }), error => error.code === 'EXACT_SUCCESSOR_CANONICAL_PUBLICATION_ADMISSION_REQUIRED');
  assert.equal(fixedReads, 1); assert.equal(privateAccesses, 0);
  let current = now;
  await assert.rejects(() => runSuccessorAttestationAdmission({ action: 'attest', approval, nonce, scriptSha256,
    collectAdmission: async () => admission, preflightFixedReads: async () => { current += 1800001; }, now: () => current }));
});

test('exact static contract and recomputed immutable source are separate from all live authority', () => {
  assert.equal(assertSuccessorLiveSource(sourceProof).sourceVerified, true);
  assert.equal(assertSuccessorLiveSource(sourceProof).existingUi, false);
  assert.equal(sourceProof.installedAdmission, false);
  assert.equal(successorLivePlan().ready, false);
  assert.equal(successorLivePlan().previewAuthorized, false);
  const raw = readFileSync(new URL('../config/runtime-compatibility-successor-live.json', import.meta.url));
  assert.equal(assertSuccessorLiveContractBytes(raw).candidateSha, policy.candidateSha);
  for (const key of ['candidateSha', 'sourceDigest', 'lockHash', 'branch', 'existingUi', 'maxAgeSeconds', 'materials']) {
    const changed = JSON.parse(raw); changed[key] = null;
    assert.throws(() => assertSuccessorLiveContractBytes(Buffer.from(JSON.stringify(changed))));
  }
});

test('altered source, tree, scope review, dispatch transformation, observation and final candidate fail source admission', () => {
  for (const alter of [p => { p.candidateSha = policy.deferredFinalSha; }, p => { p.candidateGitTree = 'f'.repeat(40); },
    p => { p.candidateCanonicalTreeSha256 = 'f'.repeat(64); }, p => { p.scope.manifestSha256 = 'f'.repeat(64); },
    p => { p.scope.preservation.existingUi = true; }, p => { p.scope.preservation.originalGuardDispatch = false; },
    p => { p.scope.stages[1].independentDispatchTransformationVerified = false; }, p => { p.observationSources.sourceVerified = false; },
    p => { p.scope.stages[0].scopeVerified = false; }, p => { p.productionAuthorized = true; }]) {
    const copy = structuredClone(sourceProof); alter(copy); assert.throws(() => assertSuccessorLiveSource(copy));
  }
});

test('exact reviewed context is accepted only with two distinct byte-bound root and independent materials', () => {
  const value = fixture();
  assert.equal(assertSuccessorLiveMaterials({ ...value, now }), true);
  for (const change of [v => { v.reviews.pop(); }, v => { v.reviews[1] = record({ ...v.reviews[1].value, reviewer: '/root' }); },
    v => { v.reviews[1] = record({ ...v.reviews[1].value, disposition: 'pending' }); },
    v => { v.reviews[1] = record({ ...v.reviews[1].value, contextSha256: 'f'.repeat(64) }); },
    v => { v.reviews[0] = record({ ...v.reviews[0].value, configurationRevision: 'f'.repeat(64) }); },
    v => { v.context.body = Buffer.from('{}'); }, v => { v.reviews[0].sha256 = 'f'.repeat(64); }]) {
    const changed = fixture(); change(changed); assert.throws(() => assertSuccessorLiveMaterials({ ...changed, now }));
  }
});

for (const [name, change] of [
  ['candidate', v => { v.candidateSha = policy.deferredFinalSha; }], ['branch', v => { v.branch = 'arbitrary-branch'; }],
  ['source', v => { v.sourceDigest = 'f'.repeat(64); }], ['lock', v => { v.lockHash = 'f'.repeat(64); }],
  ['config', v => { v.configurationRevision = 'f'.repeat(64); }], ['harness controls', v => { v.previewControlRevision = 'f'.repeat(64); }],
  ['consumed operation', v => { v.operation.phase = 'consumed'; }], ['caller acceptance boolean', v => { v.accepted = true; }],
  ['duplicate record IDs', v => { v.records.attachmentRecordId = v.records.clientRecordId; }],
  ['production signer record', v => { v.records.attachmentRecordId = 'A2bvwxE5lOKNYFUQ'; }],
  ['old provisioning', v => { v.provisionedAt = iso(now - 2700001); }], ['future provisioning', v => { v.provisionedAt = iso(now + 1); }],
]) test(`changed ${name} cannot qualify even when review byte hashes are rebuilt`, () => {
  const value = fixture(); replaceContext(value, change); assert.throws(() => assertSuccessorLiveMaterials({ ...value, now }));
});

test('positive offline protected-tree admission yields only an opaque data contract and exact Preview request', async () => {
  const value = fixture();
  const admission = await collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: trustedCwd, trustedCwd, now });
  assert.equal(successorLiveSelection(admission, policy.candidateSha, now), admission);
  assert.throws(() => successorLiveSelection(structuredClone(admission), policy.candidateSha, now));
  assert.throws(() => successorLiveSelection(admission, policy.deferredFinalSha, now));
  assert.throws(() => successorLiveSelection(admission, policy.candidateSha, now + 1800001));
  assert.equal(successorEmailContract(admission, now).contract.preview.candidates[0].sha, policy.candidateSha);
  const contract = successorLiveCollectionContract({ admission, now });
  assert.equal(contract.requiredModules.length, 15); assert.equal(contract.installed, false); assert.equal(contract.ready, false);
  assert.deepEqual(contract.maxAgeSeconds, { provisioning: 2700, dispatch: 1800, artifact: 1800, previewAuthority: 600 });
  const request = successorLivePreviewRequest({ admission, operationId, now });
  assert.deepEqual(Object.keys(request), ['name', 'project', 'gitSource', 'meta']);
  assert.equal(request.gitSource.sha, policy.candidateSha); assert.equal(request.gitSource.ref, policy.branch);
  assert.throws(() => successorLivePreviewRequest({ admission, operationId: operationId.replace('-99-', '-100-'), now }));
  assert.throws(() => executeSuccessorLiveAdapter({ admission, leaseHeld: true, consumed: false }), { code: 'EXACT_SUCCESSOR_SHARED_COORDINATOR_REQUIRED' });
  assert.equal(admission.previewAuthorized, false); assert.equal(admission.productionAuthorized, false); assert.equal(admission.credentialAuthority, false);
  assert.equal(value.calls.length, 8);
});

test('selection retains each original review age instead of renewing it at collection', async () => {
  for (const role of ['root', 'independent']) {
    const value = fixture();
    replaceContext(value, context => { context.provisionedAt = iso(now - 2000000); });
    value.reviews = value.reviews.map(review => record({ ...review.value, reviewedAt: iso(now - (review.value.role === role ? 1799000 : 30000)) }));
    value.rows.root = value.reviews[0]; value.rows.independent = value.reviews[1];
    const admission = await collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: trustedCwd, trustedCwd, now });
    assert.equal(admission.reviewedAt[role], iso(now - 1799000));
    assert.equal(Object.isFrozen(admission.reviewedAt), true);
    assert.equal(successorLiveSelection(admission, policy.candidateSha, now + 1000), admission);
    assert.throws(() => successorLiveSelection(admission, policy.candidateSha, now + 2000), { code: 'EXACT_SUCCESSOR_TRUSTED_SELECTION_REQUIRED' });
    assert.throws(() => successorEmailContract(admission, now + 2000), { code: 'EXACT_SUCCESSOR_TRUSTED_SELECTION_REQUIRED' });
    assert.throws(() => successorLiveCollectionContract({ admission, now: now + 2000 }), { code: 'EXACT_SUCCESSOR_TRUSTED_SELECTION_REQUIRED' });
    assert.throws(() => successorLivePreviewRequest({ admission, operationId, now: now + 2000 }), { code: 'EXACT_SUCCESSOR_TRUSTED_SELECTION_REQUIRED' });
  }
});

test('actual API Git blob, current harness, dispatch and account checks reject substitutes', async () => {
  for (const change of [v => { v.branch.commit.sha = 'f'.repeat(40); }, v => { v.protection.enforce_admins.enabled = false; },
    v => { v.run.run_started_at = iso(now - 1800001); }, v => { v.run.run_attempt = 2; },
    v => { v.run.path = '.github/workflows/production-release.yml'; }, v => { v.run.head_sha = 'f'.repeat(40); },
    v => { const read = v.reads.json; v.reads.json = endpoint => endpoint === 'user' ? { login: 'wrong', id: 1 } : read(endpoint); },
    v => { const read = v.reads.json; v.reads.json = endpoint => { const result = read(endpoint); return endpoint.includes('/contents/') ? { ...result, sha: 'f'.repeat(40) } : result; }; },
    v => { const read = v.reads.json; v.reads.json = endpoint => { if (endpoint.includes('/contents/')) throw Error('missing'); return read(endpoint); }; }]) {
    const value = fixture(); change(value);
    await assert.rejects(() => collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: trustedCwd, trustedCwd, now }));
  }
});

test('caller control hashes and dirty actual harness bytes cannot substitute computed clean provenance', async () => {
  const value = fixture(); value.binding.configurationRevision = 'f'.repeat(64);
  await assert.rejects(() => collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: trustedCwd, trustedCwd, now }),
    { code: 'EXACT_SUCCESSOR_ACTUAL_CONTROL_BINDING_REQUIRED' });
  assert.equal(value.calls.length, 0);
  const file = join(trustedCwd, 'scripts/lib/runtime-compatibility-successor-adapter.mjs'), original = readFileSync(file);
  try {
    writeFileSync(file, Buffer.concat([original, Buffer.from('\n// Unreviewed control change.\n')]));
    assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: trustedCwd }));
    const changed = fixture();
    await assert.rejects(() => collectSuccessorLiveAdmission({ reads: changed.reads, binding: changed.binding, sourceCwd: trustedCwd, trustedCwd, now }));
    assert.equal(changed.calls.length, 0);
  } finally { writeFileSync(file, original); }
});

test('replacement commits cannot substitute physical controls for raw pinned harness blobs', () => {
  const file = join(trustedCwd, 'AGENTS.md'), original = readFileSync(file);
  let alteredCommit, replacementCommit;
  try {
    writeFileSync(file, Buffer.concat([original, Buffer.from('\nUnreviewed raw commit control.\n')]));
    git(['add', '--', 'AGENTS.md']); git(['commit', '--quiet', '-m', 'Alter raw fixture control']);
    alteredCommit = git(['rev-parse', 'HEAD']).toString('utf8').trim();
    writeFileSync(file, original); git(['add', '--', 'AGENTS.md']); git(['commit', '--quiet', '-m', 'Restore replacement fixture control']);
    replacementCommit = git(['rev-parse', 'HEAD']).toString('utf8').trim();
    git(['update-ref', 'HEAD', alteredCommit]); git(['replace', alteredCommit, replacementCommit]);
    // Demonstrate the precise inherited-Git counterexample: the unchanged
    // collector sees a clean tree, but raw HEAD commits different control bytes.
    const substituted = collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true });
    assert.equal(substituted.gitDirty, false); assert.equal(substituted.commit, alteredCommit);
    assert.equal(git(['--no-replace-objects', 'show', `${alteredCommit}:AGENTS.md`]).equals(original), false);
    assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: trustedCwd }), { code: 'EXACT_SUCCESSOR_COMMITTED_CONTROL_BYTES_REQUIRED' });
    git(['replace', '-d', alteredCommit]); alteredCommit = null;
    git(['update-ref', 'HEAD', harnessSha]); git(['replace', harnessSha, replacementCommit]);
    // A replacement with identical allowlisted bytes must also fail: it could
    // otherwise falsify clean provenance for files outside this allowlist.
    assert.equal(collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true }).gitDirty, false);
    assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: trustedCwd }), { code: 'EXACT_SUCCESSOR_REPLACEMENT_REFS_FORBIDDEN' });
  } finally {
    for (const commit of [alteredCommit, harnessSha].filter(Boolean)) {
      if (git(['for-each-ref', '--format=%(refname)', `refs/replace/${commit}`]).length) git(['replace', '-d', commit]);
    }
    git(['update-ref', 'HEAD', harnessSha]); git(['read-tree', harnessSha]); writeFileSync(file, original);
  }
  assert.equal(successorLiveControlBinding({ trustedCwd, sourceCwd: trustedCwd }).harnessSha, harnessSha);
});

test('ambient Git repository selection and configuration overrides fail closed', { concurrency: false }, () => {
  for (const overrides of [
    { GIT_DIR: join(trustedCwd, '.git'), GIT_WORK_TREE: trustedCwd },
    { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'remote.origin.url', GIT_CONFIG_VALUE_0: `https://github.com/${repository.full_name}.git` },
  ]) {
    const original = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, overrides);
      assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: trustedCwd }), { code: 'EXACT_SUCCESSOR_AMBIENT_GIT_OVERRIDE_FORBIDDEN' });
    } finally {
      for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  }
});

test('trusted and source roots must be actual Git repository roots', () => {
  assert.throws(() => successorLiveControlBinding({ trustedCwd: join(trustedCwd, 'config'), sourceCwd: trustedCwd }), { code: 'EXACT_SUCCESSOR_REPOSITORY_ROOT_HEAD_REQUIRED' });
  assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: join(trustedCwd, 'config') }), { code: 'EXACT_SUCCESSOR_REPOSITORY_ROOT_HEAD_REQUIRED' });
});

test('historical defaults remain unchanged and successor build/signer require genuine operation-local admission', () => {
  for (const sha of [policy.candidateSha, policy.deferredFinalSha]) {
    assert.throws(() => previewEmailBuildCandidate(sha));
    if (sha === policy.candidateSha) assert.throws(() => legacyEmailCandidate(sha));
    else assert.equal(legacyEmailCandidate(sha), null);
  }
  assert.throws(() => previewEmailSignerEnabled(policy.candidateSha));
  assert.equal(previewEmailSignerEnabled(policy.deferredFinalSha), false);
  assert.equal(previewEmailBuildCandidate(policy.historicalCandidateSha).sha, policy.historicalCandidateSha);
  assert.equal(previewEmailSignerEnabled(policy.historicalCandidateSha), true);
});

function successorRecords(admission) {
  const baseline = JSON.parse(readFileSync(new URL('../config/legacy-email-baseline-proof.json', import.meta.url))).baseline;
  const records = Object.entries(baseline.records).map(([key, row]) => ({ ...row, key, type: 'sensitive', target: ['production'], gitBranch: null, comment: null }));
  for (const [key, field] of Object.entries({ FCOS_MICROSOFT_TENANT_ID: 'tenantRecordId', FCOS_MICROSOFT_CLIENT_ID: 'clientRecordId', FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET: 'attachmentRecordId' })) {
    records.push({ key, id: admission.candidate[field], type: key === 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET' ? 'sensitive' : 'plain', target: ['preview'],
      gitBranch: policy.branch, createdAt: now - 60000, updatedAt: now - 50000,
      comment: key === 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET' ? `Dedicated read-only Preview signing key ${admission.context.attachmentOperationId}; no Production credential copied` : null });
  }
  return { capturedAt: iso(now), projectId: fcosConnectionIdentifier('vercel', 'Project ID'), teamId: fcosConnectionIdentifier('vercel', 'Team ID'), complete: true, records };
}

test('accepted partial build integration binds material domains and still invokes zero execution callbacks', async () => {
  const value = fixture(), admission = await collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: trustedCwd, trustedCwd, now });
  const records = successorRecords(admission);
  assert.equal(previewEmailBuildCandidate(policy.candidateSha, { admission, now }).sha, policy.candidateSha);
  assert.equal(previewEmailBuildContract(policy.candidateSha, { admission, now }).contractSha256, admission.contractSha256);
  assert.notEqual(admission.contractSha256, PREVIEW_EMAIL_CONTRACT_SHA256);
  const intent = createPreviewEmailBuildIntent({ candidateSha: policy.candidateSha, harnessSha, controlRevision: controls.previewControlRevision,
    runId: 99, operationId, records, admission, now });
  assert.deepEqual(intent.request, createPreviewEmailBuildRequest({ candidateSha: policy.candidateSha, runId: 99, operationId, admission, now }));
  const receipt = { ...intent, kind: 'fcos_preview_email_build', capturedAt: iso(now + 1000), deployment: { id: 'dpl_Fixture04ee',
    url: 'https://fcos-fixture04-hocheunglai-6535s-projects.vercel.app', sha: policy.candidateSha, target: 'preview', state: 'READY', createdAt: now + 500,
    projectId: records.projectId, teamId: records.teamId, operationId } };
  const binding = { ...value.binding, deploymentId: receipt.deployment.id, candidateUrl: receipt.deployment.url };
  assert.equal(assertPreviewEmailBuildReceipt({ receipt, binding, records, admission, now: now + 1000 }), true);
  for (const alter of [r => { r.contractSha256 = PREVIEW_EMAIL_CONTRACT_SHA256; }, r => { r.controlRevision = 'f'.repeat(64); },
    r => { r.candidate.sha = policy.deferredFinalSha; }, r => { r.request.gitSource.ref = 'wrong-branch'; },
    r => { r.deployment.sha = policy.deferredFinalSha; }, r => { r.harnessSha = 'f'.repeat(40); }]) {
    const changed = structuredClone(receipt); alter(changed);
    assert.throws(() => assertPreviewEmailBuildReceipt({ receipt: changed, binding, records, admission, now: now + 1000 }));
  }
  assert.throws(() => assertPreviewEmailBuildReceipt({ receipt, binding, records, admission: structuredClone(admission), now: now + 1000 }));
  let callbacks = 0;
  const forbidden = () => { callbacks += 1; throw new Error('Execution callback must not run.'); };
  await assert.rejects(() => runControlledPreviewEmailBuild({ intent, mode: 'create', admission, now: () => now,
    authority: forbidden, journal: forbidden, create: forbidden, discover: forbidden, waitReady: forbidden, collectRecords: forbidden, readVersion: forbidden,
    leaseHeld: true, consumed: false }), { code: 'EXACT_SUCCESSOR_SHARED_COORDINATOR_REQUIRED' });
  assert.equal(callbacks, 0);
});

test('accepted partial signer integration authenticates raw three-file source and preserves the signed-envelope conjunction', async () => {
  const value = fixture(), admission = await collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: trustedCwd, trustedCwd, now });
  assert.equal(previewEmailSignerEnabled(policy.candidateSha, { admission, now }), true);
  const sourceHashes = previewEmailSignerSourceHashes(policy.candidateSha, { admission, now });
  assert.deepEqual(previewEmailSignerSourceProof({ commit: policy.candidateSha, cwd: trustedCwd, admission, now }), sourceHashes);
  const origin = 'https://fcos-fixture04-hocheunglai-6535s-projects.vercel.app';
  let posts = 0;
  const fetchImpl = async (url, options) => {
    posts += 1; assert.equal(url, `${origin}/api/functions/emailRouterAttachmentUrl`); assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), PREVIEW_EMAIL_SIGNER_BODY);
    const expires = now + 60000, payload = Buffer.from(JSON.stringify({ mailboxId: PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID, ...PREVIEW_EMAIL_SIGNER_BODY, expiresAt: expires })).toString('base64url');
    const token = `${payload}.${Buffer.alloc(32, 1).toString('base64url')}`;
    return { status: 200, ok: true, redirected: false, url, json: async () => ({ token, url: `/api/email-router-attachment?token=${encodeURIComponent(token)}`, expiresAt: iso(expires) }) };
  };
  const options = { origin, deploymentId: 'dpl_Fixture04ee', sha: policy.candidateSha, sourceDigest: policy.sourceDigest,
    bearerToken: 'offline-fixture-only', fetchImpl, cwd: trustedCwd, admission, now: () => now };
  const evidence = await collectPreviewEmailSignerEvidence(options);
  assert.equal(posts, 1); assert.equal(evidence.noAttachmentFetch, true);
  assert.equal(previewEmailSignerEvidenceVerified(evidence, { deployment: { id: options.deploymentId, sha: policy.candidateSha }, sourceDigest: policy.sourceDigest, admission, now }), true);
  for (const change of [{ admission: undefined }, { admission: structuredClone(admission) }, { sourceDigest: 'f'.repeat(64) }, { origin: 'https://foreign.example' }]) {
    await assert.rejects(() => collectPreviewEmailSignerEvidence({ ...options, ...change })); assert.equal(posts, 1);
  }
  const objectFile = join(trustedCwd, '.git/fcos-negative-blob'); writeFileSync(objectFile, 'Changed signer source fixture.\n');
  const replacement = git(['hash-object', '-w', objectFile]).toString('utf8').trim();
  for (const file of Object.keys(sourceHashes)) {
    const oid = admission.signerSource.blobIds[file];
    try {
      git(['replace', oid, replacement]);
      assert.throws(() => previewEmailSignerSourceProof({ commit: policy.candidateSha, cwd: trustedCwd, admission, now }));
      await assert.rejects(() => collectPreviewEmailSignerEvidence(options)); assert.equal(posts, 1);
    } finally { git(['replace', '-d', oid]); }
  }
  const original = process.env.GIT_DIR;
  try {
    process.env.GIT_DIR = join(trustedCwd, '.git');
    await assert.rejects(() => collectPreviewEmailSignerEvidence(options)); assert.equal(posts, 1);
  } finally { if (original === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = original; }
});

// These are public offline observation fixtures, never live/readiness evidence.
// Admission is minted through the real protected-material collector above, and
// baseline/build/signer/isolation validators below are the actual installed code.
async function conjunctionFixture() {
  const value = fixture(), admission = await collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: trustedCwd, trustedCwd, now });
  const records = successorRecords(admission), url = 'https://fcos-fixture04-hocheunglai-6535s-projects.vercel.app';
  const candidate = { id: 'dpl_Fixture04ee', url, sha: policy.candidateSha, target: 'preview', state: 'READY', createdAt: now + 500,
    teamId: records.teamId, projectId: records.projectId, operationId };
  const intent = createPreviewEmailBuildIntent({ candidateSha: policy.candidateSha, harnessSha, controlRevision: controls.previewControlRevision,
    runId: 99, operationId, records, admission, now });
  const receipt = { ...intent, kind: 'fcos_preview_email_build', capturedAt: iso(now + 1000), deployment: candidate };
  const signer = { schemaVersion: 1, kind: 'fcos_preview_email_signer', probe: 'synthetic_attachment_link_v1', capturedAt: iso(now + 1500),
    deploymentId: candidate.id, sha: candidate.sha, sourceDigest: policy.sourceDigest, mailboxRegistryId: PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID,
    result: 'pass', noAttachmentFetch: true, sourceHashes: previewEmailSignerSourceHashes(candidate.sha, { admission, now }) };
  const normal = { ...value.binding, kind: 'normal_role', deploymentId: candidate.id, candidateUrl: url, runId: 101, artifactId: 102,
    archiveDigest: 'c'.repeat(64), capturedAt: iso(now + 2000), emailSigner: signer,
    checks: parityPolicy.requiredModules.map(module => ({ module, role: 'administrator', result: 'pass',
      kind: parityPolicy.workflowModules.includes(module) ? 'workflow_read' : 'read', evidenceId: `offline-normal:${module}` })) };
  normal.browserIsolation = { schemaVersion: 1, kind: 'fcos_compatibility_browser_isolation', candidateUrl: url, candidateSha: candidate.sha,
    harnessSha, deploymentId: candidate.id, sourceDigest: policy.sourceDigest,
    guardian: { path: '/app-version.json', contentType: 'application/json', provenanceVerified: true, closed: true },
    backgroundSync: { excludedFeature: 'automatic_mailbox_sync', lockName: 'fcos:email-router-background-sync', mode: 'exclusive',
      sameContext: true, webLocks: true, broadcastChannel: true, acquiredBeforeNavigation: true,
      modules: parityPolicy.requiredModules.map(module => ({ module, before: true, after: true })), finalHeld: true, released: true },
    workspacePreferences: { handler: 'workspacePreferencesGet', initialized: true, responseVerified: true },
    telemetry: { excludedFeature: 'speed_insights', path: '/_vercel/speed-insights/script.js', method: 'GET', resourceType: 'script',
      noQuery: true, policy: 'abort_before_execution', abortedRequests: 0 }, blockedRequests: 0, contextClosed: true };
  const production = { id: LEGACY_EMAIL_BASELINE_CONTRACT.baseline.deploymentId, sha: LEGACY_EMAIL_BASELINE_CONTRACT.baseline.sha,
    url: LEGACY_EMAIL_BASELINE_CONTRACT.baseline.url, target: 'production', state: 'READY', createdAt: now - 60000,
    teamId: records.teamId, projectId: records.projectId };
  const proof = { schemaVersion: 1, contractId: LEGACY_EMAIL_BASELINE_CONTRACT.id, capturedAt: iso(now + 3000), records,
    build: { receipt, trust: { runId: 99, artifactId: 100, harnessSha, archiveDigest: 'd'.repeat(64), capturedAt: receipt.capturedAt } }, signer };
  const sourceHashes = Object.fromEntries(parityPolicy.requiredSourceHashes.map(key => [key, 'e'.repeat(64)]));
  sourceHashes.application = policy.sourceDigest;
  const observations = { schemaVersion: 1, provider: { provider: 'vercel', account: fcosConnectionIdentifier('vercel', 'Account'),
    teamId: records.teamId, projectId: records.projectId, repository: repository.full_name },
    source: { candidateHead: candidate.sha, hashes: sourceHashes },
    switchInventory: { keys: [...parityPolicy.applicationKeys.switchMatch, ...Object.keys(parityPolicy.intentionalDifferences).filter(key => key !== 'VERCEL_ENV')],
      sourceFiles: ['api/_externalActionGates.js'], sourceHash: policy.sourceDigest }, legacyEmailBaseline: proof, legacyEmailNormal: normal,
    coverage: { capturedAt: normal.capturedAt, deploymentId: normal.deploymentId, sha: normal.sha, checks: structuredClone(normal.checks) } };
  const known = value => ({ state: 'known', value });
  for (const [name, deployment] of [['production', production], ['candidate', candidate]]) {
    const preview = name === 'candidate', bound = { capturedAt: iso(now + 3000), deploymentId: deployment.id, sha: deployment.sha };
    const keys = Object.fromEntries(parityPolicy.applicationKeys.switchMatch.map(key => [key, known(key.includes('PASSWORD') ? 'false' : 'true')]));
    for (const [key, exception] of Object.entries(parityPolicy.intentionalDifferences)) {
      const raw = preview ? exception.candidate : exception.production ?? 'false', selected = Array.isArray(raw) ? raw[0] : raw;
      keys[key] = selected === 'absent' ? { state: 'absent' } : known(selected);
    }
    for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'SALESFORCE_JWT_PRIVATE_KEY', 'XERO_CLIENT_SECRET', 'XERO_REFRESH_TOKEN']) keys[key] = { state: 'unknown', present: true };
    Object.assign(keys, { SALESFORCE_JWT_USERNAME: known('offline-user'), SALESFORCE_JWT_CLIENT_ID: known('offline-client'),
      XERO_CLIENT_ID: known('offline-client'), XERO_TENANT_ID: known('offline-tenant'), VERCEL_GIT_COMMIT_SHA: known(deployment.sha) });
    if (preview) keys.FCOS_EXPECTED_SOURCE_SHA256 = known(policy.sourceDigest);
    const flags = list => Object.fromEntries(list.map(key => [key, known(keys[key].value === 'true')]));
    observations[name] = { deployment, env: { ...bound, updatedAt: now - 70000, keys }, compiled: { ...bound, flags: flags(parityPolicy.compiledFlags) },
      runtime: { ...bound, flags: flags(parityPolicy.runtimeFlags), safety: { readOnly: preview,
        externalActions: Object.fromEntries(parityPolicy.externalActions.map(key => [key, !preview])) },
      auth: { supabase: { state: 'authenticated', target: fcosConnectionIdentifier('supabase', 'Project ref'), mode: 'service_role' },
        salesforce: { state: 'authenticated', target: fcosSalesforceEnvironment('production').orgId, mode: 'jwt' },
        xero: { state: 'authenticated', target: 'offline-tenant', mode: 'oauth' } } } };
  }
  return { admission, observations, options: { expectedCommit: candidate.sha, sourceHashes, admission, now: now + 3000 }, candidate, normal, proof };
}

test('exact04ee real validators accept the complete offline conjunction and reject absent/known/equal-key bypasses', async () => {
  const value = await conjunctionFixture();
  assert.equal(assertLegacyEmailBaselineProof({ proof: value.proof, normal: value.normal, candidate: value.candidate,
    production: value.observations.production.deployment, sourceDigest: policy.sourceDigest, admission: value.admission, now: now + 3000 }), true);
  const positive = evaluatePreviewParity(value.observations, value.options);
  assert.equal(positive.pass, true, JSON.stringify(positive.blockers));
  for (const keyMode of ['absent', 'known-equal']) {
    const observations = structuredClone(value.observations);
    for (const key of LEGACY_EMAIL_BASELINE_CONTRACT.historicalKeys) for (const name of ['production', 'candidate']) {
      if (keyMode === 'absent') delete observations[name].env.keys[key];
      else observations[name].env.keys[key] = { state: 'known', value: 'offline-equal-public-fixture' };
    }
    delete observations.legacyEmailBaseline;
    const result = evaluatePreviewParity(observations, value.options);
    assert.equal(result.pass, false);
    assert.ok(result.blockers.some(row => row.code === 'EXACT_SUCCESSOR_BASELINE_CONJUNCTION_REQUIRED'), keyMode);
  }
});

test('exact04ee conjunction rejects forged, stale, foreign, incomplete normal records and broken build/signer/isolation', async () => {
  const value = await conjunctionFixture();
  const changes = [o => { o.legacyEmailNormal.kind = 'ci'; }, o => { o.legacyEmailNormal.capturedAt = iso(now - 1800001); },
    o => { o.legacyEmailNormal.deploymentId = 'dpl_Foreign'; }, o => { o.legacyEmailNormal.harnessSha = 'f'.repeat(40); },
    o => { o.legacyEmailNormal.sourceDigest = 'f'.repeat(64); }, o => { o.legacyEmailNormal.lockHash = 'f'.repeat(64); },
    o => { o.legacyEmailNormal.configurationRevision = 'f'.repeat(64); }, o => { o.legacyEmailNormal.browserIsolation.contextClosed = false; },
    o => { o.legacyEmailBaseline.build.trust.capturedAt = iso(now + 1100); }, o => { o.legacyEmailBaseline.build.receipt.contractSha256 = PREVIEW_EMAIL_CONTRACT_SHA256; },
    o => { o.legacyEmailBaseline.signer.sourceHashes = {}; }, o => { o.legacyEmailNormal.emailSigner.noAttachmentFetch = false; }];
  for (const module of parityPolicy.requiredModules) changes.push(o => { o.legacyEmailNormal.checks = o.legacyEmailNormal.checks.filter(row => row.module !== module); });
  for (const alter of changes) {
    const observations = structuredClone(value.observations); alter(observations);
    const result = evaluatePreviewParity(observations, value.options);
    assert.equal(result.pass, false); assert.ok(result.blockers.some(row => row.code === 'EXACT_SUCCESSOR_BASELINE_CONJUNCTION_REQUIRED'));
  }
  assert.throws(() => successorLiveNormalCoverageVerified({ admission: structuredClone(value.admission), normal: value.normal, candidate: value.candidate, now: now + 3000 }));
});

test('exact04ee parity coverage is the same normal record and observed application is the selected source', async () => {
  const value = await conjunctionFixture();
  for (const alter of [o => { o.coverage.capturedAt = iso(now + 2100); }, o => { o.coverage.checks[0].evidenceId += '-other-record'; },
    o => { o.coverage.checks.reverse(); }, o => { o.coverage.extra = true; }]) {
    const observations = structuredClone(value.observations); alter(observations);
    const result = evaluatePreviewParity(observations, value.options);
    assert.equal(result.pass, false); assert.ok(result.blockers.some(row => row.code === 'EXACT_SUCCESSOR_NORMAL_COVERAGE_BINDING_REQUIRED'));
  }
  const observations = structuredClone(value.observations); observations.source.hashes.application = 'f'.repeat(64);
  const result = evaluatePreviewParity(observations, { ...value.options, sourceHashes: observations.source.hashes });
  assert.equal(result.pass, false); assert.ok(result.blockers.some(row => row.code === 'EXACT_SUCCESSOR_APPLICATION_SOURCE_REQUIRED'));
});

test('exact04ee compatibility consumes the same authenticated normal archive and keeps actual release blocked', async () => {
  const value = await conjunctionFixture(), original = fixture();
  const archive = Buffer.from('Offline exact normal archive fixture.');
  const binding = { ...original.binding, deploymentId: value.candidate.id, candidateUrl: value.candidate.url };
  const run = { ...original.run, id: 101, status: 'completed', conclusion: 'success', updated_at: iso(now + 2500),
    path: '.github/workflows/runtime-compatibility-normal-role.yml' };
  const artifact = { id: 102, name: `fcos-compatibility-normal-role-evidence-${policy.candidateSha}`, expired: false,
    workflow_run: { id: run.id, head_sha: harnessSha }, digest: `sha256:${digest(archive)}` };
  const payload = { ...value.normal, schemaVersion: 1, baseSha: LEGACY_EMAIL_BASELINE_CONTRACT.baseline.sha, candidateSha: policy.candidateSha };
  const input = { repository, branch: original.branch, protection: original.protection, run, artifact, archive, payload,
    binding, candidate: value.candidate, admission: value.admission, now: now + 3000 };
  const normal = assertCompatibilityNormalArtifact(input);
  assert.equal(normal.archiveDigest, digest(archive)); assert.equal(normal.capturedAt, value.normal.capturedAt);
  for (const alter of [p => { delete p.emailSigner; }, p => { delete p.lockHash; }, p => { p.configurationRevision = 'f'.repeat(64); },
    p => { p.checks.pop(); }, p => { p.browserIsolation.blockedRequests = 1; }]) {
    const changed = structuredClone(payload); alter(changed);
    assert.throws(() => assertCompatibilityNormalArtifact({ ...input, payload: changed }));
  }
  assert.throws(() => assertCompatibilityNormalArtifact({ ...input, admission: structuredClone(value.admission) }));
  assert.throws(() => assertCompatibilityNormalArtifact({ ...input, archive: Buffer.from('substitute') }));
  assert.equal(compatibilityOperationScopeVerified(value.admission.sourceReceipt, { binding, admission: value.admission, now: now + 3000 }), true);
  assert.equal(compatibilityOperationScopeVerified(structuredClone(value.admission.sourceReceipt), { binding, admission: value.admission, now: now + 3000 }), false);
  const report = createRuntimeCompatibilityPreflight({ binding, scope: value.admission.sourceReceipt, candidate: value.candidate,
    trustedEvidence: [normal], admission: value.admission, now: now + 3000 });
  assert.equal(report.checks.source, true); assert.equal(report.checks.normal_role, true); assert.equal(report.ready, false);
  assert.ok(report.blockers.some(row => row.code === 'EXACT_SUCCESSOR_SHARED_COORDINATOR_REQUIRED'));
  assert.ok(report.blockers.some(row => row.code === 'COMPATIBILITY_ENVIRONMENT_APPROVAL_REQUIRED'));
  let callbacks = 0;
  await assert.rejects(() => executeRuntimeCompatibilityRelease({ preflight: { ...report, ready: true, blockers: [] },
    authority: () => { callbacks++; }, deploy: () => { callbacks++; }, leaseHeld: true }), { code: 'EXACT_SUCCESSOR_SHARED_COORDINATOR_REQUIRED' });
  assert.equal(callbacks, 0);
});

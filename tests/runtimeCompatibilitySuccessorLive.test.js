import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { verifyRuntimeCompatibilitySuccessorSource } from '../scripts/verify-runtime-compatibility-successor.mjs';
import { collectBuildProvenance } from '../scripts/lib/build-provenance.mjs';
import { SUCCESSOR_LIVE_CONTRACT as policy, SUCCESSOR_LIVE_CONTRACT_SHA256, assertSuccessorLiveContractBytes,
  assertSuccessorLiveSource, assertSuccessorLiveMaterials, collectSuccessorLiveAdmission,
  successorLiveSelection, successorEmailContract, successorLivePlan,
  SUCCESSOR_LIVE_HARNESS_FILES, successorLiveControlBinding } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { successorLiveCollectionContract, successorLivePreviewRequest, executeSuccessorLiveAdapter } from '../scripts/lib/runtime-compatibility-successor-adapter.mjs';
import { previewEmailBuildCandidate } from '../scripts/lib/preview-email-build.mjs';
import { previewEmailSignerEnabled } from '../scripts/lib/preview-email-signer.mjs';
import { legacyEmailCandidate } from '../scripts/lib/legacy-email-baseline-proof.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const now = Date.parse('2026-10-09T02:00:00.000Z'), iso = value => new Date(value).toISOString();
const digest = value => createHash('sha256').update(value).digest('hex');
const repository = { id: 7, full_name: fcosConnectionIdentifier('github', 'Repository'), default_branch: 'main' };
const sourceProof = verifyRuntimeCompatibilitySuccessorSource({ cwd, candidateCommit: policy.candidateSha });
// A small clean offline Git fixture contains the exact actual allowlisted
// harness bytes. It has no operational credentials and is never published.
const trustedCwd = mkdtempSync(join(tmpdir(), 'fcos-04ee-clean-harness-'));
after(() => rmSync(trustedCwd, { recursive: true, force: true }));
for (const file of SUCCESSOR_LIVE_HARNESS_FILES) {
  const target = join(trustedCwd, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, readFileSync(join(cwd, file)));
}
const git = args => execFileSync('git', ['-c', 'init.templateDir=', '-c', 'commit.gpgsign=false', ...args], { cwd: trustedCwd,
  env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Offline fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Offline fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
  stdio: ['ignore', 'pipe', 'pipe'] });
git(['init', '--quiet']); git(['remote', 'add', 'origin', `https://github.com/${repository.full_name}.git`]);
git(['add', '--all']); git(['commit', '--quiet', '-m', 'Exact public control-byte fixture']);
const controls = successorLiveControlBinding({ trustedCwd, sourceCwd: cwd });
const harnessSha = controls.harnessSha, operationId = 'fcos-preview-email-99-12345678-1234-4123-8123-123456789abc';
const record = value => { const body = Buffer.from(`${JSON.stringify(value)}\n`); return { body, value, sha256: digest(body) }; };
function fixture() {
  const binding = { sha: policy.candidateSha, sourceDigest: policy.sourceDigest, lockHash: policy.lockHash,
    candidateTreeHash: policy.candidateTreeHash, harnessSha, previewControlRevision: controls.previewControlRevision, configurationRevision: controls.configurationRevision, runId: 99 };
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
  const run = { id: 99, repository, head_repository: repository, head_sha: harnessSha, head_branch: 'main', event: 'workflow_dispatch',
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
    if (endpoint.endsWith('/actions/runs/99')) return run;
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
  const admission = await collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: cwd, trustedCwd, now });
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
    const admission = await collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: cwd, trustedCwd, now });
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
    await assert.rejects(() => collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: cwd, trustedCwd, now }));
  }
});

test('caller control hashes and dirty actual harness bytes cannot substitute computed clean provenance', async () => {
  const value = fixture(); value.binding.configurationRevision = 'f'.repeat(64);
  await assert.rejects(() => collectSuccessorLiveAdmission({ reads: value.reads, binding: value.binding, sourceCwd: cwd, trustedCwd, now }),
    { code: 'EXACT_SUCCESSOR_ACTUAL_CONTROL_BINDING_REQUIRED' });
  assert.equal(value.calls.length, 0);
  const file = join(trustedCwd, 'scripts/lib/runtime-compatibility-successor-adapter.mjs'), original = readFileSync(file);
  try {
    writeFileSync(file, Buffer.concat([original, Buffer.from('\n// Unreviewed control change.\n')]));
    assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: cwd }));
    const changed = fixture();
    await assert.rejects(() => collectSuccessorLiveAdmission({ reads: changed.reads, binding: changed.binding, sourceCwd: cwd, trustedCwd, now }));
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
    assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: cwd }), { code: 'EXACT_SUCCESSOR_COMMITTED_CONTROL_BYTES_REQUIRED' });
    git(['replace', '-d', alteredCommit]); alteredCommit = null;
    git(['update-ref', 'HEAD', harnessSha]); git(['replace', harnessSha, replacementCommit]);
    // A replacement with identical allowlisted bytes must also fail: it could
    // otherwise falsify clean provenance for files outside this allowlist.
    assert.equal(collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true }).gitDirty, false);
    assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: cwd }), { code: 'EXACT_SUCCESSOR_REPLACEMENT_REFS_FORBIDDEN' });
  } finally {
    for (const commit of [alteredCommit, harnessSha].filter(Boolean)) {
      if (git(['for-each-ref', '--format=%(refname)', `refs/replace/${commit}`]).length) git(['replace', '-d', commit]);
    }
    git(['update-ref', 'HEAD', harnessSha]); git(['read-tree', harnessSha]); writeFileSync(file, original);
  }
  assert.equal(successorLiveControlBinding({ trustedCwd, sourceCwd: cwd }).harnessSha, harnessSha);
});

test('ambient Git repository selection and configuration overrides fail closed', { concurrency: false }, () => {
  for (const overrides of [
    { GIT_DIR: join(trustedCwd, '.git'), GIT_WORK_TREE: trustedCwd },
    { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'remote.origin.url', GIT_CONFIG_VALUE_0: `https://github.com/${repository.full_name}.git` },
  ]) {
    const original = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, overrides);
      assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: cwd }), { code: 'EXACT_SUCCESSOR_AMBIENT_GIT_OVERRIDE_FORBIDDEN' });
    } finally {
      for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  }
});

test('trusted and source roots must be actual Git repository roots', () => {
  assert.throws(() => successorLiveControlBinding({ trustedCwd: join(trustedCwd, 'config'), sourceCwd: cwd }), { code: 'EXACT_SUCCESSOR_REPOSITORY_ROOT_HEAD_REQUIRED' });
  assert.throws(() => successorLiveControlBinding({ trustedCwd, sourceCwd: join(cwd, 'config') }), { code: 'EXACT_SUCCESSOR_REPOSITORY_ROOT_HEAD_REQUIRED' });
});

test('historical executable build, signer and baseline routes remain unchanged and do not admit04ee or final', () => {
  for (const sha of [policy.candidateSha, policy.deferredFinalSha]) {
    assert.throws(() => previewEmailBuildCandidate(sha)); assert.equal(previewEmailSignerEnabled(sha), false); assert.equal(legacyEmailCandidate(sha), null);
  }
  assert.equal(previewEmailBuildCandidate(policy.historicalCandidateSha).sha, policy.historicalCandidateSha);
  assert.equal(previewEmailSignerEnabled(policy.historicalCandidateSha), true);
});

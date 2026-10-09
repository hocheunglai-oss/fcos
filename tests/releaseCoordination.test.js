import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { FCOS_RELEASE_APPROVAL_POLICY } from '../config/fcosConnections.js';
import { PREVIEW_COORDINATION_CANONICAL } from '../scripts/lib/preview-email-coordination.mjs';
import { RELEASE_COORDINATION_DOMAIN, RELEASE_COORDINATION_ROUTES, validateReleaseCoordinationBinding, releaseCoordinationDeadline,
  releaseCoordinationLeaseHash, releaseCoordinationGrantData, releaseCoordinationMessage, verifyReleaseCoordinationGrant,
  coordinationDigest, retainReleaseCoordinationReadiness, releaseCoordinationEvidenceDeadline } from '../scripts/lib/release-coordination.mjs';
import { assertReleaseCoordinationTrust, releaseCoordinationRows } from '../scripts/lib/release-coordination-trust.mjs';
import { releaseCoordinationVerified, consumeReleaseCoordination, collectHostedReleaseCoordination } from '../scripts/lib/release-coordination-transport.mjs';
import { assertReleaseCoordinatorApproval, assertReleaseCoordinatorSource, releaseCoordinatorMain } from '../scripts/release-coordinator-local.mjs';

const now = Date.parse('2026-10-10T00:00:00Z'), h = 'a'.repeat(64), sha = 'b'.repeat(40);
const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const clone = x => structuredClone(x);
function binding() { return { schemaVersion: 1, route: 'production', repositoryId: 123, environmentId: 45, runId: 99, runAttempt: 1, jobId: 678, harnessSha: sha,
  operationId: 'fcos-release-99', dispatchedAt: now - 60000, jobStartedAt: now - 50000, intentAt: now - 10000, readinessAt: now - 20000, evidenceExpiresAt: now + 1700000,
  candidate: { sha: 'c'.repeat(40), sourceDigest: h, lockHash: h, configurationRevision: h, deploymentId: 'dpl_preview', url: 'https://fcos-abc123456-hocheunglai-6535s-projects.vercel.app' },
  previousProduction: { deploymentId: 'dpl_previous', sha: 'd'.repeat(40), url: 'https://fcos-def123456-hocheunglai-6535s-projects.vercel.app' }, readinessSha256: h }; }
function grant(b = binding()) { return releaseCoordinationGrantData({ schemaVersion: 1, kind: 'fcos_production_coordination_grant', keyId: FCOS_CONNECTION_POLICY.attestation.keyId,
  repository: fcosConnectionIdentifier('github', 'Repository'), teamId: fcosConnectionIdentifier('vercel', 'Team ID'), projectId: fcosConnectionIdentifier('vercel', 'Project ID'),
  binding: b, intentArtifactId: 7, intentArchiveSha256: h,
  lease: { epoch: PREVIEW_COORDINATION_CANONICAL.epoch, objective: PREVIEW_COORDINATION_CANONICAL.objective, ownerThreadId: PREVIEW_COORDINATION_CANONICAL.ownerThreadId,
    operationId: b.operationId, bindingSha256: releaseCoordinationLeaseHash(b), leaseId: '11111111-1111-4111-8111-111111111111',
    coordinationOnly: true, providerAuthorityGranted: false, uncertainOutcomeRequiresReadback: true }, consumptionSha256: h, issuedAt: now, expiresAt: now + 300000,
  coordinationOnly: true, providerAuthorityGranted: false }); }
function envelope(g = grant(), domain = RELEASE_COORDINATION_DOMAIN) { return JSON.stringify({ grant: g, signature: sign(null, Buffer.from(domain + JSON.stringify(g)), keys.privateKey).toString('base64url') }); }
const verify = (text, b = binding(), t = now) => verifyReleaseCoordinationGrant(text, b, t, publicKey);
test('coordination signatures verify data only and cannot mint protected capabilities', async () => {
  assert.equal(verify(envelope()).grant.providerAuthorityGranted, false);
  assert.throws(() => verifyReleaseCoordinationGrant(envelope(), binding(), now));
  assert.equal(releaseCoordinationVerified(verify(envelope()), {}), false);
  await assert.rejects(() => consumeReleaseCoordination(verify(envelope()), {}, 'stage'));
  await assert.rejects(() => collectHostedReleaseCoordination({ route: 'production', readiness: { ready: true } }));
});
test('domain separation and exact original signature bytes prevent cross-purpose grants', () => {
  for (const domain of ['', 'FCOS-EXACT-04EE-COORDINATION-GRANT-V1\0', 'FCOS-PREVIEW-VERCEL-RUN-AUTHORITY-V1\0']) assert.throws(() => verify(envelope(grant(), domain)));
  const wrapper = JSON.parse(envelope()); wrapper.grant.consumptionSha256 = 'e'.repeat(64); assert.throws(() => verify(JSON.stringify(wrapper)));
  assert.equal(releaseCoordinationMessage(grant()).toString(), RELEASE_COORDINATION_DOMAIN + JSON.stringify(grant()));
});
for (const key of ['route', 'repositoryId', 'environmentId', 'runId', 'runAttempt', 'jobId', 'harnessSha', 'operationId', 'dispatchedAt', 'jobStartedAt', 'intentAt', 'readinessAt', 'evidenceExpiresAt', 'readinessSha256']) {
  test(`signed changed ${key} cannot replace the original operation`, () => {
    const b = binding(); b[key] = typeof b[key] === 'number' ? b[key] + 1 : key === 'route' ? 'compatibility' : b[key].replace(/.$/, '8');
    assert.throws(() => verify(envelope(grant(b))));
  });
}
for (const area of ['candidate', 'previousProduction']) for (const key of Object.keys(binding()[area])) {
  test(`signed changed ${area}.${key} cannot substitute source or deployment`, () => {
    const b = binding(); b[area][key] = key === 'url' ? 'https://fcos-foreign-hocheunglai-6535s-projects.vercel.app' : b[area][key].replace(/.$/, '9');
    assert.throws(() => verify(envelope(grant(b))));
  });
}
test('all original clocks expire independently without renewal', () => {
  for (const key of ['dispatchedAt', 'jobStartedAt', 'intentAt', 'readinessAt']) {
    const b = binding(); b[key] = now - 1800001; assert.throws(() => validateReleaseCoordinationBinding(b, now));
    b[key] = now + 30001; assert.throws(() => validateReleaseCoordinationBinding(b, now));
  }
  assert.equal(releaseCoordinationDeadline(binding()), now + 1700000);
  assert.throws(() => verify(envelope(), binding(), now + 300000));
  for (const change of [{ expiresAt: now + 1800001 }, { providerAuthorityGranted: true }, { coordinationOnly: false }, { keyId: 'foreign' }]) assert.throws(() => releaseCoordinationGrantData({ ...grant(), ...change }));
  assert.throws(() => releaseCoordinationGrantData({ ...grant(), lease: { ...grant().lease, ownerThreadId: 'foreign' } }));
  assert.throws(() => releaseCoordinationGrantData({ ...grant(), lease: { ...grant().lease, bindingSha256: '0'.repeat(64) } }));
});
function trust() {
  const b = binding(), route = RELEASE_COORDINATION_ROUTES[b.route], actor = { login: 'hocheunglai-oss', id: 42 };
  const vars = { FCOS_RELEASE_COORDINATION_ENABLED: 'true', FCOS_PRODUCTION_RELEASE_ENABLED: 'true', FCOS_REVIEWED_RELEASE_SHA: b.candidate.sha,
    FCOS_REVIEWED_SOURCE_SHA256: b.candidate.sourceDigest, FCOS_REVIEWED_CONFIGURATION_SHA256: b.candidate.configurationRevision };
  return { binding: b, now, repository: { id: 123, full_name: 'hocheunglai-oss/fcos', default_branch: 'main' }, branch: { name: 'main', protected: true, commit: { sha } },
    protection: { enforce_admins: { enabled: true }, required_status_checks: { strict: true, checks: FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context => ({ context, app_id: FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId })) } },
    environment: { id: 45, name: route.environment, can_admins_bypass: false, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: actor }] }] },
    variables: { total_count: Object.keys(vars).length, variables: Object.entries(vars).map(([name, value]) => ({ name, value })) },
    run: { id: 99, run_attempt: 1, status: 'in_progress', conclusion: null, event: 'workflow_dispatch', repository: { id: 123, full_name: 'hocheunglai-oss/fcos' },
      head_repository: { id: 123, full_name: 'hocheunglai-oss/fcos' }, head_sha: sha, head_branch: 'main', path: route.workflow, run_started_at: new Date(b.dispatchedAt).toISOString(), actor, triggering_actor: actor },
    jobs: { total_count: 1, jobs: [{ id: 678, name: `Approve release ${b.candidate.sha}`, run_id: 99, run_attempt: 1, head_sha: sha, status: 'in_progress', conclusion: null, started_at: new Date(b.jobStartedAt).toISOString() }] },
    approvals: [{ state: 'approved', user: actor, environments: [{ id: 45, name: route.environment }] }] };
}
test('actual metadata requires protected main, exact first job, personal approval and enabled source pins', () => {
  assert.equal(assertReleaseCoordinationTrust(trust()).reviewerId, 42);
  for (const alter of [t => t.branch.commit.sha = 'e'.repeat(40), t => t.run.path = '.github/workflows/routine-release.yml', t => t.run.run_attempt = 2,
    t => t.run.triggering_actor = { login: 'bot', id: 4 }, t => t.run.status = 'completed', t => t.jobs.jobs[0].run_id++, t => t.jobs.jobs[0].head_sha = 'e'.repeat(40),
    t => t.jobs.total_count++, t => t.jobs.jobs[0].name = 'foreign', t => t.approvals = [], t => t.approvals.push(clone(t.approvals[0])), t => t.approvals[0].user = { id: 3, login: 'other' },
    t => t.environment.can_admins_bypass = true, t => t.environment.protection_rules = [], t => t.variables.variables[0].value = 'false',
    t => t.variables.variables[2].value = 'e'.repeat(40), t => t.variables.total_count++, t => t.protection.required_status_checks.strict = false]) {
    const t = trust(); alter(t); assert.throws(() => assertReleaseCoordinationTrust(t));
  }
  assert.throws(() => releaseCoordinationRows({ total_count: 2, artifacts: [{ id: 1 }, { id: 1 }] }, 'artifacts'));
});
test('local action data requires exact purpose, original action/private windows and independent review references', async () => {
  const a = { schemaVersion: 1, kind: 'root_admitted_release_coordination_action', action: 'issue-coordination', purpose: RELEASE_COORDINATION_DOMAIN,
    nonce: '11111111-1111-4111-8111-111111111111', authorizedBy: 'hocheunglai-oss', scriptSha256: h, canonicalHelperSha256: PREVIEW_COORDINATION_CANONICAL.helperSha256,
    authorizedAt: now - 1, privateReadinessAt: now - 1, authorityBasis: { kind: 'existing_direct_human_authorization', localReviewGrantsAuthority: false, citations: [{ path: '/fixture', sha256: h }] },
    rootReview: { sha256: h }, independentReview: { sha256: 'f'.repeat(64) }, binding: binding() };
  assertReleaseCoordinatorApproval(a, a.nonce, h, now);
  for (const change of [{ authorizedAt: now - 1800000 }, { privateReadinessAt: now - 2700000 }, { authorizedAt: now + 1 },
    { authorizedBy: 'bot' }, { purpose: 'foreign' }, { scriptSha256: 'e'.repeat(64) }, { independentReview: a.rootReview }]) assert.throws(() => assertReleaseCoordinatorApproval({ ...a, ...change }, a.nonce, h, now));
  assert.equal((await releaseCoordinatorMain(['--plan'])).mutations, 0);
  assert.equal(coordinationDigest(envelope()).length, 64);
});


test('raw issuer source includes workflow/action/package controls and detects changes hidden from Git status', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fcos-release-source-'));
  const git = args => execFileSync('/usr/bin/git', args, { cwd, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' }).trim();
  try {
    git(['init', '-q']); git(['config', 'user.name', 'Offline fixture']); git(['config', 'user.email', 'fixture@example.test']);
    for (const path of ['scripts/check.mjs', 'config/policy.json', '.github/workflows/release.yml', '.github/actions/release/action.yml', '.codex/config.toml', 'AGENTS.md', 'package.json', 'package-lock.json']) {
      mkdirSync(join(cwd, path, '..'), { recursive: true }); writeFileSync(join(cwd, path), 'fixture original\n');
    }
    git(['add', '.']); git(['commit', '-qm', 'fixture source']); const head = git(['rev-parse', 'HEAD']);
    const paths = assertReleaseCoordinatorSource(cwd, head);
    assert.equal(paths.length, 8);
    for (const path of paths) {
      git(['update-index', '--assume-unchanged', path]); writeFileSync(join(cwd, path), 'changed hidden source\n');
      assert.equal(git(['status', '--porcelain']), '');
      assert.throws(() => assertReleaseCoordinatorSource(cwd, head), path);
      writeFileSync(join(cwd, path), 'fixture original\n'); git(['update-index', '--no-assume-unchanged', path]);
    }
    assert.equal(assertReleaseCoordinatorSource(cwd, head).length, 8);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('direct ledger entry cannot claim a lease using caller-supplied binding or a missing action admission', () => {
  const script = new URL('../scripts/lib/release-coordination-ledger.py', import.meta.url).pathname;
  for (const args of [['--claim'], ['--claim-approved', 'not-a-nonce'], ['--claim-approved', '00000000-0000-4000-8000-000000000000']]) {
    assert.throws(() => execFileSync('python3', ['-I', '-B', script, ...args], { input: JSON.stringify(binding()), stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }));
  }
});

test('new fingerprints cover all coordinator entrypoints and native workflow actions', async () => {
  const { RELEASE_COORDINATION_CONTROL_FILES: files } = await import('../scripts/lib/release-coordination-controls.mjs');
  const { PREVIEW_EMAIL_BUILD_CONTROL_FILES: preview } = await import('../scripts/lib/preview-email-build-controls.mjs');
  for (const path of files) assert.ok(preview.includes(path), path);
  assert.equal(new Set(files).size, files.length);
  for (const path of ['scripts/release-coordinator-local.mjs', 'scripts/lib/release-coordination-ledger.py', '.github/actions/release-executor/action.yml', 'scripts/production-release.mjs']) assert.ok(files.includes(path));
  const readiness = readFileSync(new URL('../scripts/lib/release-readiness.mjs', import.meta.url), 'utf8');
  assert.match(readiness, /const files = \[\.\.\.RELEASE_COORDINATION_CONTROL_FILES/);
});


test('fresh recollection preserves original readiness and cannot renew the coordinator clock or change evidence', () => {
  const original = { schemaVersion: 1, receiptKind: 'fcos_release_readiness', capturedAt: new Date(now - 60000).toISOString(),
    candidate: binding().candidate, previousProduction: binding().previousProduction, quality: { runId: 7 }, trustedEvidence: [],
    ready: true, productionAuthorized: false, blockers: [], limitation: 'Fixture consistency only' };
  const fresh = { ...original, capturedAt: new Date(now).toISOString() };
  assert.equal(retainReleaseCoordinationReadiness(original, fresh, now), original);
  for (const change of [{ quality: { runId: 8 } }, { previousProduction: { ...original.previousProduction, sha: 'e'.repeat(40) } },
    { capturedAt: new Date(now - 120000).toISOString() }, { ready: false }, { productionAuthorized: true }]) {
    assert.throws(() => retainReleaseCoordinationReadiness(original, { ...fresh, ...change }, now));
  }
  assert.throws(() => retainReleaseCoordinationReadiness(original, { ...fresh, capturedAt: new Date(now + 1800000).toISOString() }, now + 1800000));
});


test('original browser and quality completion clocks bound a grant even when readiness was captured just now', () => {
  const receipt = { schemaVersion: 1, receiptKind: 'fcos_release_readiness', capturedAt: new Date(now).toISOString(), candidate: binding().candidate,
    previousProduction: binding().previousProduction, ready: true, productionAuthorized: false, blockers: [],
    quality: { capturedAt: new Date(now - 29 * 60000).toISOString() },
    trustedEvidence: ['restricted_browser', 'normal_role'].map(kind => ({ kind, capturedAt: new Date(now - 120000).toISOString() })) };
  assert.equal(releaseCoordinationEvidenceDeadline(receipt, now), now + 60000);
  const b = { ...binding(), evidenceExpiresAt: releaseCoordinationEvidenceDeadline(receipt, now) };
  assert.equal(releaseCoordinationDeadline(b), now + 60000);
  assert.throws(() => validateReleaseCoordinationBinding(b, now + 60001));
  assert.throws(() => releaseCoordinationEvidenceDeadline({ ...receipt, capturedAt: new Date(now + 5 * 60000).toISOString() }, now + 5 * 60000));
  for (const area of ['quality', 'restricted_browser', 'normal_role']) {
    const changed = structuredClone(receipt);
    const row = area === 'quality' ? changed.quality : changed.trustedEvidence.find(row => row.kind === area);
    row.capturedAt = new Date(now - 1800001).toISOString();
    assert.throws(() => releaseCoordinationEvidenceDeadline(changed, now));
  }
});

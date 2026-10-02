import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { createPreviewEmailBuildRequest, createPreviewEmailBuildIntent, assertPreviewEmailBuildReceipt,
  previewEmailBuildControlRevision, runControlledPreviewEmailBuild, collectPreviewEmailEnvironmentRecords, collectTrustedPreviewEmailBuild } from '../scripts/lib/preview-email-build.mjs';
import { runPreviewEmailProofBuild, previewEmailBuildArguments } from '../scripts/preview-email-proof-build.mjs';
import { LEGACY_EMAIL_BASELINE_CONTRACT as contract } from '../scripts/lib/legacy-email-baseline-proof.mjs';

const now = Date.parse('2026-10-02T08:00:00.000Z');
const pin = contract.preview.candidates[0], harnessSha = 'a'.repeat(40);
const operationId = 'fcos-preview-email-99-12345678-1234-4123-8123-123456789abc';
const teamId = fcosConnectionIdentifier('vercel', 'Team ID'), projectId = fcosConnectionIdentifier('vercel', 'Project ID');
const iso = value => new Date(value).toISOString();
function records() {
  const rows = Object.entries(contract.baseline.records).map(([key, value]) => ({ ...value, key,
    type: 'sensitive', target: ['production'], gitBranch: null, comment: null }));
  for (const [key, id] of [['FCOS_MICROSOFT_TENANT_ID', pin.tenantRecordId], ['FCOS_MICROSOFT_CLIENT_ID', pin.clientRecordId],
    ['FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET', pin.attachmentRecordId]]) rows.push({ id, key,
    type: key.endsWith('SECRET') ? 'sensitive' : 'plain', target: ['preview'], gitBranch: pin.branch,
    createdAt: now - 10000, updatedAt: now - 10000,
    comment: key.endsWith('SECRET') ? `Dedicated read-only Preview signing key ${contract.preview.attachmentOperationId}; no Production credential copied` : null });
  return { capturedAt: iso(now - 3000), projectId, teamId, complete: true, records: rows };
}
function fixture() {
  const environment = records();
  const intent = createPreviewEmailBuildIntent({ candidateSha: pin.sha, harnessSha, controlRevision: 'b'.repeat(64), runId: 99, operationId, records: environment, now: now - 2000 });
  const raw = { id: 'dpl_BuildFixture', url: 'fcos-ab12cd34e-hocheunglai-6535s-projects.vercel.app', projectId, ownerId: teamId,
    name: 'fcos', target: null, readyState: 'READY', createdAt: now - 1000, meta: { githubCommitSha: pin.sha,
      githubCommitRef: pin.branch, githubCommitOrg: 'hocheunglai-oss', githubCommitRepo: 'fcos', fcosPreviewEmailBuildOperation: operationId } };
  const version = { commit: pin.sha, deploymentId: raw.id, gitDirty: null, provenance: { commit: pin.sha, sourceDigest: pin.sourceDigest,
    sourceDigestAlgorithm: 'sha256:fcos-vercel-source-v1', releaseEligible: true, gitDirty: null, sourceAttested: true, sanitizedCheckout: false } };
  const events = []; let creates = 0;
  const options = { intent, mode: 'create', authority: async () => events.push('authority'), journal: async value => events.push(value.phase),
    discover: async () => null, create: async request => { creates++; assert.deepEqual(request, intent.request); return raw; },
    waitReady: async value => value, collectRecords: async () => environment, readVersion: async () => version, now: () => now };
  return { intent, raw, version, options, events, creates: () => creates, environment };
}

test('Preview request has only the exact pinned Git source and unique non-secret operation marker', () => {
  const value = fixture();
  assert.deepEqual(createPreviewEmailBuildRequest({ candidateSha: pin.sha, runId: 99, operationId }), value.intent.request);
  assert.deepEqual(Object.keys(value.intent.request), ['name', 'project', 'gitSource', 'meta']);
  assert.throws(() => createPreviewEmailBuildRequest({ candidateSha: 'c'.repeat(40), runId: 99, operationId }));
  assert.throws(() => createPreviewEmailBuildRequest({ candidateSha: pin.sha, runId: 98, operationId }));
});

test('authority and durable journal precede one creation; valid Gitless source proof succeeds', async () => {
  const value = fixture(), receipt = await runControlledPreviewEmailBuild(value.options);
  assert.equal(value.creates(), 1);
  assert.deepEqual(value.events, ['authority', 'create_requested', 'authority', 'complete']);
  assert.equal(receipt.intentAt, value.intent.intentAt);
  assert.equal(receipt.deployment.sha, pin.sha);
  const denied = fixture(); denied.options.authority = async () => { throw new Error('unapproved'); };
  await assert.rejects(() => runControlledPreviewEmailBuild(denied.options));
  assert.equal(denied.creates(), 0);
});

test('definite or uncertain POST failure never automatically sends a second request', async () => {
  const value = fixture(); value.options.create = async () => { value.events.push('POST'); throw new Error('private-transport-marker'); };
  await assert.rejects(() => runControlledPreviewEmailBuild(value.options), error => !error.message.includes('private-transport-marker'));
  assert.equal(value.events.filter(item => item === 'POST').length, 1);
  assert.equal(value.events.at(-1), 'delivery_uncertain');
  const recovered = fixture(); let reads = 0;
  recovered.options.create = async () => { throw new Error('uncertain'); };
  recovered.options.discover = async () => ++reads === 1 ? null : recovered.raw;
  assert.equal((await runControlledPreviewEmailBuild(recovered.options)).deployment.id, recovered.raw.id);
  assert.equal(reads, 2);
});

test('readback-only recovery cannot POST even when no matching deployment exists', async () => {
  const value = fixture(); value.options.mode = 'readback';
  await assert.rejects(() => runControlledPreviewEmailBuild(value.options));
  assert.equal(value.creates(), 0);
  value.options.discover = async () => value.raw;
  assert.equal((await runControlledPreviewEmailBuild(value.options)).runId, value.intent.runId);
  assert.equal(value.creates(), 0);
});

test('READY readback requires exact target, repository, operation and actual source receipt', async () => {
  for (const change of [
    value => { value.raw.target = 'production'; }, value => { value.raw.meta.githubCommitSha = 'c'.repeat(40); },
    value => { value.raw.meta.fcosPreviewEmailBuildOperation = 'other'; }, value => { value.raw.readyState = 'ERROR'; },
    value => { value.version.provenance.sourceDigestAlgorithm = 'wrong'; }, value => { value.version.provenance.gitDirty = true; },
    value => { value.version.deploymentId = undefined; }, value => { value.version.provenance.sourceDigest = 'c'.repeat(64); },
  ]) { const value = fixture(); change(value); await assert.rejects(() => runControlledPreviewEmailBuild(value.options)); assert.ok(!value.events.includes('complete')); }
});

test('receipt rejects extra request overrides, wrong bindings and changed current environment records', async () => {
  const value = fixture(), receipt = await runControlledPreviewEmailBuild(value.options);
  const binding = { ...receipt.candidate, harnessSha, deploymentId: receipt.deployment.id, candidateUrl: receipt.deployment.url };
  assert.equal(assertPreviewEmailBuildReceipt({ receipt, binding, records: value.environment, now }), true);
  for (const change of [
    item => { item.request.env = { PRIVATE_KEY: 'secret-marker' }; }, item => { item.request.deploymentId = 'dpl_clone'; },
    item => { item.candidate.branch = 'other'; }, item => { item.harnessSha = 'c'.repeat(40); },
    item => { item.capturedAt = iso(now - 1800001); }, item => { item.extra = true; },
  ]) { const changed = structuredClone(receipt); change(changed); assert.throws(() => assertPreviewEmailBuildReceipt({ receipt: changed, binding, records: value.environment, now })); }
  const changed = structuredClone(value.environment); changed.records[0].updatedAt++;
  assert.throws(() => assertPreviewEmailBuildReceipt({ receipt, binding, records: changed, now }));
});

test('complete pagination strips values and rejects incomplete, repeated or foreign metadata', async () => {
  const rows = records().records, privateValue = 'unpersisted-sensitive-marker'; let page = 0;
  const result = await collectPreviewEmailEnvironmentRecords({ now, api: async () => ++page === 1
    ? { envs: rows.slice(0, 3).map(row => ({ ...row, value: privateValue })), pagination: { count: 3, next: 1, prev: null } }
    : { envs: rows.slice(3), pagination: { count: 3, next: null, prev: 1 } } });
  assert.equal(result.records.length, rows.length);
  assert.ok(!JSON.stringify(result).includes(privateValue));
  await assert.rejects(() => collectPreviewEmailEnvironmentRecords({ now, api: async () => ({ envs: rows, hasMore: true }) }));
  await assert.rejects(() => collectPreviewEmailEnvironmentRecords({ now, api: async () => ({ projectId: 'wrong', envs: rows }) }));
  await assert.rejects(() => collectPreviewEmailEnvironmentRecords({ now, api: async () => ({ envs: rows, pagination: { count: rows.length, next: 1, prev: null } }) }));
});

test('local pass files and wrong GitHub collector identity cannot substitute protected build evidence', async () => {
  let calls = 0;
  await assert.rejects(() => collectTrustedPreviewEmailBuild({ reads: { json: async path => { calls++; assert.equal(path, 'user'); return { login: 'wrong', id: 1 }; } },
    binding: { pass: true, reviewed: true }, records: records(), now }));
  assert.equal(calls, 1);
});

test('workflow is inactive by default and dry-run is credential-free', async () => {
  const plan = await runPreviewEmailProofBuild();
  assert.equal(plan.enabledByDefault, false); assert.equal(plan.mutations, 0); assert.equal(plan.productionAuthorized, false);
  assert.equal(previewEmailBuildArguments([], {}).mode, 'dry-run');
  assert.throws(() => previewEmailBuildArguments(['--execute'], {}));
  const workflow = readFileSync(new URL('../.github/workflows/preview-email-proof-build.yml', import.meta.url), 'utf8');
  assert.match(workflow, /vars\.FCOS_PREVIEW_EMAIL_BUILD_ENABLED == 'true'/);
  assert.match(workflow, /Persist immutable intent before any deployment request/);
  assert.match(workflow, /persist-credentials: false/);
  assert.ok(workflow.indexOf('fcos-preview-email-intent-${{ github.run_id }}') < workflow.indexOf('node trusted/scripts/preview-email-proof-build.mjs --create'));
});

async function trustedFixture() {
  const value = fixture();
  value.intent.controlRevision = previewEmailBuildControlRevision(process.cwd());
  const receipt = await runControlledPreviewEmailBuild(value.options);
  const repository = { id: 2, full_name: 'hocheunglai-oss/fcos', default_branch: 'main' };
  const reviewer = { id: 4, login: 'hocheunglai-oss' };
  const run = { id: 99, repository, head_repository: repository, head_branch: 'main', head_sha: harnessSha,
    path: '.github/workflows/preview-email-proof-build.yml', event: 'workflow_dispatch', run_attempt: 1,
    status: 'completed', conclusion: 'success', updated_at: iso(now), run_started_at: iso(now - 2000), actor: reviewer, triggering_actor: reviewer };
  const protection = { enforce_admins: { enabled: true }, required_status_checks: { strict: true,
    checks: FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context => ({ context, app_id: FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId })) } };
  const environment = { id: 5, name: 'fcos-runtime-compatibility-release', can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer }] }] };
  const approvals = [{ state: 'approved', user: reviewer, environments: [{ id: environment.id, name: environment.name }] }];
  const archive = Buffer.from(JSON.stringify(receipt));
  const intentArchive = Buffer.from(JSON.stringify(value.intent));
  const artifact = { id: 7, name: `fcos-preview-email-build-${pin.sha}`, expired: false,
    workflow_run: { id: 99, head_sha: harnessSha }, digest: `sha256:${createHash('sha256').update(archive).digest('hex')}` };
  const intentArtifact = { ...artifact, id: 8, name: 'fcos-preview-email-intent-99',
    digest: `sha256:${createHash('sha256').update(intentArchive).digest('hex')}` };
  const prefix = 'repos/hocheunglai-oss/fcos';
  const reads = {
    json: async path => {
      if (path === 'user') return reviewer;
      if (path === prefix) return repository;
      if (path === `${prefix}/branches/main`) return { name: 'main', protected: true, commit: { sha: harnessSha } };
      if (path === `${prefix}/branches/main/protection`) return protection;
      if (path.includes('/contents/')) {
        const filename = path.split('/contents/')[1].split('?')[0];
        return { type: 'file', encoding: 'base64', content: readFileSync(filename).toString('base64') };
      }
      if (path.includes('/actions/workflows/')) return { total_count: 1, workflow_runs: [run] };
      if (path === `${prefix}/environments/fcos-runtime-compatibility-release`) return environment;
      if (path === `${prefix}/actions/runs/99/approvals`) return approvals;
      if (path.includes('/actions/runs/99/artifacts?')) return { total_count: 2, artifacts: [artifact, intentArtifact] };
      if (path === `${prefix}/actions/runs/99`) return run;
      throw new Error('unexpected fixed repository read');
    },
    archive: async path => path.includes('/artifacts/7/') ? archive : intentArchive,
  };
  const options = { reads, api: async () => value.raw, binding: { ...receipt.candidate, harnessSha,
    deploymentId: receipt.deployment.id, candidateUrl: receipt.deployment.url }, records: value.environment, now,
    unpack: buffer => JSON.parse(buffer.toString()), readVersion: async () => value.version };
  return { options, run, artifact, approvals, environment, protection, archive };
}

test('trusted collector independently verifies protected source, human review, both archive digests and READY/source readback', async () => {
  const value = await trustedFixture();
  const result = await collectTrustedPreviewEmailBuild(value.options);
  assert.equal(result.trust.runId, 99); assert.equal(result.trust.artifactId, 7);
  assert.equal(result.receipt.intentAt, iso(now - 2000));
  for (const change of [
    item => { item.run.path = '.github/workflows/untrusted.yml'; }, item => { item.run.head_sha = 'c'.repeat(40); },
    item => { item.run.run_attempt = 2; }, item => { item.artifact.digest = `sha256:${'c'.repeat(64)}`; },
    item => { item.artifact.expired = true; }, item => { item.approvals.length = 0; },
    item => { item.environment.can_admins_bypass = true; }, item => { item.protection.required_status_checks.strict = false; },
    item => { item.options.readVersion = async () => ({ pass: true, reviewed: true }); },
  ]) { const changed = await trustedFixture(); change(changed); await assert.rejects(() => collectTrustedPreviewEmailBuild(changed.options)); }
});

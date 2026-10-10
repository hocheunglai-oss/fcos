import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { assertRoutineReleaseJobs, assertReusableQualityJobs, ROUTINE_RELEASE_WORKFLOW } from '../scripts/lib/release-workflow.mjs';
import { assertTrustedArtifact, collectTrustedReleaseEvidence, RELEASE_REPOSITORY, assertReleaseWorkflowIdentity } from '../scripts/lib/release-evidence.mjs';
import { FCOS_RELEASE_APPROVAL_POLICY } from '../config/fcosConnections.js';
import { releaseHash } from '../scripts/lib/release-readiness.mjs';

const now = Date.parse('2026-10-10T00:10:00Z'), iso = offset => new Date(now + offset).toISOString();
const candidate = 'a'.repeat(40), harness = 'b'.repeat(40), digest = 'c'.repeat(64);
const operator = { login: 'hocheunglai-oss', id: 12 };
const repository = { id: 99, full_name: RELEASE_REPOSITORY, default_branch: 'main' };
const branch = { name: 'main', protected: true, commit: { sha: harness } };
const protection = { enforce_admins: { enabled: true }, required_status_checks: { strict: true,
  checks: FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context => ({ context, app_id: FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId })) } };
const binding = { sha: candidate, sourceDigest: digest, lockHash: digest, configurationRevision: digest, deploymentId: 'dpl_candidate',
  candidateUrl: 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app' };
function fixture() {
  const run = { id: 77, repository, head_repository: repository, head_branch: 'main', head_sha: harness, path: ROUTINE_RELEASE_WORKFLOW,
    event: 'workflow_dispatch', run_attempt: 1, actor: operator, triggering_actor: operator,
    status: 'completed', conclusion: 'success',
    run_started_at: iso(-100000), updated_at: iso(-1000) };
  const job = (name, id, start, end) => ({ name, id, run_id: run.id, run_attempt: 1, head_sha: harness,
    status: 'completed', conclusion: 'success', started_at: iso(start), completed_at: iso(end) });
  const jobs = { total_count: 3, jobs: [job('require-default-branch-dispatch', 1, -100000, -95000),
    job('authenticated-candidate', 2, -90000, -60000), job('normal-role', 3, -90000, -50000)] };
  const archive = Buffer.from('verified bytes');
  const artifact = { id: 88, name: `fcos-ci-evidence-${candidate}`, expired: false, digest: `sha256:${releaseHash(archive)}`,
    created_at: iso(-61000), workflow_run: { id: run.id, head_sha: harness } };
  const payload = { candidateSha: candidate, candidateUrl: binding.candidateUrl, harnessSha: harness };
  return { run, jobs, branch: structuredClone(branch), repository, protection, binding, artifact, payload, archive, kind: 'restricted_browser', now };
}

test('coordinated evidence accepts only a completed exact run with both successful verification jobs', () => {
  const value = fixture();
  assert.equal(assertRoutineReleaseJobs(value)['normal-role'].id, 3);
  const record = assertTrustedArtifact(value);
  assert.equal(record.capturedAt, iso(-60000));
  assert.notEqual(record.capturedAt, value.run.updated_at);
});

for (const [label, change] of [
  ['wrong workflow', v => { v.run.path = '.github/workflows/evil.yml'; }],
  ['wrong repository id', v => { v.run.head_repository = { ...v.repository, id: 100 }; }],
  ['same wrong repository ids', v => { v.run.repository = { ...v.repository, id: 100 }; v.run.head_repository = v.run.repository; }],
  ['wrong main', v => { v.branch.commit.sha = 'd'.repeat(40); }],
  ['unprotected branch', v => { v.branch.protected = false; }],
  ['wrong actor', v => { v.run.actor = { login: 'outsider', id: 12 }; }],
  ['wrong triggering actor', v => { v.run.triggering_actor = { ...operator, id: 13 }; }],
  ['pull request event', v => { v.run.event = 'pull_request'; }],
  ['rerun', v => { v.run.run_attempt = 2; }],
  ['stale run', v => { v.run.run_started_at = iso(-1800001); }],
  ['in-progress workflow', v => { v.run.status = 'in_progress'; v.run.conclusion = null; }],
  ['failed readonly job', v => { v.jobs.jobs[1].conclusion = 'failure'; }],
  ['skipped normal role', v => { v.jobs.jobs[2].conclusion = 'skipped'; }],
  ['normal role still running', v => { Object.assign(v.jobs.jobs[2], { status: 'in_progress', conclusion: null, completed_at: null }); }],
  ['missing job', v => { v.jobs.jobs.pop(); }],
  ['incomplete pagination', v => { v.jobs.total_count = 5; }],
  ['duplicate job id', v => { v.jobs.jobs[2].id = 2; }],
  ['duplicate job name', v => { v.jobs.jobs[2].name = 'authenticated-candidate'; }],
  ['wrong job SHA', v => { v.jobs.jobs[1].head_sha = candidate; }],
  ['wrong job run', v => { v.jobs.jobs[1].run_id = 78; }],
  ['wrong job attempt', v => { v.jobs.jobs[1].run_attempt = 2; }],
  ['verification starts before guard', v => { v.jobs.jobs[1].started_at = iso(-96000); }],
  ['artifact before producer', v => { v.artifact.created_at = iso(-91000); }],
  ['artifact after producer', v => { v.artifact.created_at = iso(-59000); }],
  ['tampered archive', v => { v.archive = Buffer.from('tampered'); }],
  ['different candidate', v => { v.payload.candidateSha = harness; }],
]) test(`coordinated evidence rejects ${label}`, () => { const v = fixture(); change(v); assert.throws(() => assertTrustedArtifact(v)); });

function environment(kind) {
  return { id: kind === 'restricted_browser' ? 20 : 21, name: kind === 'restricted_browser' ? 'fcos-ci-readonly' : 'fcos-normal-role-verification',
    can_admins_bypass: false, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: operator }] }] };
}
function collectionFixture() {
  const v = fixture(), paths = [], normal = { ...v.artifact, id: 89, name: `fcos-normal-role-evidence-${candidate}`, created_at: iso(-51000) };
  const environments = [environment('restricted_browser'), environment('normal_role')];
  const approvals = [{ state: 'approved', user: operator, environments: environments.map(({ id, name }) => ({ id, name })) }];
  const data = { v, enabled: 'true', approvals, artifacts: [v.artifact, normal], paths };
  data.reads = { archive: path => { paths.push(path); return v.archive; }, json: path => {
    paths.push(path);
    if (path === `repos/${RELEASE_REPOSITORY}`) return repository;
    if (path.endsWith('/branches/main')) return branch;
    if (path.endsWith('/protection')) return protection;
    if (path.endsWith('/actions/variables/FCOS_ROUTINE_RELEASE_ENABLED')) return { name: 'FCOS_ROUTINE_RELEASE_ENABLED', value: data.enabled };
    if (path.endsWith('/actions/runs/77')) return v.run;
    if (path.includes('/attempts/1/jobs?')) return v.jobs;
    if (path.includes('/77/artifacts?')) return { total_count: data.artifacts.length, artifacts: data.artifacts };
    if (path.endsWith('/77/approvals')) return data.approvals;
    if (path.includes('/environments/')) return environments.find(env => path.endsWith(`/${env.name}`));
    if (path.includes('/routine-release.yml/runs?')) return { workflow_runs: [v.run] };
    if (path.includes('/runs?')) return { workflow_runs: [] };
    throw new Error(`Unexpected fixed GET: ${path}`);
  } };
  data.collect = () => collectTrustedReleaseEvidence({ reads: data.reads, binding, now, unpack: (_, name) => name === 'fcos-ci-evidence.json' ? v.payload
      : { ...v.payload, schemaVersion: 1, deploymentId: binding.deploymentId, sourceDigest: digest, capturedAt: iso(-55000), checks: [] } });
  return data;
}

test('collector uses one exact run/jobs/artifact list and independently verifies both real human approvals', async () => {
  const data = collectionFixture(), result = await data.collect();
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.blockers, []);
  assert.equal(data.paths.filter(path => path.includes('/attempts/1/jobs?')).length, 1);
  assert.equal(data.paths.filter(path => path.includes('/77/artifacts?')).length, 1);
  assert.equal(data.paths.filter(path => path.endsWith('/77/approvals')).length, 1);
  for (const change of [
    d => { d.enabled = 'false'; }, d => { d.approvals = []; },
    d => { d.approvals[0].user = { ...operator, id: 13 }; },
    d => { d.approvals[0].environments = []; },
    d => { d.v.jobs.jobs[2].conclusion = 'failure'; },
    d => { d.artifacts.push({ ...d.artifacts[0], id: 90 }); },
  ]) { const d = collectionFixture(); change(d); const result = await d.collect(); assert.ok(result.blockers.length); }
});

test('standalone Production can discover completed coordinated verification but never arbitrary in-progress evidence', async () => {
  const data = collectionFixture();
  Object.assign(data.v.run, { status: 'in_progress', conclusion: null });
  assert.equal((await data.collect()).records.length, 0);
  Object.assign(data.v, fixture());
  const result = await data.collect();
  assert.equal(result.records.length, 2);
  assert.equal(data.paths.filter(path => path.includes('/attempts/1/jobs?')).length, 1);
});

function qualityFixture() {
  const run = { id: 40, repository, head_repository: repository, head_sha: candidate, status: 'completed', conclusion: 'failure', event: 'pull_request', run_attempt: 1,
    run_started_at: iso(-100000), updated_at: iso(-1000) };
  const jobs = { total_count: 3, jobs: ['code-and-database', 'dependency-review', 'authenticated-browser'].map((name, i) => ({
    id: i + 1, name, run_id: 40, run_attempt: 1, head_sha: candidate, status: 'completed',
    conclusion: i === 2 ? 'failure' : 'success', started_at: iso(-90000), completed_at: iso(-10000) })) };
  return { repository, run, jobs, artifact: { created_at: iso(-11000) }, payload: { capturedAt: iso(-12000) }, now };
}
test('successful code/database and dependency jobs remain reusable when only authenticated consumption failed', () => {
  assert.equal(assertReusableQualityJobs(qualityFixture()), true);
  for (const change of [
    v => { v.run.status = 'in_progress'; }, v => { v.run.conclusion = 'cancelled'; }, v => { v.run.event = 'push'; },
    v => { v.run.run_attempt = 2; }, v => { v.jobs.jobs[0].conclusion = 'failure'; },
    v => { v.jobs.jobs[1].conclusion = 'failure'; }, v => { v.jobs.jobs[1].conclusion = 'skipped'; },
    v => { v.jobs.jobs[2].conclusion = 'cancelled'; }, v => { v.jobs.jobs[0].run_id = 41; },
    v => { v.jobs.jobs[0].head_sha = harness; }, v => { v.jobs.jobs[0].run_attempt = 2; },
    v => { v.jobs.jobs.push(v.jobs.jobs[0]); }, v => { v.jobs.total_count = 4; },
    v => { v.artifact.created_at = iso(-100001); }, v => { v.artifact.created_at = iso(-9000); },
    v => { v.payload.capturedAt = iso(-10000); }, v => { v.payload.capturedAt = iso(-1800001); },
  ]) { const v = qualityFixture(); change(v); assert.throws(() => assertReusableQualityJobs(v)); }
});

test('new workflow keeps identities separate and starts both verifications together without adding Production authority', () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/routine-release.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), ['expected_commit', 'candidate_url']);
  assert.equal(workflow.concurrency.group, 'fcos-routine-release-${{ inputs.expected_commit }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.match(workflow.jobs['require-default-branch-dispatch'].if, /FCOS_ROUTINE_RELEASE_ENABLED == 'true'/);
  const readonly = workflow.jobs['authenticated-candidate'], normal = workflow.jobs['normal-role'];
  assert.equal(readonly.needs, 'require-default-branch-dispatch'); assert.equal(normal.needs, readonly.needs);
  assert.equal(readonly.environment, 'fcos-ci-readonly'); assert.equal(normal.environment, 'fcos-normal-role-verification');
  assert.equal(workflow.jobs.production, undefined);
  for (const job of Object.values(workflow.jobs)) assert.equal(job.permissions?.['id-token'], undefined);
  const normalText = JSON.stringify(normal), readText = JSON.stringify(readonly);
  assert.doesNotMatch(normalText, /FCOS_E2E_PASSWORD|FCOS_RELEASE_VERCEL_TOKEN/);
  assert.doesNotMatch(readText, /FCOS_NORMAL_ROLE_STORAGE_STATE|FCOS_RELEASE_VERCEL_TOKEN/);

});

test('routine verification cannot satisfy the unchanged Production OIDC workflow identity', () => {
  const claims = { repository: RELEASE_REPOSITORY, repository_id: '99', sub: `repo:${RELEASE_REPOSITORY}:environment:fcos-production-release`,
    workflow_ref: `${RELEASE_REPOSITORY}/${ROUTINE_RELEASE_WORKFLOW}@refs/heads/main`, workflow_sha: harness, sha: harness, ref: 'refs/heads/main' };
  assert.throws(() => assertReleaseWorkflowIdentity(claims, repository, branch));
  for (const patch of [{ sub: `repo:${RELEASE_REPOSITORY}:environment:fcos-ci-readonly` },
    { workflow_ref: `${RELEASE_REPOSITORY}/.github/workflows/not-routine-release.yml@refs/heads/main` }, { workflow_sha: candidate }]) {
    assert.throws(() => assertReleaseWorkflowIdentity({ ...claims, ...patch }, repository, branch));
  }
});

test('collector reuses failed-run code proof without granting authenticated or normal-role coverage', async () => {
  const v = qualityFixture(), archive = Buffer.from('quality archive');
  Object.assign(v.run, { repository, head_repository: repository, path: '.github/workflows/quality.yml' });
  Object.assign(v.artifact, { id: 90, name: `fcos-quality-source-${candidate}`, expired: false, digest: `sha256:${releaseHash(archive)}`,
    workflow_run: { id: v.run.id, head_sha: candidate } });
  Object.assign(v.payload, { schemaVersion: 1, candidateSha: candidate, lockSha256: digest });
  let mismatchedWorkflow = false;
  const reads = { archive: () => archive, json: path => {
    if (path === `repos/${RELEASE_REPOSITORY}`) return repository;
    if (path.endsWith('/branches/main')) return branch;
    if (path.endsWith('/protection')) return protection;
    if (path.includes('/quality.yml/runs?')) return { workflow_runs: [v.run] };
    if (path.includes('/runs?')) return { workflow_runs: [] };
    if (path.includes('/contents/')) return { encoding: 'base64', content: Buffer.from(mismatchedWorkflow && path.endsWith(candidate) ? 'changed' : 'frozen quality').toString('base64') };
    if (path.includes('/40/artifacts?')) return { artifacts: [v.artifact] };
    if (path.includes('/attempts/1/jobs?')) return v.jobs;
    throw new Error('Unavailable optional route');
  } };
  const collect = () => collectTrustedReleaseEvidence({ reads, binding, now, unpack: () => v.payload });
  const result = await collect();
  assert.equal(result.quality.result, 'success'); assert.equal(result.quality.capturedAt, iso(-12000));
  assert.equal(result.records.length, 0);
  assert.deepEqual(result.blockers.map(row => row.scope), ['restricted_browser', 'normal_role']);
  v.jobs.jobs[1].conclusion = 'failure'; assert.equal((await collect()).quality, null);
  v.jobs.jobs[1].conclusion = 'success'; mismatchedWorkflow = true; assert.equal((await collect()).quality, null);
});

test('every downstream control fingerprint includes the new trusted workflow and helper', () => {
  for (const name of ['release-readiness.mjs', 'runtime-compatibility-release.mjs', 'preview-email-build-controls.mjs']) {
    const source = readFileSync(new URL(`../scripts/lib/${name}`, import.meta.url), 'utf8');
    assert.ok(source.includes("'scripts/lib/release-workflow.mjs'"));
    assert.ok(source.includes("'.github/workflows/routine-release.yml'"));
  }
});

test('normal-role capture time belongs to its actual producer job and precedes upload', () => {
  const v = fixture(); v.kind = 'normal_role'; v.artifact.name = `fcos-normal-role-evidence-${candidate}`;
  v.artifact.created_at = iso(-51000);
  v.payload = { ...v.payload, schemaVersion: 1, deploymentId: binding.deploymentId, sourceDigest: digest, capturedAt: iso(-55000), checks: [] };
  assert.equal(assertTrustedArtifact(v).capturedAt, iso(-55000));
  for (const value of [iso(-91000), iso(-50000), iso(0)]) {
    v.payload.capturedAt = value; assert.throws(() => assertTrustedArtifact(v));
  }
});


test('collector rejects mixing coordinated artifacts from different completed runs', async () => {
  const data = collectionFixture(), original = data.reads.json;
  const otherRun = { ...data.v.run, id: 78 };
  const otherJobs = { total_count: 3, jobs: data.v.jobs.jobs.map(job => ({ ...job, run_id: 78 })) };
  const restricted = { ...data.artifacts[0], workflow_run: { id: 78, head_sha: harness } };
  const normal = data.artifacts[1];
  data.reads.json = path => {
    if (path.includes('/routine-release.yml/runs?')) return { workflow_runs: [data.v.run, otherRun] };
    if (path.includes('/77/artifacts?')) return { total_count: 1, artifacts: [normal] };
    if (path.includes('/78/artifacts?')) return { total_count: 1, artifacts: [restricted] };
    if (path.includes('/78/attempts/1/jobs?')) return otherJobs;
    if (path.endsWith('/78/approvals')) return data.approvals;
    return original(path);
  };
  const result = await data.collect();
  assert.equal(result.records.length, 0);
  assert.ok(result.blockers.some(row => row.code === 'COORDINATED_RELEASE_EVIDENCE_UNAVAILABLE'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { load } from 'js-yaml';

const require = createRequire(import.meta.url);
const workflow = load(readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8'));
const consumer = workflow.jobs['authenticated-browser'].steps[0].with.script;
const execute = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'core', 'require', consumer);
const digest = data => createHash('sha256').update(data).digest('hex');
const candidate = 'a'.repeat(40), harness = 'b'.repeat(40), owner = 'hocheunglai-oss', repo = 'fcos', operator = { id: 12, login: owner };
function archive(filename, payload) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-consumer-fixture-'));
  try {
    writeFileSync(join(directory, filename), JSON.stringify(payload));
    execFileSync('zip', ['-q', 'evidence.zip', filename], { cwd: directory });
    return readFileSync(join(directory, 'evidence.zip'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function fixture() {
  const now = Date.now(), iso = n => new Date(now + n).toISOString();
  const repository = { id: 99, full_name: `${owner}/${repo}`, default_branch: 'main', owner: operator };
  const run = { id: 77, repository, head_repository: repository, head_branch: 'main', head_sha: harness,
    path: '.github/workflows/routine-release.yml', event: 'workflow_dispatch', run_attempt: 1, actor: operator, triggering_actor: operator,
    status: 'completed', conclusion: 'success', run_started_at: iso(-100000), updated_at: iso(-1000) };
  const branch = { name: 'main', protected: true, commit: { sha: harness } };
  const job = (name, id, start, end) => ({ name, id, run_id: run.id, run_attempt: 1, head_sha: harness,
    status: 'completed', conclusion: 'success', started_at: iso(start), completed_at: iso(end) });
  const jobs = { total_count: 3, jobs: [job('require-default-branch-dispatch', 1, -100000, -95000),
    job('authenticated-candidate', 2, -90000, -60000), job('normal-role', 3, -90000, -50000)] };
  const environments = ['fcos-ci-readonly', 'fcos-normal-role-verification'].map((name, i) => ({ id: 20 + i, name, can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: operator }] }] }));
  const approvals = [{ state: 'approved', user: operator, environments: environments.map(({ id, name }) => ({ id, name })) }];
  const payload = { candidateSha: candidate, candidateUrl: 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app', harnessSha: harness };
  const payloads = [payload, { ...payload, schemaVersion: 1, deploymentId: 'dpl_candidate', sourceDigest: 'c'.repeat(64), capturedAt: iso(-55000), checks: [] }];
  const filenames = ['fcos-ci-evidence.json', 'fcos-normal-role-evidence.json'];
  const artifacts = { total_count: 2, artifacts: ['fcos-ci-evidence', 'fcos-normal-role-evidence'].map((prefix, i) => ({ id: 88 + i,
    name: `${prefix}-${candidate}`, expired: false, created_at: iso(i ? -51000 : -61000), workflow_run: { id: run.id, head_sha: harness } })) };
  const data = { now, iso, repository, run, branch, jobs, environments, approvals, payloads, filenames, artifacts, standalone: false, enabled: true };
  data.repack = () => { data.archives = data.payloads.map((payload, i) => archive(data.filenames[i], payload));
    data.artifacts.artifacts.forEach((artifact, i) => { if (data.archives[i]) artifact.digest = `sha256:${digest(data.archives[i])}`; }); };
  data.repack();
  data.check = async () => {
    const errors = [], calls = []; let branchReads = 0;
    const response = data => ({ data });
    const github = { paginate: async (_, args) => { calls.push(['standalone-artifacts', args]); return data.standalone ? [{ id: 1, name: `fcos-ci-evidence-${candidate}`, expired: false }] : []; }, rest: {
      repos: {
        get: async args => { calls.push(['repository', args]); return response(data.repository); },
        getBranch: async args => { calls.push(['branch', args]); branchReads++; return response(data.changeMain && branchReads > 1 ? { ...data.branch, commit: { sha: candidate } } : data.branch); },
        getEnvironment: async args => { calls.push(['environment', args]); return response(data.environments.find(row => row.name === args.environment_name)); },
      },
      actions: {
        listWorkflowRuns: async args => { calls.push(['runs', args]); return response({ workflow_runs: args.workflow_id === 'routine-release.yml' ? [data.run] : data.standalone ? [{ id: 1, path: '.github/workflows/authenticated-release.yml', event: 'workflow_dispatch', head_branch: 'main', conclusion: 'success' }] : [] }); },
        listWorkflowRunArtifacts: async args => { calls.push(['artifacts', args]); return response(data.artifacts); },
        listJobsForWorkflowRunAttempt: async args => { calls.push(['jobs', args]); return response(data.jobs); },
        getReviewsForRun: async args => { calls.push(['reviews', args]); return response(data.approvals); },
        downloadArtifact: async args => { calls.push(['download', args]); return response(data.archives[args.artifact_id - 88]); },
      },
    } };
    const previous = process.env.FCOS_ROUTINE_RELEASE_ENABLED;
    process.env.FCOS_ROUTINE_RELEASE_ENABLED = data.enabled ? 'true' : 'false';
    try { await execute(github, { repo: { owner, repo }, payload: { repository: { id: 99, default_branch: 'main' }, pull_request: { head: { sha: candidate } } } }, { setFailed: value => errors.push(value) }, require); }
    finally { if (previous === undefined) delete process.env.FCOS_ROUTINE_RELEASE_ENABLED; else process.env.FCOS_ROUTINE_RELEASE_ENABLED = previous; }
    return { errors, calls };
  };
  return data;
}

test('actual required quality consumer accepts coordinated evidence without another standalone protected authentication', async () => {
  const v = fixture(), result = await v.check(); assert.deepEqual(result.errors, []);
  assert.equal(result.calls.filter(([kind]) => kind === 'download').length, 2);
  assert.equal(result.calls.filter(([kind]) => kind === 'reviews').length, 1);
  assert.equal(result.calls.filter(([kind]) => kind === 'environment').length, 2);
  assert.equal(result.calls.filter(([kind]) => kind === 'branch').length, 2);
  assert.equal(result.calls.every(([, args]) => args.owner === owner && args.repo === repo), true);
  assert.equal(result.calls.find(([kind]) => kind === 'jobs')[1].attempt_number, 1);
});

test('standalone evidence remains supported and missing evidence remains a failed strict check', async () => {
  const v = fixture(); v.standalone = true; v.enabled = false; assert.deepEqual((await v.check()).errors, []);
  v.standalone = false; assert.equal((await v.check()).errors.length, 1);
});

for (const [label, change] of [
  ['disabled', v => { v.enabled = false; }],
  ['wrong repository', v => { v.repository = { ...v.repository, id: 100 }; }],
  ['wrong run repository', v => { v.run.repository = { ...v.repository, id: 100 }; }],
  ['wrong head repository', v => { v.run.head_repository = { ...v.repository, id: 100 }; }],
  ['unprotected main', v => { v.branch.protected = false; }],
  ['main changed during collection', v => { v.changeMain = true; }],
  ['wrong workflow', v => { v.run.path = '.github/workflows/arbitrary.yml'; }],
  ['wrong event', v => { v.run.event = 'push'; }],
  ['wrong branch', v => { v.run.head_branch = 'topic'; }],
  ['wrong harness', v => { v.run.head_sha = candidate; }],
  ['wrong actor', v => { v.run.actor = { ...operator, id: 13 }; }],
  ['wrong triggering actor', v => { v.run.triggering_actor = { ...operator, id: 13 }; }],
  ['rerun', v => { v.run.run_attempt = 2; }],
  ['in-progress run', v => { v.run.status = 'in_progress'; v.run.conclusion = null; }],
  ['stale original run', v => { v.run.run_started_at = v.iso(-1801000); }],
  ['missing job', v => { v.jobs.jobs.pop(); }],
  ['incomplete job pages', v => { v.jobs.total_count = 4; }],
  ['wrong job SHA', v => { v.jobs.jobs[1].head_sha = candidate; }],
  ['wrong job attempt', v => { v.jobs.jobs[1].run_attempt = 2; }],
  ['duplicate job', v => { v.jobs.jobs[2] = v.jobs.jobs[1]; }],
  ['failed restricted job', v => { v.jobs.jobs[1].conclusion = 'failure'; }],
  ['skipped normal-role job', v => { v.jobs.jobs[2].conclusion = 'skipped'; }],
  ['job before dispatch guard', v => { v.jobs.jobs[1].started_at = v.iso(-96000); }],
  ['missing human approval', v => { v.approvals = []; }],
  ['duplicate human approval', v => { v.approvals.push(v.approvals[0]); }],
  ['rejected human approval', v => { v.approvals[0].state = 'rejected'; }],
  ['wrong reviewer', v => { v.approvals[0].user = { ...operator, id: 13 }; }],
  ['bypassable environment', v => { v.environments[0].can_admins_bypass = true; }],
  ['wrong environment reviewer', v => { v.environments[1].protection_rules[0].reviewers[0].reviewer = { ...operator, id: 13 }; }],
  ['wrong environment branch policy', v => { v.environments[0].deployment_branch_policy.protected_branches = false; }],
  ['duplicate artifact', v => { v.artifacts.artifacts.push({ ...v.artifacts.artifacts[0], id: 90 }); v.artifacts.total_count++; }],
  ['incomplete artifact page', v => { v.artifacts.total_count++; }],
  ['wrong archive digest', v => { v.artifacts.artifacts[0].digest = `sha256:${'0'.repeat(64)}`; }],
  ['wrong artifact run', v => { v.artifacts.artifacts[0].workflow_run.id = 78; }],
  ['expired artifact', v => { v.artifacts.artifacts[0].expired = true; }],
  ['artifact before producer', v => { v.artifacts.artifacts[0].created_at = v.iso(-91000); }],
  ['artifact after producer', v => { v.artifacts.artifacts[0].created_at = v.iso(-59000); }],
  ['wrong archive filename', v => { v.filenames[0] = 'other.json'; v.repack(); }],
  ['wrong payload candidate', v => { v.payloads[0].candidateSha = harness; v.repack(); }],
  ['wrong payload harness', v => { v.payloads[0].harnessSha = candidate; v.repack(); }],
  ['mutable candidate URL', v => { v.payloads[0].candidateUrl = 'https://fcos.fcuno.com'; v.repack(); }],
  ['different normal-role candidate', v => { v.payloads[1].candidateUrl = 'https://fcos-z9y8x7w6v-hocheunglai-6535s-projects.vercel.app'; v.repack(); }],
  ['normal capture before producer', v => { v.payloads[1].capturedAt = v.iso(-91000); v.repack(); }],
  ['normal capture after artifact', v => { v.payloads[1].capturedAt = v.iso(-50000); v.repack(); }],
]) test(`actual required quality consumer rejects ${label}`, async () => { const v = fixture(); change(v); assert.equal((await v.check()).errors.length, 1); });

test('consumer has only provider reads and no checkout, protected environment, identity or deployment authority', () => {
  const job = workflow.jobs['authenticated-browser'];
  assert.deepEqual(job.permissions, { actions: 'read', contents: 'read' });
  assert.equal(job.environment, undefined);
  assert.equal(job.steps.length, 1);
  assert.doesNotMatch(JSON.stringify(job), /secrets\.|actions\/checkout|id-token|continue-on-error/);
  assert.doesNotMatch(consumer, /createDeployment|updateEnvironment|rerunWorkflow|workflow_dispatch.*POST/);
  const configuration = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(configuration.git.deploymentEnabled['codex/rapid-release-workflow-20261009'], false);
  assert.equal(configuration.git.deploymentEnabled.main, false);
});

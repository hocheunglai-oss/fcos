import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import { CANDIDATE_QUALITY_SHA, CANDIDATE_QUALITY_ADMISSION, CANDIDATE_QUALITY_MANIFEST,
  CANDIDATE_QUALITY_MANIFEST_HASH, CANDIDATE_QUALITY_WORKFLOW, CANDIDATE_QUALITY_ENABLE,
  CANDIDATE_QUALITY_TEST_STEPS, candidateQualityArtifactName, assertCandidateQualityArtifact,
  assertCandidateQualityAdmission, createCandidateQualityReceipt, candidateQualitySource } from '../scripts/lib/candidate-quality.mjs';
import { candidateQualityReads, runCandidateQualityReceipt } from '../scripts/candidate-quality-receipt.mjs';
import { collectTrustedReleaseEvidence, RELEASE_REPOSITORY } from '../scripts/lib/release-evidence.mjs';
import { releaseHash, releaseConfigurationRevision } from '../scripts/lib/release-readiness.mjs';
import { PREVIEW_EMAIL_BUILD_CONTROL_FILES, previewEmailBuildControlRevision } from '../scripts/lib/preview-email-build.mjs';
import { runtimeCompatibilityControlRevision, FIRST_RUNTIME_ROLLOUT } from '../scripts/lib/runtime-compatibility-release.mjs';
import { FCOS_RELEASE_APPROVAL_POLICY } from '../config/fcosConnections.js';
import { SUCCESSOR_LIVE_HARNESS_FILES } from '../scripts/lib/runtime-compatibility-successor-live.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflowBytes = readFileSync(join(root, CANDIDATE_QUALITY_WORKFLOW));
const manifestBytes = readFileSync(join(root, CANDIDATE_QUALITY_MANIFEST));
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const candidateWorkflowBytes = Buffer.from(git(['show', `${CANDIDATE_QUALITY_SHA}:.github/workflows/quality.yml`]) + '\n');
const candidateLockBytes = Buffer.from(git(['show', `${CANDIDATE_QUALITY_SHA}:package-lock.json`]) + '\n');

function fixture() {
  const now = Date.parse('2026-10-04T02:30:00Z');
  const repository = { id: 42, full_name: RELEASE_REPOSITORY, default_branch: 'main', owner: { login: 'hocheunglai-oss', id: 7 } };
  const branch = { name: 'main', protected: true, commit: { sha: 'b'.repeat(40) } };
  const run = { id: 100, repository, head_repository: repository, head_sha: branch.commit.sha, head_branch: 'main',
    path: CANDIDATE_QUALITY_WORKFLOW, event: 'workflow_dispatch', run_attempt: 1, actor: repository.owner, triggering_actor: repository.owner,
    run_started_at: '2026-10-04T02:25:00Z', status: 'completed', conclusion: 'success', updated_at: '2026-10-04T02:29:30Z' };
  const successful = names => names.map(name => ({ name, status: 'completed', conclusion: 'success' }));
  const job = (id, name, started_at, completed_at, steps) => ({ id, name, run_id: run.id, run_attempt: 1, head_sha: run.head_sha,
    started_at, completed_at, status: 'completed', conclusion: 'success', steps: successful(steps) });
  const jobs = { total_count: 3, jobs: [
    job(201, 'source-verification', '2026-10-04T02:25:00Z', '2026-10-04T02:26:00Z', ['Verify admitted source']),
    job(202, 'candidate-tests', '2026-10-04T02:26:00Z', '2026-10-04T02:29:00Z', CANDIDATE_QUALITY_TEST_STEPS),
    job(203, 'trusted-receipt', '2026-10-04T02:29:10Z', '2026-10-04T02:29:30Z', ['Verify source and prepare trusted receipt', 'Publish trusted exact-source artifact']),
  ] };
  const source = { candidateSha: CANDIDATE_QUALITY_SHA, sourceDigest: CANDIDATE_QUALITY_ADMISSION.sourceDigest,
    lockSha256: CANDIDATE_QUALITY_ADMISSION.lockSha256, candidateWorkflowSha256: CANDIDATE_QUALITY_ADMISSION.qualityWorkflowSha256,
    manifestSha256: CANDIDATE_QUALITY_MANIFEST_HASH, harnessSha: run.head_sha, harnessWorkflowSha256: releaseHash(workflowBytes), configurationRevision: 'c'.repeat(64) };
  const payload = { schemaVersion: 2, receiptKind: 'fcos_trusted_candidate_quality', ...source, runId: run.id, runAttempt: 1,
    testJobId: 202, capturedAt: jobs.jobs[1].completed_at, publishedAt: '2026-10-04T02:29:20Z' };
  const archive = Buffer.from(JSON.stringify(payload));
  const artifact = { id: 300, name: candidateQualityArtifactName(run.id), expired: false, created_at: '2026-10-04T02:29:25Z',
    digest: `sha256:${releaseHash(archive)}`, workflow_run: { id: run.id, head_sha: run.head_sha } };
  return { now, repository, branch, run, jobs, source, payload, archive, artifact, artifacts: { total_count: 1, artifacts: [artifact] },
    enabled: 'true', manifestHash: CANDIDATE_QUALITY_MANIFEST_HASH, harnessWorkflowHash: releaseHash(workflowBytes),
    binding: { sha: CANDIDATE_QUALITY_SHA, sourceDigest: source.sourceDigest, lockHash: source.lockSha256,
      configurationRevision: source.configurationRevision, deploymentId: 'dpl_candidate', candidateUrl: 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app' } };
}

test('trusted receipt accepts exact source and preserves original test completion time', () => {
  const value = fixture();
  assert.equal(assertCandidateQualityArtifact(value).capturedAt, value.jobs.jobs[1].completed_at);
  value.run.status = 'in_progress'; value.run.conclusion = null;
  value.jobs.jobs[2].status = 'in_progress'; value.jobs.jobs[2].conclusion = null; value.jobs.jobs[2].completed_at = null;
  value.artifacts = { total_count: 0, artifacts: [] };
  const receipt = createCandidateQualityReceipt(value);
  assert.equal(receipt.capturedAt, value.payload.capturedAt);
  assert.equal(receipt.publishedAt, new Date(value.now).toISOString());
  value.artifacts = { total_count: 1, artifacts: [value.artifact] };
  assert.throws(() => createCandidateQualityReceipt(value));
});

const invalidCases = [
  ['wrong candidate', v => { v.payload.candidateSha = 'a'.repeat(40); }],
  ['wrong source', v => { v.payload.sourceDigest = 'a'.repeat(64); }],
  ['wrong lock', v => { v.payload.lockSha256 = 'a'.repeat(64); }],
  ['wrong configuration', v => { v.payload.configurationRevision = 'a'.repeat(64); }],
  ['wrong candidate workflow', v => { v.payload.candidateWorkflowSha256 = 'a'.repeat(64); }],
  ['wrong harness workflow', v => { v.payload.harnessWorkflowSha256 = 'a'.repeat(64); }],
  ['wrong manifest', v => { v.manifestHash = 'a'.repeat(64); }],
  ['wrong main', v => { v.branch.commit.sha = 'a'.repeat(40); }],
  ['unprotected main', v => { v.branch.protected = false; }],
  ['wrong repository', v => { v.repository.full_name = 'another/repository'; }],
  ['wrong default branch', v => { v.repository.default_branch = 'another'; }],
  ['wrong run branch', v => { v.run.head_branch = 'candidate'; }],
  ['wrong workflow path', v => { v.run.path = '.github/workflows/quality.yml'; }],
  ['wrong actor', v => { v.run.actor = { login: 'someone', id: 8 }; }],
  ['wrong triggering actor', v => { v.run.triggering_actor = { login: 'someone', id: 8 }; }],
  ['rerun', v => { v.run.run_attempt = 2; }],
  ['wrong event', v => { v.run.event = 'pull_request'; }],
  ['disabled', v => { v.enabled = 'false'; }],
  ['missing enable', v => { v.enabled = undefined; }],
  ['failed tests', v => { v.jobs.jobs[1].conclusion = 'failure'; }],
  ['skipped tests', v => { v.jobs.jobs[1].conclusion = 'skipped'; }],
  ['missing job', v => { v.jobs.jobs.pop(); v.jobs.total_count--; }],
  ['duplicate job', v => { v.jobs.jobs[2].name = 'candidate-tests'; }],
  ['wrong job head', v => { v.jobs.jobs[1].head_sha = 'a'.repeat(40); }],
  ['wrong job attempt', v => { v.jobs.jobs[1].run_attempt = 2; }],
  ['missing mandatory step', v => { v.jobs.jobs[1].steps.pop(); }],
  ['skipped mandatory step', v => { v.jobs.jobs[1].steps[0].conclusion = 'skipped'; }],
  ['failed mandatory step', v => { v.jobs.jobs[1].steps[0].conclusion = 'failure'; }],
  ['duplicate mandatory step', v => { v.jobs.jobs[1].steps.push(v.jobs.jobs[1].steps[0]); }],
  ['receipt published before tests', v => { v.jobs.jobs[2].started_at = '2026-10-04T02:28:00Z'; }],
  ['wrong test job receipt', v => { v.payload.testJobId = 999; }],
  ['duplicate artifact', v => { v.artifacts.artifacts.push({ ...v.artifact, id: 301 }); v.artifacts.total_count++; }],
  ['incomplete artifact list', v => { v.artifacts.total_count++; }],
  ['expired artifact', v => { v.artifact.expired = true; }],
  ['wrong artifact run', v => { v.artifact.workflow_run.id = 999; }],
  ['tampered archive', v => { v.archive = Buffer.from('tampered'); }],
  ['wrong provider digest', v => { v.artifact.digest = `sha256:${'a'.repeat(64)}`; }],
  ['stale original evidence', v => { v.now += 31 * 60 * 1000; }],
  ['refreshed original timestamp', v => { v.payload.capturedAt = new Date(v.now).toISOString(); }],
  ['candidate pass report', v => { v.payload.pass = true; }],
  ['artifact predates publisher', v => { v.artifact.created_at = '2026-10-04T02:29:00Z'; }],
];
for (const [name, mutate] of invalidCases) test(`trusted quality rejects ${name}`, () => {
  const value = fixture(); mutate(value); assert.throws(() => assertCandidateQualityArtifact(value));
});

test('default-off workflow isolates candidate execution and includes every reviewed test command', () => {
  const parsed = load(workflowBytes.toString());
  assert.deepEqual(Object.keys(parsed.on), ['workflow_dispatch']);
  assert.match(parsed.jobs['source-verification'].if, /FCOS_TRUSTED_CANDIDATE_QUALITY_ENABLED == 'true'/);
  assert.deepEqual(Object.keys(parsed.jobs), ['source-verification', 'candidate-tests', 'trusted-receipt']);
  assert.deepEqual(parsed.jobs['candidate-tests'].permissions, { contents: 'read' });
  assert.deepEqual(parsed.jobs['candidate-tests'].needs, 'source-verification');
  assert.equal(workflowBytes.toString().includes('secrets.'), false);
  for (const job of Object.values(parsed.jobs)) {
    assert.equal(job.environment, undefined);
    for (const step of job.steps) if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
    assert.equal(job.steps.some(step => step.with?.cache), false);
  }
  const candidateSteps = parsed.jobs['candidate-tests'].steps;
  assert.deepEqual(candidateSteps.filter(step => step.name).map(step => step.name), CANDIDATE_QUALITY_TEST_STEPS);
  assert.equal(candidateSteps.some(step => step.uses?.startsWith('actions/upload-artifact@')), false);
  const original = load(candidateWorkflowBytes.toString()).jobs['code-and-database'].steps;
  const commands = candidateSteps.map(step => step.run).filter(Boolean);
  for (const step of original) {
    if (!step.run || step.name === 'Record exact tested source' || step.name === 'Verify Missing Nom B database concurrency and recovery') continue;
    assert.ok(commands.includes(step.run), `Missing original command ${step.run}`);
  }
  const upload = parsed.jobs['trusted-receipt'].steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.with.overwrite, false);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with.path, '${{ runner.temp }}/fcos-quality-source.json');
});

test('admission and implementation are included in all three control hash closures without changing the first rollout', () => {
  const closure = [CANDIDATE_QUALITY_WORKFLOW, CANDIDATE_QUALITY_MANIFEST, 'scripts/candidate-quality-receipt.mjs', 'scripts/lib/candidate-quality.mjs'];
  const source = releaseConfigurationRevision.toString();
  for (const path of closure) {
    assert.ok(source.includes(path)); assert.ok(PREVIEW_EMAIL_BUILD_CONTROL_FILES.includes(path));
    assert.ok(runtimeCompatibilityControlRevision.toString().includes(path));
  }
  assert.ok(PREVIEW_EMAIL_BUILD_CONTROL_FILES.includes('scripts/lib/release-readiness.mjs'));
  assert.equal(FIRST_RUNTIME_ROLLOUT.candidateSha, 'ff8859b287009e20462c5c0cceff89ae12f13010');
  assert.equal(FIRST_RUNTIME_ROLLOUT.previousSha, 'f3472492ff4d0b0c70248a3c8e5c0012981a94b3');
  assertCandidateQualityAdmission();
  assert.throws(() => assertCandidateQualityAdmission({ ...CANDIDATE_QUALITY_ADMISSION, candidateSha: 'a'.repeat(40) }));
});

test('new collector route independently reads current enable/source/workflow/job/archive bindings', async () => {
  const value = fixture();
  const protection = { enforce_admins: { enabled: true }, required_status_checks: { strict: true,
    checks: FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context => ({ context, app_id: FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId })) } };
  const content = (path, bytes, blob = 'd'.repeat(40)) => ({ type: 'file', path, encoding: 'base64', sha: blob, content: bytes.toString('base64') });
  const calls = [];
  const reads = { archive: () => value.archive, json: endpoint => {
    calls.push(endpoint);
    if (endpoint === `repos/${RELEASE_REPOSITORY}`) return value.repository;
    if (endpoint.endsWith('/branches/main')) return value.branch;
    if (endpoint.endsWith('/protection')) return protection;
    if (endpoint.endsWith(`/actions/variables/${CANDIDATE_QUALITY_ENABLE}`)) return { name: CANDIDATE_QUALITY_ENABLE, value: value.enabled };
    if (endpoint.includes(`/contents/${CANDIDATE_QUALITY_MANIFEST}?`)) return content(CANDIDATE_QUALITY_MANIFEST, manifestBytes);
    if (endpoint.includes(`/contents/${CANDIDATE_QUALITY_WORKFLOW}?`)) return content(CANDIDATE_QUALITY_WORKFLOW, workflowBytes);
    if (endpoint.includes('/contents/.github/workflows/quality.yml?')) return content('.github/workflows/quality.yml', candidateWorkflowBytes, CANDIDATE_QUALITY_ADMISSION.qualityWorkflowBlob);
    if (endpoint.includes('/contents/package-lock.json?')) return content('package-lock.json', candidateLockBytes);
    if (endpoint.includes('/git/ref/heads/')) return { ref: `refs/heads/${CANDIDATE_QUALITY_ADMISSION.branch}`, object: { type: 'commit', sha: CANDIDATE_QUALITY_SHA } };
    if (endpoint.includes('/candidate-quality.yml/runs?')) return { workflow_runs: [value.run] };
    if (endpoint.includes('/attempts/1/jobs?')) return value.jobs;
    if (endpoint.includes('/artifacts?')) return value.artifacts;
    if (endpoint.includes('/runs?')) return { workflow_runs: [] };
    throw new Error(`Unexpected fixture read ${endpoint}`);
  } };
  const collect = () => collectTrustedReleaseEvidence({ reads, binding: value.binding, now: value.now, unpack: () => value.payload });
  assert.equal((await collect()).quality.capturedAt, value.payload.capturedAt);
  assert.equal(calls.filter(path => path.endsWith(`/actions/variables/${CANDIDATE_QUALITY_ENABLE}`)).length, 2);
  value.enabled = 'false';
  assert.equal((await collect()).quality, null);
  value.enabled = 'true'; value.jobs.jobs[1].steps[0].conclusion = 'skipped';
  assert.equal((await collect()).quality, null);
});

test('read adapter denies other targets/encoded traversal and CLI rejects candidate-controlled environment before any read', async () => {
  let calls = 0;
  const reads = candidateQualityReads('fixture-token', async () => { calls++; throw new Error('private provider response'); });
  for (const endpoint of ['user', 'repos/other/repo', `repos/${RELEASE_REPOSITORY}/%2e%2e/%2e%2e/user`]) await assert.rejects(() => reads.json(endpoint));
  assert.equal(calls, 0);
  await assert.rejects(() => runCandidateQualityReceipt({ mode: '--publish', env: { pass: 'true' }, reads: { json: () => { calls++; } } }));
  assert.equal(calls, 0);
});

test('source and publication jobs independently recompute immutable source and reject provider-shape or output collisions', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'fcos-candidate-quality-source-')));
  try {
    const candidateCwd = join(directory, 'candidate'), trustedCwd = join(directory, 'trusted');
    git(['clone', '--shared', '--no-checkout', root, candidateCwd]);
    git(['checkout', '--detach', CANDIDATE_QUALITY_SHA], candidateCwd);
    git(['remote', 'set-url', 'origin', `https://github.com/${RELEASE_REPOSITORY}.git`], candidateCwd);
    git(['clone', '--shared', '--no-checkout', root, trustedCwd]);
    git(['checkout', '--detach', '3174ebdc1ef09f95bcdc24acad65df817b29ef6b'], trustedCwd);
    git(['remote', 'set-url', 'origin', `https://github.com/${RELEASE_REPOSITORY}.git`], trustedCwd);
    const implementation = [...new Set([...SUCCESSOR_LIVE_HARNESS_FILES, CANDIDATE_QUALITY_WORKFLOW, CANDIDATE_QUALITY_MANIFEST, 'scripts/candidate-quality-receipt.mjs',
      'scripts/lib/candidate-quality.mjs', 'scripts/lib/release-evidence.mjs', 'scripts/lib/release-readiness.mjs',
      'scripts/lib/preview-email-build.mjs', 'scripts/lib/runtime-compatibility-release.mjs',
      'scripts/lib/compatibility-browser-isolation.mjs', 'tests/compatibility-browser-isolation.chromium.mjs'])];
    for (const file of implementation) {
      mkdirSync(join(trustedCwd, file, '..'), { recursive: true });
      writeFileSync(join(trustedCwd, file), readFileSync(join(root, file)));
    }
    git(['add', ...implementation], trustedCwd);
    git(['-c', 'user.name=FCOS Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture trusted source'], trustedCwd);
    const harnessSha = git(['rev-parse', 'HEAD'], trustedCwd);
    const source = candidateQualitySource({ candidateCwd, trustedCwd, harnessSha });
    assert.equal(source.sourceDigest, CANDIDATE_QUALITY_ADMISSION.sourceDigest);
    assert.equal(source.candidateSha, CANDIDATE_QUALITY_SHA);
    const closure = [CANDIDATE_QUALITY_WORKFLOW, CANDIDATE_QUALITY_MANIFEST, 'scripts/candidate-quality-receipt.mjs',
      'scripts/lib/candidate-quality.mjs', 'scripts/lib/release-readiness.mjs', 'scripts/lib/build-provenance.mjs', 'scripts/verify-e2e-candidate.mjs'];
    const revisions = () => [releaseConfigurationRevision(candidateCwd, trustedCwd),
      previewEmailBuildControlRevision(trustedCwd), runtimeCompatibilityControlRevision(trustedCwd, candidateCwd)];
    const original = revisions();
    // These new controls must come from the current trusted source; the pinned
    // historical fixture base predates them. Missing or foreign bytes fail
    // completeness/source trust rather than weakening the real verifier.
    for (const [file, affected] of [['scripts/lib/compatibility-browser-isolation.mjs', [0, 2]],
      ['tests/compatibility-browser-isolation.chromium.mjs', [2]],
      ['scripts/lib/preview-email-build-controls.mjs', [1]]]) {
      const path = join(trustedCwd, file), bytes = readFileSync(path);
      rmSync(path);
      assert.throws(() => file === 'scripts/lib/preview-email-build-controls.mjs'
        ? previewEmailBuildControlRevision(trustedCwd) : runtimeCompatibilityControlRevision(trustedCwd, candidateCwd),
      error => error.code === 'ENOENT');
      writeFileSync(path, Buffer.concat([bytes, Buffer.from('\n// foreign fixture control bytes\n')]));
      const changed = revisions();
      for (const index of affected) assert.notEqual(changed[index], original[index], `Unbound fixture control ${file}`);
      assert.throws(() => candidateQualitySource({ candidateCwd, trustedCwd, harnessSha }));
      writeFileSync(path, bytes);
    }
    assert.deepEqual(revisions(), original);
    for (const file of closure) {
      const path = join(trustedCwd, file), bytes = readFileSync(path);
      writeFileSync(path, Buffer.concat([bytes, Buffer.from('\n# changed trusted dependency\n')]));
      assert.ok(revisions().every((value, index) => value !== original[index]), `Unbound trusted dependency ${file}`);
      writeFileSync(path, bytes);
    }
    symlinkSync(join(root, 'node_modules'), join(trustedCwd, 'node_modules'), 'dir');
    const { runCandidateQualityReceipt: runIsolated } = await import(pathToFileURL(join(trustedCwd, 'scripts/candidate-quality-receipt.mjs')));
    const value = fixture();
    value.branch.commit.sha = harnessSha; value.run.head_sha = harnessSha;
    value.run.status = 'in_progress'; value.run.conclusion = null;
    for (const job of value.jobs.jobs) job.head_sha = harnessSha;
    Object.assign(value.jobs.jobs[2], { status: 'in_progress', conclusion: null, completed_at: null });
    const runnerTemp = join(directory, 'runner-temp'); mkdirSync(runnerTemp);
    const env = { GITHUB_REPOSITORY: RELEASE_REPOSITORY, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
      GITHUB_WORKFLOW_REF: `${RELEASE_REPOSITORY}/${CANDIDATE_QUALITY_WORKFLOW}@refs/heads/main`, GITHUB_SHA: harnessSha,
      GITHUB_RUN_ID: String(value.run.id), GITHUB_RUN_ATTEMPT: '1', FCOS_CANDIDATE_QUALITY_ENABLED: 'true',
      FCOS_CANDIDATE_QUALITY_EXPECTED_SHA: CANDIDATE_QUALITY_SHA, FCOS_CANDIDATE_QUALITY_SOURCE_DIRECTORY: candidateCwd, RUNNER_TEMP: runnerTemp };
    let malformed = false, changedMain = false, branchReads = 0;
    const api = { json: endpoint => {
      if (endpoint === `repos/${RELEASE_REPOSITORY}`) return value.repository;
      if (endpoint.endsWith('/branches/main')) { branchReads++; return changedMain && branchReads > 1 ? { ...value.branch, name: 'wrong' } : value.branch; }
      if (endpoint.endsWith(`/actions/runs/${value.run.id}`)) return value.run;
      if (endpoint.includes('/git/ref/heads/')) return { ref: `refs/heads/${CANDIDATE_QUALITY_ADMISSION.branch}`, object: { type: 'commit', sha: CANDIDATE_QUALITY_SHA } };
      for (const file of [CANDIDATE_QUALITY_MANIFEST, CANDIDATE_QUALITY_WORKFLOW]) if (endpoint.includes(`/contents/${file}?`)) {
        return { type: 'file', path: malformed ? 'wrong' : file, sha: git(['rev-parse', `HEAD:${file}`], trustedCwd),
          encoding: 'base64', content: readFileSync(join(trustedCwd, file)).toString('base64') };
      }
      if (endpoint.includes('/attempts/1/jobs?')) return value.jobs;
      if (endpoint.includes('/artifacts?')) return { total_count: 0, artifacts: [] };
      throw new Error('Unexpected source-job fixture request');
    } };
    assert.equal((await runIsolated({ mode: '--source', env, reads: api, now: value.now })).sourceVerified, true);
    malformed = true;
    await assert.rejects(() => runIsolated({ mode: '--source', env, reads: api, now: value.now }));
    malformed = false; changedMain = true; branchReads = 0;
    await assert.rejects(() => runIsolated({ mode: '--publish', env, reads: api, now: value.now }));
    changedMain = false;
    assert.equal((await runIsolated({ mode: '--publish', env, reads: api, now: value.now })).capturedAt, value.jobs.jobs[1].completed_at);
    const receipt = JSON.parse(readFileSync(join(runnerTemp, 'fcos-quality-source.json')));
    assert.equal(receipt.configurationRevision, source.configurationRevision);
    await assert.rejects(() => runIsolated({ mode: '--publish', env, reads: api, now: value.now }));
    writeFileSync(join(candidateCwd, 'package-lock.json'), 'tampered');
    assert.throws(() => candidateQualitySource({ candidateCwd, trustedCwd, harnessSha }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('superseded source admission and receipt cannot satisfy successor quality', () => {
  const earlier = { ...CANDIDATE_QUALITY_ADMISSION,
    candidateSha: '6dbb83215cc5b9964dbe32a13f852e3a62e7bcc2',
    branch: 'codex/full-release-integration-20261003',
    sourceDigest: 'e34b07eec45fd3c1bb4203c52a052ae77eea13945367ec88c3b9cf6991b5d4a9' };
  assert.throws(() => assertCandidateQualityAdmission(earlier));
  const value = fixture();
  value.payload.candidateSha = earlier.candidateSha;
  value.binding.sha = earlier.candidateSha;
  value.payload.sourceDigest = earlier.sourceDigest;
  value.binding.sourceDigest = earlier.sourceDigest;
  assert.throws(() => assertCandidateQualityArtifact(value));
});

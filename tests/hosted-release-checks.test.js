import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReleaseCheckManifest, runReleaseChecks, evaluateCheckEvidence, requiredReleaseChecks } from '../scripts/lib/hosted-release/checks.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = (args, env = {}) => ({ program: 'node', args, env });
// Fixture execution mode must not depend on the outer Actions/Docker check job.
const fixtureEnvironment = root => ({ PATH: process.env.PATH, TMPDIR: root,
  GH_TOKEN: 'not-a-real-secret', GITHUB_TOKEN: 'not-a-real-secret', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'not-a-real-secret',
  FCOS_CONTROLLER_TOKEN: 'not-a-real-secret', SUPABASE_ACCESS_TOKEN: 'not-a-real-secret', SF_ACCESS_TOKEN: 'not-a-real-secret' });
const check = (id, commands, requires = []) => ({ id, group: 'code', phase: 'deterministic', kind: 'deterministic', executor: 'candidate', required: true, requires, inputs: ['@source'], profiles: ['controller_v2'], commands });
function file(root, name, contents) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), contents); }
function init(root) {
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/hocheunglai-oss/fcos.git']);
}
function commit(root) {
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}
function fixture(t, checks = [check('unit', [command(['--test', 'tests/*.test.js'])])]) {
  const root = mkdtempSync(join(tmpdir(), 'fcos-check-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidateDirectory = join(root, 'candidate'), controllerDirectory = join(root, 'controller');
  init(candidateDirectory); init(controllerDirectory);
  for (const p of ['scripts/hosted-release-checks.mjs', 'scripts/lib/hosted-release/checks.mjs', '.codex/control-validation.mjs']) file(controllerDirectory, p, readFileSync(join(repository, p)));
  file(controllerDirectory, 'package.json', '{"type":"module"}');
  file(controllerDirectory, 'config/release-checks-v2.json', JSON.stringify({ schemaVersion: 2, manifestId: 'test', nodeMajor: 24, volatileMaximumAgeMs: 1800000, sourceProfiles: { controller_v2: {} }, checks }));
  const controllerSha = commit(controllerDirectory);
  // Candidate npm scripts and a candidate copy of the manifest are deliberately hostile.
  file(candidateDirectory, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node -e "process.exit(99)"' } }));
  file(candidateDirectory, 'package-lock.json', '{"lockfileVersion":3}');
  file(candidateDirectory, 'config/release-checks-v2.json', '{"program":"sh","args":["-c","exit 99"]}');
  file(candidateDirectory, 'tests/probe.test.js', `import test from 'node:test'; import assert from 'node:assert/strict'; test('isolated',()=>{ for(const name of ['GH_TOKEN','GITHUB_TOKEN','ACTIONS_ID_TOKEN_REQUEST_TOKEN','SUPABASE_ACCESS_TOKEN','SF_ACCESS_TOKEN','NODE_OPTIONS','FCOS_CONTROLLER_TOKEN']) assert.equal(process.env[name],undefined); assert.ok(process.env.HOME.includes('fcos-check-home-')); });`);
  const expectedCandidateSha = commit(candidateDirectory);
  return { root, candidateDirectory, controllerDirectory, controllerSha, expectedCandidateSha, sourceProfile: 'controller_v2', environment: fixtureEnvironment(root) };
}

test('versioned profiles preserve actual frozen04ee fixtures, every database category and separate browser coverage', () => {
  const { manifest } = loadReleaseCheckManifest(repository);
  const frozen = requiredReleaseChecks(manifest, 'frozen_04ee');
  assert.deepEqual(frozen.filter(c => c.group === 'fixtures').map(c => c.id), ['nom_b_fixtures', 'missing_nom_b_fixtures', 'people_access_fixtures', 'xero_campaign_fixtures']);
  assert.equal(frozen.filter(c => c.group === 'database').length, 12);
  assert.equal(frozen.find(c => c.id === 'normal_role').coverage.length, 15);
  assert.notEqual(frozen.find(c => c.id === 'normal_role').id, frozen.find(c => c.id === 'restricted_browser').id);
  assert.deepEqual(frozen.find(c => c.id === 'server_performance').commands[0].env, { FCOS_REQUIRE_SERVER_BUNDLES: '1' });
  assert.equal(frozen.find(c => c.id === 'build').commands.length, 4);
  assert.equal(frozen.find(c => c.id === 'final_acceptance').requires.length, manifest.checks.length - 1);
  for (const c of frozen.filter(c => c.executor === 'candidate')) {
    for (const cmd of c.commands) for (const arg of cmd.args) {
      if (/^(?:scripts\/|tests\/|playwright\.)/.test(arg) && !arg.includes('*')) {
        assert.doesNotThrow(() => execFileSync('git', ['cat-file', '-e', `${manifest.sourceProfiles.frozen_04ee.candidateSha}:${arg}`], { cwd: repository, stdio: 'ignore' }), `${c.id}: ${arg}`);
      }
    }
  }
});

test('actual CLI runs fixed commands, expands complete unit suite and strips controller/provider credentials', t => {
  const f = fixture(t);
  const output = join(f.root, 'report.json');
  const result = spawnSync(process.execPath, [join(f.controllerDirectory, 'scripts/hosted-release-checks.mjs'),
    '--candidate-directory', f.candidateDirectory, '--controller-directory', f.controllerDirectory, '--controller-sha', f.controllerSha,
    '--candidate-sha', f.expectedCandidateSha, '--source-profile', f.sourceProfile, '--group', 'code', '--evidence', output], {
    encoding: 'utf8', env: f.environment,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(readFileSync(output));
  assert.equal(report.kind, 'fcos_hosted_release_checks');
  assert.equal(report.status, 'passed');
  assert.equal(report.controllerSha, f.controllerSha);
  assert.equal(report.candidateSha, f.expectedCandidateSha);
  assert.deepEqual(report.checks[0].commands[0].args, ['--test', 'tests/*.test.js']);
  assert.doesNotMatch(readFileSync(output, 'utf8'), /not-a-real-secret/);
});

test('actual CLI in Actions requires admitted isolation before executing candidate commands', t => {
  const f = fixture(t);
  for (const p of ['scripts/lib/hosted-release/isolation.mjs', 'scripts/lib/hosted-release/contract.mjs', 'config/fcosConnections.js']) file(f.controllerDirectory, p, readFileSync(join(repository, p)));
  f.controllerSha = commit(f.controllerDirectory);
  const marker = join(f.root, 'candidate-executed');
  file(f.candidateDirectory, 'tests/marker.test.js', `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`);
  f.expectedCandidateSha = commit(f.candidateDirectory);
  const output = join(f.root, 'report.json');
  const result = spawnSync(process.execPath, [join(f.controllerDirectory, 'scripts/hosted-release-checks.mjs'),
    '--candidate-directory', f.candidateDirectory, '--controller-directory', f.controllerDirectory, '--controller-sha', f.controllerSha,
    '--candidate-sha', f.expectedCandidateSha, '--source-profile', f.sourceProfile, '--group', 'code', '--evidence', output], {
    encoding: 'utf8', env: { ...f.environment, GITHUB_ACTIONS: 'true', FCOS_HOSTED_CHECK_IMAGE: 'unadmitted:latest' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Hosted release check command failed safely/);
  assert.equal(existsSync(marker), false, 'Actions must not fall back to running candidate code on the host');
  assert.equal(existsSync(output), false, 'isolation failure must not produce passing evidence');
  assert.doesNotMatch(result.stdout + result.stderr, /not-a-real-secret/);
});

test('deterministic cache retains original timestamps; lock/source changes invalidate it', async t => {
  const f = fixture(t); let calls = 0;
  const run = () => { calls++; return { status: 0 }; };
  const first = await runReleaseChecks({ ...f, run, now: () => new Date('2026-10-17T00:00:00Z') });
  const second = await runReleaseChecks({ ...f, run, cache: first.checks, now: () => new Date('2026-10-17T01:00:00Z') });
  assert.equal(calls, 1); assert.deepEqual(second.checks, first.checks);
  file(f.candidateDirectory, 'package-lock.json', '{"changed":true}');
  f.expectedCandidateSha = commit(f.candidateDirectory);
  await runReleaseChecks({ ...f, run, cache: first.checks });
  assert.equal(calls, 2);
  assert.equal(evaluateCheckEvidence({ check: check('unit', [command(['a']), command(['b'])]), binding: first.checks[0].binding, evidence: { ...first.checks[0], commands: [{ program: 'node', args: ['a'], exitCode: 0 }] } }), false);
});

test('pending and failed prerequisite evidence stays waiting_dependency and never executes dependent command', async t => {
  const f = fixture(t, [check('unit', [command(['--test', 'tests/*.test.js'])]), check('build', [command(['missing-build.mjs'])], ['unit'])]);
  let calls = 0;
  const pending = await runReleaseChecks({ ...f, checkIds: ['build'], run: () => { calls++; return { status: 0 }; } });
  assert.equal(pending.status, 'waiting_dependency'); assert.deepEqual(pending.checks[0].missing, ['unit']); assert.equal(calls, 0);
  const failed = await runReleaseChecks({ ...f, run: () => ({ status: 1 }) });
  assert.equal(failed.checks[0].status, 'failed'); assert.equal(failed.checks[1].status, 'waiting_dependency');
});

test('volatile proofs require publisher validation, original freshness and real complete module coverage', () => {
  const check = { id: 'normal_role', kind: 'volatile', coverage: ['a', 'b'] }, binding = { sourceProfile: 'x' };
  const evidence = { schemaVersion: 2, checkId: check.id, status: 'passed', binding, startedAt: '2026-10-17T00:00:00Z', completedAt: '2026-10-17T00:01:00Z', coverage: [{ module: 'a', result: 'passed', actualData: true }, { module: 'b', result: 'passed', actualData: true }] };
  const options = { check, binding, evidence, now: Date.parse('2026-10-17T00:02:00Z'), validateExternal: () => true };
  assert.equal(evaluateCheckEvidence(options), true);
  assert.equal(evaluateCheckEvidence({ ...options, validateExternal: undefined }), false);
  assert.equal(evaluateCheckEvidence({ ...options, now: Date.parse('2026-10-17T01:00:00Z') }), false);
  for (const coverage of [evidence.coverage.slice(0, 1), [evidence.coverage[0], evidence.coverage[0]], evidence.coverage.map(r => ({ ...r, actualData: false }))]) assert.equal(evaluateCheckEvidence({ ...options, evidence: { ...evidence, coverage } }), false);
});

test('strict server performance actually fails when Vercel server bundles are absent', async t => {
  const f = fixture(t, [check('server_performance', [command(['scripts/verify-performance-budgets.mjs'], { FCOS_REQUIRE_SERVER_BUNDLES: '1' })])]);
  for (const p of ['scripts/verify-performance-budgets.mjs', 'scripts/lib/performance-budget-verifier.mjs', 'config/performance-budgets.json', 'api/functions/[name].js', 'api/work-notifications.js', 'api/email-router-background-sync.js', 'api/_workNotifications.js', 'api/_emailRouterHandlers.js']) file(f.candidateDirectory, p, readFileSync(join(repository, p)));
  file(f.candidateDirectory, 'dist/assets/app.js', 'console.log("small fixture")');
  f.expectedCandidateSha = commit(f.candidateDirectory);
  const report = await runReleaseChecks(f);
  assert.equal(report.status, 'failed'); assert.equal(report.checks[0].commands[0].exitCode, 1);
});

test('dirty immutable controller, repository mismatch and arbitrary executable definitions fail closed', async t => {
  const f = fixture(t);
  file(f.controllerDirectory, 'scripts/hosted-release-checks.mjs', '// altered');
  await assert.rejects(runReleaseChecks({ ...f, run: () => ({ status: 0 }) }), /controller.*dirty/);
  const bad = fixture(t, [check('unit', [{ program: 'sh', args: ['-c', 'exit 0'], env: {} }])]);
  assert.throws(() => loadReleaseCheckManifest(bad.controllerDirectory), /Unadmitted/);
});

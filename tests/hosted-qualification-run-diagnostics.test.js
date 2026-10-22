import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQualificationRun } from '../scripts/lib/hosted-release/github.mjs';

const repository = 'hocheunglai-oss/fcos';
function fixture() {
  const controllerSha = 'a'.repeat(40), bootstrapSha = 'b'.repeat(40), branchName = 'codex/qualification-diagnostic';
  const source = { controllerSha, bootstrapSha, candidateSha: 'c'.repeat(40), ref: `refs/heads/${branchName}`,
    callerWorkflowRef: `${repository}/.github/workflows/authenticated-release.yml@refs/heads/${branchName}` };
  const branch = { name: branchName, protected: true, commit: { sha: bootstrapSha } };
  const protection = { enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } };
  const env = { FCOS_CONTROLLER_SHA: controllerSha, FCOS_CANDIDATE_SHA: source.candidateSha, GITHUB_REPOSITORY_ID: '1278654816',
    GITHUB_RUN_ID: '17', GITHUB_ACTOR: 'hocheunglai-oss', GITHUB_ACTOR_ID: '265701760' };
  const run = { repository: { full_name: repository, id: 1278654816 }, head_repository: { full_name: repository }, id: 17,
    head_branch: branchName, head_sha: bootstrapSha, path: '.github/workflows/authenticated-release.yml', event: 'workflow_dispatch',
    run_attempt: 1, status: 'in_progress', conclusion: null,
    referenced_workflows: [{ path: `${repository}/.github/workflows/hosted-release-controller.yml@${controllerSha}`, sha: controllerSha }],
    actor: { login: env.GITHUB_ACTOR, id: 265701760 }, triggering_actor: { login: env.GITHUB_ACTOR, id: 265701760 } };
  const reads = [], github = { async read(route) { reads.push(route); return route.endsWith('/protection') ? protection : branch; } };
  return { source, branch, protection, run, env, github, reads };
}
async function capture(action) {
  const previous = console.error, output = [];
  console.error = (...args) => output.push(args);
  try { await action(output); } finally { console.error = previous; }
}
const drift = { code: 'QUALIFICATION_SOURCE_DRIFT' };

test('valid immutable source emits no diagnostic and retains both supported workflow paths', async () => {
  await capture(async output => {
    const f = fixture();
    assert.equal(await validateQualificationRun(f), true);
    f.run.path += `@${f.run.head_branch}`;
    assert.equal(await validateQualificationRun(f), true);
    assert.equal(f.reads.length, 4);
    assert.deepEqual(output, []);
  });
});

test('each existing source gate still refuses and identifies only its fixed public predicate', async t => {
  const cases = [
    ['BRANCH_NAME', f => { f.branch.name = 'foreign'; }],
    ['BRANCH_PROTECTED', f => { f.branch.protected = false; }],
    ['BRANCH_TIP', f => { f.branch.commit.sha = 'd'.repeat(40); }],
    ['PROTECTION_ENFORCE_ADMINS', f => { f.protection.enforce_admins.enabled = false; }],
    ['PROTECTION_ALLOW_FORCE_PUSHES', f => { f.protection.allow_force_pushes.enabled = true; }],
    ['PROTECTION_ALLOW_DELETIONS', f => { f.protection.allow_deletions.enabled = true; }],
    ['RUN_REPOSITORY', f => { f.run.repository.full_name = 'foreign/repository'; }],
    ['RUN_REPOSITORY_ID', f => { f.run.repository.id = 1; }],
    ['RUN_HEAD_REPOSITORY', f => { f.run.head_repository.full_name = 'foreign/repository'; }],
    ['RUN_ID', f => { f.run.id = 18; }],
    ['RUN_BRANCH', f => { f.run.head_branch = 'main'; }],
    ['RUN_SHA', f => { f.run.head_sha = 'd'.repeat(40); }],
    ['RUN_WORKFLOW_PATH', f => { f.run.path = '.github/workflows/foreign.yml'; }],
    ['RUN_EVENT', f => { f.run.event = 'push'; }],
    ['RUN_ATTEMPT', f => { f.run.run_attempt = 2; }],
    ['RUN_STATUS', f => { f.run.status = 'waiting'; }],
    ['RUN_CONCLUSION', f => { f.run.conclusion = 'failure'; }],
    ['CONTROLLER_REFERENCE_COUNT', f => { f.run.referenced_workflows.push({ ...f.run.referenced_workflows[0] }); }],
    ['CONTROLLER_REFERENCE_SHA', f => { f.run.referenced_workflows[0].sha = 'd'.repeat(40); }],
    ['ENV_ACTOR', f => { f.env.GITHUB_ACTOR = 'foreign'; }],
    ['ENV_ACTOR_ID', f => { f.env.GITHUB_ACTOR_ID = 'not-an-id'; f.run.actor.id = f.env.GITHUB_ACTOR_ID; f.run.triggering_actor.id = f.env.GITHUB_ACTOR_ID; }],
    ['RUN_ACTOR', f => { f.run.actor.login = 'foreign'; }],
    ['RUN_ACTOR_ID', f => { f.run.actor.id = 1; }],
    ['RUN_TRIGGERING_ACTOR', f => { f.run.triggering_actor.login = 'foreign'; }],
    ['RUN_TRIGGERING_ACTOR_ID', f => { f.run.triggering_actor.id = 1; }],
  ];
  for (const [reason, mutate] of cases) await t.test(reason, async () => capture(async output => {
    const f = fixture(); mutate(f);
    await assert.rejects(validateQualificationRun(f), drift);
    assert.deepEqual(output, [[JSON.stringify({ kind: 'fcos_qualification_source_drift_diagnostic_v1', failedPredicates: [reason] })]]);
    assert.equal(f.reads.length, 2);
  }));
});

test('combined failures emit one bounded names-only record without provider or environment values', async () => {
  await capture(async output => {
    const f = fixture(), privateValue = 'PRIVATE_TEST_SENTINEL_DO_NOT_LOG\n{"forged":"diagnostic"}';
    f.branch.name = privateValue; f.protection.enforce_admins.enabled = privateValue;
    f.run.status = privateValue; f.run.actor.login = privateValue;
    f.run.providerBody = { token: privateValue }; f.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = privateValue;
    f.env.FCOS_HOSTED_GITHUB_READ_TOKEN = privateValue;
    await assert.rejects(validateQualificationRun(f), drift);
    assert.equal(output.length, 1); assert.equal(output[0].length, 1);
    assert.equal(output[0][0].includes(privateValue), false);
    const diagnostic = JSON.parse(output[0][0]);
    assert.deepEqual(Object.keys(diagnostic), ['kind', 'failedPredicates']);
    assert.deepEqual(diagnostic.failedPredicates, ['BRANCH_NAME', 'PROTECTION_ENFORCE_ADMINS', 'RUN_STATUS', 'RUN_ACTOR']);
    assert.ok(output[0][0].length < 1024);
  });
});

test('missing or malformed metadata refuses with bounded names rather than leaking response bodies', async () => {
  for (const mutate of [f => { f.run = null; }, f => { f.run.referenced_workflows = {}; },
    f => { f.run.referenced_workflows = [null]; }, f => { delete f.run.repository; }]) {
    await capture(async output => {
      const f = fixture(); mutate(f);
      await assert.rejects(validateQualificationRun(f), drift);
      const { failedPredicates } = JSON.parse(output[0][0]);
      assert.ok(failedPredicates.length > 0 && failedPredicates.length <= 25);
      assert.ok(failedPredicates.every(name => /^[A-Z_]+$/.test(name)));
      assert.ok(output[0][0].length < 1024);
    });
  }
});

test('diagnostic sink failure cannot turn source refusal into acceptance or another error code', async () => {
  const previous = console.error;
  console.error = () => { throw Error('synthetic diagnostic failure'); };
  try {
    const f = fixture(); f.branch.protected = false;
    await assert.rejects(validateQualificationRun(f), drift);
    assert.equal(f.reads.length, 2);
  } finally { console.error = previous; }
});

test('transport or source validation refusal gains no diagnostic data, additional read or retry', async () => {
  await capture(async output => {
    const f = fixture(); f.source.candidateSha = 'd'.repeat(40);
    await assert.rejects(validateQualificationRun(f), { code: 'QUALIFICATION_SOURCE_INVALID' });
    assert.deepEqual(f.reads, []);
    const g = fixture(), error = Object.assign(Error('PRIVATE_TRANSPORT_SENTINEL'), { code: 'GITHUB_READ_UNAVAILABLE' });
    g.github.read = async route => { g.reads.push(route); throw error; };
    await assert.rejects(validateQualificationRun(g), e => e === error);
    assert.equal(g.reads.length, 2);
    assert.deepEqual(output, []);
  });
});

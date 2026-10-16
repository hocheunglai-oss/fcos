import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { admitToolchainRun, toolchainAdmission } from '../scripts/hosted-toolchain-admission.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const workflow = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-toolchain.yml', import.meta.url), 'utf8'));

test('toolchain setup is opt-in, protected, exact-source and first-attempt only', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, {});
  for (const condition of ["FCOS_HOSTED_TOOLCHAIN_SETUP_ENABLED == 'true'", "github.repository == 'hocheunglai-oss/fcos'", "github.actor == 'hocheunglai-oss'", "github.ref == 'refs/heads/main'", 'github.ref_protected', 'github.run_attempt == 1']) assert.ok(workflow.jobs.build.if.includes(condition));
  const script = workflow.jobs.build.steps[0].run;
  const valid = { SOURCE_SHA: 'a'.repeat(40), ADMITTED_SOURCE_SHA: 'a'.repeat(40), INTENT_SHA256: 'b'.repeat(64), ADMITTED_INTENT_SHA256: 'b'.repeat(64) };
  for (const [patch, success] of [[{}, true], [{ SOURCE_SHA: 'main' }, false], [{ ADMITTED_SOURCE_SHA: 'c'.repeat(40) }, false], [{ INTENT_SHA256: '' }, false], [{ ADMITTED_INTENT_SHA256: 'd'.repeat(64) }, false]]) {
    assert.equal(spawnSync('/bin/bash', ['-c', script], { env: { ...valid, ...patch } }).status === 0, success);
  }
});

test('runner context is scoped to steps across all hosted workflow environments', () => {
  // GitHub evaluates workflow/job env before assigning a runner. See its context-availability table.
  const workflowContexts = new Set(['github', 'inputs', 'secrets', 'vars']);
  const jobContexts = new Set([...workflowContexts, 'matrix', 'needs', 'strategy']);
  function assertContexts(env, allowed, location) {
    for (const value of Object.values(env || {})) {
      for (const expression of String(value).matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
        const code = expression[1].replace(/'(?:[^']|'')*'/g, '');
        for (const context of code.matchAll(/(?<![\w.-])([A-Za-z_][\w-]*)\s*[.[]/g)) {
          assert.ok(allowed.has(context[1]), `${location} cannot use ${context[1]} context`);
        }
      }
    }
  }
  for (const file of ['hosted-release-toolchain.yml', 'hosted-release-controller.yml', 'hosted-release.yml', 'quality.yml']) {
    const definition = yaml.load(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'));
    assertContexts(definition.env, workflowContexts, `${file} env`);
    for (const [id, job] of Object.entries(definition.jobs)) assertContexts(job.env, jobContexts, `${file} jobs.${id}.env`);
    assert.throws(() => assertContexts({ DOCKER_CONFIG: '${{ runner.temp }}/registry' }, jobContexts, file), /cannot use runner context/);
  }
  assert.equal(workflow.jobs.publish.env.DOCKER_CONFIG, undefined);
  const publisher = workflow.jobs.publish.steps.find(step => step.env?.REGISTRY_TOKEN);
  assert.equal(publisher.env.DOCKER_CONFIG, '${{ runner.temp }}/fcos-toolchain-registry');
});

test('build cannot receive registry authority and publisher never executes image code', () => {
  const { build, publish } = workflow.jobs;
  assert.deepEqual(build.permissions, { contents: 'read' });
  assert.deepEqual(publish.permissions, { actions: 'read', contents: 'read', packages: 'write' });
  assert.equal(publish.needs, 'build');
  const buildText = JSON.stringify(build), publishScripts = publish.steps.map(step => step.run || '').join('\n');
  assert.ok(!buildText.includes('secrets.') && !buildText.includes('github.token') && !buildText.includes('docker login'));
  assert.ok(!publishScripts.includes('docker run') && !publishScripts.includes('docker build '));
  assert.ok(publishScripts.includes('sha256sum --check --strict'));
  assert.equal(publishScripts.match(/docker push /g)?.length, 1);
  assert.ok(publishScripts.includes('unset REGISTRY_TOKEN'));
  assert.ok(publishScripts.includes('publication.json'));
  assert.ok(publishScripts.indexOf('publication.json') < publishScripts.indexOf('docker push'));
  assert.equal(publish.steps.filter(step => step.env?.REGISTRY_TOKEN).length, 1);
  assert.ok(publish.steps.findIndex(step => step.run === 'node toolchain-output/admission.mjs') < publish.steps.findIndex(step => step.env?.REGISTRY_TOKEN));
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
});

function publicationRuns() {
  const repo = { id: 1278654816, full_name: 'hocheunglai-oss/fcos', default_branch: 'main', archived: false };
  const actor = { id: 265701760, login: 'hocheunglai-oss' };
  const current = { id: 4, run_number: 2, run_attempt: 1, event: 'workflow_dispatch', status: 'in_progress', conclusion: null,
    head_branch: 'main', head_sha: 'a'.repeat(40), path: '.github/workflows/hosted-release-toolchain.yml', repository: repo, head_repository: repo,
    actor, triggering_actor: actor, display_title: `FCOS toolchain ${'b'.repeat(64)}` };
  return [{ ...current, id: 3, run_number: 1, status: 'completed', conclusion: 'failure', display_title: `FCOS toolchain ${'c'.repeat(64)}` }, current];
}

test('complete hosted history rejects duplicate dispatch, prior failures and missing history', () => {
  assert.equal(admitToolchainRun({ runs: publicationRuns(), runId: 4, intentSha256: 'b'.repeat(64) }).admitted, true);
  for (const mutate of [
    runs => { runs[0].display_title = runs[1].display_title; },
    runs => { runs[0].display_title = runs[1].display_title; runs[0].conclusion = 'success'; },
    runs => { runs.shift(); },
    runs => { runs.push({ ...runs[0] }); },
    runs => { runs[1].run_attempt = 2; },
    runs => { runs[1].actor = { id: 1, login: 'other' }; },
    runs => { runs[1].head_branch = 'candidate'; },
  ]) { const runs = publicationRuns(); mutate(runs); assert.throws(() => admitToolchainRun({ runs, runId: 4, intentSha256: 'b'.repeat(64) })); }
});

test('actual admission entrypoint is target-locked GET-only and refuses incomplete inventory', async () => {
  const env = { GITHUB_REPOSITORY: 'hocheunglai-oss/fcos', GITHUB_REPOSITORY_ID: '1278654816', GITHUB_REF: 'refs/heads/main',
    GITHUB_REF_PROTECTED: 'true', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '4', GITHUB_TOKEN: 'private-canary', INTENT_SHA256: 'b'.repeat(64) };
  for (const missing of [false, true]) {
    let calls = 0;
    const task = toolchainAdmission({ env, fetchImpl: async (url, options) => {
      calls++; assert.ok(url.startsWith('https://api.github.com/repos/hocheunglai-oss/fcos')); assert.equal(options.method, 'GET');
      let data;
      if (url.endsWith('/fcos')) data = publicationRuns()[0].repository;
      else if (url.endsWith('/branches/main')) data = { name: 'main', protected: true };
      else data = { total_count: missing ? 3 : 2, workflow_runs: url.endsWith('page=1') ? publicationRuns() : [] };
      return { ok: true, redirected: false, json: async () => data };
    } });
    if (missing) await assert.rejects(task, /TOOLCHAIN_PUBLICATION_NOT_ADMITTED/);
    else assert.equal((await task).admitted, true);
    assert.ok(calls <= 4);
  }
});

test('actual publisher shell records intent before one push and preserves an uncertain failure', () => {
  const script = workflow.jobs.publish.steps.find(step => step.env?.REGISTRY_TOKEN).run;
  for (const pushStatus of [0, 1]) {
    const directory = mkdtempSync(join(tmpdir(), 'fcos-toolchain-publish-'));
    try {
      mkdirSync(join(directory, 'toolchain-output'));
      const fakeDocker = `docker() {
printf '%s\\n' "$1" >> "$CALL_LOG"
case "$1" in
  login) cat >/dev/null ;;
  push) test -f toolchain-output/publication.json; return "$PUSH_STATUS" ;;
  buildx) printf '{"digest":"sha256:${'d'.repeat(64)}"}\\n' ;;
esac
}`;
      const result = spawnSync('/bin/bash', ['-c', `${fakeDocker}\n${script}`], { cwd: directory, encoding: 'utf8', env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, CALL_LOG: join(directory, 'calls'), PUSH_STATUS: String(pushStatus),
        SOURCE_SHA: 'a'.repeat(40), INTENT_SHA256: 'b'.repeat(64), IMAGE_ID: `sha256:${'c'.repeat(64)}`,
        ARCHIVE_SHA256: 'e'.repeat(64), GITHUB_RUN_ID: '1234', GITHUB_STEP_SUMMARY: join(directory, 'summary'),
        DOCKER_CONFIG: join(directory, 'registry'), REGISTRY_TOKEN: 'private-test-canary',
      } });
      assert.equal(result.status, pushStatus);
      assert.equal(readFileSync(join(directory, 'calls'), 'utf8').split('\n').filter(value => value === 'push').length, 1);
      assert.ok(readFileSync(join(directory, 'calls'), 'utf8').includes('logout'));
      assert.equal(existsSync(join(directory, 'registry')), false);
      assert.equal(JSON.parse(readFileSync(join(directory, 'toolchain-output/publication.json'))).status, 'submitting');
      assert.equal(existsSync(join(directory, 'toolchain-output/publication.verified.json')), pushStatus === 0);
      assert.ok(!`${result.stdout}${result.stderr}`.includes('private-test-canary'));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

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

test('build cannot receive registry authority and publisher never executes image code', () => {
  const { build, publish } = workflow.jobs;
  assert.deepEqual(build.permissions, { contents: 'read' });
  assert.deepEqual(publish.permissions, { actions: 'read', packages: 'write' });
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
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
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

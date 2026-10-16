import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const template = readFileSync(new URL('../.github/qualification/hosted-release-bootstrap.yml', import.meta.url), 'utf8');
const definition = yaml.load(template);

test('qualification bootstrap stays inactive and calls the same immutable controller', () => {
  assert.deepEqual(Object.keys(definition.on), ['workflow_dispatch']);
  assert.deepEqual(definition.permissions, {});
  assert.deepEqual(Object.keys(definition.jobs), ['toolchain', 'manifest', 'release']);
  assert.equal(definition.jobs.manifest.if, "${{ inputs.bootstrap_phase == 'qualification' && vars.FCOS_HOSTED_QUALIFICATION_ADMITTED == 'true' }}");
  assert.equal(definition.jobs.manifest.environment, 'fcos-hosted-verification');
  assert.deepEqual(definition.jobs.manifest.permissions, { contents: 'read', actions: 'read' });
  assert.equal(template.split('__FCOS_CONTROLLER_SHA__').length - 1, 5);
  const sha = 'a'.repeat(40), rendered = yaml.load(template.replaceAll('__FCOS_CONTROLLER_SHA__', sha));
  assert.equal(rendered.jobs.manifest.env.FCOS_CONTROLLER_SHA, sha);
  assert.equal(rendered.jobs.manifest.steps[0].with.ref, sha);
  assert.equal(rendered.jobs.release.uses, `hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${sha}`);
  assert.deepEqual(rendered.jobs.release.secrets, { FCOS_HOSTED_GITHUB_READ_TOKEN: '${{ secrets.FCOS_HOSTED_GITHUB_READ_TOKEN }}' });
  assert.equal(rendered.jobs.toolchain.if, "${{ inputs.bootstrap_phase == 'toolchain' }}");
  assert.equal(rendered.jobs.toolchain.uses, `hocheunglai-oss/fcos/.github/workflows/hosted-release-toolchain.yml@${sha}`);
  assert.equal(rendered.jobs.toolchain.with.source_sha, sha);
  assert.equal(rendered.jobs.toolchain.secrets, undefined);
  assert.deepEqual(rendered.jobs.toolchain.permissions, { contents: 'read', actions: 'read', packages: 'write' });
  assert.equal(rendered.jobs.manifest.env.FCOS_QUALIFICATION_BOOTSTRAP, 'true');
  const controller = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml', import.meta.url), 'utf8'));
  assert.deepEqual(controller.on.workflow_call.secrets, { FCOS_HOSTED_GITHUB_READ_TOKEN: { required: false } });
  const mainCaller = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release.yml', import.meta.url), 'utf8'));
  assert.deepEqual(mainCaller.jobs.release.secrets, rendered.jobs.release.secrets);
  assert.doesNotMatch(JSON.stringify(controller.jobs.checks), /secrets\./);
  assert.equal(controller.env.FCOS_HOSTED_QUALIFICATION_ADMITTED, '${{ vars.FCOS_HOSTED_QUALIFICATION_ADMITTED }}');
});

test('bootstrap checks scope and live read-only admission before candidate checkout or provider access', () => {
  const steps = definition.jobs.manifest.steps;
  const admission = steps.findIndex(step => step.name === 'Admit qualification dispatch before candidate checkout');
  const dependencies = steps.findIndex(step => step.name === 'Install admitted controller dependencies');
  const checkout = steps.findIndex(step => step.with?.path === 'candidate');
  const prepare = steps.findIndex(step => step.name === 'Prepare actual qualification manifest');
  assert.ok(dependencies > 0 && dependencies < admission && admission < checkout && checkout < prepare);
  assert.equal(steps[dependencies].run, 'npm ci --ignore-scripts --no-audit --no-fund');
  assert.equal(steps[dependencies]['working-directory'], 'controller');
  assert.equal(steps[dependencies].env, undefined);
  assert.deepEqual(Object.keys(steps[admission].env).sort(), ['FCOS_HOSTED_GITHUB_READ_TOKEN', 'GITHUB_TOKEN']);
  assert.ok(steps[admission].run.includes('node controller/scripts/hosted-release-manifest.mjs --validate-dispatch-only'));
  const secrets = [...JSON.stringify(definition).matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(secrets)].sort(), [
    'FCOS_HOSTED_GITHUB_READ_TOKEN', 'FCOS_HOSTED_RUNTIME_EMAIL', 'FCOS_HOSTED_RUNTIME_PASSWORD',
    'FCOS_HOSTED_SCHEMA_DATABASE_URL', 'FCOS_HOSTED_VERCEL_READ_TOKEN', 'FCOS_PRODUCTION_VERIFICATION_BYPASS',
  ].sort());
  assert.ok(!secrets.includes('FCOS_HOSTED_VERCEL_PRODUCTION_TOKEN'));
});

test('actual bootstrap shell refuses release scopes before invoking the controller admission', () => {
  const script = definition.jobs.manifest.steps.find(step => step.name === 'Admit qualification dispatch before candidate checkout').run;
  const directory = mkdtempSync(join(tmpdir(), 'fcos-bootstrap-scope-'));
  try {
    mkdirSync(join(directory, 'controller/scripts'), { recursive: true });
    writeFileSync(join(directory, 'controller/scripts/hosted-release-manifest.mjs'),
      'import {writeFileSync} from "node:fs"; if(process.argv[2]!=="--validate-dispatch-only")process.exit(9);writeFileSync(process.env.ADMISSION_MARKER,"called");\n');
    const cases = [
      { plan: { stage: 'qualification' }, allowed: true },
      { resume: { stage: 'qualification', executionMode: 'qualification' }, allowed: true },
      { plan: { stage: 'application' }, allowed: false },
      { plan: { stage: 'qualification', executionMode: 'release' }, allowed: false },
      { resume: { stage: 'qualification', executionMode: 'release' }, allowed: false },
      { resume: { stage: 'compatibility', executionMode: 'qualification' }, allowed: false },
      { plan: { stage: 'qualification' }, resume: { stage: 'qualification', executionMode: 'qualification' }, allowed: false },
      { allowed: false },
    ];
    for (const [index, scenario] of cases.entries()) {
      const marker = join(directory, `admission-${index}`);
      const result = spawnSync('/bin/bash', ['-c', script], { cwd: directory, encoding: 'utf8', env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, ADMISSION_MARKER: marker,
        FCOS_RELEASE_PLAN: scenario.plan ? JSON.stringify(scenario.plan) : '',
        FCOS_RESUME_MANIFEST: scenario.resume ? JSON.stringify(scenario.resume) : '',
      } });
      assert.equal(result.status === 0, scenario.allowed, result.stderr);
      assert.equal(existsSync(marker), scenario.allowed);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

test('release credential reads and deployment execute only behind the protected human approval environment', () => {
  const workflow=load(readFileSync(new URL('../.github/workflows/production-release.yml',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
  assert.equal(workflow.concurrency['cancel-in-progress'],false);
  assert.deepEqual(Object.keys(workflow.jobs),['production']);
  const job=workflow.jobs.production;
  assert.equal(job.environment,'fcos-production-release');
  assert.match(job.if,/github\.event\.repository\.default_branch/);
  assert.match(job.if,/FCOS_PRODUCTION_RELEASE_ENABLED == 'true'/);
  const preflight=job.steps.findIndex(step=>step.run?.endsWith('--preflight'));
  const execute=job.steps.findIndex(step=>step.run?.endsWith('--execute'));
  assert.ok(preflight>=0 && execute>preflight);
  assert.equal(job.steps[preflight].env.GH_TOKEN,'${{ secrets.FCOS_RELEASE_GH_TOKEN }}');
  assert.equal(job.steps[execute].env.GH_TOKEN,'${{ secrets.FCOS_RELEASE_GH_TOKEN }}');
  assert.equal(job.steps[preflight].env.VERCEL_TOKEN,undefined);
  assert.equal(job.permissions['id-token'],'write');
  for(const step of job.steps.filter(step=>step.uses?.startsWith('actions/checkout@'))) {
    assert.equal(step.with['persist-credentials'],false);
  }
});

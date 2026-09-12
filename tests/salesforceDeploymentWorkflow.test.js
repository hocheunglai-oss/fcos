import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acceptRefreshedMirrorWorkflow,
  assertFrozenSource,
  assertJobReport,
  parseDeploymentArguments,
  selectedMirrorProof,
} from '../scripts/deploy-salesforce-environments.mjs';
import {
  COMPLETE_SALESFORCE_SCOPE,
  FULL_SALESFORCE_TEST_LEVEL,
  SALESFORCE_RELEASE_MODE,
  archiveWorkflowStateFile,
  createSalesforceWorkflowState,
  deploymentResumeDisposition,
  deveeSourceProof,
  refreshDeveeSourceVerification,
  updateSalesforceEnvironmentState,
  validateDeveeSourceState,
  validationResumeDisposition,
  workflowMatchesFrozenSource,
} from '../scripts/salesforce-workflow-state.mjs';

const sourceHash = 'a'.repeat(64);
const frozen = { sourceTreeHash: sourceHash, releaseMode: SALESFORCE_RELEASE_MODE };

test('hotfix promotion defaults to the schema-free complete source and rejects schema stages', () => {
  const complete = parseDeploymentArguments([], {});
  assert.equal(complete.completeOwnedTree, true);
  assert.equal(complete.releaseMode, SALESFORCE_RELEASE_MODE);
  assert.equal(complete.waitMinutes, '60');
  assert.equal(complete.schemaBootstrap, undefined);
  assert.throws(() => parseDeploymentArguments(['--schema-cutover'], {}), /schema-free/);
  assert.throws(() => parseDeploymentArguments(['--schema-bootstrap', 'manifest/schema.xml'], {}), /schema-free/);
  assert.throws(() => parseDeploymentArguments([], { FCOS_SALESFORCE_SCHEMA_BOOTSTRAP: 'manifest/schema.xml' }), /schema-free/);
  assert.throws(() => parseDeploymentArguments(['--manifest', 'manifest/focused.xml'], {}), /validation-only/);
  const partial = parseDeploymentArguments(['--check-only', '--manifest', 'manifest/focused.xml'], {});
  assert.equal(partial.completeOwnedTree, false);
  assert.equal(partial.checkOnly, true);
  assert.equal(parseDeploymentArguments(['--stop-after', 'devee-validation'], {}).stopAfter, 'devee-validation');
  assert.throws(() => parseDeploymentArguments(['--stop-after', 'devee-bootstrap'], {}), /Unknown stop stage/);
});

test('workflow freezes the complete Salesforce tree without bootstrap or permission evidence', () => {
  const state = createSalesforceWorkflowState({ ...frozen, now: new Date('2026-09-11T00:00:00.000Z') });
  assert.equal(state.sourceScope, COMPLETE_SALESFORCE_SCOPE);
  assert.equal(state.releaseMode, SALESFORCE_RELEASE_MODE);
  assert.equal('bootstrapManifestHash' in state, false);
  assert.equal('bootstrap' in state.environments.devee, false);
  assert.equal('dataPermission' in state.environments.devee, false);
  assert.equal(workflowMatchesFrozenSource(state, frozen), true);
  assert.equal(workflowMatchesFrozenSource(state, { ...frozen, sourceTreeHash: 'c'.repeat(64) }), false);
  assert.equal(assertFrozenSource(frozen, sourceHash), true);
  assert.throws(() => assertFrozenSource(frozen, 'c'.repeat(64)), /Restart the promotion from DEVEE/);
});

test('replaced workflow bytes are archived before a new source chain starts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fcos-sf-state-'));
  const target = path.join(directory, 'workflow.json');
  const bytes = '{"schemaVersion":1,"oldProof":"preserved"}\n';
  await writeFile(target, bytes, { mode: 0o600 });
  try {
    const archived = archiveWorkflowStateFile(target, new Date('2026-09-11T01:02:03.000Z'));
    assert.equal(await readFile(archived, 'utf8'), bytes);
    await assert.rejects(access(target));
    assert.match(archived, /salesforce-workflow-history/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('validation and deployment resume exact jobs and reject drift or failed jobs', () => {
  const validation = {
    jobId: '0Af000000000001AAA', sourceTreeHash: sourceHash, releaseMode: SALESFORCE_RELEASE_MODE,
    deploymentScope: COMPLETE_SALESFORCE_SCOPE, testLevel: FULL_SALESFORCE_TEST_LEVEL, checkOnly: true,
  };
  const deployment = { ...validation, jobId: '0Af000000000002AAA', checkOnly: false };
  assert.equal(validationResumeDisposition(null, frozen), 'submit');
  assert.equal(validationResumeDisposition({ ...validation, status: 'InProgress' }, frozen), 'resume');
  assert.equal(validationResumeDisposition({ ...validation, status: 'Succeeded' }, frozen), 'reuse');
  assert.equal(deploymentResumeDisposition(null, frozen), 'submit');
  assert.equal(deploymentResumeDisposition({ ...deployment, status: 'Submitted' }, frozen), 'resume');
  assert.equal(deploymentResumeDisposition({ ...deployment, status: 'Succeeded' }, frozen), 'reuse');
  assert.throws(() => validationResumeDisposition({ ...validation, status: 'Failed' }, frozen), /change the source/);
  assert.throws(() => deploymentResumeDisposition({ ...deployment, status: 'Failed' }, frozen), /inspect it/);
  assert.throws(() => validationResumeDisposition({ ...validation, status: 'Succeeded', sourceTreeHash: 'c'.repeat(64) }, frozen), /not bound/);
});

test('successful validation proof requires the exact target job and every local test', () => {
  const environment = { label: 'DEVEE' };
  const result = { id: '0Af000000000001AAA', status: 'Succeeded', checkOnly: true, numberTestsTotal: 528, numberTestsCompleted: 528 };
  assert.equal(assertJobReport(result, { checkOnly: true, environment, jobId: result.id }), undefined);
  assert.throws(() => assertJobReport({ ...result, numberTestsCompleted: 527 }, { checkOnly: true, environment, jobId: result.id }), /complete RunLocalTests/);
  assert.throws(() => assertJobReport({ ...result, checkOnly: false }, { checkOnly: true, environment, jobId: result.id }), /expected successful validation/);
});

function completedWorkflow(now = new Date('2026-09-11T01:00:00.000Z')) {
  let state = createSalesforceWorkflowState({ ...frozen, now });
  state = updateSalesforceEnvironmentState(state, 'devee', {
    validation: {
      jobId: '0Af000000000004AAA', status: 'Succeeded', checkOnly: true,
      testLevel: FULL_SALESFORCE_TEST_LEVEL, deploymentScope: COMPLETE_SALESFORCE_SCOPE,
      sourceTreeHash: sourceHash, releaseMode: SALESFORCE_RELEASE_MODE,
    },
    deployment: {
      jobId: '0Af000000000005AAA', validationJobId: '0Af000000000004AAA',
      status: 'Succeeded', checkOnly: false, testLevel: FULL_SALESFORCE_TEST_LEVEL,
      deploymentScope: COMPLETE_SALESFORCE_SCOPE, sourceTreeHash: sourceHash,
      releaseMode: SALESFORCE_RELEASE_MODE, completedAt: '2026-09-11T00:45:00.000Z',
      verifiedAt: '2026-09-11T00:45:00.000Z',
    },
  }, now);
  return state;
}

test('DEVEE proof requires exact schema-free validation and deployment bindings', () => {
  const now = new Date('2026-09-11T01:00:00.000Z');
  const state = completedWorkflow(now);
  const proof = deveeSourceProof(state, now);
  assert.equal(validateDeveeSourceState(proof, sourceHash, now), true);
  assert.equal(proof.releaseMode, SALESFORCE_RELEASE_MODE);
  assert.equal('bootstrapJobId' in proof, false);
  assert.throws(() => validateDeveeSourceState({ ...proof, validationStatus: 'Failed' }, sourceHash, now), /schema-free complete-source/);
  assert.throws(() => validateDeveeSourceState({ ...proof, deploymentSourceTreeHash: 'c'.repeat(64) }, sourceHash, now), /schema-free complete-source/);
  assert.throws(() => validateDeveeSourceState({ ...proof, deploymentValidationJobId: 'different' }, sourceHash, now), /schema-free complete-source/);
});

test('live refresh preserves job identity and deployment time and changes only verification time', () => {
  const state = completedWorkflow();
  const refreshedAt = new Date('2026-09-11T02:00:00.000Z');
  const refreshed = refreshDeveeSourceVerification(state, {
    sourceTreeHash: sourceHash, validationJobId: '0Af000000000004AAA', deploymentJobId: '0Af000000000005AAA',
    liveIdentity: {
      alias: 'fcos-devee', orgId: '00D1m0000008kioEAA', username: 'vincent@cosulich.com.hk.devee',
      connectedStatus: 'Connected', organizationId: '00D1m0000008kioEAA', isSandbox: true,
    },
    liveDeployment: { id: '0Af000000000005AAA', status: 'Succeeded', checkOnly: false },
  }, refreshedAt);
  assert.equal(refreshed.environments.devee.deployment.completedAt, '2026-09-11T00:45:00.000Z');
  assert.equal(refreshed.environments.devee.deployment.verifiedAt, refreshedAt.toISOString());
  assert.equal(refreshed.environments.devee.deployment.jobId, '0Af000000000005AAA');
  assert.throws(() => refreshDeveeSourceVerification(state, {
    sourceTreeHash: sourceHash, validationJobId: 'drift', deploymentJobId: '0Af000000000005AAA',
    liveIdentity: {}, liveDeployment: {},
  }, refreshedAt), /cannot refresh/);
});

test('shared proof requires the configured repository and exact open draft head', () => {
  const commit = 'd'.repeat(40);
  const valid = {
    releaseMode: SALESFORCE_RELEASE_MODE, sourceTreeHash: sourceHash,
    sourceEnvironment: 'devee', sourceDeploymentJobId: '0Af000000000005AAA',
    repository: 'ivanyk20/fcbhk', account: 'vincelessxai', branch: 'fcos-salesforce-sync-test', commit,
    pullRequest: { number: 12, url: 'https://github.com/ivanyk20/fcbhk/pull/12', state: 'OPEN', isDraft: true, baseRefName: 'main', headRefName: 'fcos-salesforce-sync-test', headRefOid: commit },
  };
  assert.equal(selectedMirrorProof(valid, frozen).commit, commit);
  assert.throws(() => selectedMirrorProof({ ...valid, repository: 'wrong/repository' }, frozen), /open draft PR/);
  assert.throws(() => selectedMirrorProof({ ...valid, releaseMode: 'schema-cutover' }, frozen), /open draft PR/);
  assert.throws(() => selectedMirrorProof({ ...valid, pullRequest: { ...valid.pullRequest, state: 'MERGED' } }, frozen), /open draft PR/);
  const state = completedWorkflow();
  assert.equal(acceptRefreshedMirrorWorkflow(state, frozen, { sourceDeploymentJobId: '0Af000000000005AAA' }), state);
  assert.throws(() => acceptRefreshedMirrorWorkflow(state, frozen, { sourceDeploymentJobId: 'different' }), /refreshed mirror proof/);
});

test('the shared draft is reverified after QAT before Production starts', async () => {
  const source = await readFile(new URL('../scripts/deploy-salesforce-environments.mjs', import.meta.url), 'utf8');
  assert.match(source, /ensureDeployment\(qat\);[\s\S]*ensurePublication\(\);[\s\S]*ensureValidation\(production\);/u);
});

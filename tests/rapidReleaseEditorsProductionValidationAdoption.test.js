import assert from 'node:assert/strict';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { assertEditorsAdoptionApproval, assertEditorsProductionValidationSuccessor, recoverEditorsProductionValidation
} from '../scripts/lib/rapid-release/editors-production-validation-adoption.mjs';
import { createLocalMirrorReceipt, LOCAL_MIRROR_ENVIRONMENT } from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const fingerprint = '1'.repeat(64);
const sourceTreeHash = '2'.repeat(64);
const packageSha256 = '3'.repeat(64);
const caseSetDigest = '4'.repeat(64);
const manifestSha256 = '5'.repeat(64);
const sourceSha = 'a'.repeat(40);
const mirrorCommit = 'b'.repeat(40);
const component = { success: true, componentType: 'ApexClass', fullName: 'Editors' };
const deployedComponents = { componentSuccesses: [component] };
const closureId = 190;
const submittedAt = '2026-11-20T00:00:00.000Z';
const completedAt = '2026-11-20T00:05:00.000Z';
const closureAt = '2026-11-20T01:00:00.000Z';
const now = () => new Date('2026-11-20T02:00:00.000Z');
const jobs = {
  'devee:validation': '0AfHF000007J8nR0AS', 'devee:deployment': '0AfHF000007J8qf0AC',
  'qat:validation': '0AfBh000006lkaDKAQ', 'qat:deployment': '0AfBh000006lkbpKAA',
  'production:validation': '0Affu000001BAhpCAG',
};
const makeManifest = (successor, overrides = {}) => {
  const plan = { salesforceFingerprint: fingerprint, salesforceSourceTreeHash: sourceTreeHash, backwardCompatible: true,
    mirrorPublication: 'local-collaborator', editorPreflightReceiptId: 250, editorPreflightReceiptDigest: packageSha256,
    deveeDesktopCaseSetDigest: caseSetDigest, ...(successor ? { editorsProductionValidationAdoptionReceiptId: closureId } : {}),
    ...overrides.plan };
  return createManifest({ candidate: { sha: sourceSha, sourceDigest: sourceTreeHash, lockDigest: packageSha256, ...overrides.candidate },
    controllerSha: (successor ? 'c' : 'd').repeat(40), releaseId: successor ? 'editors-successor' : 'editors-predecessor',
    previous: { deploymentId: 'dpl_baseline', sha: 'e'.repeat(40), configurationDigest: caseSetDigest, schemaDigest: manifestSha256 },
    paths: ['force-app/main/default/classes/Editors.cls'],
    publicEnvironment: { VITE_SUPABASE_URL: `https://${targets().supabaseProject}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(25)}` },
    prerequisites: { adapter: 'salesforce-reviewed-manifest', adapterDigest: successor ? fingerprint : packageSha256, plan },
    now: successor ? '2026-11-20T01:10:00.000Z' : submittedAt });
};

function fixture() {
  const manifest = makeManifest(false);
  const successor = makeManifest(true);
  const staged = { id: 'dpl_original' };
  const receipt = { id: closureId, created_at: closureAt,
    payload: { manifestHash: digest(manifest), data: { originalRunId: 100, continuationRunId: 101, closureRunId: 102 } } };
  const approval = { manifestHash: digest(successor), nativeReviewVerified: true, runId: 103,
    deploymentId: 'dpl_successor', approvedAt: now().toISOString() };
  const checkpoint = (stage, operation, details, id) => ({ id, payload: { data: {
    stage, operation, fingerprint, outcome: 'resolved', evidenceDigest: manifestSha256, ...details,
  } } });
  const checkpoints = Object.fromEntries(Object.entries(jobs).map(([key, id], index) => {
    const [stage, operation] = key.split(':');
    const job = { id, validationId: operation === 'deployment' ? jobs[`${stage}:validation`] : null,
      submittedAt, ...(operation === 'validation' ? { packageSha256 } : {}) };
    return [key, checkpoint(stage, operation, { job }, 200 + index)];
  }));
  checkpoints['shared_mirror:publication'] = checkpoint('shared_mirror', 'publication', { mirror: { commit: mirrorCommit, pullRequest: 9 } }, 205);
  const reviewed = { fingerprint, binding: { sourceTreeHash, testPlan: { level: 'RunLocalTests', tests: [], minimumTests: 1 }, permissionSets: [] },
    review: { nativeDeveeDesktop: { caseSetDigest } }, manifest: ['ApexClass:Editors'],
    nativeInventories: { devee: { final: {} }, qat: { final: {} }, production: { baseline: {} } } };
  const request = { id: 201, creator: { id: 41898282 }, environment: LOCAL_MIRROR_ENVIRONMENT, sha: sourceSha,
    created_at: '2026-11-20T00:30:00.000Z', payload: { kind: 'fcos_local_mirror_request', repository: policy.publication.repository,
      repositoryId: policy.publication.repositoryId, candidateSha: sourceSha, fingerprint, sourceTreeHash,
      deploymentJobId: jobs['devee:deployment'], expiresAt: '2026-11-20T00:31:00.000Z' } };
  const report = { releaseMode: 'reviewed-manifest-incremental-v1', sourceTreeHash, sourceEnvironment: 'devee',
    sourceDeploymentJobId: jobs['devee:deployment'], repository: policy.publication.repository, account: policy.publication.requiredAccount,
    branch: 'draft-editors', commit: mirrorCommit,
    pullRequest: { number: 9, state: 'OPEN', isDraft: true, baseRefName: policy.publication.defaultBranch,
      headRefName: 'draft-editors', headRefOid: mirrorCommit } };
  const mirrorReceipt = { id: 213, creator: { id: policy.publication.requiredAccountId }, environment: LOCAL_MIRROR_ENVIRONMENT,
    sha: sourceSha, created_at: '2026-11-20T00:30:30.000Z', payload: createLocalMirrorReceipt({ request: request.payload,
      requestId: request.id, reviewed, report }) };
  const calls = [];
  const provider = {
    async verifyIdentity({ key }) { calls.push(`identity:${key}`); },
    async prepareValidation({ key }) { calls.push(`package:${key}`); return { packageSha256,
      cleanup: () => calls.push(`cleanup:${key}`), submit: () => assert.fail('adoption must only read') }; },
    async report({ key }, id) {
      calls.push(`report:${key}:${id}`);
      const checkOnly = jobs[`${key}:validation`] === id;
      const count = checkOnly ? 595 : 0;
      return { id, checkOnly, status: 'Succeeded', success: true, done: true, rollbackOnError: true,
        completedDate: completedAt, details: deployedComponents, numberComponentsDeployed: 1, numberComponentsTotal: 1,
        numberTestsTotal: count, numberTestsCompleted: count };
    },
  };
  return { successor, approval, recovery: { manifest, receipt, staged, checkpoints, mirror: { request, receipt: mirrorReceipt } },
    reviewed, provider, saved: [], now, calls };
}

test('Editors adoption accepts only the exact protected closure, unchanged source, and fresh successor approval', () => {
  const { successor, approval, recovery } = fixture();
  assert.equal(assertEditorsProductionValidationSuccessor(successor, recovery), recovery);
  assert.doesNotThrow(() => assertEditorsAdoptionApproval({ recovery, approval, manifest: successor }));
  for (const plan of [{ editorsProductionValidationAdoptionReceiptId: 299 }, { editorPreflightReceiptId: 301 },
    { salesforceSourceTreeHash: manifestSha256 }]) {
    assert.throws(() => assertEditorsProductionValidationSuccessor(makeManifest(true, { plan }), recovery), /SUCCESSOR_CHANGED/);
  }
  assert.throws(() => assertEditorsProductionValidationSuccessor(makeManifest(true, { candidate: { sha: mirrorCommit } }), recovery), /SUCCESSOR_CHANGED/);
  for (const patch of [{ runId: 101 }, { deploymentId: recovery.staged.id }, { approvedAt: closureAt }, { nativeReviewVerified: false }]) {
    assert.throws(() => assertEditorsAdoptionApproval({ recovery, approval: { ...approval, ...patch }, manifest: successor }), /FRESH_APPROVAL_REQUIRED/);
  }
});

test('Editors adoption re-attests each original package and job, retaining the first mirror head and actual timestamps', async () => {
  const input = fixture();
  const records = await recoverEditorsProductionValidation(input);
  assert.deepEqual(records.map(({ stage, operation }) => `${stage}:${operation}`), [
    'devee:validation', 'devee:deployment', 'shared_mirror:publication', 'qat:validation', 'qat:deployment', 'production:validation',
  ]);
  assert.deepEqual(records.flatMap(({ record }) => record.jobId ? [record.jobId] : []), Object.values(jobs));
  assert.equal(records[2].record.result.commit, mirrorCommit);
  assert.equal(records.at(-1).record.submittedAt, submittedAt);
  assert.equal(records.at(-1).record.completedAt, completedAt);
  assert.equal(records.at(-1).record.tests, '595/595');
  assert.equal(input.calls.filter(call => call.startsWith('report:')).length, 5);
  assert.equal(input.calls.filter(call => call.startsWith('cleanup:')).length, 3);
});

test('Editors adoption fails closed on unrelated successor operations, changed report/package, mirror drift, or expired original validation', async () => {
  const input = fixture();
  const original = input.recovery.checkpoints['qat:deployment'].payload.data;
  input.saved.push({ ...original, job: { ...original.job, id: jobs['devee:deployment'] } });
  await assert.rejects(() => recoverEditorsProductionValidation(input), /SUCCESSOR_CHECKPOINT_CHANGED/);
  assert.deepEqual(input.calls, []);

  const changedMirror = fixture();
  changedMirror.recovery.checkpoints['shared_mirror:publication'].payload.data.mirror.commit = sourceSha;
  await assert.rejects(() => recoverEditorsProductionValidation(changedMirror), /MIRROR_CHANGED/);
  const changedPackage = fixture();
  changedPackage.recovery.checkpoints['production:validation'].payload.data.job.packageSha256 = manifestSha256;
  await assert.rejects(() => recoverEditorsProductionValidation(changedPackage), /PACKAGE_CHANGED/);
  assert.equal(changedPackage.calls.at(-1), 'cleanup:production');
  const changedReport = fixture();
  const report = changedReport.provider.report;
  changedReport.provider.report = async (...args) => ({ ...await report(...args), status: 'Failed' });
  await assert.rejects(() => recoverEditorsProductionValidation(changedReport), /not a successful all-or-none proof/);

  const expired = fixture();
  expired.now = () => new Date('2026-12-01T00:00:00.000Z');
  await assert.rejects(() => recoverEditorsProductionValidation(expired), /VALIDATION_EXPIRED/);
  expired.saved.push({ stage: 'production', operation: 'deployment', outcome: 'pending', fingerprint, evidenceDigest: manifestSha256,
    job: { id: '0Affu000001BAhuCAG', validationId: jobs['production:validation'], submittedAt: closureAt } });
  assert.equal((await recoverEditorsProductionValidation(expired)).at(-1).record.jobId, jobs['production:validation']);
});

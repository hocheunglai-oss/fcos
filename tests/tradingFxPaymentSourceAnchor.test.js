import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { createLocalMirrorReceipt, createLocalMirrorRequest, LOCAL_MIRROR_ENVIRONMENT } from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';
import { TRADING_FX_FINAL_POSTEFFECT_ORIGINAL } from '../scripts/lib/rapid-release/trading-fx-final-posteffect-checkpoint.mjs';
import { paymentSalesSupportRepairPackage } from '../scripts/lib/rapid-release/trading-fx-payment-profile-repair.mjs';
import { verifyTradingFxSourceAnchorJournal, verifyTradingFxSourceAnchorRun } from '../scripts/verify-trading-fx-payment-source-anchor.mjs';

const owner = { id: FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce').publication.requiredAccountId, login: targets().account };
const bot = { id: 41898282, login: 'github-actions[bot]' };
const sha = letter => letter.repeat(40);
const hash = letter => letter.repeat(64);
const base = Date.parse('2026-02-01T00:00:00.000Z');
const iso = offset => new Date(base + offset).toISOString();
const order = 'devee-mirror-qat-production';
const steps = ['devee', 'shared_mirror', 'qat', 'production'];
const environment = { id: 23178773471, name: 'fcos-production-release', can_admins_bypass: false,
  protection_rules: [{ type: 'required_reviewers', reviewers: [{ reviewer: owner }] }] };

function fixture() {
  const expected = { sourceCommit: sha('f'), sourceTreeHash: hash('2'), application: sha('a'), releaseId: 'payment-anchor-fixture',
    runId: 42, deploymentId: 'dpl_promoted', artifactDigest: hash('4'), controllerSha: sha('c'), dispatcherSha: sha('d'),
    correctionFingerprint: hash('5'), closureId: 51 };
  const manifest = createManifest({ candidate: { sha: expected.application, sourceDigest: hash('6'), lockDigest: hash('7') },
    controllerSha: expected.controllerSha, releaseId: expected.releaseId, now: iso(-10_000),
    paths: ['force-app/main/default/classes/FcosTradeCurrencyService.cls', 'supabase/migrations/20000101000000_fix.sql'],
    previous: { sha: sha('b'), deploymentId: 'dpl_previous', schemaDigest: hash('8'), configurationDigest: hash('9') },
    publicEnvironment: { VITE_SUPABASE_URL: 'https://' + targets().supabaseProject + '.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'p'.repeat(24) },
    prerequisites: { adapter: 'trading-fx-prerequisites', adapterDigest: hash('a'),
      plan: { deferSchemaDependentSmoke: true, deferredModules: ['buyer_invoices'], bootstrapFingerprint: hash('b'),
        xeroQualificationDeploymentId: 11, xeroQualificationDigest: hash('c'), salesforceSourceTreeHash: hash('d'),
        paymentRepair: { sourceCommit: expected.sourceCommit, sourceTreeHash: expected.sourceTreeHash,
          correctionFingerprint: expected.correctionFingerprint } } } });
  expected.manifestHash = digest(manifest);
  expected.buildId = manifest.build.buildId;
  const runs = { id: expected.runId, run_attempt: 1, actor: owner, triggering_actor: owner, head_sha: expected.dispatcherSha, head_branch: 'main',
    repository: { id: 1278654816, full_name: targets().repository }, path: '.github/workflows/fcos-rapid-release.yml',
    event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: iso(-9000),
    display_title: `FCOS rapid resume ${expected.manifestHash} ${expected.application}` };
  const goLive = { name: 'go-live', run_id: expected.runId, run_attempt: 1, status: 'completed', conclusion: 'success',
    started_at: iso(-2000), completed_at: iso(30_000) };
  const approval = { manifestHash: expected.manifestHash, candidateSha: expected.application, buildId: expected.buildId,
    deploymentId: expected.deploymentId, previousDeploymentId: manifest.previous.deploymentId, environment: environment.name, reviewer: owner.login,
    nativeReviewVerified: true, runId: expected.runId, approvedAt: runs.created_at };
  const records = [];
  const add = (event, data) => {
    const payload = { event, data, sequence: records.length, recordHash: digest({ event, data, sequence: records.length }) };
    const row = { id: records.length + 1, creator: bot, environment: 'fcos-release-journal-v1', task: 'fcos-release-journal',
      ref: expected.application, sha: expected.application, created_at: iso(records.length * 1000), payload };
    records.push(row);
    return row;
  };
  const staged = { id: expected.deploymentId, buildId: expected.buildId, sha: expected.application, artifactDigest: expected.artifactDigest };
  add('release.prepared', { manifest });
  add('build.passed', { schemaVersion: 1, buildId: expected.buildId, candidateSha: expected.application, controllerSha: expected.controllerSha,
    sourceDigest: manifest.candidate.sourceDigest, lockDigest: manifest.candidate.lockDigest, artifactDigest: expected.artifactDigest,
    qualityPassed: true, performancePassed: true, node: manifest.build.node });
  add('stage.result', { outcome: 'applied', result: staged });
  const smoke = { passed: true, deploymentId: expected.deploymentId, buildId: expected.buildId, normalRole: true, businessWrites: 0,
    tradingFx: { restrictedVerified: true, normalVerified: true, desktopVerified: true } };
  add('stage.pre_bootstrap_passed', { ...smoke, mode: 'pre_bootstrap', manifestHash: expected.manifestHash, isolationVerified: true,
    deferredChecks: ['buyer_invoices'], completedModules: manifest.selection.modules.filter(name => name !== 'buyer_invoices'),
    bootstrapFingerprint: manifest.prerequisites.plan.bootstrapFingerprint,
    completedChecks: ['runtime_identity', 'authenticated_login', 'authentication_denials', 'request_isolation'] });
  add('approval.accepted', approval);
  const prerequisite = { planDigest: digest(manifest.prerequisites), candidateSha: expected.application };
  add('prerequisites.intent', { operationId: manifest.releaseId + '-prerequisites', request: prerequisite, requestHash: digest(prerequisite) });
  const { profileDigest, manifestDigest } = paymentSalesSupportRepairPackage();
  const pending = { stage: 'shared_mirror', operation: 'publication', outcome: 'pending', fingerprint: expected.correctionFingerprint, evidenceDigest: hash('e') };
  const commit = sha('7'), branch = 'codex/shared-verified';
  const corrected = steps.map((stage, index) => {
    const row = { stage, operation: stage === 'shared_mirror' ? 'publication' : 'sales-support-correction', outcome: 'resolved',
      fingerprint: expected.correctionFingerprint, evidenceDigest: digest(stage) };
    if (stage === 'shared_mirror') {
      add('salesforce.checkpoint', pending);
      row.mirror = { pullRequest: 9, commit };
    } else {
      row.job = { id: '0Af' + String(index + 1).padStart(15, '0'), validationId: null,
        submittedAt: iso(records.length * 1000 - 100), packageSha256: digest({ profileDigest, manifestDigest }) };
    }
    return add('salesforce.checkpoint', row);
  });
  const retained = { operationId: 'salesforce:devee:deployment', evidenceDigest: hash('1'), verified: true, intentRecorded: true };
  const databaseOperation = { operationId: 'previous-database', evidenceDigest: hash('2'), verified: true, intentRecorded: true };
  const applied = { passed: true, manifestHash: expected.manifestHash, backwardCompatible: true,
    salesforce: { order, mirrorVerified: true, sourceTreeHash: manifest.prerequisites.plan.salesforceSourceTreeHash,
      correction: { fingerprint: expected.correctionFingerprint, sourceTreeHash: expected.sourceTreeHash, order } },
    completedOperations: [databaseOperation, retained, ...steps.map((stage, index) => ({
      operationId: `salesforce:${stage}:sales-support-correction`, evidenceDigest: corrected[index].payload.data.evidenceDigest,
      verified: true, intentRecorded: true,
    }))] };
  add('prerequisites.result', { outcome: 'applied', result: applied, operationId: manifest.releaseId + '-prerequisites' });
  const prerequisites = add('prerequisites.passed', applied);
  const signingRateDigest = hash('3');
  add('prerequisites.smoke_passed', { ...smoke, login: true, restrictedAccess: true, modules: manifest.selection.modules,
    prerequisiteDigest: digest(applied), signingRateDigest });
  const promote = { deploymentId: staged.id, previousDeploymentId: manifest.previous.deploymentId, buildId: expected.buildId };
  add('promote.intent', { operationId: manifest.releaseId + '-promote', request: promote, requestHash: digest(promote) });
  add('promote.result', { outcome: 'applied', result: staged, operationId: manifest.releaseId + '-promote' });
  add('live.passed', { ...smoke, observationMs: 301000, signing: { verified: true, deploymentId: staged.id, buildId: expected.buildId,
    orgId: fcosSalesforceEnvironment('production').orgId, businessWrites: 0, rateEnvelopeDigest: signingRateDigest } });
  add('release.complete', { deploymentId: staged.id });
  const historical = { closed: { closure: { id: expected.closureId }, result: { originalRunId: TRADING_FX_FINAL_POSTEFFECT_ORIGINAL.runId,
    state: 'trading_fx_final_package_applied_payment_grant_pending', completedOperations: [retained], evidence: { databaseOperation } } } };
  const [devee, publication, qat, production] = corrected;
  const reviewed = { fingerprint: expected.correctionFingerprint,
    binding: { orgIds: { devee: fcosSalesforceEnvironment('devee').orgId }, sourceTreeHash: expected.sourceTreeHash } };
  const mirrorReport = { releaseMode: 'reviewed-manifest-incremental-v1', sourceTreeHash: expected.sourceTreeHash, sourceEnvironment: 'devee',
    sourceDeploymentJobId: devee.payload.data.job.id, repository: 'ivanyk20/fcbhk', account: owner.login, branch, commit,
    pullRequest: { number: 9, state: 'OPEN', isDraft: true, baseRefName: 'main', headRefName: branch, headRefOid: commit } };
  const mirrorRecords = [];
  for (const [mode, lower] of [['publish', devee], ['check', qat], ['check', production]]) {
    const offset = Date.parse(lower.created_at) - base + 100;
    const requestId = mirrorRecords.length + 201;
    const request = createLocalMirrorRequest({ manifest, approval, reviewed, mode, runAttempt: 1, now: base + offset,
      expiresAt: iso(offset + 300000), intentHash: mode === 'publish' ? pending.evidenceDigest : publication.payload.data.evidenceDigest,
      deployment: { orgId: reviewed.binding.orgIds.devee, status: 'Succeeded', fingerprint: reviewed.fingerprint,
        jobId: devee.payload.data.job.id, validationJobId: null } });
    const common = { environment: LOCAL_MIRROR_ENVIRONMENT, sha: expected.application };
    mirrorRecords.push({ ...common, id: requestId, creator: bot, created_at: iso(offset), payload: request },
      { ...common, id: requestId + 1, creator: owner, created_at: iso(offset + 100),
        payload: createLocalMirrorReceipt({ request, requestId, reviewed, report: mirrorReport }) });
  }
  const input = { records, mirrorRecords, manifest, historical, expected, run: runs, goLive };
  return { input, runInput: { run: runs, jobs: { jobs: [goLive] }, reviews: [
    { state: 'approved', user: owner, environments: [{ id: environment.id, name: environment.name }] },
  ], environment, expected }, corrected, prerequisites };
}

test('only the exact successful approved protected run and attempt qualify', () => {
  const { runInput } = fixture();
  assert.equal(verifyTradingFxSourceAnchorRun(runInput).run_id, runInput.expected.runId);
  for (const change of [{ conclusion: 'failure' }, { run_attempt: 2 }, { head_sha: sha('e') }, { actor: bot }]) {
    assert.throws(() => verifyTradingFxSourceAnchorRun({ ...runInput, run: { ...runInput.run, ...change } }), /NATIVE_RUN_MISMATCH/);
  }
  assert.throws(() => verifyTradingFxSourceAnchorRun({ ...runInput, reviews: [] }), /NATIVE_RUN_MISMATCH/);
});

test('anchor consumes ordered correction checkpoints and authentic publication and check receipts', () => {
  const { input, corrected } = fixture();
  const proof = verifyTradingFxSourceAnchorJournal(input);
  assert.equal(proof.job.id, corrected[0].payload.data.job.id);
  assert.equal(proof.mirror.pullRequest, 9);
  assert.deepEqual(proof.mirrorReceipts, [202, 204, 206]);
});

test('changed correction, missing mirror proof, wrong actor and unobserved deployment fail closed', () => {
  const changes = [
    [input => { input.records.find(row => row.payload.event === 'live.passed').payload.data.observationMs = 299999; }, /RELEASE_EVIDENCE_MISMATCH/],
    [input => { input.records.find(row => row.payload.event === 'release.complete').creator = owner; }, /JOURNAL_SCOPE_MISMATCH/],
    [input => { input.records.find(row => row.payload.event === 'promote.intent').payload.data.request.deploymentId = 'dpl_other'; }, /RELEASE_EVIDENCE_MISMATCH/],
    [input => { input.mirrorRecords.pop(); }, /MIRROR_RECEIPT_MISMATCH/],
    [input => { input.mirrorRecords[0].payload.intentHash = hash('a'); }, /MIRROR_REQUEST_MISMATCH/],
    [input => { input.records.find(row => row.payload.data.stage === 'qat').payload.data.job.packageSha256 = hash('a'); }, /CORRECTION_JOB_MISMATCH/],
    [input => { input.records.find(row => row.payload.data.stage === 'production').payload.data.stage = 'devee'; }, /CORRECTION_HISTORY_MISMATCH/],
  ];
  for (const [change, expected] of changes) {
    const { input } = fixture();
    change(input);
    assert.throws(() => verifyTradingFxSourceAnchorJournal(input), expected);
  }
});

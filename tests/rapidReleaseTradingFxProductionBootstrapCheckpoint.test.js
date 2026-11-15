import assert from 'node:assert/strict';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { LOCAL_MIRROR_ENVIRONMENT } from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';
import {
  buildTradingFxProductionBootstrapClosure, readTradingFxProductionBootstrapCheckpoint, readTradingFxProductionBootstrapClosure,
  TRADING_FX_PRODUCTION_BOOTSTRAP_PREIMAGE_DIGEST, verifyTradingFxProductionBootstrapCheckpoint, verifyTradingFxProductionBootstrapClosure,
} from '../scripts/lib/rapid-release/trading-fx-production-bootstrap-checkpoint.mjs';

const repository = targets().repository;
const salesforce = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const owner = { id: salesforce.publication.requiredAccountId, login: targets().account };
const bot = { id: 41898282, login: 'github-actions[bot]' };
const sha = 'b495d1bde6d06834c32212982c4597e20e6c7fe0';
const controllerSha = 'd7e269328d399967aaa09be51406c9b7cc4a43d6';
const fingerprint = 'c13101bbdc7796ec98e22b0b0848c25c03bbace805c33d4c139e7871645314c3';
const sourceTreeHash = 'd9b6781881a241020eac6e1dc51071037a2574ae6d742e5f5e440108e411f72c';
const bootstrapPackage = '20bbcfd77480512d71cfdbfdcfe24ab527163a86588b1c927cc98a8723174401';
const validationPackage = '748bf0f976017fbe0512d2a380c0743bbd865e20c15271e3a5abe5f05c243afd';
const stagedId = 'dpl_336J8sRxvjqBMtvdX9rsa11VTDfq';
const runId = 43623944312;
const runAttempt = 2;
const releaseId = 'trading-fx-signed-after-manual-43620608639';
const workflowPath = '.github/workflows/fcos-rapid-release.yml';
const artifactDigest = digest('verified build');
const time = offset => new Date(Date.UTC(2026, 10, 15, 7, 30) + offset * 1000).toISOString();
const orgId = stage => salesforce.environments.find(item => item.key === stage).orgId;

function fixture() {
  const plan = { salesforceFingerprint: fingerprint, salesforceSourceTreeHash: sourceTreeHash,
    mirrorPublication: 'local-collaborator', backwardCompatible: true, xeroQualificationDeploymentId: 1,
    xeroQualificationDigest: digest('demo proof'), deferSchemaDependentSmoke: true,
    deferredModules: ['buyer_invoices'], bootstrapFingerprint: digest('bootstrap') };
  const originalManifest = createManifest({ releaseId, controllerSha,
    candidate: { sha, sourceDigest: digest('source'), lockDigest: digest('lock') },
    previous: { deploymentId: 'dpl_previous', sha: '2'.repeat(40), configurationDigest: digest('configuration'), schemaDigest: digest('schema') },
    paths: ['force-app/main/default/classes/Example.cls', 'supabase/migrations/20990101000000_fixture.sql'],
    publicEnvironment: { VITE_SUPABASE_URL: `https://${targets().supabaseProject}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(25)}` },
    prerequisites: { adapter: 'trading-fx-prerequisites', adapterDigest: digest('adapter'), plan }, now: time(0) });
  const { candidate, previous, build, prerequisites, selection } = originalManifest;
  const manifestHash = digest(originalManifest);
  const records = [];
  const append = (event, data, id = records.length + 100) => {
    const content = { schemaVersion: 1, kind: 'fcos_rapid_release_event', manifestHash, releaseId, event, data,
      sequence: records.length, previousHash: records.at(-1)?.payload.recordHash ?? null };
    const record = { id, creator: bot, sha, environment: 'fcos-release-journal-v1', created_at: time(records.length + 20),
      payload: { ...content, recordHash: digest(content) } };
    records.push(record);
    return record;
  };
  const intent = (phase, request, id) => append(`${phase}.intent`, { operationId: `${releaseId}-${phase}`, requestHash: digest(request), request }, id);
  const checkpoint = (stage, operation, outcome, details = {}, id) =>
    append('salesforce.checkpoint', { stage, operation, outcome, fingerprint, evidenceDigest: digest([stage, operation, outcome, details]), ...details }, id);
  const job = (stage, operation, id, validationId, packageSha256, resolvedId) => {
    const submitted = { id, validationId, submittedAt: time(records.length + 20), ...(packageSha256 ? { packageSha256 } : {}) };
    checkpoint(stage, operation, 'pending', { job: { ...submitted, id: null } });
    checkpoint(stage, operation, 'pending', { job: submitted });
    checkpoint(stage, operation, 'resolved', { job: submitted }, resolvedId);
  };
  const permission = stage => {
    const name = 'Fcos_Trading_FX_Data';
    checkpoint(stage, `permission:${name}`, 'evidence');
    checkpoint(stage, `permission:${name}`, 'resolved', { permission: { name, orgId: orgId(stage), prestate: true } });
  };
  append('release.prepared', { manifest: originalManifest }, 7791612280);
  append('build.passed', { schemaVersion: 1, buildId: build.buildId, candidateSha: sha, sourceDigest: candidate.sourceDigest,
    lockDigest: candidate.lockDigest, artifactDigest, controllerSha, qualityPassed: true, performancePassed: true, node: build.node }, 7791612459);
  const stageOperation = `${releaseId}-stage`;
  intent('stage', { buildId: build.buildId, artifactDigest, candidateSha: sha, previousDeploymentId: previous.deploymentId, target: 'production', skipDomain: true }, 7791616629);
  append('stage.result', { operationId: stageOperation, outcome: 'applied', result: { id: stagedId, operationId: stageOperation,
    sha, manifestHash, buildId: build.buildId, artifactDigest, target: 'production' } }, 7791618227);
  append('stage.pre_bootstrap_passed', { passed: true, mode: 'pre_bootstrap', manifestHash, deploymentId: stagedId, buildId: build.buildId,
    isolationVerified: true, normalRole: true, businessWrites: 0, bootstrapFingerprint: plan.bootstrapFingerprint,
    deferredChecks: plan.deferredModules, completedModules: selection.modules.filter(module => !plan.deferredModules.includes(module)),
    completedChecks: ['runtime_identity', 'authenticated_login', 'authentication_denials', 'request_isolation'],
    tradingFx: { desktopVerified: true, normalVerified: true, restrictedVerified: true } }, 7791692066);
  const approvedAt = time(10), productionEnvironment = 'fcos-production-release';
  append('approval.accepted', { runId, approvedAt, manifestHash, candidateSha: sha, buildId: build.buildId, nativeReviewVerified: true,
    deploymentId: stagedId, previousDeploymentId: previous.deploymentId, environment: productionEnvironment, reviewer: owner.login }, 7800347765);
  intent('prerequisites', { planDigest: digest(prerequisites), candidateSha: sha }, 7800349222);
  append('obstacle.detected', {}, 7800353081);
  for (const stage of ['devee', 'qat', 'production']) checkpoint(stage, 'inventory-checkpoint', 'evidence');
  job('devee', 'bootstrap', '0AfHF000007Gz1u0AC', null, bootstrapPackage);
  permission('devee');
  const deveeValidation = '0AfHF000007GzDB0A0', deveeDeployment = '0AfHF000007GzJd0AK';
  job('devee', 'validation', deveeValidation, null, validationPackage);
  job('devee', 'deployment', deveeDeployment, deveeValidation);
  const branch = 'codex/fixture', commit = 'e'.repeat(40);
  const proof = { releaseMode: 'reviewed-manifest-incremental-v1', sourceTreeHash, sourceEnvironment: 'devee',
    sourceDeploymentJobId: deveeDeployment, repository: salesforce.publication.repository, account: owner.login, branch, commit,
    pullRequest: { number: 9, state: 'OPEN', isDraft: true, baseRefName: salesforce.publication.defaultBranch, headRefName: branch, headRefOid: commit } };
  const mirror = (mode, sequence, requestId, receiptId, binding) => {
    const envelope = { sha, environment: LOCAL_MIRROR_ENVIRONMENT, created_at: time(records.length + 19.5) };
    const request = { ...envelope, id: requestId, creator: bot, payload: { kind: 'fcos_local_mirror_request',
      manifestHash, controllerSha, candidateSha: sha, runId, runAttempt, fingerprint, sourceTreeHash, mode, sequence,
      repository: salesforce.publication.repository, repositoryId: salesforce.publication.repositoryId,
      deveeOrgId: orgId('devee'), deploymentJobId: deveeDeployment, validationJobId: deveeValidation,
      intentHash: binding.payload.data.evidenceDigest, expiresAt: time(180) } };
    const receipt = { ...envelope, id: receiptId, creator: owner, payload: { kind: 'fcos_local_mirror_receipt', requestId,
      requestHash: digest(request.payload), repositoryId: request.payload.repositoryId, proof: structuredClone(proof), proofDigest: digest(proof) } };
    const row = checkpoint('shared_mirror', 'publication', 'resolved', { mirror: { commit, pullRequest: 9 } });
    return { pair: { request, receipt }, row };
  };
  const publication = mirror('publish', 1, 7800593130, 7800615157, checkpoint('shared_mirror', 'publication', 'pending'));
  job('qat', 'bootstrap', '0AfBh000006jzIPKAY', null, bootstrapPackage);
  permission('qat');
  const qatValidation = '0AfBh000006jzK1KAI';
  job('qat', 'validation', qatValidation, null, validationPackage);
  job('qat', 'deployment', '0AfBh000006jyZGKAY', qatValidation);
  const check = mirror('check', 2, 7800733557, 7800752026, publication.row);
  checkpoint('production', 'preparation', 'evidence', { preparation: { status: 'awaiting-authorized-bootstrap' } });
  job('production', 'bootstrap', '0Affu000001AFzhCAG', null, bootstrapPackage, 7800775625);
  checkpoint('production', 'restoration-checkpoint', 'evidence', {}, 7800779913);

  const run = { id: runId, run_attempt: runAttempt, repository: { id: 1278654816, full_name: repository }, actor: owner, triggering_actor: owner,
    event: 'workflow_dispatch', path: workflowPath, display_title: `FCOS rapid release ${manifestHash} ${sha}`, status: 'completed', conclusion: 'failure',
    created_at: approvedAt };
  const jobs = { jobs: [['quality', 'success', 11, 21], ['stage-and-smoke', 'success', 21, 25], ['go-live', 'failure', 27, 61]]
    .map(([name, conclusion, start, end]) => ({ name, conclusion, status: 'completed', run_id: runId, run_attempt: runAttempt,
      started_at: time(start), completed_at: time(end) })) };
  const reviews = [{ state: 'approved', user: owner, environments: [{ id: 23178773471, name: productionEnvironment }] }];
  return { originalManifest, records, run, jobs, reviews, mirrorPublication: publication.pair, mirrorCheck: check.pair, append, checkpoint };
}

function rehash(records) {
  records.forEach((record, index) => {
    const { recordHash: _oldHash, ...content } = record.payload;
    content.previousHash = records[index - 1]?.payload.recordHash ?? null;
    record.payload = { ...content, recordHash: digest(content) };
  });
}

test('retains seven original operations and distinct publication and check receipts', () => {
  const f = fixture();
  const result = verifyTradingFxProductionBootstrapCheckpoint({ ...f, records: [...f.records].reverse() });
  assert.deepEqual(result.salesforceOperations.map(({ stage, operation }) => `${stage}:${operation}`), [
    'devee:bootstrap', 'devee:validation', 'devee:deployment', 'qat:bootstrap', 'qat:validation', 'qat:deployment', 'production:bootstrap',
  ]);
  assert.equal(result.salesforceOperations.at(-1).job.id, '0Affu000001AFzhCAG');
  assert.equal(result.mirror.publication.receipt.id, 7800615157);
  assert.equal(result.mirror.check.receipt.id, 7800752026);
  assert.equal(result.prerequisiteIntentId, 7800349222);
  assert.equal(result.lastRecordHash, f.records.at(-1).payload.recordHash);
});

test('requires the exact prior native run, staging artifact, read-only checks and historical reviewer', () => {
  const invalid = [
    [f => { f.run.run_attempt = 3; }, /NATIVE_APPROVAL_CHANGED/],
    [f => { f.reviews[0].environments[0].id++; }, /NATIVE_APPROVAL_CHANGED/],
    [f => { f.records[3].payload.data.result.artifactDigest = digest('different artifact'); rehash(f.records); }, /STAGE_CHANGED/],
    [f => { f.records[4].payload.data.businessWrites = 1; rehash(f.records); }, /PREBOOTSTRAP_STAGE_PROOF_REQUIRED/],
    [f => { f.jobs.jobs[2].conclusion = 'success'; }, /TERMINAL_RUN_REQUIRED/],
  ];
  for (const [change, expectedError] of invalid) {
    const f = fixture();
    change(f);
    assert.throws(() => verifyTradingFxProductionBootstrapCheckpoint(f), expectedError);
  }
});

test('rejects job substitution, mirror reordering, dangling work and untrusted journal rows', () => {
  const invalid = [
    [f => { f.records[38].payload.data.job.id = '0Affu000001AAAAAAA'; rehash(f.records); }, /JOB_CHANGED/],
    [f => { f.mirrorCheck.request.created_at = f.records[33].created_at; }, /MIRROR_CHANGED/],
    [f => { f.mirrorCheck.request.payload.intentHash = f.records[22].payload.data.evidenceDigest; }, /MIRROR_CHANGED/],
    [f => { f.records[40].payload.data = { ...f.records[40].payload.data, operation: 'validation', outcome: 'pending' }; rehash(f.records); }, /PREREQUISITE_CHANGED/],
    [f => { f.append('promote.intent', { operationId: 'unexpected' }); }, /JOURNAL_CHANGED/],
    [f => { f.records[39].creator = owner; }, /JOURNAL_CHANGED/],
  ];
  for (const [change, expectedError] of invalid) {
    const f = fixture();
    change(f);
    assert.throws(() => verifyTradingFxProductionBootstrapCheckpoint(f), expectedError);
  }
});

test('native reader refuses a reconstructed journal with a different original manifest hash and performs no writes', async () => {
  const f = fixture();
  const rows = [f.mirrorPublication.request, f.mirrorPublication.receipt, f.mirrorCheck.request, f.mirrorCheck.receipt];
  const base = `/repos/${repository}/actions/runs/${runId}`;
  const github = { pages: async () => f.records, read: async path => {
    if (path === base) return f.run;
    if (path === `${base}/approvals`) return f.reviews;
    if (path === `${base}/attempts/2/jobs?per_page=100`) return f.jobs;
    return rows.find(row => path === `/repos/${repository}/deployments/${row.id}`);
  }, write: () => assert.fail('Read-only verifier attempted a provider write') };
  await assert.rejects(readTradingFxProductionBootstrapCheckpoint({ github }), /MANIFEST_CHANGED/);
  await assert.rejects(readTradingFxProductionBootstrapClosure({ github, receiptId: 500 }), /MANIFEST_CHANGED/);
});

function closureFixture() {
  const f = fixture();
  const checkpoint = verifyTradingFxProductionBootstrapCheckpoint(f);
  const proposal = buildTradingFxProductionBootstrapClosure({
    checkpoint, productionPreimageEvidenceDigest: TRADING_FX_PRODUCTION_BOOTSTRAP_PREIMAGE_DIGEST,
  });
  const receipt = f.append('prerequisites.result', proposal.result, 500);
  Object.assign(receipt, { creator: owner, task: 'fcos-release-journal', ref: sha, created_at: time(63) });
  return { ...f, checkpoint, proposal, receipt, receiptId: receipt.id };
}

test('the closure requires reviewed five-path preimage evidence and records a terminal partial outcome', () => {
  const f = closureFixture();
  const { checkpoint, proposal: { result, expectedPreviousHash } } = f;
  assert.throws(() => buildTradingFxProductionBootstrapClosure({ checkpoint }), /PREIMAGE_REQUIRED/);
  assert.throws(() => buildTradingFxProductionBootstrapClosure({ checkpoint, productionPreimageEvidenceDigest: digest('unreviewed') }),
    /PREIMAGE_REQUIRED/);
  assert.equal(expectedPreviousHash, checkpoint.lastRecordHash);
  assert.equal(result.productionPreimageEvidenceDigest, TRADING_FX_PRODUCTION_BOOTSTRAP_PREIMAGE_DIGEST);
  assert.equal(result.bootstrapJob, '0Affu000001AFzhCAG');
  assert.match(result.outcome, /stopped_after_successful_production_bootstrap/);
  assert.equal(result.result, undefined);
  assert.equal(verifyTradingFxProductionBootstrapClosure({ ...f, records: [...f.records].reverse() }), f.receipt);
  assert.throws(() => verifyTradingFxProductionBootstrapCheckpoint(f), /JOURNAL_CHANGED/);
});

test('the closure refuses an untrusted, early, modified or nonterminal owner row', () => {
  const invalid = [
    f => { f.receipt.creator = bot; },
    f => { f.receipt.created_at = f.checkpoint.lastRecord.created_at; },
    f => { f.receipt.ref = 'main'; },
    f => { f.receipt.payload.data.productionPreimageEvidenceDigest = digest('different proof'); rehash(f.records); },
    f => { f.receipt.payload.data.outcome = 'applied'; rehash(f.records); },
    f => { f.records[39].payload.data.evidenceDigest = digest('replaced prefix evidence'); rehash(f.records); },
    f => { f.records[39].creator = owner; },
    f => { f.append('promote.intent', { operationId: 'unexpected' }); },
  ];
  for (const change of invalid) {
    const f = closureFixture();
    change(f);
    assert.throws(() => verifyTradingFxProductionBootstrapClosure(f), /CLOSURE_(?:CHECKPOINT_CHANGED|CHANGED|REQUIRED)/);
  }
});

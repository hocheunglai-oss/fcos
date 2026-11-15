import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { handoverDigest } from '../scripts/lib/rapid-release/handover.mjs';
import { LOCAL_MIRROR_ENVIRONMENT } from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';
import { DEVEE_DESKTOP_REQUEST_KIND, DEVEE_DESKTOP_WORKFLOW, editorDesktopCases,
  editorDesktopCaseSetDigest } from '../scripts/lib/rapid-release/salesforce-devee-desktop-checkpoint.mjs';
import { publishDeveeDesktopEvidence } from '../scripts/rapid-release-devee-desktop.mjs';

const base = '/repos/' + targets().repository;
const ownerId = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce').publication.requiredAccountId;
const owner = { id: ownerId, login: targets().account };
const bot = { id: 41898282, login: 'github-actions[bot]' };
const devee = fcosSalesforceEnvironment('devee');
const hash = digit => digit.repeat(64);
const sha = digit => digit.repeat(40);
const started = Date.parse('2025-11-01T12:00:00Z');
const at = elapsed => new Date(started + elapsed).toISOString();

function fixture(t, { lost = false, noAcknowledgement = false, priorRunId, currentApproval } = {}) {
  const local = mkdtempSync(join(tmpdir(), 'fcos-desktop-operator-'));
  t.after(() => rmSync(local, { recursive: true, force: true }));
  const intentDirectory = join(local, 'intent');
  const intentFile = join(intentDirectory, '1278654816-101.json');
  const repo = { id: 1278654816, owner, full_name: targets().repository, default_branch: 'main', permissions: { admin: true } };
  const reviewed = { review: { nativeDeveeDesktop: { caseSetDigest: editorDesktopCaseSetDigest }, nativeProjection: 'schema-free-apex-lightning' },
    manifest: ['ApexClass:FcosTradeCurrencyService', ...['fcbEditOfferLineItemModal', 'fcbEditSupplierBidModal', 'fcbPromotedOfferLineItemExtraCosts',
      'fcbSupplierBidExtraCosts', 'fcosTradeCurrencyEditor'].map(name => 'LightningComponentBundle:' + name)],
    binding: { sourceTreeHash: hash('1'), orgIds: { devee: devee.orgId } }, fingerprint: hash('2'),
    nativeInventories: { devee: { final: { inventoryHash: hash('3'), projectedNativeInventory: true } } } };
  const manifest = createManifest({ candidate: { sha: sha('b'), sourceDigest: hash('4'), lockDigest: hash('5') },
    releaseId: 'editors-desktop-fixture', controllerSha: sha('a'),
    previous: { sha: sha('d'), deploymentId: 'dpl_prev', configurationDigest: hash('4'), schemaDigest: hash('5') },
    paths: ['force-app/main/default/classes/FcosTradeCurrencyService.cls'],
    publicEnvironment: { VITE_SUPABASE_URL: 'https://' + targets().supabaseProject + '.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'p'.repeat(24) }, now: at(-60_000),
    prerequisites: { adapter: 'salesforce-reviewed-manifest', adapterDigest: hash('5'),
      plan: { mirrorPublication: 'local-collaborator', salesforceFingerprint: reviewed.fingerprint,
        salesforceSourceTreeHash: reviewed.binding.sourceTreeHash, deveeDesktopCaseSetDigest: editorDesktopCaseSetDigest } } });
  const runId = 42, runAttempt = 1;
  const run = { id: runId, run_attempt: runAttempt, repository: repo, actor: owner, status: 'in_progress',
    event: 'workflow_dispatch', head_branch: 'main', path: DEVEE_DESKTOP_WORKFLOW, head_sha: sha('e'), created_at: at(-30_000),
    display_title: `FCOS rapid ${priorRunId ? 'resume' : 'release'} ${digest(manifest)} ${manifest.candidate.sha}` };
  const currentRun = { ...run };
  const request = { kind: DEVEE_DESKTOP_REQUEST_KIND, caseSetDigest: editorDesktopCaseSetDigest, manifestHash: digest(manifest), releaseId: manifest.releaseId,
    repositoryId: repo.id, controllerSha: manifest.controllerSha, candidateSha: manifest.candidate.sha, workflowPath: DEVEE_DESKTOP_WORKFLOW,
    workflowBlobSha: sha('9'), dispatcherSha: run.head_sha, workflowActorId: bot.id, operatorId: owner.id, runId, runAttempt,
    orgId: devee.orgId, fingerprint: reviewed.fingerprint, deploymentJobId: '0Af000000000000002', validationJobId: '0Af000000000000001',
    sourceTreeHash: reviewed.binding.sourceTreeHash, inventoryHash: reviewed.nativeInventories.devee.final.inventoryHash,
    installedInventoryHash: hash('6'), inventoryReceiptDigest: hash('7'), expiresAt: at(300_000) };
  const requestDeployment = { id: 101, creator: bot, created_at: at(0), sha: request.candidateSha, environment: LOCAL_MIRROR_ENVIRONMENT, payload: request };
  const report = { orgId: request.orgId, isSandbox: true, deploymentJobId: request.deploymentJobId, validationJobId: request.validationJobId,
    sourceTreeHash: request.sourceTreeHash, installedInventoryHash: request.installedInventoryHash, caseSetDigest: request.caseSetDigest,
    startedAt: at(1000), verifiedAt: at(3000), cases: editorDesktopCases.map(id => ({ id, passed: true, evidenceDigest: digest(id) })),
    roles: ['normal', 'restricted'], businessWrites: 0, customerSends: 0, financialRequests: 0, approvedFixturesOnly: true,
    syntheticFixtureWrites: 2, fixturesRestored: true, evidenceDigest: hash('8') };
  const stage = { id: 'dpl_new', sha: request.candidateSha, manifestHash: request.manifestHash, buildId: manifest.build.buildId, artifactDigest: hash('9') };
  const approval = { manifestHash: request.manifestHash, candidateSha: request.candidateSha, buildId: manifest.build.buildId,
    deploymentId: stage.id, previousDeploymentId: manifest.previous.deploymentId, environment: 'fcos-production-release',
    reviewer: owner.login, nativeReviewVerified: true, runId: priorRunId ?? runId, approvedAt: at(-30_000) };
  const chain = [];
  const add = (event, data) => {
    const frame = { schemaVersion: 1, kind: 'fcos_rapid_release_event', sequence: chain.length, previousHash: chain.at(-1)?.payload.recordHash ?? null,
      manifestHash: request.manifestHash, releaseId: manifest.releaseId, event, data };
    chain.push({ id: 10 + chain.length, creator: bot, payload: { ...frame, recordHash: digest(frame) }, created_at: at(-5000 + 1000 * chain.length) });
  };
  const prerequisite = { planDigest: digest(manifest.prerequisites), candidateSha: request.candidateSha };
  add('stage.result', { outcome: 'applied', result: stage });
  add('approval.accepted', approval);
  if (currentApproval) add('approval.accepted', { ...approval, runId, ...currentApproval });
  add('prerequisites.intent', { operationId: manifest.releaseId + '-prerequisites', requestHash: digest(prerequisite), request: prerequisite });
  add('salesforce.checkpoint', { fingerprint: reviewed.fingerprint, stage: 'devee', operation: 'validation', outcome: 'resolved',
    job: { id: request.validationJobId, validationId: null } });
  add('salesforce.checkpoint', { fingerprint: reviewed.fingerprint, stage: 'devee', operation: 'deployment', outcome: 'resolved',
    job: { id: request.deploymentJobId, validationId: request.validationJobId } });
  const environment = { id: 3, name: 'fcos-production-release', can_admins_bypass: false,
    protection_rules: [{ type: 'required_reviewers', reviewers: [{ reviewer: owner }] }] };
  const reviews = [{ state: 'approved', user: owner, environments: [{ id: environment.id, name: environment.name }] }];
  const handoverPlan = { controllerSha: manifest.controllerSha, handoverId: 'desktop-fixture-handover' };
  const pointer = { id: 701, creator: owner, payload: {
    kind: 'fcos_rapid_release_handover', attestationContract: 'fcos-owner-recorded-handover/v1',
    qualificationPublisher: { account: owner.login, method: 'protected_controller_api' }, controllerSha: manifest.controllerSha,
    plan: handoverPlan, planHash: handoverDigest(handoverPlan), handoverId: handoverPlan.handoverId, databaseReceiptId: 4,
    repository: targets().repository, projectId: targets().projectId, teamId: targets().teamId, unresolvedProductionOperations: 0,
    oldWritersRetired: true, hostedQualificationPassed: true, eventSubscribersReviewed: true, inventoryDigest: hash('1'),
    nativeCoordinatorReadbackDigest: hash('2'), qualificationDigest: hash('3'),
    nativeReview: { planHash: handoverDigest(handoverPlan), reviewer: owner.login, reviewerId: owner.id, state: 'approved',
      environment: environment.name, environmentId: environment.id, runId: 6, jobId: 7, reviewDigest: hash('4'), protectionDigest: hash('5'),
      dispatcherSha: sha('6'), workflowBlobSha: sha('7'), workflowPath: '.github/workflows/fcos-rapid-handover.yml', observedAt: at(-86_400_000) },
  } };
  const runPath = base + '/actions/runs/' + runId;
  const endpoints = new Map([
    ['/user', owner], [base, repo], [base + '/deployments/101', requestDeployment], [runPath, currentRun], [runPath + '/attempts/1', run],
    [base + '/environments/fcos-production-release', environment], [runPath + '/approvals', reviews],
    [runPath + '/attempts/1/jobs?per_page=100', { jobs: [{ name: 'go-live', status: 'in_progress', run_id: runId, run_attempt: runAttempt, started_at: at(-6000) }] }],
    [base + '/actions/variables/FCOS_RAPID_RELEASE_ENABLED', { value: 'true' }],
    [base + '/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID', { value: String(pointer.id) }],
    [base + '/deployments/' + pointer.id, pointer],
    [`${base}/contents/${DEVEE_DESKTOP_WORKFLOW}?ref=${manifest.controllerSha}`, { type: 'file', sha: request.workflowBlobSha }],
    [`${base}/contents/${DEVEE_DESKTOP_WORKFLOW}?ref=${run.head_sha}`, { type: 'file', sha: request.workflowBlobSha }],
    [`${base}/contents/${pointer.payload.nativeReview.workflowPath}?ref=${manifest.controllerSha}`, { type: 'file', sha: pointer.payload.nativeReview.workflowBlobSha }],
  ]);
  const receipts = [], writes = [];
  let now = started + 15_000;
  const github = { candidateSha: request.candidateSha,
    async read(path) { assert.ok(endpoints.has(path), 'Unexpected GitHub read ' + path); return structuredClone(endpoints.get(path)); },
    async pages(path) { return structuredClone(path.includes('environment=' + LOCAL_MIRROR_ENVIRONMENT) ? receipts : chain); },
    async write(path, body) {
      assert.equal(path, base + '/deployments');
      assert.equal(body.ref, request.candidateSha);
      assert.equal(body.environment, LOCAL_MIRROR_ENVIRONMENT);
      assert.equal(body.production_environment, false);
      assert.equal(lstatSync(intentFile).mode & 0o077, 0);
      assert.deepEqual(JSON.parse(readFileSync(intentFile, 'utf8')), { schemaVersion: 1, kind: 'fcos_devee_desktop_operator_intent', endpoint: path, body });
      writes.push(body);
      const created = { id: 102, creator: owner, sha: body.ref, environment: body.environment, payload: body.payload, created_at: at(10_000) };
      if (!noAcknowledgement) receipts.push(created);
      if (lost || noAcknowledgement) throw Error('submission acknowledgement lost');
      return created;
    },
  };
  const publish = override => publishDeveeDesktopEvidence({ github, manifest, reviewed, report, runId, runAttempt, requestId: requestDeployment.id,
    intentDirectory, now: () => now, ...override });
  return { publish, request, requestDeployment, report, receipts, writes, endpoints, run, currentRun, runPath, intentFile, setTime: value => { now = value; } };
}

test('only the exact non-Production receipt is submitted after the private intent is durable', async t => {
  const f = fixture(t);
  const result = await f.publish();
  assert.deepEqual({ mode: result.mode, proofId: result.proofId }, { mode: 'recorded', proofId: 102 });
  assert.equal(f.writes.length, 1);
  assert.equal((await f.publish()).mode, 'readback');
  assert.equal(f.writes.length, 1);
  await assert.rejects(f.publish({ report: { ...f.report, evidenceDigest: hash('0') } }), /DEVEE_DESKTOP_OPERATOR_INTENT_CHANGED/);
  f.receipts.push({ ...f.receipts[0], id: 103 });
  await assert.rejects(f.publish(), /DEVEE_DESKTOP_OPERATOR_RECEIPT_DUPLICATE/);
  assert.equal(f.writes.length, 1);
});

test('a replacement run cannot publish using historical approval even when the native gate is active', async t => {
  const f = fixture(t, { priorRunId: 24 });
  await assert.rejects(f.publish(), /DEVEE_DESKTOP_OPERATOR_CURRENT_APPROVAL_RECEIPT_REQUIRED/);
  assert.ok(!existsSync(f.intentFile));
  assert.deepEqual(f.writes, []);
});

test('a separate exact bot-authored receipt admits the replacement run without changing the original Salesforce jobs', async t => {
  const f = fixture(t, { priorRunId: 24, currentApproval: { approvedAt: at(-30_000) } });
  assert.equal((await f.publish()).proofId, 102);
  assert.equal(f.writes[0].payload.proof.deploymentJobId, f.request.deploymentJobId);
  assert.equal(f.writes[0].payload.proof.validationJobId, f.request.validationJobId);
});

test('exact approval app, immutable timing and attempt constraints fail closed', async t => {
  const wrongDeployment = fixture(t, { priorRunId: 24, currentApproval: { deploymentId: 'dpl_other' } });
  await assert.rejects(wrongDeployment.publish(), /EXACT_PRODUCTION_AUTHORIZATION_REQUIRED/);
  const impossibleTiming = fixture(t, { priorRunId: 24, currentApproval: { approvedAt: at(1000) } });
  await assert.rejects(impossibleTiming.publish(), /CURRENT_APPROVAL_RECEIPT_REQUIRED/);
  const laterAttempt = fixture(t);
  await assert.rejects(laterAttempt.publish({ runAttempt: 2 }), /REVIEW_SCOPE_INVALID/);
  for (const item of [wrongDeployment, impossibleTiming, laterAttempt]) {
    assert.ok(!existsSync(item.intentFile));
    assert.deepEqual(item.writes, []);
  }
});

test('wrong actor, source, provider job, report and allowlist fail before the local claim', async t => {
  const checks = [
    [f => f.endpoints.set('/user', { ...owner, id: 12 }), /IDENTITY_MISMATCH/],
    [f => { f.request.controllerSha = sha('f'); }, /REQUEST_MISMATCH/],
    [f => { f.request.deploymentJobId = '0Af000000000000003'; }, /ORIGINAL_JOB_OR_REPORT_REQUIRED/],
    [f => { f.report.installedInventoryHash = hash('f'); }, /EVIDENCE_INVALID/],
    [f => { f.report.businessWrites = 1; }, /EVIDENCE_INVALID/],
    [f => { f.report.extra = true; }, /REPORT_SCOPE_INVALID/],
    [f => { f.report.password = 'fixture-private-value'; }, /JOURNAL_PRIVATE_FIELD/],
    [f => f.endpoints.set(f.runPath + '/approvals', []), /NATIVE_APPROVAL_REQUIRED/],
  ];
  for (const [change, expected] of checks) {
    const f = fixture(t);
    change(f);
    await assert.rejects(f.publish(), expected);
    assert.ok(!existsSync(f.intentFile));
    assert.deepEqual(f.writes, []);
  }
});

test('expired requests and a changed current run are read-only', async t => {
  const expired = fixture(t);
  expired.setTime(Date.parse(expired.request.expiresAt));
  await assert.rejects(expired.publish(), /NATIVE_REQUEST_INVALID/);
  assert.ok(!existsSync(expired.intentFile));
  const cancelled = fixture(t);
  cancelled.currentRun.status = 'completed';
  await assert.rejects(cancelled.publish(), /NATIVE_APPROVAL_REQUIRED/);
  assert.ok(existsSync(cancelled.intentFile));
  assert.deepEqual(cancelled.writes, []);
  await assert.rejects(cancelled.publish(), /RECEIPT_ACK_UNCERTAIN/);
  assert.deepEqual(cancelled.writes, []);
});

test('lost confirmation is read back from the original attempt after expiry or a subsequent attempt', async t => {
  const f = fixture(t, { lost: true });
  assert.equal((await f.publish()).proofId, 102);
  f.run.status = 'completed';
  f.currentRun.run_attempt = 2;
  f.setTime(Date.parse(f.request.expiresAt) + 20_000);
  const result = await f.publish({ readbackOnly: true });
  assert.equal(result.mode, 'readback');
  assert.equal(result.runAttempt, 1);
  assert.equal(result.proofId, 102);
  assert.equal(f.writes.length, 1);
});

test('unknown acknowledgement and concurrent calls never submit the same request twice on the operator host', async t => {
  const unknown = fixture(t, { noAcknowledgement: true });
  await assert.rejects(unknown.publish(), /RECEIPT_ACK_UNCERTAIN/);
  await assert.rejects(unknown.publish(), /RECEIPT_ACK_UNCERTAIN/);
  assert.equal(unknown.writes.length, 1);
  const readonly = fixture(t);
  await assert.rejects(readonly.publish({ readbackOnly: true }), /RECEIPT_ACK_UNCERTAIN/);
  assert.ok(!existsSync(readonly.intentFile));
  assert.equal(readonly.writes.length, 0);
  const concurrent = fixture(t);
  const outcomes = await Promise.allSettled([concurrent.publish(), concurrent.publish()]);
  assert.ok(outcomes.some(item => item.status === 'fulfilled' && item.value.proofId === 102));
  assert.equal(concurrent.writes.length, 1);
});

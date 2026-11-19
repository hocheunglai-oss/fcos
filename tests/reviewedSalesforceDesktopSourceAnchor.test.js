import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { createLocalMirrorRequest, LOCAL_MIRROR_ENVIRONMENT } from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';
import { createDeveeDesktopReceipt, createDeveeDesktopRequest, DEVEE_DESKTOP_WORKFLOW,
  editorDesktopCases, editorDesktopCaseSetDigest } from '../scripts/lib/rapid-release/salesforce-devee-desktop-checkpoint.mjs';
import { verifyCompletedDesktopApproval, verifyPublishedDesktopMirror, selectCompletedSalesforceJob } from '../scripts/verify-completed-reviewed-salesforce-source.mjs';
import { EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT, EDITOR_PREFLIGHT_ATTESTATION_TASK }
  from '../scripts/lib/rapid-release/salesforce-editor-preflight-transport.mjs';

const base = Date.parse('2026-11-16T06:00:00.000Z');
const at = offset => new Date(base + offset).toISOString();
const sha = char => char.repeat(40);
const hash = char => char.repeat(64);
const actor = { id: 41898282, login: 'github-actions[bot]' };
const { publication } = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const owner = { id: publication.requiredAccountId, login: publication.requiredAccount };
const originalId = 43700000001;
const resumedId = 43700000002;
const approvalError = /REVIEWED_SOURCE_ANCHOR_.*APPROVAL|EXACT_PRODUCTION_AUTHORIZATION_REQUIRED/u;

function approvalFixture({ resume = true, originalOffset = -60_000 } = {}) {
  const manifest = createManifest({
    candidate: { sha: sha('a'), sourceDigest: hash('1'), lockDigest: hash('2') },
    controllerSha: sha('c'),
    previous: { sha: sha('d'), deploymentId: 'dpl_previous', configurationDigest: hash('3'), schemaDigest: hash('4') },
    paths: ['force-app/main/default/classes/FcosTradeCurrencyService.cls'],
    publicEnvironment: {
      VITE_SUPABASE_URL: 'https://' + targets().supabaseProject + '.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'p'.repeat(25),
    },
    releaseId: 'reviewed-desktop-anchor-tests',
    now: at(originalOffset - 1000),
    prerequisites: {
      adapter: 'salesforce-reviewed-manifest',
      adapterDigest: hash('5'),
      plan: { mirrorPublication: 'local-collaborator', deveeDesktopCaseSetDigest: editorDesktopCaseSetDigest },
    },
  });
  const manifestHash = digest(manifest);
  const staged = { id: 'dpl_candidate', sha: manifest.candidate.sha, buildId: manifest.build.buildId };
  const run = { id: resume ? resumedId : originalId, run_attempt: 1, created_at: at(resume ? 0 : originalOffset) };
  const records = [];
  function add(event, data, offset) {
    const content = { schemaVersion: 1, kind: 'fcos_rapid_release_event', releaseId: manifest.releaseId, manifestHash,
      sequence: records.length, previousHash: records.at(-1)?.payload.recordHash ?? null, event, data };
    const row = { id: records.length + 1, creator: actor, created_at: at(offset), task: 'fcos-release-journal',
      environment: 'fcos-release-journal-v1', sha: staged.sha, payload: { ...content, recordHash: digest(content) } };
    records.push(row);
    return row;
  }
  function approved(runId, offset) {
    return {
      manifestHash, candidateSha: manifest.candidate.sha, buildId: manifest.build.buildId, deploymentId: staged.id,
      previousDeploymentId: manifest.previous.deploymentId, environment: 'fcos-production-release', reviewer: targets().account,
      nativeReviewVerified: true, runId, approvedAt: at(offset),
    };
  }
  const original = add('approval.accepted', approved(originalId, originalOffset), originalOffset + 2000);
  const current = resume ? add('approval.reconfirmed', approved(resumedId, 0), 2000) : original;
  const promote = add('promote.intent', { operationId: manifest.releaseId + '-promote' }, 5000);
  return { records, run, manifest, staged, promote, original, current };
}

test('desktop source anchor admits the original protected approval for a successful first run', () => {
  const input = approvalFixture({ resume: false });
  assert.deepEqual(verifyCompletedDesktopApproval(input), new Map([[originalId, input.original]]));
});

test('desktop source anchor keeps original authority and admits the reapproved successful run', () => {
  const input = approvalFixture();
  assert.deepEqual(verifyCompletedDesktopApproval(input),
    new Map([[originalId, input.original], [resumedId, input.current]]));
});

test('an expired original approval remains historical authority when valid at its recorded time', () => {
  const input = approvalFixture({ originalOffset: -2 * 86_400_000 });
  const approvals = verifyCompletedDesktopApproval(input);
  assert.equal(approvals.get(originalId), input.original);
  assert.equal(approvals.get(resumedId), input.current);
});

test('a later approval supports completion readback of a promotion already issued under original authority', () => {
  function readback(originalOffset) {
    const input = approvalFixture({ originalOffset });
    const { original, current, promote } = input;
    promote.created_at = at(-1000);
    promote.payload.sequence = 1;
    current.payload.sequence = 2;
    const completion = { created_at: at(6000), payload: { event: 'release.complete', sequence: 3 } };
    return { ...input, records: [original, promote, current, completion], completion };
  }
  const eligible = readback(-60_000);
  assert.deepEqual(verifyCompletedDesktopApproval(eligible), new Map([[originalId, eligible.original], [resumedId, eligible.current]]));
  assert.throws(() => verifyCompletedDesktopApproval(readback(-2 * 86_400_000)), approvalError,
    'a later reconfirmation cannot authorize an already-issued promotion');
});

test('missing and duplicate desktop approval events fail closed', () => {
  for (const label of ['original', 'current']) {
    const missing = approvalFixture();
    missing.records = missing.records.filter(record => record !== missing[label]);
    assert.throws(() => verifyCompletedDesktopApproval(missing), approvalError);
    const duplicated = approvalFixture();
    duplicated.records.splice(2, 0, { ...duplicated[label], id: 99 });
    assert.throws(() => verifyCompletedDesktopApproval(duplicated), approvalError);
  }
});

test('desktop approval must come from the workflow bot and match the exact staged candidate', () => {
  for (const change of [
    ({ current }) => { current.creator = { id: actor.id, login: 'unexpected-actor' }; },
    ({ current }) => { current.creator = { id: actor.id + 1, login: actor.login }; },
    ({ original }) => { original.payload.data.nativeReviewVerified = false; },
    ({ current }) => { current.payload.data.deploymentId = 'dpl_other'; },
    ({ current }) => { current.payload.data.manifestHash = hash('9'); },
  ]) {
    const input = approvalFixture();
    change(input);
    assert.throws(() => verifyCompletedDesktopApproval(input), approvalError);
  }
});

test('future, expired, and out-of-order desktop approvals cannot authorize promotion', () => {
  const invalidTimes = {
    'authorization recorded before its approval': ({ current }) => { current.payload.data.approvedAt = at(3000); },
    'approval timestamp after reported promotion': ({ current }) => { current.created_at = at(6000); },
    'approval sequenced after reported promotion': ({ current, promote }) => { current.payload.sequence = promote.payload.sequence + 1; },
    'expired completion approval': ({ current, run }) => { run.created_at = current.payload.data.approvedAt = at(-2 * 86_400_000); },
    'same-run attempt two': ({ run }) => { run.run_attempt = 2; },
  };
  for (const [label, change] of Object.entries(invalidTimes)) {
    const input = approvalFixture();
    change(input);
    assert.throws(() => verifyCompletedDesktopApproval(input), approvalError, label);
  }
});

function publishedMirrorFixture() {
  const input = approvalFixture();
  const approvedRuns = verifyCompletedDesktopApproval(input);
  const { manifest, staged, original, current, promote } = input;
  const devee = fcosSalesforceEnvironment('devee');
  const repo = { id: 1278654816, full_name: targets().repository, owner, default_branch: 'main' };
  const run = { ...input.run, head_sha: sha('e') };
  const oldRun = { id: originalId, run_attempt: 1, actor: owner, repository: repo, head_branch: 'main',
    event: 'workflow_dispatch', status: 'in_progress', path: DEVEE_DESKTOP_WORKFLOW, head_sha: sha('d') };
  const inventory = {
    orgId: devee.orgId, inventoryHash: hash('3'), observedNativeInventoryHash: hash('4'), evidenceSha256: hash('5'),
    verifiedAt: at(-45_000), identity: { isSandbox: true, username: devee.username },
    verificationMethod: 'metadata-api-reviewed-native-byte-inventory',
  };
  const reviewed = {
    review: { nativeDeveeDesktop: { caseSetDigest: editorDesktopCaseSetDigest } }, fingerprint: hash('1'),
    binding: { sourceTreeHash: hash('2'), orgIds: { devee: devee.orgId } },
    nativeInventories: { devee: { final: { inventoryHash: inventory.inventoryHash, projectedNativeInventory: true } } },
  };
  const metadata = { status: 'Succeeded', orgId: devee.orgId, fingerprint: reviewed.fingerprint,
    jobId: '0Af000000000000002', validationJobId: '0Af000000000000001' };
  const workflowProof = { kind: 'native_workflow_blob_match', controllerSha: manifest.controllerSha,
    dispatcherSha: oldRun.head_sha, path: DEVEE_DESKTOP_WORKFLOW, blobSha: sha('f') };
  const approval = original.payload.data;
  const request = createDeveeDesktopRequest({ manifest, approval, reviewed, deployment: metadata, inventory,
    execution: { user: actor, repo, run: oldRun }, workflowProof, now: base - 43_000 });
  const nativeRow = (id, creator, payload, offset) => ({
    id, creator, payload, created_at: at(offset), environment: LOCAL_MIRROR_ENVIRONMENT, sha: manifest.candidate.sha,
  });
  const requestRow = nativeRow(41, actor, request, -42_000);
  const report = {
    orgId: request.orgId, isSandbox: true, deploymentJobId: request.deploymentJobId, validationJobId: request.validationJobId,
    sourceTreeHash: request.sourceTreeHash, installedInventoryHash: request.installedInventoryHash, caseSetDigest: request.caseSetDigest,
    startedAt: at(-41_000), verifiedAt: at(-39_000), roles: ['normal', 'restricted'],
    cases: editorDesktopCases.map(id => ({ id, passed: true, evidenceDigest: digest(id) })),
    businessWrites: 0, financialRequests: 0, customerSends: 0, approvedFixturesOnly: true, syntheticFixtureWrites: 2,
    fixturesRestored: true, evidenceDigest: hash('6'),
  };
  const receipt = createDeveeDesktopReceipt({ request, requestId: requestRow.id, report });
  const receiptRow = nativeRow(42, owner, receipt, -38_000);
  const checkpoint = (data, sequence, offset) => ({ creator: actor, created_at: at(offset),
    payload: { event: 'salesforce.checkpoint', data: { fingerprint: reviewed.fingerprint, ...data }, sequence } });
  const validation = checkpoint({ stage: 'devee', operation: 'validation', outcome: 'resolved',
    job: { id: metadata.validationJobId } }, 1, -53_000);
  const deployment = checkpoint({ stage: 'devee', operation: 'deployment', outcome: 'resolved',
    job: { id: metadata.jobId, validationId: metadata.validationJobId } }, 2, -46_000);
  const desktopCheckpoint = checkpoint({ stage: 'devee', operation: 'native-desktop-smoke', outcome: 'evidence',
    desktop: { requestId: requestRow.id, requestDigest: receipt.requestDigest, proofId: receiptRow.id, proofDigest: receipt.proofDigest,
      sourceTreeHash: request.sourceTreeHash, runId: originalId, runAttempt: oldRun.run_attempt, inventoryHash: request.inventoryHash,
      installedInventoryHash: request.installedInventoryHash, caseSetDigest: request.caseSetDigest,
      finalInventoryReceiptDigest: inventory.evidenceSha256 } }, 3, -37_000);
  const mirrorIntent = checkpoint({ stage: 'shared_mirror', operation: 'publication', outcome: 'pending',
    evidenceDigest: hash('8') }, 4, -36_000);
  const mirrorRequest = createLocalMirrorRequest({ manifest, approval, reviewed, deployment: metadata, runAttempt: 1,
    intentHash: mirrorIntent.payload.data.evidenceDigest, expiresAt: at(-34_000 + 5 * 60_000), now: base - 34_000 });
  const mirrorRequestRow = nativeRow(43, actor, mirrorRequest, -33_000);
  const mirrorPublication = checkpoint({ stage: 'shared_mirror', operation: 'publication', outcome: 'resolved' }, 5, -26_000);
  current.payload.sequence = 6;
  promote.payload.sequence = 7;
  return { approvedRuns, manifest, staged, reviewed, requestRow: mirrorRequestRow, publication: mirrorPublication, deployment, validation, run,
    records: [original, validation, deployment, desktopCheckpoint, mirrorIntent, mirrorPublication, current, promote],
    requests: [requestRow, receiptRow, mirrorRequestRow], desktopCheckpoint, receiptRow };
}

test('the resumed source anchor can attest a prior run’s exact DEVEE checkpoint before its mirror publication', () => {
  assert.doesNotThrow(() => verifyPublishedDesktopMirror(publishedMirrorFixture()));
});

test('a historical mirror publication still requires its own approved run and exact native desktop proof', () => {
  const invalidProofs = {
    'missing historical run approval': ({ approvedRuns }) => { approvedRuns.delete(originalId); },
    'missing checkpoint': input => { input.records = input.records.filter(row => row !== input.desktopCheckpoint); },
    'duplicate checkpoint': ({ records, desktopCheckpoint }) => { records.push(structuredClone(desktopCheckpoint)); },
    'checkpoint after mirror publication': ({ desktopCheckpoint, publication }) => {
      desktopCheckpoint.payload.sequence = publication.payload.sequence + 1;
    },
    'checkpoint after mirror request': ({ desktopCheckpoint }) => { desktopCheckpoint.created_at = at(-32_000); },
    'receipt publisher does not match pinned owner': ({ receiptRow }) => { receiptRow.creator = actor; },
    'ambiguous native receipt': ({ requests, receiptRow }) => { requests.push(structuredClone(receiptRow)); },
    'does not match requested installed native inventory': ({ desktopCheckpoint }) => {
      desktopCheckpoint.payload.data.desktop.installedInventoryHash = hash('9');
    },
  };
  for (const [label, change] of Object.entries(invalidProofs)) {
    const input = publishedMirrorFixture();
    change(input);
    assert.throws(() => verifyPublishedDesktopMirror(input), /REVIEWED_SOURCE_ANCHOR_DESKTOP_|DEVEE_DESKTOP_NATIVE_/u, label);
  }
});

test('a completed release retains the preapproval attestation and run-bound native readback after the receipt expires', () => {
  const input = publishedMirrorFixture();
  const { manifest, reviewed, desktopCheckpoint, approvedRuns } = input;
  const plan = manifest.prerequisites.plan;
  const payload = {
    kind: 'fcos_editor_native_preflight_attestation', schemaVersion: 1, repository: targets().repository,
    candidateSha: manifest.candidate.sha, sourceDigest: manifest.candidate.sourceDigest, controllerSha: manifest.controllerSha,
    baselineSha: manifest.previous.sha, sourceTreeHash: reviewed.binding.sourceTreeHash,
    salesforceFingerprint: reviewed.fingerprint, caseSetDigest: editorDesktopCaseSetDigest, evidenceDigest: hash('6'),
    qualificationValidationJobId: '0Af000000000000003', qualificationDeploymentJobId: '0Af000000000000004',
    installedInventoryHash: hash('4'), cleanupEvidenceDigest: hash('7'), completedAt: at(-80_000), expiresAt: at(-10_000),
  };
  const attestation = {
    id: 45, ref: manifest.candidate.sha, sha: manifest.candidate.sha, created_at: at(-79_000),
    creator: { ...owner, type: 'User' }, repository_url: 'https://api.github.com/repos/' + targets().repository,
    environment: EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT, original_environment: EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT,
    task: EDITOR_PREFLIGHT_ATTESTATION_TASK, production_environment: false, transient_environment: false, payload,
  };
  Object.assign(plan, { editorPreflightReceiptId: attestation.id, editorPreflightReceiptDigest: digest(payload),
    salesforceSourceTreeHash: reviewed.binding.sourceTreeHash, salesforceFingerprint: reviewed.fingerprint });
  approvedRuns.get(originalId).payload.data.manifestHash = digest(manifest);
  Object.assign(desktopCheckpoint.payload.data, { operation: 'native-desktop-preflight',
    desktop: { runId: originalId, proofId: attestation.id, proofDigest: digest(payload), finalInventoryReceiptDigest: hash('5') } });
  const values = { ...input, editorAttestation: attestation };
  assert.doesNotThrow(() => verifyPublishedDesktopMirror(values));
  desktopCheckpoint.payload.data.desktop.runId = resumedId;
  assert.throws(() => verifyPublishedDesktopMirror(values), /DESKTOP_CHECKPOINT_REQUIRED/);
});


test('source anchor permits only identical adopted invoice jobs before the mirror intent', () => {
  const row = (sequence, overrides = {}) => ({ payload: { sequence, data: {
    stage: 'devee', operation: 'validation', fingerprint: hash('b'), evidenceDigest: hash('3'),
    job: { id: '0AfHF000007IeZF0A0', validationId: null, packageSha256: hash('4'), submittedAt: at(0) },
    ...overrides,
  } } });
  const prior = row(7), reattested = row(12, { evidenceDigest: hash('5') });
  const mirror = { payload: { sequence: 14 } };
  const manifest = { prerequisites: { plan: { deveePromotionAdoptionReceiptId: 123 } } };
  const reviewed = { invoiceAppPlacement: { devee: {} }, review: {}, fingerprint: hash('b') };
  const adoptedJobs = [{ operation: 'validation', record: { jobId: prior.payload.data.job.id,
    validationJobId: null, packageSha256: hash('4'), submittedAt: at(0) } }];
  const check = (completed = [prior, reattested], additions = {}) => selectCompletedSalesforceJob({
    completed, manifest, reviewed, stageName: 'devee', operation: 'validation', firstMirrorIntent: mirror, adoptedJobs, ...additions,
  });
  assert.equal(check(), reattested);
  const altered = structuredClone(reattested);
  for (const [field, value] of [['id','0AfHF000007IeZG0A0'], ['packageSha256',hash('7')],
    ['submittedAt',at(1)], ['validationId','0AfHF000007IeZF0A0']]) {
    const changed = structuredClone(altered);
    changed.payload.data.job[field] = value;
    assert.throws(() => check([prior, changed]), /SALESFORCE_JOB_MISMATCH/);
  }
  assert.throws(() => check([prior, row(12, { fingerprint: hash('c') })]), /SALESFORCE_JOB_MISMATCH/);
  assert.throws(() => check([prior, reattested, row(13)]), /SALESFORCE_JOB_MISMATCH/);
  assert.throws(() => check([prior, row(15)]), /SALESFORCE_JOB_MISMATCH/);
  assert.throws(() => check([prior, reattested], { adoptedJobs: undefined }), /SALESFORCE_JOB_MISMATCH/);
  assert.throws(() => check([prior, reattested], { firstMirrorIntent: undefined }), /SALESFORCE_JOB_MISMATCH/);
  assert.throws(() => check([prior, reattested], { reviewed: { review: {} } }), /SALESFORCE_JOB_MISMATCH/);
  assert.throws(() => check([prior, reattested], { manifest: { prerequisites: { plan: {} } } }), /SALESFORCE_JOB_MISMATCH/);
  assert.throws(() => check([prior, reattested], { reviewed: { invoiceAppPlacement: {}, review: { bootstrap: {} } } }), /SALESFORCE_JOB_MISMATCH/);
  assert.throws(() => check([prior, reattested], { reviewed: { invoiceAppPlacement: {}, review: { nativeDeveeDesktop: {} } } }), /SALESFORCE_JOB_MISMATCH/);
  const qat = [row(7, { stage: 'qat' }), row(12, { stage: 'qat' })];
  assert.throws(() => check(qat, { stageName: 'qat' }), /SALESFORCE_JOB_MISMATCH/);
  assert.equal(check([prior], { manifest: { prerequisites: { plan: {} } } }), prior);
});

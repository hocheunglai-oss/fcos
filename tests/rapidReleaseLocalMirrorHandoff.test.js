import assert from 'node:assert/strict';
import test from 'node:test';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { REVIEWED_SALESFORCE_MODE } from '../scripts/lib/salesforce-reviewed-release.mjs';
import { assertEditorMirrorCheckpointOrder, awaitLocalMirrorReceipt, createLocalMirrorReceipt, createLocalMirrorRequest, LOCAL_MIRROR_ENVIRONMENT, readLocalMirrorApproval, readLocalMirrorStage, recordLocalMirrorDeployment, usesLocalCollaboratorMirror, verifyLocalMirrorReceipt }
  from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';
import { editorDesktopCaseSetDigest } from '../scripts/lib/rapid-release/salesforce-devee-desktop-checkpoint.mjs';

const now = Date.parse('2026-11-12T16:30:00.000Z');
const iso = milliseconds => new Date(milliseconds).toISOString();
const manifest = { controllerSha: 'a'.repeat(40), candidate: { sha: 'b'.repeat(40) } };
const fingerprint = 'c'.repeat(64);
const reviewed = { fingerprint, binding: { sourceTreeHash: 'd'.repeat(64), orgIds: { devee: '00D1m0000008kioEAA' } } };
const deployment = { status: 'Succeeded', fingerprint, orgId: reviewed.binding.orgIds.devee,
  validationJobId: '0Af000000000001', jobId: '0Af000000000002' };
const approval = { manifestHash: digest(manifest), runId: 101, nativeReviewVerified: true, approvedAt: iso(now - 9000) };
const options = { manifest, reviewed, deployment, approval, runAttempt: 1, intentHash: 'e'.repeat(64), expiresAt: iso(now + 120000), now };

test('local publication admits the reviewed Salesforce-only and Trading FX combined routes', () => {
  const route = (adapter, database, salesforce = true, mirrorPublication = 'local-collaborator') =>
    usesLocalCollaboratorMirror({ selection: { salesforce, database }, prerequisites: { adapter, plan: { mirrorPublication } } });
  assert.equal(route('salesforce-reviewed-manifest', false), true);
  assert.equal(route('trading-fx-prerequisites', true), true);
  assert.equal(route('salesforce-reviewed-manifest', true), false);
  assert.equal(route('trading-fx-prerequisites', false), false);
  assert.equal(route('trading-fx-prerequisites', true, false), false);
  assert.equal(route('company-fx-history', true), false);
  assert.equal(route('trading-fx-prerequisites', true, true, 'hosted'), false);
});

test('the local worker accepts owner-created staging only for the exact protected handover artifact', () => {
  const candidate = manifest.candidate.sha, buildId = 'c'.repeat(64), artifactDigest = 'd'.repeat(64);
  const release = { ...manifest, build: { buildId } };
  const manifestHash = digest(release);
  const result = { id: 'dpl_fixture', sha: candidate, buildId, artifactDigest, manifestHash };
  const record = { creator: { id: 265701760 }, payload: { event: 'stage.result', manifestHash, data: { outcome: 'applied', result } } };
  const handover = { candidateSha: candidate, qualificationDeploymentId: result.id, buildId, artifactDigest };
  const input = { manifest: release, handover, workflowActorId: 41898282 };
  assert.equal(readLocalMirrorStage(record, input), result);
  assert.equal(readLocalMirrorStage({ ...record, creator: { id: input.workflowActorId } }, { ...input, handover: null }), result);
  for (const change of [{ candidateSha: 'e'.repeat(40) }, { qualificationDeploymentId: 'dpl_other' }, { artifactDigest: 'e'.repeat(64) }]) {
    assert.throws(() => readLocalMirrorStage(record, { ...input, handover: { ...handover, ...change } }), /STAGE_RECEIPT_REQUIRED/);
  }
  assert.throws(() => readLocalMirrorStage({ ...record, creator: { id: 100 } }, input), /STAGE_RECEIPT_REQUIRED/);
  assert.throws(() => readLocalMirrorStage(undefined, input), /STAGE_RECEIPT_REQUIRED/);
});

test('an opted-in mirror request resolves only the exact active DEVEE desktop approval', () => {
  const workflowActorId = 41898282, creator = { id: workflowActorId, login: 'github-actions[bot]' };
  const optionsFor = desktop => {
    const release = createManifest({ candidate: { ...manifest.candidate, sourceDigest: fingerprint, lockDigest: fingerprint },
      controllerSha: manifest.controllerSha, previous: { sha: '2'.repeat(40), deploymentId: 'dpl_previous', configurationDigest: fingerprint, schemaDigest: fingerprint },
      paths: ['force-app/main/default/classes/FcosTradeCurrencyService.cls'], releaseId: 'mirror-desktop-fixture',
      publicEnvironment: { VITE_SUPABASE_URL: `https://${targets().supabaseProject}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'p'.repeat(24) },
      prerequisites: { adapter: 'salesforce-reviewed-manifest', adapterDigest: fingerprint,
        plan: { mirrorPublication: 'local-collaborator', ...(desktop ? { deveeDesktopCaseSetDigest: editorDesktopCaseSetDigest } : {}) } } });
    const staged = { id: 'dpl_staged' };
    const approval = { manifestHash: digest(release), candidateSha: release.candidate.sha, buildId: release.build.buildId,
      deploymentId: staged.id, previousDeploymentId: release.previous.deploymentId, environment: 'fcos-production-release',
      reviewer: targets().account, nativeReviewVerified: true, runId: 101, approvedAt: iso(now - 8000) };
    const previous = { creator, created_at: iso(now - 7000), payload: { event: 'approval.accepted', sequence: 1, data: approval } };
    const fresh = { creator, created_at: iso(now - 4000), payload: { event: 'approval.reconfirmed', sequence: 4, data: {
      ...approval, runId: 102, approvedAt: iso(now - 6000),
    } } };
    const request = { runId: 102, runAttempt: 1 };
    const jobs = { jobs: [{ name: 'go-live', status: 'in_progress', run_id: 102, run_attempt: 1, started_at: iso(now - 5000) }] };
    return { input: { chain: [previous, fresh], manifest: release, staged, request, requestDeployment: { created_at: iso(now - 2000) },
      jobs, workflowActorId, now }, previous, fresh };
  };
  const { input, previous, fresh } = optionsFor(true);
  assert.deepEqual(readLocalMirrorApproval(input), fresh.payload.data);
  assert.throws(() => readLocalMirrorApproval({ ...input, chain: [previous] }), /CURRENT_APPROVAL_RECEIPT_REQUIRED/);
  assert.throws(() => readLocalMirrorApproval({ ...input, chain: [previous, fresh, fresh] }), /CURRENT_APPROVAL_RECEIPT_REQUIRED/);
  assert.throws(() => readLocalMirrorApproval({ ...input, jobs: { jobs: [{ ...input.jobs.jobs[0], run_id: 101 }] } }), /CURRENT_APPROVAL_RECEIPT_REQUIRED/);
  assert.throws(() => readLocalMirrorApproval({ ...input, request: { ...input.request, runAttempt: 2 } }), /CURRENT_APPROVAL_RECEIPT_REQUIRED/);
  const ordinary = optionsFor(false);
  assert.throws(() => readLocalMirrorApproval(ordinary.input), /LOCAL_MIRROR_RELEASE_JOURNAL_REQUIRED/);
  assert.deepEqual(readLocalMirrorApproval({ ...ordinary.input, request: { runId: 101, runAttempt: 1 } }), ordinary.previous.payload.data);
});

test('mirror request binds the approved run attempt, DEVEE job pair and exact source', () => {
  const request = createLocalMirrorRequest(options);
  assert.equal(request.repository, 'ivanyk20/fcbhk');
  assert.equal(request.repositoryId, 1318388488);
  assert.equal(request.sourceTreeHash, reviewed.binding.sourceTreeHash);
  assert.equal(request.deploymentJobId, deployment.jobId);
  assert.equal(request.validationJobId, deployment.validationJobId);
  assert.notEqual(digest(request), digest(createLocalMirrorRequest({ ...options, runAttempt: 2 })));
  for (const change of [
    { deployment: { ...deployment, status: 'Failed' } },
    { deployment: { ...deployment, orgId: 'foreign' } },
    { deployment: { ...deployment, validationJobId: deployment.jobId } },
    { approval: { ...approval, manifestHash: 'f'.repeat(64) } },
    { approval: { ...approval, approvedAt: iso(now - 86_400_001) } },
    { expiresAt: iso(now + 300_001) },
  ]) {
    assert.throws(() => createLocalMirrorRequest({ ...options, ...change }), /LOCAL_MIRROR_REQUEST_INVALID/);
  }
});

test('only the designated publisher can answer the exact native request within its window', () => {
  const request = createLocalMirrorRequest(options);
  const workflowActorId = 41898282;
  const publisherId = 265701760;
  const requestDeployment = { id: 201, creator: { id: workflowActorId }, environment: LOCAL_MIRROR_ENVIRONMENT,
    sha: request.candidateSha, created_at: iso(now - 2000), payload: request };
  const report = {
    releaseMode: REVIEWED_SALESFORCE_MODE, sourceTreeHash: request.sourceTreeHash, sourceEnvironment: 'devee',
    sourceDeploymentJobId: deployment.jobId, repository: request.repository, account: 'hocheunglai-oss',
    branch: 'codex/salesforce-metadata-sync-20261112', commit: 'f'.repeat(40),
    pullRequest: { number: 8, state: 'OPEN', isDraft: true, baseRefName: 'main',
      headRefName: 'codex/salesforce-metadata-sync-20261112', headRefOid: 'f'.repeat(40) },
  };
  const payload = createLocalMirrorReceipt({ request, requestId: requestDeployment.id, reviewed, report });
  assert.throws(() => createLocalMirrorReceipt({ request, requestId: requestDeployment.id, reviewed,
    report: { ...report, pullRequest: { ...report.pullRequest, isDraft: false } } }), /exact open draft PR head/);
  const receiptDeployment = { id: 202, creator: { id: publisherId }, environment: LOCAL_MIRROR_ENVIRONMENT,
    sha: request.candidateSha, created_at: iso(now - 1000), payload };
  const input = { request, requestDeployment, receiptDeployment, reviewed, workflowActorId, publisherId, now };
  assert.deepEqual(verifyLocalMirrorReceipt(input), report);
  for (const changed of [
    { creator: { id: workflowActorId } },
    { created_at: iso(now - 3000) },
    { sha: '1'.repeat(40) },
    { payload: { ...payload, requestId: 203 } },
    { payload: { ...payload, requestHash: digest({ ...request, runAttempt: 2 }) } },
    { payload: { ...payload, proof: { ...payload.proof, sourceDeploymentJobId: request.validationJobId } } },
    { payload: { ...payload, repositoryId: 1 } },
  ]) {
    assert.throws(() => verifyLocalMirrorReceipt({ ...input, receiptDeployment: { ...receiptDeployment, ...changed } }),
      /LOCAL_MIRROR_RECEIPT_MISMATCH/);
  }
  assert.throws(() => verifyLocalMirrorReceipt({ ...input, now: Date.parse(request.expiresAt) }), /LOCAL_MIRROR_REQUEST_EXPIRED/);
  assert.throws(() => verifyLocalMirrorReceipt({ ...input, requestDeployment: { ...requestDeployment, creator: { id: publisherId } } }),
    /LOCAL_MIRROR_REQUEST_NOT_NATIVE/);
});

test('a lost native acknowledgement is resolved by readback without another submission', async () => {
  const payload = createLocalMirrorRequest(options);
  const records = [];
  let writes = 0;
  const github = {
    pages: async path => {
      assert.match(path, /\/repos\/hocheunglai-oss\/fcos\/deployments\?/);
      assert.ok(path.includes(`sha=${payload.candidateSha}`));
      return records;
    },
    write: async (_path, body) => {
      writes++;
      assert.equal(body.production_environment, false);
      records.push({ id: 100, environment: body.environment, sha: body.ref, creator: { id: 41898282 }, payload: body.payload });
      throw new Error('lost acknowledgement');
    },
  };
  const input = { github, candidateSha: payload.candidateSha, actorId: 41898282, payload };
  assert.equal((await recordLocalMirrorDeployment(input)).id, 100);
  assert.equal((await recordLocalMirrorDeployment(input)).id, 100);
  assert.equal(writes, 1);
  records.length = 0;
  await assert.rejects(recordLocalMirrorDeployment({ ...input, readbackOnly: true }), /LOCAL_MIRROR_RECORD_ACK_UNCERTAIN/);
  assert.equal(writes, 1);
});

test('hosted job waits for a bound receipt and stops at the original request deadline', async () => {
  const request = createLocalMirrorRequest({ ...options, expiresAt: iso(now + 6000) });
  const requestDeployment = { id: 201, creator: { id: 41898282 }, environment: LOCAL_MIRROR_ENVIRONMENT,
    sha: request.candidateSha, created_at: iso(now), payload: request };
  let current = now;
  let writes = 0;
  const records = [];
  const github = { pages: async () => records, write: async () => { writes++; records.push(requestDeployment); } };
  await assert.rejects(awaitLocalMirrorReceipt({ github, request, reviewed, workflowActorId: 41898282, publisherId: 265701760,
    now: () => current, pause: async ms => { current += ms; } }), /LOCAL_MIRROR_RECEIPT_WINDOW_ENDED/);
  assert.equal(writes, 1);
  assert.equal(current, Date.parse(request.expiresAt));
});


test('Editors continuation checks the original mirror with fresh DEVEE evidence and the same jobs', () => {
  const plan = { editorPreflightReceiptId: 10, editorPreflightReceiptDigest: 'a'.repeat(64) };
  const request = { mode: 'check', runId: 102, validationJobId: deployment.validationJobId, deploymentJobId: deployment.jobId };
  const firstDeployment = { stage: 'devee', operation: 'deployment', outcome: 'resolved',
    job: { id: request.deploymentJobId, validationId: request.validationJobId } };
  const makeDesktop = runId => ({ stage: 'devee', operation: 'native-desktop-preflight', outcome: 'evidence',
    desktop: { runId, proofId: plan.editorPreflightReceiptId, proofDigest: plan.editorPreflightReceiptDigest,
      finalInventoryReceiptDigest: 'b'.repeat(64) } });
  const firstDesktop = makeDesktop(101);
  const mirror = { stage: 'shared_mirror', operation: 'publication', outcome: 'resolved' };
  const currentDeployment = { ...firstDeployment };
  const currentDesktop = makeDesktop(102);
  const current = [firstDeployment, firstDesktop, mirror, currentDeployment, currentDesktop];
  const verify = (checkpoints, overrides = {}) => assertEditorMirrorCheckpointOrder({
    checkpoints, deployment: currentDeployment, mirror, request, plan, ...overrides,
  });
  verify(current);
  verify([firstDeployment, firstDesktop, mirror], { deployment: firstDeployment, request: { ...request, runId: 101 } });
  for (const mode of ['publish', 'recover']) {
    assert.throws(() => verify(current, { request: { ...request, mode } }), /LOCAL_MIRROR_EDITOR_PREFLIGHT_REQUIRED/);
  }
  assert.throws(() => verify(current.slice(0, -1)), /LOCAL_MIRROR_EDITOR_PREFLIGHT_REQUIRED/);
  assert.throws(() => verify([firstDeployment, mirror, currentDeployment, currentDesktop]), /LOCAL_MIRROR_EDITOR_PREFLIGHT_REQUIRED/);
  assert.throws(() => verify([...current, { ...currentDesktop, outcome: 'pending' }]), /LOCAL_MIRROR_EDITOR_PREFLIGHT_REQUIRED/);
  const mismatchedJob = { ...firstDeployment, job: { ...firstDeployment.job, validationId: '0Af000000000003' } };
  assert.throws(() => verify([mismatchedJob, ...current.slice(1)]), /LOCAL_MIRROR_EDITOR_PREFLIGHT_REQUIRED/);
});

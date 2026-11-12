import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { REVIEWED_SALESFORCE_MODE } from '../scripts/lib/salesforce-reviewed-release.mjs';
import { awaitLocalMirrorReceipt, createLocalMirrorReceipt, createLocalMirrorRequest, LOCAL_MIRROR_ENVIRONMENT, recordLocalMirrorDeployment, verifyLocalMirrorReceipt }
  from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';

const now = Date.parse('2026-11-12T16:30:00.000Z');
const iso = milliseconds => new Date(milliseconds).toISOString();
const manifest = { controllerSha: 'a'.repeat(40), candidate: { sha: 'b'.repeat(40) } };
const fingerprint = 'c'.repeat(64);
const reviewed = { fingerprint, binding: { sourceTreeHash: 'd'.repeat(64), orgIds: { devee: '00D1m0000008kioEAA' } } };
const deployment = { status: 'Succeeded', fingerprint, orgId: reviewed.binding.orgIds.devee,
  validationJobId: '0Af000000000001', jobId: '0Af000000000002' };
const approval = { manifestHash: digest(manifest), runId: 101, nativeReviewVerified: true, approvedAt: iso(now - 9000) };
const options = { manifest, reviewed, deployment, approval, runAttempt: 1, intentHash: 'e'.repeat(64), expiresAt: iso(now + 120000), now };

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

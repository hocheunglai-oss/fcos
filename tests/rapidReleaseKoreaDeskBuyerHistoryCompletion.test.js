import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fcosConnectionProvider, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { REVIEWED_SALESFORCE_MODE } from '../scripts/lib/salesforce-reviewed-release.mjs';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { verifyKoreaDeskBuyerHistoryCompletion } from '../scripts/lib/rapid-release/korea-desk-buyer-history-recovery.mjs';
import { createLocalMirrorReceipt, createLocalMirrorRequest, LOCAL_MIRROR_ENVIRONMENT } from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';

function fixture() {
  const records = [], requests = [], completedOperations = [];
  const start = Date.parse('2026-11-24T20:00:00Z');
  const iso = time => new Date(time).toISOString();
  const run = { id: 123, run_attempt: 2 };
  const owner = fcosConnectionProvider('salesforce').publication;
  const reviewed = { fingerprint: digest('review'), binding: { sourceTreeHash: digest('tree'), orgIds: { devee: fcosSalesforceEnvironment('devee').orgId } } };
  const manifest = { controllerSha: 'a'.repeat(40), candidate: { sha: 'b'.repeat(40) }, prerequisites: { plan: { koreaDeskBuyerHistoryReceiptId: 11 } } };
  const approval = { runId: run.id, approvedAt: iso(start), nativeReviewVerified: true, manifestHash: digest(manifest) };
  const deploy = { status: 'Succeeded', fingerprint: reviewed.fingerprint, orgId: reviewed.binding.orgIds.devee,
    validationJobId: '0Af000000000001AAA', jobId: '0Af000000000002AAA' };
  const head = { commit: 'c'.repeat(40), pullRequest: 9 };
  const report = { releaseMode: REVIEWED_SALESFORCE_MODE, sourceTreeHash: reviewed.binding.sourceTreeHash, sourceEnvironment: 'devee',
    sourceDeploymentJobId: deploy.jobId, repository: owner.repository, account: owner.requiredAccount, branch: 'review', commit: head.commit,
    pullRequest: { number: head.pullRequest, state: 'OPEN', isDraft: true, baseRefName: owner.defaultBranch, headRefName: 'review', headRefOid: head.commit } };
  function event(name, data) {
    const sequence = records.length;
    const row = { created_at: iso(start + sequence * 60_000), payload: { event: name, sequence, data } };
    records.push(row);
    return row;
  }
  function checkpoint(stage, operation, fields, outcome = 'resolved') {
    return event('salesforce.checkpoint', { stage, operation, outcome, evidenceDigest: digest(String(records.length)), fingerprint: reviewed.fingerprint, ...fields });
  }
  const publish = () => checkpoint('shared_mirror', 'publication', { mirror: { ...head } });
  function correction(stage) {
    const packageSha256 = digest('packet-' + stage);
    checkpoint(stage, 'buyer-history-correction', { job: { id: null, packageSha256 } }, 'pending');
    const saved = checkpoint(stage, 'buyer-history-correction', { job: { id: 'correction-' + stage, packageSha256 } });
    completedOperations.push({ operationId: 'salesforce:' + stage + ':buyer-history-correction',
      evidenceDigest: saved.payload.data.evidenceDigest, verified: true, intentRecorded: true });
  }
  event('approval.accepted', approval);
  const validation = { id: deploy.validationJobId }, deployment = { id: deploy.jobId, validationId: validation.id };
  checkpoint('devee', 'validation', { job: validation });
  checkpoint('devee', 'deployment', { job: deployment });
  const inherited = publish();
  correction('devee');
  const deveeMirror = publish();
  correction('qat');
  const qatMirror = publish();
  correction('production');
  checkpoint('production', 'validation', { job: { id: 'production-validation' } });
  checkpoint('production', 'deployment', { job: { id: 'production-deploy', validationId: 'production-validation' } });
  publish();
  event('prerequisites.passed', { completedOperations });
  const recovery = { closure: { id: 11 }, mirror: { checkpoint: inherited }, salesforceOperations: [
    { stage: 'devee', operation: 'validation', job: validation }, { stage: 'devee', operation: 'deployment', job: deployment },
  ] };
  function attempt(previous, { after, acknowledged = true, receiptReport = report, attemptNumber = 2 }) {
    const time = Date.parse(previous.created_at) + after;
    const id = 1000 + requests.length;
    const request = createLocalMirrorRequest({ manifest, reviewed, deployment: deploy, approval, runAttempt: attemptNumber,
      intentHash: previous.payload.data.evidenceDigest, expiresAt: iso(time + 5000), mode: 'check', sequence: id, now: time });
    function nativeRow(payload, nativeId, actorId, at) {
      return { id: nativeId, creator: { id: actorId }, created_at: iso(at), environment: LOCAL_MIRROR_ENVIRONMENT, sha: manifest.candidate.sha, payload };
    }
    requests.push(nativeRow(request, id, 41898282, time));
    if (acknowledged) {
      const receipt = createLocalMirrorReceipt({ request, requestId: id, reviewed, report: receiptReport });
      requests.push(nativeRow(receipt, id + 1, owner.requiredAccountId, time + 1000));
    }
  }
  // One native owner receipt for each later publication. Tests vary the first interval.
  attempt(deveeMirror, { after: 15_000 });
  attempt(qatMirror, { after: 15_000 });
  return { requests, inherited, report, head, attempt,
    verify: () => verifyKoreaDeskBuyerHistoryCompletion({ recovery, records, requests, reviewed, manifest, run }) };
}

test('an expired mirror request can be followed by an authenticated successful retry against the same checkpoint', () => {
  const f = fixture();
  f.attempt(f.inherited, { after: 1000, acknowledged: false, attemptNumber: 1 });
  f.attempt(f.inherited, { after: 10_000 });
  assert.deepEqual(f.verify().mirror, f.head);
});

test('two distinct authenticated check receipts are acceptable for the same unchanged draft', () => {
  const f = fixture();
  f.attempt(f.inherited, { after: 1000, attemptNumber: 1 });
  f.attempt(f.inherited, { after: 10_000 });
  assert.deepEqual(f.verify().mirror, f.head);
});

test('requests without a valid owner receipt cannot prove a mirror publication', () => {
  const f = fixture();
  f.attempt(f.inherited, { after: 1000, acknowledged: false, attemptNumber: 1 });
  f.attempt(f.inherited, { after: 10_000, acknowledged: false });
  assert.throws(f.verify, /KOREA_BUYER_HISTORY_CURRENT_MIRROR_RECEIPT_REQUIRED/u);
});

test('two owner receipts for one request remain ambiguous even with another successful retry', () => {
  const f = fixture();
  f.attempt(f.inherited, { after: 1000, attemptNumber: 1 });
  const duplicate = structuredClone(f.requests.at(-1));
  duplicate.id = 98765;
  f.requests.push(duplicate);
  f.attempt(f.inherited, { after: 10_000 });
  assert.throws(f.verify, /KOREA_BUYER_HISTORY_CURRENT_MIRROR_RECEIPT_REQUIRED/u);
});

test('a successful retry cannot hide a receipt for another draft or commit', () => {
  for (const change of ['commit', 'draft']) {
    const f = fixture(), other = structuredClone(f.report);
    if (change === 'commit') other.pullRequest.headRefOid = other.commit = 'd'.repeat(40);
    else other.pullRequest.number++;
    f.attempt(f.inherited, { after: 1000, attemptNumber: 1, receiptReport: other });
    f.attempt(f.inherited, { after: 10_000 });
    assert.throws(f.verify, /KOREA_BUYER_HISTORY_COMPLETED_MIRROR_CHANGED/u);
  }
});

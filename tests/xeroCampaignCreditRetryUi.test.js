import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { confirmedCreditRecovery, confirmedCreditRetry, creditRetryForecast, creditRetryQuotaMessage, creditRetrySelection, retryCampaignCredits } from '../src/lib/xeroCampaignCreditRetry.js';
import { selectionFromLoadedRows } from '../src/lib/xeroReconciliationCampaign.js';

const original = 'a'.repeat(64);
const evidence = 'b'.repeat(64);
const batch = (count = 10) => ({ id: 'approval', campaignId: 'campaign', category: 'link_only', status: 'completed',
  approved_by: 'finance', approved_at: '2026-09-29T23:00:00Z', evidence_fingerprint: original, revision: 54,
  totalHeldCount: 30, maxCases: count,
  caseIds: Array.from({ length: count }, (_, index) => `held-${index}`),
  caseEvidence: Array.from({ length: count }, (_, index) => ({ id: `held-${index}`, category: 'link_only', status: 'needs_decision',
    batchId: 'approval', batchRevision: 54, approvedFingerprint: original, evidenceFingerprint: evidence,
    sourceObject: 'Invoice__c', sourceId: `source-${index}`, sampleKey: `Invoice__c:ACCRECCREDIT:source-${index}`, targetId: `target-${index}` })),
  nextRunForecast: { claimCapacity: count, linkVerificationMode: 'bulk_exact_documents_v1', writeCalls: 0,
    readCalls: 41 + count, verificationCalls: count, recoveryCalls: count, otherActivityCalls: 2,
    callsNeeded: 43 + 3 * count, canProceed: true } });
const select = (value, ids = value.caseIds) => creditRetrySelection(value, new Set(ids), 'finance', 'campaign');

test('retry selection retains original completed approval and rejects mismatched authority', () => {
  const approved = batch();
  assert.deepEqual(select(approved), approved.caseIds);
  for (const changes of [{ campaignId: 'different' }, { approved_by: 'different' }, { approved_at: null },
    { category: 'draft' }, { status: 'running' }, { evidence_fingerprint: 'changed' }, { revision: 55 }]) {
    assert.deepEqual(select({ ...approved, ...changes }), []);
  }
  for (const changes of [{ status: 'ready' }, { batchId: 'other' }, { approvedFingerprint: 'other' },
    { evidenceFingerprint: null }, { sampleKey: 'Invoice__c:ACCREC:source' }, { targetId: null }]) {
    assert.deepEqual(select({ ...approved, caseEvidence: approved.caseEvidence.map((row, index) => index ? row : { ...row, ...changes }) }), []);
  }
});

test('retry chooses only explicit planned held IDs and never broadens loaded ready selection', () => {
  assert.equal(select(batch(25)).length, 25);
  assert.deepEqual(select(batch(26)), []);
  const approved = batch();
  assert.deepEqual(select(approved, []), []);
  assert.deepEqual(select(approved, ['held-0', 'unplanned-held']), []);
  assert.deepEqual(select(approved, ['held-0']), ['held-0']);
  const ready = { id: 'ready', category: 'link_only', status: 'ready', ownerId: 'finance', evidenceFingerprint: evidence };
  assert.deepEqual(select(approved, ['ready']), []);
  assert.deepEqual(selectionFromLoadedRows([ready], new Set(['held-0']), 'link_only', 'finance'), []);
  assert.deepEqual(selectionFromLoadedRows([ready], new Set(['ready']), 'link_only', 'finance'), ['ready']);
});

test('retry uses server planned forecast conservatively and enforces fresh allowance and reserve', () => {
  const now = Date.parse('2026-09-30T05:00:00Z');
  const allowance = { remaining: 284, reserve: 200, reservedCalls: 0, observedAt: new Date(now).toISOString() };
  const ten = creditRetryForecast(batch(), 10);
  assert.equal(ten.callsNeeded, 73);
  assert.deepEqual(creditRetryForecast(batch(), 1), ten);
  assert.equal(creditRetryForecast(batch(), 11), null);
  assert.equal(creditRetryQuotaMessage(allowance, ten, now), null);
  assert.match(creditRetryQuotaMessage(allowance, creditRetryForecast(batch(15), 15), now), /200-call/);
  assert.match(creditRetryQuotaMessage({ ...allowance, reserve: 1, remaining: 250 }, ten, now), /200-call/);
  for (const observedAt of [null, new Date(now - 900001).toISOString(), new Date(now + 1).toISOString()]) {
    assert.match(creditRetryQuotaMessage({ ...allowance, observedAt }, ten, now), /fifteen minutes/);
  }
  assert.equal(creditRetryQuotaMessage({ ...allowance, observedAt: new Date(now - 900000).toISOString() }, ten, now), null);
  assert.equal(creditRetryForecast({ ...batch(), nextRunForecast: { ...ten, callsNeeded: 1 } }, 10), null);
  assert.deepEqual(select({ ...batch(), maxCases: 2 }, ['held-0', 'held-1', 'held-2']), []);
  assert.match(creditRetryQuotaMessage({ ...allowance, retryAt: new Date(now + 1000).toISOString() }, ten, now), /retry time/);
  assert.match(creditRetryQuotaMessage({ ...allowance, reservedCalls: 12 }, ten, now), /200-call/);
});

test('only exact confirmed retry outcomes permit a summary refresh; uncertainty requires recovery', () => {
  const approved = batch(2);
  const response = { batch: { id: approved.id, campaign_id: 'campaign', category: 'link_only', evidence_fingerprint: original,
    revision: 56, status: 'completed' }, outcomes: approved.caseIds.map((caseId) => ({ caseId, status: 'reconciled',
    evidenceFingerprint: evidence, verificationFingerprint: 'c'.repeat(64) })) };
  assert.equal(confirmedCreditRetry(approved, approved.caseIds, response), true);
  const review = { batch: { ...approved, campaign_id: 'campaign' }, revision: approved.revision, retryCaseIds: approved.caseIds, reviewRows: approved.caseEvidence };
  assert.equal(confirmedCreditRecovery(review, response), true);
  assert.equal(confirmedCreditRecovery({ ...review, retryCaseIds: ['held-0'] }, response), false);
  for (const change of [{ id: 'other' }, { revision: 54 }, { status: 'running' }, { evidence_fingerprint: 'changed' }, { campaign_id: 'other' }]) {
    assert.equal(confirmedCreditRetry(approved, approved.caseIds, { ...response, batch: { ...response.batch, ...change } }), false);
  }
  assert.equal(confirmedCreditRetry(approved, approved.caseIds, {}), false);
  assert.equal(confirmedCreditRetry(approved, approved.caseIds, { ...response, outcomes: response.outcomes.slice(1) }), false);
  assert.equal(confirmedCreditRetry(approved, approved.caseIds, { ...response, outcomes: [response.outcomes[0], response.outcomes[0]] }), false);
  assert.equal(confirmedCreditRetry(approved, approved.caseIds, { ...response, outcomes: response.outcomes.map((row) => ({ ...row, caseId: 'unselected' })) }), false);
});

test('retry UI is lazy, explicit and preserves normal Run recovery with one confirmed refresh', async () => {
  const main = await readFile(new URL('../src/components/xero/XeroReconciliationCampaign.jsx', import.meta.url), 'utf8');
  const component = await readFile(new URL('../src/components/xero/XeroCampaignCreditRetry.jsx', import.meta.url), 'utf8');
  const handler = await readFile(new URL('../src/lib/xeroCampaignCreditRetry.js', import.meta.url), 'utf8');
  assert.match(main, /lazy\(\(\) => import\('\.\/XeroCampaignCreditRetry'\)\)/);
  assert.match(main, /setRetryBatches\(data\.retryBatches \|\| \[\]\)/);
  assert.match(handler, /xeroReconciliationCampaignRetry/);
  assert.match(handler, /expectedRevision: batch\.revision, expectedFingerprint: batch\.evidence_fingerprint/);
  assert.doesNotMatch(handler, /CampaignApprove|CampaignPreview/);
  assert.match(main, /requestBusy\.current = true/);
  assert.match(handler, /recoveryPending: true, retryRecovery: true/);
  assert.match(handler, /if \(confirmed\) await load/);
  assert.match(main, /!review\.retryRecovery/);
  assert.match(component, /Retry verified links/);
  assert.doesNotMatch(component, /Select loaded ready|setSelected\(new Set\(rows/);
});

test('retry orchestration invokes once, refreshes confirmed results once and preserves uncertainty', async () => {
  const approved = batch(2);
  const makeContext = (invoke) => {
    const events = [];
    const ctx = { batch: approved, ids: approved.caseIds, retryForecast: approved.nextRunForecast,
      campaign: { id: 'campaign' }, user: { id: 'finance' }, allowance: { remaining: 1000, reserve: 200, observedAt: new Date().toISOString() },
      current: 1, generation: { current: 1 }, mounted: { current: true }, requestBusy: { current: true }, invoke,
      captureAllowance: () => {}, load: async () => events.push(['load']),
      ...Object.fromEntries(['setError', 'setBusy', 'setOutcomes', 'setNotice', 'setUncertainIds', 'setReview', 'setReviewOpen']
        .map((name) => [name, (value) => events.push([name, value])])) };
    return { ctx, events };
  };
  let requests = 0;
  const confirmed = makeContext(async (action, request) => {
    requests += 1; assert.equal(action, 'xeroReconciliationCampaignRetry');
    assert.deepEqual(request.caseIds, approved.caseIds); assert.equal(request.expectedRevision, approved.revision);
    assert.equal(request.expectedFingerprint, original); assert.equal(request.reviewed, undefined);
    return { batch: { id: approved.id, category: 'link_only', revision: 56, status: 'completed', evidence_fingerprint: original },
      outcomes: approved.caseIds.map((caseId) => ({ caseId, evidenceFingerprint: evidence, status: 'needs_decision' })) };
  });
  await retryCampaignCredits(confirmed.ctx);
  assert.equal(requests, 1); assert.equal(confirmed.events.filter(([name]) => name === 'load').length, 1);
  assert.equal(confirmed.events.find(([name]) => name === 'setNotice')[1], '0 credit links verified under the original approval; 2 remain held.');
  const uncertain = makeContext(async () => { requests += 1; throw new Error('Connection lost'); });
  await retryCampaignCredits(uncertain.ctx);
  assert.equal(requests, 2); assert.equal(uncertain.events.filter(([name]) => name === 'load').length, 0);
  const preserved = uncertain.events.find(([name]) => name === 'setReview')[1];
  assert.equal(preserved.evidenceFingerprint, original); assert.equal(preserved.recoveryPending, true);
  assert.equal(preserved.nextRunForecast, null); assert.deepEqual(preserved.caseIds, approved.caseIds);
  assert.equal(uncertain.ctx.requestBusy.current, false);
  const stale = makeContext(async () => { throw new Error('Must not be called'); });
  stale.ctx.allowance.observedAt = new Date(Date.now() - 900001).toISOString();
  await retryCampaignCredits(stale.ctx);
  assert.equal(stale.events.some(([name]) => name === 'setReview'), false);
});

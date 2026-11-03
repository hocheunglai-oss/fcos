import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CAMPAIGN_APPROVAL_LIMIT, amountFor, approvedRunQuotaMessage, firstBatchLimit, nextRunLimit, reviewAfterRun, savedApprovedReview, quotaMessage, runQuotaMessage, selectableCampaignCase, selectionFromLoadedRows } from '../src/lib/xeroReconciliationCampaign.js';

test('campaign selection enforces owner, category, evidence, and separate approval and run limits', () => {
  const row = { id: 'case-1', category: 'link_only', status: 'ready', ownerId: 'operator-1', evidenceFingerprint: 'exact' };
  assert.equal(selectableCampaignCase(row, 'link_only', 'operator-1'), true);
  assert.equal(selectableCampaignCase(row, 'contact', 'operator-1'), false);
  assert.equal(selectableCampaignCase(row, 'link_only', 'other'), false);
  assert.equal(selectableCampaignCase({ ...row, evidenceFingerprint: null }, 'link_only', 'operator-1'), false);
  assert.deepEqual(selectionFromLoadedRows([row], new Set([row.id]), 'link_only', 'operator-1', firstBatchLimit({ verifiedBatchCount: 0 })), ['case-1']);
  assert.equal(firstBatchLimit({ verifiedBatchCount: 1 }), 25);
  assert.equal(amountFor(null, 'USD'), 'Amount unavailable');
});

test('quota presentation treats missing or stale observation and forecast as holds', () => {
  assert.match(quotaMessage(null, null), /not verified/);
  assert.match(quotaMessage({ remaining: 894, reserve: 200, observedAt: '2026-09-29T12:37:54Z' }, null), /forecast/);
  assert.match(quotaMessage({ remaining: 210, reserve: 200, observedAt: '2026-09-29T12:37:54Z' }, { callsNeeded: 20, canProceed: true }), /200-call/);
  assert.equal(quotaMessage({ remaining: 894, reserve: 200, observedAt: '2026-09-29T12:37:54Z' }, { callsNeeded: 47, canProceed: true }), null);
  assert.match(runQuotaMessage({ remaining: 894, reserve: 200, observedAt: '2026-09-29T12:37:54Z' }, { callsNeeded: 25, canProceed: false, reason: 'Exact batch held' }, { canProceed: true }), /Exact batch held/);
  assert.equal(runQuotaMessage({ remaining: 894, reserve: 200, observedAt: '2026-09-29T12:37:54Z' }, { callsNeeded: 25, canProceed: true }, { canProceed: false, reason: 'Different category exceeds capacity' }), null);
});

test('campaign is mounted only after explicit open, and background reconciliation pauses while open', async () => {
  const source = await readFile(new URL('../src/components/xero/XeroFinancialSync.jsx', import.meta.url), 'utf8');
  assert.match(source, /campaignOpen && <Suspense/);
  assert.match(source, /!campaignOpen && !paymentReferenceTarget/);
  assert.match(source, /if \(preservationOpen \|\| requestBusy\.current \|\| correctionsOpen \|\| campaignOpen/);
});


test('consolidated loaded selection allows six through five thousand and rejects oversize approvals', () => {
  const rows = Array.from({ length: CAMPAIGN_APPROVAL_LIMIT + 1 }, (_, index) => ({ id: `case-${index}`, category: 'draft', status: 'ready', ownerId: 'owner', evidenceFingerprint: 'evidence' }));
  assert.equal(selectionFromLoadedRows(rows, new Set(rows.slice(0, 6).map((row) => row.id)), 'draft', 'owner').length, 6);
  assert.equal(selectionFromLoadedRows(rows, new Set(rows.slice(0, CAMPAIGN_APPROVAL_LIMIT).map((row) => row.id)), 'draft', 'owner').length, CAMPAIGN_APPROVAL_LIMIT);
  assert.deepEqual(selectionFromLoadedRows(rows, new Set(rows.map((row) => row.id)), 'draft', 'owner'), []);
});

test('partial runs retain exact approval and revision while uncertain responses preserve recovery', () => {
  const review = { approved: true, caseIds: ['a', 'b', 'c', 'd', 'e', 'f'], evidenceFingerprint: 'exact', revision: 2, batch: { id: 'batch', verified_count: 0 } };
  assert.equal(nextRunLimit(review), 5);
  const partial = reviewAfterRun(review, { batch: { id: 'batch', revision: 4, status: 'partial', verified_count: 5 }, nextRunForecast: { callsNeeded: 10 } });
  assert.equal(partial.approved, true); assert.equal(partial.revision, 4); assert.equal(partial.evidenceFingerprint, 'exact');
  assert.equal(nextRunLimit(partial), 25);
  assert.equal(reviewAfterRun(partial, { batch: { id: 'batch', revision: 6, status: 'completed' } }), null);
  assert.equal(reviewAfterRun(partial, {}).recoveryPending, true);
  assert.equal(reviewAfterRun(partial, { batch: { id: 'other', revision: 6, status: 'completed' } }).recoveryPending, true);
  assert.equal(reviewAfterRun(partial, { batch: { id: 'batch', revision: 6, status: 'preview' } }).approved, false);
});

test('read restores only persisted exact approvals and keeps recovery quota holds visible', () => {
  const batch = { id: 'batch', revision: 3, status: 'running', case_ids: ['a'], evidence_fingerprint: 'exact', category: 'link_only', forecast: { callsNeeded: 5000, canProceed: true }, nextRunForecast: { callsNeeded: 10, canProceed: true } };
  const restored = savedApprovedReview(batch);
  const { nextRunForecast: _nextRunForecast, ...rawBatch } = batch;
  assert.equal(savedApprovedReview(rawBatch, restored).nextRunForecast.callsNeeded, 10);
  assert.equal(savedApprovedReview(rawBatch).forecast, null);
  assert.equal(restored.approved, true); assert.equal(restored.recoveryPending, true); assert.equal(restored.revision, 3);
  assert.equal(savedApprovedReview({ ...batch, status: 'preview' }), null);
  const allowance = { remaining: 800, reserve: 200, observedAt: '2026-09-29T12:00:00Z', unresolvedWrites: 1, holdReason: 'A previous Xero write has an uncertain outcome.' };
  assert.equal(approvedRunQuotaMessage(allowance, restored, { canProceed: true }), null);
  assert.match(approvedRunQuotaMessage({ ...allowance, dailyHold: true }, restored, { canProceed: true }), /uncertain/);
  assert.match(approvedRunQuotaMessage({ ...allowance, remaining: 205 }, restored, { canProceed: true }), /200-call/);
  assert.match(approvedRunQuotaMessage({ ...allowance, holdReason: 'Another financial operation is active.' }, restored, { canProceed: true }), /Another financial/);
  assert.match(approvedRunQuotaMessage({ ...allowance, reservedCalls: 600 }, restored, { canProceed: true }), /200-call/);
});

const linkIds = Array.from({ length: 60 }, (_, index) => `link-${index}`);
const linkAllowance = { remaining: 900, reservedCalls: 0, reserve: 200, observedAt: '2026-09-30T00:00:00Z' };
const linkForecast = { canProceed: true, callsNeeded: 30 };
const linkReview = () => ({ category: 'link_only', approved: true, caseIds: [...linkIds], evidenceFingerprint: 'exact-links', revision: 2,
  nextRunForecast: linkForecast, batch: { id: 'links', campaign_id: 'campaign', category: 'link_only', case_ids: [...linkIds], evidence_fingerprint: 'exact-links', revision: 2, status: 'approved', verified_count: 0 } });
const linkResponse = (state, ids, overrides = {}) => ({ batch: { ...state.review.batch, revision: state.review.revision + 2, status: 'partial',
  verified_count: Number(state.review.batch.verified_count) + ids.length }, outcomes: ids.map((caseId) => ({ caseId, status: 'reconciled' })),
  allowance: linkAllowance, nextRunForecast: linkForecast, ...overrides });
const linkContext = (state, overrides = {}) => ({ campaignId: 'campaign', review: state.review, enabled: true, connected: true, allowance: linkAllowance, ...overrides });

test('approved links require an explicit exact link-only approval and reject changed identity', async () => {
  const { approvedLinkRunIdentity, approvedLinkRunStopReason, startApprovedLinkRun } = await import('../src/lib/xeroReconciliationCampaign.js');
  const review = linkReview();
  const state = startApprovedLinkRun('campaign', review);
  assert.equal(state.status, 'running');
  for (const changed of [{ approved: false }, { recoveryPending: true }, { invalidated: true }, { category: 'draft' }]) assert.equal(startApprovedLinkRun('campaign', { ...review, ...changed }), null);
  assert.equal(startApprovedLinkRun('campaign', { ...review, batch: { ...review.batch, status: 'running' } }), null);
  assert.equal(approvedLinkRunIdentity('campaign', { ...review, caseIds: [...review.caseIds].reverse() }), state.identity);
  for (const changes of [
    { campaignId: 'other' },
    { review: { ...review, evidenceFingerprint: 'other' } },
    { review: { ...review, batch: { ...review.batch, id: 'other' } } },
    { review: { ...review, caseIds: review.caseIds.slice(1) } },
    { review: { ...review, revision: 10 } },
    { review: { ...review, batch: { ...review.batch, evidence_fingerprint: 'changed' } } },
  ]) assert.match(approvedLinkRunStopReason(state, linkContext(state, changes)), /changed/);
});

test('continuous progression retains the representative five gate and then allows bounded 25 requests', async () => {
  const { startApprovedLinkRun, advanceApprovedLinkRun, approvedLinkRunStopReason } = await import('../src/lib/xeroReconciliationCampaign.js');
  let state = startApprovedLinkRun('campaign', linkReview());
  assert.equal(nextRunLimit(state.review), 5);
  state = advanceApprovedLinkRun(state, linkResponse(state, linkIds.slice(0, 5)));
  assert.equal(state.status, 'running'); assert.equal(state.requests, 1); assert.equal(state.processedIds.length, 5);
  assert.equal(state.review.revision, 4); assert.equal(nextRunLimit(state.review), 25);
  assert.equal(approvedLinkRunStopReason(state, linkContext(state)), null);
  state = advanceApprovedLinkRun(state, linkResponse(state, linkIds.slice(5, 30)));
  assert.equal(state.status, 'running'); assert.equal(state.processedIds.length, 30);
  const finish = linkResponse(state, linkIds.slice(30, 55));
  finish.batch.status = 'completed';
  state = advanceApprovedLinkRun(state, finish);
  assert.equal(state.status, 'completed'); assert.equal(state.review, null); assert.equal(state.requests, 3);
});

test('held changed cases can advance independently ready links while the five gate stays enforced', async () => {
  const { startApprovedLinkRun, advanceApprovedLinkRun } = await import('../src/lib/xeroReconciliationCampaign.js');
  let state = startApprovedLinkRun('campaign', linkReview());
  const response = linkResponse(state, linkIds.slice(0, 5));
  response.outcomes[0].status = 'needs_decision'; response.outcomes[1].status = 'waiting_dependency'; response.batch.verified_count = 3;
  state = advanceApprovedLinkRun(state, response);
  assert.equal(state.status, 'running'); assert.equal(state.processedIds.length, 5); assert.equal(nextRunLimit(state.review), 2);
  state = advanceApprovedLinkRun(state, linkResponse(state, linkIds.slice(5, 7)));
  assert.equal(nextRunLimit(state.review), 25); assert.equal(state.status, 'running');
});

test('an exact 607-link approval progresses to completion in 26 sequential bounded responses', async () => {
  const { startApprovedLinkRun, advanceApprovedLinkRun, approvedLinkRunStopReason } = await import('../src/lib/xeroReconciliationCampaign.js');
  const review = linkReview();
  review.caseIds = Array.from({ length: 607 }, (_, index) => `approved-${index}`);
  review.batch.case_ids = [...review.caseIds];
  let state = startApprovedLinkRun('campaign', review);
  let cursor = 0;
  const sizes = [];
  while (state.status === 'running') {
    assert.equal(approvedLinkRunStopReason(state, linkContext(state)), null);
    const limit = nextRunLimit(state.review);
    const ids = review.caseIds.slice(cursor, cursor + limit);
    sizes.push(ids.length); cursor += ids.length;
    const response = linkResponse(state, ids);
    if (cursor === review.caseIds.length) response.batch.status = 'completed';
    state = advanceApprovedLinkRun(state, response);
  }
  assert.equal(state.status, 'completed'); assert.equal(state.processedIds.length, 607); assert.equal(state.requests, 26);
  assert.equal(sizes[0], 5); assert.equal(sizes.at(-1), 2); assert.equal(sizes.slice(1, -1).every((size) => size === 25), true);
});

test('Stop, unmount, permission and connection changes end continuous progression at a batch boundary', async () => {
  const { startApprovedLinkRun, approvedLinkRunStopReason } = await import('../src/lib/xeroReconciliationCampaign.js');
  const state = startApprovedLinkRun('campaign', linkReview());
  assert.match(approvedLinkRunStopReason(state, linkContext(state, { stopRequested: true })), /Stopped after the current atomic batch/);
  assert.match(approvedLinkRunStopReason(state, linkContext(state, { mounted: false })), /closed/);
  assert.match(approvedLinkRunStopReason(state, linkContext(state, { enabled: false })), /permission/);
  assert.match(approvedLinkRunStopReason(state, linkContext(state, { connected: false })), /connection/);
});

test('no progress, missing forecasts, quota reserve and provider holds stop without automatic retry', async () => {
  const { startApprovedLinkRun, advanceApprovedLinkRun } = await import('../src/lib/xeroReconciliationCampaign.js');
  const initial = startApprovedLinkRun('campaign', linkReview());
  const state = advanceApprovedLinkRun(initial, linkResponse(initial, linkIds.slice(0, 5)));
  const repeated = linkResponse(state, linkIds.slice(0, 5)); repeated.batch.verified_count = 5;
  assert.match(advanceApprovedLinkRun(state, repeated).reason, /No new case/);
  assert.match(advanceApprovedLinkRun(state, linkResponse(state, [], { batch: { ...state.review.batch, revision: 6 } })).reason, /No new case/);
  for (const response of [
    linkResponse(state, linkIds.slice(5, 30), { nextRunForecast: null }),
    linkResponse(state, linkIds.slice(5, 30), { allowance: { ...linkAllowance, remaining: 229 } }),
    linkResponse(state, linkIds.slice(5, 30), { allowance: { ...linkAllowance, holdReason: 'Database or auth failure' } }),
    linkResponse(state, linkIds.slice(5, 30), { allowance: null }),
  ]) { const stopped = advanceApprovedLinkRun(state, response); assert.equal(stopped.status, 'stopped'); assert.equal(stopped.review.recoveryPending, false); }
});

test('uncertain, mismatched, stale and oversized responses require explicit claimed-batch recovery', async () => {
  const { startApprovedLinkRun, advanceApprovedLinkRun, stopApprovedLinkRun } = await import('../src/lib/xeroReconciliationCampaign.js');
  const state = startApprovedLinkRun('campaign', linkReview());
  const good = linkResponse(state, linkIds.slice(0, 5));
  for (const data of [ {},
    { ...good, batch: { ...good.batch, id: 'other' } },
    { ...good, batch: { ...good.batch, campaign_id: 'other' } },
    { ...good, batch: { ...good.batch, evidence_fingerprint: 'changed' } },
    { ...good, batch: { ...good.batch, case_ids: linkIds.slice(1) } },
    { ...good, batch: { ...good.batch, category: 'draft' } },
    { ...good, batch: { ...good.batch, revision: state.review.revision } },
    { ...good, batch: { ...good.batch, status: 'running' } },
    { ...good, outcomes: [{ caseId: linkIds[0], status: 'uncertain' }] },
    linkResponse(state, linkIds.slice(0, 6)),
    { ...good, outcomes: [{ caseId: 'unapproved', status: 'reconciled' }] },
  ]) { const stopped = advanceApprovedLinkRun(state, data); assert.equal(stopped.status, 'stopped'); assert.equal(stopped.review.recoveryPending, true); }
  const failed = stopApprovedLinkRun(state, 'Transport/auth/database failure', true);
  assert.equal(failed.status, 'stopped'); assert.equal(failed.review.recoveryPending, true); assert.equal(failed.review.batch.id, state.review.batch.id);
});

test('approved modal rows prefer durable evidence over loaded filter results and preserve exact IDs', async () => {
  const { approvedReviewRows, savedApprovedReview } = await import('../src/lib/xeroReconciliationCampaign.js');
  const batch = { ...linkReview().batch, caseEvidence: [{ id: linkIds[0], title: 'Saved invoice', accountName: 'Approved account', sourceId: 'SF', targetId: 'Xero' }] };
  const restored = savedApprovedReview(batch);
  const rows = approvedReviewRows({ ...restored, reviewRows: [{ id: linkIds[0], title: 'Older loaded title' }] });
  assert.equal(rows[0].title, 'Saved invoice'); assert.equal(rows[0].accountName, 'Approved account'); assert.equal(rows.length, linkIds.length);
  assert.deepEqual(rows[1], { id: linkIds[1] });
});

test('continuous link UI uses explicit start and Stop and refreshes the summary only after a confirmed end', async () => {
  const source = await readFile(new URL('../src/components/xero/XeroReconciliationCampaign.jsx', import.meta.url), 'utf8');
  const run = source.slice(source.indexOf('  const run = async'), source.indexOf('  const stopRun ='));
  assert.match(source, /Run approved links/); assert.match(source, /Stop after this batch/);
  assert.match(run, /activeRun\.current \|\|/); assert.match(run, /requestBusy\.current = true/);
  const requestLoop = run.slice(run.indexOf('      do {'), run.indexOf('    } catch (failure)'));
  assert.doesNotMatch(requestLoop, /await load\(/); assert.doesNotMatch(run, /setSelected\(new Set/);
  assert.match(run, /if \(confirmedEnd \|\| retryRecoveryConfirmed\) await load\(\{ id: campaignId, preserveInteraction: true \}\)/);
  assert.match(source, /!append && !preserveInteraction/);
  assert.match(run, /advanceApprovedLinkRun\(state, data\)/);
  assert.match(source, /approvedReviewRows\(review\)\.map/);
  assert.doesNotMatch(source, /cases\.find\(\(item\) => item\.id === id\)/);
});

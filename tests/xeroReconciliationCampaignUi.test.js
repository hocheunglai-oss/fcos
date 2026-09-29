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

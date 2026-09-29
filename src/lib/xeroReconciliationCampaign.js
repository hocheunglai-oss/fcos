export const CAMPAIGN_CATEGORIES = [
  { id: 'all', label: 'All cases' },
  { id: 'link_only', label: 'Link verified records' },
  { id: 'contact', label: 'Contact identity' },
  { id: 'draft', label: 'New drafts' },
  { id: 'decision', label: 'Owner decisions' },
  { id: 'correction_deferred', label: 'Deferred corrections' },
  { id: 'legacy_excluded', label: 'Legacy excluded' },
  { id: 'future_activity', label: 'Future activity' },
];
export const CAMPAIGN_STATUSES = [
  { id: 'all', label: 'All statuses' },
  { id: 'needs_decision', label: 'Needs decision' },
  { id: 'ready', label: 'Ready to review' },
  { id: 'waiting_dependency', label: 'Waiting for evidence' },
  { id: 'reconciled', label: 'Reconciled' },
  { id: 'legacy_excluded', label: 'Legacy excluded' },
  { id: 'future_activity', label: 'Future activity' },
];
export const REVIEW_CATEGORIES = new Set(['link_only', 'contact', 'draft']);
export const CAMPAIGN_RESERVE = 200;
export const CAMPAIGN_APPROVAL_LIMIT = 5000;
export const labelFor = (id, choices) => choices.find((item) => item.id === id)?.label || String(id || 'Unknown').replaceAll('_', ' ');
export const amountFor = (value, currency) => {
  if (value == null || value === '') return 'Amount unavailable';
  const number = Number(value);
  return Number.isFinite(number) ? `${currency || ''} ${number.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim() : 'Amount unavailable';
};
export function firstBatchLimit(campaign) {
  return campaign?.verifiedBatchCount > 0 || campaign?.firstBatchVerified === true ? 25 : 5;
}
export function quotaMessage(allowance, forecast) {
  const remaining = allowance?.remaining;
  const reserve = allowance?.reserve ?? CAMPAIGN_RESERVE;
  const observedAt = allowance?.observedAt;
  const forecastCalls = forecast?.callsNeeded == null ? NaN : Number(forecast.callsNeeded);
  if (allowance?.holdReason) return allowance.holdReason;
  if (remaining == null || !Number.isFinite(Number(remaining)) || !observedAt) return 'Xero allowance is not verified. Check the connection before running an approved batch.';
  if (!Number.isFinite(forecastCalls) || forecast?.canProceed !== true) return forecast?.reason || 'A verified call forecast is required before running an approved batch.';
  if (Number(remaining) - Number(allowance?.reservedCalls || 0) - forecastCalls < reserve) return 'This batch would cross the 200-call Xero reserve. Continue after verified capacity returns.';
  return null;
}
export function selectableCampaignCase(row, category, ownerId) {
  return REVIEW_CATEGORIES.has(category)
    && row?.category === category
    && row.status === 'ready'
    && Boolean(row.evidenceFingerprint)
    && Boolean(ownerId)
    && row.ownerId === ownerId;
}
export function selectionFromLoadedRows(rows, selected, category, ownerId, maximum = CAMPAIGN_APPROVAL_LIMIT) {
  const allowed = rows.filter((row) => selected.has(row.id) && selectableCampaignCase(row, category, ownerId));
  return allowed.length > 0 && allowed.length <= maximum ? allowed.map((row) => row.id) : [];
}

/** Re-evaluate a saved batch estimate against the newest observed allowance. */
export function runQuotaMessage(allowance, batchForecast, currentForecast) {
  if (batchForecast?.recovery && allowance?.unresolvedWrites > 0 && allowance?.dailyHold !== true
    && !(Date.parse(allowance?.retryAt || '') > Date.now())) {
    return quotaMessage({ ...allowance, holdReason: null,
      reservedCalls: Math.max(0, Number(allowance.reservedCalls || 0) - Number(batchForecast.ownReservation || 0)) }, batchForecast);
  }
  if (!batchForecast) return quotaMessage(allowance, currentForecast);
  return quotaMessage(allowance, batchForecast);
}

/** Keep an exact approval across bounded runs; uncertain responses require explicit recovery. */
export function reviewAfterRun(review, data) {
  const batch = data?.batch;
  if (!batch || batch.id !== review?.batch?.id || !Number.isInteger(Number(batch.revision))) {
    return { ...review, recoveryPending: true };
  }
  if (batch.evidence_fingerprint && batch.evidence_fingerprint !== review.evidenceFingerprint) return { ...review, approved: false, invalidated: true };
  if (batch.status === 'completed') return null;
  if (!['approved', 'partial', 'running'].includes(batch.status)) {
    return { ...review, approved: false, invalidated: true, batch: { ...review.batch, ...batch }, revision: Number(batch.revision) };
  }
  return { ...review, batch: { ...review.batch, ...batch }, revision: Number(batch.revision),
    nextRunForecast: data.nextRunForecast ?? null,
    recoveryPending: batch.status === 'running' };
}

export function nextRunLimit(review, campaign) {
  const count = Number(review?.batch?.verified_count ?? review?.batch?.verifiedCount);
  if (!Number.isFinite(count)) return Math.min(5, review?.caseIds?.length || firstBatchLimit(campaign));
  const first = Math.min(5, review?.caseIds?.length || 5);
  return count < first ? first - count : 25;
}

/** Restore only persisted approvals; reading never grants or executes approval. */
export function savedApprovedReview(batch, previous = null) {
  if (!batch?.id || !['approved', 'partial', 'running'].includes(batch.status)
    || !Number.isInteger(Number(batch.revision)) || !batch.evidence_fingerprint
    || !Array.isArray(batch.case_ids) || !batch.case_ids.length) return previous;
  const unchanged = previous?.batch?.id === batch.id && previous?.evidenceFingerprint === batch.evidence_fingerprint;
  return { ...(unchanged ? previous : {}), batch,
    category: batch.category, caseIds: batch.case_ids, evidenceFingerprint: batch.evidence_fingerprint,
    revision: Number(batch.revision), approved: true, recoveryPending: batch.status === 'running',
    approvalForecast: batch.approvalForecast || batch.forecast,
    nextRunForecast: batch.nextRunForecast || (unchanged ? previous.nextRunForecast : null),
    forecast: batch.nextRunForecast || (unchanged ? previous.forecast : null) };
}

export function approvedRunQuotaMessage(allowance, review, currentForecast) {
  const recovery = review?.recoveryPending === true;
  if (allowance?.dailyHold || Date.parse(allowance?.retryAt || '') > Date.now()) return allowance?.holdReason || 'Xero capacity is on hold. Wait until the verified retry time.';
  const recoveryOnlyHold = recovery && ['A previous Xero write has an uncertain outcome.', null, undefined].includes(allowance?.holdReason) && Number(allowance?.unresolvedWrites) > 0 && !allowance?.dailyHold
    && !(Date.parse(allowance?.retryAt || '') > Date.now());
  return runQuotaMessage(recoveryOnlyHold ? { ...allowance, holdReason: null } : allowance,
    review?.nextRunForecast || review?.forecast, currentForecast);
}

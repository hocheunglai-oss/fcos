import { CAMPAIGN_RESERVE, amountFor, quotaMessage } from './xeroCampaignQuota.js';
export { CAMPAIGN_RESERVE, amountFor, quotaMessage };

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
export const CAMPAIGN_APPROVAL_LIMIT = 5000;
export const labelFor = (id, choices) => choices.find((item) => item.id === id)?.label || String(id || 'Unknown').replaceAll('_', ' ');
export function firstBatchLimit(campaign) {
  return campaign?.verifiedBatchCount > 0 || campaign?.firstBatchVerified === true ? 25 : 5;
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
    forecast: data.nextRunForecast ?? null,
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

/** A continuous run belongs to one exact, already-approved link-only selection. */
export function approvedLinkRunIdentity(campaignId, review) {
  if (!campaignId || !review?.batch?.id || !review.evidenceFingerprint || review.category !== 'link_only'
    || !Array.isArray(review.caseIds) || !review.caseIds.length) return null;
  if (review.batch.category && review.batch.category !== review.category
    || review.batch.campaign_id && review.batch.campaign_id !== campaignId
    || review.batch.evidence_fingerprint && review.batch.evidence_fingerprint !== review.evidenceFingerprint
    || review.batch.case_ids && JSON.stringify([...review.batch.case_ids].sort()) !== JSON.stringify([...review.caseIds].sort())) return null;
  return JSON.stringify([campaignId, review.batch.id, review.evidenceFingerprint, review.category, [...review.caseIds].sort()]);
}

export function startApprovedLinkRun(campaignId, review) {
  const identity = approvedLinkRunIdentity(campaignId, review);
  if (!identity || !review.approved || review.invalidated || review.recoveryPending
    || !['approved', 'partial'].includes(review.batch.status) || !Number.isSafeInteger(review.revision)) return null;
  return { identity, review, processedIds: [], requests: 0, status: 'running', reason: null };
}

export function approvedLinkRunStopReason(state, { campaignId, review, enabled, connected, mounted = true, stopRequested = false, allowance }) {
  if (!mounted) return 'The campaign was closed. No further batch will start.';
  if (stopRequested) return 'Stopped after the current atomic batch.';
  if (!enabled || !connected) return 'The connection or action permission changed. Verify it before continuing.';
  if (approvedLinkRunIdentity(campaignId, review) !== state.identity) return 'The campaign or exact approval changed. Start again after reviewing the current batch.';
  if (!review.approved || review.invalidated || review.recoveryPending || !['approved', 'partial'].includes(review.batch.status)) return 'The approval needs review or explicit claimed-batch recovery.';
  if (review.revision !== state.review.revision) return 'The batch revision changed outside this run. Read it back before continuing.';
  // Never substitute another category's forecast or the original full-approval estimate.
  return approvedRunQuotaMessage(allowance, { ...review, forecast: null }, null);
}

export function stopApprovedLinkRun(state, reason, uncertain = false) {
  return { ...state, status: 'stopped', reason,
    review: uncertain ? { ...state.review, recoveryPending: true } : state.review };
}

/** Advance only from an authoritative, bounded, confirmed response; never retry uncertainty. */
export function advanceApprovedLinkRun(state, data) {
  const batch = data?.batch;
  const previous = state.review;
  const uncertain = (reason) => stopApprovedLinkRun(state, reason, true);
  if (!batch || data.campaign?.id && approvedLinkRunIdentity(data.campaign.id, previous) !== state.identity
    || batch.id !== previous.batch.id || batch.evidence_fingerprint !== previous.evidenceFingerprint
    || batch.category !== previous.category || batch.campaign_id && approvedLinkRunIdentity(batch.campaign_id, previous) !== state.identity
    || !Array.isArray(batch.case_ids) || JSON.stringify([...batch.case_ids].sort()) !== JSON.stringify([...previous.caseIds].sort())) {
    return uncertain('The returned campaign or exact batch evidence could not be confirmed. Read back the claimed batch.');
  }
  if (!Number.isSafeInteger(Number(batch.revision)) || Number(batch.revision) <= previous.revision) {
    return uncertain('The batch revision did not advance. Read back the claimed batch before further action.');
  }
  const nextReview = reviewAfterRun(previous, data);
  if (batch.status === 'running' || nextReview?.recoveryPending) return { ...uncertain('The claimed batch needs explicit readback recovery.'), review: nextReview || previous };
  if (nextReview && (!nextReview.approved || nextReview.invalidated)) return stopApprovedLinkRun({ ...state, review: nextReview }, 'The batch is no longer eligible under this approval. Review the held cases.');
  const outcomes = data.outcomes;
  const previousVerified = Number(previous.batch.verified_count ?? previous.batch.verifiedCount ?? 0);
  const verified = Number(batch.verified_count ?? batch.verifiedCount);
  if (!Array.isArray(outcomes) || outcomes.length > nextRunLimit(previous)
    || !Number.isSafeInteger(verified) || verified < previousVerified || verified > previous.caseIds.length || verified - previousVerified > outcomes.length
    || outcomes.some((row) => !previous.caseIds.includes(row.caseId) || !['reconciled', 'needs_decision', 'waiting_dependency'].includes(row.status))
    || new Set(outcomes.map((row) => row.caseId)).size !== outcomes.length) return uncertain('The batch outcomes are incomplete or uncertain. Read back the existing claim.');
  const progressed = outcomes.filter((row) => !state.processedIds.includes(row.caseId));
  if (!progressed.length) return stopApprovedLinkRun({ ...state, review: nextReview || previous }, 'No new case outcomes were confirmed. Read back the batch before another run.');
  const next = { ...state, review: nextReview, requests: state.requests + 1,
    processedIds: [...state.processedIds, ...progressed.map((row) => row.caseId)] };
  if (!nextReview) return { ...next, status: 'completed', reason: 'The approved batch is complete. Review any held outcomes.' };
  const hold = approvedRunQuotaMessage(data.allowance, { ...nextReview, forecast: null }, null);
  return hold ? stopApprovedLinkRun(next, hold) : { ...next, status: 'running', reason: null };
}

/** Prefer persisted human evidence; a filtered case list is never the approval's identity. */
export function approvedReviewRows(review) {
  const evidence = review?.caseEvidence || review?.batch?.caseEvidence || review?.batch?.case_evidence || review?.batch?.evidence || [];
  const rows = new Map((Array.isArray(evidence) ? evidence : []).map((row) => [row.id || row.caseId, row]));
  for (const row of review?.reviewRows || []) rows.set(row.id, { ...row, ...rows.get(row.id) });
  for (const diff of review?.diffs || []) {
    const previous = rows.get(diff.caseId) || {};
    rows.set(diff.caseId, { ...previous, title: previous.title || diff.caseTitle });
  }
  return (review?.caseIds || []).map((id) => ({ ...rows.get(id), id }));
}

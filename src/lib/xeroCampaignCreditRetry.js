import { CAMPAIGN_RESERVE, quotaMessage } from './xeroCampaignQuota.js';
const MUTATION_OPTIONS = { force: true, cache: false, invalidateCache: true };

/** Held-credit retries retain one completed human approval; ready selections are unrelated. */
export function creditRetrySelection(batch, selected, ownerId, campaignId) {
  if (!batch?.id || batch.campaignId !== campaignId || batch.category !== 'link_only' || batch.status !== 'completed'
    || batch.approved_by !== ownerId || !ownerId || !batch.approved_at || !batch.evidence_fingerprint
    || !Number.isSafeInteger(batch.revision) || !Array.isArray(batch.caseIds) || !Array.isArray(batch.caseEvidence)
    || !Number.isSafeInteger(batch.maxCases) || batch.maxCases < 1 || batch.maxCases > 25
    || !(selected instanceof Set) || selected.size < 1 || selected.size > batch.maxCases) return [];
  const evidence = new Map(batch.caseEvidence.map((row) => [row.id, row]));
  if (evidence.size !== batch.caseEvidence.length || new Set(batch.caseIds).size !== batch.caseIds.length) return [];
  for (const id of selected) {
    const row = evidence.get(id);
    if (!batch.caseIds.includes(id) || !row || row.batchId !== batch.id || row.batchRevision !== batch.revision
      || row.approvedFingerprint !== batch.evidence_fingerprint || !row.evidenceFingerprint
      || row.category !== 'link_only' || !['needs_decision', 'waiting_dependency'].includes(row.status)
      || !['Invoice__c', 'Supplier_Invoice__c'].includes(row.sourceObject)
      || !['ACCRECCREDIT', 'ACCPAYCREDIT'].includes(String(row.sampleKey || '').split(':')[1]) || !row.targetId) return [];
  }
  return [...selected];
}

/** Keep the server's bounded planned-prefix allowance for smaller explicit selections. */
export function creditRetryForecast(batch, count) {
  const forecast = batch?.nextRunForecast;
  const capacity = forecast?.claimCapacity;
  if (!Number.isSafeInteger(count) || count < 1 || count > 25 || !Number.isSafeInteger(capacity) || count > capacity
    || forecast?.linkVerificationMode !== 'bulk_exact_documents_v1' || forecast.writeCalls !== 0
    || forecast.verificationCalls !== capacity || forecast.recoveryCalls !== capacity
    || !Number.isSafeInteger(forecast.readCalls) || forecast.readCalls < capacity
    || !Number.isSafeInteger(forecast.otherActivityCalls) || forecast.otherActivityCalls < 0
    || !Number.isSafeInteger(forecast.callsNeeded) || forecast.callsNeeded !== forecast.readCalls
      + forecast.verificationCalls + forecast.recoveryCalls + forecast.otherActivityCalls) return null;
  return forecast;
}

export function creditRetryQuotaMessage(allowance, forecast, now = Date.now()) {
  const observed = Date.parse(allowance?.observedAt || '');
  if (!Number.isFinite(observed) || now < observed || now - observed > 15 * 60 * 1000) return 'Check the Xero connection for an allowance observed within the last fifteen minutes.';
  if (allowance?.dailyHold || Date.parse(allowance?.retryAt || '') > now) return allowance?.holdReason || 'Wait for the verified Xero retry time.';
  return quotaMessage({ ...allowance, reserve: Math.max(CAMPAIGN_RESERVE, Number(allowance?.reserve || 0)) }, forecast);
}

/** A response confirms only the selected retry; malformed or missing evidence needs Run recovery. */
export function confirmedCreditRetry(batch, caseIds, data) {
  const result = data?.batch;
  const indexed = new Map((batch?.caseEvidence || []).map((row) => [row.id, row]));
  return Boolean(result?.id === batch?.id && result.evidence_fingerprint === batch.evidence_fingerprint
    && result.category === 'link_only' && (!result.campaign_id || result.campaign_id === batch.campaignId)
    && Number.isSafeInteger(result.revision) && result.revision > batch.revision
    && ['completed', 'partial'].includes(result.status) && Array.isArray(data.outcomes)
    && data.outcomes.length === caseIds.length && new Set(data.outcomes.map((row) => row.caseId)).size === caseIds.length
    && data.outcomes.every((row) => caseIds.includes(row.caseId) && row.evidenceFingerprint === indexed.get(row.caseId)?.evidenceFingerprint
      && ['reconciled', 'needs_decision', 'waiting_dependency'].includes(row.status)
      && (row.status !== 'reconciled' || /^[a-f0-9]{64}$/.test(row.verificationFingerprint || ''))));
}

export function confirmedCreditRecovery(review, data) {
  return confirmedCreditRetry({ ...review.batch, campaignId: review.batch.campaign_id,
    revision: review.revision, caseEvidence: review.reviewRows || [] }, review.retryCaseIds || [], data);
}

export async function retryCampaignCredits({ batch, ids, retryForecast, campaign, user, allowance, current, generation, mounted, requestBusy, invoke, captureAllowance, load, setError, setBusy, setOutcomes, setNotice, setUncertainIds, setReview, setReviewOpen }) {
  let confirmed = false;
  let submitted = false;
  try {
    const exact = creditRetrySelection(batch, new Set(ids), user?.id, campaign.id);
    if (!exact.length || exact.length !== ids.length || creditRetryQuotaMessage(allowance, retryForecast)) throw new Error('Retry evidence or allowance changed. Read the saved campaign and check the connection.');
    submitted = true;
    const data = await invoke('xeroReconciliationCampaignRetry', { campaignId: campaign.id, batchId: batch.id,
      caseIds: exact, expectedRevision: batch.revision, expectedFingerprint: batch.evidence_fingerprint }, MUTATION_OPTIONS);
    if (!mounted.current || current !== generation.current) return;
    captureAllowance(data);
    if (!confirmedCreditRetry(batch, exact, data)) throw new Error('The exact retry outcomes could not be confirmed.');
    const linked = data.outcomes.filter((row) => row.status === 'reconciled').length;
    confirmed = true; setOutcomes(data.outcomes); setNotice(`${linked} credit links verified under the original approval; ${data.outcomes.length - linked} remain held.`);
    setUncertainIds((previous) => new Set([...previous].filter((id) => !exact.includes(id))));
  } catch (failure) {
    if (mounted.current && current === generation.current) {
      setError(`${failure.message} Refresh saved cases and use Recover claimed batch if a claim is running. No automatic retry occurs.`);
      if (!submitted || ['XERO_CAMPAIGN_BATCH_CHANGED', 'XERO_CAMPAIGN_CASE_CHANGED', 'XERO_CAMPAIGN_ALLOWANCE_HOLD', 'XERO_CAMPAIGN_TENANT_CHANGED'].includes(failure.code)) return;
      setUncertainIds((previous) => new Set([...previous, ...ids]));
      setReview({ batch: { id: batch.id, category: 'link_only', campaign_id: campaign.id, case_ids: ids,
        evidence_fingerprint: batch.evidence_fingerprint, revision: batch.revision, status: 'running' },
      category: 'link_only', caseIds: ids, evidenceFingerprint: batch.evidence_fingerprint, revision: batch.revision,
      approved: true, recoveryPending: true, retryRecovery: true, retryCaseIds: ids, reviewRows: batch.caseEvidence.filter((row) => ids.includes(row.id)), nextRunForecast: null, forecast: null });
      setReviewOpen(true);
    }
  } finally {
    requestBusy.current = false;
    if (mounted.current && current === generation.current) {
      if (confirmed) await load({ id: campaign.id, preserveInteraction: true });
      else setBusy('');
    }
  }
}

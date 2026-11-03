import { createRoot } from 'react-dom/client';
import XeroReconciliationCampaign from '@/components/xero/XeroReconciliationCampaign';
import { appClient } from '@/api/appClient';
import '@/styles/fonts.css';
import '@/index.css';
const params = new URLSearchParams(location.search);
const link = (index) => ({ id: `link-${index}`, caseKey: `LINK-${index}`, category: 'link_only', status: 'ready', title: `HK2620${index}T · Fixture vessel`, documentNumber: `SF-INV-${index}`, accountName: 'Synthetic Shipping Ltd', sourceId: `sf-${index}`, targetId: `xero-${index}`, ownerId: 'operator-1', ownerName: 'Current operator', currency: 'USD', total: 120000 + index, evidenceFingerprint: `fingerprint-${index}`, reason: 'Exact identity, currency, and amount verified.' });
const seed = [
  ...Array.from({ length: 60 }, (_, index) => link(index + 1)),
  { ...link(61), id: 'contact-1', category: 'contact', reason: 'Verified contact association required.' },
  { ...link(62), id: 'draft-1', category: 'draft', targetId: null, reason: 'No existing Xero document.' },
  { ...link(63), id: 'decision-1', category: 'decision', status: 'needs_decision', evidenceFingerprint: null, reason: 'Accounting treatment requires operator decision.' },
  { ...link(64), id: 'decision-2', category: 'decision', status: 'needs_decision', evidenceFingerprint: null, reason: 'Missing issued source evidence.' },
];
window.campaignFixture = { campaign: params.has('empty') ? null : { id: 'campaign-1', runId: 'finance-run-1', revision: 2, baselineAt: '2026-09-29T13:00:00Z', ownerId: 'operator-1', ownerName: 'Current operator', verifiedBatchCount: 0 }, cases: seed, requests: [], conflict: false, closed: false, quotaReady: !params.has('noquota'), batch: null, failRun: params.has('uncertain'), runs: [], refreshed: false, pauseRuns: params.has('controlled'), releaseRun: null };
const allowance = { remaining: 894, reserve: 200, observedAt: '2026-09-29T12:37:54Z' };
const forecast = { readCalls: 12, writeCalls: 10, verificationCalls: 10, recoveryCalls: 5, otherActivityCalls: 10, callsNeeded: 47, canProceed: true };
const batchForecast = (cases, size = cases.length) => ({ ...forecast, callsNeeded: 10 + size * 2, canProceed: true });
const pending = (fixture) => fixture.batch && ['approved', 'partial', 'running'].includes(fixture.batch.status) ? [fixture.batch] : [];
appClient.functions.invoke = async (name, body = {}) => {
  const fixture = window.campaignFixture;
  fixture.requests.push({ name, body: structuredClone(body) });
  if (name === 'xeroReconciliationCampaignRead') {
    const scoped = fixture.cases.filter((row) => (!body.category || row.category === body.category) && (!body.status || row.status === body.status));
    const offset = Number(body.cursor || 0); const pageRows = scoped.slice(offset, offset + body.limit);
    return { data: { campaign: fixture.campaign, pendingBatches: pending(fixture), counts: { total: fixture.cases.length, ready: fixture.cases.filter((row) => row.status === 'ready').length, needsDecision: 2, waitingDependency: 0, reconciled: fixture.cases.filter((row) => row.status === 'reconciled').length, byCategory: { link_only: 60, contact: 1, draft: 1, decision: 2 } }, cases: pageRows, page: { nextCursor: offset + pageRows.length < scoped.length ? String(offset + pageRows.length) : null, hasMore: offset + pageRows.length < scoped.length, total: scoped.length }, allowance: fixture.quotaReady ? allowance : null, forecast: fixture.quotaReady ? forecast : { ...forecast, canProceed: false, reason: 'Allowance unverified' } } };
  }
  if (name === 'xeroReconciliationConnectionCheck') { fixture.quotaReady = true; return { data: { connection: { connected: true, tenantName: 'Synthetic tenant' }, allowance, forecast } }; }
  if (name === 'xeroReconciliationCampaignCreate') { fixture.campaign = { id: 'campaign-1', runId: body.runId, revision: 1, ownerId: 'operator-1', ownerName: 'Current operator', verifiedBatchCount: 0 }; return { data: { campaign: fixture.campaign, allowance, forecast } }; }
  if (name === 'xeroReconciliationCampaignRefresh') {
    if (fixture.batch?.status === 'running') return { data: { error: 'An operation is awaiting verification.' } };
    const baselineAt = fixture.campaign.baselineAt;
    fixture.campaign.revision++;
    fixture.cases = fixture.cases.map((row) => row.id === 'link-1' ? { ...row, evidenceFingerprint: 'changed-current-evidence', reason: 'Current evidence changed; review required.' } : row);
    if (!fixture.refreshed) fixture.cases.push({ ...link(99), id: 'future-1', category: 'future_activity', status: 'future_activity', title: 'Future delivery after fixed baseline', reason: 'Current activity remains outside the saved baseline.' });
    fixture.refreshed = true;
    if (fixture.batch) fixture.batch = { ...fixture.batch, status: 'preview', revision: fixture.batch.revision + 1 };
    return { data: { campaign: { ...fixture.campaign, baselineAt }, cases: fixture.cases, pendingBatches: pending(fixture), counts: { total: fixture.cases.length, ready: fixture.cases.filter((row) => row.status === 'ready').length, needsDecision: 2, waitingDependency: 0, reconciled: 0 }, page: { total: fixture.cases.length, hasMore: false }, allowance, forecast } };
  }
  if (name === 'xeroReconciliationCampaignPreview') {
    if (fixture.conflict) return { data: { error: 'Campaign revision changed.' } };
    const approvalForecast = batchForecast(body.caseIds);
    const nextRunForecast = batchForecast(body.caseIds, Math.min(5, body.caseIds.length));
    fixture.batch = { id: 'batch-1', campaign_id: fixture.campaign.id, revision: 1, category: body.category, case_ids: body.caseIds, caseEvidence: structuredClone(body.caseIds.map((id) => fixture.cases.find((row) => row.id === id))), evidence_fingerprint: 'exact-batch-fingerprint', status: 'preview', verified_count: 0, forecast: approvalForecast, approvalForecast, nextRunForecast };
    return { data: { batch: structuredClone(fixture.batch), evidenceFingerprint: fixture.batch.evidence_fingerprint, diffs: body.category === 'link_only' ? [] : body.caseIds.map((caseId) => ({ caseId, field: 'Contact', before: 'Unlinked', after: 'Verified contact' })), approvalForecast, nextRunForecast: fixture.quotaReady ? nextRunForecast : { ...nextRunForecast, canProceed: false, reason: 'Allowance unverified' }, forecast: fixture.quotaReady ? nextRunForecast : { ...nextRunForecast, canProceed: false, reason: 'Allowance unverified' }, allowance: fixture.quotaReady ? allowance : null } };
  }
  if (name === 'xeroReconciliationCampaignApprove') {
    if (fixture.conflict) return { data: { error: 'Evidence changed before approval.' } };
    fixture.batch.status = 'approved'; fixture.batch.revision++;
    return { data: { batch: structuredClone(fixture.batch), nextRunForecast: fixture.quotaReady ? fixture.batch.nextRunForecast : { ...fixture.batch.nextRunForecast, canProceed: false, reason: 'Allowance unverified' }, allowance: fixture.quotaReady ? allowance : null, forecast: fixture.quotaReady ? forecast : { ...forecast, canProceed: false, reason: 'Allowance unverified' } } };
  }
  if (name === 'xeroReconciliationCampaignRun') {
    const batch = fixture.batch;
    if (body.expectedFingerprint !== batch.evidence_fingerprint) return { data: { error: 'Batch evidence changed.' } };
    const recovering = batch.status === 'running';
    if (body.campaignId !== batch.campaign_id || body.batchId !== batch.id || body.expectedRevision !== batch.revision && !(recovering && body.expectedRevision <= batch.revision)) return { data: { error: 'Exact batch revision changed.' } };
    const remaining = batch.case_ids.filter((id) => fixture.cases.find((row) => row.id === id)?.status === 'ready');
    const ids = recovering ? batch.claim_case_ids : remaining.slice(0, batch.verified_count < Math.min(5, batch.case_ids.length) ? Math.min(5, batch.case_ids.length) - batch.verified_count : 25);
    if (!recovering) { batch.status = 'running'; batch.claim_case_ids = ids; batch.revision++; }
    fixture.runs.push({ ids: [...ids], recovering });
    if (fixture.failRun) { fixture.failRun = false; throw new Error('Synthetic response lost after claim.'); }
    if (fixture.pauseRuns) await new Promise((resolve) => { fixture.releaseRun = () => { fixture.releaseRun = null; resolve(); }; });
    batch.verified_count += ids.length; batch.revision++; batch.claim_case_ids = null;
    batch.status = batch.verified_count === batch.case_ids.length ? 'completed' : 'partial';
    batch.nextRunForecast = batchForecast(batch.case_ids, Math.min(25, batch.case_ids.length - batch.verified_count));
    fixture.campaign.verifiedBatchCount++; fixture.campaign.revision++;
    fixture.cases = fixture.cases.map((row) => ids.includes(row.id) ? { ...row, status: 'reconciled' } : row);
    return { data: { batch: structuredClone(batch), outcomes: ids.map((id) => ({ caseId: id, status: 'reconciled' })), nextRunForecast: batch.nextRunForecast, allowance, forecast: batch.nextRunForecast } };
  }
  throw new Error(`Unexpected fixture call: ${name}`);
};
createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-[1480px] p-6"><XeroReconciliationCampaign baselineRun={{ id: 'finance-run-1', revision: 1, status: 'ready_for_review' }} enabled={!params.has('locked')} connected onClose={() => { window.campaignFixture.closed = true; }} /></main>);

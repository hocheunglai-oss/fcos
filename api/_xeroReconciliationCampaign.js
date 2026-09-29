import { createHash } from 'node:crypto';
import { allFinancialRows, XERO_RECONCILIATION_VERSION } from './_xeroFinancialSync.js';
import { getFreshXeroConnection, xeroAccountingFetch, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { authorizeXeroQuotaProbe } from './_xeroSharedControl.js';
import { buildReconciliationCases, forecastReconciliationBatch, summariseReconciliationCases } from './_xeroReconciliationPolicy.js';

const CATEGORIES = new Set(['link_only', 'contact', 'draft']);
const STATUSES = new Set(['ready', 'needs_decision', 'waiting_dependency', 'reconciled', 'legacy_excluded', 'future_activity']);
const ALL_CATEGORIES = new Set(['link_only', 'contact', 'draft', 'decision', 'correction_deferred', 'legacy_excluded', 'future_activity']);
const RESERVE = 200;

function fail(message, status = 400, code = 'XERO_CAMPAIGN_REJECTED') {
  return Object.assign(new Error(message), { status, code, expose: true });
}

function actor(context) {
  const id = context?.profile?.id;
  if (typeof id !== 'string' || !id) throw fail('A current FCOS user is required.', 401, 'XERO_CAMPAIGN_AUTH_REQUIRED');
  return { id, email: context.profile.email || null };
}

function requireId(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw fail(`${field} is required.`);
  return value.trim();
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw fail('An exact saved revision is required.');
  return value;
}

function deps(input = {}) {
  const env = input.env || process.env;
  return { ...input, env, client: input.client || xeroContactSyncServiceClient(env),
    checkConnection: input.checkConnection || getFreshXeroConnection,
    authorizeProbe: input.authorizeProbe || authorizeXeroQuotaProbe,
    probeXero: input.probeXero || xeroAccountingFetch,
    executeBatch: input.executeBatch || (async (options) => {
      const { executeCampaignBatch } = await import('./_xeroReconciliationExecution.js');
      return executeCampaignBatch(options);
    }) };
}

async function one(query, name) {
  const { data, error } = await query.maybeSingle();
  if (error) throw fail(`Saved ${name} could not be read.`, 503, 'XERO_CAMPAIGN_STORAGE_FAILED');
  return data;
}

async function rpc(client, name, parameters) {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw fail(`Campaign ${name} was not confirmed: ${error.message || 'database rejected request'}`, 409, 'XERO_CAMPAIGN_RPC_FAILED');
  if (!data) throw fail(`Campaign ${name} returned no durable result.`, 503, 'XERO_CAMPAIGN_RESULT_UNKNOWN');
  return data;
}

async function connectedTenant(client) {
  const row = await one(client.from('xero_contact_sync_connections').select('tenant_id,tenant_name')
    .eq('id', 'primary'), 'Xero connection');
  return row?.tenant_id ? { id: row.tenant_id, name: row.tenant_name || null } : null;
}

async function sharedAllowance(client, tenantId) {
  if (!tenantId) return { remaining: null, reserve: RESERVE, holdReason: 'Xero connection is unavailable.' };
  try {
    const status = await rpc(client, 'xero_shared_status', { p_tenant_id: tenantId });
    const remaining = status.allowanceKnown && Number.isSafeInteger(status.availableCalls) ? status.availableCalls : null;
    const reason = status.unresolvedWrites > 0 ? 'A previous Xero write has an uncertain outcome.'
      : status.dailyHold ? 'Xero daily allowance is on hold.'
        : status.retryAt ? 'Xero requested a retry delay.'
          : remaining === null ? 'Xero allowance has not been verified.' : null;
    return { remaining, reserve: RESERVE, reservedCalls: status.reservedCalls || 0, unresolvedWrites: status.unresolvedWrites || 0, dailyHold: status.dailyHold === true,
      observedAt: status.rateLimit?.observedAt || null, retryAt: status.retryAt || null,
      holdReason: reason };
  } catch {
    return { remaining: null, reserve: RESERVE, holdReason: 'Shared Xero allowance is unavailable.' };
  }
}

function publicCase(row) {
  const item = row.evidence || {};
  return { id: row.id, caseKey: row.case_key, category: row.category, status: row.status,
    title: item.title || null, accountName: item.accountName || null, documentNumber: item.documentNumber || null,
    reason: row.outcome?.reason || item.reason || null, reasons: row.outcome?.reason ? [row.outcome.reason, ...(item.reasons || [])] : Array.isArray(item.reasons) ? item.reasons : [],
    dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
    ownerId: item.ownerId || null, ownerName: item.ownerName || null,
    sourceObject: item.sourceObject || null, sourceId: item.sourceId || null, targetId: item.targetId || null,
    currency: item.currency || null, total: item.total ?? null,
    evidenceFingerprint: row.evidence_fingerprint };
}

async function batchForecast(client, campaign, batch, rows, allowance) {
  const verifiedCount = Number(batch.verified_count || 0);
  const capacity = batch.status === 'running' ? (batch.claim_case_ids || []).length
    : verifiedCount < Math.min(5, batch.case_ids.length) ? Math.min(5, batch.case_ids.length) - verifiedCount : 25;
  const approved = new Map((batch.evidence || []).map((row) => [row.id, row.fingerprint]));
  const candidates = rows.filter((row) => (batch.status === 'running' ? batch.claim_case_ids : batch.case_ids).includes(row.id)
    && row.status === 'ready' && (!approved.size || approved.get(row.id) === row.evidence_fingerprint));
  // Reserve for the most expensive eligible verification mix; SQL selects a
  // representative first five and may therefore choose payments before invoices.
  const pending = candidates.sort((a,b) => Number(b.evidence?.sourceObject === 'Payment__c') - Number(a.evidence?.sourceObject === 'Payment__c') || a.id.localeCompare(b.id)).slice(0, capacity);
  let ownReservation = 0;
  if (batch.status === 'running') {
    const key = `campaign:${campaign.id}:${batch.id}:${batch.claim_id}`;
    const budgets = (await allFinancialRows(client, 'xero_shared_budgets', (query) => query.eq('tenant_id', campaign.tenant_id).eq('owner_key', key))).data;
    ownReservation = budgets.filter((row) => row.state === 'active' && Date.parse(row.expires_at) > Date.now())
      .reduce((sum, row) => sum + row.operation_remaining + row.verification_remaining, 0);
    if (!Number.isSafeInteger(ownReservation) || ownReservation < 0 || ownReservation > allowance.reservedCalls) throw fail('Claim reservation evidence changed.', 503, 'XERO_CAMPAIGN_STORAGE_FAILED');
  }
  return { ...forecastReconciliationBatch({ category: batch.category, cases: pending.map(publicCase),
    inventoryCalls: 40 + Math.ceil(pending.length / 50) + (batch.category === 'contact' ? pending.length * 10 : 0), otherActivityCalls: 2,
    remainingCalls: allowance.remaining === null ? null : Math.max(0, allowance.remaining - allowance.reservedCalls + ownReservation) }),
    ownReservation, claimCapacity: capacity, recovery: batch.status === 'running' };
}

function publicCampaign(row, verifiedBatchCount = 0) {
  if (!row) return null;
  return { id: row.id, runId: row.run_id, reviewRunId: row.review_run_id || row.run_id, tenantId: row.tenant_id, baselineAt: row.baseline_at,
    revision: row.revision, status: row.status, ownerId: row.owner_id, ownerName: row.owner_name || null,
    createdAt: row.created_at || null,
    verifiedBatchCount };
}

async function verifiedBatchCount(client, campaignId) {
  const batches = (await allFinancialRows(client, 'xero_reconciliation_batches',
    (query) => query.eq('campaign_id', campaignId))).data;
  return batches.reduce((total, row) => total + Math.max(0, Number(row.verified_count || 0)), 0);
}

async function campaignFor(client, id, ownerId, tenantId) {
  const query = client.from('xero_reconciliation_campaigns').select('*').eq('owner_id', ownerId).eq('tenant_id', tenantId);
  const result = id ? await one(query.eq('id', id), 'campaign')
    : await one(query.order('created_at', { ascending: false }).limit(1), 'campaign');
  if (id && !result) throw fail('Campaign is unavailable to this operator.', 404, 'XERO_CAMPAIGN_NOT_FOUND');
  return result;
}

function batchFingerprint(cases, category, campaign) {
  const basis = { category, campaignId: campaign.id, revision: campaign.revision,
    cases: cases.map((item) => [item.case_key, item.evidence_fingerprint]).sort(([a], [b]) => a.localeCompare(b)) };
  return createHash('sha256').update(JSON.stringify(basis)).digest('hex');
}

async function reviewDiffs(client, campaign, cases, category) {
  const items = category === 'link_only' ? [] : (await allFinancialRows(client, 'xero_financial_sync_items',
    (query) => query.eq('run_id', campaign.review_run_id || campaign.run_id))).data;
  const bySource = new Map(items.map((item) => [`${item.source_object}:${item.source_id}`, item]));
  return cases.map((row) => {
    const evidence = row.evidence || {};
    if (category === 'link_only') return { caseId: row.id, caseTitle: evidence.title || row.case_key,
      changes: [{ field: 'Exact Xero link', before: 'No confirmed FCOS link', after: evidence.targetId }] };
    if (category === 'contact' && evidence.sourceObject === 'Account' && evidence.contactProposal) {
      return { caseId: row.id, caseTitle: evidence.title || row.case_key, changes: [
        { field: 'Contact operation', before: evidence.contactProposal.action === 'restore' ? 'Archived Contact' : 'No uniquely matching Contact', after: evidence.contactProposal.action },
        { field: 'Legal name', before: evidence.accountName, after: evidence.contactProposal.Name },
        { field: 'Salesforce Account family', before: 'No verified active Contact link', after: (evidence.sourceIds || []).join(', ') },
      ] };
    }
    const source = bySource.get(`${evidence.sourceObject}:${evidence.sourceId}`);
    if (!source || !source.proposed_payload || !Object.keys(source.proposed_payload).length) {
      throw fail('An exact saved change proposal is unavailable for this case.', 409, 'XERO_CAMPAIGN_PROPOSAL_REQUIRED');
    }
    return { caseId: row.id, caseTitle: evidence.title || row.case_key,
      changes: [{ field: category === 'draft' ? 'Proposed Xero draft' : 'Proposed Xero contact',
        before: source.xero_payload && Object.keys(source.xero_payload).length ? JSON.stringify(source.xero_payload) : 'No verified target',
        after: JSON.stringify(source.proposed_payload) }] };
  });
}

function decimalCents(value) {
  if (value == null || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
  const [whole, fractional = ''] = String(value).split('.');
  const sign = whole.startsWith('-') ? -1n : 1n;
  return sign * (BigInt(whole.replace('-', '')) * 100n + BigInt(fractional.padEnd(2, '0')));
}

function currencyTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    const item = row.evidence || {};
    const cents = decimalCents(item.total);
    if (!item.currency || cents === null) continue;
    const key = `${row.status}:${item.currency}`;
    totals.set(key, (totals.get(key) || 0n) + cents);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([key, cents]) => {
    const [status, currency] = key.split(':');
    const magnitude = cents < 0n ? -cents : cents;
    return { status, currency, amount: `${cents < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}` };
  });
}

export async function xeroReconciliationCampaignCreate(body = {}, input = {}) {
  const { client, accessContext } = deps(input);
  const current = actor(accessContext);
  const runId = requireId(body.runId, 'runId');
  const expected = revision(body.expectedRunRevision);
  const tenant = await connectedTenant(client);
  if (!tenant) throw fail('Xero is not connected.', 409, 'XERO_CAMPAIGN_CONNECTION_REQUIRED');
  const run = await one(client.from('xero_financial_sync_runs').select('*').eq('id', runId), 'financial check');
  if (!run || run.mode !== 'preview' || run.status !== 'ready_for_review' || run.revision !== expected
    || run.control_totals?.workflowSnapshot?.reconciliationVersion !== XERO_RECONCILIATION_VERSION
    || run.control_totals?.workflowSnapshot?.linkFirst !== true) {
    throw fail('A current complete link-first saved financial check is required. Run a new check with link-first enabled.', 409, 'XERO_CAMPAIGN_BASELINE_CHANGED');
  }
  const items = (await allFinancialRows(client, 'xero_financial_sync_items', (query) => query.eq('run_id', runId))).data;
  let cases;
  try { cases = buildReconciliationCases({ tenantId: tenant.id, run, items, ownerId: current.id,
    baselineAt: run.control_totals.workflowSnapshot.checkedAt || run.created_at }); }
  catch { throw fail('The saved financial check is incomplete or has conflicting identities.', 409, 'XERO_CAMPAIGN_BASELINE_INCOMPLETE'); }
  const campaign = await rpc(client, 'xero_campaign_create_v1', { p_actor: current.id, p_tenant: tenant.id,
    p_run: runId, p_run_revision: expected, p_cases: cases });
  return await xeroReconciliationCampaignRead({ campaignId: campaign.id }, input);
}

export async function xeroReconciliationCampaignRead(body = {}, input = {}) {
  const { client, accessContext } = deps(input);
  const current = actor(accessContext);
  const tenant = await connectedTenant(client);
  const allowance = await sharedAllowance(client, tenant?.id);
  if (!tenant) return { campaign: null, counts: summariseReconciliationCases([]), cases: [],
    page: { total: 0, hasMore: false, nextCursor: null }, allowance, forecast: null };
  const campaign = await campaignFor(client, body.campaignId || null, current.id, tenant.id);
  if (!campaign) return { campaign: null, counts: summariseReconciliationCases([]), cases: [],
    page: { total: 0, hasMore: false, nextCursor: null }, allowance, forecast: null };
  const rows = (await allFinancialRows(client, 'xero_reconciliation_cases', (query) => query.eq('campaign_id', campaign.id))).data;
  const verified = await verifiedBatchCount(client, campaign.id);
  const counts = summariseReconciliationCases(rows.map((row) => ({ category: row.category, status: row.status })));
  counts.currencyTotals = currencyTotals(rows);
  const category = body.category && body.category !== 'all' ? body.category : null;
  const status = body.status && body.status !== 'all' ? body.status : null;
  if (category && !ALL_CATEGORIES.has(category) || status && !STATUSES.has(status)) throw fail('Unknown case filter.');
  const limit = Number.isSafeInteger(body.limit) ? Math.min(100, Math.max(1, body.limit)) : 50;
  const visible = rows.filter((row) => (!category || row.category === category) && (!status || row.status === status));
  const cursor = body.cursor || null;
  const from = cursor ? visible.findIndex((row) => row.id === cursor) + 1 : 0;
  if (cursor && from === 0) throw fail('The page cursor is invalid.');
  const pageRows = visible.slice(from, from + limit);
  const hasMore = from + limit < visible.length;
  const nextCursor = hasMore ? pageRows.at(-1)?.id || null : null;
  const planningCases = category && CATEGORIES.has(category) ? rows.filter((row) => row.category === category && row.status === 'ready')
    .slice(0, verified ? 25 : 5).map(publicCase) : [];
  const forecast = planningCases.length ? forecastReconciliationBatch({ category, cases: planningCases,
    inventoryCalls: 40 + Math.ceil(planningCases.length / 50) + (category === 'contact' ? planningCases.length * 10 : 0), otherActivityCalls: 2,
    remainingCalls: allowance.remaining === null ? null : Math.max(0, allowance.remaining - allowance.reservedCalls) }) : null;
  const pendingBatches = [];
  for (const batch of (await allFinancialRows(client, 'xero_reconciliation_batches', (query) => query.eq('campaign_id', campaign.id))).data
    .filter((batch) => ['approved', 'partial', 'running'].includes(batch.status))) {
    pendingBatches.push({
        id: batch.id, category: batch.category, revision: batch.revision, status: batch.status,
        case_ids: batch.case_ids, claim_case_ids: batch.claim_case_ids, verified_count: batch.verified_count,
        evidence_fingerprint: batch.evidence_fingerprint, forecast: batch.forecast, approvalForecast: batch.forecast,
        nextRunForecast: await batchForecast(client, campaign, batch, rows, allowance),
      });
  }
  return { campaign: publicCampaign(campaign, verified), counts, cases: pageRows.map(publicCase),
    page: { total: visible.length, hasMore, nextCursor }, allowance, forecast, pendingBatches };
}

export async function xeroReconciliationCampaignRefresh(body = {}, input = {}) {
  const { client, accessContext } = deps(input);
  const current = actor(accessContext);
  const { tenant, campaign } = await loadCampaignAndCases(client, body, current);
  if (campaign.revision !== revision(body.expectedRevision)) throw fail('Campaign revision changed. Read it again.', 409, 'XERO_CAMPAIGN_REVISION_CHANGED');
  const { xeroFinancialSyncPreview } = await import('./_xeroFinancialSync.js');
  const preview = await (input.refreshPreview || xeroFinancialSyncPreview)({ campaignId: campaign.id,
    linkFirst: true, includePayments: true, recordExactMatches: false, postingMode: 'draft' }, input);
  const runId = requireId(preview.run?.id, 'freshRunId');
  const run = await one(client.from('xero_financial_sync_runs').select('*').eq('id', runId), 'fresh financial check');
  const items = (await allFinancialRows(client, 'xero_financial_sync_items', (query) => query.eq('run_id', runId))).data;
  const cases = buildReconciliationCases({ tenantId: tenant.id, run, items, ownerId: current.id,
    baselineAt: campaign.baseline_at });
  await rpc(client, 'xero_campaign_refresh_v1', { p_actor: current.id, p_campaign: campaign.id,
    p_revision: campaign.revision, p_run: runId, p_run_revision: run.revision, p_cases: cases });
  return xeroReconciliationCampaignRead({ campaignId: campaign.id }, input);
}

function exactCases(all, ids, category, maximum) {
  if (!CATEGORIES.has(category) || !Array.isArray(ids) || ids.length < 1 || ids.length > maximum
    || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string')) throw fail('Choose one bounded category and exact case IDs.');
  const indexed = new Map(all.map((row) => [row.id, row]));
  const cases = ids.map((id) => indexed.get(id));
  if (cases.some((item) => !item || item.category !== category || item.status !== 'ready' || !item.evidence_fingerprint)) {
    throw fail('Selected cases changed or are not ready.', 409, 'XERO_CAMPAIGN_CASE_CHANGED');
  }
  return cases;
}

async function loadCampaignAndCases(client, body, current) {
  const tenant = await connectedTenant(client);
  if (!tenant) throw fail('Xero connection is unavailable.', 409, 'XERO_CAMPAIGN_CONNECTION_REQUIRED');
  const campaign = await campaignFor(client, requireId(body.campaignId, 'campaignId'), current.id, tenant.id);
  const cases = (await allFinancialRows(client, 'xero_reconciliation_cases', (query) => query.eq('campaign_id', campaign.id))).data;
  return { tenant, campaign, cases };
}

export async function xeroReconciliationCampaignPreview(body = {}, input = {}) {
  const { client, accessContext } = deps(input);
  const current = actor(accessContext);
  const { tenant, campaign, cases: all } = await loadCampaignAndCases(client, body, current);
  if (campaign.revision !== revision(body.expectedRevision)) throw fail('Campaign revision changed. Read it again.', 409, 'XERO_CAMPAIGN_REVISION_CHANGED');
  const cases = exactCases(all, body.caseIds, body.category, 5000);
  const allowance = await sharedAllowance(client, tenant.id);
  const forecast = forecastReconciliationBatch({ category: body.category, cases: cases.map(publicCase),
    inventoryCalls: 40 + Math.ceil(Math.min(cases.length, 25) / 50) + (body.category === 'contact' ? Math.min(cases.length, 25) * 10 : 0), otherActivityCalls: 2,
    remainingCalls: allowance.remaining === null ? null : Math.max(0, allowance.remaining - allowance.reservedCalls) });
  const fingerprint = batchFingerprint(cases, body.category, campaign);
  const diffs = await reviewDiffs(client, campaign, cases, body.category);
  const batch = await rpc(client, 'xero_campaign_prepare_v1', { p_actor: current.id, p_campaign: campaign.id,
    p_revision: campaign.revision, p_category: body.category, p_case_ids: body.caseIds, p_forecast: { ...forecast, evidenceFingerprint: fingerprint } });
  const nextRunForecast = await batchForecast(client, campaign, { ...batch, status: 'approved', verified_count: 0 }, cases, allowance);
  return { batch, diffs, forecast: nextRunForecast, approvalForecast: forecast, nextRunForecast,
    evidenceFingerprint: batch.evidence_fingerprint || fingerprint, allowance };
}

export async function xeroReconciliationCampaignApprove(body = {}, input = {}) {
  const { client, accessContext } = deps(input);
  const current = actor(accessContext);
  if (body.reviewed !== true) throw fail('The exact batch must be reviewed before approval.');
  const { campaign } = await loadCampaignAndCases(client, body, current);
  const batchId = requireId(body.batchId, 'batchId');
  const batch = await one(client.from('xero_reconciliation_batches').select('*').eq('id', batchId).eq('campaign_id', campaign.id), 'batch');
  if (!batch || batch.revision !== revision(body.expectedRevision) || batch.evidence_fingerprint !== body.expectedFingerprint) {
    throw fail('The exact batch evidence changed. Preview it again.', 409, 'XERO_CAMPAIGN_BATCH_CHANGED');
  }
  const approved = await rpc(client, 'xero_campaign_approve_v1', { p_actor: current.id, p_batch: batchId,
    p_revision: batch.revision, p_fingerprint: batch.evidence_fingerprint });
  return { batch: approved, allowance: await sharedAllowance(client, campaign.tenant_id) };
}

export async function xeroReconciliationCampaignRun(body = {}, input = {}) {
  const { client, accessContext, env, fetchImpl, checkConnection, executeBatch } = deps(input);
  const current = actor(accessContext);
  const { tenant, campaign, cases: currentCases } = await loadCampaignAndCases(client, body, current);
  const batchId = requireId(body.batchId, 'batchId');
  const batch = await one(client.from('xero_reconciliation_batches').select('*').eq('id', batchId).eq('campaign_id', campaign.id), 'batch');
  const expected = revision(body.expectedRevision);
  const exactRecovery = batch?.status === 'running' && expected <= batch.revision
    && typeof body.expectedFingerprint === 'string' && body.expectedFingerprint === batch.evidence_fingerprint;
  if (!batch || batch.revision !== expected && !exactRecovery || !['approved', 'partial', 'running'].includes(batch.status)) {
    throw fail('Batch approval changed. Read the campaign again.', 409, 'XERO_CAMPAIGN_BATCH_CHANGED');
  }
  const allowance = await sharedAllowance(client, tenant.id);
  const forecast = await batchForecast(client, campaign, batch, currentCases, allowance);
  const recoveryOnlyHold = batch.status === 'running' && allowance.unresolvedWrites > 0 && !allowance.dailyHold
    && !(Date.parse(allowance.retryAt || '') > Date.now());
  if (allowance.holdReason && !recoveryOnlyHold || allowance.remaining === null || !Number.isSafeInteger(forecast.callsNeeded)
    || allowance.remaining - allowance.reservedCalls + forecast.ownReservation - RESERVE < forecast.callsNeeded) {
    throw fail(allowance.holdReason || 'Verified Xero allowance above the 200-call reserve is required.', 429, 'XERO_CAMPAIGN_ALLOWANCE_HOLD');
  }
  const connection = await checkConnection(client, { env, fetchImpl });
  if (connection?.tenantId !== tenant.id) throw fail('The connected Xero organisation changed.', 409, 'XERO_CAMPAIGN_TENANT_CHANGED');
  let currentBatch = batch;
  const allOutcomes = [];
  // Each request verifies one claim: five representative cases first, then up
  // to 25. The exact category approval remains valid for unchanged cases.
  while (allOutcomes.length === 0) {
    const claim = await rpc(client, 'xero_campaign_claim_v1', { p_actor: current.id, p_batch: batchId, p_revision: currentBatch.revision });
    if (!claim.batch || !Array.isArray(claim.cases) || !claim.batch.claim_id) throw fail('Batch claim result is uncertain. Read it back before another action.', 503, 'XERO_CAMPAIGN_CLAIM_UNKNOWN');
    let outcomes;
    try {
      outcomes = await executeBatch({ client, connection, campaign, batch: { ...claim.batch, forecast }, cases: claim.cases,
        recovering: claim.recovering === true,
        actor: current, env, fetchImpl });
    } catch (error) {
      throw fail(`Batch execution outcome is uncertain: ${error?.message || 'execution stopped'}. Read the claimed batch before another action.`, 503, 'XERO_CAMPAIGN_EXECUTION_UNKNOWN');
    }
    if (!Array.isArray(outcomes)) throw fail('Batch execution returned no confirmed outcomes. Read back before another action.', 503, 'XERO_CAMPAIGN_EXECUTION_UNKNOWN');
    const expectedCases = new Map(claim.cases.map((item) => [item.id, item]));
    if (outcomes.length !== expectedCases.size || new Set(outcomes.map((item) => item.caseId)).size !== expectedCases.size
      || outcomes.some((item) => !expectedCases.has(item.caseId) || item.evidenceFingerprint !== expectedCases.get(item.caseId).evidenceFingerprint
        || !['reconciled', 'needs_decision', 'waiting_dependency'].includes(item.status)
        || item.status === 'reconciled' && !/^[a-f0-9]{64}$/.test(item.verificationFingerprint || '')
        || item.status === 'reconciled' && (batch.category === 'link_only' && expectedCases.get(item.caseId).sourceObject !== 'Payment__c'
          ? !item.mapping : expectedCases.get(item.caseId).sourceObject === 'Payment__c'
            ? !(item.paymentMapping || item.paymentReferenceRow || item.groupPaymentRow) : !item.receiptId))) {
      throw fail('Batch outcomes lack exact case and verification evidence. Read back before another action.', 503, 'XERO_CAMPAIGN_EXECUTION_UNKNOWN');
    }
    currentBatch = await rpc(client, 'xero_campaign_finish_v1', { p_actor: current.id, p_batch: batchId,
      p_claim: claim.batch.claim_id, p_outcomes: outcomes });
    allOutcomes.push(...outcomes);
    if (currentBatch.status !== 'partial' || claim.recovering === true) break;
  }
  const updatedAllowance = await sharedAllowance(client, tenant.id);
  const outcomeById = new Map(allOutcomes.map((row) => [row.caseId, row.status]));
  const nextRunForecast = currentBatch.status === 'partial' ? await batchForecast(client, campaign, currentBatch,
    currentCases.map((row) => ({ ...row, status: outcomeById.get(row.id) || row.status })), updatedAllowance) : null;
  return { batch: currentBatch, outcomes: allOutcomes, forecast: nextRunForecast || forecast, nextRunForecast,
    allowance: updatedAllowance };
}

export async function xeroReconciliationConnectionCheck(_body = {}, input = {}) {
  const { client, accessContext, env, fetchImpl, checkConnection, authorizeProbe, probeXero,
    now = () => Date.now() } = deps(input);
  const current = actor(accessContext);
  try {
    const savedTenant = await connectedTenant(client);
    const connection = await checkConnection(client, { env, fetchImpl });
    if (!savedTenant || connection?.tenantId !== savedTenant.id) throw fail('The connected Xero organisation changed.', 409, 'XERO_CAMPAIGN_TENANT_CHANGED');
    let allowance = await sharedAllowance(client, connection.tenantId);
    const checkedAt = Number(now());
    const observedAt = Date.parse(allowance.observedAt || '');
    const fresh = allowance.remaining !== null && Number.isFinite(observedAt)
      && observedAt <= checkedAt && checkedAt - observedAt <= 15 * 60_000;
    const retryAt = Date.parse(allowance.retryAt || '');
    if (!fresh && !(Number.isFinite(retryAt) && retryAt > checkedAt)) {
      try {
        const grant = await authorizeProbe(connection, { actorId: current.id,
          notBefore: new Date(checkedAt).toISOString(), reason: 'Explicit reconciliation connection and allowance check' });
        if (!grant?.id) throw fail('Allowance probe authority was not confirmed.', 503, 'XERO_CAMPAIGN_PROBE_UNAVAILABLE');
        await probeXero(connection, '/Organisations', { method: 'GET', env, fetchImpl,
          probeId: grant.id, retryOnRateLimit: false });
        allowance = await sharedAllowance(client, connection.tenantId);
      } catch (error) {
        allowance = { ...allowance, holdReason: error?.code
          ? `Xero allowance probe needs attention (${error.code}).`
          : 'Xero allowance probe needs attention.' };
      }
    }
    return { connection: { connected: true, tenantName: connection.tenantName || null,
      needsReconnect: false, reason: null }, allowance };
  } catch (error) {
    const tenant = await connectedTenant(client);
    const needsReconnect = ['XERO_CONNECTION_REQUIRED', 'XERO_CONNECTION_REVOKED'].includes(error?.code);
    return { connection: { connected: false, tenantName: tenant?.name || null,
      needsReconnect, reason: error?.code === 'XERO_RENEWAL_IN_PROGRESS'
        ? 'Xero connection renewal is already running. Try again after it finishes.'
        : error?.code ? `Xero connection needs attention (${error.code}).` : 'Xero connection needs attention.' },
    allowance: await sharedAllowance(client, tenant?.id) };
  }
}

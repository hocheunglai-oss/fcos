import assert from 'node:assert/strict';
import test from 'node:test';
import { xeroReconciliationCampaignApprove, xeroReconciliationCampaignCreate,
  xeroReconciliationCampaignPreview, xeroReconciliationCampaignRead,
  xeroReconciliationCampaignRun, xeroReconciliationConnectionCheck } from '../api/_xeroReconciliationCampaign.js';
import { XERO_RECONCILIATION_VERSION } from '../api/_xeroFinancialSync.js';

const tenantId = 'tenant-one';
const userId = 'user-one';
const accessContext = { profile: { id: userId, email: 'operator@example.test' } };
const run = { id: 'run-one', mode: 'preview', status: 'ready_for_review', revision: 1,
  created_at: '2026-09-30T00:00:00Z', control_totals: { workflowSnapshot: {
    complete: true, linkFirst: true, expectedItemCount: 1, reconciliationVersion: XERO_RECONCILIATION_VERSION, tenantId,
    includePayments: true, checkedAt: '2026-09-30T00:00:00Z', controlsFingerprint: 'controls',
    payments: { tenantId, rows: [] },
  } } };
const item = { id: 'item-one', run_id: run.id, source_object: 'Invoice__c', source_id: 'invoice-one',
  source_document_number: 'INV-1', source_total: 100, currency: 'USD', status: 'eligible', proposed_action: 'link',
  xero_document_id: 'xero-invoice', xero_payload: { id: 'xero-invoice', total: 100 }, proposed_payload: {},
  blockers: [], differences: [], source_payload: { salesforceObject: 'Invoice__c', salesforceId: 'invoice-one',
    documentNumber: 'INV-1', invoiceDate: '2026-09-01', documentFieldProjection: { scope: 'current' },
    sourceFingerprint: 'source', financialFingerprint: 'finance', accountName: 'Buyer' } };

function fakeClient() {
  const tables = { xero_contact_sync_connections: [{ id: 'primary', tenant_id: tenantId, tenant_name: 'Example' }],
    xero_financial_sync_runs: [structuredClone(run)], xero_financial_sync_items: [structuredClone(item)],
    xero_reconciliation_campaigns: [], xero_reconciliation_cases: [], xero_reconciliation_batches: [] };
  const calls = [];
  const client = {
    from(name) {
      let rows = tables[name] || [];
      let count = Infinity;
      const chain = {
        select() { return chain; },
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return chain; },
        order(key, options = {}) { rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options.ascending === false ? -1 : 1)); return chain; },
        limit(value) { count = value; return chain; },
        async maybeSingle() { return { data: rows.slice(0, count)[0] || null, error: null }; },
        async range(from, to) { return { data: rows.slice(from, Math.min(to + 1, count)), error: null }; },
      };
      return chain;
    },
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      if (name === 'xero_shared_status') return { data: { allowanceKnown: true, availableCalls: 900,
        reservedCalls: 0, rateLimit: { observedAt: '2026-09-30T00:00:00.000Z' } }, error: null };
      if (name === 'xero_campaign_create_v1') {
        const campaign = { id: 'campaign-one', run_id: run.id, tenant_id: tenantId, owner_id: userId,
          baseline_at: run.created_at, revision: 1, status: 'active', verified_batch_count: 0 };
        tables.xero_reconciliation_campaigns.push(campaign);
        tables.xero_reconciliation_cases.push(...parameters.p_cases.map((row) => ({ id: row.id,
          campaign_id: campaign.id, case_key: row.caseKey, category: row.category, status: row.status,
          evidence: row, evidence_fingerprint: row.evidenceFingerprint, outcome: null })));
        return { data: campaign, error: null };
      }
      if (name === 'xero_campaign_prepare_v1') {
        const batch = { id: 'batch-one', campaign_id: 'campaign-one', category: parameters.p_category,
          case_ids: parameters.p_case_ids, evidence_fingerprint: parameters.p_forecast.evidenceFingerprint,
          forecast: parameters.p_forecast, revision: 1, status: 'prepared' };
        tables.xero_reconciliation_batches.push(batch);
        return { data: batch, error: null };
      }
      if (name === 'xero_campaign_approve_v1') {
        const batch = tables.xero_reconciliation_batches[0];
        batch.revision += 1; batch.status = 'approved';
        return { data: structuredClone(batch), error: null };
      }
      if (name === 'xero_campaign_claim_v1') {
        const batch = tables.xero_reconciliation_batches[0];
        batch.status = 'running'; batch.claim_id = 'claim-one';
        return { data: { batch: structuredClone(batch), cases: structuredClone(tables.xero_reconciliation_cases), recovering: false }, error: null };
      }
      if (name === 'xero_campaign_finish_v1') {
        const batch = tables.xero_reconciliation_batches[0];
        batch.status = 'completed';
        return { data: structuredClone(batch), error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  return { client, tables, calls };
}

async function seeded() {
  const f = fakeClient();
  const dependency = { client: f.client, accessContext, checkConnection: async () => { throw new Error('Provider must remain untouched'); } };
  await xeroReconciliationCampaignCreate({ runId: run.id, expectedRunRevision: 1 }, dependency);
  return { ...f, dependency };
}

test('pending approval returns complete business evidence and reserves the most expensive credit mix', async () => {
  const f = await seeded();
  const template = f.tables.xero_reconciliation_cases[0];
  f.tables.xero_reconciliation_cases = Array.from({ length: 60 }, (_, index) => ({ ...template,
    id: `case-${String(index).padStart(3, '0')}`, case_key: `case-${index}`,
    evidence: { ...template.evidence, sourceObject: 'Invoice__c', sourceId: `source-${index}`,
      targetId: `target-${index}`, documentNumber: `BUSINESS-${index}`,
      sampleKey: `Invoice__c:${index >= 56 ? 'ACCRECCREDIT' : 'ACCREC'}:AUTHORISED` } }));
  const ids = f.tables.xero_reconciliation_cases.map((row) => row.id);
  f.tables.xero_reconciliation_batches.push({ id: 'approved-many', campaign_id: 'campaign-one',
    category: 'link_only', case_ids: ids, evidence_fingerprint: 'exact-approved-evidence',
    status: 'partial', revision: 3, verified_count: 5, forecast: {},
    evidence: ids.map((id) => ({ id, fingerprint: template.evidence_fingerprint })) });
  const result = await xeroReconciliationCampaignRead({ campaignId: 'campaign-one', limit: 5 }, f.dependency);
  assert.equal(result.cases.length, 5);
  assert.equal(result.pendingBatches[0].caseEvidence.length, 60);
  assert.equal(result.pendingBatches[0].caseEvidence.at(-1).documentNumber, 'BUSINESS-59');
  assert.equal(result.pendingBatches[0].nextRunForecast.verificationCalls, 5,
    'four individually read credits plus one invoice group, even when credits sort beyond the first page');
});

test('create binds a complete saved preview and read returns public paginated cases without provider access', async () => {
  const f = await seeded();
  const result = await xeroReconciliationCampaignRead({ category: 'link_only', status: 'ready', limit: 1 }, f.dependency);
  assert.equal(result.campaign.id, 'campaign-one');
  assert.equal(result.counts.ready, 1);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].targetId, 'xero-invoice');
  assert.equal(result.cases[0].source_payload, undefined);
  assert.equal(result.page.total, 1);
  assert.equal(result.forecast.writeCalls, 0);
  assert.ok(f.calls.some((call) => call.name === 'xero_campaign_create_v1'));
});

test('incomplete saved baseline is rejected before campaign mutation', async () => {
  const f = fakeClient();
  f.tables.xero_financial_sync_runs[0].control_totals.workflowSnapshot.complete = false;
  await assert.rejects(xeroReconciliationCampaignCreate({ runId: run.id, expectedRunRevision: 1 },
    { client: f.client, accessContext }), /incomplete/);
  assert.equal(f.calls.some((call) => call.name === 'xero_campaign_create_v1'), false);
});

test('offline preview and explicit approval bind exact selected case evidence', async () => {
  const f = await seeded();
  const originalRpc = f.client.rpc;
  f.client.rpc = (name, parameters) => name === 'xero_shared_status'
    ? Promise.resolve({ data: { allowanceKnown: false, availableCalls: null, reservedCalls: 0, rateLimit: {} }, error: null })
    : originalRpc(name, parameters);
  const selected = f.tables.xero_reconciliation_cases[0];
  const preview = await xeroReconciliationCampaignPreview({ campaignId: 'campaign-one', category: 'link_only',
    caseIds: [selected.id], expectedRevision: 1 }, f.dependency);
  assert.equal(preview.batch.id, 'batch-one');
  assert.equal(preview.forecast.writeCalls, 0);
  assert.equal(preview.forecast.canProceed, null);
  assert.equal(preview.diffs[0].changes[0].after, 'xero-invoice');
  await assert.rejects(xeroReconciliationCampaignApprove({ campaignId: 'campaign-one', batchId: 'batch-one',
    expectedRevision: 1, expectedFingerprint: preview.evidenceFingerprint }, f.dependency), /reviewed/);
  const approved = await xeroReconciliationCampaignApprove({ campaignId: 'campaign-one', batchId: 'batch-one',
    expectedRevision: 1, expectedFingerprint: preview.evidenceFingerprint, reviewed: true }, f.dependency);
  assert.equal(approved.batch.status, 'approved');
  assert.equal(approved.batch.revision, 2);
});

test('run claims once and leaves uncertain execution open without finish or blind retry', async () => {
  const f = await seeded();
  const id = f.tables.xero_reconciliation_cases[0].id;
  const preview = await xeroReconciliationCampaignPreview({ campaignId: 'campaign-one', category: 'link_only', caseIds: [id], expectedRevision: 1 }, f.dependency);
  await xeroReconciliationCampaignApprove({ campaignId: 'campaign-one', batchId: 'batch-one', expectedRevision: 1,
    expectedFingerprint: preview.evidenceFingerprint, reviewed: true }, f.dependency);
  let executions = 0;
  await assert.rejects(xeroReconciliationCampaignRun({ campaignId: 'campaign-one', batchId: 'batch-one', expectedRevision: 2 }, {
    ...f.dependency, checkConnection: async () => ({ tenantId }), executeBatch: async () => { executions += 1; throw new Error('connection lost'); },
  }), /uncertain/);
  assert.equal(executions, 1);
  assert.equal(f.calls.filter((call) => call.name === 'xero_campaign_claim_v1').length, 1);
  assert.equal(f.calls.filter((call) => call.name === 'xero_campaign_finish_v1').length, 0);
  assert.equal(f.tables.xero_reconciliation_batches[0].status, 'running');
});

test('successful run records supplied outcomes after executor confirmation', async () => {
  const f = await seeded();
  const id = f.tables.xero_reconciliation_cases[0].id;
  const preview = await xeroReconciliationCampaignPreview({ campaignId: 'campaign-one', category: 'link_only', caseIds: [id], expectedRevision: 1 }, f.dependency);
  await xeroReconciliationCampaignApprove({ campaignId: 'campaign-one', batchId: 'batch-one', expectedRevision: 1,
    expectedFingerprint: preview.evidenceFingerprint, reviewed: true }, f.dependency);
  const result = await xeroReconciliationCampaignRun({ campaignId: 'campaign-one', batchId: 'batch-one', expectedRevision: 2 }, {
    ...f.dependency, checkConnection: async () => ({ tenantId }),
    executeBatch: async ({ cases, recovering }) => { assert.equal(recovering, false); return cases.map((row) => ({ caseId: row.id,
      evidenceFingerprint: row.evidenceFingerprint, status: 'reconciled', verificationFingerprint: 'a'.repeat(64),
      mapping: { salesforce_object: 'Invoice__c', salesforce_id: 'invoice-one', xero_document_id: 'xero-invoice' } })); },
  });
  assert.equal(result.outcomes[0].status, 'reconciled');
  assert.equal(f.calls.filter((call) => call.name === 'xero_campaign_finish_v1').length, 1);
});

test('connection check alone may refresh provider authentication', async () => {
  const f = fakeClient();
  let checks = 0;
  const result = await xeroReconciliationConnectionCheck({}, { client: f.client, accessContext,
    now: () => Date.parse('2026-09-30T00:05:00.000Z'),
    checkConnection: async () => { checks += 1; return { tenantId, tenantName: 'Example' }; } });
  assert.equal(checks, 1);
  assert.equal(result.connection.connected, true);
  assert.equal(result.allowance.remaining, 900);
});

test('explicit unknown allowance check uses only an authorised Organisations probe', async () => {
  const f = fakeClient();
  const originalRpc = f.client.rpc;
  let known = false;
  f.client.rpc = (name, parameters) => name === 'xero_shared_status'
    ? Promise.resolve({ data: { allowanceKnown: known, availableCalls: known ? 850 : null,
      reservedCalls: 0, rateLimit: known ? { observedAt: '2026-09-30T00:05:00.000Z' } : {} }, error: null })
    : originalRpc(name, parameters);
  const probes = [];
  const result = await xeroReconciliationConnectionCheck({}, { client: f.client, accessContext,
    now: () => Date.parse('2026-09-30T00:05:00.000Z'),
    checkConnection: async () => ({ tenantId, tenantName: 'Example' }),
    authorizeProbe: async (_connection, options) => { assert.equal(options.actorId, userId); return { id: 'grant-one' }; },
    probeXero: async (_connection, path, options) => { probes.push({ path, options }); known = true; return { Organisations: [] }; } });
  assert.equal(result.allowance.remaining, 850);
  assert.deepEqual(probes.map((entry) => [entry.path, entry.options.method, entry.options.probeId]),
    [['/Organisations', 'GET', 'grant-one']]);
});

test('in-progress coordinated token renewal does not instruct the user to reconnect', async () => {
  const f = fakeClient();
  const result = await xeroReconciliationConnectionCheck({}, { client: f.client, accessContext,
    checkConnection: async () => { throw Object.assign(new Error('renewal busy'), { code: 'XERO_RENEWAL_IN_PROGRESS' }); } });
  assert.equal(result.connection.needsReconnect, false);
  assert.match(result.connection.reason, /already running/);
});

test('running batch recovery accepts only its exact fingerprint with a prior known revision', async () => {
  const f = await seeded();
  const id = f.tables.xero_reconciliation_cases[0].id;
  const preview = await xeroReconciliationCampaignPreview({ campaignId: 'campaign-one', category: 'link_only', caseIds: [id], expectedRevision: 1 }, f.dependency);
  await xeroReconciliationCampaignApprove({ campaignId: 'campaign-one', batchId: 'batch-one', expectedRevision: 1,
    expectedFingerprint: preview.evidenceFingerprint, reviewed: true }, f.dependency);
  const batch = f.tables.xero_reconciliation_batches[0];
  batch.status = 'running'; batch.revision = 3; batch.claim_id = 'claim-one'; batch.claim_case_ids = [id];
  const input = { ...f.dependency, checkConnection: async () => ({ tenantId }), executeBatch: async ({ cases }) => cases.map((row) => ({
    caseId: row.id, evidenceFingerprint: row.evidenceFingerprint, status: 'needs_decision', reason: 'Readback found changed evidence.' })) };
  await assert.rejects(xeroReconciliationCampaignRun({ campaignId: 'campaign-one', batchId: 'batch-one', expectedRevision: 2,
    expectedFingerprint: 'wrong' }, input), /approval changed/);
  const result = await xeroReconciliationCampaignRun({ campaignId: 'campaign-one', batchId: 'batch-one', expectedRevision: 2,
    expectedFingerprint: preview.evidenceFingerprint }, input);
  assert.equal(result.outcomes[0].status, 'needs_decision');
  assert.equal(f.calls.find((entry) => entry.name === 'xero_campaign_claim_v1').parameters.p_revision, 3);
});

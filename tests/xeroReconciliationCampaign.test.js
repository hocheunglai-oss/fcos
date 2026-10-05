import assert from 'node:assert/strict';
import test from 'node:test';
import { xeroReconciliationCampaignApprove, xeroReconciliationCampaignCreate,
  xeroReconciliationCampaignPreview, xeroReconciliationCampaignRead,
  xeroReconciliationCampaignRun, xeroReconciliationCampaignRetry, xeroReconciliationConnectionCheck } from '../api/_xeroReconciliationCampaign.js';
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
      if (name === 'xero_campaign_retry_claim_v1') {
        const batch = tables.xero_reconciliation_batches[0];
        batch.status = 'running'; batch.claim_id = 'retry-claim'; batch.claim_case_ids = parameters.p_case_ids;
        batch.revision += 1;
        batch.retry_authority = { category: 'link_only', claimId: batch.claim_id, caseIds: batch.claim_case_ids,
          fingerprint: batch.evidence_fingerprint, approvedBy: batch.approved_by, approvedAt: batch.approved_at,
          cases: batch.evidence.filter((row) => batch.claim_case_ids.includes(row.id)) };
        const cases = tables.xero_reconciliation_cases.filter((row) => batch.claim_case_ids.includes(row.id))
          .map((row) => ({ ...row.evidence, status: row.status, evidenceFingerprint: row.evidence_fingerprint }));
        return { data: { batch: structuredClone(batch), cases, recovering: false }, error: null };
      }
      if (name === 'xero_campaign_claim_v1') {
        const batch = tables.xero_reconciliation_batches[0];
        const recovering = batch.status === 'running';
        batch.status = 'running'; batch.claim_id ||= 'claim-one'; batch.claim_case_ids ||= batch.case_ids;
        const cases = tables.xero_reconciliation_cases.filter((row) => batch.claim_case_ids.includes(row.id))
          .map((row) => batch.retry_authority ? { ...row.evidence, status: row.status, evidenceFingerprint: row.evidence_fingerprint } : row);
        return { data: { batch: structuredClone(batch), cases: structuredClone(cases), recovering }, error: null };
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

test('reconciled campaign reads replace stale review reasons without changing saved evidence', async () => {
  const f = await seeded();
  const template = f.tables.xero_reconciliation_cases[0];
  const variants = [
    ['link_only', 'Invoice__c', 'Existing Xero document verified and linked.'],
    ['draft', 'Invoice__c', 'Draft created and verified in Xero.'],
    ['contact', 'Account', 'Contact identity verified in Xero.'],
    ['link_only', 'Payment__c', 'Existing payment and invoice allocation verified and linked.'],
  ];
  f.tables.xero_reconciliation_cases = variants.map(([category, sourceObject], index) => ({
    ...template, id: `completed-${index}`, category, status: 'reconciled', outcome: { status: 'reconciled' },
    evidence: { ...template.evidence, sourceObject, reason: 'Exact review and approval required.',
      reasons: ['Exact review and approval required.', 'Document link pending.'] },
  }));
  f.tables.xero_reconciliation_cases.push({ ...template, id: 'waiting', status: 'waiting_dependency',
    evidence: { ...template.evidence, reason: 'Bank evidence missing.', reasons: ['Bank evidence missing.'] } },
  { ...template, id: 'held', status: 'needs_decision', outcome: { reason: 'Settlement changed.' } },
  { ...template, id: 'explicit-completed', status: 'reconciled', outcome: { reason: 'Verified exact receipt.' } });
  const before = structuredClone(f.tables.xero_reconciliation_cases);
  const result = await xeroReconciliationCampaignRead({ campaignId: 'campaign-one', limit: 25 }, f.dependency);
  for (const [index, [, , expected]] of variants.entries()) {
    const row = result.cases.find((entry) => entry.id === `completed-${index}`);
    assert.equal(row.reason, expected);
    assert.deepEqual(row.reasons, [expected]);
    assert.equal(row.evidenceFingerprint, template.evidence_fingerprint);
  }
  assert.equal(result.cases.find((row) => row.id === 'waiting').reason, 'Bank evidence missing.');
  assert.equal(result.cases.find((row) => row.id === 'held').reason, 'Settlement changed.');
  assert.deepEqual(result.cases.find((row) => row.id === 'explicit-completed').reasons, ['Verified exact receipt.']);
  assert.deepEqual(f.tables.xero_reconciliation_cases, before);
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

async function heldRetrySeed(count = 15) {
  const f = await seeded();
  const template = f.tables.xero_reconciliation_cases[0];
  f.tables.xero_reconciliation_cases = Array.from({ length: count }, (_, index) => ({ ...template,
    id: `credit-${String(index).padStart(3, '0')}`, case_key: `credit-${index}`, status: 'needs_decision',
    evidence: { ...template.evidence, id: `credit-${String(index).padStart(3, '0')}`, sourceObject: 'Invoice__c',
      sourceId: `credit-source-${index}`, targetId: `credit-target-${index}`, documentNumber: `CN-${index}`,
      sampleKey: 'Invoice__c:ACCRECCREDIT:AUTHORISED' },
    outcome: { status: 'needs_decision', reason: 'Response defaults need review.' } }));
  const ids = f.tables.xero_reconciliation_cases.map((row) => row.id);
  f.tables.xero_reconciliation_batches.push({ id: 'completed-credits', campaign_id: 'campaign-one', category: 'link_only',
    case_ids: ids, evidence_fingerprint: 'a'.repeat(64), revision: 56, status: 'completed',
    approved_by: userId, approved_at: '2026-09-30T00:00:00Z', verified_count: 592,
    forecast: { writeCalls: 0 }, evidence: ids.map((id) => ({ id, fingerprint: template.evidence_fingerprint })) });
  const dependency = { ...f.dependency, now: () => Date.parse('2026-09-30T00:05:00Z'),
    checkConnection: async () => ({ tenantId }) };
  return { ...f, ids, dependency,
    body: { campaignId: 'campaign-one', batchId: 'completed-credits', caseIds: ids.slice(0, 10), expectedRevision: 56, expectedFingerprint: 'a'.repeat(64) } };
}

test('read returns full eligible held credits and the largest bounded prefix fitting fresh shared allowance', async () => {
  const f = await heldRetrySeed();
  const originalRpc = f.client.rpc;
  f.client.rpc = (name, parameters) => name === 'xero_shared_status'
    ? Promise.resolve({ data: { allowanceKnown: true, availableCalls: 290, reservedCalls: 6,
      rateLimit: { observedAt: '2026-09-30T00:00:00.000Z' } }, error: null }) : originalRpc(name, parameters);
  const before = structuredClone(f.tables.xero_reconciliation_cases);
  const result = await xeroReconciliationCampaignRead({ campaignId: 'campaign-one', limit: 5 }, f.dependency);
  assert.equal(result.retryCandidates.length, 15);
  assert.equal(result.retryBatches.length, 1);
  const retry = result.retryBatches[0];
  assert.equal(retry.totalHeldCount, 15);
  assert.equal(retry.maxCases, 13);
  assert.equal(retry.caseIds.length, 13);
  assert.equal(retry.caseEvidence.length, 13);
  assert.equal(retry.nextRunForecast.callsNeeded, 82);
  assert.equal(retry.nextRunForecast.canProceed, true);
  assert.equal(retry.nextRunForecast.writeCalls, 0);
  assert.equal(retry.nextRunForecast.reserveCalls, 200);
  assert.equal(retry.nextRunForecast.minuteLimit, 45);
  assert.equal(retry.nextRunForecast.inFlightLimit, 2);
  assert.equal(retry.caseEvidence[0].reason, 'Response defaults need review.');
  assert.equal(retry.caseEvidence[0].approvedFingerprint, f.body.expectedFingerprint);
  assert.equal(retry.approvedByName, accessContext.profile.email);
  assert.deepEqual(f.tables.xero_reconciliation_cases, before);
  assert.equal(f.calls.some((entry) => entry.name === 'xero_campaign_retry_claim_v1'), false);
  f.tables.xero_reconciliation_cases[0].evidence_fingerprint = 'b'.repeat(64);
  assert.equal((await xeroReconciliationCampaignRead({ campaignId: 'campaign-one' }, f.dependency)).retryBatches.length, 0,
    'full original batch evidence must still match');
});

test('retry executes only explicitly selected exact held credits under original approval and fresh shared budget', async () => {
  const f = await heldRetrySeed();
  const before = structuredClone(f.tables.xero_reconciliation_cases);
  const result = await xeroReconciliationCampaignRetry(f.body, { ...f.dependency,
    executeBatch: async ({ cases, batch, recovering }) => {
      assert.equal(recovering, false);
      assert.equal(cases.length, 10);
      assert.ok(cases.every((row) => row.status === 'needs_decision'));
      assert.deepEqual(f.tables.xero_reconciliation_cases, before, 'retry never resets held cases');
      assert.equal(batch.forecast.callsNeeded, 73);
      assert.equal(batch.forecast.writeCalls, 0);
      assert.equal(batch.retry_authority.claimId, batch.claim_id);
      assert.equal(batch.retry_authority.fingerprint, f.body.expectedFingerprint);
      return cases.map((row) => ({ caseId: row.id, evidenceFingerprint: row.evidenceFingerprint,
        status: 'needs_decision', reason: 'Fresh source still requires review.' }));
    } });
  assert.equal(result.outcomes.length, 10);
  assert.equal(f.calls.filter((entry) => entry.name === 'xero_campaign_retry_claim_v1').length, 1);
  assert.equal(f.calls.filter((entry) => entry.name === 'xero_campaign_claim_v1').length, 0);
  assert.equal(f.calls.filter((entry) => entry.name === 'xero_campaign_finish_v1').length, 1);
  const claim = f.calls.find((entry) => entry.name === 'xero_campaign_retry_claim_v1').parameters;
  assert.deepEqual(claim, { p_actor: userId, p_campaign: 'campaign-one', p_batch: 'completed-credits',
    p_revision: 56, p_fingerprint: f.body.expectedFingerprint, p_case_ids: f.body.caseIds });
});

test('retry rejects invalid body, stale or changed approval, confirmed and foreign cases, insufficient and stale quota before claim', async t => {
  for (const [label, alter, pattern] of [
    ['duplicate IDs', f => { f.body.caseIds = [f.ids[0], f.ids[0]]; }, /exact held credit/],
    ['over bound', f => { f.body.caseIds = Array.from({ length: 26 }, (_, i) => `id-${i}`); }, /exact held credit/],
    ['extra approval field', f => { f.body.reviewed = true; }, /exact held credit/],
    ['wrong revision', f => { f.body.expectedRevision -= 1; }, /approval changed/],
    ['wrong fingerprint', f => { f.body.expectedFingerprint = 'wrong'; }, /approval changed/],
    ['confirmed case', f => { f.tables.xero_reconciliation_cases[0].status = 'reconciled'; }, /unchanged held/],
    ['noncredit', f => { f.tables.xero_reconciliation_cases[0].evidence.sampleKey = 'Invoice__c:ACCREC:AUTHORISED'; }, /unchanged held/],
    ['foreign approval', f => { f.tables.xero_reconciliation_batches[0].approved_by = 'another-user'; }, /unchanged held/],
    ['changed full batch case evidence', f => { f.tables.xero_reconciliation_cases.at(-1).evidence_fingerprint = 'f'.repeat(64); }, /unchanged held/],
    ['stale quota', f => { f.dependency.now = () => Date.parse('2026-09-30T00:15:00.001Z'); }, /current Xero allowance/],
    ['insufficient quota', f => { f.client.rpc = async name => { assert.equal(name, 'xero_shared_status'); return { data: { allowanceKnown: true, availableCalls: 272, reservedCalls: 0, rateLimit: { observedAt: '2026-09-30T00:00:00Z' } } }; }; }, /current Xero allowance/],
    ['uncertain shared operation', f => { f.client.rpc = async name => { assert.equal(name, 'xero_shared_status'); return { data: { allowanceKnown: true, availableCalls: 900, reservedCalls: 0, unresolvedWrites: 1, rateLimit: { observedAt: '2026-09-30T00:00:00Z' } } }; }; }, /uncertain outcome/],
  ]) await t.test(label, async () => {
    const f = await heldRetrySeed(); alter(f);
    let connectionChecks = 0;
    const before = structuredClone(f.tables);
    await assert.rejects(xeroReconciliationCampaignRetry(f.body, { ...f.dependency, checkConnection: async () => { connectionChecks += 1; return { tenantId }; },
      executeBatch: async () => { throw new Error('Must not execute'); } }), pattern);
    assert.equal(connectionChecks, 0);
    assert.deepEqual(f.tables, before);
    assert.equal(f.calls.some((entry) => entry.name === 'xero_campaign_retry_claim_v1'), false);
  });
});

test('uncertain retry remains an exact running claim recovered through normal Run with a positive held-case forecast', async () => {
  const f = await heldRetrySeed();
  await assert.rejects(xeroReconciliationCampaignRetry(f.body, { ...f.dependency,
    executeBatch: async () => { throw new Error('connection interrupted'); } }), /uncertain/);
  assert.equal(f.tables.xero_reconciliation_batches[0].status, 'running');
  assert.equal(f.calls.filter((entry) => entry.name === 'xero_campaign_finish_v1').length, 0);
  await assert.rejects(xeroReconciliationCampaignRetry(f.body, f.dependency), /approval changed/);
  const readback = await xeroReconciliationCampaignRead({ campaignId: f.body.campaignId }, f.dependency);
  assert.equal(readback.retryBatches.length, 0);
  assert.equal(readback.pendingBatches[0].nextRunForecast.callsNeeded, 73);
  assert.equal(readback.pendingBatches[0].nextRunForecast.recovery, true);
  assert.deepEqual(readback.pendingBatches[0].claim_case_ids, f.body.caseIds);
  const recovered = await xeroReconciliationCampaignRun({ campaignId: f.body.campaignId, batchId: f.body.batchId,
    expectedRevision: f.body.expectedRevision, expectedFingerprint: f.body.expectedFingerprint }, { ...f.dependency,
    executeBatch: async ({ cases, batch, recovering }) => {
      assert.equal(recovering, true);
      assert.equal(batch.retry_authority.claimId, 'retry-claim');
      assert.equal(batch.forecast.callsNeeded, 73);
      return cases.map((row) => ({ caseId: row.id, evidenceFingerprint: row.evidenceFingerprint,
        status: 'needs_decision', reason: 'Fresh readback held.' }));
    } });
  assert.equal(recovered.outcomes.length, 10);
  assert.equal(f.calls.filter((entry) => entry.name === 'xero_campaign_retry_claim_v1').length, 1);
  assert.equal(f.calls.filter((entry) => entry.name === 'xero_campaign_claim_v1').length, 1);
});

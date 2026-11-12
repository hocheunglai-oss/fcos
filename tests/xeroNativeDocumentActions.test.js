import assert from 'node:assert/strict';
import test from 'node:test';
import { xeroNativeDocumentApply, xeroNativeDocumentReconcile, xeroNativeDocumentRecoveryQueue } from '../api/_xeroNativeDocumentActions.js';
import { previewEvidenceHash } from '../api/_xeroPreviewPersistence.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenantId = uuid(1);
const actorId = uuid(2);
const xeroId = uuid(3);
const body = { tenantId, sourceObject: 'Invoice__c', sourceId: 'a10000000000001AAA',
  reviewed: true, operationId: uuid(4), reviewFingerprint: 'a'.repeat(64) };

function fixture({ rounding = false, readError = false, badAccount = false } = {}) {
  const calls = [];
  let row;
  const policy = { account_id: uuid(5), account_code: '7999', tax_type: 'NONE' };
  const payload = { Type: 'ACCREC', Status: 'DRAFT', InvoiceNumber: 'INV-1', Contact: { ContactID: uuid(6) }, CurrencyCode: 'HKD' };
  const draft = { status: 'draft_preview', xeroCollection: 'Invoices', reviewFingerprint: body.reviewFingerprint, payload };
  const review = { ...body, draft, source: { roundingAdjustment: rounding ? { policy } : null } };
  const ledger = {
    get: async () => { calls.push('get'); return row; },
    claim: async ({ requestHash, review: request }) => {
      calls.push('claim');
      row = { actor_id: actorId, tenant_id: tenantId, source_id: body.sourceId, source_object: body.sourceObject,
        operation_id: body.operationId, review_fingerprint: body.reviewFingerprint, request_hash: requestHash,
        request_evidence: request, status: 'intent', observed_xero_id: null, mapping_id: null };
      return { claimed: true, operation: row };
    },
    cancel: async () => { calls.push('cancel'); row.status = 'cancelled_before_send'; return { operation: row }; },
    markSent: async () => {
      calls.push('marker'); Object.assign(row, { status: 'sent', send_started_at: '2026-11-11T12:00:00Z' });
      return { changed: true, operation: row };
    },
    observeId: async (_key, id) => { calls.push('observe'); row.observed_xero_id = id; return { operation: row }; },
    markUnknown: async () => { calls.push('unknown'); row.status = 'unknown'; },
    confirm: async () => {
      calls.push('confirm'); Object.assign(row, { status: 'confirmed', mapping_id: uuid(7) });
      return { operation: row };
    },
  };
  const options = {
    env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true', XERO_TENANT_ID: tenantId },
    accessContext: { profile: { id: actorId } }, client: {},
    getConnection: async () => { calls.push('connect'); return { tenantId, scope: 'accounting.invoices' }; },
    ledgerFor: () => ledger,
    readReview: async (selection, deps) => {
      calls.push('review');
      assert.deepEqual(selection, { tenantId, sourceObject: body.sourceObject, documentId: body.sourceId });
      assert.equal(deps.connection.tenantId, tenantId);
      return { privateReview: review };
    },
    readSettings: async () => {
      calls.push('settings');
      return { accounts: [{ AccountID: policy.account_id, Code: policy.account_code, Status: 'ACTIVE', Type: badAccount ? 'BANK' : 'EXPENSE' }],
        taxes: [{ TaxType: 'NONE', Status: 'ACTIVE', DisplayTaxRate: 0, EffectiveRate: 0, TaxComponents: [] }] };
    },
    transportFor: () => ({
      prepareSend: async () => { calls.push('reserve'); },
      send: async proposal => { calls.push('POST'); assert.deepEqual(proposal, draft); return { Invoices: [{ ...payload, InvoiceID: xeroId }] }; },
      readOutcome: async (_request, original) => {
        calls.push('GET');
        assert.equal(original.observed_xero_id, xeroId);
        if (readError) { readError = false; throw new Error('Read temporarily unavailable'); }
        return { xeroId, mapping: {}, observed: {}, transport: {} };
      },
      settle: async () => { calls.push('settle'); },
    }),
  };
  return { calls, options };
}

test('native draft apply reuses its verified connection and checks rounding before the send marker', async () => {
  const { calls, options } = fixture({ rounding: true });
  assert.deepEqual(await xeroNativeDocumentApply(body, options),
    { operationId: body.operationId, status: 'confirmed', xeroId, mappingId: uuid(7) });
  assert.deepEqual(calls, ['connect', 'get', 'review', 'claim', 'review', 'settings', 'reserve', 'marker', 'POST', 'observe', 'GET', 'confirm', 'settle']);
});

test('inactive rounding evidence cancels before reservation or send', async () => {
  const { calls, options } = fixture({ rounding: true, badAccount: true });
  assert.equal((await xeroNativeDocumentApply(body, options)).status, 'cancelled_before_send');
  assert.deepEqual(calls, ['connect', 'get', 'review', 'claim', 'review', 'settings', 'cancel']);
});

test('recovery rejects another actor without credential refresh and verifies the original with posting disabled', async () => {
  const { calls, options } = fixture({ readError: true });
  await assert.rejects(xeroNativeDocumentApply(body, options), { code: 'XERO_NATIVE_DOCUMENT_UNKNOWN' });
  calls.length = 0;
  const env = { XERO_TENANT_ID: tenantId };
  await assert.rejects(xeroNativeDocumentReconcile(body, { ...options, env, accessContext: { profile: { id: uuid(9) } } }),
    { code: 'XERO_NATIVE_DOCUMENT_OPERATION_MISMATCH' });
  assert.deepEqual(calls, ['get']);
  calls.length = 0;
  const receipt = await xeroNativeDocumentReconcile(body, { ...options, env, getConnection: async () => {
    calls.push('connect');
    return { tenantId, scope: 'accounting.invoices.read' };
  } });
  assert.equal(receipt.status, 'confirmed');
  assert.deepEqual(calls, ['get', 'connect', 'GET', 'confirm', 'settle']);
});

test('native apply fails before journal or review for disabled posting, staged requests, and read-only invoice scope', async () => {
  const { calls, options } = fixture();
  await assert.rejects(xeroNativeDocumentApply(body, { ...options, env: {} }), { code: 'EXTERNAL_ACTION_GATE_DISABLED' });
  await assert.rejects(xeroNativeDocumentReconcile(body, { ...options, env: { VERCEL_ENV: 'preview' } }), { code: 'FCOS_DEPLOYMENT_READ_ONLY' });
  await assert.rejects(xeroNativeDocumentApply({ ...body, reviewed: false }, options), { code: 'XERO_NATIVE_DOCUMENT_REVIEW_REQUIRED' });
  assert.deepEqual(calls, []);
  await assert.rejects(xeroNativeDocumentApply(body, { ...options, getConnection: async () => ({ tenantId, scope: 'accounting.invoices.read' }) }),
    { code: 'XERO_NATIVE_DOCUMENT_SCOPE_MISSING' });
  assert.deepEqual(calls, []);
});

test('native draft discovery uses one scoped journal read and projects no private request evidence', async () => {
  const request = { ...body, source: { record: { Name: 'INV-1', Amount__c: 123 } },
    draft: { reviewFingerprint: body.reviewFingerprint, payload: { InvoiceNumber: 'INV-1', Total: 123 } } };
  const row = { tenant_id: tenantId, actor_id: actorId, source_id: body.sourceId, source_object: body.sourceObject,
    operation_id: body.operationId, review_fingerprint: body.reviewFingerprint, request_hash: previewEvidenceHash(request),
    request_evidence: request, document_number: 'INV-1', status: 'unknown' };
  const steps = [];
  const query = {
    select: (_fields, options) => { steps.push(options); return query; },
    eq: (...args) => { steps.push(args); return query; },
    in: (...args) => { steps.push(args); return query; },
    order: () => query,
    limit: async limit => { steps.push(limit); return { data: [row], count: 1 }; },
  };
  const options = { accessContext: { profile: { id: actorId } }, env: { XERO_TENANT_ID: tenantId },
    getStoredConnection: async () => ({ tenantId }),
    getConnection: () => assert.fail('discovery must not refresh the Xero connection'),
    client: { from: table => { steps.push(table); return query; } } };
  assert.deepEqual(await xeroNativeDocumentRecoveryQueue({ tenantId }, options), { tenantId, hasMore: false, rows: [{
    operationId: body.operationId, sourceId: body.sourceId, sourceObject: body.sourceObject,
    reviewFingerprint: body.reviewFingerprint, documentNumber: 'INV-1', status: 'unknown',
  }] });
  assert.deepEqual(steps, ['xero_native_document_draft_operations', { count: 'exact' }, ['tenant_id', tenantId],
    ['actor_id', actorId], ['status', ['intent', 'sent', 'unknown']], 25]);
  row.request_evidence.source.record.Amount__c = 124;
  await assert.rejects(xeroNativeDocumentRecoveryQueue({ tenantId }, options), { code: 'XERO_NATIVE_DOCUMENT_OPERATION_MISMATCH' });
  row.actor_id = uuid(99);
  await assert.rejects(xeroNativeDocumentRecoveryQueue({ tenantId }, options), { code: 'XERO_NATIVE_DOCUMENT_JOURNAL' });
});

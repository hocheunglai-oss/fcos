import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReconciliationCases, forecastReconciliationBatch, summariseReconciliationCases } from '../api/_xeroReconciliationPolicy.js';

const tenantId = 'tenant-one';
const ownerId = 'reviewer-one';
const run = {
  id: 'saved-run', mode: 'preview', created_at: '2026-09-29T10:00:00Z',
  control_totals: { workflowSnapshot: { complete: true, tenantId, includePayments: true,
    expectedItemCount: 2, controlsFingerprint: 'controls-v1', automaticMappingPolicy: { version: 1 },
    payments: { tenantId, rows: [{ salesforcePaymentId: 'pay-1', salesforcePaymentName: 'First payment',
      supplierInvoiceId: 'supplier-1', action: 'blocked', status: 'blocked',
      blockers: ['The Salesforce document is not durably linked to Xero. Run the document check again.'],
      blockerCodes: ['invoice_link_pending'], amount: 25, currency: 'USD', sourceFingerprint: 'payment-v1',
      reviewFingerprint: 'review-v1' }] } } },
};
const items = [
  { id: 'item-1', run_id: run.id, source_object: 'Supplier_Invoice__c', source_id: 'supplier-1',
    source_document_number: 'DUPLICATE', source_total: 25, currency: 'USD', proposed_action: 'link', status: 'eligible',
    blockers: [], differences: [], xero_document_id: 'xero-one', xero_payload: { id: 'xero-one', total: 25 },
    proposed_payload: {}, source_payload: { salesforceObject: 'Supplier_Invoice__c', salesforceId: 'supplier-1',
      accountName: 'Acme', stemId: 'stem-1', invoiceDate: '2026-02-01', deliveryDate: '2026-01-31',
      sourceFingerprint: 'source-v1', financialFingerprint: 'financial-v1', contactId: 'contact-one' } },
  { id: 'item-2', run_id: run.id, source_object: 'Supplier_Invoice__c', source_id: 'supplier-2',
    source_document_number: 'DUPLICATE', source_total: 50, currency: 'USD', proposed_action: 'create_draft', status: 'blocked',
    blockers: ['No verified issued source file exists.'], differences: [], proposed_payload: {},
    source_payload: { salesforceObject: 'Supplier_Invoice__c', salesforceId: 'supplier-2',
      invoiceDate: '2026-02-01', deliveryDate: '2026-01-30', sourceFingerprint: 'source-v2' } },
];

function build(changes = {}) {
  return buildReconciliationCases({ tenantId, run, items, ownerId, ...changes });
}

test('complete saved 2026 baseline keeps exact source identities, dependency and financial hold', () => {
  const cases = build();
  assert.equal(cases.length, 3);
  assert.equal(new Set(cases.map((item) => item.caseKey)).size, 3);
  const first = cases.find((item) => item.sourceId === 'supplier-1');
  const second = cases.find((item) => item.sourceId === 'supplier-2');
  const payment = cases.find((item) => item.sourceId === 'pay-1');
  assert.equal(first.category, 'link_only');
  assert.equal(first.status, 'ready');
  assert.equal(first.targetId, 'xero-one');
  assert.equal(second.category, 'draft');
  assert.equal(second.status, 'needs_decision');
  assert.match(second.reason, /issued source file/i);
  assert.equal(payment.status, 'waiting_dependency');
  assert.deepEqual(payment.dependencies, [first.caseKey]);
  assert.equal(payment.targetId, null);
  assert.equal(first.ownerId, ownerId);
  assert.equal(summariseReconciliationCases(cases).reconciled, 0);
});

test('already protected mapped payment is reconciled, queued link is not counted as resolved', () => {
  const existing = structuredClone(run);
  existing.control_totals.workflowSnapshot.payments.rows[0] = {
    ...existing.control_totals.workflowSnapshot.payments.rows[0], action: 'payment_link', status: 'protected', blockers: [], blockerCodes: [] };
  const cases = build({ run: existing });
  const summary = summariseReconciliationCases(cases);
  assert.equal(summary.reconciled, 1);
  assert.equal(summary.ready, 1);
  assert.equal(summary.needsDecision, 1);
});

test('a proof changes with accounting evidence but not Salesforce modification timestamp', () => {
  const first = build().find((item) => item.sourceId === 'supplier-1').evidenceFingerprint;
  const timestampOnly = structuredClone(items);
  timestampOnly[0].source_payload.lastModifiedDate = '2026-09-30T12:00:00Z';
  assert.equal(build({ items: timestampOnly }).find((item) => item.sourceId === 'supplier-1').evidenceFingerprint, first);
  const changed = structuredClone(items);
  changed[0].xero_payload.total = 26;
  assert.notEqual(build({ items: changed }).find((item) => item.sourceId === 'supplier-1').evidenceFingerprint, first);
  changed[0].xero_payload.total = 25;
  changed[0].source_payload.financialFingerprint = 'financial-v2';
  assert.notEqual(build({ items: changed }).find((item) => item.sourceId === 'supplier-1').evidenceFingerprint, first);
  const unrelatedControl = structuredClone(run);
  unrelatedControl.control_totals.workflowSnapshot.controlsFingerprint = 'another-account-mapping';
  unrelatedControl.control_totals.workflowSnapshot.automaticMappingPolicy = { version: 2 };
  assert.equal(build({ run: unrelatedControl }).find((item) => item.sourceId === 'supplier-1').evidenceFingerprint, first);
});

test('pre-2026 delivery is explicitly excluded and boundary date stays in scope', () => {
  const old = structuredClone(items);
  old[0].source_payload.invoiceDate = '2025-12-31';
  old[0].source_payload.deliveryDate = '2025-12-31';
  assert.equal(build({ items: old }).find((item) => item.sourceId === 'supplier-1').status, 'legacy_excluded');
  old[0].source_payload.deliveryDate = '2026-01-01';
  assert.equal(build({ items: old }).find((item) => item.sourceId === 'supplier-1').status, 'ready');
  old[0].source_payload.documentFieldProjection = { scope: 'current' };
  old[0].source_payload.deliveryDate = '2025-12-31';
  assert.equal(build({ items: old }).find((item) => item.sourceId === 'supplier-1').status, 'ready');
});

test('server-classified link with cosmetic differences remains ready for exact review', () => {
  const cosmetic = structuredClone(items);
  cosmetic[0].differences = [{ field: 'description', xero: 'Old', salesforce: 'New' }];
  cosmetic[0].source_payload.reviewRequired = true;
  const result = build({ items: cosmetic }).find((item) => item.sourceId === 'supplier-1');
  assert.equal(result.category, 'link_only');
  assert.equal(result.status, 'ready');
  assert.match(result.reasons.join(' '), /Finance review/);
});

test('unknown or incomplete saved preview cannot silently produce a campaign', () => {
  const incomplete = structuredClone(run);
  incomplete.control_totals.workflowSnapshot.complete = false;
  assert.throws(() => build({ run: incomplete }), /complete saved/);
  assert.throws(() => build({ items: items.slice(0, 1) }), /complete saved/);
  assert.throws(() => build({ tenantId: 'another-tenant' }), /complete saved/);
  const duplicate = [...items, { ...items[0] }];
  const duplicateRun = structuredClone(run);
  duplicateRun.control_totals.workflowSnapshot.expectedItemCount = 3;
  assert.throws(() => build({ run: duplicateRun, items: duplicate }), /Duplicate source document/);
});

test('overlapping exact Xero targets are held with both source identities intact', () => {
  const overlap = structuredClone(items);
  overlap[1].xero_document_id = 'xero-one';
  overlap[1].xero_payload = { id: 'xero-one', total: 50 };
  const cases = build({ items: overlap });
  const documents = cases.filter((item) => item.sourceObject === 'Supplier_Invoice__c');
  assert.equal(documents.length, 2);
  assert.ok(documents.every((item) => item.status === 'needs_decision' && item.category === 'decision'));
  assert.ok(documents.every((item) => item.reason.includes('same') || item.reason.includes('More than one')));
  assert.notEqual(documents[0].caseKey, documents[1].caseKey);
});

test('forecasts expose separate conservative read, write, verification and reserve consumption', () => {
  const cases = build();
  const links = cases.filter((item) => item.category === 'link_only');
  const forecast = forecastReconciliationBatch({ category: 'link_only', cases: links,
    inventoryCalls: 3, otherActivityCalls: 2, recoveryCalls: 1, remainingCalls: 207 });
  assert.deepEqual(forecast, { readCalls: 4, writeCalls: 0, verificationCalls: 1,
    recoveryCalls: 1, otherActivityCalls: 2, callsNeeded: 8, canProceed: false,
    reason: 'Estimated calls would cross the reserved Xero allowance.' });
  const drafts = [{ category: 'draft', status: 'ready' }, { category: 'draft', status: 'needs_decision' }];
  assert.equal(forecastReconciliationBatch({ category: 'draft', cases: drafts }).writeCalls, 1);
  assert.equal(forecastReconciliationBatch({ category: 'draft', cases: drafts }).canProceed, null);
  assert.equal(forecastReconciliationBatch({ category: 'draft', cases: drafts }).recoveryCalls, 1);
});

test('bounded known document claims forecast bulk invoice reads and individual credits; unknown or larger scope stays conservative', () => {
  const cases = Array.from({ length: 25 }, (_, index) => ({ category: 'link_only', status: 'ready',
    sourceObject: 'Invoice__c', targetId: `target-${index}`, sampleKey: 'Invoice__c:ACCREC:ordinary' }));
  const invoiceOnly = forecastReconciliationBatch({ category: 'link_only', cases, inventoryCalls: 41, remainingCalls: 245 });
  assert.equal(invoiceOnly.readCalls, 42);
  assert.equal(invoiceOnly.verificationCalls, 1);
  assert.equal(invoiceOnly.recoveryCalls, 1);
  assert.equal(invoiceOnly.linkVerificationMode, 'bulk_exact_documents_v1');
  assert.equal(invoiceOnly.canProceed, true);
  const mixed = forecastReconciliationBatch({ category: 'link_only', cases: cases.map((row, index) =>
    index === 0 ? { ...row, sampleKey: 'Invoice__c:ACCRECCREDIT:ordinary' } : row) });
  assert.equal(mixed.verificationCalls, 2);
  const unknown = forecastReconciliationBatch({ category: 'link_only', cases: cases.map((row, index) =>
    index === 0 ? { ...row, sampleKey: null } : row) });
  assert.equal(unknown.verificationCalls, 25); assert.equal(unknown.linkVerificationMode, undefined);
  const larger = forecastReconciliationBatch({ category: 'link_only', cases: [...cases, { ...cases[0], targetId: 'extra' }] });
  assert.equal(larger.verificationCalls, 26); assert.equal(larger.linkVerificationMode, undefined);
});

test('one Contact-family case owns dependencies without becoming duplicate document ownership', () => {
  const saved = structuredClone(run); const documents = structuredClone(items);
  documents[0].source_payload.accountId = '001000000000001';
  documents[0].source_payload.contactId = null;
  documents[0].blockers = ['No uniquely matching active Contact is available.'];
  documents[0].proposed_action = 'blocked';
  documents[0].status = 'blocked';
  const family = { id: `${tenantId}:Account:001000000000001`, caseKey: `${tenantId}:Account:001000000000001`,
    category: 'contact', status: 'ready', sourceObject: 'Account', sourceId: '001000000000001',
    sourceIds: ['001000000000001', '001000000000002'], ownerId, targetId: 'archived-contact',
    reason: 'Restore the verified archived Contact.', evidenceFingerprint: 'a'.repeat(64) };
  saved.control_totals.workflowSnapshot.contactCases = [family];
  const cases = build({ run: saved, items: documents });
  const dependent = cases.find(row => row.sourceId === 'supplier-1');
  assert.equal(cases.filter(row => row.sourceObject === 'Account').length, 1);
  assert.equal(dependent.status, 'waiting_dependency');
  assert.deepEqual(dependent.dependencies, [family.caseKey]);
  family.status = 'needs_decision'; family.reason = 'Two active Contacts have the same name.';
  const held = build({ run: saved, items: documents }).find(row => row.sourceId === 'supplier-1');
  assert.equal(held.status, 'needs_decision');
  assert.match(held.reason, /Two active/);
});

test('an otherwise verified payment requiring human review can enter the exact approval batch', () => {
  const saved = structuredClone(run);
  saved.control_totals.workflowSnapshot.payments.rows[0] = { ...saved.control_totals.workflowSnapshot.payments.rows[0],
    action: 'payment_reference_link', status: 'eligible', blockers: [], blockerCodes: [], reviewRequired: true,
    xeroPaymentId: 'payment-target' };
  const row = build({ run: saved }).find(row => row.sourceObject === 'Payment__c');
  assert.equal(row.category, 'link_only'); assert.equal(row.status, 'ready');
  assert.match(row.reasons.join(' '), /Finance review/);
});

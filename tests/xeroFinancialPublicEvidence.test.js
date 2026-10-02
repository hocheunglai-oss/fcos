import assert from 'node:assert/strict';
import test from 'node:test';
import { publicPaymentSnapshot, publicFinancialControlTotals } from '../api/_xeroFinancialPublicEvidence.js';
import { evaluateRemittanceSummary, currentRemittanceSummary } from '../api/_xeroRemittanceSummary.js';
import { isRemittanceSummary, reconciliationBucket, paymentReferenceReviewEligible, paymentReferenceReviewTarget,
  restoreReviewSelection } from '../src/lib/financialWorkflowUi.js';
import { summarizeXeroFinancialReconciliation } from '../src/lib/xeroFinancialReconciliation.js';

const hash = 'a'.repeat(64);
const sentinel = 'SERVER_ONLY_FULL_PROOF_SENTINEL';
const id = n => `a0S${String(n).padStart(12, '0')}`;
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function payment(overrides = {}) {
  return { salesforcePaymentId: id(1), salesforcePaymentName: 'Allocation 1', stemId: 'a0H000000000001',
    supplierInvoiceId: null, type: 'Receivable', amount: 50, currency: 'USD', paymentDate: '2026-01-02', bank: 'UBS',
    action: 'payment_apply', status: 'eligible', blockers: [], blockerCodes: [], warnings: ['Preserve current details'],
    documentMappingId: 'document-mapping', xeroPaymentId: null, amountDue: 50, sourceFingerprint: hash,
    reviewFingerprint: hash, xeroDocumentUrl: 'https://example.test/invoices/existing', xeroDocumentId: 'existing-invoice',
    xeroDocumentNumber: 'EXISTING-1', bankAccountId: 'existing-bank', bankAccountCode: '1000', bankAccountName: 'USD bank',
    proposedPayment: { Invoice: { InvoiceID: 'existing-invoice' }, Account: { AccountID: 'existing-bank' },
      Date: '2026-01-02', Amount: 50, Reference: 'Allocation 1' },
    bankSourceEvidence: { source: { parent: sentinel } }, buyerDocumentEvidence: { documents: [sentinel] },
    retainedReferenceEvidence: { bankSourceEvidence: sentinel, documentMapping: sentinel },
    documentMappingSnapshot: { retained_differences: { privateProof: sentinel } }, bankMappingSnapshot: { privateProof: sentinel },
    bankEvidence: { source: { parent: sentinel, allocations: [sentinel] }, policyVersion: 'receivable_group_bank_v1',
      parentId: id(9), bank: 'UBS', date: '2026-01-02', currency: 'USD', allocationCount: 2, fingerprint: hash,
      allocationIds: [id(1), id(2)], familyFingerprint: sentinel, membershipFingerprint: sentinel }, ...overrides };
}

function realSummary() {
  const common = { Account__c: '001000000000001', Date__c: '2026-01-02', CurrencyIsoCode: 'USD',
    _currency: { currency: 'USD', blockers: [] }, Is_Deposit__c: false, Is_Volume_Discount__c: false,
    Commission_Invoice__c: null, Supplier_Invoice__c: null, Reference__c: null, Bank__c: 'UBS' };
  const parent = { ...common, Id: id(9), Name: 'Receipt', RecordType: { DeveloperName: 'Receivable_Remittance' },
    Amount__c: 100, Remittance__c: null, STEM__c: null };
  const siblings = [1, 2].map(n => ({ ...common, Id: id(n), Name: `Allocation ${n}`,
    RecordType: { DeveloperName: 'Receivable' }, Amount__c: 50, Remittance__c: parent.Id, STEM__c: `a0H${String(n).padStart(12, '0')}` }));
  const result = evaluateRemittanceSummary(parent, { siblings, visiblePayments: [parent, ...siblings], complete: true, headerUnmapped: true });
  assert.equal(result.eligible, true, result.blocker);
  return { parent, evidence: result.evidence, row: payment({ salesforcePaymentId: parent.Id, salesforcePaymentName: parent.Name,
    action: 'remittance_summary', status: 'informational', proposedPayment: null, xeroPaymentId: null, remittanceSummary: result.evidence }) };
}

test('null, absent and empty public snapshots retain their original meaning', () => {
  for (const value of [null, undefined]) {
    assert.equal(publicPaymentSnapshot(value), value); assert.equal(publicFinancialControlTotals(value), value);
  }
  for (const value of [{}, { rows: null }, { rows: [] }]) assert.deepEqual(publicPaymentSnapshot(value), value);
  assert.deepEqual(publicPaymentSnapshot({ rows: [null] }), { rows: [null] });
  assert.deepEqual(publicFinancialControlTotals({ workflowSnapshot: null }), { workflowSnapshot: null });
});

test('public payment projection removes full proofs and preserves every other review and presentation field', () => {
  const row = payment(); const input = freeze({ rows: [row], tenantId: 'tenant', summary: { total: 1, paymentApply: 1 },
    externalWriteEnabled: false, rateLimit: { dayRemaining: 201 }, observedAt: '2026-09-28T10:00:00Z', actor: { id: 'actor' } });
  const before = structuredClone(input); const result = publicPaymentSnapshot(input);
  assert.deepEqual(input, before); assert.notEqual(result, input); assert.notEqual(result.rows, input.rows); assert.notEqual(result.rows[0], row);
  const removed = new Set(['bankSourceEvidence', 'buyerDocumentEvidence', 'retainedReferenceEvidence', 'documentMappingSnapshot', 'bankMappingSnapshot']);
  for (const [field, value] of Object.entries(row)) {
    if (removed.has(field)) assert.equal(Object.hasOwn(result.rows[0], field), false, field);
    else if (field !== 'bankEvidence') assert.deepEqual(result.rows[0][field], value, field);
  }
  assert.deepEqual(result.rows[0].bankEvidence, { policyVersion: 'receivable_group_bank_v1', parentId: id(9), bank: 'UBS',
    date: '2026-01-02', currency: 'USD', allocationCount: 2, fingerprint: hash });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel));
  assert.equal(publicPaymentSnapshot(result).rows[0].reviewFingerprint, hash);
  assert.deepEqual(publicPaymentSnapshot(result), result, 'public projections are idempotent');
});

test('legacy bank metadata remains visible but arbitrary nested values cannot enter the bank summary', () => {
  const bankEvidence = { source: 'Receivable_Remittance', parentId: id(9), bank: 'UBS', date: '2026-01-02', currency: 'USD',
    siblingCount: 2, siblingsDigest: hash, parentFingerprint: sentinel, extra: [sentinel] };
  const projected = publicPaymentSnapshot({ rows: [payment({ bankEvidence }), payment({ bankEvidence: null }),
    payment({ bankEvidence: { source: [sentinel], bank: { secret: sentinel }, siblingCount: [sentinel], fingerprint: null } })] });
  assert.deepEqual(projected.rows[0].bankEvidence, { source: 'Receivable_Remittance', parentId: id(9), bank: 'UBS',
    date: '2026-01-02', currency: 'USD', siblingCount: 2, siblingsDigest: hash });
  assert.equal(projected.rows[1].bankEvidence, null);
  assert.deepEqual(projected.rows[2].bankEvidence, { fingerprint: null });
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(sentinel));
});

test('summary allocations remain complete and UI-equivalent while compact metadata cannot replay as server proof', () => {
  const { row, parent, evidence } = realSummary();
  assert.ok(currentRemittanceSummary({ ...parent, _remittanceSummary: evidence }));
  const before = structuredClone(row); const projected = publicPaymentSnapshot({ rows: [row] }).rows[0];
  assert.deepEqual(row, before);
  assert.deepEqual(projected.remittanceSummary, { policyVersion: evidence.policyVersion, parentId: parent.Id,
    allocationIds: [...evidence.allocationIds], allocationCount: 2, currency: 'USD', totalCents: '10000', fingerprint: evidence.fingerprint });
  assert.notEqual(projected.remittanceSummary.allocationIds, evidence.allocationIds);
  assert.equal(isRemittanceSummary(projected), isRemittanceSummary(row));
  assert.equal(reconciliationBucket(projected, 'payment'), 'summary');
  assert.equal(currentRemittanceSummary({ ...parent, _remittanceSummary: projected.remittanceSummary }), null);
  const selection = [{ key: row.salesforcePaymentId, sourceFingerprint: row.sourceFingerprint, reviewFingerprint: row.reviewFingerprint }];
  assert.equal(restoreReviewSelection(selection, [projected], 'payment').size, 0);
});

test('all UI buckets and completion denominator stay identical, including held children and failed summary shapes', () => {
  const rows = [realSummary().row, payment(), payment({ action: 'payment_link', status: 'protected', proposedPayment: null }),
    payment({ action: 'blocked', status: 'blocked', proposedPayment: null, blockers: ['No linked buyer invoice exists for this STEM.'], blockerCodes: ['invoice_link_pending'] }),
    payment({ action: 'blocked', status: 'failed', proposedPayment: null, blockers: ['Actual bank must be verified'], blockerCodes: ['finance_exception'] }),
    payment({ action: 'remittance_summary', status: 'informational', proposedPayment: null,
      remittanceSummary: { policyVersion: 'unknown', allocationCount: 2, allocationIds: [id(1), id(2)], fingerprint: hash, source: sentinel } })];
  const projected = publicPaymentSnapshot({ rows }).rows;
  assert.deepEqual(projected.map(row => reconciliationBucket(row, 'payment')), rows.map(row => reconciliationBucket(row, 'payment')));
  assert.deepEqual(projected.map(isRemittanceSummary), rows.map(isRemittanceSummary));
  assert.deepEqual(summarizeXeroFinancialReconciliation({ payments: projected, documents: [] }),
    summarizeXeroFinancialReconciliation({ payments: rows, documents: [] }));
});

test('public summary keeps every allocation ID and explicit null date without introducing a count cap', () => {
  const allocationIds = Array.from({ length: 2001 }, (_, n) => id(n + 100));
  const row = payment({ action: 'remittance_summary', status: 'informational', proposedPayment: null,
    remittanceSummary: { policyVersion: 'remittance_summary_v1', allocationCount: allocationIds.length,
      allocationIds, date: null, currency: 'USD', parentId: id(9), totalCents: '10000', fingerprint: hash,
      source: { private: sentinel } } });
  const result = publicPaymentSnapshot({ rows: [row] }).rows[0];
  assert.deepEqual(result.remittanceSummary.allocationIds, allocationIds);
  assert.equal(result.remittanceSummary.allocationCount, 2001);
  assert.equal(result.remittanceSummary.date, null);
  assert.equal(isRemittanceSummary(result), isRemittanceSummary(row));
});

test('pending and accepted reference review UI preserves exact hashes, references, invoice and bank details', () => {
  const pending = payment({ action: 'payment_reference_link', status: 'eligible', reviewRequired: true, acceptedReference: false,
    proposedPayment: null, xeroPaymentId: 'existing-payment', referenceReviewFingerprint: hash,
    referenceComparison: { sourceReference: null, sourceFallbackReference: 'Allocation 1', xeroReference: 'AP-HISTORIC' } });
  const accepted = { ...pending, action: 'payment_link', status: 'protected', reviewRequired: false, acceptedReference: true };
  const rows = [pending, accepted]; const projected = publicPaymentSnapshot({ rows }).rows;
  assert.equal(paymentReferenceReviewEligible(projected[0]), true);
  assert.equal(paymentReferenceReviewEligible(projected[1]), false);
  const target = paymentReferenceReviewTarget(projected, [pending]);
  const previousTarget = paymentReferenceReviewTarget(rows, [pending]);
  assert.equal(target.eligible, previousTarget.eligible);
  assert.deepEqual(target.rows.map(row => [row.salesforcePaymentId, row.sourceFingerprint, row.reviewFingerprint]),
    previousTarget.rows.map(row => [row.salesforcePaymentId, row.sourceFingerprint, row.reviewFingerprint]));
  assert.equal(reconciliationBucket(projected[1], 'payment'), 'matched');
  for (let n = 0; n < rows.length; n += 1) {
    for (const field of ['acceptedReference', 'referenceComparison', 'referenceReviewFingerprint', 'sourceFingerprint', 'reviewFingerprint',
      'bankAccountId', 'bankAccountCode', 'bankAccountName', 'xeroPaymentId', 'xeroDocumentId', 'xeroDocumentNumber', 'xeroDocumentUrl']) {
      assert.deepEqual(projected[n][field], rows[n][field], field);
    }
  }
});

test('financial totals preserve ordinary currency totals but expose only workflow metadata', () => {
  const input = freeze({ postingMode: 'authorised', buyer: { USD: { count: 3, total: 150 } }, supplier: { EUR: { count: 2, total: 200 } },
    workflowSnapshot: { reconciliationVersion: 15, tenantId: 'tenant', includePayments: true, recordExactMatches: false,
      checkedAt: '2026-09-28T10:00:00Z', payments: { rows: [payment()] }, products: [sentinel], organisation: { proof: sentinel },
      controlsFingerprint: sentinel, controlproof: { private: sentinel }, inputEvidenceHash: sentinel } });
  const before = structuredClone(input); const result = publicFinancialControlTotals(input);
  assert.deepEqual(input, before); assert.notEqual(result, input); assert.notEqual(result.workflowSnapshot, input.workflowSnapshot);
  assert.deepEqual(result, { postingMode: 'authorised', buyer: input.buyer, supplier: input.supplier,
    workflowSnapshot: { reconciliationVersion: 15, tenantId: 'tenant', includePayments: true, recordExactMatches: false, checkedAt: '2026-09-28T10:00:00Z' } });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel));
  assert.deepEqual(publicFinancialControlTotals(result), result);
  assert.deepEqual(publicFinancialControlTotals({ total: 0 }), { total: 0 });
});

test('4383 proof-bearing rows lose full evidence bytes without dropping identities, blockers or legitimate fields', t => {
  const fullProof = { ...payment().bankEvidence, source: { parent: sentinel, allocations: Array(20).fill(sentinel.repeat(10)) } };
  const rows = Array.from({ length: 4383 }, (_, n) => payment({ salesforcePaymentId: id(n + 100), salesforcePaymentName: `Allocation ${n}`,
    bankEvidence: fullProof, bankSourceEvidence: fullProof, retainedReferenceEvidence: { source: fullProof },
    action: n % 2 ? 'blocked' : 'payment_apply', status: n % 2 ? 'blocked' : 'eligible',
    blockers: n % 2 ? ['The exact invoice mapping must be verified.'] : [], blockerCodes: n % 2 ? ['invoice_link_pending'] : [] }));
  const output = publicPaymentSnapshot({ rows, summary: { total: rows.length } });
  assert.equal(output.rows.length, 4383); assert.equal(output.summary.total, 4383);
  assert.deepEqual(output.rows.map(row => row.salesforcePaymentId), rows.map(row => row.salesforcePaymentId));
  assert.deepEqual(output.rows.map(row => row.blockers), rows.map(row => row.blockers));
  assert.deepEqual(output.rows.map(row => row.proposedPayment), rows.map(row => row.proposedPayment));
  assert.deepEqual(output.rows.map(row => row.bankAccountName), rows.map(row => row.bankAccountName));
  const serialized = JSON.stringify(output);
  // Row strings vary in legitimate size. Projection reduces full evidence; it
  // does not impose a transport guarantee by trimming financial/UI fields.
  const internalRowsBytes = 2 + rows.reduce((total, row, n) => total + Buffer.byteLength(JSON.stringify(row)) + (n ? 1 : 0), 0);
  const publicRowsBytes = Buffer.byteLength(JSON.stringify(output.rows));
  assert.ok(publicRowsBytes < internalRowsBytes / 10, `public rows: ${publicRowsBytes}; internal rows: ${internalRowsBytes}`);
  t.diagnostic(`4383 complete rows: internal ${internalRowsBytes} bytes; public ${publicRowsBytes} bytes`);
  assert.doesNotMatch(serialized, new RegExp(sentinel));
  assert.equal(rows[0].bankEvidence.source.parent, sentinel, 'full internal source remains available');
});

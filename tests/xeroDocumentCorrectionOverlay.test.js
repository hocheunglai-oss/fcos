import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmedDocumentCorrection } from '../api/_xeroDocumentCorrectionOverlay.js';
import { documentCorrectionHash as hash } from '../api/_xeroDocumentCorrectionPersistence.js';
import { classifyXeroFinancialDocument, normalizeXeroInvoice } from '../api/_xeroFinancialSync.js';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function fixture({ newMapping = false } = {}) {
  const source = { salesforceObject: 'Invoice__c', salesforceId: 'a01000000000001AAA', documentNumber: '25070T-INV-1',
    accountId: '001000000000001AAA', accountName: 'Fixture Buyer', contactId: uuid(10), currency: 'USD', total: 100,
    xeroType: 'ACCREC', xeroCollection: 'Invoices', sourceFingerprint: 'legacy-source-proof', financialFingerprint: 'legacy-financial-proof',
    documentFieldSourceFingerprint: 'exact-current-source-proof', documentFieldProjection: { fingerprint: 'current-projection-proof' } };
  const before = { InvoiceID: uuid(20), Type: 'ACCREC', Status: 'PAID', Date: '2026-01-27', DueDate: '2026-01-30',
    InvoiceNumber: 'OLD-NUMBER', Reference: 'OLD-REFERENCE', Contact: { ContactID: source.contactId, Name: source.accountName },
    CurrencyCode: 'USD', CurrencyRate: 7.78345, LineAmountTypes: 'NoTax', SubTotal: 100, TotalTax: 0, Total: 100,
    AmountDue: 0, AmountPaid: 100, AmountCredited: 0, IsDiscounted: false, Payments: [{ PaymentID: uuid(30), Amount: 100 }],
    CreditNotes: [], Prepayments: [], Overpayments: [], UpdatedDateUTC: '2026-01-28T00:00:00Z',
    LineItems: [{ LineItemID: 'original-line', Description: 'Original description', Quantity: 1, UnitAmount: 100,
      LineAmount: 100, AccountCode: '200', TaxType: 'NONE', TaxAmount: 0 }] };
  const after = { ...structuredClone(before), DueDate: '2026-02-25', InvoiceNumber: source.documentNumber, Reference: 'HUAYUE' };
  after.LineItems[0].Description = 'INVOICE 28/1/2026';
  const mapping = { id: uuid(40), salesforce_object: source.salesforceObject, salesforce_id: source.salesforceId,
    xero_document_id: before.InvoiceID, xero_document_type: before.Type, xero_contact_id: source.contactId,
    retained_differences: { accountId: source.accountId, originalAudit: { originalNumber: 'KEEP', signedTotal: 100 } },
    source_fingerprint: source.sourceFingerprint, financial_fingerprint: source.financialFingerprint, protected_legacy: true };
  const evidence = { policyVersion: 'document_field_correction_v1', source: { object: source.salesforceObject, id: source.salesforceId,
    accountId: source.accountId, sourceFingerprint: source.sourceFingerprint, financialFingerprint: source.financialFingerprint,
    fieldSourceFingerprint: source.documentFieldSourceFingerprint, projectionFingerprint: source.documentFieldProjection.fingerprint },
    before: structuredClone(before), expectedAfter: structuredClone(after), mappingSnapshot: newMapping ? null : structuredClone(mapping),
    authority: { basis: 'explicit_user_requested_2026_field_correction', scopeHash: 'reviewed-original-scope', reviewedAt: '2026-09-28T01:00:00Z' } };
  const claim = { id: uuid(50), tenant_id: uuid(1), xero_invoice_id: before.InvoiceID, mapping_id: newMapping ? null : mapping.id,
    evidence, evidence_hash: hash(evidence), created_at: '2026-09-28T01:00:00Z', status: 'confirmed' };
  const eventEvidence = { observed: structuredClone(after), basis: 'exact_provider_readback' };
  const event = { id: uuid(60), claim_id: claim.id, sequence: 2, status: 'confirmed', evidence: eventEvidence, evidence_hash: hash(eventEvidence) };
  if (newMapping) mapping.retained_differences.documentFieldCorrection = { claimId: claim.id, policy: 'document_field_correction_v1' };
  const controls = { documentCorrectionClaims: [claim], documentCorrectionEvents: [event] };
  const target = normalizeXeroInvoice(after);
  const verify = () => confirmedDocumentCorrection(source, target, mapping, controls, normalizeXeroInvoice);
  return { source, before, after, mapping, claim, event, controls, target, verify };
}

test('an exact confirmed correction overlays original proof without mutating historical mappings or receipts', () => {
  const f = fixture(); const mapping = structuredClone(f.mapping); const before = structuredClone(f.before); const claims = structuredClone(f.controls);
  const receipt = f.verify(); assert.equal(receipt.claimId, f.claim.id);
  assert.equal(receipt.before.invoiceNumber, 'OLD-NUMBER'); assert.equal(receipt.after.invoiceNumber, '25070T-INV-1');
  assert.deepEqual(f.mapping, mapping); assert.deepEqual(f.before, before); assert.deepEqual(f.controls, claims);
  const result = classifyXeroFinancialDocument(f.source, [f.target], { storedMapping: f.mapping, correctionControls: f.controls });
  assert.equal(result.action, 'protected_legacy'); assert.equal(result.status, 'protected'); assert.equal(result.acceptedLegacy, true);
  assert.equal(result.proposedPayload, null); assert.deepEqual(result.blockers, []);
  assert.equal(result.documentFieldCorrection.claimId, f.claim.id);
});

test('newly confirmed mappings require the exact claim marker while existing mappings require byte-equivalent snapshots', () => {
  const created = fixture({ newMapping: true }); assert.ok(created.verify());
  delete created.mapping.retained_differences.documentFieldCorrection;
  assert.equal(created.verify(), null);
  const altered = fixture(); altered.mapping.retained_differences.originalAudit.originalNumber = 'CHANGED';
  assert.equal(altered.verify(), null);
  const different = fixture(); different.mapping.id = uuid(99); assert.equal(different.verify(), null);
  const reconciled = fixture();
  reconciled.mapping.last_reconciled_at = '2026-09-28T02:00:00Z'; reconciled.mapping.updated_at = '2026-09-28T02:00:00Z';
  assert.ok(reconciled.verify(), 'Routine bookkeeping timestamps do not invalidate unchanged original evidence');
});

test('source, account, projection and normalized target economic drift invalidate the overlay', () => {
  for (const mutate of [
    (f) => { f.source.sourceFingerprint = 'changed'; }, (f) => { f.source.financialFingerprint = 'changed'; },
    (f) => { f.source.documentFieldSourceFingerprint = 'changed'; }, (f) => { f.source.documentFieldProjection.fingerprint = 'changed'; },
    (f) => { f.source.accountId = '001000000000002AAA'; }, (f) => { f.target.contactId = uuid(99); },
    (f) => { f.target.currency = 'HKD'; }, (f) => { f.target.amountPaid = 50; },
    (f) => { f.target.total = 100.01; }, (f) => { f.target.unowned.CurrencyRate = 7.9; },
    (f) => { f.target.lineItems[0].UnitAmount = 101; }, (f) => { f.target.lineItems[0].LineItemID = 'replacement-line'; },
  ]) { const f = fixture(); mutate(f); assert.equal(f.verify(), null); }
  const timestamp = fixture(); timestamp.target.updatedDateUTC = '2026-09-28T02:00:00Z'; assert.ok(timestamp.verify());
});

test('tampered hashes, unconfirmed latest outcomes and incomplete observed after-images never authorize an overlay', () => {
  for (const mutate of [
    (f) => { f.claim.evidence_hash = 'bad'; }, (f) => { f.event.evidence_hash = 'bad'; },
    (f) => { f.event.status = 'uncertain'; }, (f) => { f.event.evidence.basis = 'POST-response-only'; f.event.evidence_hash = hash(f.event.evidence); },
    (f) => { f.event.evidence.observed.Payments = []; f.event.evidence_hash = hash(f.event.evidence); },
    (f) => { delete f.event.evidence.observed.CurrencyRate; f.event.evidence_hash = hash(f.event.evidence); },
    (f) => { f.controls.documentCorrectionEvents.push({ ...structuredClone(f.event), sequence: 3, status: 'uncertain' }); },
    (f) => { f.claim.evidence.expectedAfter.Total = 90; f.claim.evidence_hash = hash(f.claim.evidence); },
  ]) { const f = fixture(); mutate(f); assert.equal(f.verify(), null); }
});

test('claim, target and saved source identities remain exact; malformed or unrelated journals are ignored', () => {
  for (const mutate of [
    (f) => { f.claim.xero_invoice_id = uuid(99); }, (f) => { f.mapping.xero_document_id = uuid(99); },
    (f) => { f.mapping.salesforce_id = 'a01000000000002AAA'; }, (f) => { f.mapping.xero_contact_id = uuid(99); },
    (f) => { f.claim.evidence.source.object = 'Supplier_Invoice__c'; f.claim.evidence_hash = hash(f.claim.evidence); },
    (f) => { f.controls.documentCorrectionClaims = [{ id: uuid(99), evidence: null }]; },
  ]) { const f = fixture(); mutate(f); assert.equal(f.verify(), null); }
  const f = fixture(); f.mapping.salesforce_id = f.source.salesforceId.slice(0, 15);
  f.claim.evidence.mappingSnapshot = structuredClone(f.mapping); f.claim.evidence_hash = hash(f.claim.evidence);
  assert.ok(f.verify(), 'Case-safe Salesforce 15/18-character identity is supported while exact mapping snapshot remains bound');
});

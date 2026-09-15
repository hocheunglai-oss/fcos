import test from 'node:test';
import assert from 'node:assert/strict';
import { changedXeroReviewItems, xeroReviewFingerprint, blockRepeatedFinancialTargets } from '../api/_xeroFinancialSync.js';
import { zeroBalanceClosureEligibility } from '../api/_disputeAccounting.js';
import { refundSettlementCandidates, exactCreditEvidence, exactAllocatedCreditEvidence } from '../api/_disputeSettlementEvidence.js';
import { reconciliationBucket, retainedReviewSelection, documentReviewTotals } from '../src/lib/financialWorkflowUi.js';
import { disputeStage, disputeNextAction, disputeStatusLabel } from '../src/lib/disputeWorkflowPresentation.js';

test('a changed mapping isolates its own reviewed row while unchanged approval survives', () => {
  const source = { salesforceObject: 'Invoice__c', salesforceId: 'invoice1', documentNumber: 'INV1', sourceFingerprint: 'source', action: 'create_draft', proposedPayload: { Amount: 100, AccountCode: '200' }, xero: null, blockers: [], differences: [] };
  const item = { id: 'row1', source_payload: source, proposed_action: source.action, proposed_payload: source.proposedPayload, xero_payload: {}, blockers: [], differences: [] };
  const item2 = { ...item, id: 'row2', source_payload: { ...source, salesforceId: 'invoice2' } };
  const changed = { ...source, proposedPayload: { ...source.proposedPayload, AccountCode: '201' } };
  const result = changedXeroReviewItems([item, item2], new Map([['Invoice__c:invoice1', changed], ['Invoice__c:invoice2', item2.source_payload]]));
  assert.deepEqual(result.map((row) => row.id), ['row1']);
  assert.match(result[0].reason, /approved mapping changed/);
});

test('source removal and Xero edits require review even when the total still matches', () => {
  const row = { id: 'a', source_payload: { salesforceObject: 'Invoice__c', salesforceId: '1' }, proposed_action: 'safe_update', proposed_payload: {}, xero_payload: { id: 'x', status: 'DRAFT' } };
  assert.equal(changedXeroReviewItems([row], new Map()).length, 1);
  const current = { ...row.source_payload, action: 'safe_update', proposedPayload: {}, xero: { id: 'x', status: 'PAID' } };
  assert.match(changedXeroReviewItems([row], new Map([['Invoice__c:1', current]]))[0].reason, /Xero record changed/);
});

test('review refresh preserves only the same selected economic records', () => {
  const old = [{ id: 'a', salesforceObject: 'Invoice', salesforceId: '1', reviewFingerprint: 'same' }, { id: 'b', salesforceObject: 'Invoice', salesforceId: '2', reviewFingerprint: 'old' }];
  const next = [{ ...old[0], id: 'c', action: 'create_draft', status: 'eligible' }, { ...old[1], id: 'd', action: 'safe_update', reviewFingerprint: 'changed' }];
  assert.deepEqual([...retainedReviewSelection(old, next, new Set(['a', 'b']))], ['c']);
  assert.notEqual(xeroReviewFingerprint({ proposedPayload: { CurrencyCode: 'USD' } }), xeroReviewFingerprint({ proposedPayload: { CurrencyCode: 'HKD' } }));
});

test('only dependency-only payment blockers enter Waiting', () => {
  assert.equal(reconciliationBucket({ status: 'blocked', blockers: ['The linked Xero transaction is not authorised for payment.'] }, 'payment'), 'waiting');
  assert.equal(reconciliationBucket({ status: 'blocked', blockers: ['The linked Xero transaction is not authorised for payment.', 'No approved Xero bank mapping exists for DBS.'] }, 'payment'), 'attention');
  assert.equal(reconciliationBucket({ action: 'protected_legacy', status: 'protected', differences: [{ field: 'total' }] }), 'attention');
  assert.equal(reconciliationBucket({ action: 'link', status: 'eligible', differences: [] }), 'matched');
});

test('review totals keep currencies and proposed actions separate', () => {
  const totals = documentReviewTotals([{ currency: 'USD', action: 'create_draft', total: 10 }, { currency: 'HKD', action: 'create_draft', total: 78 }, { currency: 'USD', action: 'safe_update', total: 20 }]);
  assert.equal(totals.length, 3);
  assert.deepEqual(totals.map((row) => row.total), [10, 78, 20]);
});

const buyer = { id: 'buyer-party', account_id: '001000000000001AAA', account_name: 'Buyer', roles: ['buyer'] };
const closeBuyer = { id: 'action', party_id: buyer.id, party_side: 'buyer', action_type: 'close_buyer_dispute', amount: 0, close_reason: 'Full payment received from buyer' };
test('approve-and-close requires every party outcome, verified zero balances and no obligations', () => {
  assert.equal(zeroBalanceClosureEligibility([closeBuyer], [buyer], { Receivable_Balance__c: 0 }).eligible, true);
  for (const balance of [null, '', 0.005, 10, -10]) assert.equal(zeroBalanceClosureEligibility([closeBuyer], [buyer], { Receivable_Balance__c: balance }).eligible, false);
  assert.equal(zeroBalanceClosureEligibility([closeBuyer], [{ ...buyer, roles: ['buyer', 'supplier'] }], { Receivable_Balance__c: 0 }).eligible, false);
  assert.equal(zeroBalanceClosureEligibility([closeBuyer], [buyer], { Receivable_Balance__c: 0 }, [{ status: 'Settled' }]).eligible, false);
  assert.equal(zeroBalanceClosureEligibility([{ ...closeBuyer, close_reason: 'UOC opened' }], [buyer], { Receivable_Balance__c: 0 }).eligible, false);
  assert.equal(zeroBalanceClosureEligibility([{ ...closeBuyer, amount: 100 }], [buyer], { Receivable_Balance__c: 0 }).eligible, false);
});

test('refund evidence requires exact supplier, invoice, currency, sign and amount', () => {
  const invoice = { supplierInvoiceId: 'invoice1', supplierAccountId: buyer.account_id, payments: [{ id: 'p', amount: -100, date: '2026-09-01', currencyIsoCode: 'USD' }] };
  const instruction = { instruction_type: 'get_back_paid', source_supplier_invoice_id: 'invoice1', planned_amount: 100, currency_iso_code: 'USD' };
  assert.equal(refundSettlementCandidates({ _Supplier_Invoice_Exposure_Rows: [invoice] }, instruction, buyer).length, 1);
  assert.equal(refundSettlementCandidates({ _Supplier_Invoice_Exposure_Rows: [invoice] }, { ...instruction, currency_iso_code: 'HKD' }, buyer).length, 0);
  assert.equal(refundSettlementCandidates({ _Supplier_Invoice_Exposure_Rows: [invoice] }, instruction, { ...buyer, account_id: 'different' }).length, 0);
});

test('draft, wrong-account and wrong-currency credits cannot masquerade as settlement', () => {
  const record = { Id: 'credit1', STEM__c: 'stem1', STEM__r: { Account__c: buyer.account_id }, Amount__c: -100, Invoice_Date__c: '2026-09-01' };
  const xero = { CreditNoteID: 'creditx', CurrencyCode: 'USD', Status: 'AUTHORISED', Type: 'ACCRECCREDIT', Contact: { ContactID: 'contact' }, Total: 100 };
  const context = { side: 'buyer', stemId: 'stem1', partyAccountId: buyer.account_id, amount: 100, mapping: { xero_contact_id: 'contact', xero_document_id: 'creditx' } };
  assert.ok(exactCreditEvidence(record, xero, context));
  assert.equal(exactCreditEvidence(record, { ...xero, Status: 'DRAFT' }, context), null);
  assert.equal(exactCreditEvidence(record, { ...xero, CurrencyCode: 'HKD' }, context), null);
  assert.equal(exactCreditEvidence(record, xero, { ...context, partyAccountId: 'different' }), null);
});

test('four user stages preserve the external closure exception and actionable next step', () => {
  assert.equal(disputeStage('Revision Requested'), 'Prepare');
  assert.equal(disputeStage('Accounting In Progress'), 'Settle');
  assert.equal(disputeNextAction({ workflowStatus: 'Pending Approval' }), 'Review agreement');
  assert.match(disputeStatusLabel({ workflowStatus: 'Draft', externalClosure: true }), /Finance completion required/);
});


test('supplier settlement suggestions require the exact live credit allocation to that invoice', () => {
  const record = { Id: 'credit', STEM__c: 'stem', Supplier__c: buyer.account_id, Invoice_Amount__c: -150, Invoice_Date__c: '2026-09-01' };
  const context = { party: buyer, stem: { Id: 'stem', _Supplier_Invoice_Exposure_Rows: [{ supplierInvoiceId: 'invoice', supplierAccountId: buyer.account_id }] },
    instruction: { source_supplier_invoice_id: 'invoice', currency_iso_code: 'USD', planned_amount: 100 },
    mapping: { xero_contact_id: 'contact', xero_document_id: 'credit-x' }, invoiceMapping: { xero_contact_id: 'contact', xero_document_id: 'invoice-x' } };
  const xero = { CreditNoteID: 'credit-x', Status: 'AUTHORISED', CurrencyCode: 'USD', Type: 'ACCPAYCREDIT', Contact: { ContactID: 'contact' }, Total: 150,
    Allocations: [{ AllocationID: 'allocation', Invoice: { InvoiceID: 'invoice-x' }, AppliedAmount: 100 }] };
  assert.equal(exactAllocatedCreditEvidence(record, xero, context)?.amount, 100);
  assert.equal(exactAllocatedCreditEvidence(record, { ...xero, Allocations: [] }, context), null);
  assert.equal(exactAllocatedCreditEvidence(record, xero, { ...context, invoiceMapping: { ...context.invoiceMapping, xero_document_id: 'another-invoice' } }), null);
});

test('review fingerprints survive JSON persistence without false changes for absent optional fields', () => {
  const row = { sourceFingerprint: 'same', action: 'safe_update', xero: { id: 'x', contactName: undefined }, proposedPayload: {} };
  assert.equal(xeroReviewFingerprint(row), xeroReviewFingerprint(JSON.parse(JSON.stringify(row))));
});


test('ambiguous duplicate targets become exceptions before automatic links are saved', () => {
  const rows = [{ xero: { id: 'same' }, action: 'link', status: 'eligible', blockers: [] }, { xero: { id: 'same' }, action: 'safe_update', status: 'eligible', blockers: [] }, { xero: { id: 'unique' }, action: 'link', status: 'eligible', blockers: [] }];
  blockRepeatedFinancialTargets(rows, (row) => row.xero.id, 'Duplicate target');
  assert.deepEqual(rows.map((row) => row.status), ['blocked', 'blocked', 'eligible']);
  assert.equal(rows[0].blockers[0], 'Duplicate target');
});

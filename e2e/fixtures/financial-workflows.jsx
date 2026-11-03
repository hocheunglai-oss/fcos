import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/lib/AuthContext';
import XeroFinancialSync from '@/components/xero/XeroFinancialSync';
import DisputeWorkflow from '@/pages/DisputeWorkflow';
import { appClient } from '@/api/appClient';
import '@/index.css';

// Opt-in local test page. All reads and writes are stubbed before rendering either production component.
const scenario = new URLSearchParams(location.search).get('scenario') || 'xero';
const stemId = 'a0H000000000001AAA';
const buyerId = '001000000000001AAA';
const supplierId = '001000000000002AAA';
const date = new Date(Date.now() - (scenario === 'xero-rate-limit' ? 180000 : 0)).toISOString();
const doc = { id: 'doc-ready', salesforceId: 'sf-ready', salesforceObject: 'Invoice__c', stemId, documentNumber: 'TEST-INV-1', accountName: 'Test Buyer', stemName: 'TEST STEM', total: 100, currency: 'USD', invoiceDate: '2026-09-01', dueDate: '2026-09-30', documentKind: 'buyer_invoice', action: 'create_draft', status: 'eligible', reviewFingerprint: 'v1', sourceFingerprint: 'source-v1', blockers: [], differences: [], mappingProducts: [{ id: 'fuel', name: 'Fuel' }] };
const blocked = { ...doc, id: 'doc-blocked', salesforceId: 'sf-blocked', documentNumber: 'TEST-INV-2', action: 'blocked', status: 'blocked', blockers: ['Fuel: Finance-approved Xero account mapping is missing.'] };
let preview = { run: { id: 'run', revision: 1, status: 'ready_for_review', createdAt: date }, checkedAt: date, rows: [doc, blocked, { ...doc, id: 'doc-match', action: 'link', documentNumber: 'TEST-INV-3' }], products: [{ id: 'fuel', name: 'Fuel' }], summary: { total: 3, eligible: 2, blocked: 1 }, mappingProposals: [], payments: { rows: [{ salesforcePaymentId: 'p1', salesforcePaymentName: 'TEST-PAY-1', stemId, type: 'Receivable', amount: 100, currency: 'USD', paymentDate: '2026-09-01', bank: 'DBS', status: 'blocked', action: 'blocked', blockers: ['The linked Xero transaction is not authorised for payment.'] }], summary: { total: 1 } } };
if (scenario === 'xero-refund-holds') {
  preview.payments.paymentEvidenceHolds = [
    { xeroPaymentId: '00000000-0000-4000-8000-000000000101', paymentType: 'AROVERPAYMENTPAYMENT', documentKind: 'overpayment', documentId: '00000000-0000-4000-8000-000000000201', currency: 'USD', amount: 1234.5, date: '2026-03-20', status: 'held', code: 'XERO_PAYMENT_NONINVOICE_REVIEW_REQUIRED' },
    { xeroPaymentId: '00000000-0000-4000-8000-000000000102', paymentType: 'UNKNOWN', documentKind: null, status: 'held', code: 'XERO_PAYMENT_ASSOCIATION_INVALID' },
  ];
}
const parties = [{ id: 'buyer', accountId: buyerId, name: 'Test Buyer', roles: ['buyer'], partyKey: buyerId }, { id: 'supplier', accountId: supplierId, name: 'Test Supplier', roles: ['supplier'], partyKey: supplierId }];
const buyerAction = { id: 'buyer-action', partyId: 'buyer', partyAccountId: buyerId, partyName: 'Test Buyer', partyType: 'buyer', partySide: 'buyer', actionType: 'close_buyer_dispute', actionLabel: 'Close dispute with buyer', amount: 0, closeReason: 'Full payment received from buyer', accountingStatus: 'Pending Accounting' };
const supplierAction = { id: 'supplier-action', partyId: 'supplier', partyAccountId: supplierId, partyName: 'Test Supplier', partyType: 'supplier', partySide: 'supplier', actionType: 'close_supplier_dispute', actionLabel: 'Close dispute with supplier', amount: 0, closeReason: 'Full payment received from buyer', balancePaymentInstruction: 'No Balance Payment', accountingStatus: 'Pending Accounting' };
const caseRow = { id: 'case', workflowStatus: scenario === 'approve' ? 'Pending Approval' : scenario === 'settle' ? 'Accounting In Progress' : 'Draft', approvalStatus: scenario === 'approve' ? 'Pending Approval' : scenario === 'settle' ? 'Approved' : 'Draft' };
const stem = { Id: stemId, Name: 'TEST STEM', Delivery_Date__c: '2026-09-01', _Buyer_Name: 'Test Buyer', Receivable_Balance__c: 0,
  _Supplier_Invoice_Exposure_Rows: [{ supplierInvoiceId: 'invoice', supplierAccountId: supplierId, supplierName: 'Test Supplier', invoiceAmount: 100, paidAmount: 100, payableBalanceAvailable: true, rawPayableBalance: 0, payableBalance: 0, currencyIsoCode: 'USD', payments: [] }],
  _Dispute_Parties: { candidateSchemaValid: true, candidates: parties, issues: [] },
  _Dispute_Workflow: { case: caseRow, parties, actions: [buyerAction, { ...supplierAction, accountingStatus: scenario === 'settle' ? 'Not Required' : 'Pending Accounting' }], supplierInstructions: [], documents: [], events: [] } };
if (scenario === 'unstarted') {
  stem._Dispute_Workflow = { case: null, parties: [], actions: [], supplierInstructions: [], documents: [], events: [] };
}
if (scenario === 'missing-workflow') delete stem._Dispute_Workflow;
if (scenario === 'refund') {
  stem._Dispute_Workflow.case = { ...caseRow, workflowStatus: 'Accounting In Progress', approvalStatus: 'Approved' };
  stem._Dispute_Workflow.actions = [{ ...buyerAction, accountingStatus: 'Settled' }, { ...supplierAction, actionType: 'resolve_supplier_dispute', amount: 100, currencyIsoCode: 'USD' }];
  stem._Dispute_Workflow.supplierInstructions = [{ id: 'instruction', actionId: 'supplier-action', instructionType: 'get_back_paid', instructionLabel: 'Get back paid amount', sourceSupplierInvoiceId: 'invoice', sourceSupplierInvoiceName: 'TEST-SUP-1', currencyIsoCode: 'USD', plannedAmount: 100, status: 'Pending Accounting' }];
}
window.workflowFixture = { requests: [] };
const requestCount = document.createElement('output');
requestCount.setAttribute('aria-label', 'Preview request count');
requestCount.textContent = '0';
document.body.append(requestCount);
appClient.functions.invoke = async (name, body = {}) => {
  window.workflowFixture.requests.push({ name, body: structuredClone(body) });
  requestCount.textContent = String(window.workflowFixture.requests.filter((row) => row.name === 'xeroFinancialSyncPreview').length);
  if (name === 'xeroFinancialMappingsGet') return { data: { productMappings: [], bankMappings: [], accountOptions: [{ id: 'sales', code: '200', name: 'Fuel Sales' }], taxOptions: [{ taxType: 'NONE', name: 'No tax' }] } };
  if (name === 'xeroFinancialSyncLatest') return { data: { preview } };
  if (name === 'xeroFinancialSyncPreview') {
    if (scenario === 'xero-rate-limit') return { data: { error: 'Xero request limit reached. Please retry in 60 seconds. Your saved reconciliation is retained.', code: 'XERO_CONTACT_SYNC_RATE_LIMITED' } };
    return { data: preview };
  }
  if (name === 'xeroFinancialMappingsSave') { preview = { ...preview, rows: preview.rows.map((row) => row.id === blocked.id ? { ...row, status: 'eligible', action: 'create_draft', blockers: [] } : row) }; return { data: { ok: true } }; }
  if (name === 'xeroFinancialSyncRun') return { data: { error: 'Test only: no Xero transactions were posted.' } };
  if (name === 'disputeWorkflowList') return { data: { rows: [stem], capabilities: { canPrepare: true, canApprove: true, canAccount: true, canClose: true } }, meta: {} };
  if (name === 'disputeWorkflowSettlementEvidence') return { data: { candidates: scenario === 'refund' ? [{ id: 'salesforce-payment:refund', type: 'refund', salesforceId: 'refund', fingerprint: 'verified-refund', source: 'Salesforce refund', reference: 'TEST-REFUND-1', currency: 'USD', amount: 100, date: '2026-09-12' }] : [] } };
  if (name.startsWith('disputeWorkflow')) return { data: { error: 'Test only: no workflow records were changed.' } };
  throw new Error(`Unexpected fixture request: ${name}`);
};
const status = { xero: { connected: true, scopeFlags: { contacts: true, invoices: true, settingsRead: true, paymentsRead: true } }, externalActions: { xero_financial_sync: { enabled: scenario !== 'locked' } } };
createRoot(document.getElementById('root')).render(<MemoryRouter><AuthProvider><main className="h-full w-full min-w-0 overflow-hidden p-4">{['xero', 'locked', 'xero-rate-limit', 'xero-refund-holds'].includes(scenario) ? <XeroFinancialSync portalStatus={status}/> : <DisputeWorkflow/>}</main></AuthProvider></MemoryRouter>);

import { createRoot } from 'react-dom/client';
import { appClient } from '@/api/appClient';
import XeroNativeDocumentPreview from '@/components/xero/XeroNativeDocumentPreview';
import '@/index.css';

const tenantId = '10000000-0000-4000-8000-000000000009';
const actorId = '10000000-0000-4000-8000-000000000010';
const sourceId = 'a06000000000001AAA';
const reviewFingerprint = 'a'.repeat(64);
const savedOperationId = '10000000-0000-4000-8000-000000000011';
const modes = new URLSearchParams(location.search);
const eligible = modes.has('eligible') || modes.has('lost');
const documentNumber = 'BILL-0100';
const draftLines = [{ description: 'Issued fuel', quantity: 2, unitAmount: 1.005, accountCode: '5000', taxType: 'NONE' }];
window.nativeDocumentFixture = { calls: [] };
appClient.functions.invoke = async (name, body) => {
  window.nativeDocumentFixture.calls.push({ name, body });
  if (name === 'xeroNativeDocumentRecoveryQueue' && body.tenantId === tenantId) {
    return { data: { tenantId, hasMore: false, rows: modes.has('queue') ? [{
      operationId: savedOperationId, documentNumber, sourceId, sourceObject: 'Supplier_Invoice__c', reviewFingerprint, status: 'unknown',
    }] : [] } };
  }
  if (['xeroNativeDocumentApply', 'xeroNativeDocumentReconcile'].includes(name)) {
    if (body.tenantId !== tenantId || body.sourceId !== sourceId || body.sourceObject !== 'Supplier_Invoice__c'
        || body.reviewFingerprint !== reviewFingerprint || body.reviewed !== true) throw new Error('Unexpected operation scope');
    if (name === 'xeroNativeDocumentApply' && modes.has('lost')) throw new Error('The response was lost.');
    return { data: { operationId: body.operationId, status: 'confirmed', xeroId: savedOperationId, mappingId: actorId } };
  }
  const selected = body.nativeDocument;
  if (name !== 'xeroFinancialSyncPreview' || selected.tenantId !== tenantId
      || selected.documentNumber !== documentNumber || selected.sourceObject !== 'Supplier_Invoice__c') {
    throw new Error('Unexpected request');
  }
  const wrong = modes.has('wrong-document');
  return { data: { nativeDocument: { ...selected, documentNumber: wrong ? 'BILL-OTHER' : selected.documentNumber,
    status: 'source_reviewed', currency: 'HKD', signedTotal: 2.01, accountingUsd: 1.01, roundingAdjustmentCents: -1,
    documentId: sourceId,
    xeroReview: eligible ? { status: 'no_exact_number_match', contact: { name: 'Fixture supplier' }, ownershipVerified: true,
      candidates: [], blockers: [] } : { status: 'held', contact: { name: 'Fixture supplier' },
      candidates: [{ id: 'fixture-bill', number: 'BILL-0100', status: 'VOIDED' }],
      blockers: ['Review the historical Xero bill.'] },
    draftPreview: eligible ? { status: 'draft_preview', reviewFingerprint, writeEnabled: true, lines: draftLines } : null,
    invoiceDate: '2026-09-10', dueDate: '2026-09-30',
    lines: [{ description: 'Fuel', quantity: 1, unitAmount: 1.005, accountCode: '5000', taxType: 'NONE' },
      { description: 'Rounding adjustment', quantity: 1, unitAmount: -0.01, accountCode: '7999', taxType: 'NONE' }] } } };
};
createRoot(document.getElementById('root')).render(
  <main className="mx-auto max-w-6xl p-6"><XeroNativeDocumentPreview tenantId={tenantId} actorId={actorId}
    reviewEnabled={!modes.has('queue')} verificationOnly={modes.has('verification-only')} /></main>,
);

import React from 'react';
import { createRoot } from 'react-dom/client';
import { appClient } from '../../src/api/appClient.js';
import XeroFinancialSync from '../../src/components/xero/XeroFinancialSync.jsx';
import '../../src/index.css';

const row = {
  id: 'review-one', salesforceObject: 'Invoice__c', salesforceId: 'invoice-one',
  documentNumber: 'INV-EXCEPTION-1', documentKind: 'buyer_invoice',
  accountId: '001BUYER0000001', accountName: 'Shared Buyer', companyCode: 'CL-A',
  stemId: 'stem-one', stemName: 'STEM-ONE', invoiceDate: '2026-09-01', dueDate: '2026-09-30',
  currency: 'USD', total: 100, action: 'protected_legacy', status: 'eligible',
  reviewRequired: true, selected: false, blockers: [],
  warnings: ['Two Salesforce accounts share this Xero contact; Finance review is required.'],
  differences: [{ field: 'reference', salesforce: 'STEM-ONE', xero: 'OLD-REF' }],
  matchEvidence: {
    basis: 'stem_reference',
    sharedAccounts: [
      { accountId: '001BUYER0000001', accountName: 'Shared Buyer', companyCode: 'CL-A' },
      { accountId: '001BUYER0000002', accountName: 'Shared Buyer', companyCode: 'CL-B' },
    ],
    candidates: [{ id: 'xero-invoice-one', number: 'XERO-77', contactName: 'Shared Buyer', date: '2026-09-01', total: 100, currency: 'USD' }],
  },
  xero: { id: 'xero-invoice-one', number: 'XERO-77', status: 'PAID' },
  sourceFingerprint: 'source-one', reviewFingerprint: 'review-one',
};

const checkedAt = new Date().toISOString();
const preview = {
  run: { id: 'local-review-fixture', revision: 1, status: 'ready_for_review', createdAt: checkedAt },
  checkedAt, rows: [row, {
    ...row, id: 'accepted-one', salesforceId: 'invoice-accepted', documentNumber: 'INV-ACCEPTED-1',
    status: 'linked', reviewRequired: false, acceptedLegacy: true, sourceFingerprint: 'source-accepted', reviewFingerprint: 'review-accepted',
  }], payments: { rows: [] }, products: [], mappingProposals: [],
};
appClient.functions.invoke = async (name) => ({ data: name === 'xeroFinancialMappingsGet'
  ? { productMappings: [], bankMappings: [], accountOptions: [], taxOptions: [] }
  : name === 'xeroFinancialSyncLatest' ? { preview } : { error: `Unexpected fixture call: ${name}` } });

createRoot(document.getElementById('root')).render(<XeroFinancialSync portalStatus={{
  externalActions: { xero_financial_sync: { enabled: true } },
  xero: { connected: true, scopeFlags: { invoices: true, contacts: true, settingsRead: true, paymentsRead: true } },
}} language="en" />);

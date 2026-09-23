import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import XeroPortal from '../../src/pages/XeroPortal.jsx';
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
const mappingBlocked = {
  ...row, id: 'mapping-blocked', salesforceId: 'invoice-mapping', documentNumber: 'INV-MAPPING',
  action: 'blocked', status: 'blocked', reviewRequired: false,
  blockers: ['HSFO 380: Finance-approved Xero account mapping is missing.'], warnings: [], differences: [],
  mappingProducts: [{ id: 'prod-1', name: 'HSFO 380' }],
  sourceFingerprint: 'source-mapping', reviewFingerprint: 'review-mapping',
};
const hardBlocked = {
  ...row, id: 'hard-blocked', salesforceId: 'invoice-hard', documentNumber: 'INV-HARD',
  action: 'blocked', status: 'blocked', reviewRequired: false,
  blockers: ['ambiguous_legacy_match: More than one Xero transaction matches this document.'], warnings: [], differences: [],
  matchEvidence: { ...row.matchEvidence, candidates: [
    { id: 'candidate-one', number: 'XERO-1' }, { id: 'candidate-two', number: 'XERO-2' },
  ] }, sourceFingerprint: 'source-hard', reviewFingerprint: 'review-hard',
};
const readyUpdate = {
  ...row, id: 'update-one', salesforceId: 'invoice-update', documentNumber: 'INV-UPDATE',
  action: 'safe_update', status: 'eligible', reviewRequired: false, selected: true,
  blockers: [], differences: [{ field: 'reference', salesforce: 'NEW', xero: 'OLD' }],
  sourceFingerprint: 'source-update', reviewFingerprint: 'review-update',
};
const readyDraft = {
  ...row, id: 'draft-one', salesforceId: 'invoice-draft', documentNumber: 'INV-DRAFT',
  action: 'create_draft', status: 'eligible', reviewRequired: false, selected: true,
  blockers: [], differences: [], xero: null,
  sourceFingerprint: 'source-draft', reviewFingerprint: 'review-draft',
};
const readyLink = {
  ...row, id: 'ready-link', salesforceId: 'invoice-link', documentNumber: 'INV-LINK',
  action: 'link', status: 'eligible', reviewRequired: true, selected: false,
  differences: [], sourceFingerprint: 'source-link', reviewFingerprint: 'review-link',
};
const batchCount = Number(new URLSearchParams(window.location.search).get('rows') || 0);
const resumeStatus = new URLSearchParams(window.location.search).get('run');
const batchRows = Array.from({ length: batchCount }, (_, index) => {
  const ordinal = String(index + 1).padStart(3, '0');
  return {
    ...mappingBlocked,
    id: `batch-${ordinal}`, salesforceId: `invoice-batch-${ordinal}`,
    documentNumber: `INV-BATCH-${ordinal}`, accountName: `Pacific Marine Fuels Trading ${ordinal}`,
    stemId: `stem-batch-${ordinal}`, stemName: `STEM-BATCH-${ordinal}`,
    blockers: [`HSFO 380: Finance-approved Xero account mapping is missing for Pacific Marine Fuels Trading ${ordinal}.`],
    sourceFingerprint: `source-batch-${ordinal}`, reviewFingerprint: `review-batch-${ordinal}`,
  };
});
let mappingApproved = false;
let automaticApproved = false;
let postingMode = 'draft';
const automaticMapping = new URLSearchParams(window.location.search).get('automatic') === '1';
const requests = [];
const preview = () => ({
  run: { id: mappingApproved ? 'local-review-refreshed' : 'local-review-fixture', revision: 1, status: resumeStatus || 'ready_for_review', createdAt: checkedAt, postingMode },
  postingMode,
  checkedAt, rows: [row, {
    ...row, id: 'accepted-one', salesforceId: 'invoice-accepted', documentNumber: 'INV-ACCEPTED-1',
    status: 'linked', reviewRequired: false, acceptedLegacy: true, sourceFingerprint: 'source-accepted', reviewFingerprint: 'review-accepted',
  }, mappingApproved ? {
    ...mappingBlocked, id: 'mapping-refreshed', action: 'safe_update', status: 'eligible', blockers: [],
    reviewFingerprint: 'review-mapping-approved',
  } : mappingBlocked, hardBlocked, readyUpdate, readyDraft, readyLink, ...batchRows].map((item) => {
    if (!['authorised', 'partial', 'failed'].includes(resumeStatus)) return item;
    if (item.id === row.id) return { ...item, selected: true, status: resumeStatus === 'authorised' ? 'selected' : 'failed' };
    if (item.id === readyUpdate.id) return { ...item, selected: true, status: resumeStatus === 'authorised' ? 'selected' : 'linked' };
    if (item.id === readyDraft.id) return { ...item, selected: true, status: 'selected' };
    return { ...item, selected: false };
  }),
  payments: { rows: [] }, products: [{ id: 'prod-1', name: 'HSFO 380' }], mappingProposals: [],
});
const portalStatus = {
  externalActions: { xero_financial_sync: { enabled: new URLSearchParams(window.location.search).get('gate') !== 'off' } },
  xero: { connected: true, scopeFlags: { invoices: true, contacts: true, settingsRead: true, paymentsRead: true } },
};
window.exceptionFixture = { requests };
appClient.functions.invoke = async (name, body) => {
  requests.push({ name, body });
  if (name === 'xeroPortalStatus') return { data: portalStatus };
  if (['xeroPortalReceiptsList', 'xeroPortalContactLifecycleLatest', 'xeroPortalContactAutoCreateLatest'].includes(name)) return { data: {} };
  if (name === 'xeroFinancialMappingsGet') return { data: {
    productMappings: mappingApproved || automaticApproved ? [{ id: 'mapping-1', direction: 'buyer', salesforceProductId: 'prod-1', salesforceProductName: 'HSFO 380', xeroAccountCode: automaticApproved ? '41100' : '41000', xeroAccountName: 'Sales', xeroTaxType: 'NONE', revision: 1 }] : [],
    bankMappings: [], accountOptions: [{ id: 'account-1', code: '41000', name: 'Sales', bank: false }, { id: 'account-2', code: '41100', name: 'Bunker Sales', bank: false }], taxOptions: [],
  } };
  if (name === 'xeroFinancialMappingsSave') { mappingApproved = true; return { data: { saved: true } }; }
  if (name === 'xeroFinancialSyncLatest') return { data: { preview: preview() } };
  if (name === 'xeroFinancialSyncPreview') {
    postingMode = body.postingMode || 'draft';
    const changedCount = automaticMapping && !automaticApproved ? 1 : 0;
    if (automaticMapping) automaticApproved = true;
    return { data: { ...preview(), automaticMappingPolicy: { id: 'petroleum-and-invoice-extras-v2', productCount: automaticMapping ? 1 : 0, approvedCount: automaticMapping ? 1 : 0, changedCount } } };
  }
  if (name === 'xeroFinancialSyncRun') return { data: { error: 'Fixture blocks real financial writes.' } };
  return { data: { error: `Unexpected fixture call: ${name}` } };
};

createRoot(document.getElementById('root')).render(new URLSearchParams(window.location.search).has('portal')
  ? <BrowserRouter><div className="app-workspace-scroll" style={{ marginInlineStart: window.matchMedia('(min-width: 640px)').matches ? 240 : 0 }}><XeroPortal /></div></BrowserRouter>
  : <XeroFinancialSync portalStatus={portalStatus} language="en" />);

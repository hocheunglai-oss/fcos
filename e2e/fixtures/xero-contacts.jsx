import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import XeroPortal from '../../src/pages/XeroPortal.jsx';
import { appClient } from '../../src/api/appClient.js';
import '../../src/index.css';

const longName = 'PacificMarineFuelTradingInternationalDivisionContactWithAnUnbrokenIdentifier000000000001';
const longMessage = 'The contact is protected because ' + 'anunbrokenauditmessagethatmustwrapinsideitsavailablecolumn'.repeat(3);
const rows = [
  {
    id: 'rename-row', action: 'rename', status: 'eligible', reason: 'unchanged-name',
    xeroContactId: 'xero-rename', xeroContactName: longName,
    xeroContactNumber: 'CONTACT-001', xeroAccountNumber: 'ACCOUNT-001', xeroContactStatus: 'ACTIVE',
    salesforceName: 'Pacific Marine Fuels Trading International Division', salesforceCompanyCode: 'HK1234567890', salesforceRecordType: 'Buyer',
    matchField: 'SalesforceName', usage: [{ source: 'invoices', records: 12, yearCounts: [{ year: 2025, records: 9 }, { year: 2026, records: 3 }], undatedRecords: 0 }], message: longMessage,
  },
  {
    id: 'archive-row', action: 'archive', status: 'eligible', reason: 'unused-unmatched-xero-contact',
    xeroContactId: 'xero-archive', xeroContactName: 'Unused Harbour Supplier',
    salesforceName: '', matchField: '', usage: [], message: 'No invoices or bills use this contact.',
  },
  {
    id: 'exception-row', action: 'exception', status: 'blocked', reason: 'ambiguous-salesforce-match',
    xeroContactId: 'xero-exception', xeroContactName: 'Shared Marine Buyer',
    salesforceName: 'Shared Marine Buyer Holdings', salesforceCompanyCode: 'HKEXCEPTION',
    matchField: 'ClKeyWithoutHk', usage: [{ source: 'credit-notes', records: 2, yearCounts: [{ year: 2026, records: 2 }], undatedRecords: 0 }],
    message: 'Two Salesforce accounts match this contact; review the account ownership.',
  },
  {
    id: 'keep-row', action: 'keep', status: 'kept', reason: 'nonzero-balance',
    xeroContactId: 'xero-keep', xeroContactName: 'Active Ocean Carrier',
    salesforceName: 'Active Ocean Carrier', salesforceCompanyCode: 'HKKEEP',
    matchField: 'SalesforceName', usage: [{ source: 'payments', records: 3, yearCounts: [{ year: 2025, records: 1 }], undatedRecords: 2 }], message: 'Outstanding balance keeps the contact active.',
  },
  {
    id: 'not-selected-row', action: 'archive', status: 'not-selected', reason: 'not-selected',
    xeroContactId: 'xero-not-selected', xeroContactName: 'Deferred Contact Audit',
    salesforceName: '', matchField: '', usage: [{ source: 'prepayments', records: 4, lastSeenAt: '2026-09-01T00:00:00.000Z' }], message: 'The eligible contact was left out of the reviewed apply selection.',
  },
];
if (new URLSearchParams(window.location.search).get('resolution') === '1') rows.push(
  {
    id: 'xero-only-row', action: 'exception', status: 'blocked', reason: 'used-unmatched-xero-contact',
    xeroContactId: '0cb5d302-8f2d-4b08-8902-0553d01df644', xeroContactName: 'Harbour Counterparty', xeroContactStatus: 'ACTIVE',
    identityFingerprint: 'a'.repeat(64), identityDecision: null, salesforceName: '', usage: [],
  },
  {
    id: 'missing-contact-row', action: 'exception', status: 'blocked', reason: 'missing-xero-contact',
    salesforceAccountId: '001000000000001AAA', salesforceName: 'Missing Harbour Buyer', salesforceCompanyCode: 'HK-MISSING', usage: [],
  },
);

const run = {
  id: 'contacts-layout-fixture', createdAt: '2026-09-23T00:00:00.000Z', rowCount: rows.length, rows,
  xero: { tenantId: 'f0a97252-7bc7-47b6-a8cf-ef381671aeca' },
  summary: { nonArchivedXeroContacts: 5, archivedXeroContacts: 0, unmatchedNonArchivedXeroContacts: 1, renameEligible: 1, archiveEligible: 1, exception: 1 },
};
const status = {
  xero: { connected: true, configured: true, tenantName: 'Fixture tenant', scopeFlags: { contacts: true, invoices: true, settingsRead: true, paymentsRead: true, paymentsWrite: true } },
  externalActions: { xero_contact_sync: { enabled: true }, xero_financial_sync: { enabled: true } },
};

const requests = [];
window.contactsFixture = { requests, rows };
appClient.functions.invoke = async (name, body) => {
  requests.push({ name, body });
  if (name === 'xeroPortalStatus') return { data: status };
  if (name === 'xeroPortalReceiptsList') return { data: { receipts: [] } };
  if (name === 'xeroPortalContactLifecycleLatest') return { data: { run } };
  if (name === 'xeroPortalContactLifecyclePreview') return { data: { run } };
  if (name === 'xeroContactIdentitySave') {
    if (new URLSearchParams(window.location.search).has('identityMalformed')) return { data: {} };
    const row = rows.find((item) => item.xeroContactId === body.contactId);
    if (row) { row.identityDecision = { tenant_id: body.tenantId, contact_id: body.contactId, fingerprint: body.expectedFingerprint,
      revision: body.expectedRevision + 1, decision: body.decision, evidence_note: body.evidenceNote,
      evidence_reference: body.evidenceReference, actor_id: 'd1e772f5-9c10-4566-99b3-67f4c4e75a62', actor_email: 'finance@example.test', updated_at: '2026-09-24T00:00:00Z' };
      row.reason = body.decision === 'verified_xero_only' ? 'verified-xero-only' : 'used-unmatched-xero-contact'; }
    return { data: { decision: row?.identityDecision, refreshPreview: true } };
  }
  if (name === 'xeroContactRepairApply' && new URLSearchParams(window.location.search).has('repairMalformed')) return { data: {} };
  if (name === 'xeroContactRepairApply') return { data: { runId: body.runId, outcomes: body.rowIds.map((rowId) => ({ rowId, status: 'created' })), refreshPreview: true,
    summary: { total: body.rowIds.length, created: body.rowIds.length, existing: 0, blocked: 0, uncertain: 0 } } };
  if (name === 'xeroPortalContactAutoCreateLatest') return { data: { run: null } };
  return { data: { error: `Fixture blocks unexpected call: ${name}` } };
};

createRoot(document.getElementById('root')).render(
  <BrowserRouter><div className="app-workspace-scroll fixture-workspace"><XeroPortal /></div></BrowserRouter>,
);

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
    matchField: 'SalesforceName', usage: [{ source: 'invoices', records: 12 }], message: longMessage,
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
    matchField: 'ClKeyWithoutHk', usage: [{ source: 'credit-notes', records: 2 }],
    message: 'Two Salesforce accounts match this contact; review the account ownership.',
  },
  {
    id: 'keep-row', action: 'keep', status: 'kept', reason: 'nonzero-balance',
    xeroContactId: 'xero-keep', xeroContactName: 'Active Ocean Carrier',
    salesforceName: 'Active Ocean Carrier', salesforceCompanyCode: 'HKKEEP',
    matchField: 'SalesforceName', usage: [{ source: 'payments', records: 3 }], message: 'Outstanding balance keeps the contact active.',
  },
  {
    id: 'not-selected-row', action: 'archive', status: 'not-selected', reason: 'not-selected',
    xeroContactId: 'xero-not-selected', xeroContactName: 'Deferred Contact Audit',
    salesforceName: '', matchField: '', usage: [], message: 'The eligible contact was left out of the reviewed apply selection.',
  },
];

const run = {
  id: 'contacts-layout-fixture', createdAt: '2026-09-23T00:00:00.000Z', rowCount: rows.length, rows,
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
  if (name === 'xeroPortalContactAutoCreateLatest') return { data: { run: null } };
  return { data: { error: `Fixture blocks unexpected call: ${name}` } };
};

createRoot(document.getElementById('root')).render(
  <BrowserRouter><div className="app-workspace-scroll fixture-workspace"><XeroPortal /></div></BrowserRouter>,
);

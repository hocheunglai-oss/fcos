import React from 'react';
import { createRoot } from 'react-dom/client';
import { appClient } from '@/api/appClient';
import XeroFinancialSync from '@/components/xero/XeroFinancialSync';
import '@/index.css';
const capturedAt = '2026-09-25T18:31:00.000Z';
const base = { salesforceObject: 'Supplier_Invoice__c', documentKind: 'supplier_bill', postingMode: 'draft', action: 'blocked', status: 'blocked', blockers: ['Supplier invoice has no verified issued source file.'], warnings: [], differences: [], accountId: 'supplier', accountName: 'Fixture supplier', currency: 'USD', total: 100, invoiceDate: '2026-09-01', sourceFingerprint: 'source', reviewFingerprint: 'review', stemId: 'stem-one', stemName: 'STEM-ONE', mappingProducts: [] };
const candidates = Array.from({ length: 7 }, (_, index) => ({ documentId: `06900000000000${index}`, latestPublishedVersionId: `06800000000000${index}`, title: `Issued PDF candidate ${index + 1}` }));
const rows = ['complete', 'partial', 'unavailable', 'not_checked', 'empty', 'old'].map((status) => ({ ...base, id: status, salesforceId: status, documentNumber: `BILL-${status}`, sourceFileDiscovery: status === 'old' ? null : { version: 1, sourceId: status, capturedAt, status: status === 'empty' ? 'complete' : status, candidates: ['complete', 'partial'].includes(status) ? candidates : [], metadataOnly: true, authoritative: false, contentVerified: false } }));
const requests = [];
window.fileDiscoveryFixture = { requests };
appClient.functions.invoke = async (name, body) => {
  requests.push({ name, body });
  if (name === 'xeroFinancialMappingsGet') return { data: { productMappings: [], bankMappings: [], accountOptions: [], taxOptions: [] } };
  if (name === 'xeroFinancialSyncLatest') return { data: { preview: { run: { id: 'file-fixture', revision: 1, status: 'ready_for_review', postingMode: 'draft', createdAt: capturedAt }, postingMode: 'draft', rows, payments: { rows: [] }, products: [], mappingProposals: [] } } };
  return { data: { error: 'Unexpected fixture request' } };
};
createRoot(document.getElementById('root')).render(<XeroFinancialSync language={new URLSearchParams(location.search).get('language') || 'en'} portalStatus={{ externalActions: { xero_financial_sync: { enabled: true } }, xero: { connected: true, scopeFlags: { invoices: true, contacts: true, settingsRead: true } } }} />);

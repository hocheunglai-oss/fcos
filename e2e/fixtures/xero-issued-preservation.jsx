import React from 'react';
import { createRoot } from 'react-dom/client';
import { appClient } from '../../src/api/appClient.js';
import XeroFinancialSync from '../../src/components/xero/XeroFinancialSync.jsx';
import '../../src/index.css';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const runId = uuid(50);
const requests = [];
const scenario = new URLSearchParams(window.location.search).get('scenario');
const rows = [1, 2, 3].map((number) => ({
  id: uuid(number), sourceId: `a0600000000000${number}`, sourceNumber: `SUP-${['ONE', 'TWO', 'HOLD'][number - 1]}`,
  xeroDocumentId: uuid(100 + number), xeroNumber: `XERO-${number}`, currency: 'USD', total: 124.2 * number,
  status: number === 3 ? 'blocked' : 'eligible', blockers: number === 3 ? ['Issued invoice amount differs from the existing Xero bill.'] : [],
  fingerprint: number === 3 ? null : String(number).repeat(64), selected: false,
}));
const packet = { records: rows.map((row, index) => ({ sourceId: row.sourceId, xeroDocumentId: row.xeroDocumentId,
  documentId: `06900000000000${index + 1}`, versionId: `06800000000000${index + 1}`, sha256: 'a'.repeat(64),
  review: { reviewer: 'Codex offline fixture', reviewedAt: '2026-09-28T00:00:00.000Z', reviewRecordHash: 'b'.repeat(64),
    sourceNumber: row.sourceNumber, printedNumber: row.sourceNumber, sellerName: 'Fixture Supplier', buyerName: 'Fixture Buyer',
    invoiceDate: '2026-01-05', dueDate: '2026-02-03', currency: row.currency, total: row.total, totalTax: 0,
    vessel: `FIXTURE VESSEL ${index + 1}`, lines: [{ description: 'Issued invoice fixture line', amount: row.total }] } })) };
const checkedAt = new Date().toISOString();
const ordinaryPreview = { run: { id: uuid(60), revision: 1, status: 'ready_for_review', createdAt: checkedAt, postingMode: 'draft' },
  postingMode: 'draft', checkedAt, rows: [], products: [], mappingProposals: [], payments: { rows: [], summary: { total: 0 } } };
const portalStatus = { externalActions: { xero_financial_sync: { enabled: true } },
  xero: { connected: true, scopeFlags: { invoices: true, contacts: true, settingsRead: true, paymentsRead: true } } };

window.issuedPreservationFixture = { requests, packet, rows, runId, financialWrites: 0 };
appClient.functions.invoke = async (name, body) => {
  requests.push({ name, body: structuredClone(body) });
  if (name === 'xeroFinancialMappingsGet') return { data: { productMappings: [], bankMappings: [], accountOptions: [], taxOptions: [] } };
  if (name === 'xeroFinancialSyncLatest') return { data: { preview: structuredClone(ordinaryPreview) } };
  if (name === 'xeroFinancialSyncPreview') return { data: structuredClone(ordinaryPreview) };
  if (name === 'xeroFinancialDocumentPreservationPreview') return { data: {
    run: { id: runId, revision: 1, status: 'ready_for_review' }, rows: structuredClone(rows), summary: { total: 3, eligible: 2, blocked: 1 }, financialWrites: 0,
  } };
  if (name === 'xeroFinancialDocumentPreservationRun') {
    if (scenario === 'failure') return { data: { error: 'The preservation transaction was not confirmed. Inspect the saved link before retrying.' } };
    return { data: { run: { id: runId, revision: 4, status: 'completed' }, financialWrites: 0,
      outcomes: body.selectedItemIds.map((id) => ({ id, status: 'linked', xeroDocumentId: rows.find((row) => row.id === id)?.xeroDocumentId })) } };
  }
  throw new Error(`Offline fixture refuses unexpected operation: ${name}`);
};

createRoot(document.getElementById('root')).render(<main className="min-w-0 p-4">
  <p className="mb-3 text-sm">Offline preservation fixture — all provider operations are stubbed.</p>
  <XeroFinancialSync portalStatus={portalStatus} language="en" />
</main>);

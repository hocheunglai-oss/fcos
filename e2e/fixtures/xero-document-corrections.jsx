import React from 'react';
import { createRoot } from 'react-dom/client';
import { appClient } from '../../src/api/appClient.js';
import XeroFinancialSync from '../../src/components/xero/XeroFinancialSync.jsx';
import '../../src/index.css';

const scenario = new URLSearchParams(window.location.search).get('scenario');
const requests = [];
const row = (id, outcome = 'eligible') => ({ id, salesforceId: `salesforce-${id}`, documentNumber: `INV-${id.toUpperCase()}`,
  kind: id === 'two' || outcome === 'blocked' ? 'supplier_bill' : 'buyer_invoice', stemKey: `STEM-${id}`, vesselName: 'OFFLINE FIXTURE VESSEL', xeroInvoiceId: `xero-${id}`,
  outcome, reason: outcome === 'eligible' ? 'Reference differs; existing amounts and payments are preserved.'
    : outcome === 'blocked' ? 'Xero does not support this paid document date correction.'
      : outcome === 'legacy_preserved' ? 'Issued legacy document is preserved under its existing policy.' : 'Fields already match Salesforce.',
  changes: outcome === 'already_compliant' ? [] : [{ field: 'Reference', before: null, after: 'OFFLINE FIXTURE VESSEL / STEM-ONE' }],
  sourceEvidence: { direction: id === 'two' || outcome === 'blocked' ? 'supplier' : 'buyer',
    resolution: outcome === 'blocked' ? 'linked_buyers' : id === 'two' ? 'unique_stem_buyer' : 'source_buyer',
    originalName: `INV-${id.toUpperCase()}`, dueDate: id === 'two' || outcome === 'blocked' ? '2026-02-28' : '2026-02-25', vesselName: 'OFFLINE FIXTURE VESSEL', refCode: 'HK26STEM-ONE',
    buyers: [{ id: `salesforce-${id}`, name: `INV-${id.toUpperCase()}`, deliveryDate: '2026-01-27', invoiceDate: '2026-01-28',
      proforma: false, deprecated: false, inactive: false, credit: false }, ...(outcome === 'blocked'
      ? [{ id: 'salesforce-conflicting-buyer', name: 'INV-CONFLICTING-BUYER', deliveryDate: '2026-01-29', invoiceDate: '2026-01-30',
        proforma: false, deprecated: false, inactive: false, credit: false }] : [])], links: [],
    ...(id === 'two' ? { fallbackCandidates: [{ id: 'salesforce-two', name: 'INV-TWO', deliveryDate: '2026-01-27', invoiceDate: '2026-01-28',
      proforma: false, deprecated: false, inactive: false, credit: false }, { id: 'salesforce-proforma', name: 'INV-PROFORMA',
      deliveryDate: '2026-01-27', invoiceDate: '2026-01-26', proforma: true, deprecated: false, inactive: false, credit: false }] } : {}) },
  projectionFingerprint: `verified-${id}` });
const sourceItems = ['paged', 'paged-pending', 'paged-invalid', 'paged-scope-invalid'].includes(scenario) ? Array.from({ length: 101 }, (_, index) => row(`page-${index + 1}`))
  : scenario === 'batch' ? Array.from({ length: 26 }, (_, index) => row(String(index + 1)))
  : scenario === 'legacy-cohort' ? [row('one'), row('two'), row('paid-date', 'blocked'), row('matched', 'already_compliant'),
    ...Array.from({ length: 12000 }, (_, index) => row(`legacy-${index}`, 'legacy_preserved'))]
  : [row('one'), row('two'), row('paid-date', 'blocked'), row('legacy', 'legacy_preserved'), row('matched', 'already_compliant')];
const items = sourceItems.filter((item) => item.outcome !== 'legacy_preserved');
const scope = { cutoff: '2026-01-01', totalSourceCount: sourceItems.length, excludedLegacyCount: sourceItems.length - items.length };
const preview = { policy: 'document_field_correction_v1', previewId: 'correction-preview-one', createdAt: '2026-09-28T01:00:00.000Z', items,
  totalCount: items.length, nextOffset: null, scope,
  summary: { eligible: items.filter((item) => item.outcome === 'eligible').length, alreadyCompliant: 1,
    legacyPreserved: scope.excludedLegacyCount, blocked: 1 },
  rateLimit: { dayRemaining: 4998, observedAt: '2026-09-28T01:00:00.000Z' } };
const checkedAt = new Date().toISOString();
const ordinary = { run: { id: 'ordinary-run', revision: 1, status: 'ready_for_review', createdAt: checkedAt, postingMode: 'draft' },
  postingMode: 'draft', checkedAt, rows: [], products: [], mappingProposals: [], payments: { rows: [], summary: { total: 0 } } };
const portalStatus = { externalActions: { xero_financial_sync: { enabled: scenario !== 'locked' } },
  xero: { connected: true, scopeFlags: { invoices: true, contacts: true, settingsRead: true, paymentsRead: true } } };
let finishApply; let finishPage;
window.documentCorrectionFixture = { requests, items, previewBytes: JSON.stringify(preview).length,
  finishApply: () => finishApply?.(), finishPage: () => finishPage?.() };
appClient.functions.invoke = async (name, body) => {
  requests.push({ name, body: structuredClone(body) });
  if (name === 'xeroFinancialMappingsGet') return { data: { productMappings: [], bankMappings: [], accountOptions: [], taxOptions: [] } };
  if (name === 'xeroFinancialSyncLatest') return { data: { preview: structuredClone(ordinary) } };
  if (name === 'xeroFinancialSyncPreview') return { data: structuredClone(ordinary) };
  if (name === 'xeroFinancialDocumentCorrectionPreview') {
    if (scenario === 'scope-error') return { data: { error: 'SECRET raw upstream request', code: 'XERO_DOCUMENT_CORRECTION_SCOPE_INCOMPLETE',
      requestId: 'hnd1::zp2bc-1790577332496-c3f8507dfcb6', details: { rateLimit: { dayRemaining: 4200, observedAt: '2026-09-28T01:00:00.000Z' }, raw: 'SECRET' } } };
    return { data: structuredClone(items.length > 100 ? { ...preview, items: items.slice(0, 100), nextOffset: 100 } : preview) };
  }
  if (name === 'xeroFinancialDocumentCorrectionPage') {
    if (body.previewId !== preview.previewId || body.offset !== 100) throw new Error('Unexpected saved-preview page request.');
    if (scenario === 'paged-pending') await new Promise((resolve) => { finishPage = resolve; });
    return { data: structuredClone({ ...preview, previewId: scenario === 'paged-invalid' ? 'different-preview' : preview.previewId,
      scope: scenario === 'paged-scope-invalid' ? { ...scope, totalSourceCount: scope.totalSourceCount + 1, excludedLegacyCount: 1 } : scope,
      items: items.slice(100), nextOffset: null }) };
  }
  if (name === 'xeroFinancialDocumentCorrectionApply') {
    if (scenario === 'pending') await new Promise((resolve) => { finishApply = resolve; });
    if (scenario === 'lost') throw new Error('Connection lost; the correction result could not be confirmed.');
    return { data: { items: body.itemIds.filter((id) => scenario !== 'missing' || id !== 'two')
      .map((id) => ({ id, outcome: scenario === 'blocked-result' ? 'blocked' : 'applied',
        reason: scenario === 'blocked-result' ? 'Source changed after the preview. Prepare a new preview.' : 'Selected corrections confirmed; amounts and payments preserved.' })) } };
  }
  if (name === 'xeroFinancialDocumentCorrectionVerify') return { data: { items: body.itemIds.map((id) => ({ id, outcome: 'applied',
    reason: 'Recovered through exact readback; no update was resent.' })) } };
  throw new Error(`Offline correction fixture refuses unexpected operation: ${name}`);
};
function FixtureApp() {
  const [enabled, setEnabled] = React.useState(scenario !== 'locked');
  window.documentCorrectionFixture.setFinancialEnabled = setEnabled;
  return <main className="min-w-0 p-4">
    <p className="mb-3 text-sm">Offline correction fixture. All provider operations are stubbed.</p>
    <XeroFinancialSync portalStatus={{ ...portalStatus, externalActions: { xero_financial_sync: { enabled } } }} />
  </main>;
}
createRoot(document.getElementById('root')).render(<FixtureApp />);

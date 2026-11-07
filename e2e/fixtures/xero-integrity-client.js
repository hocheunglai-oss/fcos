const options = new URLSearchParams(window.location.search);
const requests = [];
window.xeroIntegrityFixture = { requests };
const stamp = '2026-10-01T04:00:00Z';
const rows = Array.from({ length: 30 }, (_, index) => ({
  id: `invoice-${index}`, kind: 'buyer_invoice', status: index === 0 ? 'mismatched' : index === 1 ? 'uncertain' : 'matched',
  documentNumber: `INV-${String(index + 1).padStart(3, '0')}`, stemReference: `STEM-${index + 1}`, accountName: 'Synthetic Harbour Buyer',
  date: '2026-09-30', reason: index === 0 ? 'Delivery date differs' : index === 1 ? 'Write outcome needs verified readback' : 'Saved values agree',
  checkedAt: stamp, sourceValues: { Date: '2026-09-30', Total: 1000, CurrencyCode: 'USD' },
  xeroValues: { Date: index === 0 ? '2026-09-29' : '2026-09-30', Total: 1000, CurrencyCode: 'USD' },
  differences: index === 0 ? [{ field: 'Date', source: '2026-09-30', xero: '2026-09-29' }] : [],
  sourceUrl: 'https://example.salesforce.com/001000000000001AAA', xeroUrl: null, amount: 1000, currency: 'USD',
}));
const history = [{ id: 'correction-1', batchId: 'codex-batch-001', documentNumber: 'INV-001', kind: 'buyer_invoice', status: 'confirmed', occurredAt: stamp,
  before: { Date: '2026-09-29', InvoiceNumber: 'INV-001' }, after: { Date: '2026-09-30', InvoiceNumber: 'INV-001' }, readbackVerified: true, notice: 'Exact provider readback confirmed.' },
{ id: 'correction-2', batchId: 'codex-batch-002', documentNumber: 'INV-002', kind: 'buyer_invoice', status: 'uncertain', occurredAt: stamp,
  before: { Date: '2026-09-29' }, after: null, readbackVerified: false, notice: 'Outcome held for readback; no retry assumed.' }];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const appClient = { functions: { async invoke(name, body) {
  requests.push({ name, body: structuredClone(body) });
  if (name !== 'xeroIntegrityReport') throw new Error(`Unexpected action ${name}`);
  if (options.get('case') === 'error' && requests.length === 1) return { data: { error: 'Saved evidence is temporarily unavailable.' } };
  if (body.search === 'slow') await pause(800);
  if (body.search === 'fast') await pause(20);
  const empty = options.get('case') === 'empty';
  let filtered = empty ? [] : rows.filter((row) => (body.status === 'all' || !body.status || row.status === body.status)
    && (body.kind === 'all' || !body.kind || row.kind === body.kind)
    && (!body.search || [row.documentNumber, row.stemReference, row.reason].join(' ').toLowerCase().includes(body.search.toLowerCase()))
    && (!body.from || row.date >= body.from) && (!body.to || row.date <= body.to));
  if (body.search === 'slow' || body.search === 'fast') filtered = [{ ...rows[0], documentNumber: body.search.toUpperCase() }];
  const page = body.page || 1; const pageSize = body.pageSize || 25;
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const unavailable = empty ? null : 0;
  return { data: {
    schemaVersion: 1, generatedAt: stamp, scope: { from: body.from || '2026-01-01', to: body.to || null, dateBasis: 'buyer_invoice_delivery_date', contactsDateBound: false },
    metrics: empty ? Object.fromEntries(['checked','matched','missing','mismatched','blocked','uncertain','unverified'].map((key) => [key, null]))
      : { checked: 30, matched: 28, missing: 0, mismatched: 1, blocked: 0, uncertain: 1, unverified: 0 },
    coverage: [{ key: 'documents', label: 'Invoices and bills', checkedAt: empty ? null : stamp, complete: false, available: !empty, total: empty ? null : 30,
      notice: empty ? 'No saved comparison evidence.' : 'Saved snapshot only; full Salesforce source coverage is unknown.' },
    { key: 'payments', label: 'Payments and allocations', checkedAt: null, complete: false, available: false, total: null, notice: 'Payment evidence is unavailable.' },
    { key: 'contacts', label: 'Contact identities', checkedAt: null, complete: false, available: false, total: null, notice: 'No contact snapshot; contacts are not delivery-date filtered.' }],
    currencyTotals: empty ? [] : [{ currency: 'USD', sourceAmount: 30000, xeroAmount: 30000, difference: 0, recordCount: 30 },
    { currency: 'HKD', sourceAmount: 900, xeroAmount: 890, difference: 10, recordCount: 1 }],
    rows: filtered.slice(start, start + pageSize), pagination: { page, pageSize, total, hasNext: start + pageSize < total },
    history: empty ? [] : history, historyPagination: { page: body.historyPage || 1, pageSize: body.historyPageSize || 20, total: empty ? 0 : 2, hasNext: false },
    health: { lastCheckedAt: empty ? null : stamp, lastSuccessfulSyncAt: null, stale: true, lastConfirmedCorrectionAt: empty ? null : stamp, errors: empty ? [] : [{code: 'SAVED_UNCERTAIN_OPERATION', message: 'An interrupted outcome remains uncertain.'}],
      quota: { available: !empty, availableCalls: unavailable === null ? null : 800, observedAt: empty ? null : stamp }, recentRuns: empty ? [] : [{id: 'saved-run-001', mode: 'preview', status: 'ready_for_review', createdAt: stamp, completedAt: null, counts: {total: 30}, readbackVerified: false}], notice: 'Refreshing reads saved evidence only.' },
    notices: ['Saved comparison evidence does not establish complete live reconciliation.'],
  } };
} } };

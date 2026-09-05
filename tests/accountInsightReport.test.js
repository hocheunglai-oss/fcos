import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinAccountInsightReportPresets, projectAccountInsightReport, validateAccountInsightReportConfig, validateAccountInsightReportPresetConfig } from '../api/_accountInsightReport.js';
import { buildAccountInsightReportPdf } from '../api/_accountInsightReportPdf.js';

function row(index, currency = index % 2 ? 'USD' : 'EUR') {
  return {
    stemId: `stem-${index}`, stemName: `ANON-${String(index).padStart(4, '0')}`, deliveryDate: `2026-07-${String((index % 27) + 1).padStart(2, '0')}`,
    expectedDeliveryDate: '2026-08-20', status: 'Delivered', currency, vesselName: `VESSEL WITH A LONG ANONYMIZED NAME ${index}`,
    portName: index % 2 ? 'Singapore' : 'Rotterdam', volumeMt: index ? index * 10 : 0,
    products: [{ name: index % 2 ? 'VLSFO' : 'MGO', volumeMt: index * 10, unitOfMeasure: 'MT' }],
    invoiceAmount: index === 0 ? 0 : index * 1000, buyerInvoiceIssued: true, buyerInvoiceAmount: index * 1000, supplierInvoiceAmount: index * 700,
    buyerPaymentsReceived: index * 400, supplierPaidAmount: index * 300, receivableBalance: index === 1 ? null : index * 600,
    supplierPayable: index * 400, dueDate: '2026-08-31', grossProfit: index * 50, grossMarginPct: 5, supplierSpend: index * 700,
    brokerCommissions: 999999, internalOnlyNote: 'FORBIDDEN INTERNAL NOTE', counterpartyName: 'FORBIDDEN COUNTERPARTY', accountId: '001SECRET', collectionStatus: 'On track',
  };
}
function insight(rows = [row(1), row(2)]) {
  return {
    identity: { name: 'Anonymized Group', clKey: 'ANON-001', accountId: '001SECRET' }, activeRole: 'group',
    period: { label: 'Jul 2026' }, meta: { salesforceFetchedAt: '2026-09-05T00:00:00Z', invisibleSecret: 'DO NOT EXPORT' },
    exportRows: rows, stems: { total: rows.length, rows: rows.slice(0, 1) },
    kpis: { stemCount: rows.length, deliveredStems: rows.length, totalVolumeMt: rows.reduce((sum, item) => sum + item.volumeMt, 0), moneyByCurrency: [{ currency: 'USD', turnover: 5000, supplierSpend: 3500, grossProfit: 1500, grossMarginPct: 30 }], trend: [{ period: '2026-07', stems: rows.length, volumeMt: 100, grossProfit: 20 }] },
    payments: { buyer: { byCurrency: [{ currency: 'USD', invoiceAmount: 1000, paymentsReceived: 400, receivable: 600 }] }, supplier: { byCurrency: [{ currency: 'USD', invoiceAmount: 700, paidAmount: 300, outstandingPayable: 400 }] } },
    children: [{ name: 'Internal child account', clKey: 'CHILD', stemCount: 1, volumeMt: 10, grossProfit: 1, accountId: 'DO_NOT_COPY' }],
    risk: { dispute: { open: 3 }, exceptions: { count: 2 }, hidden: 'FORBIDDEN RISK' }, warnings: ['Amounts remain separated by currency.'],
    statements: {
      buyer: { identity: { name: 'Anonymized Group', clKey: 'ANON-001' }, period: { label: 'Jul 2026' }, exportRows: rows, kpis: { stemCount: rows.length, totalVolumeMt: 100, trend: [] }, payments: { buyer: { byCurrency: [{ currency: 'USD', invoiceAmount: 1000, paymentsReceived: 400, receivable: 600 }] } }, meta: { salesforceFetchedAt: '2026-09-05T00:00:00Z' } },
      supplier: { identity: { name: 'Anonymized Supplier', clKey: 'SUP-001' }, period: { label: 'Jul 2026' }, exportRows: rows, kpis: { stemCount: rows.length, totalVolumeMt: 100, trend: [] }, payments: { supplier: { byCurrency: [{ currency: 'USD', invoiceAmount: 700, paidAmount: 300, outstandingPayable: 400 }] } }, meta: { salesforceFetchedAt: '2026-09-05T00:00:00Z' } },
    },
  };
}

const internal = { audience: 'internal', sections: ['profile', 'trading', 'monthly', 'products', 'ports', 'children', 'credit', 'forecast', 'aging', 'payments', 'statement', 'stems', 'risks', 'methodology'], columns: ['stem', 'date', 'expectedDate', 'status', 'currency', 'vessel', 'port', 'product', 'quantity', 'invoice', 'payments', 'balance', 'dueDate', 'grossProfit', 'grossMargin'], depth: 'detail', includeExpected: true, includeCharts: true, detailSelection: 'all', selectedStemIds: [] };
const external = { audience: 'buyer', sections: ['profile', 'trading', 'monthly', 'products', 'ports', 'credit', 'aging', 'payments', 'statement', 'stems', 'methodology'], columns: ['stem', 'date', 'status', 'currency', 'vessel', 'port', 'product', 'quantity', 'invoice', 'payments', 'balance', 'dueDate'], depth: 'detail', includeExpected: false, includeCharts: true, detailSelection: 'all', selectedStemIds: [] };

test('has four inert built-in presentation presets', () => {
  const presets = builtinAccountInsightReportPresets();
  assert.equal(presets.length, 4);
  assert.deepEqual(presets.map((preset) => preset.id), ['internalOverview', 'internalCreditReview', 'buyerStatement', 'supplierStatement']);
  assert.ok(presets.every((preset) => !('selectedStemIds' in preset)));
});

test('strictly rejects forged external expansion and malicious saved preset data', () => {
  assert.throws(() => validateAccountInsightReportConfig({ ...external, sections: [...external.sections, 'risks'] }), /not available/);
  assert.deepEqual(validateAccountInsightReportConfig({ ...external, includeExpected: true }).includeExpected, true);
  assert.throws(() => validateAccountInsightReportConfig({ ...external, columns: [...external.columns, 'grossProfit'] }), /not available/);
  assert.throws(() => validateAccountInsightReportConfig({ ...external, extra: 'forged' }), /unsupported/);
  assert.throws(() => validateAccountInsightReportPresetConfig({ ...external, selectedStemIds: ['stem-1'] }), /unsupported/);
  assert.throws(() => validateAccountInsightReportPresetConfig({ ...external, dateFrom: '2026-01-01' }), /unsupported/);
});

test('external projection is an allowlist and protects hidden fields, cost, gross profit, forecast and identities', () => {
  const model = projectAccountInsightReport(insight(), external);
  const serialized = JSON.stringify(model);
  for (const forbidden of ['FORBIDDEN INTERNAL NOTE', 'FORBIDDEN COUNTERPARTY', '001SECRET', 'DO NOT COPY', '999999', 'grossProfit', 'supplierSpend', 'expectedDate', 'counterpartyName']) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(model.sections.find((section) => section.id === 'stems').rows[0].invoice, 1000);
  assert.equal(model.sections.find((section) => section.id === 'stems').rows[0].balance, null);
});

test('detail preserves every loaded row, selected rows and null versus zero', () => {
  const rows = Array.from({ length: 73 }, (_, index) => row(index));
  const all = projectAccountInsightReport(insight(rows), internal);
  const detail = all.sections.find((section) => section.id === 'stems');
  assert.equal(all.detailCount, 73); assert.equal(detail.rows.length, 73); assert.equal(detail.rows[0].invoice, 0); assert.equal(detail.rows[1].balance, null);
  const selected = projectAccountInsightReport(insight(rows), { ...internal, detailSelection: 'selected', selectedStemIds: ['stem-5', 'stem-70'] });
  assert.deepEqual(selected.sections.find((section) => section.id === 'stems').rows.map((item) => item.stem), ['ANON-0005', 'ANON-0070']);
});

test('renderer creates selectable multi-page vector report with repeated header/page counts and no external leaks', () => {
  const model = projectAccountInsightReport(insight(Array.from({ length: 97 }, (_, index) => row(index))), internal);
  const pdf = buildAccountInsightReportPdf(model, { actorName: 'QA user', today: '2026-09-05' });
  assert.equal(pdf.contentType, 'application/pdf'); assert.ok(pdf.buffer.subarray(0, 4).equals(Buffer.from('%PDF'))); assert.ok(pdf.buffer.length > 12_000);
  const raw = pdf.buffer.toString('latin1');
  assert.match(raw, /Page 1 of/); assert.match(raw, /Confidential - Internal use/); assert.match(raw, /ANON-0096/);
  const externalPdf = buildAccountInsightReportPdf(projectAccountInsightReport(insight(), external), { today: '2026-09-05' }).buffer.toString('latin1');
  for (const forbidden of ['FORBIDDEN INTERNAL NOTE', 'FORBIDDEN COUNTERPARTY', '001SECRET']) assert.equal(externalPdf.includes(forbidden), false, forbidden);
});

test('renderer keeps currency and direction labels, credit authority, forecast balances, expected statements, and summary depth explicit', () => {
  const model = {
    audience: 'internal', identity: { name: 'A deliberately long anonymous account name that must wrap instead of clipping in the report header' }, detailCount: 42,
    config: { includeCharts: true, depth: 'summary' },
    sections: [
      { id: 'monthly', currency: 'USD', rows: [{ period: '2026-07', quantity: 0, grossProfit: null, grossMarginPct: null, currency: 'USD' }, { period: '2026-08', quantity: 50, grossProfit: 10, grossMarginPct: 20, currency: 'USD' }] },
      { id: 'credit', currency: 'USD', authority: { name: 'Approved credit authority', limit: 1000, used: 0, available: 1000, currency: 'USD' }, rows: [{ currency: 'USD', invoice: 0, paid: null, balance: null }] },
      { id: 'forecast', currency: 'USD', rows: [{ date: '2026-09-01', balance: 0, currency: 'USD', leg: 'Buyer' }, { date: '2026-09-15', balance: 200, currency: 'USD', leg: 'Buyer' }] },
      { id: 'statement', direction: 'Buyer', currency: 'USD', includeExpected: true, rows: [{ stem: 'QA-1', date: '2026-07-01', invoiceState: 'Issued', currency: 'USD', invoice: 0, expectedAmount: null, paid: null, balance: 0, dueDate: '2026-07-31' }] },
      { id: 'stems', columns: ['stem'], rows: [{ stem: 'must not appear at summary depth' }] },
    ],
  };
  const raw = buildAccountInsightReportPdf(model, { today: '2026-09-05' }).buffer.toString('latin1');
  for (const expected of ['Currency: USD', 'Approved credit authority', 'Actual authoritative forecast points', 'Invoice state', 'Summary depth selected']) assert.ok(raw.includes(expected), expected);
  assert.equal(raw.includes('must not appear at summary depth'), false);
});

test('renderer preserves directional payment evidence and mandatory provenance without methodology', () => {
  const model = {
    audience: 'internal', identity: { name: 'Directional renderer QA' }, detailCount: 1,
    generatedFrom: { sourceTimestamp: '2026-09-05T12:34:56Z' }, scopeLabel: 'QA account scope',
    config: { includeCharts: true, depth: 'detail' },
    sections: [
      { id: 'monthly', direction: 'buyer', currency: 'USD', rows: [{ period: '2026-07', quantity: 0, stemCount: 9999, grossProfit: -20, grossMarginPct: -5, currency: 'USD' }, { period: '2026-08', quantity: 12, stemCount: 1, grossProfit: 30, grossMarginPct: 8, currency: 'USD' }] },
      { id: 'payments', direction: 'supplier', currency: 'EUR', rows: [{ currency: 'EUR', invoice: 30, paid: 0, balance: 30 }], history: [{ stem: 'QA-STEM', reference: 'OWN PAYMENT-001', date: '2026-09-01', currency: 'EUR', amount: 0 }] },
      { id: 'forecast', direction: 'buyer', currency: 'USD', rows: [{ date: '2026-09-01', balance: -20, currency: 'USD', leg: 'Buyer' }, { date: '2026-09-10', balance: null, currency: 'USD', leg: 'Buyer' }, { date: '2026-10-01', balance: 10, currency: 'USD', leg: 'Buyer' }] },
    ],
  };
  const raw = buildAccountInsightReportPdf(model, { today: '2026-09-05' }).buffer.toString('latin1');
  for (const expected of ['Buyer direction', 'Supplier direction', 'Payment history', 'OWN PAYMENT-001', 'Source and reliability', '2026-09-05T12:34:56Z', 'QA account scope', 'Reliability warning']) assert.ok(raw.includes(expected), expected);
  assert.equal(raw.includes('(9999)'), false, 'a real zero quantity must not fall back to the STEM count');
});

test('reports a deterministic count error instead of truncating a loaded detail result', () => {
  const rows = Array.from({ length: 2001 }, (_, index) => row(index));
  assert.throws(() => projectAccountInsightReport(insight(rows), internal), (error) => error.status === 413 && /2,001 detail rows/.test(error.message));
});

function realisticInsight(direction) {
  const buyer = direction === 'buyer';
  const stemId = buyer ? 'buyer-issued' : 'supplier-issued';
  return {
    activeRole: direction, identity: { name: buyer ? 'Buyer QA' : 'Supplier QA', clKey: buyer ? 'BUY-QA' : 'SUP-QA' },
    period: { label: 'Q3 2026' }, meta: { salesforceFetchedAt: '2026-09-05T00:00:00Z' },
    exportRows: [{ stemId, stemName: stemId, deliveryDate: '2026-07-15', expectedDeliveryDate: '2026-08-15', status: 'Delivered', currency: buyer ? 'USD' : 'EUR', vesselName: 'OWN VESSEL', portName: 'Singapore', products: [], volumeMt: 10,
      buyerInvoiceIssued: buyer, buyerInvoiceAmount: 1100, buyerPaymentsReceived: 400, receivableBalance: 700,
      supplierInvoiceAmount: 900, supplierPaidAmount: 200, supplierPayable: 700, grossProfit: 200 }],
    kpis: { stemCount: 1, totalVolumeMt: 10, moneyByCurrency: [{ currency: buyer ? 'USD' : 'EUR', turnover: 1100, supplierSpend: 900, grossProfit: 200 }], currencyTrends: [{ currency: buyer ? 'USD' : 'EUR', rows: [{ period: '2026-07', stems: 1, volumeMt: 10, grossProfit: 200, grossMarginPct: 18.18 }] }] },
    payments: buyer ? { buyer: { byCurrency: [{ currency: 'USD', invoiceAmount: 1100, paymentsReceived: 400, receivable: 700 }], aging: [{ bucket: '0-30', currency: 'USD', amount: 700 }] } } : { supplier: { byCurrency: [{ currency: 'EUR', invoiceAmount: 900, paidAmount: 200, outstandingPayable: 700 }], aging: [{ bucket: '0-30', currency: 'EUR', amount: 700 }] } },
  };
}

const detailedInternalConfig = { audience: 'internal', sections: ['trading', 'monthly', 'credit', 'statement', 'stems'], columns: ['stem', 'currency', 'invoice', 'payments', 'balance'], depth: 'detail', includeExpected: false, includeCharts: false, detailSelection: 'all', selectedStemIds: [] };

test('Both internal reports preserve distinct buyer and supplier sections and authoritative statement values', () => {
  const buyer = realisticInsight('buyer');
  const supplier = realisticInsight('supplier');
  const both = {
    activeRole: 'both', identity: { name: 'Both QA', clKey: 'BOTH-QA' }, buyer, supplier,
    statements: {
      buyer: { statement: { rows: [{ stemName: 'buyer-issued', effectiveDate: '2026-07-15', currency: 'USD', hasBuyerInvoice: true, buyerInvoiceAmount: 1100, actualReleased: 400, statementExposureAmount: 700, buyerInvoiceDueDate: '2026-08-01' }] }, exposureByCurrency: { USD: { individual: 700 } } },
      supplier: { statement: { rows: [{ stemName: 'supplier-issued', effectiveDate: '2026-07-15', currency: 'EUR', rowType: 'issued', invoiceAmount: 900, payments: [{ amount: 200 }], currentExposure: 700, dueDate: '2026-08-02' }] }, kpis: { account: [{ currency: 'EUR', issuedPayable: 900, totalExposure: 700, uninvoicedEstimate: 0 }] } },
    },
  };
  const report = projectAccountInsightReport(both, detailedInternalConfig);
  const monthly = report.sections.filter((section) => section.id === 'monthly');
  assert.deepEqual(monthly.map((section) => section.currency), ['USD', 'EUR']);
  assert.deepEqual(monthly.map((section) => section.direction), ['buyer', 'supplier']);
  const statements = report.sections.filter((section) => section.id === 'statement');
  assert.equal(statements[0].rows[0].invoice, 1100); assert.equal(statements[0].rows[0].payments, 400); assert.equal(statements[0].rows[0].balance, 700);
  assert.equal(statements[1].rows[0].invoice, 900); assert.equal(statements[1].rows[0].payments, 200); assert.equal(statements[1].rows[0].balance, 700);
  assert.notEqual(statements[0].rows[0].currency, statements[1].rows[0].currency);
});

test('external reports omit expected transactions and opposite-leg data, including incomplete payment evidence', () => {
  const buyer = realisticInsight('buyer');
  buyer.exportRows.push({ stemId: 'buyer-expected', stemName: 'buyer-expected', currency: 'USD', expectedDeliveryDate: '2026-08-15', buyerInvoiceIssued: false, buyerInvoiceAmount: 9999, buyerPaymentsReceived: 9999, receivableBalance: 9999, supplierInvoiceAmount: 8888, supplierPaidAmount: 8888, supplierPayable: 8888, grossProfit: 8888, internalNote: 'NOPE' });
  buyer.payments.buyer.byCurrency.push({ currency: 'USD', invoiceAmount: null, paymentsReceived: null, receivable: null, incomplete: true });
  const config = { audience: 'buyer', sections: ['monthly', 'payments', 'statement', 'stems'], columns: ['stem', 'currency', 'invoice', 'payments', 'balance'], depth: 'detail', includeExpected: false, includeCharts: false, detailSelection: 'all', selectedStemIds: [] };
  const report = projectAccountInsightReport(buyer, config);
  const serialised = JSON.stringify(report);
  assert.equal(serialised.includes('buyer-expected'), false);
  for (const forbidden of ['9999', '8888', 'grossProfit', 'supplierInvoiceAmount', 'internalNote', 'expectedDate']) assert.equal(serialised.includes(forbidden), false, forbidden);
  assert.equal(report.sections.find((section) => section.id === 'stems').rows.length, 1);
  assert.equal(report.sections.find((section) => section.id === 'stems').rows[0].balance, 700);
});

test('forged supplier audience cannot be projected from buyer-only evidence', () => {
  const config = { audience: 'supplier', sections: ['profile', 'stems'], columns: ['stem', 'currency', 'invoice', 'payments', 'balance'], depth: 'detail', includeExpected: false, includeCharts: false, detailSelection: 'all', selectedStemIds: [] };
  assert.throws(() => projectAccountInsightReport(realisticInsight('buyer'), config), /does not match/);
});

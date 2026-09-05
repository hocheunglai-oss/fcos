import {
  DEFAULT_REPORT_CONFIG, REPORT_AUDIENCES, REPORT_COLUMNS, REPORT_PRESETS, REPORT_SECTIONS,
} from '../src/lib/accountInsightReportCatalogue.js';
import { accountInsightAgingByCurrency } from './_dashboardAccountInsight.js';
import { isCreditExposureStemEligible } from './_dashboardAccountCreditStatement.js';

const SECTION_BY_ID = new Map(REPORT_SECTIONS.map((item) => [item.id, item]));
const COLUMN_BY_ID = new Map(REPORT_COLUMNS.map((item) => [item.id, item]));
const CONFIG_KEYS = new Set(['audience', 'sections', 'columns', 'depth', 'includeExpected', 'includeCharts', 'detailSelection', 'selectedStemIds']);
const PRESET_KEYS = new Set(['audience', 'sections', 'columns', 'depth', 'includeExpected', 'includeCharts']);
const MAX_SELECTED_STEMS = 500;
export const MAX_REPORT_DETAIL_ROWS = 2_000;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function finite(value) { if (value == null || value === '') return null; const result = Number(value); return Number.isFinite(result) ? result : null; }
function date(value) { return /^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : null; }
function uniqueIds(value, label) {
  if (!Array.isArray(value) || !value.length || value.some((item) => !text(item)) || new Set(value).size !== value.length) fail(`${label} must be a non-empty ordered list of unique IDs.`);
  return value.map(text);
}
function forbidUnknown(object, allowed, label) {
  if (!object || Array.isArray(object) || typeof object !== 'object') fail(`${label} must be an object.`);
  for (const key of Object.keys(object)) if (!allowed.has(key)) fail(`${label} contains unsupported field ${key}.`);
}
function permitted(items, audience, label) {
  for (const item of items) {
    const definition = (label === 'sections' ? SECTION_BY_ID : COLUMN_BY_ID).get(item);
    if (!definition) fail(`Unknown report ${label.slice(0, -1)}: ${item}.`);
    if (!definition.audiences.includes(audience)) fail(`${definition.label} is not available for ${audience} reports.`);
  }
}

/** Validate a per-export configuration.  It returns a new inert object, never caller data. */
export function validateAccountInsightReportConfig(config = DEFAULT_REPORT_CONFIG) {
  forbidUnknown(config, CONFIG_KEYS, 'Report configuration');
  const audience = text(config.audience || DEFAULT_REPORT_CONFIG.audience);
  if (!REPORT_AUDIENCES.includes(audience)) fail('Report audience must be internal, buyer, or supplier.');
  const sections = uniqueIds(config.sections || DEFAULT_REPORT_CONFIG.sections, 'sections');
  const columns = uniqueIds(config.columns || DEFAULT_REPORT_CONFIG.columns, 'columns');
  permitted(sections, audience, 'sections');
  permitted(columns, audience, 'columns');
  const depth = text(config.depth || DEFAULT_REPORT_CONFIG.depth);
  if (!['summary', 'detail'].includes(depth)) fail('Report depth must be summary or detail.');
  if (typeof config.includeExpected !== 'undefined' && typeof config.includeExpected !== 'boolean') fail('includeExpected must be boolean.');
  if (typeof config.includeCharts !== 'undefined' && typeof config.includeCharts !== 'boolean') fail('includeCharts must be boolean.');
  const detailSelection = text(config.detailSelection || 'all');
  if (!['all', 'selected'].includes(detailSelection)) fail('detailSelection must be all or selected.');
  const selectedStemIds = config.selectedStemIds == null ? [] : (() => {
    if (!Array.isArray(config.selectedStemIds) || config.selectedStemIds.some((item) => !text(item)) || new Set(config.selectedStemIds).size !== config.selectedStemIds.length) fail('selectedStemIds must be an ordered list of unique IDs.');
    return config.selectedStemIds.map(text);
  })();
  if (selectedStemIds.length > MAX_SELECTED_STEMS) fail(`At most ${MAX_SELECTED_STEMS} STEMs can be selected.`);
  if (detailSelection === 'selected' && !selectedStemIds.length) fail('Select at least one STEM or choose all STEMs.');
  if (audience !== 'internal' && sections.includes('forecast')) fail('Forecasts are not available in external reports.');
  return Object.freeze({ audience, sections, columns, depth, includeExpected: config.includeExpected === true, includeCharts: config.includeCharts !== false, detailSelection, selectedStemIds });
}

/** Saved presets carry only presentation choices: no record IDs, dates, or amounts. */
export function validateAccountInsightReportPresetConfig(preset) {
  forbidUnknown(preset, PRESET_KEYS, 'Report preset configuration');
  const report = validateAccountInsightReportConfig({ ...preset, detailSelection: 'all', selectedStemIds: [] });
  return Object.freeze({ audience: report.audience, sections: report.sections, columns: report.columns, depth: report.depth, includeExpected: report.includeExpected, includeCharts: report.includeCharts });
}

export function builtinAccountInsightReportPresets() {
  return REPORT_PRESETS.map(({ id, label, ...config }) => Object.freeze({ id, label, ...validateAccountInsightReportPresetConfig(config) }));
}

function summaryRows(rows, key, valueKey = 'volumeMt') {
  const totals = new Map();
  for (const row of rows) {
    const label = text(row[key]) || 'Not set';
    const existing = totals.get(label) || { label, stemCount: 0, quantity: 0 };
    existing.stemCount += 1;
    const quantity = finite(row[valueKey]);
    existing.quantity = existing.quantity == null || quantity == null ? null : existing.quantity + quantity;
    totals.set(label, existing);
  }
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label));
}
function sourceRows(result) { return Array.isArray(result?.exportRows) ? result.exportRows : Array.isArray(result?.stems?.rows) ? result.stems.rows : []; }
function sourceForAudience(result, audience) {
  // buyer/supplier are Account Insight results. Statements are a distinct DTO and
  // are only used in the dedicated statement, forecast and aging sections below.
  if (audience === 'internal') return result;
  const source = result?.[audience] || result;
  const direction = source?.activeRole === 'group' ? 'buyer' : source?.activeRole;
  if (direction !== audience) fail('The report audience does not match the requested Account direction.');
  return source;
}
function reportIdentity(source) {
  const identity = source?.identity || {};
  return { name: text(identity.name) || 'Account', clKey: text(identity.clKey) || null, role: text(source?.activeRole || source?.role) || null };
}
function projectRow(row, audience, includeExpected, direction = 'buyer') {
  const products = Array.isArray(row?.products) ? row.products.map((product) => ({ name: text(product?.name) || 'Not set', quantity: finite(product?.volumeMt ?? product?.quantity), unit: product?.volumeMt != null ? 'MT' : text(product?.unitOfMeasure || product?.originalUom) || null })) : [];
  const common = {
    stem: text(row?.stemName || row?.stem || row?.name) || 'STEM not set', date: date(row?.deliveryDate || row?.actualDeliveryDate || row?.effectiveDate),
    status: text(row?.status) || null, currency: text(row?.currency) || null, vessel: text(row?.vesselName || row?.vessel) || null,
    port: text(row?.portName || row?.port) || null, products, quantity: finite(row?.volumeMt ?? row?.quantity),
    ...(includeExpected ? { expectedDate: date(row?.expectedDeliveryDate) } : {}),
    invoiceState: direction === 'supplier' ? row?.supplierInvoiceCount > 0 ? 'Issued' : 'Expected' : row?.buyerInvoiceIssued === true || row?.invoiceValueSource === 'invoiced' ? 'Issued' : 'Expected',
    dueDate: date(row?.dueDate), age: finite(row?.ageDays ?? row?.age), invoiceCount: finite(direction === 'supplier' ? row?.supplierInvoiceCount : row?.buyerInvoiceCount), paymentCount: finite(direction === 'supplier' ? row?.supplierPaymentCount : row?.buyerPaymentCount),
  };
  if (audience === 'internal') return {
    ...common, expectedDate: includeExpected ? date(row?.expectedDeliveryDate) : null,
    invoice: finite(direction === 'supplier' ? row?.supplierInvoiceAmount : row?.buyerInvoiceIssued === false ? null : row?.invoiceAmount), payments: finite(direction === 'supplier' ? row?.supplierPaidAmount : row?.buyerPaymentsReceived), balance: finite(direction === 'supplier' ? row?.supplierPayable : row?.receivableBalance),
    buyerInvoice: finite(row?.buyerInvoiceAmount ?? row?.invoiceAmount), buyerPayments: finite(row?.buyerPaymentsReceived ?? row?.paymentsReceived), buyerBalance: finite(row?.receivableBalance),
    supplierInvoice: finite(row?.supplierInvoiceAmount), supplierPayments: finite(row?.supplierPaidAmount), supplierBalance: finite(row?.supplierPayable ?? row?.outstandingPayable),
    grossProfit: finite(row?.grossProfit), grossMarginPct: finite(row?.grossMarginPct), collectionStatus: text(row?.collectionStatus) || null,
  };
  // The only externally copied monetary fields are named party-facing invoice,
  // credit, payment and balance fields.  No calculated internal allocation/cost/GP
  // fallbacks are permitted here.
  const own = audience === 'buyer'
    ? { invoice: row?.buyerInvoiceIssued === false ? null : finite(row?.buyerInvoiceAmount ?? row?.invoiceAmount), payments: finite(row?.buyerPaymentsReceived ?? row?.paymentsReceived), balance: finite(row?.receivableBalance), collectionStatus: null }
    : { invoice: finite(row?.supplierInvoiceAmount), payments: finite(row?.supplierPaidAmount ?? row?.paidAmount), balance: finite(row?.supplierPayable ?? row?.outstandingPayable), collectionStatus: null };
  return { ...common, ...own };
}

function statementRows(statement, direction, internal, includeExpected, selected = null) {
  return (statement?.statement?.rows || statement?.rows || []).filter((row) => (!selected || selected.has(row.stemId)) && (includeExpected || (direction === 'buyer' ? row.hasBuyerInvoice : row.rowType === 'issued'))).map((row) => ({
    stem: text(row.stemName), date: date(row.effectiveDate || row.deliveryDate), currency: text(row.currency),
    invoiceState: direction === 'buyer' ? row.hasBuyerInvoice ? 'Issued' : 'Expected' : row.rowType === 'issued' ? 'Issued' : 'Expected',
    invoice: finite(direction === 'buyer' ? row.buyerInvoiceAmount : row.invoiceAmount),
    ...(includeExpected ? { expectedAmount: finite(direction === 'buyer' ? row.expectedBuyerInvoiceAmount : row.expectedSupplierCost) } : {}),
    payments: finite(direction === 'buyer' ? row.actualReleased : (row.payments || []).reduce((sum, payment) => sum + (finite(payment.amount) || 0), 0)),
    balance: finite(direction === 'buyer' ? row.hasBuyerInvoice || internal ? row.statementExposureAmount : null : row.currentExposure),
    dueDate: date(direction === 'buyer' ? row.buyerInvoiceDueDate : row.dueDate),
    basis: internal ? text(direction === 'buyer' ? row.statementExposureBasis : row.quantityBasis) : null,
  }));
}

function ownDocumentRows(rows, direction) {
  const evidenceKey = direction === 'supplier' ? 'supplierDocumentEvidence' : 'buyerDocumentEvidence';
  return rows.filter((row) => isCreditExposureStemEligible({ Delivery_Date__c: row?.deliveryDate ?? row?.actualDeliveryDate, Expected_Delivery_Date__c: row?.expectedDeliveryDate })).flatMap((row) => (Array.isArray(row?.[evidenceKey]) ? row[evidenceKey] : []).filter((document) => document?.current === true).map((document) => ({
    stem: text(row.stemName || row.stem || row.name) || 'STEM not set',
    number: text(document?.documentNumber) || 'Document number unavailable',
    type: document?.documentType === 'credit_note' ? 'Credit note' : 'Invoice',
    date: date(document?.documentDate), currency: text(document?.currency || row.currency) || null, amount: finite(document?.amount),
  })));
}

function forecastSections(statement, direction, isGroup) {
  if (direction === 'supplier') return (statement?.chart?.currencies || []).map((chart) => ({ id: 'forecast', direction, currency: chart.currency, rows: (chart?.[isGroup ? 'group' : 'account']?.points || []).map((point) => ({ date: point.date, balance: finite(point.remaining), currency: chart.currency, leg: direction })), basis: 'Authoritative supplier payment schedule; undated residuals remain unreleased.' }));
  // The buyer chart is suppressed by the authoritative engine when currencies or
  // evidence are incompatible. Do not reconstruct a substitute forecast here.
  if (statement?.currencies?.length !== 1) return [{ id: 'forecast', direction, rows: [], basis: 'Forecast unavailable: incomplete or multiple-currency evidence.' }];
  const currency = statement.currencies[0];
  return [{ id: 'forecast', direction, currency, rows: (statement.chart?.points || []).map((point) => ({ date: point.date, balance: finite(point[isGroup ? 'groupExposure' : 'individualExposure']), currency, leg: direction })), basis: `Payment-performance ${statement.forecastSettings?.effectiveConservativeness || 'cautious'} scenario. Undated residuals remain unreleased.` }];
}

function creditSection(statement, direction, isGroup, internal) {
  const rows = direction === 'supplier'
    ? (statement?.kpis?.[isGroup ? 'group' : 'account'] || []).map((row) => ({ currency: row.currency, invoice: row.issuedPayable, payments: null, balance: internal ? row.totalExposure : row.issuedPayable, expectedAmount: internal ? row.uninvoicedEstimate : null }))
    : Object.entries(statement?.exposureByCurrency || {}).map(([currency, values]) => ({ currency, invoice: null, payments: null, balance: finite(values[isGroup ? 'group' : 'individual']) }));
  const authorityResolved = !statement?.creditResolution || ['selected_account', 'group_hierarchy_authority', 'same_name_fallback'].includes(statement.creditResolution.mode);
  const authority = internal && direction === 'buyer' && statement?.credit ? { name: statement.creditResolution?.accountName || statement.identity?.name, currency: statement.credit.currency, limit: finite(isGroup ? statement.credit.groupCapacity : statement.credit.individualCapacity), used: finite(isGroup ? statement.credit.usedGroup : statement.credit.usedCustomer), available: authorityResolved ? finite(statement.credit.calculatedAvailable) : null } : null;
  return { id: 'credit', direction, rows, authority };
}
function currencyRows(source, audience) {
  const payment = audience === 'supplier' ? source?.payments?.supplier : source?.payments?.buyer;
  const rows = Array.isArray(payment?.byCurrency) ? payment.byCurrency : [];
  return rows.map((row) => audience === 'supplier'
    ? { currency: text(row.currency) || null, invoice: finite(row.invoiceAmount), payments: finite(row.paidAmount), balance: finite(row.outstandingPayable) }
    : { currency: text(row.currency) || null, invoice: finite(row.invoiceAmount), payments: finite(row.paymentsReceived), balance: finite(row.receivable) });
}
function ownCurrencyTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    const currency = row.currency || 'Currency not set';
    const total = totals.get(currency) || { currency, invoice: 0, payments: 0, balance: 0 };
    for (const key of ['invoice', 'payments', 'balance']) {
      const value = finite(row[key]);
      total[key] = total[key] == null || value == null ? null : total[key] + value;
    }
    totals.set(currency, total);
  }
  return [...totals.values()];
}
function externalMonthlyRows(rows) {
  const periods = new Map();
  for (const row of rows) {
    const period = row.date?.slice(0, 7) || row.expectedDate?.slice(0, 7);
    if (!period) continue;
    const key = `${row.currency}:${period}`;
    const current = periods.get(key) || { currency: row.currency, period, stemCount: 0, quantity: 0 };
    current.stemCount += 1;
    current.quantity = current.quantity == null || row.quantity == null ? null : current.quantity + row.quantity;
    periods.set(key, current);
  }
  const currencies = new Map();
  for (const row of [...periods.values()].sort((a, b) => a.period.localeCompare(b.period))) {
    if (!currencies.has(row.currency)) currencies.set(row.currency, []);
    currencies.get(row.currency).push(row);
  }
  return [...currencies].map(([currency, values]) => ({ currency, rows: values }));
}

/**
 * Produces an inert reporting model.  It never spreads result objects, which makes
 * accidental future fields (account IDs, notes, limits, GP, counterparties, etc.)
 * impossible to reach an external renderer.
 */
export function projectAccountInsightReport(result, config) {
  const report = validateAccountInsightReportConfig(config);
  if (report.audience === 'internal' && result?.activeRole === 'both') {
    const unionIds = new Set([...sourceRows(result.buyer), ...sourceRows(result.supplier)].map((row) => row.stemId));
    if (report.detailSelection === 'selected' && report.selectedStemIds.some((id) => !unionIds.has(id))) fail('One or more selected STEMs are outside this Account scope.');
    const legs = ['buyer', 'supplier'].map((direction) => {
      const leg = result[direction];
      if (!leg) fail(`The ${direction} evidence is unavailable; no partial Both report was generated.`);
      const ids = new Set(sourceRows(leg).map((row) => row.stemId));
      const selection = report.selectedStemIds.filter((id) => ids.has(id));
      const selectedLeg = report.detailSelection === 'selected' && !selection.length ? { ...leg, exportRows: [] } : leg;
      return projectAccountInsightReport({ ...selectedLeg, activeRole: direction, statements: result.statements }, { ...report, detailSelection: selection.length ? 'selected' : 'all', selectedStemIds: selection });
    });
    return { ...legs[0], identity: { ...legs[0].identity, role: 'both' }, sections: report.sections.flatMap((id) => legs.flatMap((leg) => leg.sections.filter((section) => section.id === id))), detailCount: legs.reduce((sum, leg) => sum + leg.detailCount, 0), totalDetailCount: legs.reduce((sum, leg) => sum + leg.totalDetailCount, 0) };
  }
  const source = sourceForAudience(result, report.audience);
  const direction = report.audience === 'supplier' || source.activeRole === 'supplier' ? 'supplier' : 'buyer';
  if (report.audience !== 'internal' && direction !== report.audience) fail('The report audience does not match the requested Account direction.');
  const internal = report.audience === 'internal';
  const statement = result?.statements?.[direction] || source?.statements?.[direction];
  const isGroup = source.entityType === 'group' || source.activeRole === 'group';
  const rawRows = sourceRows(source);
  const selected = report.detailSelection === 'selected' ? new Set(report.selectedStemIds) : null;
  const selectedRows = selected ? rawRows.filter((row) => selected.has(row?.stemId)) : rawRows;
  if (selected && selectedRows.length !== selected.size) fail('One or more selected STEMs are outside the loaded Account scope.');
  if (selectedRows.length > MAX_REPORT_DETAIL_ROWS) fail(`Report contains ${selectedRows.length.toLocaleString('en-US')} detail rows; narrow the period or select no more than ${MAX_REPORT_DETAIL_ROWS.toLocaleString('en-US')} STEMs.`, 413);
  const rows = selectedRows.map((row) => projectRow(row, report.audience, report.includeExpected, direction)).filter((row) => internal || report.includeExpected || row.invoiceState === 'Issued');
  const kpis = source?.kpis || {};
  const financials = (Array.isArray(kpis.moneyByCurrency) ? kpis.moneyByCurrency : []).map((row) => internal
    ? { currency: text(row.currency) || null, turnover: finite(row.turnover), supplierSpend: finite(row.supplierSpend), grossProfit: finite(row.grossProfit), grossMarginPct: finite(row.grossMarginPct) }
    : { currency: text(row.currency) || null });
  const sections = [];
  for (const id of report.sections) {
    if (id === 'profile') sections.push({ id, identity: reportIdentity(source), period: { label: text(source?.period?.label) || 'Selected period' }, scope: { accountCount: finite(source?.scope?.accountCount) } });
    else if (id === 'trading') sections.push(internal ? { id, stemCount: finite(kpis.stemCount) ?? rows.length, deliveredStems: finite(kpis.deliveredStems), pendingStems: finite(kpis.pendingStems), quantity: finite(kpis.totalVolumeMt), financials } : { id, stemCount: rows.length, quantity: rows.some((row) => row.quantity == null) ? null : rows.reduce((sum, row) => sum + row.quantity, 0), financials: ownCurrencyTotals(rows) });
    else if (id === 'monthly') {
      if (!internal) { sections.push(...externalMonthlyRows(rows).map((trend) => ({ id, ...trend }))); continue; }
      const trends = kpis.currencyTrends?.length ? kpis.currencyTrends : [{ currency: financials.length === 1 ? financials[0].currency : null, rows: kpis.trend || [] }];
      for (const trend of trends) sections.push({ id, currency: trend.currency, rows: trend.rows.map((row) => ({ period: text(row.period), currency: trend.currency, stemCount: finite(row.stems), quantity: finite(row.volumeMt), ...(internal ? { grossProfit: finite(row.grossProfit), grossMarginPct: finite(row.grossMarginPct) } : {}) })) });
    }
    else if (id === 'products') sections.push({ id, rows: summaryRows(rows.flatMap((row) => row.products.map((product) => ({ product: product.name, volumeMt: product.quantity }))), 'product') });
    else if (id === 'ports') sections.push({ id, rows: summaryRows(rows, 'port', 'quantity') });
    else if (id === 'children' && internal) sections.push({ id, rows: (source?.children || []).map((row) => ({ name: text(row.name) || 'Account', clKey: text(row.clKey) || null, stemCount: finite(row.stemCount), quantity: finite(row.volumeMt), grossProfit: finite(row.grossProfit) })) });
    else if (id === 'credit') sections.push(internal ? creditSection(statement, direction, isGroup, true) : { id, rows: ownCurrencyTotals(statementRows(statement, direction, false, report.includeExpected)) });
    else if (id === 'forecast' && internal) sections.push(...forecastSections(statement, direction, isGroup));
    else if (id === 'aging') {
      const aging = internal ? source?.payments?.[direction]?.agingByCurrency || [] : accountInsightAgingByCurrency(rows, source?.payments?.asOfDate, 'balance');
      sections.push({ id, rows: aging.flatMap((row) => [['days1to7', '1–7 days'], ['days8to30', '8–30 days'], ['days31to60', '31–60 days'], ['days61to90', '61–90 days'], ['over90', 'Over 90 days'], ['undated', 'Due date unavailable']].map(([key, bucket]) => ({ bucket, currency: row.currency, balance: finite(row[key]) }))) });
    }
    else if (id === 'payments') {
      const eligible = selectedRows.filter((row) => internal || report.includeExpected || (direction === 'buyer' ? row.buyerInvoiceIssued : row.supplierInvoiceCount > 0));
      const history = report.depth === 'detail' ? eligible.flatMap((row) => (row[direction === 'buyer' ? 'buyerPaymentEvidence' : 'supplierPaymentEvidence'] || []).map((payment) => ({ stem: text(row.stemName), reference: text(payment.paymentName), date: date(payment.paymentDate), amount: finite(payment.amount), currency: text(payment.currency || row.currency) }))) : [];
      sections.push({ id, rows: internal ? currencyRows(source, direction) : ownCurrencyTotals(rows), history });
    }
    else if (id === 'statement') sections.push({ id, includeExpected: report.includeExpected, rows: statementRows(statement, direction, internal, report.includeExpected, selected), documents: ownDocumentRows(selectedRows, direction) });
    else if (id === 'stems') sections.push({ id, columns: report.columns, rows: report.depth === 'detail' ? rows : [], summaryOnly: report.depth !== 'detail', matchingCount: rows.length });
    else if (id === 'risks' && internal) sections.push({ id, openDisputes: finite(source?.risk?.dispute?.open), exceptions: finite(source?.risk?.exceptions?.count) });
    else if (id === 'methodology') sections.push({ id, sourceTimestamp: text(source?.meta?.salesforceFetchedAt) || null, scope: text(source?.period?.label) || 'Selected period', basis: 'Values retain their source currency and are not netted across currencies.', reliability: ['Payment data is reliable from 1 January 2026. Earlier settled commercial history has unavailable payment metrics.', ...(internal && Array.isArray(source?.warnings) ? source.warnings.map(text).filter(Boolean) : ['Only this recipient direction is included. Expected activity, when selected, is not an issued document.'])] });
  }
  return Object.freeze({ audience: report.audience, config: report, identity: reportIdentity(source), detailCount: rows.length, totalDetailCount: rawRows.length, sections: sections.map((section) => ({ ...section, direction })), generatedFrom: { sourceTimestamp: text(source?.meta?.salesforceFetchedAt) || null, statementTimestamp: text(statement?.meta?.salesforceFetchedAt || statement?.generatedAt) || null, period: text(source?.period?.label) || 'Selected period', accountScope: (source?.groupScope?.availableAccounts || []).filter((account) => account.included).map((account) => ({ name: text(account.name), clKey: text(account.clKey) })), filterScope: source?.dashboardScope?.mode === 'account_wide' ? 'Account-wide' : 'Inherited Dashboard filters' } });
}

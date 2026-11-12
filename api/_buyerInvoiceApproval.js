const INVOICE_FIELDS = [
  'Id', 'Name', 'STEM__c', 'CurrencyIsoCode', 'Amount__c', 'Invoice_Date__c',
  'Delivery_Date__c', 'Invoice_Due_Date__c', 'File__c',
];
const STEM_FIELDS = ['Id', 'Account__c', 'CurrencyIsoCode', 'Payment_Term__c'];
const LINE_FIELDS = [
  'Id', 'Product__c', 'Product__r.Name', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c',
  'Quantity_Max__c', 'Unit_of_Measure__c', 'Unit_Sell_At__c', 'Total_Price__c', 'CurrencyIsoCode',
];
const EXTRA_FIELDS = [
  'Id', 'Product2Id__c', 'Product2Id__r.Name', 'Description__c', 'Quantity__c',
  'Quantity_Delivered_Per_BDN__c', 'Quantity_Range_Max__c', 'Unit_of_Measure__c',
  'Unit_Price__c', 'Lumpsum_Price__c', 'Line_Total__c', 'CurrencyIsoCode',
];
const FX_INVOICE_FIELDS = [
  'Document_Currency__c', 'Document_HKD_Amount__c', 'Document_FX_Rate__c',
  'Document_FX_Revision__c', 'Document_FX_Confirmed_At__c', 'Document_FX_Side__c',
];
const FX_ROW_FIELDS = [
  'Sell_Currency__c', 'Sell_USD_Unit_Price_Precise__c', 'Sell_HKD_Unit_Price__c', 'Sell_HKD_Minimum__c',
  'Sell_HKD_Lumpsum__c', 'Sell_FX_Rate__c', 'Sell_FX_Revision__c',
  'Sell_FX_Confirmed_At__c', 'Sell_FX_Side__c',
];

function text(value) {
  return String(value ?? '').trim();
}

function valueAt(record, field) {
  return field.split('.').reduce((value, key) => value == null ? undefined : value[key], record);
}

function project(record, fields) {
  return Object.fromEntries(fields.map((field) => [field, valueAt(record, field) ?? null]));
}

function compareById(left, right) {
  return text(left?.Id).localeCompare(text(right?.Id));
}

function invoiceRows(rows, invoiceId) {
  return (rows || []).filter(row => row.Buyer_Invoice__c === invoiceId && row.Cancelled__c !== true).sort(compareById);
}

function normalizeFxTimestamp(fields, key) {
  const value = fields?.[key];
  if (typeof value !== 'string') return fields;
  const time = Date.parse(value);
  return Number.isFinite(time) ? { ...fields, [key]: new Date(time).toISOString() } : fields;
}

function requiresFxEvidence(invoice, lines, extras) {
  const hkd = value => text(value).toUpperCase() === 'HKD';
  const hasFx = row => hkd(row.Sell_Currency__c) || row.Sell_USD_Unit_Price_Precise__c != null;
  return hkd(invoice.Document_Currency__c) || lines.some(hasFx) || extras.some(hasFx);
}

function projectFxRow(row) {
  return normalizeFxTimestamp(project(row, FX_ROW_FIELDS), 'Sell_FX_Confirmed_At__c');
}

function sortSnapshotFxRows(baseRows, fxRows) {
  if (!Array.isArray(fxRows) || fxRows.length !== baseRows.length) return null;
  // Apex emits one FX row per invoice row in the same order, without duplicating the Id.
  return baseRows.map((row, index) => ({ Id: row?.Id, fx: fxRows[index] }))
    .sort(compareById).map(({ fx }) => normalizeFxTimestamp(fx, 'Sell_FX_Confirmed_At__c'));
}

function contentDocumentId(fileUrl) {
  const value = text(fileUrl);
  return value ? value.slice(value.lastIndexOf('/') + 1) : null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function isFinalBuyerInvoice(invoice) {
  return Boolean(invoice)
    && invoice.Proforma__c !== true
    && invoice.Deprecated__c !== true
    && !/(?:^|-)CN(?:-|$)/i.test(text(invoice.Name));
}

export function isIssuedFinalBuyerInvoice(invoice) {
  return isFinalBuyerInvoice(invoice) && Boolean(text(invoice.File__c));
}

export function buyerInvoiceApprovalProjection(invoice, liveCase) {
  const invoiceSource = liveCase?.invoiceSource || liveCase;
  const documentId = contentDocumentId(invoice?.File__c);
  const document = invoice?._buyerInvoiceDocument;
  if (!invoice || !invoiceSource?.stem || !documentId || !document
    || text(document.Id) !== documentId || !text(document.LatestPublishedVersionId)) return null;
  const lines = invoiceRows(invoiceSource.allLineItems, invoice.Id);
  const extras = invoiceRows(invoiceSource.allExtraCosts, invoice.Id);
  const projection = {
    version: 1,
    invoice: project(invoice, INVOICE_FIELDS),
    stem: project(invoiceSource.stem, STEM_FIELDS),
    pdf: { Id: document.Id, LatestPublishedVersionId: document.LatestPublishedVersionId },
    lines: lines.map(row => project(row, LINE_FIELDS)),
    extras: extras.map(row => project(row, EXTRA_FIELDS)),
  };
  if (requiresFxEvidence(invoice, lines, extras)) {
    const hasFields = (row, fields) => fields.every(field => Object.hasOwn(row, field));
    if (!hasFields(invoice, FX_INVOICE_FIELDS) || ![...lines, ...extras].every(row => hasFields(row, FX_ROW_FIELDS))) return null;
    projection.fx = {
      version: 1,
      document: normalizeFxTimestamp(project(invoice, FX_INVOICE_FIELDS), 'Document_FX_Confirmed_At__c'),
      lines: lines.map(projectFxRow),
      extras: extras.map(projectFxRow),
    };
  }
  return projection;
}

export function buyerInvoiceSnapshotComparison(invoice, liveCase) {
  const raw = text(invoice?.Buyer_Charge_Snapshot__c);
  if (!raw) return { kind: 'legacy', matches: null };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'snapshot', matches: false };
  }
  const current = buyerInvoiceApprovalProjection(invoice, liveCase);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 1
    || !Array.isArray(parsed.lines) || !Array.isArray(parsed.extras) || !current) {
    return { kind: 'snapshot', matches: false };
  }
  const normalized = {
    ...parsed,
    lines: [...parsed.lines].sort(compareById),
    extras: [...parsed.extras].sort(compareById),
  };
  if (parsed.fx != null && typeof parsed.fx === 'object' && !Array.isArray(parsed.fx)) {
    normalized.fx = {
      ...parsed.fx,
      document: normalizeFxTimestamp(parsed.fx.document, 'Document_FX_Confirmed_At__c'),
      lines: sortSnapshotFxRows(parsed.lines, parsed.fx.lines),
      extras: sortSnapshotFxRows(parsed.extras, parsed.fx.extras),
    };
  }
  return { kind: 'snapshot', matches: stableJson(normalized) === stableJson(current) };
}

export const buyerInvoiceApprovalFxFields = { invoice: FX_INVOICE_FIELDS, row: FX_ROW_FIELDS };

export const buyerInvoiceApprovalFields = {
  invoice: INVOICE_FIELDS,
  stem: STEM_FIELDS,
  line: LINE_FIELDS,
  extra: EXTRA_FIELDS,
};

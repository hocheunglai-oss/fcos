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

function projectRows(rows, fields) {
  return [...(rows || [])]
    .sort(compareById)
    .map((row) => project(row, fields));
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
  const documentId = contentDocumentId(invoice?.File__c);
  const document = invoice?._buyerInvoiceDocument;
  if (!invoice || !liveCase?.stem || !documentId || !document
    || text(document.Id) !== documentId || !text(document.LatestPublishedVersionId)) return null;
  return {
    version: 1,
    invoice: project(invoice, INVOICE_FIELDS),
    stem: project(liveCase.stem, STEM_FIELDS),
    pdf: { Id: document.Id, LatestPublishedVersionId: document.LatestPublishedVersionId },
    lines: projectRows((liveCase.allLineItems || []).filter((row) => row.Buyer_Invoice__c === invoice.Id), LINE_FIELDS),
    extras: projectRows((liveCase.allExtraCosts || []).filter((row) => row.Buyer_Invoice__c === invoice.Id), EXTRA_FIELDS),
  };
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
  return { kind: 'snapshot', matches: stableJson(normalized) === stableJson(current) };
}

export const buyerInvoiceApprovalFields = {
  invoice: INVOICE_FIELDS,
  stem: STEM_FIELDS,
  line: LINE_FIELDS,
  extra: EXTRA_FIELDS,
};

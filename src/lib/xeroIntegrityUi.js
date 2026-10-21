export const XERO_INTEGRITY_STATUSES = [
  ['all', 'All statuses'],
  ['matched', 'Matched'],
  ['missing', 'Missing in Xero'],
  ['mismatched', 'Mismatched'],
  ['blocked', 'Blocked'],
  ['uncertain', 'Uncertain'],
  ['unverified', 'Unverified'],
];

export const XERO_INTEGRITY_KINDS = [
  ['all', 'All record types'],
  ['buyer_invoice', 'Buyer invoices'],
  ['buyer_credit', 'Buyer credit notes'],
  ['supplier_bill', 'Supplier bills'],
  ['supplier_credit', 'Supplier credit notes'],
  ['contact', 'Contacts'],
  ['payment', 'Payments & allocations'],
];

const STATUS_TONES = {
  matched: 'emerald',
  missing: 'amber',
  mismatched: 'rose',
  blocked: 'amber',
  uncertain: 'amber',
  unverified: 'slate',
  corrected: 'emerald',
  pending: 'amber',
  failed: 'rose',
  confirmed: 'emerald',
  rejected: 'rose',
};

const HISTORY_STATUS_LABELS = {
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  uncertain: 'Uncertain',
};

export function statusLabel(status) {
  return XERO_INTEGRITY_STATUSES.find(([value]) => value === status)?.[1]
    || HISTORY_STATUS_LABELS[String(status || '').toLowerCase()]
    || String(status || 'Unavailable').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function kindLabel(kind) {
  return XERO_INTEGRITY_KINDS.find(([value]) => value === kind)?.[1]
    || String(kind || 'Record').replace(/_/g, ' ');
}

export function statusTone(status) {
  return STATUS_TONES[String(status || '').toLowerCase()] || 'slate';
}

export function isFiniteAmount(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function amountText(value, currency) {
  if (!isFiniteAmount(value)) return 'Not available';
  const formatted = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return currency ? `${currency} ${formatted}` : formatted;
}

export function formatDateTime(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

export function formatDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

export function safeExternalUrl(value, provider) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase();
    if (provider === 'salesforce' && !hostname.endsWith('.salesforce.com')) return null;
    if (provider === 'xero' && !hostname.endsWith('.xero.com')) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normaliseObjectValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 12)
    .map(([key, value]) => [key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim(), renderValue(value)]);
}

function renderValue(value) {
  if (value === undefined || value === null || value === '') return 'Not available';
  if (isFiniteAmount(value)) return amountText(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  return 'Not available';
}

export function differenceEntries(differences) {
  if (Array.isArray(differences)) {
    return differences.slice(0, 12).map((difference) => ({
      field: readableKey(difference?.field || 'Difference'),
      source: renderValue(difference?.source),
      xero: renderValue(difference?.xero),
    }));
  }
  if (!differences || typeof differences !== 'object') return [];
  return Object.entries(differences)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 12)
    .map(([key, value]) => ({ field: readableKey(key), source: renderValue(value), xero: 'Not available' }));
}

function readableKey(key) {
  return String(key).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
}

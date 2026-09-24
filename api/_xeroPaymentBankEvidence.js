import { createHash } from 'node:crypto';
import { paymentCurrency } from './_xeroPaymentIdentity.js';

const name = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value);
const blank = (value) => value == null || String(value).trim() === '';

function cents(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && Number.isSafeInteger(Math.round(number * 100)) ? Math.round(number * 100) : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sourceIdentity(row) {
  return {
    id: row.Id, parentId: row.Remittance__c ?? null, type: row.RecordType?.DeveloperName ?? null,
    name: row.Name ?? null, created: row.CreatedDate ?? null, stemId: row.STEM__c ?? null,
    reference: row.Reference__c ?? null, rawCurrency: row.CurrencyIsoCode ?? null,
    bank: row.Bank__c ?? null, date: row.Date__c ?? null, accountId: row.Account__c ?? null,
    amount: row.Amount__c ?? null, currency: paymentCurrency(row), currencyBlockers: row._currency?.blockers ?? [],
    deposit: row.Is_Deposit__c, volumeDiscount: row.Is_Volume_Discount__c,
    commissionInvoiceId: row.Commission_Invoice__c ?? null, supplierInvoiceId: row.Supplier_Invoice__c ?? null,
    modified: row.LastModifiedDate ?? null,
  };
}

function supported(row, expectedType, parent, currency) {
  if (row.RecordType?.DeveloperName !== expectedType) return 'The remittance family has an unsupported payment type.';
  if (row.Is_Deposit__c !== false || row.Is_Volume_Discount__c !== false || !blank(row.Commission_Invoice__c)) return 'The remittance family includes a deposit, volume discount, commission or unknown flag.';
  if (!blank(row.Supplier_Invoice__c)) return 'The remittance family includes a supplier allocation.';
  if (!id(row.Account__c) || row.Account__c !== parent.Account__c) return 'The remittance family contains different or missing Salesforce Account IDs.';
  if (!validDate(row.Date__c) || row.Date__c !== parent.Date__c) return 'The remittance family contains different or invalid payment dates.';
  if (row._currency?.blockers?.length || !paymentCurrency(row) || paymentCurrency(row) !== currency) return 'The remittance family currency is missing, invalid or different.';
  if (cents(row.Amount__c) == null) return 'The remittance family includes a zero, negative or invalid amount.';
  return null;
}

export function resolveRemittanceBankEvidence(payment, { parent, siblings, complete = false } = {}) {
  const blocked = (reason) => ({ payment: { ...payment, _bankEvidenceBlocker: reason }, reason });
  if (payment.RecordType?.DeveloperName !== 'Receivable' || !blank(payment.Bank__c)) return { payment, reason: null };
  if (!id(payment.Remittance__c)) return blocked('The Salesforce payment bank is missing and no exact remittance parent is identified.');
  if (!complete || !parent || !Array.isArray(siblings)) return blocked('The Salesforce payment bank is missing; complete remittance parent and sibling evidence is unavailable.');
  if (!id(parent.Id) || parent.Id !== payment.Remittance__c) return blocked('The remittance parent identity does not match this payment.');
  if (parent.RecordType?.DeveloperName !== 'Receivable_Remittance' || !blank(parent.Remittance__c)) return blocked('The remittance parent is not an independent Receivable_Remittance cash receipt.');
  if (!name(parent.Bank__c)) return blocked('The remittance parent has no named bank.');
  if (!id(parent.Account__c) || !validDate(parent.Date__c) || cents(parent.Amount__c) == null) return blocked('The remittance parent has invalid Account, date or positive amount evidence.');
  const currency = paymentCurrency(parent);
  if (!currency || parent._currency?.blockers?.length) return blocked('The remittance parent has no authoritative valid currency.');
  const parentIssue = supported(parent, 'Receivable_Remittance', parent, currency);
  if (parentIssue) return blocked(parentIssue);
  if (!siblings.length) return blocked('The remittance family has no allocations.');
  const seen = new Set();
  let sum = 0;
  for (const child of siblings) {
    if (!id(child.Id) || seen.has(child.Id) || child.Id === parent.Id || child.Remittance__c !== parent.Id) return blocked('The remittance family has duplicate, nested or mismatched allocation identities.');
    seen.add(child.Id);
    const issue = supported(child, 'Receivable', parent, currency);
    if (issue) return blocked(issue);
    if (!blank(child.Bank__c) && name(child.Bank__c) !== name(parent.Bank__c)) return blocked('A named allocation bank conflicts with the remittance bank.');
    sum += cents(child.Amount__c);
    if (!Number.isSafeInteger(sum)) return blocked('The remittance family amount exceeds safe cent precision.');
  }
  if (!seen.has(payment.Id)) return blocked('The payment is missing from the complete remittance family.');
  if (sum !== cents(parent.Amount__c)) return blocked('The remittance allocation total differs from the cash receipt.');
  const child = siblings.find((row) => row.Id === payment.Id);
  if (digest(sourceIdentity(child)) !== digest(sourceIdentity(payment))) return blocked('The loaded payment differs from its remittance family evidence.');
  const sorted = [...siblings].map(sourceIdentity).sort((a, b) => a.id.localeCompare(b.id));
  const evidence = {
    source: 'Receivable_Remittance', parentId: parent.Id, bank: parent.Bank__c,
    date: parent.Date__c, accountId: parent.Account__c, amount: parent.Amount__c, currency,
    parentFingerprint: digest(sourceIdentity(parent)), siblingCount: sorted.length,
    siblingsDigest: digest(sorted),
  };
  return { payment: { ...payment, Bank__c: parent.Bank__c, _bankEvidence: evidence }, reason: null };
}

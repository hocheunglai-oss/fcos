import { createHash } from 'node:crypto';
import { isBuyerCreditNote } from './_buyerFinancialAmount.js';
import { paymentCurrency } from './_xeroPaymentIdentity.js';

const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(value);
const currencyCode = (value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

function positiveCents(value) {
  if (typeof value === 'string') {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    const exact = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return exact > 0n && exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isFinite(scaled) || !Number.isSafeInteger(rounded) || rounded <= 0) return null;
  const tolerance = Math.min(1e-6, 16 * Number.EPSILON * Math.max(1, Math.abs(scaled)));
  return Math.abs(scaled - rounded) <= tolerance ? rounded : null;
}

function snapshot(row) {
  return {
    id: row?.Id ?? null,
    stemId: row?.STEM__c ?? null,
    accountId: row?.STEM__r?.Account__c ?? null,
    amount: row?.Amount__c ?? null,
    name: row?.Name ?? null,
    created: row?.CreatedDate ?? null,
    modified: row?.LastModifiedDate ?? null,
    invoiceDate: row?.Invoice_Date__c ?? null,
    dueDate: row?.Invoice_Due_Date__c ?? null,
    proforma: row?.Proforma__c ?? null,
    deprecated: row?.Deprecated__c ?? null,
    creditFlags: {
      Is_Credit_Note__c: row?.Is_Credit_Note__c ?? null,
      Credit_Note__c: row?.Credit_Note__c ?? null,
      CreditNote__c: row?.CreditNote__c ?? null,
    },
    file: row?.File__c ?? null,
    currency: row?._currency?.currency ?? null,
    currencyBlockers: Array.isArray(row?._currency?.blockers) ? [...row._currency.blockers] : ['Authoritative Salesforce invoice currency is unavailable.'],
  };
}

function rawFromSnapshot(doc) {
  return {
    Id: doc.id, STEM__c: doc.stemId, STEM__r: { Account__c: doc.accountId },
    Amount__c: doc.amount, Name: doc.name, CreatedDate: doc.created,
    LastModifiedDate: doc.modified, Invoice_Date__c: doc.invoiceDate,
    Invoice_Due_Date__c: doc.dueDate, Proforma__c: doc.proforma,
    Deprecated__c: doc.deprecated, File__c: doc.file, ...doc.creditFlags,
    _currency: { currency: doc.currency, blockers: doc.currencyBlockers },
  };
}

export function buildBuyerPaymentDocumentEvidence(stemId, documents, { complete = false } = {}) {
  const canonical = (Array.isArray(documents) ? documents : []).map(snapshot)
    .sort((left, right) => String(left.id).localeCompare(String(right.id))
      || JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const blockers = [];
  if (!validId(stemId)) blockers.push('The Receivable payment has no valid Salesforce STEM identity.');
  if (complete !== true || !Array.isArray(documents)) blockers.push('The current buyer invoice inventory is incomplete. Refresh Salesforce evidence.');
  const seen = new Set();
  for (const doc of canonical) {
    if (!validId(doc.id) || seen.has(String(doc.id).slice(0, 15)) || doc.stemId !== stemId) blockers.push('The buyer invoice inventory has invalid, duplicate or mismatched identities.');
    seen.add(String(doc.id).slice(0, 15));
    if (doc.proforma !== true && doc.proforma !== false) blockers.push('A buyer invoice has an unknown Proforma status.');
    if (doc.deprecated !== true && doc.deprecated !== false) blockers.push('A buyer invoice has an unknown Deprecated status.');
    if (Object.values(doc.creditFlags).some((flag) => flag != null && flag !== true && flag !== false)) blockers.push('A buyer invoice has an unknown credit-note flag.');
    if (!validId(doc.accountId)) blockers.push('A buyer invoice has no exact Salesforce Account identity.');
    if (!currencyCode(doc.currency) || doc.currencyBlockers.length) blockers.push('A buyer invoice has no authoritative valid currency.');
  }
  const active = canonical.filter((doc) => doc.proforma !== true && doc.deprecated !== true);
  if (active.length !== 1) blockers.push(active.length ? 'More than one current buyer invoice exists for this STEM, including any credit documents.'
    : 'No current buyer invoice exists for this STEM.');
  const selected = active.length === 1 ? active[0] : null;
  if (selected && (selected.proforma !== false || selected.deprecated !== false)) blockers.push('The current buyer invoice has unverified status flags.');
  if (active.some((doc) => isBuyerCreditNote({ Name: doc.name, ...doc.creditFlags }))) blockers.push('The current buyer document inventory includes a credit note; Finance must review the invoice identity.');
  if (selected && positiveCents(selected.amount) == null) blockers.push('The current buyer invoice amount is nonpositive, a credit, or invalid.');
  const uniqueBlockers = [...new Set(blockers)];
  const basis = { version: 1, stemId: stemId ?? null, complete: complete === true,
    documents: canonical, eligibleInvoiceId: uniqueBlockers.length ? null : selected.id, blockers: uniqueBlockers };
  return { ...basis, digest: createHash('sha256').update(JSON.stringify(basis)).digest('hex') };
}

export async function enrichBuyerPaymentDocumentEvidence(payments, {
  querySalesforce, currencyFields = '', currencyForRecord,
} = {}) {
  if (!Array.isArray(payments)) throw new TypeError('Salesforce payments must be an array.');
  const receivables = payments.filter((payment) => payment?.RecordType?.DeveloperName === 'Receivable');
  if (!receivables.length) return payments;
  if (typeof querySalesforce !== 'function' || typeof currencyForRecord !== 'function') throw new TypeError('Salesforce invoice query and currency resolver are required.');
  if (!/^(?:,\s*[A-Za-z_][A-Za-z0-9_]*)*$/.test(currencyFields)) throw new TypeError('Invalid Salesforce invoice currency fields.');
  const stems = [...new Set(receivables.map((payment) => payment.STEM__c).filter(validId))];
  const evidenceByStem = new Map();
  const fields = `Id, Name, CreatedDate, STEM__c, STEM__r.Account__c, Amount__c,
    Invoice_Date__c, Invoice_Due_Date__c, Proforma__c, Deprecated__c, File__c, LastModifiedDate${currencyFields}`;
  for (let offset = 0; offset < stems.length; offset += 200) {
    const group = stems.slice(offset, offset + 200);
    let records = [];
    let complete = false;
    try {
      const ids = group.map((stem) => `'${stem}'`).join(',');
      const result = await querySalesforce(`SELECT ${fields} FROM Invoice__c WHERE STEM__c IN (${ids}) ORDER BY Id`, { clean: true, limit: 100000 });
      const seen = new Set();
      complete = !result?.error && result?.done !== false && Array.isArray(result?.records)
        && Number.isSafeInteger(result?.totalSize) && result.totalSize === result.records.length
        && result.records.every((row) => validId(row?.Id) && !seen.has(row.Id.slice(0, 15))
          && seen.add(row.Id.slice(0, 15)) && group.includes(row.STEM__c));
      if (complete) records = result.records.map((row) => {
        let currency;
        try { currency = currencyForRecord(row); } catch { currency = { currency: null, blockers: ['Authoritative Salesforce invoice currency is unavailable.'] }; }
        return { ...row, _currency: currency };
      });
    } catch { complete = false; }
    for (const stem of group) evidenceByStem.set(stem, buildBuyerPaymentDocumentEvidence(stem,
      records.filter((row) => row.STEM__c === stem), { complete }));
  }
  return payments.map((payment) => payment?.RecordType?.DeveloperName === 'Receivable'
    ? { ...payment, _buyerDocumentEvidence: evidenceByStem.get(payment.STEM__c)
      || buildBuyerPaymentDocumentEvidence(payment.STEM__c, [], { complete: false }) }
    : payment);
}

export function buyerPaymentDocumentBlockers(payment, mapping) {
  if (payment?.RecordType?.DeveloperName !== 'Receivable') return [];
  const proof = payment._buyerDocumentEvidence;
  if (!proof || proof.version !== 1 || !Array.isArray(proof.documents)) return ['Current buyer invoice inventory evidence is unavailable. Refresh payment review.'];
  let rebuilt;
  try {
    rebuilt = buildBuyerPaymentDocumentEvidence(proof.stemId, proof.documents.map(rawFromSnapshot), { complete: proof.complete });
  } catch { return ['Current buyer invoice inventory evidence is invalid. Refresh payment review.']; }
  if (JSON.stringify(rebuilt) !== JSON.stringify(proof) || proof.stemId !== payment.STEM__c || proof.complete !== true) {
    return ['Current buyer invoice inventory evidence is incomplete or changed. Refresh payment review.'];
  }
  if (proof.blockers.length) return proof.blockers;
  const chosen = proof.documents.find((doc) => doc.id === proof.eligibleInvoiceId);
  if (!chosen) return ['The current buyer invoice identity is unavailable. Refresh payment review.'];
  if (!mapping) return ['The Salesforce document is not durably linked to Xero. Run the document check again.'];
  const blockers = [];
  if (!validId(payment.Account__c) || chosen.accountId !== payment.Account__c) blockers.push('The current buyer invoice Account differs from the Salesforce payment Account.');
  if (!paymentCurrency(payment) || chosen.currency !== paymentCurrency(payment)) blockers.push('The current buyer invoice currency differs from the Salesforce payment currency.');
  if (!mapping || mapping.salesforce_object !== 'Invoice__c' || mapping.salesforce_id !== chosen.id) blockers.push('The current buyer invoice is not the exact Salesforce Invoice in the Xero document mapping.');
  if (mapping?.retained_differences?.accountId !== payment.Account__c) blockers.push('The Xero document mapping has no verified matching Salesforce Account.');
  if (mapping?.retained_differences?.stemId !== payment.STEM__c) blockers.push('The Xero document mapping has no verified matching Salesforce STEM.');
  return blockers;
}

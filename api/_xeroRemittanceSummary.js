import { createHash } from 'node:crypto';
import { paymentCurrency } from './_xeroPaymentIdentity.js';
import { issuedSupplierSfId } from './_xeroIssuedSupplierPreservation.js';

export const REMITTANCE_SUMMARY_POLICY = 'remittance_summary_v1';
const TYPES = new Set(['Payable_Remittance', 'Receivable_Remittance']);
const MAX_ROWS = 100000;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_key, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const id = issuedSupplierSfId;
const bank = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

// Scale-two source values may carry tiny JSON binary tails. Material fractions
// are rejected; this is the same bounded tolerance as remittance bank evidence.
function cents(value) {
  if (typeof value === 'string') {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    const exact = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return exact > 0n && exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100; const rounded = Math.round(scaled);
  const tolerance = Math.min(1e-6, 16 * Number.EPSILON * Math.max(1, Math.abs(scaled)));
  return Number.isSafeInteger(rounded) && rounded > 0 && Math.abs(scaled - rounded) <= tolerance ? rounded : null;
}

// Bind current raw facts, including the parent link omitted by legacy payment
// fingerprints. Canonical IDs recognize valid 15/18 forms without case folding.
function identity(row) {
  return {
    Id: id(row?.Id), Name: row?.Name ?? null, CreatedDate: row?.CreatedDate ?? null,
    RecordType: { DeveloperName: row?.RecordType?.DeveloperName ?? null },
    Account__c: id(row?.Account__c), Amount__c: row?.Amount__c ?? null,
    Date__c: row?.Date__c ?? null, Bank__c: row?.Bank__c ?? null, Reference__c: row?.Reference__c ?? null,
    Remittance__c: row?.Remittance__c == null ? null : id(row.Remittance__c),
    STEM__c: row?.STEM__c == null ? null : id(row.STEM__c),
    Supplier_Invoice__c: row?.Supplier_Invoice__c == null ? null : id(row.Supplier_Invoice__c),
    Commission_Invoice__c: row?.Commission_Invoice__c ?? null,
    Is_Deposit__c: row?.Is_Deposit__c ?? null, Is_Volume_Discount__c: row?.Is_Volume_Discount__c ?? null,
    CurrencyIsoCode: row?.CurrencyIsoCode ?? null,
    _currency: { currency: paymentCurrency(row), blockers: [...(row?._currency?.blockers ?? [])] },
    LastModifiedDate: row?.LastModifiedDate ?? null, IsDeleted: row?.IsDeleted ?? null,
  };
}

function rowIssue(row) {
  if (!plain(row) || !id(row.Id) || !id(row.Account__c)?.startsWith('001')) return 'A remittance family has an invalid Salesforce payment or Account identity.';
  if (!date(row.Date__c) || cents(row.Amount__c) === null) return 'A remittance family has an invalid date or positive cent amount.';
  if (row.Is_Deposit__c !== false || row.Is_Volume_Discount__c !== false || row.Commission_Invoice__c !== null || row.IsDeleted === true) return 'A remittance family includes a deposit, discount, commission, deleted row or unknown flag.';
  if (row._currency?.blockers !== undefined && !Array.isArray(row._currency.blockers)) return 'A remittance family has invalid currency evidence.';
  if (!paymentCurrency(row) || row._currency?.blockers?.length
    || (row.CurrencyIsoCode != null && row._currency?.currency != null && row.CurrencyIsoCode !== row._currency.currency)) return 'A remittance family has missing, conflicting or blocked currency evidence.';
  if ((row.STEM__c != null && !id(row.STEM__c)) || (row.Supplier_Invoice__c != null && !id(row.Supplier_Invoice__c))) return 'A remittance family has an invalid allocation identity.';
  return null;
}

/** Informational evidence only: never a payment payload or child reconciliation. */
export function evaluateRemittanceSummary(parent, { siblings, visiblePayments, complete = false, headerUnmapped = false } = {}) {
  const blocked = blocker => ({ eligible: false, evidence: null, blocker });
  try {
    if (complete !== true || !Array.isArray(siblings) || !Array.isArray(visiblePayments)
      || !siblings.length || siblings.length > MAX_ROWS || visiblePayments.length > MAX_ROWS) return blocked('Complete all-years remittance parent and allocation evidence is required.');
    if (headerUnmapped !== true) return blocked('The remittance header must have no existing payment mapping or posting claim.');
    const parentIssue = rowIssue(parent);
    if (parentIssue) return blocked(parentIssue);
    if (!TYPES.has(parent.RecordType?.DeveloperName) || parent.Remittance__c !== null || parent.Supplier_Invoice__c !== null || !bank(parent.Bank__c)) return blocked('The parent must be an independent named-bank remittance header without an invoice allocation.');
    const visible = new Map();
    for (const row of visiblePayments) {
      const key = id(row?.Id);
      if (!key || visible.has(key)) return blocked('The visible payment scope has invalid or duplicate canonical Salesforce identities.');
      visible.set(key, row);
    }
    const parentId = id(parent.Id); const currentParent = visible.get(parentId);
    if (!currentParent || rowIssue(currentParent) || currentParent.Remittance__c !== null || currentParent.Supplier_Invoice__c !== null
      || hash(identity(currentParent)) !== hash(identity(parent))) return blocked('The complete current remittance parent differs from the visible payment scope.');
    const expectedType = parent.RecordType.DeveloperName === 'Payable_Remittance' ? 'Payable' : 'Receivable';
    const children = new Map(); let total = 0;
    for (const child of siblings) {
      const childIssue = rowIssue(child);
      if (childIssue) return blocked(childIssue);
      const key = id(child.Id);
      if (key === parentId || children.has(key) || id(child.Remittance__c) !== parentId) return blocked('The remittance inventory contains duplicate, nested or different parent allocation identities.');
      if (child.RecordType?.DeveloperName !== expectedType) return blocked('The remittance inventory contains a different or unsupported allocation type.');
      if (id(child.Account__c) !== id(parent.Account__c) || child.Date__c !== parent.Date__c || paymentCurrency(child) !== paymentCurrency(parent)) return blocked('The remittance allocations must have the same Account, date and currency as the header.');
      if (expectedType === 'Payable' ? !id(child.Supplier_Invoice__c) : !id(child.STEM__c) || child.Supplier_Invoice__c !== null) return blocked('Each remittance allocation must identify its exact supplier invoice or receivable STEM.');
      if (child.Bank__c != null && typeof child.Bank__c !== 'string') return blocked('An allocation bank has invalid raw evidence.');
      if (bank(child.Bank__c) && bank(child.Bank__c) !== bank(parent.Bank__c)) return blocked('A named allocation bank conflicts with the remittance header bank.');
      const visibleChild = visible.get(key);
      if (!visibleChild || rowIssue(visibleChild) || (expectedType === 'Receivable' && visibleChild.Supplier_Invoice__c !== null)
        || hash(identity(visibleChild)) !== hash(identity(child))) return blocked('A complete remittance allocation is outside or differs from the visible payment scope.');
      children.set(key, child); total += cents(child.Amount__c);
      if (!Number.isSafeInteger(total)) return blocked('The remittance total exceeds safe cent precision.');
    }
    for (const row of visiblePayments) {
      if (id(row.Remittance__c) === parentId && !children.has(id(row.Id))) return blocked('A visible remittance allocation is absent from the complete current inventory.');
    }
    if (total !== cents(parent.Amount__c)) return blocked('The exact allocation cent total differs from the remittance header.');
    const allocations = [...children.values()].map(identity).sort((left, right) => left.Id.localeCompare(right.Id));
    const source = { parent: identity(parent), allocations };
    const evidence = {
      policyVersion: REMITTANCE_SUMMARY_POLICY, parentId, allocationIds: allocations.map(row => row.Id),
      allocationCount: allocations.length, currency: paymentCurrency(parent), totalCents: String(total),
      parentFingerprint: hash(source.parent), allocationsFingerprint: hash(allocations),
      visibleScopeFingerprint: hash(source), source,
    };
    return { eligible: true, evidence: freeze({ ...evidence, fingerprint: hash(evidence) }), blocker: null };
  } catch { return blocked('The remittance evidence is malformed or incomplete.'); }
}

const EVIDENCE_KEYS = ['policyVersion', 'parentId', 'allocationIds', 'allocationCount', 'currency', 'totalCents', 'parentFingerprint', 'allocationsFingerprint', 'visibleScopeFingerprint', 'source', 'fingerprint'];

// This validates replay of server-collected structural evidence. The caller must
// still exclude current durable mappings/claims; it confers no posting authority.
export function currentRemittanceSummary(payment) {
  try {
    const proof = payment?._remittanceSummary;
    if (!exactKeys(proof, EVIDENCE_KEYS) || proof.policyVersion !== REMITTANCE_SUMMARY_POLICY || payment?._remittanceSummaryBlocker
      || rowIssue(payment) || payment.Remittance__c !== null || payment.Supplier_Invoice__c !== null
      || !exactKeys(proof.source, ['parent', 'allocations']) || !Array.isArray(proof.source.allocations)
      || proof.source.allocations.length > MAX_ROWS || hash(identity(payment)) !== proof.parentFingerprint) return null;
    const result = evaluateRemittanceSummary(proof.source.parent, {
      siblings: proof.source.allocations, visiblePayments: [proof.source.parent, ...proof.source.allocations],
      complete: true, headerUnmapped: true,
    });
    return result.eligible && canonical(result.evidence) === canonical(proof) ? result.evidence : null;
  } catch { return null; }
}

function completeQuery(result, matches) {
  // sfQuery consumes every page and returns {records,totalSize}; explicit
  // incomplete pagination markers still fail closed when an adapter emits them.
  return plain(result) && !result.error && result.done !== false && !result.nextRecordsUrl
    && Number.isSafeInteger(result.totalSize) && result.totalSize >= 0 && result.totalSize <= MAX_ROWS
    && Array.isArray(result.records) && result.totalSize === result.records.length
    && result.records.every(matches);
}

/** Structural enrichment before bank fallback; query adapter owns pagination. */
export async function enrichRemittanceSummaries(payments, { querySalesforce, fields, withCurrency, inventory } = {}) {
  if (!Array.isArray(payments)) throw new TypeError('A raw visible payment array is required.');
  const headers = payments.filter(row => TYPES.has(row?.RecordType?.DeveloperName));
  if (!headers.length) return [...payments];
  const fail = message => payments.map(row => {
    if (!TYPES.has(row?.RecordType?.DeveloperName)) return row;
    const { _remittanceSummary: _old, _remittanceSummaryBlocker: _blocker, ...raw } = row;
    return { ...raw, _remittanceSummaryBlocker: message };
  });
  const keys = headers.map(row => id(row.Id));
  if (typeof querySalesforce !== 'function' || typeof withCurrency !== 'function' || typeof fields !== 'string' || !fields.trim()
    || payments.length > MAX_ROWS || keys.some(key => !key) || new Set(keys).size !== keys.length) return fail('Complete canonical remittance source queries are unavailable.');
  const parents = new Map(); const families = new Map(); const allChildIds = new Set();
  try {
    if (inventory !== undefined) {
      if (!inventory?.complete || !Array.isArray(inventory.parents) || !Array.isArray(inventory.siblings)) throw new Error('incomplete');
      for (const parent of inventory.parents) {
        const key = id(parent?.Id);
        if (!key || parents.has(key)) throw new Error('duplicate parent');
        parents.set(key, parent);
      }
      for (const child of inventory.siblings) {
        const key = id(child?.Id); const parentId = id(child?.Remittance__c);
        if (!key || !parents.has(parentId) || allChildIds.has(key) || parents.has(key)) throw new Error('duplicate child');
        allChildIds.add(key); families.set(parentId, [...(families.get(parentId) || []), child]);
      }
      if (keys.some(key => !parents.has(key))) throw new Error('missing parent');
    } else {
    for (let start = 0; start < headers.length; start += 50) {
      const batch = headers.slice(start, start + 50); const batchIds = new Set(batch.map(row => id(row.Id)));
      const scope = batch.map(row => `'${row.Id}'`).join(',');
      const [parentResult, childResult] = await Promise.all([
        querySalesforce(`SELECT ${fields} FROM Payment__c WHERE Id IN (${scope}) ORDER BY Id`, { clean: true, limit: MAX_ROWS }),
        querySalesforce(`SELECT ${fields} FROM Payment__c WHERE Remittance__c IN (${scope}) ORDER BY Remittance__c, Id`, { clean: true, limit: MAX_ROWS }),
      ]);
      if (!completeQuery(parentResult, row => batchIds.has(id(row?.Id)))
        || !completeQuery(childResult, row => batchIds.has(id(row?.Remittance__c))) || parentResult.records.length !== batch.length) throw new Error('incomplete');
      for (const raw of parentResult.records) {
        const row = withCurrency(raw); const key = id(row?.Id);
        if (!batchIds.has(key) || parents.has(key)) throw new Error('duplicate parent');
        parents.set(key, row);
      }
      for (const raw of childResult.records) {
        const row = withCurrency(raw); const key = id(row?.Id); const parentId = id(row?.Remittance__c);
        if (!key || !batchIds.has(parentId) || allChildIds.has(key) || parents.has(key)) throw new Error('duplicate child');
        allChildIds.add(key); families.set(parentId, [...(families.get(parentId) || []), row]);
      }
    }
    if (parents.size !== headers.length || [...parents.keys()].some(key => allChildIds.has(key))) throw new Error('nested parent');
    }
  } catch { return fail('The complete all-years remittance parent and allocation retrieval failed or was incomplete.'); }
  return payments.map(row => {
    if (!TYPES.has(row?.RecordType?.DeveloperName)) return row;
    const { _remittanceSummary: _old, _remittanceSummaryBlocker: _blocker, ...raw } = row;
    const evaluated = evaluateRemittanceSummary(parents.get(id(row.Id)), {
      siblings: families.get(id(row.Id)) || [], visiblePayments: payments, complete: true, headerUnmapped: true,
    });
    return { ...raw, ...(evaluated.eligible ? { _remittanceSummary: evaluated.evidence } : { _remittanceSummaryBlocker: evaluated.blocker }) };
  });
}

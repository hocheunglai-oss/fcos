import { isBuyerCreditNote } from './_buyerFinancialAmount.js';
import { issuedSupplierCanonical as canonical, issuedSupplierHash as hash, issuedSupplierSfId as sfId } from './_xeroIssuedSupplierPreservation.js';

export const GROUP_REMITTANCE_BANK_POLICY = 'receivable_group_bank_v1';
export const GROUP_REMITTANCE_BANK_MAX_BYTES = 65536;
const MAX_ROWS = 100000;
const CREDIT_FIELDS = ['Is_Credit_Note__c', 'Credit_Note__c', 'CreditNote__c'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const ordered = rows => rows.sort((a, b) => a.Id < b.Id ? -1 : a.Id > b.Id ? 1 : 0);
const digest = (component, value) => hash({ policyVersion: GROUP_REMITTANCE_BANK_POLICY, component, value });
const text = (value, max = 1000) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const optionalText = value => value === null || text(value);
const words = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
const id = (value, prefix) => { const result = sfId(value); return result?.startsWith(prefix) ? result : null; };
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const requireFact = (condition, message) => { if (!condition) throw new Error(message); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const blocked = blocker => ({ eligible: false, derivedBank: null, evidence: null, blocker });

// Deliberately identical scale-two numeric tolerance to the existing bank proof.
// Raw numbers remain in the receipt, so a tolerated serialization tail is bound.
function cents(value) {
  if (typeof value === 'string') {
    if (value.length > 30 || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    const exact = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return exact > 0n && exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100; const rounded = Math.round(scaled);
  const tolerance = Math.min(1e-6, 16 * Number.EPSILON * Math.max(1, Math.abs(scaled)));
  return Number.isSafeInteger(rounded) && rounded > 0 && Math.abs(scaled - rounded) <= tolerance ? rounded : null;
}

function currency(row) {
  requireFact(plain(row._currency) && row._currency.currency === 'USD'
    && Array.isArray(row._currency.blockers) && row._currency.blockers.length === 0
    && (row.CurrencyIsoCode == null || row.CurrencyIsoCode === 'USD'), 'Authoritative, unblocked USD source currency is required.');
  return { CurrencyIsoCode: row.CurrencyIsoCode ?? null, _currency: { currency: 'USD', blockers: [] } };
}

function paymentFacts(row) {
  requireFact(plain(row) && id(row.Id, 'a0S') && id(row.Account__c, '001'), 'A current payment or Account identity is invalid.');
  requireFact(row.IsDeleted === false && row.Is_Deposit__c === false && row.Is_Volume_Discount__c === false
    && row.Commission_Invoice__c === null && row.Supplier_Invoice__c === null, 'Every family row must be explicitly live, ordinary cash without deposits, discounts, commissions or supplier allocations.');
  requireFact(date(row.Date__c) && cents(row.Amount__c) !== null, 'Every family row requires a real date and positive scale-two amount.');
  requireFact(text(row.Name) && row.Name.trim() && optionalText(row.Bank__c) && optionalText(row.Reference__c)
    && optionalText(row.CreatedDate ?? null) && optionalText(row.LastModifiedDate ?? null), 'Payment name, bank, reference or timestamp facts are malformed.');
  requireFact(row.Remittance__c === null || id(row.Remittance__c, 'a0S'), 'The raw remittance parent identity is missing or malformed.');
  requireFact(row.STEM__c === null || id(row.STEM__c, 'a0H'), 'The raw STEM identity is missing or malformed.');
  requireFact(plain(row.RecordType) && ['Receivable', 'Receivable_Remittance'].includes(row.RecordType.DeveloperName), 'The family contains an unsupported payment type.');
  return {
    Id: id(row.Id, 'a0S'), IsDeleted: false, Name: row.Name, CreatedDate: row.CreatedDate ?? null,
    RecordType: { DeveloperName: row.RecordType.DeveloperName }, STEM__c: row.STEM__c === null ? null : id(row.STEM__c, 'a0H'),
    Account__c: id(row.Account__c, '001'), Amount__c: row.Amount__c, Date__c: row.Date__c,
    Supplier_Invoice__c: null, Reference__c: row.Reference__c, Bank__c: row.Bank__c,
    Remittance__c: row.Remittance__c === null ? null : id(row.Remittance__c, 'a0S'),
    Is_Deposit__c: false, Commission_Invoice__c: null, Is_Volume_Discount__c: false,
    LastModifiedDate: row.LastModifiedDate ?? null, ...currency(row),
  };
}

function accountFacts(row) {
  requireFact(plain(row) && id(row.Id, '001') && row.IsDeleted === false && row.Inactive_Suspended__c === false,
    'Every Group and debtor Account must be current, explicitly active and nondeleted.');
  requireFact(text(row.Name) && row.Name.trim() && optionalText(row.Company_Code__c)
    && optionalText(row.LastModifiedDate ?? null) && plain(row.RecordType)
    && ['Group', 'Buyer', 'Buyer_Supplier'].includes(row.RecordType.DeveloperName), 'The Group or debtor Account facts are incomplete or unsupported.');
  requireFact(row.ParentId === null || id(row.ParentId, '001'), 'A direct Account parent identity is missing or malformed.');
  return { Id: id(row.Id, '001'), IsDeleted: false, Name: row.Name, RecordType: { DeveloperName: row.RecordType.DeveloperName },
    ParentId: row.ParentId === null ? null : id(row.ParentId, '001'), Company_Code__c: row.Company_Code__c,
    Inactive_Suspended__c: false, LastModifiedDate: row.LastModifiedDate ?? null };
}

function invoiceFacts(row, creditFields) {
  requireFact(plain(row) && id(row.Id, 'a0K') && id(row.STEM__c, 'a0H') && id(row.STEM__r?.Account__c, '001')
    && row.IsDeleted === false, 'The complete invoice inventory contains an invalid, unknown or deleted source identity.');
  requireFact(text(row.Name) && row.Name.trim() && typeof row.Proforma__c === 'boolean' && typeof row.Deprecated__c === 'boolean',
    'Every invoice needs its literal name and known proforma/deprecated status.');
  requireFact(creditFields.every(field => Object.hasOwn(row, field))
    && CREDIT_FIELDS.every(field => !Object.hasOwn(row, field) || row[field] === null || typeof row[field] === 'boolean'),
  'The complete invoice inventory has missing or unknown credit flags.');
  requireFact(!isBuyerCreditNote(row), 'A retained invoice or credit-note claim requires Finance review of the whole family.');
  requireFact(cents(row.Amount__c) !== null, 'The invoice inventory contains a nonpositive or invalid amount.');
  requireFact(['CreatedDate', 'LastModifiedDate', 'Invoice_Date__c', 'Invoice_Due_Date__c'].every(key => optionalText(row[key] ?? null)),
    'Invoice dates or timestamps are malformed.');
  const flags = Object.fromEntries(CREDIT_FIELDS.filter(field => Object.hasOwn(row, field)).sort().map(field => [field, row[field]]));
  return { Id: id(row.Id, 'a0K'), IsDeleted: false, Name: row.Name, STEM__c: id(row.STEM__c, 'a0H'),
    STEM__r: { Account__c: id(row.STEM__r.Account__c, '001') }, Amount__c: row.Amount__c,
    Proforma__c: row.Proforma__c, Deprecated__c: row.Deprecated__c, ...flags,
    CreatedDate: row.CreatedDate ?? null, LastModifiedDate: row.LastModifiedDate ?? null,
    Invoice_Date__c: row.Invoice_Date__c ?? null, Invoice_Due_Date__c: row.Invoice_Due_Date__c ?? null, ...currency(row) };
}

/** Source authority only. Current mappings, claims, bank approval and posting remain caller controls. */
export function resolveGroupRemittanceBankEvidence(payment, options = {}) {
  try {
    requireFact(exactKeys(options, ['parent', 'siblings', 'visiblePayments', 'accounts', 'buyerDocumentInventories', 'complete']),
      'Only complete source facts belong to Group bank evidence; database controls remain separate.');
    const { parent, siblings, visiblePayments, accounts, buyerDocumentInventories, complete } = options;
    requireFact(complete === true && [siblings, visiblePayments, accounts, buyerDocumentInventories].every(rows => Array.isArray(rows) && rows.length > 0 && rows.length <= MAX_ROWS),
      'Complete current family, visible payment, Account and invoice inventories are required.');
    const selected = paymentFacts(payment); const header = paymentFacts(parent);
    requireFact(selected.RecordType.DeveloperName === 'Receivable' && !words(selected.Bank__c)
      && header.RecordType.DeveloperName === 'Receivable_Remittance' && header.Remittance__c === null && words(header.Bank__c)
      && selected.Remittance__c === header.Id, 'An exact independent named-bank remittance parent and blank-bank Receivable are required.');
    const allocations = ordered(siblings.map(paymentFacts));
    const allocationIds = allocations.map(row => row.Id);
    requireFact(new Set(allocationIds).size === allocations.length && !allocationIds.includes(header.Id), 'The complete family contains duplicate or nested identities.');
    let total = 0;
    for (const row of allocations) {
      requireFact(row.RecordType.DeveloperName === 'Receivable' && row.Remittance__c === header.Id && row.STEM__c
        && row.Date__c === header.Date__c, 'Every allocation must retain its exact parent, Receivable STEM and matching payment date.');
      requireFact(!words(row.Bank__c) || words(row.Bank__c) === words(header.Bank__c), 'An allocation names a conflicting bank.');
      total += cents(row.Amount__c);
      requireFact(Number.isSafeInteger(total), 'The exact family sum exceeds safe cent bounds.');
    }
    requireFact(total === cents(header.Amount__c), 'The exact family cent sum differs from the header amount.');
    const chosen = allocations.find(row => row.Id === selected.Id);
    requireFact(chosen && canonical(chosen) === canonical(selected), 'The selected raw payment differs from its complete family.');

    const visible = new Map();
    for (const row of visiblePayments) {
      const key = id(row?.Id, 'a0S');
      requireFact(key && !visible.has(key), 'Visible payment identities are invalid or duplicated.');
      visible.set(key, row);
      if (id(row.Remittance__c, 'a0S') === header.Id) requireFact(allocationIds.includes(key), 'A visible allocation is absent from the complete family.');
    }
    requireFact(visible.has(selected.Id), 'The selected payment is absent from the current visible scope.');
    // The source collector owns complete all-years parent/child coverage. The
    // dashboard window is only a second observation: compare every overlap,
    // without inventing visible rows for fully captured historical members.
    for (const row of [header, ...allocations]) {
      if (visible.has(row.Id)) requireFact(canonical(paymentFacts(visible.get(row.Id))) === canonical(row),
        'A visible family row differs from the complete current source capture.');
    }

    const accountRows = ordered(accounts.map(accountFacts));
    const byAccount = new Map(accountRows.map(row => [row.Id, row]));
    const neededAccounts = new Set([header.Account__c, ...allocations.map(row => row.Account__c)]);
    requireFact(byAccount.size === accountRows.length && byAccount.size === neededAccounts.size
      && [...neededAccounts].every(key => byAccount.has(key)), 'The current Account scope is incomplete, duplicated or contains unrelated identities.');
    const group = byAccount.get(header.Account__c);
    requireFact(group.RecordType.DeveloperName === 'Group', 'The header Account is not a verified current Group.');
    for (const row of allocations) {
      const debtor = byAccount.get(row.Account__c);
      requireFact(['Buyer', 'Buyer_Supplier'].includes(debtor.RecordType.DeveloperName) && debtor.ParentId === group.Id,
        'Every debtor must be a current direct member of the exact Group; names or ancestry cannot substitute.');
    }

    const stems = new Set(allocations.map(row => row.STEM__c)); const inventories = [];
    const seenStems = new Set(); const seenInvoices = new Set(); const selectedInvoices = new Set();
    for (const inventory of buyerDocumentInventories) {
      requireFact(plain(inventory) && inventory.complete === true && id(inventory.stemId, 'a0H')
        && Array.isArray(inventory.records) && inventory.records.length > 0 && inventory.records.length <= MAX_ROWS
        && Array.isArray(inventory.creditFields) && inventory.creditFields.every(field => CREDIT_FIELDS.includes(field))
        && new Set(inventory.creditFields).size === inventory.creditFields.length, 'The current invoice inventory or credit-field coverage is incomplete.');
      const stemId = id(inventory.stemId, 'a0H');
      requireFact(stems.has(stemId) && !seenStems.has(stemId), 'Invoice inventories have duplicated or unrelated STEM identities.');
      seenStems.add(stemId);
      const records = ordered(inventory.records.map(row => invoiceFacts(row, inventory.creditFields)));
      const allocated = allocations.filter(row => row.STEM__c === stemId);
      for (const record of records) {
        requireFact(record.STEM__c === stemId && !seenInvoices.has(record.Id)
          && allocated.every(row => row.Account__c === record.STEM__r.Account__c), 'A source invoice has a duplicate identity or different STEM/debtor owner.');
        seenInvoices.add(record.Id);
      }
      const active = records.filter(row => !row.Proforma__c && !row.Deprecated__c);
      requireFact(active.length === 1, 'Each allocation requires exactly one current ordinary source invoice.');
      for (let index = 0; index < allocated.length; index += 1) {
        requireFact(!selectedInvoices.has(active[0].Id), 'Multiple allocations select the same source invoice; the complete family requires review.');
        selectedInvoices.add(active[0].Id);
      }
      inventories.push({ stemId, complete: true, creditFields: [...inventory.creditFields].sort(), records });
    }
    requireFact(seenStems.size === stems.size, 'The complete family has a missing current source-invoice inventory.');
    inventories.sort((a, b) => a.stemId < b.stemId ? -1 : a.stemId > b.stemId ? 1 : 0);
    const source = { parent: header, allocations, accounts: accountRows, buyerDocumentInventories: inventories };
    const basis = { policyVersion: GROUP_REMITTANCE_BANK_POLICY, sourceKind: 'Receivable_Remittance', authority: 'salesforce_recorded_bank',
      parentId: header.Id, groupAccountId: group.Id, debtorAccountId: selected.Account__c, selectedPaymentId: selected.Id,
      bank: header.Bank__c, date: header.Date__c, currency: 'USD', totalCents: String(total), allocationIds, allocationCount: allocations.length,
      familyFingerprint: digest('family', { parent: header, allocations }), membershipFingerprint: digest('membership', accountRows),
      invoiceOwnershipFingerprint: digest('invoice_ownership', inventories), source };
    const evidence = { ...basis, fingerprint: digest('evidence', basis) };
    requireFact(Buffer.byteLength(canonical(evidence), 'utf8') <= GROUP_REMITTANCE_BANK_MAX_BYTES, 'Group bank-source evidence exceeds its bounded UTF-8 size.');
    return { eligible: true, derivedBank: header.Bank__c, evidence: freeze(evidence), blocker: null };
  } catch (error) { return blocked(error instanceof Error ? error.message : 'Group bank-source evidence is malformed.'); }
}

const EVIDENCE_KEYS = ['policyVersion', 'sourceKind', 'authority', 'parentId', 'groupAccountId', 'debtorAccountId', 'selectedPaymentId',
  'bank', 'date', 'currency', 'totalCents', 'allocationIds', 'allocationCount', 'familyFingerprint', 'membershipFingerprint',
  'invoiceOwnershipFingerprint', 'source', 'fingerprint'];

/** Recompute embedded facts; caller must also compare to freshly collected source and live DB controls. */
export function validateGroupRemittanceBankEvidence(payment, evidence) {
  try {
    requireFact(exactKeys(evidence, EVIDENCE_KEYS) && evidence.policyVersion === GROUP_REMITTANCE_BANK_POLICY
      && evidence.sourceKind === 'Receivable_Remittance' && evidence.authority === 'salesforce_recorded_bank'
      && exactKeys(evidence.source, ['parent', 'allocations', 'accounts', 'buyerDocumentInventories'])
      && Buffer.byteLength(canonical(evidence), 'utf8') <= GROUP_REMITTANCE_BANK_MAX_BYTES,
    'Group bank-source proof is absent, malformed or has an unknown authority or version.');
    const source = evidence.source;
    requireFact(Array.isArray(source.allocations), 'The stored family allocations are malformed.');
    const rebuilt = resolveGroupRemittanceBankEvidence(payment, { parent: source.parent, siblings: source.allocations,
      visiblePayments: [payment], accounts: source.accounts,
      buyerDocumentInventories: source.buyerDocumentInventories, complete: true });
    requireFact(rebuilt.eligible && canonical(rebuilt.evidence) === canonical(evidence), 'Group bank-source proof facts, selected payment or fingerprints changed.');
    return rebuilt;
  } catch (error) { return blocked(error instanceof Error ? error.message : 'Group bank-source proof is malformed.'); }
}

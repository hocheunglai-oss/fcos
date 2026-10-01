import { issuedSupplierSfId as sfId } from './_xeroIssuedSupplierPreservation.js';
import { resolveGroupRemittanceBankEvidence } from './_xeroGroupRemittanceBankEvidence.js';

const MAX_ROWS = 100000;
const blank = value => value == null || (typeof value === 'string' && !value.trim());
const headers = new Set(['Receivable_Remittance', 'Payable_Remittance']);
const unique = values => [...new Set(values.filter(Boolean))];
const scopedId = (value, prefix) => { const id = sfId(value); return id?.startsWith(prefix) ? id : null; };
const inList = ids => ids.map(id => `'${id}'`).join(',');
const completeResult = (result, matches) => result && !result.error && result.done !== false && !result.nextRecordsUrl
  && Array.isArray(result.records) && Number.isSafeInteger(result.totalSize)
  && result.totalSize === result.records.length && result.totalSize <= MAX_ROWS && result.records.every(matches);

// One deleted-inclusive family inventory serves both informational headers and
// bank-source checks. It never removes a problematic sibling from the evidence.
export async function loadRemittanceInventory(payments, { queryAll, fields, withCurrency } = {}) {
  const parentIds = unique(payments.flatMap(row => headers.has(row.RecordType?.DeveloperName) ? [sfId(row.Id)]
    : row.RecordType?.DeveloperName === 'Receivable' && blank(row.Bank__c) && Number(row.Amount__c) > 0 ? [sfId(row.Remittance__c)] : []));
  const result = { complete: true, parentIds, parents: [], siblings: [] };
  if (!parentIds.length) return result;
  if (typeof queryAll !== 'function' || typeof withCurrency !== 'function' || typeof fields !== 'string'
    || !fields.trim() || payments.length > MAX_ROWS) return { ...result, complete: false };
  const seenParents = new Set(); const seenChildren = new Set();
  try {
    for (let start = 0; start < parentIds.length; start += 50) {
      const ids = parentIds.slice(start, start + 50); const scope = new Set(ids);
      const [parents, children] = await Promise.all([
        queryAll(`SELECT ${fields} FROM Payment__c WHERE Id IN (${inList(ids)}) ORDER BY Id`, { clean: true, limit: MAX_ROWS }),
        queryAll(`SELECT ${fields} FROM Payment__c WHERE Remittance__c IN (${inList(ids)}) ORDER BY Remittance__c, Id`, { clean: true, limit: MAX_ROWS }),
      ]);
      if (!completeResult(parents, row => scope.has(sfId(row?.Id))) || parents.records.length !== ids.length
        || !completeResult(children, row => scope.has(sfId(row?.Remittance__c)))) throw new Error('incomplete');
      for (const raw of parents.records) {
        const id = sfId(raw.Id);
        if (seenParents.has(id)) throw new Error('duplicate parent');
        seenParents.add(id); result.parents.push(withCurrency(raw));
      }
      for (const raw of children.records) {
        const id = sfId(raw.Id);
        if (!id || seenChildren.has(id)) throw new Error('duplicate child');
        seenChildren.add(id); result.siblings.push(withCurrency(raw));
      }
    }
    if (seenParents.size !== parentIds.length || [...seenChildren].some(id => seenParents.has(id))) throw new Error('nested family');
    return result;
  } catch { return { complete: false, parentIds, parents: [], siblings: [] }; }
}

// Source-only proof collection. Current local mapping/claim/bank controls are
// checked by the classifier and again at the durable persistence boundary.
export async function enrichGroupRemittanceBankSources(payments, {
  inventory, queryAll, invoiceCurrencyFields = '', creditFields = [], currencyForInvoice,
} = {}) {
  if (!inventory?.complete || !inventory.parents.length) return payments;
  const candidates = payments.filter(row => row.RecordType?.DeveloperName === 'Receivable'
    && blank(row.Bank__c) && Number(row.Amount__c) > 0 && scopedId(row.Remittance__c, 'a0S'));
  const parents = new Map(inventory.parents.map(row => [sfId(row.Id), row]));
  const families = new Map();
  for (const row of inventory.siblings) {
    const key = sfId(row.Remittance__c); families.set(key, [...(families.get(key) || []), row]);
  }
  const possible = unique(candidates.filter(row => {
    const parent = parents.get(sfId(row.Remittance__c));
    return parent?.RecordType?.DeveloperName === 'Receivable_Remittance'
      && scopedId(parent.Account__c, '001') && sfId(parent.Account__c) !== sfId(row.Account__c);
  }).map(row => sfId(row.Remittance__c)));
  if (!possible.length) return payments;
  const possibleSet = new Set(possible);
  const held = reason => payments.map(row => possibleSet.has(sfId(row.Remittance__c)) && blank(row.Bank__c)
    ? { ...row, _groupBankEvidenceBlocker: reason } : row);
  if (typeof queryAll !== 'function' || typeof currencyForInvoice !== 'function'
    || !/^(?:,\s*[A-Za-z_][A-Za-z0-9_]*)*$/.test(invoiceCurrencyFields)) return held('Current Group remittance source queries are unavailable.');
  try {
    const accountIds = unique(possible.flatMap(id => [parents.get(id), ...(families.get(id) || [])])
      .map(row => scopedId(row.Account__c, '001')));
    const accounts = new Map();
    for (let start = 0; start < accountIds.length; start += 200) {
      const ids = accountIds.slice(start, start + 200); const scope = new Set(ids);
      const result = await queryAll(`SELECT Id, IsDeleted, Name, RecordType.DeveloperName, ParentId, Company_Code__c, Inactive_Suspended__c, LastModifiedDate FROM Account WHERE Id IN (${inList(ids)}) ORDER BY Id`, { clean: true, limit: MAX_ROWS });
      if (!completeResult(result, row => scope.has(sfId(row?.Id))) || result.records.length !== ids.length) throw new Error('Account inventory');
      for (const row of result.records) {
        const id = sfId(row.Id); if (accounts.has(id)) throw new Error('duplicate Account'); accounts.set(id, row);
      }
    }
    const groupIds = possible.filter(id => accounts.get(sfId(parents.get(id).Account__c))?.RecordType?.DeveloperName === 'Group');
    const stemIds = unique(groupIds.flatMap(id => families.get(id) || []).map(row => scopedId(row.STEM__c, 'a0H')));
    const invoices = new Map(stemIds.map(id => [id, []])); const seenInvoices = new Set();
    for (let start = 0; start < stemIds.length; start += 200) {
      const ids = stemIds.slice(start, start + 200); const scope = new Set(ids);
      const result = await queryAll(`SELECT Id, IsDeleted, Name, CreatedDate, STEM__c, STEM__r.Account__c, Amount__c, Invoice_Date__c, Invoice_Due_Date__c, Proforma__c, Deprecated__c, File__c, LastModifiedDate${invoiceCurrencyFields} FROM Invoice__c WHERE STEM__c IN (${inList(ids)}) ORDER BY Id`, { clean: true, limit: MAX_ROWS });
      if (!completeResult(result, row => scope.has(sfId(row?.STEM__c)))) throw new Error('Invoice inventory');
      for (const row of result.records) {
        const id = scopedId(row.Id, 'a0K'); if (!id || seenInvoices.has(id)) throw new Error('duplicate Invoice'); seenInvoices.add(id);
        invoices.get(sfId(row.STEM__c)).push({ ...row, _currency: currencyForInvoice(row) });
      }
    }
    const groups = new Set(groupIds);
    return payments.map(row => {
      const parentId = sfId(row.Remittance__c);
      if (!candidates.includes(row) || !groups.has(parentId)) return row;
      const parent = parents.get(parentId); const siblings = families.get(parentId) || [];
      const relatedAccounts = unique([parent, ...siblings].map(item => sfId(item.Account__c)));
      const relatedStems = unique(siblings.map(item => sfId(item.STEM__c)));
      const proof = resolveGroupRemittanceBankEvidence(row, { parent, siblings, visiblePayments: payments,
        accounts: relatedAccounts.map(id => accounts.get(id)),
        buyerDocumentInventories: relatedStems.map(stemId => ({ stemId, complete: true, creditFields,
          records: invoices.get(stemId) || [] })), complete: true });
      return proof.eligible ? { ...row, _groupBankEvidence: proof.evidence }
        : { ...row, _groupBankEvidenceBlocker: proof.blocker };
    });
  } catch { return held('Complete current Group remittance, Account and buyer invoice evidence is unavailable.'); }
}

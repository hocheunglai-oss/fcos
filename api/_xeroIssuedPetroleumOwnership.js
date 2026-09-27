import { hkStrippedClKeyNameMatchKey, normalizeLookupValue, normalizeName } from './_xeroContactSync.js';
import { issuedSupplierSfId as sf, issuedSupplierHash as hash } from './_xeroIssuedSupplierPreservation.js';

export const PETROLEUM_OWNERSHIP_POLICY = 'document_specific_inactive_source_owners_v1';
const HASH = /^[a-f0-9]{64}$/;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
  && value !== '00000000-0000-0000-0000-000000000000' ? value.toLowerCase() : null;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, empty = false) => typeof value === 'string' && value.length <= 1000
  && (empty || value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const ownerKeys = ['id', 'name', 'companyCode', 'recordType', 'inactiveSuspended'];
const contactKeys = ['id', 'name', 'status', 'contactNumber', 'accountNumber'];
const proofKeys = ['selectedAccountId', 'contactId', 'owners', 'contact', 'sourceAccountIds', 'queriedSourceAccountIds', 'accountContactFingerprint', 'allYearsCoverageFingerprint'];
const names = account => [normalizeName(account.name), hkStrippedClKeyNameMatchKey(account.companyCode)].filter(Boolean);
const matches = (account, contact) => names(account).includes(normalizeName(contact.name));
const owner = row => ({ id: sf(row.id), name: row.name, companyCode: row.companyCode, recordType: row.recordType, inactiveSuspended: row.inactiveSuspended });
const contact = row => ({ id: uuid(row.id), name: row.name, status: row.status, contactNumber: row.contactNumber ?? '', accountNumber: row.accountNumber ?? '' });
const canonicalIds = (values, max = 625) => Array.isArray(values) && values.length > 0 && values.length <= max
  && values.every(value => sf(value) === value && value.startsWith('001'))
  && new Set(values).size === values.length && values.every((value, i) => i === 0 || values[i - 1] < value);
const validOwner = row => exactKeys(row, ownerKeys) && sf(row.id) === row.id && row.id.startsWith('001')
  && string(row.name) && string(row.companyCode, true) && string(row.recordType, true) && typeof row.inactiveSuspended === 'boolean';
const validContact = row => exactKeys(row, contactKeys) && uuid(row.id) === row.id && string(row.name)
  && row.status === 'ACTIVE' && string(row.contactNumber, true) && string(row.accountNumber, true);

export function petroleumOwnershipFingerprint(tenantId, facts) {
  return hash({ policyVersion: PETROLEUM_OWNERSHIP_POLICY, tenantId, selectedAccountId: facts.selectedAccountId,
    contactId: facts.contactId, owners: facts.owners, contact: facts.contact });
}

function foreignNumber(value, selected, accounts) {
  if (!value) return false;
  // A malformed Salesforce-looking identity is not an arbitrary legacy number.
  if (/^001/i.test(value.trim())) return !sf(value) || sf(value) !== selected.id;
  const normalized = normalizeLookupValue(value);
  return accounts.some(row => row.id !== selected.id && row.companyCode && normalizeLookupValue(row.companyCode) === normalized);
}

// Retained owners are competing document identities, never a global alias map.
// Caller completeness comes only from the strict current provider snapshots.
export function derivePetroleumOwnership({ tenantId, accountId, contactId, accounts, contacts, complete } = {}) {
  const blocked = message => ({ eligible: false, blockers: [{ code: 'CONTACT_OWNERSHIP_UNPROVEN', message }] });
  try {
    if (complete !== true || !uuid(tenantId) || !sf(accountId)?.startsWith('001') || !uuid(contactId)
      || !Array.isArray(accounts) || !accounts.length || accounts.length > 100000 || !Array.isArray(contacts) || contacts.length > 100000) return blocked('Complete current Account and Contact snapshots are required.');
    if (accounts.some(row => !sf(row?.id)?.startsWith('001') || !string(row.name) || !string(row.companyCode, true)
      || !string(row.recordType, true) || typeof row.inactiveSuspended !== 'boolean')
      || new Set(accounts.map(row => sf(row.id))).size !== accounts.length
      || contacts.some(row => !uuid(row?.id) || !string(row.name) || !['ACTIVE', 'ARCHIVED', 'GDPRREQUEST'].includes(row.status)
        || !string(row.contactNumber ?? '', true) || !string(row.accountNumber ?? '', true))
      || new Set(contacts.map(row => uuid(row.id))).size !== contacts.length) return blocked('Current identity IDs, names and explicit Account states must be complete and unique.');
    const currentAccounts = accounts.map(owner);
    const selected = currentAccounts.find(row => row.id === sf(accountId));
    const target = contacts.find(row => uuid(row.id) === uuid(contactId));
    if (!selected || selected.inactiveSuspended !== false || !hkStrippedClKeyNameMatchKey(selected.companyCode)
      || !target || target.status !== 'ACTIVE' || target.mergedToContactId || !matches(selected, target)
      || contacts.filter(row => row.status === 'ACTIVE' && matches(selected, row)).length !== 1
      || currentAccounts.filter(row => normalizeLookupValue(row.companyCode) === normalizeLookupValue(selected.companyCode)).length !== 1) return blocked('The selected active Account must have its own unique HK key and exact active Contact.');
    const owners = currentAccounts.filter(row => matches(row, target)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (!owners.length || owners.length > 25 || owners.some(row => row.id !== selected.id && row.inactiveSuspended !== true)) return blocked('Every other potential source owner must be explicitly inactive within the bounded scope.');
    const targetView = contact(target);
    if ([targetView.contactNumber, targetView.accountNumber].some(value => foreignNumber(value, selected, currentAccounts))) return blocked('The target Contact carries a conflicting explicit Account identity.');
    const claimed = contacts.filter(candidate => owners.some(row => matches(row, candidate)
      || [candidate.contactNumber, candidate.accountNumber].some(value => value
        && (sf(value.trim()) === row.id || [row.companyCode, ...names(row)].filter(Boolean).map(normalizeLookupValue).includes(normalizeLookupValue(value))))));
    if (claimed.some(row => uuid(row.id) !== uuid(contactId))) return blocked('A retained potential owner claims another existing Contact.');
    const facts = { selectedAccountId: selected.id, contactId: uuid(contactId), owners, contact: targetView,
      sourceAccountIds: owners.map(row => row.id) };
    return { eligible: true, blockers: [], ...facts, accountContactFingerprint: petroleumOwnershipFingerprint(uuid(tenantId), facts), requiresProof: owners.length > 1 };
  } catch { return blocked('Current document ownership evidence is incomplete.'); }
}

export function bindPetroleumOwnership(facts, coverage) {
  if (!facts?.eligible || facts.requiresProof !== true || !canonicalIds(coverage?.sourceAccountIds)
    || hash(facts.sourceAccountIds) !== hash(coverage.sourceAccountIds) || !HASH.test(coverage?.contentFingerprint || '')) return null;
  const { selectedAccountId, contactId, owners, contact: target, sourceAccountIds, accountContactFingerprint } = facts;
  return { identityOwnershipPolicy: PETROLEUM_OWNERSHIP_POLICY, identityOwnership: {
    selectedAccountId, contactId, owners, contact: target, sourceAccountIds,
    queriedSourceAccountIds: coverage.sourceAccountIds, accountContactFingerprint, allYearsCoverageFingerprint: coverage.contentFingerprint } };
}

// A STEM may legitimately have several suppliers. A broad STEM query may only
// exclude a foreign supplier's obligation after its returned owner is proven
// distinct; missing or contradictory identity is not negative evidence.
export function petroleumDistinctStemSuppliers(sourceClaims, stemId, ownership, accounts) {
  if (!ownership?.eligible || !sf(stemId) || !Array.isArray(sourceClaims) || !Array.isArray(accounts)) return false;
  return sourceClaims.filter(row => sf(row?.STEM__c) === sf(stemId)
    && !ownership.sourceAccountIds.includes(sf(row.Supplier__c))).every(row => {
    const id = sf(row.Supplier__c);
    const owners = id?.startsWith('001') ? accounts.filter(account => sf(account.id) === id) : [];
    return owners.length === 1 && row.Supplier__r?.Name === owners[0].name
      && row.Supplier__r?.Company_Code__c === owners[0].companyCode && !matches(owners[0], ownership.contact);
  });
}

// This validates the immutable sub-contract. Global snapshot completeness and
// absence of unseen competitors are independently established by the collector.
export function validatePetroleumOwnership(accounting, { tenantId, accountId, contactId, coverageFingerprint, accountIdsForContact } = {}) {
  try {
    if (!Object.hasOwn(accounting || {}, 'identityOwnershipPolicy') || !Object.hasOwn(accounting || {}, 'identityOwnership')
      || accounting.identityOwnershipPolicy !== PETROLEUM_OWNERSHIP_POLICY) return false;
    const proof = accounting.identityOwnership;
    if (!exactKeys(proof, proofKeys) || proof.selectedAccountId !== sf(accountId) || proof.contactId !== uuid(contactId)
      || !uuid(tenantId) || !Array.isArray(proof.owners) || proof.owners.length < 2 || proof.owners.length > 25
      || !proof.owners.every(validOwner) || !validContact(proof.contact) || proof.contact.id !== proof.contactId
      || !canonicalIds(proof.sourceAccountIds, 25) || hash(proof.sourceAccountIds) !== hash(proof.owners.map(row => row.id))
      || !canonicalIds(proof.queriedSourceAccountIds) || hash(proof.sourceAccountIds) !== hash(proof.queriedSourceAccountIds)
      || !HASH.test(proof.allYearsCoverageFingerprint || '') || proof.allYearsCoverageFingerprint !== coverageFingerprint
      || proof.accountContactFingerprint !== petroleumOwnershipFingerprint(uuid(tenantId), proof)) return false;
    const selected = proof.owners.find(row => row.id === proof.selectedAccountId);
    if (!selected || selected.inactiveSuspended !== false || !hkStrippedClKeyNameMatchKey(selected.companyCode)
      || proof.owners.some(row => !matches(row, proof.contact) || (row.id !== selected.id && row.inactiveSuspended !== true))
      || proof.owners.filter(row => normalizeLookupValue(row.companyCode) === normalizeLookupValue(selected.companyCode)).length !== 1
      || [proof.contact.contactNumber, proof.contact.accountNumber].some(value => foreignNumber(value, selected, proof.owners))) return false;
    if (accountIdsForContact !== undefined && (!Array.isArray(accountIdsForContact)
      || hash(accountIdsForContact.map(sf).sort()) !== hash(proof.sourceAccountIds))) return false;
    return true;
  } catch { return false; }
}

export function currentPetroleumOwnershipMatches(accounting, { tenantId, accountId, contactId, accounts, contacts, complete } = {}) {
  if (!validatePetroleumOwnership(accounting, { tenantId, accountId, contactId, coverageFingerprint: accounting?.identityScope?.coverageFingerprint })) return false;
  const current = derivePetroleumOwnership({ tenantId, accountId, contactId, accounts, contacts, complete });
  return current.eligible && current.requiresProof && current.accountContactFingerprint === accounting.identityOwnership.accountContactFingerprint
    && hash(current.sourceAccountIds) === hash(accounting.identityOwnership.sourceAccountIds);
}

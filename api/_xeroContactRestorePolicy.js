import { createHash } from 'node:crypto';
import { hkStrippedClKeyNameMatchKey, normalizeLookupValue, normalizeName, validateSalesforceAccountForAutoCreate } from './_xeroContactSync.js';

export const CONTACT_RESTORE_POLICY = 'same_id_contact_restore_v1';
export const restoreUuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
  && value !== '00000000-0000-0000-0000-000000000000' ? value.toLowerCase() : null;
export const restoreAccountId = (value) => typeof value === 'string' && /^001[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(value) ? value.slice(0, 15) : null;
export const contactRestoreHash = (value) => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)).digest('hex');
const words = (value) => typeof value === 'string' ? value.trim() : '';
const accountView = (row) => ({ id: restoreAccountId(row.id), name: row.name, companyCode: row.companyCode || '',
  recordType: row.recordType || '', inactiveSuspended: row.inactiveSuspended });
export const contactRestoreIdentity = (row) => ({ contactId: restoreUuid(row?.contactId), name: row?.name || '',
  contactNumber: row?.contactNumber || '', accountNumber: row?.accountNumber || '', mergedToContactId: row?.mergedToContactId || null });
const nameKeys = (row) => [...new Set([normalizeName(row.name), hkStrippedClKeyNameMatchKey(row.companyCode)].filter(Boolean))];
const keys = (row) => [...new Set([...nameKeys(row), normalizeLookupValue(row.companyCode)].filter(Boolean))];
const matches = (account, contact) => nameKeys(account).includes(normalizeName(contact.name));
const numberMatches = (account, contact) => [contact.contactNumber, contact.accountNumber].some((value) => value
  && (restoreAccountId(value) === restoreAccountId(account.id) || keys(account).includes(normalizeLookupValue(value))));

// No alias is propagated. Inactive same-name Accounts stay in the proof, and
// any alternate Contact claimed by them still blocks this same-ID operation.
export function buildContactRestoration(account, allAccounts, contacts, { tenantId, accountsComplete = false, contactsComplete = false } = {}) {
  const base = { policyVersion: CONTACT_RESTORE_POLICY, eligible: false, identityEligible: false, blockers: [],
    accountId: account?.id || null, tenantId: restoreUuid(tenantId), targetContactId: null };
  const reject = (message) => ({ ...base, blockers: [message] });
  try {
    if (!base.tenantId || accountsComplete !== true || contactsComplete !== true || !Array.isArray(allAccounts) || !Array.isArray(contacts)
      || allAccounts.some((row) => !restoreAccountId(row?.id) || !words(row.name) || typeof row.inactiveSuspended !== 'boolean')
      || new Set(allAccounts.map((row) => restoreAccountId(row.id))).size !== allAccounts.length
      || contacts.some((row) => !restoreUuid(row?.contactId) || !words(row.name) || !['ACTIVE', 'ARCHIVED', 'GDPRREQUEST'].includes(row.status))
      || new Set(contacts.map((row) => restoreUuid(row.contactId))).size !== contacts.length) return reject('Complete current Account and Contact identity evidence is required.');
    const sourceId = restoreAccountId(account?.id);
    const current = allAccounts.filter((row) => restoreAccountId(row.id) === sourceId);
    if (!sourceId || current.length !== 1 || contactRestoreHash(accountView(current[0])) !== contactRestoreHash(accountView(account))
      || account.inactiveSuspended !== false || validateSalesforceAccountForAutoCreate(account)
      || /^(no\s*name|unknown|cash|miscellaneous|n\/?a|tbd|test|supplier|buyer)$/i.test(account.name.trim())) return reject('The reviewed active source Account and its own HK key must be verified.');
    if (allAccounts.filter((row) => normalizeLookupValue(row.companyCode) === normalizeLookupValue(account.companyCode)).length !== 1) return reject('Another Account claims the source CL key.');
    const direct = contacts.filter((contact) => matches(account, contact));
    if (direct.length !== 1) return reject('Exactly one Contact must match the source Account’s own name or stripped CL key.');
    const target = direct[0]; base.targetContactId = restoreUuid(target.contactId);
    if (!['ACTIVE', 'ARCHIVED'].includes(target.status) || target.mergedToContactId) return reject('A merged or unsupported Contact cannot be restored.');
    if ([target.contactNumber, target.accountNumber].some((value) => restoreAccountId(value) && restoreAccountId(value) !== sourceId)) {
      return reject('The selected Contact explicitly names a different Salesforce Account.');
    }
    const ownKeys = new Set(keys(account));
    const related = allAccounts.filter((candidate) => restoreAccountId(candidate.id) === sourceId || keys(candidate).some((key) => ownKeys.has(key)));
    if (related.some((candidate) => restoreAccountId(candidate.id) !== sourceId && candidate.inactiveSuspended !== true)) return reject('Another active Account shares this Contact identity.');
    const claimed = contacts.filter((contact) => related.some((candidate) => matches(candidate, contact) || numberMatches(candidate, contact)));
    if (claimed.some((contact) => restoreUuid(contact.contactId) !== base.targetContactId)) return reject('The source or an inactive alias claims another existing Contact.');
    const foreignNumberOwners = allAccounts.filter((candidate) => restoreAccountId(candidate.id) !== sourceId
      && [target.contactNumber, target.accountNumber].some((value) => value && (restoreAccountId(value) === restoreAccountId(candidate.id)
        || (normalizeLookupValue(candidate.companyCode) && normalizeLookupValue(value) === normalizeLookupValue(candidate.companyCode)))));
    if (foreignNumberOwners.length) return reject('The selected Contact carries another Account’s explicit identity.');
    const sourceFingerprint = contactRestoreHash(accountView(account));
    const contactFingerprint = contactRestoreHash(contactRestoreIdentity(target));
    const collisionEvidence = { accounts: related.map(accountView).sort((a, b) => a.id.localeCompare(b.id)),
      contacts: claimed.map(contactRestoreIdentity).sort((a, b) => a.contactId.localeCompare(b.contactId)) };
    const collisionFingerprint = contactRestoreHash(collisionEvidence);
    const reviewFingerprint = contactRestoreHash({ policyVersion: CONTACT_RESTORE_POLICY, tenantId: base.tenantId,
      accountId: sourceId, targetContactId: base.targetContactId, sourceFingerprint, contactFingerprint, collisionFingerprint });
    return { ...base, eligible: target.status === 'ARCHIVED', identityEligible: true, contactStatus: target.status,
      sourceFingerprint, contactFingerprint, collisionFingerprint, reviewFingerprint, collisionEvidence };
  } catch {
    return reject('Current Contact restoration evidence is incomplete.');
  }
}

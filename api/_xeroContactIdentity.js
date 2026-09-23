import { createHash, randomUUID } from 'node:crypto';
import { getFreshXeroConnection, hkStrippedClKeyNameMatchKey, listXeroContactsForRename, normalizeLookupValue, normalizeName, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { sfQuery } from './_salesforce.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const error = (message, code = 'XERO_CONTACT_IDENTITY_INVALID', status = 409) => Object.assign(new Error(message), { code, status, expose: true });
export function contactIdentityFingerprint(tenantId, contact) {
  return createHash('sha256').update(JSON.stringify([tenantId, contact.contactId, contact.name || '', contact.contactNumber || '', contact.accountNumber || '', contact.status || ''])).digest('hex');
}
export function contactIdentityDecision(tenantId, contact, decision) {
  if (!decision || decision.tenant_id !== tenantId || decision.contact_id !== contact.contactId || decision.decision === 'revoked') return null;
  return decision.decision === 'verified_xero_only' && decision.fingerprint === contactIdentityFingerprint(tenantId, contact) ? 'verified' : 'stale';
}
export async function loadContactIdentityDecisions(client, tenantId) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error: failure } = await client.from('xero_contact_identity_decisions').select('*').eq('tenant_id', tenantId).order('contact_id').range(offset, offset + 999);
    if (failure) throw error('Contact identity decisions could not be loaded.', 'XERO_CONTACT_IDENTITY_STORAGE_FAILED', 503);
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return new Map(rows.map((row) => [row.contact_id, row]));
}
export async function loadAllSalesforceIdentityAccounts() {
  const result = await sfQuery('SELECT Id, Name, Company_Code__c, Inactive_Suspended__c, RecordType.DeveloperName FROM Account', { clean: true, limit: 100000 });
  if (result.totalSize !== result.records.length) throw error('Salesforce Account evidence is incomplete.');
  return result.records.map((row) => ({ id: row.Id, name: row.Name, companyCode: row.Company_Code__c, recordType: row.RecordType?.DeveloperName }));
}
export function contactMatchesSalesforceIdentity(contact, accounts) {
  const values = [contact.name, contact.contactNumber, contact.accountNumber].map(normalizeLookupValue).filter(Boolean);
  const accountIdKey = (value) => /^001[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(value || '') ? String(value).slice(0, 15) : null;
  return accounts.some((account) => {
    const keys = [account.name, account.companyCode, hkStrippedClKeyNameMatchKey(account.companyCode)].map(normalizeLookupValue).filter(Boolean);
    return values.some((value) => keys.includes(value)) || [contact.name, contact.contactNumber, contact.accountNumber].some((value) => accountIdKey(value) && accountIdKey(value) === accountIdKey(account.id));
  });
}
export async function xeroContactIdentitySave(body = {}, { accessContext, env = process.env, fetchImpl = fetch, client = xeroContactSyncServiceClient(env), connectionReader = getFreshXeroConnection, contactReader = listXeroContactsForRename, accountReader = loadAllSalesforceIdentityAccounts } = {}) {
  const actor = accessContext?.profile;
  if (!actor?.id || !actor?.email) throw error('A signed-in Finance manager is required.', 'XERO_CONTACT_IDENTITY_ACTOR_REQUIRED', 403);
  if (!uuid.test(body.contactId || '') || !uuid.test(body.tenantId || '') || !['verified_xero_only', 'revoked'].includes(body.decision)
    || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.reviewed !== true
    || typeof body.evidenceNote !== 'string' || body.evidenceNote.trim().length < 15 || body.evidenceNote.length > 2000
    || typeof body.evidenceReference !== 'string' || !body.evidenceReference.trim() || body.evidenceReference.length > 500) {
    throw error('Select a contact and provide reviewed identity evidence, its reference, and the current revision.', 'XERO_CONTACT_IDENTITY_INVALID', 400);
  }
  const connection = await connectionReader(client, { env, fetchImpl });
  if (connection.tenantId !== body.tenantId) throw error('The connected Xero organization changed. Reload the contact preview.');
  const { acquireLifecycleLock, buildContactLifecycleRows } = await import('./_xeroPortal.js');
  const leaseId = randomUUID();
  const lock = await acquireLifecycleLock(client, leaseId, actor, env);
  try {
    const [contacts, accounts] = await Promise.all([contactReader(connection, { env, fetchImpl }), accountReader()]);
    const matches = contacts.filter((contact) => contact.contactId === body.contactId);
    const contact = matches[0];
    if (matches.length !== 1 || contact.status !== 'ACTIVE') throw error('The selected active contact could not be verified.');
    const fingerprint = contactIdentityFingerprint(connection.tenantId, contact);
    if (body.expectedFingerprint !== fingerprint) throw error('Xero contact identity changed after preview. Reload before saving.', 'XERO_CONTACT_IDENTITY_STALE');
    if (body.decision === 'verified_xero_only') {
      const row = buildContactLifecycleRows(accounts, [contact], new Map(), { usageCoverageComplete: false }).find((candidate) => candidate.xeroContactId === contact.contactId);
      if (row?.salesforceAccountId || row?.reason === 'ambiguous-salesforce-match' || contactMatchesSalesforceIdentity(contact, accounts)
        || contacts.some((other) => other.contactId !== contact.contactId && other.status !== 'ARCHIVED' && normalizeName(other.name) === normalizeName(contact.name))
        || !contact.name?.trim() || /^(no\s*name|unknown|cash|miscellaneous|n\/?a)$/i.test(contact.name.trim())) {
        throw error('Resolve the Salesforce match, duplicate, or placeholder identity before verifying this contact.');
      }
    }
    const lease = await client.from('xero_contact_lifecycle_locks').select('run_id,locked_until').eq('id', 'primary').maybeSingle();
    if (lease.error || lease.data?.run_id !== leaseId || !(Date.parse(lease.data.locked_until) > Date.now())) {
      throw error('The contact verification lock expired or changed. Refresh before saving.', 'XERO_CONTACT_IDENTITY_LOCK_LOST');
    }
    const { data, error: failure } = await client.rpc('save_xero_contact_identity_v1', {
      p_tenant_id: connection.tenantId, p_contact_id: contact.contactId, p_decision: body.decision, p_fingerprint: fingerprint,
      p_evidence_note: body.evidenceNote.trim(), p_evidence_reference: body.evidenceReference.trim(),
      p_expected_revision: body.expectedRevision, p_actor_id: actor.id, p_actor_email: actor.email,
    });
    if (failure) throw error(failure.code === '40001' ? 'Another Finance user changed this decision. Reload before saving.' : 'The identity decision and audit could not be saved.', failure.code === '40001' ? 'XERO_CONTACT_IDENTITY_CONFLICT' : 'XERO_CONTACT_IDENTITY_STORAGE_FAILED', failure.code === '40001' ? 409 : 503);
    return { decision: data, refreshPreview: true };
  } finally {
    await lock.release();
  }
}

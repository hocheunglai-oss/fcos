import { createHash, randomUUID } from 'node:crypto';
import { requireExternalActionGate } from './_externalActionGates.js';
import { sfQuery } from './_salesforce.js';
import { acquireLifecycleLock } from './_xeroPortal.js';
import { buildContactAutoCreateRows, createXeroContactsBatch, exportSalesforceAccountsByIds, getFreshXeroConnection,
  hkStrippedClKeyNameMatchKey, isSalesforceAccountId, listXeroContactsForRename, normalizeLookupValue, normalizeName,
  splitScopes, xeroContactSyncServiceClient } from './_xeroContactSync.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error = (message, code, status = 409) => Object.assign(new Error(message), { code, status, expose: true });
const storageError = () => error('The durable contact repair record could not be saved or verified.', 'XERO_CONTACT_REPAIR_STORAGE_FAILED', 503);
const sourceFingerprint = (account) => hash([account.id, account.name, account.companyCode, account.recordType, account.inactiveSuspended === true]);
const placeholder = (name) => /^(no\s*name|unknown|cash|miscellaneous|n\/?a|tbd|test|supplier|buyer)$/i.test(String(name || '').trim());

async function allSalesforceAccounts() {
  const result = await sfQuery('SELECT Id, Name, Company_Code__c, Inactive_Suspended__c, RecordType.DeveloperName FROM Account', { clean: true, limit: 100000 });
  if (result.error || !Array.isArray(result.records) || result.totalSize !== result.records.length) throw error('Complete Salesforce Account identity evidence is unavailable.', 'XERO_CONTACT_REPAIR_SOURCE_INCOMPLETE', 502);
  return result.records.map((row) => ({ id: row.Id, name: row.Name || '', companyCode: row.Company_Code__c || '',
    recordType: row.RecordType?.DeveloperName || row['RecordType.DeveloperName'] || '', inactiveSuspended: row.Inactive_Suspended__c === true }));
}

async function loadRepairRows(client, runId, rowIds) {
  const { data: run, error: runError } = await client.from('xero_contact_lifecycle_runs').select('*').eq('id', runId).maybeSingle();
  if (runError) throw storageError();
  if (!run || !['previewed', 'applied'].includes(run.state)) throw error('A saved lifecycle preview is required.', 'XERO_CONTACT_REPAIR_RUN_INVALID');
  const { data: rows, error: rowsError } = await client.from('xero_contact_lifecycle_rows').select('*').eq('run_id', runId).in('row_id', rowIds);
  if (rowsError) throw storageError();
  if (!Array.isArray(rows) || rows.length !== rowIds.length || new Set(rows.map((row) => row.row_id)).size !== rowIds.length
    || rows.some((row) => row.reason !== 'missing-xero-contact' || row.action !== 'exception' || row.xero_contact_id
      || !isSalesforceAccountId(row.salesforce_account_id))) throw error('Select only the saved missing-contact exceptions. Refresh and review the lifecycle preview.', 'XERO_CONTACT_REPAIR_SELECTION_INVALID');
  if (new Set(rows.map((row) => row.salesforce_account_id)).size !== rows.length) throw error('The selected rows repeat a Salesforce Account.', 'XERO_CONTACT_REPAIR_SELECTION_INVALID');
  return { run, rows: rows.sort((left, right) => left.row_id.localeCompare(right.row_id)) };
}

async function priorIntents(client, tenantId, accountIds) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from('xero_financial_audit_events').select('fingerprints').eq('event_type', 'contact_repair_intent')
      .eq('fingerprints->>tenantId', tenantId).in('fingerprints->>accountId', accountIds).order('id').range(offset, offset + 999);
    if (result.error || !Array.isArray(result.data) || result.data.some((row) => row.fingerprints?.tenantId !== tenantId || !accountIds.includes(row.fingerprints?.accountId))) throw storageError();
    rows.push(...result.data);
    if (rows.length > 10000) throw storageError();
    if (result.data.length < 1000) return new Set(rows.map((row) => row.fingerprints?.accountId));
  }
}

async function audit(client, actor, eventType, outcome, evidence, code = null) {
  const result = await client.from('xero_financial_audit_events').insert({ run_id: null, event_type: eventType, outcome,
    actor_id: actor.id, actor_email: actor.email, record_counts: { contacts: 1 }, fingerprints: evidence, error_code: code });
  if (result.error) throw storageError();
}

async function saveJournal(client, row, journal) {
  const result = await client.from('xero_contact_lifecycle_rows').update({ raw_row: { ...(row.raw_row || {}), repair: journal },
    idempotency_key: journal.idempotencyKey || row.idempotency_key || null, message: journal.message || row.message || null })
    .eq('run_id', row.run_id).eq('row_id', row.row_id).select('id').maybeSingle();
  if (result.error || !result.data) throw storageError();
  row.raw_row = { ...(row.raw_row || {}), repair: journal };
}

async function verifyLease(client, leaseId) {
  const result = await client.from('xero_contact_lifecycle_locks').select('run_id,locked_until').eq('id', 'primary').maybeSingle();
  if (result.error) throw storageError();
  if (result.data?.run_id !== leaseId || !(Date.parse(result.data.locked_until) > Date.now())) throw error('The contact repair lock expired or changed. Refresh before continuing.', 'XERO_CONTACT_REPAIR_LOCK_LOST');
}

function accountBlocker(row, account, allAccounts) {
  if (!account || allAccounts.filter((candidate) => candidate.id === row.salesforce_account_id).length !== 1) return 'The current Salesforce Account could not be verified uniquely.';
  if (sourceFingerprint(account) !== sourceFingerprint(allAccounts.find((candidate) => candidate.id === account.id))) return 'Salesforce Account evidence changed during verification.';
  if (account.name !== row.salesforce_name || account.companyCode !== row.salesforce_cl_key || account.recordType !== row.salesforce_record_type
    || account.inactiveSuspended === true) return 'Salesforce Account identity changed after preview. Review a fresh preview.';
  if (placeholder(account.name)) return 'A placeholder Salesforce name cannot create an accounting contact.';
  const keys = (candidate) => new Set([normalizeName(candidate.name), hkStrippedClKeyNameMatchKey(candidate.companyCode), normalizeLookupValue(candidate.companyCode)].filter(Boolean));
  const targets = keys(account);
  if (allAccounts.some((candidate) => candidate.id !== account.id && [...keys(candidate)].some((value) => targets.has(value)))) return 'Another Salesforce Account shares this contact name or CL key. Resolve the identity before creating a contact.';
  return null;
}

function verifiedExisting(account, contacts, expectedId = null) {
  const [classified] = buildContactAutoCreateRows([account], contacts);
  if (classified?.status !== 'already-exists') return null;
  const contact = contacts.find((candidate) => candidate.contactId === classified.xeroContactId);
  if (!contact || !uuid.test(contact.contactId) || contact.status !== 'ACTIVE' || (expectedId && contact.contactId !== expectedId)) return null;
  return contact;
}

export async function xeroContactRepairApply(body = {}, {
  accessContext, env = process.env, fetchImpl = fetch, client = xeroContactSyncServiceClient(env),
  connectionReader = getFreshXeroConnection, accountReader = exportSalesforceAccountsByIds, allAccountReader = allSalesforceAccounts,
  contactReader = listXeroContactsForRename, contactCreator = createXeroContactsBatch, lockReader = acquireLifecycleLock,
} = {}) {
  const actor = accessContext?.profile;
  if (!uuid.test(actor?.id || '') || !actor?.email) throw error('A signed-in Finance manager is required.', 'XERO_CONTACT_REPAIR_ACTOR_REQUIRED', 403);
  requireExternalActionGate('xero_contact_sync', env);
  const rowIds = Array.isArray(body.rowIds) ? body.rowIds : [];
  if (body.reviewed !== true || !uuid.test(body.runId || '') || !rowIds.length || rowIds.length > 25
    || rowIds.some((id) => typeof id !== 'string' || !id.trim()) || new Set(rowIds).size !== rowIds.length) {
    throw error('Review one to 25 saved missing-contact rows before applying repair.', 'XERO_CONTACT_REPAIR_SELECTION_INVALID', 400);
  }
  const leaseId = randomUUID();
  const lock = await lockReader(client, leaseId, actor, env);
  try {
    const { run, rows } = await loadRepairRows(client, body.runId, rowIds);
    const connection = await connectionReader(client, { env, fetchImpl });
    if (!uuid.test(run.xero?.tenantId || '') || connection.tenantId !== run.xero.tenantId) throw error('The connected Xero organisation changed after preview.', 'XERO_CONTACT_REPAIR_TENANT_CHANGED');
    if (!splitScopes(connection.scope).includes('accounting.contacts')) throw error('Xero contact write scope is required.', 'XERO_CONTACT_REPAIR_SCOPE_REQUIRED', 403);
    const ids = rows.map((row) => row.salesforce_account_id);
    const [accounts, allAccounts, contacts, attempted] = await Promise.all([
      accountReader(ids), allAccountReader(), contactReader(connection, { env, fetchImpl }), priorIntents(client, connection.tenantId, ids),
    ]);
    if (!Array.isArray(accounts) || !Array.isArray(allAccounts) || allAccounts.some((account) => !isSalesforceAccountId(account.id)) || new Set(allAccounts.map((account) => account.id)).size !== allAccounts.length
      || !Array.isArray(contacts) || new Set(contacts.map((contact) => contact.contactId)).size !== contacts.length
      || contacts.some((contact) => !uuid.test(contact.contactId || '') || !String(contact.name || '').trim() || !contact.status)) throw error('Complete current contact identity evidence is unavailable.', 'XERO_CONTACT_REPAIR_EVIDENCE_INCOMPLETE', 502);
    const outcomes = [];
    for (const row of rows) {
      const candidates = accounts.filter((account) => account.id === row.salesforce_account_id);
      const account = candidates.length === 1 ? candidates[0] : null;
      const operationId = hash([connection.tenantId, run.id, row.row_id]);
      const idempotencyKey = `repair-${operationId.slice(0, 48)}-create-1`;
      const evidence = { lifecycleRunId: run.id, rowId: row.row_id, accountId: row.salesforce_account_id, tenantId: connection.tenantId,
        sourceFingerprint: account ? sourceFingerprint(account) : null, operationId, idempotencyKey };
      const originalJournal = row.raw_row?.repair;
      const finish = async (state, message, contact = null, code = null) => {
        const journal = { ...evidence, state, message, contactId: contact?.contactId || null, expectedContactId: originalJournal?.expectedContactId || originalJournal?.contactId || contact?.contactId || null, checkedAt: new Date().toISOString() };
        await saveJournal(client, row, journal);
        await audit(client, actor, 'contact_repair_outcome', state, { ...evidence, contactId: journal.contactId }, code);
        const outcome = { rowId: row.row_id, salesforceAccountId: row.salesforce_account_id, status: state, message,
          xeroContactId: journal.contactId, errorCode: code };
        outcomes.push(outcome);
      };
      const blocker = accountBlocker(row, account, allAccounts);
      if (blocker) { await finish('blocked', blocker, null, 'XERO_CONTACT_REPAIR_SOURCE_CHANGED'); continue; }
      const previous = row.raw_row?.repair;
      const existing = verifiedExisting(account, contacts, previous?.expectedContactId || previous?.contactId || null);
      if (existing) { await finish('already_exists', 'A current matching active Xero contact was verified; no contact was created.', existing); continue; }
      const [classified] = buildContactAutoCreateRows([account], contacts);
      if (classified?.status !== 'pending') { await finish('blocked', classified?.message || 'Contact identity is ambiguous or protected.', null, 'XERO_CONTACT_REPAIR_IDENTITY_BLOCKED'); continue; }
      const protectedKeys = new Set([account.id, account.companyCode, hkStrippedClKeyNameMatchKey(account.companyCode)].map(normalizeLookupValue).filter(Boolean));
      if (contacts.some((contact) => [contact.contactNumber, contact.accountNumber].some((value) => protectedKeys.has(normalizeLookupValue(value))))) {
        await finish('blocked', 'An existing Xero contact carries this Salesforce identity in its contact or account number. Resolve that contact before creating another.', null, 'XERO_CONTACT_REPAIR_IDENTITY_BLOCKED'); continue;
      }
      if (attempted.has(account.id) || previous?.state === 'intent' || previous?.state === 'uncertain' || previous?.contactId || previous?.expectedContactId) {
        await finish('uncertain', 'A previous creation attempt has no verified current result. Resolve its Xero outcome before any new creation.', null, 'XERO_CONTACT_REPAIR_OUTCOME_UNCERTAIN'); continue;
      }
      await verifyLease(client, leaseId);
      await audit(client, actor, 'contact_repair_intent', 'intent', evidence);
      await saveJournal(client, row, { ...evidence, state: 'intent', startedAt: new Date().toISOString() });
      attempted.add(account.id);
      await verifyLease(client, leaseId);
      let result;
      try { result = await contactCreator(connection, [{ rowId: row.row_id, name: account.name }], `repair-${operationId.slice(0, 48)}`, { env, fetchImpl }); }
      catch { result = []; }
      const returned = result?.length === 1 ? result[0] : null;
      if (returned?.success === true && returned.rowId === row.row_id && uuid.test(returned.contactId || '')
        && returned.name === account.name && returned.contactStatus === 'ACTIVE' && !contacts.some((contact) => contact.contactId === returned.contactId)) {
        const contact = { contactId: returned.contactId, name: returned.name, status: returned.contactStatus };
        contacts.push(contact);
        await finish('created', 'Created and verified the reviewed Xero contact identity.', contact);
      } else {
        // Even a validation-looking response can follow an accepted write. A later complete scan resolves it; never resend automatically.
        await finish('uncertain', 'Xero did not confirm the exact reviewed contact identity. Refresh to verify the outcome before any retry.', null, 'XERO_CONTACT_REPAIR_OUTCOME_UNCERTAIN');
      }
    }
    return { runId: body.runId, outcomes, refreshPreview: true, summary: { total: outcomes.length,
      created: outcomes.filter((row) => row.status === 'created').length, existing: outcomes.filter((row) => row.status === 'already_exists').length,
      blocked: outcomes.filter((row) => row.status === 'blocked').length, uncertain: outcomes.filter((row) => row.status === 'uncertain').length } };
  } finally { await lock.release(); }
}

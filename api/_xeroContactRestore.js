import { randomUUID } from 'node:crypto';
import { requireExternalActionGate } from './_externalActionGates.js';
import { loadAllSalesforceIdentityAccounts } from './_xeroContactIdentity.js';
import { acquireLifecycleLock } from './_xeroPortal.js';
import { getFreshXeroConnection, listXeroContactsForRename, splitScopes, xeroAccountingFetch, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { buildContactRestoration, CONTACT_RESTORE_POLICY, contactRestoreHash, contactRestoreIdentity, restoreAccountId, restoreUuid } from './_xeroContactRestorePolicy.js';

const failure = (message, code = 'XERO_CONTACT_RESTORE_INVALID', status = 409) => Object.assign(new Error(message), { code, status, expose: true });
const storageError = () => failure('The durable Contact restoration evidence could not be saved or verified.', 'XERO_CONTACT_RESTORE_STORAGE_FAILED', 503);
const HASH = /^[a-f0-9]{64}$/;
const finalStates = new Set(['restored', 'already_active']);
const diagnosticErrorCodes = new Set(['XERO_CONTACT_SYNC_XERO_REQUEST_FAILED', 'XERO_CONTACT_SYNC_RATE_LIMITED',
  'XERO_CONTACT_SYNC_RATE_LIMIT_RETRY_EXHAUSTED', 'XERO_CONTACT_SYNC_DAILY_LIMIT', 'XERO_CONTACT_SYNC_DAILY_RESERVE',
  'XERO_CONTACT_RESTORE_DETAIL_INCOMPLETE']);
const httpStatus = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const contactStatus = (value) => ['ACTIVE', 'ARCHIVED', 'GDPRREQUEST'].includes(value) ? value : null;

function safeProviderError(error) {
  return { code: diagnosticErrorCodes.has(error?.code) ? error.code : 'UNCLASSIFIED_PROVIDER_ERROR', httpStatus: httpStatus(error?.status) };
}

function captureHttp(observations) {
  return ({ status, headers } = {}) => {
    if (observations.length >= 4) return;
    const entry = { status: httpStatus(status), correlation: {} };
    // Never retain arbitrary response headers, provider messages or OAuth data.
    for (const name of ['xero-correlation-id', 'x-correlation-id', 'x-request-id', 'request-id']) {
      let value;
      try { value = headers?.get?.(name); } catch { value = null; }
      if (typeof value === 'string' && (restoreUuid(value) || /^[a-f0-9]{16,64}$/i.test(value))) entry.correlation[name] = value.toLowerCase();
    }
    observations.push(entry);
  };
}

function postResponseFacts(response, expectedId) {
  const contacts = Array.isArray(response?.Contacts) ? response.Contacts : null;
  const selected = contacts?.filter((row) => restoreUuid(row?.ContactID) === expectedId) || [];
  const target = selected.length === 1 ? selected[0] : null;
  const validation = target?.ValidationErrors;
  return { present: response !== null && response !== undefined, contactsPresent: contacts !== null,
    contactCount: contacts?.length ?? null, selectedContactCount: selected.length,
    selectedContactStatus: contactStatus(target?.ContactStatus),
    hasValidationErrors: typeof target?.HasValidationErrors === 'boolean' ? target.HasValidationErrors : null,
    validationErrorsPresent: target ? Object.hasOwn(target, 'ValidationErrors') : false,
    validationErrorCount: Array.isArray(validation) ? validation.length : null,
    validationErrorsMalformed: validation != null && !Array.isArray(validation),
    providerErrorNumber: Number.isSafeInteger(response?.ErrorNumber) && response.ErrorNumber >= 0 && response.ErrorNumber <= 999999 ? response.ErrorNumber : null };
}

function readbackFacts(raw, expectedId, expectedIdentity, expectedBusiness = null) {
  const present = Boolean(raw && typeof raw === 'object' && !Array.isArray(raw));
  const id = restoreUuid(raw?.ContactID);
  const detail = id ? normalizedDetail(raw, id) : null;
  const identityFingerprint = detail ? contactRestoreHash(contactRestoreIdentity(detail)) : null;
  let businessFingerprint = null;
  if (present && id) {
    try { businessFingerprint = contactRestoreBusinessFingerprint(raw); } catch { /* Diagnostics must not replace the existing outcome rule. */ }
  }
  const mismatches = [];
  if (!present) mismatches.push('readback_unavailable');
  else {
    if (id !== expectedId) mismatches.push('contact_id_mismatch');
    if (raw.MergedToContactID != null && raw.MergedToContactID !== '') mismatches.push('merged_contact');
    if (!detail) mismatches.push('invalid_contact_record');
    else if (identityFingerprint !== expectedIdentity) mismatches.push('identity_fingerprint_mismatch');
    if (expectedBusiness && businessFingerprint !== expectedBusiness) mismatches.push('business_fingerprint_mismatch');
    if (raw.ContactStatus === 'ARCHIVED') mismatches.push('still_archived');
    else if (raw.ContactStatus !== 'ACTIVE') mismatches.push('unsupported_contact_status');
  }
  return { present, contactId: id, contactStatus: contactStatus(raw?.ContactStatus), sameContactId: id === expectedId,
    identityFingerprint, identityMatches: identityFingerprint === null ? null : identityFingerprint === expectedIdentity,
    businessFingerprint, businessMatches: expectedBusiness && businessFingerprint ? businessFingerprint === expectedBusiness : null,
    mismatchCategory: mismatches[0] || null, mismatchCategories: mismatches };
}

export const contactRestoreBusinessFingerprint = (contact) => {
  // Keep every business field, including unknown future fields. Only provider
  // observations which may change independently of a status update are omitted.
  const { ContactStatus: _status, UpdatedDateUTC: _updated, Balances: _balances, AccountsReceivable: _receivable,
    AccountsPayable: _payable, HasValidationErrors: _invalid, ValidationErrors: _errors,
    IsSupplier: _supplier, IsCustomer: _customer, HasAttachments: _attachments, ...business } = contact;
  return contactRestoreHash({ ...business, ContactID: restoreUuid(contact.ContactID) });
};

export async function readXeroContactForRestoration(connection, contactId, { env = process.env, fetchImpl = fetch, onResponse = null } = {}) {
  if (!restoreUuid(contactId)) throw failure('A valid exact Contact ID is required.');
  const response = await xeroAccountingFetch(connection, `/Contacts/${encodeURIComponent(contactId)}?includeArchived=true`, {
    method: 'GET', retryOnRateLimit: true, env, fetchImpl, onResponse,
  });
  if (!Array.isArray(response?.Contacts) || response.Contacts.length !== 1) throw failure('The exact Contact could not be read completely.', 'XERO_CONTACT_RESTORE_DETAIL_INCOMPLETE', 502);
  return response.Contacts[0];
}

export async function restoreXeroContactStatus(connection, contactId, idempotencyKey, { env = process.env, fetchImpl = fetch, onResponse = null } = {}) {
  if (!restoreUuid(contactId) || !/^restore-[a-f0-9]{48}$/.test(idempotencyKey || '')) throw failure('The reviewed restoration operation is invalid.');
  return xeroAccountingFetch(connection, '/Contacts?summarizeErrors=false', {
    method: 'POST', body: { Contacts: [{ ContactID: contactId, ContactStatus: 'ACTIVE' }] },
    idempotencyKey, retryOnRateLimit: false, env, fetchImpl, onResponse,
  });
}

function normalizedDetail(raw, expectedId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || restoreUuid(raw.ContactID) !== restoreUuid(expectedId)
    || typeof raw.Name !== 'string' || !raw.Name.trim() || !['ACTIVE', 'ARCHIVED'].includes(raw.ContactStatus)
    || (raw.MergedToContactID != null && raw.MergedToContactID !== '') || raw.HasValidationErrors === true
    || (raw.ValidationErrors != null && (!Array.isArray(raw.ValidationErrors) || raw.ValidationErrors.length))
    || ['ContactNumber', 'AccountNumber'].some((key) => raw[key] != null && typeof raw[key] !== 'string')) return null;
  return { contactId: restoreUuid(raw.ContactID), name: raw.Name.trim(), status: raw.ContactStatus,
    contactNumber: (raw.ContactNumber || '').trim(), accountNumber: (raw.AccountNumber || '').trim(), mergedToContactId: null };
}

async function loadRows(client, runId, rowIds) {
  const runResult = await client.from('xero_contact_lifecycle_runs').select('*').eq('id', runId).maybeSingle();
  if (runResult.error) throw storageError();
  const run = runResult.data;
  if (!run || !['previewed', 'applied'].includes(run.state)) throw failure('A saved Contact lifecycle preview is required.');
  const result = await client.from('xero_contact_lifecycle_rows').select('*').eq('run_id', runId).in('row_id', rowIds);
  if (result.error) throw storageError();
  const rows = result.data;
  if (!Array.isArray(rows) || rows.length !== rowIds.length || new Set(rows.map((row) => row.row_id)).size !== rowIds.length
    || rows.some((row) => row.action !== 'exception' || row.status !== 'blocked' || row.reason !== 'archived-only-match'
      || !restoreAccountId(row.salesforce_account_id) || row.raw_row?.restoration?.policyVersion !== CONTACT_RESTORE_POLICY
      || row.raw_row.restoration.eligible !== true || !HASH.test(row.raw_row.restoration.reviewFingerprint || '')
      || restoreAccountId(row.raw_row.restoration.accountId) !== restoreAccountId(row.salesforce_account_id)
      || !restoreUuid(row.xero_contact_id) || restoreUuid(row.xero_contact_id) !== restoreUuid(row.raw_row.restoration.targetContactId))
    || new Set(rows.map((row) => restoreAccountId(row.salesforce_account_id))).size !== rows.length
    || new Set(rows.map((row) => restoreUuid(row.xero_contact_id))).size !== rows.length) throw failure('Select only the exact saved restoration candidates.');
  return { run, rows: rows.sort((a, b) => a.row_id.localeCompare(b.row_id)) };
}

async function verifyLease(client, leaseId) {
  const result = await client.from('xero_contact_lifecycle_locks').select('run_id,locked_until').eq('id', 'primary').maybeSingle();
  if (result.error) throw storageError();
  if (result.data?.run_id !== leaseId || !(Date.parse(result.data.locked_until) > Date.now())) throw failure('The Contact restoration lock expired or changed.', 'XERO_CONTACT_RESTORE_LOCK_LOST');
}

async function readHistory(client, tenantId, contactIds) {
  const events = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from('xero_financial_audit_events').select('id,event_type,outcome,fingerprints')
      .in('event_type', ['contact_restore_intent', 'contact_restore_outcome']).eq('fingerprints->>tenantId', tenantId)
      .in('fingerprints->>contactId', contactIds).order('id').range(offset, offset + 999);
    if (result.error || !Array.isArray(result.data) || result.data.some((event) => event.fingerprints?.tenantId !== tenantId
      || !contactIds.includes(event.fingerprints?.contactId))) throw storageError();
    events.push(...result.data);
    if (events.length > 10000) throw storageError();
    if (result.data.length < 1000) return events;
  }
}

function historyFor(events, contactId) {
  const selected = events.filter((event) => event.fingerprints.contactId === contactId);
  const completed = new Set(selected.filter((event) => event.event_type === 'contact_restore_outcome' && finalStates.has(event.outcome))
    .flatMap((event) => [event.fingerprints.operationId, ...(Array.isArray(event.fingerprints.resolvedOperationIds) ? event.fingerprints.resolvedOperationIds : [])]));
  const intents = selected.filter((event) => event.event_type === 'contact_restore_intent').map((event) => event.fingerprints);
  return { intents, unresolved: intents.filter((intent) => !completed.has(intent.operationId)), completed };
}

async function audit(client, actor, eventType, outcome, evidence, code = null) {
  const result = await client.from('xero_financial_audit_events').insert({ run_id: null, event_type: eventType, outcome,
    actor_id: actor.id, actor_email: actor.email, record_counts: { contacts: 1, financialWrites: 0 }, fingerprints: evidence, error_code: code });
  if (result.error) throw storageError();
}

async function journal(client, row, value) {
  const raw = { ...row.raw_row, restoration: { ...row.raw_row.restoration, journal: value } };
  const result = await client.from('xero_contact_lifecycle_rows').update({ raw_row: raw, idempotency_key: value.idempotencyKey,
    message: value.message || row.message || null }).eq('id', row.id).eq('run_id', row.run_id).eq('row_id', row.row_id).select('id').maybeSingle();
  if (result.error || !result.data) throw storageError();
  row.raw_row = raw;
}

export async function xeroContactRestoreApply(body = {}, {
  accessContext, env = process.env, fetchImpl = fetch, client = xeroContactSyncServiceClient(env),
  connectionReader = getFreshXeroConnection, accountReader = loadAllSalesforceIdentityAccounts,
  contactReader = listXeroContactsForRename, contactDetailReader = readXeroContactForRestoration,
  contactUpdater = restoreXeroContactStatus, lockReader = acquireLifecycleLock, onRestored = null,
} = {}) {
  const actor = { id: restoreUuid(accessContext?.profile?.id), email: String(accessContext?.profile?.email || '').trim().toLowerCase() };
  if (!actor.id || !actor.email || actor.email.length > 320) throw failure('A signed-in Finance manager is required.', 'XERO_CONTACT_RESTORE_ACTOR_REQUIRED', 403);
  requireExternalActionGate('xero_contact_sync', env);
  const rowIds = body.rowIds;
  if (body.reviewed !== true || !restoreUuid(body.runId) || !Array.isArray(rowIds) || !rowIds.length || rowIds.length > 25
    || rowIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200) || new Set(rowIds).size !== rowIds.length) throw failure('Review one to 25 exact saved restoration rows.', 'XERO_CONTACT_RESTORE_SELECTION_INVALID', 400);
  const leaseId = randomUUID(); const lock = await lockReader(client, leaseId, actor, env);
  try {
    const { run, rows } = await loadRows(client, body.runId, rowIds);
    const connection = await connectionReader(client, { env, fetchImpl });
    if (!restoreUuid(connection.tenantId) || connection.tenantId !== run.xero?.tenantId
      || rows.some((row) => row.raw_row.restoration.tenantId !== connection.tenantId)) throw failure('The reviewed Xero organisation changed.', 'XERO_CONTACT_RESTORE_TENANT_CHANGED');
    if (!splitScopes(connection.scope).includes('accounting.contacts')) throw failure('Xero Contact write scope is required.', 'XERO_CONTACT_RESTORE_SCOPE_REQUIRED', 403);
    const [accounts, contacts, history] = await Promise.all([accountReader(), contactReader(connection, { env, fetchImpl }),
      readHistory(client, connection.tenantId, rows.map((row) => restoreUuid(row.xero_contact_id)))]);
    const outcomes = [];
    for (const row of rows) {
      const saved = row.raw_row.restoration; const contactId = restoreUuid(row.xero_contact_id);
      const account = Array.isArray(accounts) ? accounts.find((item) => restoreAccountId(item.id) === restoreAccountId(row.salesforce_account_id)) : null;
      const current = buildContactRestoration(account, accounts, contacts, { tenantId: connection.tenantId, accountsComplete: true, contactsComplete: true });
      const operationId = contactRestoreHash([CONTACT_RESTORE_POLICY, connection.tenantId, run.id, row.row_id, contactId, saved.reviewFingerprint]);
      const evidence = { policyVersion: CONTACT_RESTORE_POLICY, tenantId: connection.tenantId, contactId, accountId: row.salesforce_account_id,
        lifecycleRunId: run.id, rowId: row.row_id, operationId, idempotencyKey: `restore-${operationId.slice(0, 48)}`,
        sourceFingerprint: saved.sourceFingerprint, contactFingerprint: saved.contactFingerprint, reviewFingerprint: saved.reviewFingerprint };
      const previous = historyFor(history, contactId);
      const unfinished = previous.unresolved.length > 0 || ['intent', 'uncertain'].includes(saved.journal?.state);
      let sentIntent = null;
      const diagnostics = { version: 1, post: { attempted: false, http: [], error: null, response: null }, preflight: null, readback: null };
      const finish = async (state, message, extra = {}, code = null, contact = null) => {
        const pendingIntents = sentIntent ? [sentIntent] : previous.unresolved.length ? previous.unresolved
          : Array.isArray(saved.journal?.pendingIntents) ? saved.journal.pendingIntents
            : saved.journal?.state === 'intent' ? [saved.journal] : [];
        const resultEvidence = { ...evidence, ...extra, diagnostics, ...(state === 'uncertain' ? { pendingIntents } : {}) };
        await journal(client, row, { ...resultEvidence, state, message, checkedAt: new Date().toISOString() });
        await audit(client, actor, 'contact_restore_outcome', state, resultEvidence, code);
        const outcome = { rowId: row.row_id, salesforceAccountId: row.salesforce_account_id, xeroContactId: contactId, status: state, message, errorCode: code };
        if (contact && finalStates.has(state) && typeof onRestored === 'function') {
          try { await onRestored({ connection, contact, client }); } catch { outcome.warning = 'The Contact is verified active; the local Contact cache refresh requires another check.'; }
        }
        outcomes.push(outcome);
      };
      if (!current.identityEligible || current.targetContactId !== contactId || current.reviewFingerprint !== saved.reviewFingerprint
        || account?.name !== row.salesforce_name || account?.companyCode !== row.salesforce_cl_key || account?.recordType !== row.salesforce_record_type) {
        await finish(unfinished ? 'uncertain' : 'blocked', current.blockers[0] || 'Source or Contact collision evidence changed after preview.', {}, 'XERO_CONTACT_RESTORE_IDENTITY_CHANGED'); continue;
      }
      let before;
      diagnostics.preflight = { http: [], error: null };
      try { before = await contactDetailReader(connection, contactId, { env, fetchImpl, onResponse: captureHttp(diagnostics.preflight.http) }); } catch (error) {
        diagnostics.preflight.error = safeProviderError(error);
        Object.assign(diagnostics.preflight, readbackFacts(null, contactId, saved.contactFingerprint));
        await finish(unfinished ? 'uncertain' : 'blocked', 'The exact current Contact could not be verified.', {}, 'XERO_CONTACT_RESTORE_DETAIL_INCOMPLETE'); continue;
      }
      Object.assign(diagnostics.preflight, readbackFacts(before, contactId, saved.contactFingerprint));
      const detail = normalizedDetail(before, contactId);
      if (!detail || contactRestoreHash(contactRestoreIdentity(detail)) !== saved.contactFingerprint
        || (current.contactStatus === 'ACTIVE' && detail.status !== 'ACTIVE')) {
        await finish(unfinished ? 'uncertain' : 'blocked', 'The exact Contact is merged, changed, missing or incomplete.', {}, 'XERO_CONTACT_RESTORE_DETAIL_CHANGED'); continue;
      }
      const businessFingerprint = contactRestoreBusinessFingerprint(before);
      if (detail.status === 'ACTIVE') {
        if (previous.unresolved.some((intent) => !HASH.test(intent.businessFingerprint || '') || intent.businessFingerprint !== businessFingerprint
          || intent.contactFingerprint !== saved.contactFingerprint || intent.sourceFingerprint !== saved.sourceFingerprint)) {
          await finish('uncertain', 'An earlier restoration has different or incomplete retained Contact evidence.', {}, 'XERO_CONTACT_RESTORE_OUTCOME_UNCERTAIN'); continue;
        }
        await finish('already_active', 'The exact reviewed Contact is already active; no status update was sent.',
          { businessFingerprint, resolvedOperationIds: previous.unresolved.map((intent) => intent.operationId) }, null, detail); continue;
      }
      const previousJournal = saved.journal;
      if (previous.intents.length || ['intent', 'uncertain', 'restored', 'already_active'].includes(previousJournal?.state)) {
        await finish('uncertain', 'A prior restoration attempt or subsequent archive requires outcome reconciliation; no status update was resent.', {}, 'XERO_CONTACT_RESTORE_OUTCOME_UNCERTAIN'); continue;
      }
      await verifyLease(client, leaseId);
      const intent = { ...evidence, businessFingerprint };
      await audit(client, actor, 'contact_restore_intent', 'intent', intent);
      sentIntent = intent;
      await journal(client, row, { ...intent, state: 'intent', startedAt: new Date().toISOString() });
      history.push({ event_type: 'contact_restore_intent', outcome: 'intent', fingerprints: intent });
      await verifyLease(client, leaseId);
      diagnostics.post.attempted = true;
      try {
        const response = await contactUpdater(connection, contactId, evidence.idempotencyKey, { env, fetchImpl, onResponse: captureHttp(diagnostics.post.http) });
        diagnostics.post.response = postResponseFacts(response, contactId);
      } catch (error) { diagnostics.post.error = safeProviderError(error); }
      let after;
      diagnostics.readback = { http: [], error: null };
      try { after = await contactDetailReader(connection, contactId, { env, fetchImpl, onResponse: captureHttp(diagnostics.readback.http) }); }
      catch (error) { diagnostics.readback.error = safeProviderError(error); }
      Object.assign(diagnostics.readback, readbackFacts(after, contactId, saved.contactFingerprint, businessFingerprint));
      const confirmed = normalizedDetail(after, contactId);
      if (!confirmed || confirmed.status !== 'ACTIVE' || contactRestoreHash(contactRestoreIdentity(confirmed)) !== saved.contactFingerprint
        || contactRestoreBusinessFingerprint(after) !== businessFingerprint) {
        await finish('uncertain', 'The same Contact could not be confirmed active with its original business fields. Inspect the saved outcome before any further operation.',
          { businessFingerprint }, 'XERO_CONTACT_RESTORE_OUTCOME_UNCERTAIN'); continue;
      }
      await finish('restored', 'The same Xero Contact was restored and independently verified; its business details were preserved.',
        { businessFingerprint, afterBusinessFingerprint: contactRestoreBusinessFingerprint(after), resolvedOperationIds: [operationId] }, null, confirmed);
    }
    return { runId: run.id, outcomes, refreshPreview: true, financialWrites: 0, summary: { total: outcomes.length,
      restored: outcomes.filter((row) => row.status === 'restored').length, alreadyActive: outcomes.filter((row) => row.status === 'already_active').length,
      blocked: outcomes.filter((row) => row.status === 'blocked').length, uncertain: outcomes.filter((row) => row.status === 'uncertain').length } };
  } finally { await lock.release(); }
}

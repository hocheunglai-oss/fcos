import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { requireExternalActionGate } from './_externalActionGates.js';
import { serverSupabaseConfig } from './_supabaseConfig.js';
import { sfQuery } from './_salesforce.js';
import { recordSupabaseRequest } from './_requestTelemetry.js';

const SALESFORCE_PRODUCTION_ORG_ID = '00D2x000000Ei4oEAC';
const MAX_JSON_BODY_BYTES = 256 * 1024;
export const XERO_IDENTITY_BASE = 'https://identity.xero.com';
export const XERO_API_BASE = 'https://api.xero.com';
export const XERO_CONTACT_BATCH_SIZE = 50;
const XERO_NAME_MAX_LENGTH = 255;
const SALESFORCE_CL_KEY_PREFIX = 'HK';
const ALLOWED_RECORD_TYPES = ['Buyer', 'Supplier', 'Buyer_Supplier', 'Broker'];
const ALLOWED_SOURCE_FIELDS = {
  Broker_Enquiry__c: ['Buyer__c', 'Broker__c'],
  Opportunity: ['AccountId'],
  Quote: ['AccountId', 'Broker__c', 'Quote_Buyer__c'],
  Supplier_Bid__c: ['Supplier__c', 'Suppliers_Broker__c'],
  STEM__c: ['Account__c', 'Buyer_Broker__c'],
  STEM_Line_Item__c: ['Original_Supplier__c', 'Substitute_Supplier__c', 'Buyers_Broker__c', 'Supplier_Broker__c'],
  STEM_Extra_Cost__c: ['Supplier__c'],
  STEM_Variable_Charge_Supplier__c: ['Supplier__c'],
  STEM_Buyer_Broker__c: ['Buyer_Broker__c'],
  STEM_Payment_Overview__c: ['Account__c'],
  Stem_Status__c: ['Account__c'],
};

export const XERO_CONTACT_SYNC_REASON_LABELS = {
  'blank-salesforce-key': 'Missing Salesforce CL Key',
  'blank-salesforce-name': 'Missing Salesforce Account name',
  'xero-name-too-long': 'Salesforce name is longer than Xero allows',
  'duplicate-salesforce-key': 'Duplicate Salesforce CL Key',
  'duplicate-xero-name': 'Duplicate Xero contact name',
  'ambiguous-xero-name-match': 'Salesforce name and HK-stripped CL Key matched different Xero contacts',
  'missing-xero-contact': 'No Xero contact matched the Salesforce name or HK-stripped CL Key name',
  'archived-only-match': 'Only archived Xero contacts matched',
  'unchanged-name': 'Xero contact already has this name',
  'duplicate-target-name': 'Multiple Salesforce rows propose the same Xero name',
  'target-name-collision': 'Another active Xero contact already uses this name',
  'invalid-account-id': 'Salesforce Account ID is missing or invalid',
  'unsupported-source-field': 'Salesforce source object or Account field is not enabled for auto-create',
  'salesforce-account-not-found': 'Salesforce Account was not found',
  'inactive-salesforce-account': 'Salesforce Account is inactive or suspended',
  'unsupported-salesforce-record-type': 'Salesforce Account record type is not enabled for Xero contacts',
  'non-hk-cl-key': 'Salesforce CL Key does not start with HK',
  'duplicate-create-name': 'Multiple missing Salesforce Accounts would create the same Xero contact name',
  'xero-contact-exists': 'Matching active Xero contact already exists',
  'xero-contact-created': 'Created in Xero',
  'xero-create-failed': 'Xero contact create failed',
  'xero-not-connected': 'Xero is not connected with accounting.contacts',
};

export const XERO_CONTACT_SYNC_MATCH_FIELD_LABELS = {
  SalesforceName: 'Salesforce name',
  ClKeyWithoutHk: 'CL key without HK',
  SalesforceNameAndClKeyWithoutHk: 'Salesforce name + CL key without HK',
};

let cachedSupabaseClient = null;

export function xeroContactSyncError(message, status = 400, code = 'XERO_CONTACT_SYNC_REJECTED', expose = status < 500) {
  return Object.assign(new Error(message), { status, code, expose });
}

export async function readRawRequestBody(req) {
  const contentLength = Number(req?.headers?.['content-length'] || req?.headers?.['Content-Length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw xeroContactSyncError('Salesforce contact sync request is too large.', 413, 'XERO_CONTACT_SYNC_REQUEST_TOO_LARGE');
  }
  if (typeof req?.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_JSON_BODY_BYTES) {
      throw xeroContactSyncError('Salesforce contact sync request is too large.', 413, 'XERO_CONTACT_SYNC_REQUEST_TOO_LARGE');
    }
    return req.body;
  }
  if (req?.body && typeof req.body === 'object') return JSON.stringify(req.body);

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BODY_BYTES) {
      throw xeroContactSyncError('Salesforce contact sync request is too large.', 413, 'XERO_CONTACT_SYNC_REQUEST_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
}

export function verifySalesforceContactSyncRequest({
  headers,
  rawBody,
  env = process.env,
  now = Date.now(),
}) {
  const secret = nonBlank(env.SALESFORCE_CONTACT_SYNC_SECRET || env.XERO_CONTACT_SYNC_SECRET);
  if (!secret) {
    throw xeroContactSyncError('SALESFORCE_CONTACT_SYNC_SECRET is not configured.', 500, 'XERO_CONTACT_SYNC_SECRET_MISSING', true);
  }

  const expectedOrgId = nonBlank(env.SALESFORCE_EXPECTED_ORG_ID || env.SALESFORCE_ORG_ID) || SALESFORCE_PRODUCTION_ORG_ID;
  const maxSkewSeconds = Number(env.SALESFORCE_CONTACT_SYNC_MAX_SKEW_SECONDS || '300');
  const orgId = headerValue(headers, 'x-salesforce-org-id');
  const eventId = headerValue(headers, 'x-salesforce-contact-sync-event-id');
  const timestamp = headerValue(headers, 'x-salesforce-contact-sync-timestamp');
  const signature = normalizeSignature(headerValue(headers, 'x-salesforce-contact-sync-signature'));

  if (!orgId || orgId !== expectedOrgId) {
    throw xeroContactSyncError('Salesforce org ID is not allowed.', 403, 'XERO_CONTACT_SYNC_ORG_MISMATCH');
  }
  if (!eventId) {
    throw xeroContactSyncError('Missing Salesforce contact sync event ID.', 401, 'XERO_CONTACT_SYNC_EVENT_ID_MISSING');
  }
  if (!timestamp || !isFreshTimestamp(timestamp, now, maxSkewSeconds)) {
    throw xeroContactSyncError('Salesforce contact sync timestamp is missing or stale.', 401, 'XERO_CONTACT_SYNC_STALE_TIMESTAMP');
  }

  const expectedSignature = salesforceContactSyncSignature({ secret, timestamp, eventId, rawBody });
  if (!timingSafeHexEqual(signature, expectedSignature)) {
    throw xeroContactSyncError('Salesforce contact sync signature is invalid.', 401, 'XERO_CONTACT_SYNC_INVALID_SIGNATURE');
  }
  return { orgId, eventId, timestamp };
}

export function salesforceContactSyncSignature({ secret, timestamp, eventId, rawBody }) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${eventId}.${rawBody}`)
    .digest('hex');
}

export async function processSalesforceContactSyncWebhook({
  rawBody,
  headers,
  env = process.env,
  now = Date.now(),
  client = null,
  fetchImpl = fetch,
  salesforceAccountLoader = null,
  xeroContactLister = null,
  xeroContactCreator = null,
} = {}) {
  const verified = verifySalesforceContactSyncRequest({ headers, rawBody, env, now });
  const payload = parseJsonPayload(rawBody);
  const bodyEventId = nonBlank(payload.eventId);
  if (bodyEventId && bodyEventId !== verified.eventId) {
    throw xeroContactSyncError('Body eventId does not match the signed event header.', 400, 'XERO_CONTACT_SYNC_EVENT_ID_MISMATCH');
  }

  requireExternalActionGate('xero_contact_sync', env);

  const runId = randomUUID();
  const receivedAt = new Date(now).toISOString();
  const storage = client || xeroContactSyncServiceClient(env);
  await reserveContactSyncEvent(storage, { eventId: verified.eventId, runId, orgId: verified.orgId, receivedAt });

  try {
    const normalizedPayload = normalizeSalesforceContactSyncPayload(payload);
    const requestedAccountIds = [...new Set(normalizedPayload.validSourceRecords.map((record) => record.accountId))];
    const accounts = requestedAccountIds.length
      ? await (salesforceAccountLoader || exportSalesforceAccountsByIds)(requestedAccountIds)
      : [];
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const missingRows = requestedAccountIds
      .filter((accountId) => !accountById.has(accountId))
      .map((accountId) => skippedSourceRow(`account-${accountId}`, {
        accountId,
        sourceRecords: normalizedPayload.sourceRecordsByAccountId.get(accountId) || [],
        reason: 'salesforce-account-not-found',
      }));

    const validAccounts = [];
    const invalidAccountRows = [];
    for (const account of accounts) {
      const validationReason = validateSalesforceAccountForAutoCreate(account);
      if (validationReason) {
        invalidAccountRows.push(accountRow(account, normalizedPayload.sourceRecordsByAccountId, {
          status: 'skipped',
          reason: validationReason,
          message: XERO_CONTACT_SYNC_REASON_LABELS[validationReason],
        }));
      } else {
        validAccounts.push(account);
      }
    }

    let rows = [...normalizedPayload.invalidRows, ...missingRows, ...invalidAccountRows];
    const xero = await xeroAuditStatus(storage, env);

    try {
      if (validAccounts.length > 0) {
        const connection = await getFreshXeroConnection(storage, { env, fetchImpl });
        xero.configured = true;
        xero.connected = true;
        xero.hasContactsScope = splitScopes(connection.scope).includes('accounting.contacts');
        xero.tenantId = connection.tenantId;
        xero.tenantName = connection.tenantName;

        if (!xero.hasContactsScope) {
          rows.push(...xeroUnavailableRows(validAccounts, normalizedPayload.sourceRecordsByAccountId));
        } else {
          const cache = await loadXeroContactNameCache(storage, connection, { env, fetchImpl, xeroContactLister });
          xero.contactCacheCount = cache.contacts.length;
          xero.contactCacheRefreshed = cache.refreshed;
          xero.contactCacheRefreshedAt = cache.refreshedAt;
          xero.estimatedReadCalls = cache.estimatedReadCalls;

          rows.push(...buildContactAutoCreateRows(validAccounts, cache.contacts, normalizedPayload.sourceRecordsByAccountId));
          const createCandidates = rows.filter((row) => row.status === 'pending' && row.salesforceName);
          xero.createCalls = Math.ceil(createCandidates.length / XERO_CONTACT_BATCH_SIZE);
          if (createCandidates.length > 0) {
            const outcomes = await (xeroContactCreator || createXeroContactsBatch)(
              connection,
              createCandidates.map((row) => ({ rowId: row.id, name: row.salesforceName })),
              runId,
              { env, fetchImpl },
            );
            rows = applyCreateOutcomes(rows, outcomes, new Date().toISOString());
            await updateXeroContactNameCacheFromCreatedRows(storage, connection, rows);
          }
        }
      }
    } catch (error) {
      xero.error = error?.message || 'Xero contact sync failed.';
      rows.push(...xeroUnavailableRows(validAccounts, normalizedPayload.sourceRecordsByAccountId, xero.error));
    }

    const run = {
      id: runId,
      event: {
        id: verified.eventId,
        orgId: verified.orgId,
        timestamp: verified.timestamp,
        receivedAt,
        source: nonBlank(payload.source),
        payloadAccountCount: normalizedPayload.payloadAccountCount,
        uniqueAccountCount: requestedAccountIds.length,
      },
      salesforce: {
        requestedAccountIds,
        totalRecords: accounts.length,
      },
      xero,
      rows,
      summary: summarizeContactAutoCreateRows(rows, normalizedPayload.payloadAccountCount, requestedAccountIds.length),
      payload,
    };

    await writeContactSyncRun(storage, run);
    await markContactSyncEvent(storage, verified.eventId, { runId, status: 'processed', updatedAt: new Date().toISOString() });
    return {
      ok: true,
      runId,
      summary: run.summary,
      xero: run.xero,
      rows: rows.map(publicRow),
    };
  } catch (error) {
    await markContactSyncEvent(storage, verified.eventId, {
      runId,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      error: error?.message || 'Xero contact sync failed.',
    }).catch(() => {});
    throw error;
  }
}

export function xeroContactSyncServiceClient(env = process.env) {
  if (cachedSupabaseClient) return cachedSupabaseClient;
  const config = serverSupabaseConfig(env);
  if (!config.configured) {
    throw xeroContactSyncError('FCOS server storage is unavailable.', 503, 'XERO_CONTACT_SYNC_STORAGE_UNAVAILABLE', true);
  }
  cachedSupabaseClient = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const startedAt = Date.now();
        try {
          const response = await fetch(input, init);
          recordSupabaseRequest({ durationMs: Date.now() - startedAt, ok: response.ok });
          return response;
        } catch (error) {
          recordSupabaseRequest({ durationMs: Date.now() - startedAt, ok: false });
          throw error;
        }
      },
    },
  });
  return cachedSupabaseClient;
}

export function normalizeSalesforceContactSyncPayload(payload = {}) {
  const sourceRecordsByAccountId = new Map();
  const validSourceRecords = [];
  const invalidRows = [];
  let payloadAccountCount = 0;

  for (const [index, sourceRecord] of normalizeSourceRecords(payload).entries()) {
    payloadAccountCount += 1;
    const reason = validatePayloadSourceRecord(sourceRecord);
    if (reason) {
      invalidRows.push(skippedSourceRow(`input-${index + 1}`, {
        accountId: sourceRecord.accountId,
        sourceRecords: [sourceRecord],
        reason,
      }));
      continue;
    }
    validSourceRecords.push(sourceRecord);
    const records = sourceRecordsByAccountId.get(sourceRecord.accountId) || [];
    records.push(sourceRecord);
    sourceRecordsByAccountId.set(sourceRecord.accountId, records);
  }

  return { payloadAccountCount, validSourceRecords, invalidRows, sourceRecordsByAccountId };
}

export function buildContactAutoCreateRows(accounts, xeroContacts, sourceRecordsByAccountId = new Map()) {
  const validAccounts = [];
  const invalidRows = [];
  for (const account of accounts) {
    const validationReason = validateSalesforceAccountForAutoCreate(account);
    if (validationReason) {
      invalidRows.push(accountRow(account, sourceRecordsByAccountId, {
        status: 'skipped',
        reason: validationReason,
        message: XERO_CONTACT_SYNC_REASON_LABELS[validationReason],
      }));
      continue;
    }
    validAccounts.push(account);
  }

  const targetNameCounts = countBy(validAccounts, (account) => normalizeName(account.name));
  const renameRows = buildContactRenameRows(validAccounts, xeroContacts);
  const rows = renameRows.map((row) => {
    const baseRow = {
      id: `account-${row.salesforceAccountId}`,
      salesforceAccountId: row.salesforceAccountId,
      salesforceName: row.salesforceName,
      salesforceCompanyCode: row.salesforceCompanyCode,
      salesforceRecordType: row.salesforceRecordType,
      xeroContactId: row.xeroContactId,
      xeroContactName: row.xeroContactName,
      xeroContactNumber: row.xeroContactNumber,
      xeroAccountNumber: row.xeroAccountNumber,
      xeroContactStatus: row.xeroContactStatus,
      matchField: row.matchField,
      sourceRecords: sourceRecordsFor(row.salesforceAccountId, sourceRecordsByAccountId),
    };

    if (row.xeroContactId) {
      return {
        ...baseRow,
        status: 'already-exists',
        reason: 'xero-contact-exists',
        message: `Matching active Xero contact already exists${row.matchField ? ` by ${matchFieldLabel(row.matchField)}` : ''}.`,
      };
    }
    if (row.reason === 'missing-xero-contact') {
      if ((targetNameCounts.get(normalizeName(row.salesforceName)) || 0) > 1) {
        return {
          ...baseRow,
          status: 'skipped',
          reason: 'duplicate-create-name',
          message: XERO_CONTACT_SYNC_REASON_LABELS['duplicate-create-name'],
        };
      }
      return {
        ...baseRow,
        status: 'pending',
        reason: 'missing-xero-contact',
        message: 'Queued to create a new Xero contact from Salesforce Account name.',
      };
    }
    return {
      ...baseRow,
      status: 'skipped',
      reason: row.reason,
      message: row.message || XERO_CONTACT_SYNC_REASON_LABELS[row.reason] || 'Cannot create safely.',
    };
  });

  return [...invalidRows, ...rows].sort(compareContactAutoCreateRows);
}

export function validateSalesforceAccountForAutoCreate(account) {
  if (!isSalesforceAccountId(account?.id)) return 'invalid-account-id';
  const name = trimValue(account?.name);
  if (!name) return 'blank-salesforce-name';
  if (name.length > XERO_NAME_MAX_LENGTH) return 'xero-name-too-long';
  const companyCode = trimValue(account?.companyCode);
  if (!companyCode) return 'blank-salesforce-key';
  if (!normalizeLookupValue(companyCode).startsWith(SALESFORCE_CL_KEY_PREFIX)) return 'non-hk-cl-key';
  if (account?.inactiveSuspended === true) return 'inactive-salesforce-account';
  if (!ALLOWED_RECORD_TYPES.includes(trimValue(account?.recordType))) return 'unsupported-salesforce-record-type';
  return '';
}

export function validateSalesforceContactSource(record) {
  const objectApiName = trimValue(record?.objectApiName);
  const fieldName = trimValue(record?.fieldName);
  if (!objectApiName && !fieldName) return '';
  const allowedFields = ALLOWED_SOURCE_FIELDS[objectApiName];
  return allowedFields?.includes(fieldName) ? '' : 'unsupported-source-field';
}

export function isSalesforceAccountId(value) {
  return /^001[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(trimValue(value));
}

export function summarizeContactAutoCreateRows(rows, totalRequestedAccounts = rows.length, uniqueRequestedAccounts = rows.length) {
  const summary = {
    totalRequestedAccounts,
    uniqueRequestedAccounts,
    created: 0,
    alreadyExists: 0,
    skipped: 0,
    failed: 0,
    pending: 0,
    reasonCounts: {},
  };
  for (const row of rows) {
    if (row.status === 'created') summary.created += 1;
    if (row.status === 'already-exists') summary.alreadyExists += 1;
    if (row.status === 'skipped') summary.skipped += 1;
    if (row.status === 'failed') summary.failed += 1;
    if (row.status === 'pending') summary.pending += 1;
    if (row.reason) summary.reasonCounts[row.reason] = (summary.reasonCounts[row.reason] || 0) + 1;
  }
  return summary;
}

export async function exportSalesforceAccountsByIds(accountIds = []) {
  const uniqueIds = [...new Set(accountIds.map(trimValue).filter(isSalesforceAccountId))];
  const accounts = [];
  for (const chunk of chunkArray(uniqueIds, 100)) {
    const soql = [
      'SELECT Id, Name, Company_Code__c, Inactive_Suspended__c, RecordType.DeveloperName',
      'FROM Account',
      `WHERE Id IN (${chunk.map((id) => `'${id}'`).join(',')})`,
    ].join(' ');
    const result = await sfQuery(soql, { clean: true, limit: chunk.length + 10 });
    accounts.push(...(result.records || []).map(salesforceAccountFromRecord));
  }
  return accounts;
}

async function reserveContactSyncEvent(client, { eventId, runId, orgId, receivedAt }) {
  const { error } = await client.from('xero_contact_sync_events').insert({
    event_id: eventId,
    run_id: runId,
    org_id: orgId,
    status: 'processing',
    received_at: receivedAt,
    updated_at: receivedAt,
  });
  if (error?.code === '23505') {
    throw xeroContactSyncError('Salesforce contact sync event was already processed.', 409, 'XERO_CONTACT_SYNC_DUPLICATE_EVENT');
  }
  if (error) throw error;
}

async function markContactSyncEvent(client, eventId, details) {
  const patch = {
    run_id: details.runId,
    status: details.status,
    updated_at: details.updatedAt,
    error_message: details.error || null,
  };
  const { error } = await client.from('xero_contact_sync_events').update(patch).eq('event_id', eventId);
  if (error) throw error;
}

async function writeContactSyncRun(client, run) {
  const { error: runError } = await client.from('xero_contact_sync_runs').insert({
    id: run.id,
    event_id: run.event.id,
    org_id: run.event.orgId,
    received_at: run.event.receivedAt,
    updated_at: new Date().toISOString(),
    request_payload: run.payload,
    salesforce: run.salesforce,
    xero: run.xero,
    summary: run.summary,
    row_count: run.rows.length,
  });
  if (runError) throw runError;

  if (!run.rows.length) return;
  const { error: rowError } = await client.from('xero_contact_sync_rows').insert(run.rows.map((row, rowIndex) => ({
    run_id: run.id,
    row_index: rowIndex,
    status: row.status,
    reason: row.reason || null,
    salesforce_account_id: row.salesforceAccountId || null,
    salesforce_record_type: row.salesforceRecordType || null,
    salesforce_cl_key: row.salesforceCompanyCode || null,
    salesforce_name: row.salesforceName || null,
    source_records: row.sourceRecords || [],
    xero_contact_id: row.xeroContactId || null,
    xero_contact_name: row.xeroContactName || null,
    xero_contact_number: row.xeroContactNumber || null,
    xero_account_number: row.xeroAccountNumber || null,
    xero_contact_status: row.xeroContactStatus || null,
    match_field: row.matchField || null,
    idempotency_key: row.idempotencyKey || null,
    applied_at: row.appliedAt || null,
    message: row.message || null,
    validation_errors: row.validationErrors || [],
    raw_row: row,
  })));
  if (rowError) throw rowError;
}

async function loadXeroContactNameCache(client, connection, { env, fetchImpl, xeroContactLister }) {
  const { data, error } = await client
    .from('xero_contact_name_cache')
    .select('*')
    .eq('id', 'primary')
    .maybeSingle();
  if (error) throw error;
  const freshMs = Number(env.XERO_CONTACT_AUTO_CREATE_CACHE_FRESH_MINUTES || '1440') * 60 * 1000;
  if (data?.tenant_id === connection.tenantId && isFresh(data.refreshed_at, freshMs) && Array.isArray(data.contacts)) {
    return {
      contacts: data.contacts,
      refreshed: false,
      refreshedAt: data.refreshed_at,
      estimatedReadCalls: 0,
    };
  }

  const contacts = await (xeroContactLister || listXeroContactsForRename)(connection, { env, fetchImpl });
  const refreshedAt = new Date().toISOString();
  const { error: upsertError } = await client.from('xero_contact_name_cache').upsert({
    id: 'primary',
    tenant_id: connection.tenantId,
    tenant_name: connection.tenantName,
    contacts,
    contact_count: contacts.length,
    refreshed_at: refreshedAt,
    updated_at: refreshedAt,
  }, { onConflict: 'id' });
  if (upsertError) throw upsertError;
  return {
    contacts,
    refreshed: true,
    refreshedAt,
    estimatedReadCalls: Math.max(Math.ceil(contacts.length / 100), 1),
  };
}

async function updateXeroContactNameCacheFromCreatedRows(client, connection, rows) {
  const { data, error } = await client
    .from('xero_contact_name_cache')
    .select('*')
    .eq('id', 'primary')
    .maybeSingle();
  if (error) throw error;
  const contactsById = new Map((Array.isArray(data?.contacts) ? data.contacts : []).map((contact) => [contact.contactId, contact]));
  for (const row of rows) {
    if (row.status !== 'created' || !row.xeroContactId || !row.xeroContactName) continue;
    contactsById.set(row.xeroContactId, {
      contactId: row.xeroContactId,
      name: row.xeroContactName,
      contactNumber: row.xeroContactNumber || '',
      accountNumber: row.xeroAccountNumber || '',
      status: row.xeroContactStatus || 'ACTIVE',
    });
  }
  const contacts = [...contactsById.values()];
  const updatedAt = new Date().toISOString();
  const { error: upsertError } = await client.from('xero_contact_name_cache').upsert({
    id: 'primary',
    tenant_id: connection.tenantId,
    tenant_name: connection.tenantName,
    contacts,
    contact_count: contacts.length,
    updated_at: updatedAt,
  }, { onConflict: 'id' });
  if (upsertError) throw upsertError;
}

async function xeroAuditStatus(client, env) {
  let stored = null;
  let config = xeroConfig(env);
  try {
    stored = await readStoredXeroConnection(client);
    config = xeroConfig(env, stored);
  } catch (error) {
    return {
      configured: config.configured,
      connected: false,
      hasContactsScope: splitScopes(env.XERO_SCOPES).includes('accounting.contacts'),
      tenantId: null,
      tenantName: null,
      contactCacheCount: 0,
      contactCacheRefreshed: false,
      contactCacheRefreshedAt: null,
      estimatedReadCalls: 0,
      createCalls: 0,
      error: error?.message || 'Xero connection status could not be read.',
    };
  }
  return {
    configured: config.configured,
    connected: Boolean(stored?.tenantId && (stored?.accessToken || stored?.refreshToken)),
    hasContactsScope: splitScopes(stored?.scope || env.XERO_SCOPES).includes('accounting.contacts'),
    tenantId: stored?.tenantId || env.XERO_TENANT_ID || null,
    tenantName: stored?.tenantName || env.XERO_TENANT_NAME || null,
    contactCacheCount: 0,
    contactCacheRefreshed: false,
    contactCacheRefreshedAt: null,
    estimatedReadCalls: 0,
    createCalls: 0,
    error: null,
  };
}

export async function getFreshXeroConnection(client, { env, fetchImpl }) {
  const stored = await readStoredXeroConnection(client);
  const config = xeroConfig(env, stored);
  if (!config.configured) {
    throw xeroContactSyncError(`Missing Xero configuration: ${config.missing.join(', ')}`, 503, 'XERO_CONTACT_SYNC_XERO_CONFIG_MISSING', true);
  }
  if (stored?.accessToken && stored?.tenantId && Date.parse(stored.expiresAt || '') > Date.now() + 90_000) {
    return stored;
  }

  const token = await requestXeroToken(config, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
  }), fetchImpl);
  const tenant = await resolveXeroTenant({
    accessToken: token.access_token,
    stored,
    env,
    fetchImpl,
  });
  const refreshed = {
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || config.refreshToken,
    expiresAt: new Date(Date.now() + Number(token.expires_in || 1800) * 1000).toISOString(),
    scope: token.scope || stored?.scope || env.XERO_SCOPES || '',
  };
  await writeStoredXeroConnection(client, refreshed);
  return refreshed;
}

export async function readStoredXeroConnection(client) {
  const { data, error } = await client
    .from('xero_contact_sync_connections')
    .select('*')
    .eq('id', 'primary')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    tenantId: data.tenant_id || '',
    tenantName: data.tenant_name || '',
    accessToken: data.access_token || '',
    refreshToken: data.refresh_token || '',
    expiresAt: data.expires_at || '',
    scope: data.scope || '',
  };
}

export async function writeStoredXeroConnection(client, connection) {
  const now = new Date().toISOString();
  const { data: previous, error: previousError } = await client
    .from('xero_contact_sync_connections')
    .select('token_version')
    .eq('id', 'primary')
    .maybeSingle();
  if (previousError) throw previousError;
  const { error } = await client.from('xero_contact_sync_connections').upsert({
    id: 'primary',
    tenant_id: connection.tenantId,
    tenant_name: connection.tenantName,
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expires_at: connection.expiresAt,
    scope: connection.scope,
    token_version: Number(previous?.token_version || 0) + 1,
    updated_at: now,
  }, { onConflict: 'id' });
  if (error) throw error;
}

export function xeroConfig(env, stored = null) {
  const clientId = nonBlank(env.XERO_CLIENT_ID);
  const clientSecret = nonBlank(env.XERO_CLIENT_SECRET);
  const refreshToken = nonBlank(stored?.refreshToken || env.XERO_REFRESH_TOKEN);
  const missing = [
    ...(!clientId ? ['XERO_CLIENT_ID'] : []),
    ...(!clientSecret ? ['XERO_CLIENT_SECRET'] : []),
    ...(!refreshToken ? ['XERO_REFRESH_TOKEN or stored Xero refresh token'] : []),
  ];
  return { clientId, clientSecret, refreshToken, configured: missing.length === 0, missing };
}

export async function requestXeroToken(config, body, fetchImpl) {
  const response = await fetchImpl(`${XERO_IDENTITY_BASE}/connect/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!response.ok) throw xeroContactSyncError(await formatXeroError(response), response.status || 502, 'XERO_CONTACT_SYNC_TOKEN_FAILED');
  return response.json();
}

export async function resolveXeroTenant({ accessToken, stored, env, fetchImpl }) {
  const expectedTenantId = nonBlank(stored?.tenantId || env.XERO_TENANT_ID);
  const expectedTenantName = nonBlank(stored?.tenantName || env.XERO_TENANT_NAME);
  if (expectedTenantId) return { tenantId: expectedTenantId, tenantName: expectedTenantName };

  const response = await fetchImpl(`${XERO_API_BASE}/connections`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) throw xeroContactSyncError(await formatXeroError(response), response.status || 502, 'XERO_CONTACT_SYNC_TENANT_FAILED');
  const tenants = await response.json();
  const tenant = Array.isArray(tenants) ? tenants[0] : null;
  if (!tenant?.tenantId) throw xeroContactSyncError('Xero did not return an organisation connection.', 503, 'XERO_CONTACT_SYNC_TENANT_MISSING', true);
  return { tenantId: tenant.tenantId, tenantName: tenant.tenantName || '' };
}

export async function listXeroContactsForRename(connection, { env, fetchImpl }) {
  const contacts = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ includeArchived: 'true', page: String(page), pageSize: '100' });
    const response = await xeroAccountingFetch(connection, `/Contacts?${params}`, {
      method: 'GET',
      retryOnRateLimit: true,
      env,
      fetchImpl,
    });
    const pageContacts = Array.isArray(response.Contacts) ? response.Contacts : [];
    contacts.push(...pageContacts.filter((contact) => contact.ContactID).map(toXeroContactForRename));
    const pageCount = Number(response.pagination?.pageCount || 0);
    if ((pageCount && page >= pageCount) || pageContacts.length < 100) break;
    page += 1;
    await sleep(xeroContactSyncDelayMs(env));
  }
  return contacts;
}

export async function createXeroContactsBatch(connection, contacts, runId, { env = process.env, fetchImpl = fetch } = {}) {
  const outcomes = [];
  for (let index = 0; index < contacts.length; index += XERO_CONTACT_BATCH_SIZE) {
    const chunk = contacts.slice(index, index + XERO_CONTACT_BATCH_SIZE);
    const chunkNumber = Math.floor(index / XERO_CONTACT_BATCH_SIZE) + 1;
    const idempotencyKey = `${runId}-create-${chunkNumber}`;
    try {
      const response = await xeroAccountingFetch(connection, '/Contacts?summarizeErrors=false', {
        method: 'POST',
        body: { Contacts: chunk.map((contact) => ({ Name: contact.name })) },
        idempotencyKey,
        retryOnRateLimit: true,
        env,
        fetchImpl,
      });
      const responseContacts = Array.isArray(response.Contacts) ? response.Contacts : [];
      for (const [chunkIndex, input] of chunk.entries()) {
        const contact = responseContacts[chunkIndex] || responseContacts.find((candidate) => candidate.Name === input.name);
        const errors = (contact?.ValidationErrors || []).map((error) => error.Message).filter(Boolean);
        outcomes.push({
          rowId: input.rowId,
          contactId: contact?.ContactID,
          success: Boolean(contact?.ContactID && contact.HasValidationErrors !== true && errors.length === 0),
          name: contact?.Name,
          contactStatus: contact?.ContactStatus,
          idempotencyKey,
          errors: contact ? errors : ['Xero did not return this contact in the create response.'],
        });
      }
    } catch (error) {
      outcomes.push(...chunk.map((contact) => ({
        rowId: contact.rowId,
        success: false,
        idempotencyKey,
        errors: [error?.message || 'Xero contact create failed.'],
      })));
    }
    if (index + XERO_CONTACT_BATCH_SIZE < contacts.length) await sleep(xeroContactSyncDelayMs(env));
  }
  return outcomes;
}

export async function xeroAccountingFetch(connection, pathName, { method, body, idempotencyKey, retryOnRateLimit = false, env, fetchImpl, headers: extraHeaders = {}, onResponse = null }) {
  const headers = {
    Authorization: `Bearer ${connection.accessToken}`,
    'xero-tenant-id': connection.tenantId,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extraHeaders,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
  const requestMethod = String(method || 'GET').toUpperCase();
  const transientRetryLimit = requestMethod === 'GET' ? xeroTransientRetryLimit(env) : 0;
  let transientRetries = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`${XERO_API_BASE}/api.xro/2.0${pathName}`, {
        method: requestMethod,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (transientRetries < transientRetryLimit && attempt < 3) {
        await sleep(xeroTransientRetryDelayMs(env, transientRetries));
        transientRetries += 1;
        continue;
      }
      throw xeroContactSyncError(
        error?.message || 'Xero could not be reached.',
        502,
        'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED',
      );
    }
    if (typeof onResponse === 'function') {
      onResponse({
        status: response.status,
        headers: response.headers,
        pathName,
        method: requestMethod,
      });
    }
    if (response.status === 429 && retryOnRateLimit && attempt < 3) {
      const delay = retryDelayMs(response.headers?.get?.('Retry-After'), attempt);
      if (isDailyRateLimit(response) || delay > xeroMaxRetryAfterMs(env)) {
        throw xeroContactSyncError(await formatXeroError(response), response.status, 'XERO_CONTACT_SYNC_RATE_LIMITED');
      }
      await sleep(delay);
      continue;
    }
    if ([502, 503, 504].includes(response.status) && transientRetries < transientRetryLimit && attempt < 3) {
      await response.text().catch(() => '');
      await sleep(xeroTransientRetryDelayMs(env, transientRetries));
      transientRetries += 1;
      continue;
    }
    if (!response.ok) {
      throw xeroContactSyncError(await formatXeroError(response), response.status || 502, 'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED');
    }
    return response.json();
  }
  throw xeroContactSyncError('Xero rate limit retry was exhausted.', 429, 'XERO_CONTACT_SYNC_RATE_LIMIT_RETRY_EXHAUSTED');
}

function applyCreateOutcomes(rows, outcomes, appliedAt) {
  const outcomeByRowId = new Map(outcomes.map((outcome) => [outcome.rowId, outcome]));
  return rows.map((row) => {
    if (row.status !== 'pending') return row;
    const outcome = outcomeByRowId.get(row.id);
    if (outcome?.success) {
      return {
        ...row,
        status: 'created',
        reason: 'xero-contact-created',
        xeroContactId: outcome.contactId,
        xeroContactName: outcome.name || row.salesforceName,
        xeroContactStatus: outcome.contactStatus || 'ACTIVE',
        idempotencyKey: outcome.idempotencyKey,
        appliedAt,
        message: 'Created in Xero from Salesforce Account name.',
        validationErrors: [],
      };
    }
    return {
      ...row,
      status: 'failed',
      reason: 'xero-create-failed',
      idempotencyKey: outcome?.idempotencyKey,
      appliedAt,
      message: XERO_CONTACT_SYNC_REASON_LABELS['xero-create-failed'],
      validationErrors: outcome?.errors?.length ? outcome.errors : ['Xero contact create failed.'],
    };
  });
}

export function buildContactRenameRows(salesforceAccounts, xeroContacts) {
  const salesforceKeyCounts = countBy(salesforceAccounts, (account) => normalizeLookupValue(account.companyCode));
  const targetNameCounts = countBy(salesforceAccounts, (account) => normalizeName(account.name));
  const xeroByName = indexXeroContactsByName(xeroContacts);
  const activeXeroNames = indexActiveXeroNames(xeroContacts);

  return salesforceAccounts.map((account) => {
    const salesforceCompanyCode = trimValue(account.companyCode);
    const salesforceName = trimValue(account.name);
    const normalizedKey = normalizeLookupValue(salesforceCompanyCode);
    const normalizedTargetName = normalizeName(salesforceName);
    const baseRow = {
      id: account.id,
      salesforceAccountId: account.id,
      salesforceName,
      salesforceCompanyCode,
      salesforceRecordType: trimValue(account.recordType),
      proposedName: salesforceName,
      status: 'skipped',
    };
    if (!salesforceCompanyCode) return skipped(baseRow, 'blank-salesforce-key');
    if (!salesforceName) return skipped(baseRow, 'blank-salesforce-name');
    if (salesforceName.length > XERO_NAME_MAX_LENGTH) return skipped(baseRow, 'xero-name-too-long');
    if ((salesforceKeyCounts.get(normalizedKey) || 0) > 1) return skipped(baseRow, 'duplicate-salesforce-key');

    const clKeyNameMatchKey = hkStrippedClKeyNameMatchKey(salesforceCompanyCode);
    const match = chooseXeroNameMatch(
      xeroByName.get(normalizedTargetName) || [],
      clKeyNameMatchKey ? xeroByName.get(clKeyNameMatchKey) || [] : [],
    );
    if (match.reason) return skipped(baseRow, match.reason);

    const xeroContact = match.contact;
    const matchedRow = {
      ...baseRow,
      xeroContactId: xeroContact.contactId,
      xeroContactName: xeroContact.name,
      xeroContactNumber: xeroContact.contactNumber,
      xeroAccountNumber: xeroContact.accountNumber,
      xeroContactStatus: xeroContact.status,
      matchField: match.field,
    };
    if (normalizeName(xeroContact.name) === normalizedTargetName) return skipped(matchedRow, 'unchanged-name');
    if ((targetNameCounts.get(normalizedTargetName) || 0) > 1) return skipped(matchedRow, 'duplicate-target-name');
    const collision = (activeXeroNames.get(normalizedTargetName) || []).some((contact) => contact.contactId !== xeroContact.contactId);
    if (collision) return skipped(matchedRow, 'target-name-collision');
    return { ...matchedRow, status: 'eligible', message: 'Ready to update.' };
  });
}

function chooseXeroNameMatch(salesforceNameMatches, clKeyNameMatches) {
  const ruleMatches = [
    { field: 'SalesforceName', matches: salesforceNameMatches },
    { field: 'ClKeyWithoutHk', matches: clKeyNameMatches },
  ];
  const activeByContactId = new Map();
  let hasAnyMatch = false;
  for (const ruleMatch of ruleMatches) {
    if (ruleMatch.matches.length > 0) hasAnyMatch = true;
    const activeMatches = ruleMatch.matches.filter(isActive);
    if (activeMatches.length > 1) return { reason: 'duplicate-xero-name' };
    if (activeMatches.length === 1) {
      const contact = activeMatches[0];
      const existing = activeByContactId.get(contact.contactId) || { contact, fields: new Set() };
      existing.fields.add(ruleMatch.field);
      activeByContactId.set(contact.contactId, existing);
    }
  }
  if (activeByContactId.size > 1) return { reason: 'ambiguous-xero-name-match' };
  if (activeByContactId.size === 1) {
    const [{ contact, fields }] = [...activeByContactId.values()];
    const field = fields.has('SalesforceName') && fields.has('ClKeyWithoutHk')
      ? 'SalesforceNameAndClKeyWithoutHk'
      : [...fields][0];
    return { contact, field };
  }
  return hasAnyMatch ? { reason: 'archived-only-match' } : { reason: 'missing-xero-contact' };
}

function normalizeSourceRecords(payload) {
  const records = Array.isArray(payload.records)
    ? payload.records
    : Array.isArray(payload.sourceRecords)
      ? payload.sourceRecords
      : [];
  const sourceRecords = records.map((record) => {
    const source = objectValue(record);
    return {
      objectApiName: trimValue(source.objectApiName || source.objectName || source.sobjectType),
      recordId: trimValue(source.recordId || source.id || source.sourceRecordId),
      fieldName: trimValue(source.fieldName || source.field),
      accountId: trimValue(source.accountId || source.salesforceAccountId || source.value),
      operation: trimValue(source.operation || source.changeType),
    };
  });
  if (Array.isArray(payload.accountIds)) {
    for (const accountId of payload.accountIds) {
      sourceRecords.push({
        objectApiName: 'Account',
        recordId: '',
        fieldName: 'Id',
        accountId: trimValue(accountId),
        operation: 'direct',
      });
    }
  }
  return sourceRecords;
}

function validatePayloadSourceRecord(record) {
  if (!isSalesforceAccountId(record.accountId)) return 'invalid-account-id';
  if (record.objectApiName === 'Account' && record.fieldName === 'Id') return '';
  return validateSalesforceContactSource(record);
}

function skippedSourceRow(id, { accountId, sourceRecords, reason }) {
  return {
    id,
    status: 'skipped',
    reason,
    message: XERO_CONTACT_SYNC_REASON_LABELS[reason] || reason,
    salesforceAccountId: accountId,
    sourceRecords,
  };
}

function xeroUnavailableRows(accounts, sourceRecordsByAccountId, message = null) {
  return buildContactAutoCreateRows(accounts, [], sourceRecordsByAccountId).map((row) => {
    if (row.status !== 'pending') return row;
    return {
      ...row,
      status: 'failed',
      reason: 'xero-not-connected',
      message: message || XERO_CONTACT_SYNC_REASON_LABELS['xero-not-connected'],
      validationErrors: message ? [message] : [],
    };
  });
}

function accountRow(account, sourceRecordsByAccountId, overrides) {
  return {
    id: `account-${trimValue(account.id) || safeToken(account.name)}`,
    salesforceAccountId: trimValue(account.id),
    salesforceName: trimValue(account.name),
    salesforceCompanyCode: trimValue(account.companyCode),
    salesforceRecordType: trimValue(account.recordType),
    sourceRecords: sourceRecordsFor(account.id, sourceRecordsByAccountId),
    ...overrides,
  };
}

function skipped(row, reason) {
  return { ...row, status: 'skipped', reason, message: XERO_CONTACT_SYNC_REASON_LABELS[reason] || reason };
}

function sourceRecordsFor(accountId, sourceRecordsByAccountId) {
  const key = trimValue(accountId);
  if (!key) return [];
  if (sourceRecordsByAccountId instanceof Map) return sourceRecordsByAccountId.get(key) || [];
  return sourceRecordsByAccountId?.[key] || [];
}

function publicRow(row) {
  return {
    status: row.status,
    reason: row.reason,
    salesforceAccountId: row.salesforceAccountId,
    salesforceName: row.salesforceName,
    salesforceCompanyCode: row.salesforceCompanyCode,
    xeroContactId: row.xeroContactId,
    xeroContactName: row.xeroContactName,
    matchField: row.matchField,
    message: row.message,
  };
}

function salesforceAccountFromRecord(record) {
  return {
    id: trimValue(record.Id),
    name: trimValue(record.Name),
    companyCode: trimValue(record.Company_Code__c),
    recordType: trimValue(record['RecordType.DeveloperName'] || record.RecordType?.DeveloperName),
    inactiveSuspended: record.Inactive_Suspended__c === true,
  };
}

function toXeroContactForRename(contact) {
  return {
    contactId: trimValue(contact.ContactID),
    name: trimValue(contact.Name),
    contactNumber: trimValue(contact.ContactNumber),
    accountNumber: trimValue(contact.AccountNumber),
    status: trimValue(contact.ContactStatus),
  };
}

function parseJsonPayload(rawBody) {
  try {
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw xeroContactSyncError('Salesforce contact sync request body must be valid JSON.', 400, 'XERO_CONTACT_SYNC_INVALID_JSON');
  }
}

function headerValue(headers, key) {
  if (typeof headers?.get === 'function') return trimValue(headers.get(key));
  return trimValue(headers?.[key] ?? headers?.[key.toLowerCase()] ?? headers?.[key.toUpperCase()]);
}

function normalizeSignature(value) {
  return trimValue(value).replace(/^sha256=/i, '').toLowerCase();
}

function isFreshTimestamp(value, now, maxSkewSeconds) {
  const parsed = Number(value);
  const timestampMs = Number.isFinite(parsed) && parsed > 100_000_000_000
    ? parsed
    : Number.isFinite(parsed) && parsed > 1_000_000_000
      ? parsed * 1000
      : Date.parse(value);
  return Number.isFinite(timestampMs) && Math.abs(now - timestampMs) <= maxSkewSeconds * 1000;
}

function timingSafeHexEqual(actual, expected) {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export function hkStrippedClKeyNameMatchKey(salesforceCompanyCode) {
  const value = trimValue(salesforceCompanyCode);
  if (value.slice(0, SALESFORCE_CL_KEY_PREFIX.length).toUpperCase() !== SALESFORCE_CL_KEY_PREFIX) return '';
  return normalizeName(value.slice(SALESFORCE_CL_KEY_PREFIX.length));
}

export function normalizeLookupValue(value) {
  return trimValue(value).replace(/\s+/g, ' ').toUpperCase();
}

export function normalizeName(value) {
  return trimValue(value).replace(/\s+/g, ' ').toUpperCase();
}

function indexXeroContactsByName(contacts) {
  const byName = new Map();
  for (const contact of contacts) {
    const key = normalizeName(contact.name);
    if (!key) continue;
    const matches = byName.get(key) || [];
    matches.push(contact);
    byName.set(key, matches);
  }
  return byName;
}

function indexActiveXeroNames(contacts) {
  const byName = new Map();
  for (const contact of contacts) {
    if (!isActive(contact)) continue;
    const key = normalizeName(contact.name);
    if (!key) continue;
    const matches = byName.get(key) || [];
    matches.push(contact);
    byName.set(key, matches);
  }
  return byName;
}

function isActive(contact) {
  return normalizeLookupValue(contact?.status) === 'ACTIVE';
}

function matchFieldLabel(field) {
  return XERO_CONTACT_SYNC_MATCH_FIELD_LABELS[field] || field || '';
}

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function compareContactAutoCreateRows(first, second) {
  const statusOrder = { pending: 0, failed: 1, skipped: 2, 'already-exists': 3, created: 4 };
  const statusDifference = statusOrder[first.status] - statusOrder[second.status];
  if (statusDifference !== 0) return statusDifference;
  return normalizeName(first.salesforceName || first.xeroContactName).localeCompare(
    normalizeName(second.salesforceName || second.xeroContactName),
  );
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function splitScopes(scope) {
  return trimValue(scope).split(/\s+/).filter(Boolean);
}

function isFresh(updatedAt, freshMs) {
  const updatedMs = Date.parse(updatedAt);
  return Number.isFinite(updatedMs) && Date.now() - updatedMs <= freshMs;
}

function retryDelayMs(value, attempt) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return Math.min(2 ** attempt * 1000, 8000);
}

function isDailyRateLimit(response) {
  return /daily|day/i.test(String(response.headers?.get?.('x-rate-limit-problem') || ''));
}

function xeroContactSyncDelayMs(env) {
  return Number(env.XERO_CONTACT_SYNC_DELAY_MS || '1100');
}

function xeroMaxRetryAfterMs(env) {
  return Number(env.XERO_MAX_RETRY_AFTER_MS || '60000');
}

function xeroTransientRetryLimit(env) {
  const configured = Number(env?.XERO_TRANSIENT_RETRY_LIMIT ?? '2');
  if (!Number.isFinite(configured)) return 2;
  return Math.max(0, Math.min(Math.trunc(configured), 2));
}

function xeroTransientRetryDelayMs(env, attempt) {
  const configured = Number(env?.XERO_TRANSIENT_RETRY_DELAY_MS ?? '500');
  const base = Number.isFinite(configured) ? Math.max(0, Math.min(configured, 5000)) : 500;
  return Math.min(base * (2 ** attempt), 5000);
}

async function formatXeroError(response) {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text);
    return parsed.Message || parsed.message || parsed.error_description || parsed.error || text || `Xero request failed with status ${response.status}.`;
  } catch {
    return text || `Xero request failed with status ${response.status}.`;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function objectValue(value) {
  return value && typeof value === 'object' ? value : {};
}

function nonBlank(value) {
  return String(value || '').trim();
}

function trimValue(value) {
  return String(value ?? '').trim();
}

function safeToken(value) {
  return trimValue(value).replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 64) || 'unknown';
}

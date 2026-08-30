import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  XERO_API_BASE,
  XERO_CONTACT_BATCH_SIZE,
  XERO_CONTACT_SYNC_MATCH_FIELD_LABELS,
  XERO_CONTACT_SYNC_REASON_LABELS,
  buildContactRenameRows,
  getFreshXeroConnection,
  hkStrippedClKeyNameMatchKey,
  normalizeName,
  readStoredXeroConnection,
  requestXeroToken,
  resolveXeroTenant,
  splitScopes,
  writeStoredXeroConnection,
  xeroAccountingFetch,
  xeroContactSyncError,
  xeroContactSyncServiceClient,
} from './_xeroContactSync.js';
import { getInstanceUrl, salesforceAuthMode, sfCompositeQueries, sfQuery } from './_salesforce.js';
import { externalActionGates, requireExternalActionGate } from './_externalActionGates.js';

const AUTHORIZATION_BASE = 'https://login.xero.com';
const RECEIPT_BUCKET = 'xero-portal-receipts';
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const DEFAULT_RECENT_STEM_DELIVERY_FROM = '2025-01-01';
const DEFAULT_XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.invoices',
  'accounting.payments',
  'accounting.banktransactions.read',
  'accounting.settings.read',
  'accounting.attachments',
  'accounting.contacts',
].join(' ');

export const CONTACT_LIFECYCLE_REASON_LABELS = {
  ...XERO_CONTACT_SYNC_REASON_LABELS,
  'unused-unmatched-xero-contact': 'Unused Xero contact has no Salesforce match',
  'used-unmatched-xero-contact': 'Used Xero contact has no Salesforce match',
  'nonzero-balance': 'Xero contact has a nonzero balance',
  'ambiguous-salesforce-match': 'Xero contact is protected by an ambiguous Salesforce match',
  'already-archived': 'Xero contact is already archived',
  'blocked-scope': 'Xero scope cannot read this usage source',
  'usage-scan-incomplete': 'Readable Xero usage scan is incomplete',
  'stale-preview': 'Xero contact changed after preview',
  'not-selected': 'Eligible row was not selected for apply',
};

export const CONTACT_LIFECYCLE_STATUS_LABELS = {
  eligible: 'Safe to apply after review and selection.',
  blocked: 'Cannot be applied automatically; review the reason and map or correct the data first.',
  kept: 'No Xero mutation is needed; the contact remains active.',
  'not-selected': 'The row was eligible in preview but was not selected in the apply step.',
  updated: 'The selected Xero contact rename was applied.',
  archived: 'The selected Xero contact was archived in Xero.',
  failed: 'The row was selected but Xero or validation rejected the mutation.',
};

const READABLE_USAGE_SOURCES = [
  { source: 'invoices', label: 'Invoices, bills, and credit notes', pathName: '/Invoices', collection: 'Invoices' },
  { source: 'bank-transactions', label: 'Bank transactions', pathName: '/BankTransactions', collection: 'BankTransactions' },
  { source: 'payments', label: 'Payments', pathName: '/Payments', collection: 'Payments' },
  { source: 'overpayments', label: 'Overpayments', pathName: '/Overpayments', collection: 'Overpayments' },
  { source: 'prepayments', label: 'Prepayments', pathName: '/Prepayments', collection: 'Prepayments' },
  { source: 'expense-claims', label: 'Expense claims', pathName: '/ExpenseClaims', collection: 'Invoices', blocked: true },
  { source: 'receipts', label: 'Receipts', pathName: '/Receipts', collection: 'Invoices', blocked: true },
];

export function signXeroOAuthState(payload, env = process.env) {
  const statePayload = {
    issuedAt: new Date().toISOString(),
    nonce: randomUUID(),
    ...objectValue(payload),
  };
  const encoded = base64UrlEncode(JSON.stringify(statePayload));
  const signature = createHmac('sha256', oauthStateSecret(env)).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyXeroOAuthState(state, env = process.env, now = Date.now()) {
  const [encoded, signature] = String(state || '').split('.');
  if (!encoded || !signature) throw portalError('Xero connection state is missing or invalid.', 401, 'XERO_PORTAL_INVALID_STATE');
  const expected = createHmac('sha256', oauthStateSecret(env)).update(encoded).digest('base64url');
  if (!timingSafeStringEqual(signature, expected)) {
    throw portalError('Xero connection state signature is invalid.', 401, 'XERO_PORTAL_INVALID_STATE');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw portalError('Xero connection state cannot be decoded.', 401, 'XERO_PORTAL_INVALID_STATE');
  }
  const issuedMs = Date.parse(payload.issuedAt);
  const maxAgeMs = Number(env.XERO_OAUTH_STATE_MAX_AGE_SECONDS || '900') * 1000;
  if (!Number.isFinite(issuedMs) || now - issuedMs < 0 || now - issuedMs > maxAgeMs) {
    throw portalError('Xero connection state has expired. Start Connect Xero again.', 401, 'XERO_PORTAL_EXPIRED_STATE');
  }
  return payload;
}

export async function xeroPortalStatus(body = {}, { req = null, env = process.env, fetchImpl = fetch, client = xeroContactSyncServiceClient(env) } = {}) {
  const [xero, usageCache, latestLifecycleRun, latestAutoCreateRun] = await Promise.all([
    readXeroPublicStatus(client, { env, fetchImpl, refresh: body.forceRefresh === true }),
    loadUsageCacheSummary(client),
    latestLifecycleRunSummary(client),
    latestAutoCreateRunSummary(client),
  ]);
  return {
    xero: {
      ...xero,
      redirectUri: xeroPortalConfig(env, req).redirectUri,
    },
    salesforce: {
      authMode: salesforceAuthMode(),
      instanceUrl: getInstanceUrl(),
      recentStemDeliveryFrom: recentStemDeliveryFrom(env),
      clKeyPrefix: 'HK',
      accountRecordTypes: ['Buyer', 'Supplier', 'Buyer_Supplier', 'Broker'],
    },
    externalActions: externalActionGates(env),
    usageCache,
    latestLifecycleRun,
    latestAutoCreateRun,
    statusLabels: CONTACT_LIFECYCLE_STATUS_LABELS,
    reasonLabels: CONTACT_LIFECYCLE_REASON_LABELS,
    matchFieldLabels: XERO_CONTACT_SYNC_MATCH_FIELD_LABELS,
  };
}

export async function xeroPortalConnectStart(body = {}, { req = null, env = process.env } = {}) {
  const config = xeroPortalConfig(env, req);
  if (!config.configured) {
    throw portalError(`Missing Xero credentials: ${config.missing.join(', ')}`, 503, 'XERO_PORTAL_XERO_CONFIG_MISSING');
  }
  const returnPath = String(body.returnPath || '/xero-portal').startsWith('/') ? String(body.returnPath || '/xero-portal') : '/xero-portal';
  const state = signXeroOAuthState({ redirectUri: config.redirectUri, returnPath }, env);
  const url = new URL('/identity/connect/authorize', AUTHORIZATION_BASE);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', state);
  return {
    authorizationUrl: url.toString(),
    redirectUri: config.redirectUri,
    scopes: splitScopes(config.scopes),
  };
}

export async function exchangeXeroAuthorizationCode({ code, state, req = null, env = process.env, fetchImpl = fetch } = {}) {
  if (!nonBlank(code)) throw portalError('Xero did not return an authorization code.', 400, 'XERO_PORTAL_AUTH_CODE_MISSING');
  const payload = verifyXeroOAuthState(state, env);
  const config = xeroPortalConfig(env, req, payload.redirectUri);
  if (!config.configured) {
    throw portalError(`Missing Xero credentials: ${config.missing.join(', ')}`, 503, 'XERO_PORTAL_XERO_CONFIG_MISSING');
  }
  const token = await requestXeroToken(config, new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: config.redirectUri,
  }), fetchImpl);
  const tenant = await resolveXeroTenant({
    accessToken: token.access_token,
    stored: null,
    env,
    fetchImpl,
  });
  if (!token.refresh_token) {
    throw portalError('Xero did not return a refresh token. Confirm offline_access is included and reconnect.', 502, 'XERO_PORTAL_REFRESH_TOKEN_MISSING');
  }
  const client = xeroContactSyncServiceClient(env);
  const connection = {
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + Number(token.expires_in || 1800) * 1000).toISOString(),
    scope: token.scope || config.scopes,
  };
  await writeStoredXeroConnection(client, connection);
  return {
    tenant,
    returnPath: String(payload.returnPath || '/xero-portal').startsWith('/') ? String(payload.returnPath || '/xero-portal') : '/xero-portal',
  };
}

export async function xeroPortalDisconnect(_body = {}, { env = process.env } = {}) {
  const client = xeroContactSyncServiceClient(env);
  const { error } = await client.from('xero_contact_sync_connections').delete().eq('id', 'primary');
  if (error) throw storageError(error, 'xero_contact_sync_connections');
  return { ok: true };
}

export async function xeroPortalReceiptsList(body = {}, { env = process.env } = {}) {
  const client = xeroContactSyncServiceClient(env);
  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);
  const { data, error } = await client
    .from('xero_portal_receipts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw storageError(error, 'xero_portal_receipts');
  return { receipts: (data || []).map(serializeReceipt) };
}

export async function xeroPortalReceiptCreate(body = {}, { accessContext = null, env = process.env, fetchImpl = fetch } = {}) {
  const client = xeroContactSyncServiceClient(env);
  const file = decodeReceiptFile(body.file);
  const fields = normalizeReceiptFields(body.fields || body);
  const id = randomUUID();
  const now = new Date().toISOString();
  const fileName = sanitizeFileName(file.fileName || `receipt-${id}`);
  const storagePath = `${new Date().toISOString().slice(0, 10)}/${id}-${fileName}`;
  const upload = await client.storage.from(RECEIPT_BUCKET).upload(storagePath, file.buffer, {
    contentType: file.fileType,
    upsert: false,
  });
  if (upload.error) throw storageError(upload.error, RECEIPT_BUCKET);

  const row = {
    id,
    created_by: accessContext?.profile?.id || null,
    created_by_email: accessContext?.profile?.email || null,
    merchant: fields.merchant || 'Unknown supplier',
    receipt_date: fields.date || now.slice(0, 10),
    total: numberOrNull(fields.total),
    currency: fields.currency || 'HKD',
    category: fields.category || 'General expense',
    account_code: fields.accountCode || '429',
    tax_type: fields.taxType || 'NONE',
    note: fields.note || '',
    ocr_text: fields.ocrText || '',
    file_name: fileName,
    file_type: file.fileType,
    file_size_bytes: file.buffer.length,
    storage_bucket: RECEIPT_BUCKET,
    storage_path: storagePath,
    status: 'draft',
    auto_synced: body.autoSync === true,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await client.from('xero_portal_receipts').insert(row).select('*').single();
  if (error) throw storageError(error, 'xero_portal_receipts');
  if (body.autoSync === true) return xeroPortalReceiptSync({ id }, { accessContext, env, fetchImpl });
  return { receipt: serializeReceipt(data) };
}

export async function xeroPortalReceiptFileUrl(body = {}, { env = process.env } = {}) {
  const client = xeroContactSyncServiceClient(env);
  const receipt = await loadReceipt(client, body.id);
  const { data, error } = await client.storage.from(RECEIPT_BUCKET).createSignedUrl(receipt.storage_path, 300);
  if (error) throw storageError(error, RECEIPT_BUCKET);
  return { url: data?.signedUrl || null, fileName: receipt.file_name, fileType: receipt.file_type };
}

export async function xeroPortalReceiptSync(body = {}, { env = process.env, fetchImpl = fetch } = {}) {
  requireExternalActionGate('xero_contact_sync', env);
  const client = xeroContactSyncServiceClient(env);
  const receipt = await loadReceipt(client, body.id);
  if (receipt.status === 'synced' && receipt.xero_invoice_id) return { receipt: serializeReceipt(receipt) };
  if (!numberOrNull(receipt.total) || Number(receipt.total) <= 0) {
    throw portalError('Receipt total is required before creating a Xero draft bill.', 400, 'XERO_PORTAL_RECEIPT_TOTAL_REQUIRED');
  }

  await updateReceipt(client, receipt.id, { status: 'syncing', error_message: null });
  let invoiceId = receipt.xero_invoice_id || '';
  try {
    const connection = await getFreshXeroConnection(client, { env, fetchImpl });
    assertXeroScopes(connection, ['accounting.invoices', 'accounting.attachments'], 'Receipt sync');
    const invoice = await createDraftBill(connection, receipt, { env, fetchImpl });
    invoiceId = invoice.InvoiceID || invoiceId;
    if (!invoiceId) throw portalError('Xero created a response without an invoice ID.', 502, 'XERO_PORTAL_INVOICE_ID_MISSING');
    const invoiceUrl = `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${encodeURIComponent(invoiceId)}`;
    await attachReceiptFile(client, connection, receipt, invoiceId, { fetchImpl });
    const updated = await updateReceipt(client, receipt.id, {
      status: 'synced',
      xero_invoice_id: invoiceId,
      xero_invoice_url: invoiceUrl,
      error_message: null,
      updated_at: new Date().toISOString(),
    });
    return { receipt: serializeReceipt(updated) };
  } catch (error) {
    const updated = await updateReceipt(client, receipt.id, {
      status: 'failed',
      xero_invoice_id: invoiceId || null,
      error_message: error?.message || 'Xero receipt sync failed.',
      updated_at: new Date().toISOString(),
    });
    return { receipt: serializeReceipt(updated), error: updated.error_message };
  }
}

export async function xeroPortalContactLifecycleStatus(body = {}, { env = process.env } = {}) {
  const client = xeroContactSyncServiceClient(env);
  return {
    usageCache: await loadUsageCacheSummary(client),
    latestRun: await latestLifecycleRunSummary(client),
    latestAutoCreateRun: await latestAutoCreateRunSummary(client),
    statusLabels: CONTACT_LIFECYCLE_STATUS_LABELS,
    reasonLabels: CONTACT_LIFECYCLE_REASON_LABELS,
    matchFieldLabels: XERO_CONTACT_SYNC_MATCH_FIELD_LABELS,
    force: body.force === true,
  };
}

export async function xeroPortalContactLifecycleLatest(_body = {}, { env = process.env } = {}) {
  const client = xeroContactSyncServiceClient(env);
  const latest = await latestLifecycleRunSummary(client);
  if (!latest?.id) return { run: null };
  return xeroPortalContactLifecycleRun({ runId: latest.id }, { env });
}

export async function xeroPortalContactLifecycleRun(body = {}, { env = process.env } = {}) {
  const client = xeroContactSyncServiceClient(env);
  return { run: await loadLifecycleRun(client, body.runId) };
}

export async function xeroPortalContactLifecyclePreview(body = {}, { accessContext = null, env = process.env, fetchImpl = fetch } = {}) {
  const client = xeroContactSyncServiceClient(env);
  const runId = randomUUID();
  const lock = await acquireLifecycleLock(client, runId, accessContext?.profile, env);
  try {
    const startedAt = new Date().toISOString();
    const connection = await getFreshXeroConnection(client, { env, fetchImpl });
    assertXeroScopes(connection, ['accounting.contacts'], 'Contact lifecycle preview');
    const [salesforce, contactsResult, usageResult] = await Promise.all([
      exportSalesforceAccountsForLifecycle(env),
      listXeroContactsForLifecycle(connection, { env, fetchImpl }),
      resolveUsageCacheForPreview(client, connection, {
        env,
        fetchImpl,
        forceUsageRefresh: body.forceUsageRefresh === true,
        incrementalUsageRefresh: body.incrementalUsageRefresh === true,
      }),
    ]);
    let rows = buildContactLifecycleRows(salesforce.accounts, contactsResult.contacts, usageResult.usageByContactId, {
      usageCoverageComplete: usageResult.coverageComplete,
    });
    rows = rows.map((row) => ({ ...row, selected: row.status === 'eligible' }));
    const summary = summarizeContactLifecycleRows(rows, contactsResult.contacts, salesforce.totalRecords);
    const run = {
      id: runId,
      state: 'previewed',
      createdAt: startedAt,
      updatedAt: new Date().toISOString(),
      createdBy: accessContext?.profile?.id || null,
      createdByEmail: accessContext?.profile?.email || null,
      salesforce: {
        totalRecords: salesforce.totalRecords,
        filterSummary: salesforce.filterSummary,
      },
      xero: {
        tenantId: connection.tenantId,
        tenantName: connection.tenantName,
        scopes: splitScopes(connection.scope),
        contactListCalls: contactsResult.xeroCalls,
        contactCount: contactsResult.contacts.length,
      },
      usageCache: usageResult.summary,
      xeroCallEstimate: {
        previewActualCalls: contactsResult.xeroCalls + usageResult.xeroCalls,
        applyVerifyCalls: Math.ceil(rows.filter(canApplyContactLifecycleRow).length / 100),
        applyMutationCalls: Math.ceil(rows.filter(canApplyContactLifecycleRow).length / XERO_CONTACT_BATCH_SIZE),
      },
      summary,
      rows,
    };
    await writeLifecycleRun(client, run);
    return { run };
  } finally {
    await lock.release();
  }
}

export async function xeroPortalContactLifecycleApply(body = {}, { accessContext = null, env = process.env, fetchImpl = fetch } = {}) {
  requireExternalActionGate('xero_contact_sync', env);
  if (body.reviewed !== true) {
    throw portalError('Confirm that the selected Xero contact changes have been reviewed before applying.', 400, 'XERO_PORTAL_REVIEW_REQUIRED');
  }
  const selectedIds = new Set((Array.isArray(body.rowIds) ? body.rowIds : []).map((value) => String(value || '').trim()).filter(Boolean));
  if (!selectedIds.size) throw portalError('Select at least one eligible contact row to apply.', 400, 'XERO_PORTAL_SELECTION_REQUIRED');

  const client = xeroContactSyncServiceClient(env);
  const run = await loadLifecycleRun(client, body.runId);
  if (!run) throw portalError('Contact lifecycle run was not found.', 404, 'XERO_PORTAL_RUN_NOT_FOUND');
  if (run.state !== 'previewed' && run.state !== 'applied') {
    throw portalError('Only a previewed contact lifecycle run can be applied.', 409, 'XERO_PORTAL_RUN_NOT_APPLYABLE');
  }

  const lock = await acquireLifecycleLock(client, run.id, accessContext?.profile, env);
  try {
    const connection = await getFreshXeroConnection(client, { env, fetchImpl });
    assertXeroScopes(connection, ['accounting.contacts'], 'Contact lifecycle apply');
    const selectedCandidates = run.rows.filter((row) => selectedIds.has(row.id) && canApplyContactLifecycleRow(row));
    const invalidSelections = [...selectedIds].filter((id) => !selectedCandidates.some((row) => row.id === id));
    if (invalidSelections.length) {
      throw portalError('One or more selected rows are no longer eligible. Run a fresh preview.', 409, 'XERO_PORTAL_INVALID_SELECTION', { invalidSelections });
    }
    const fresh = await getXeroContactsByIds(connection, selectedCandidates.map((row) => row.xeroContactId), { env, fetchImpl });
    const verification = verifySelectedLifecycleRows(selectedCandidates, fresh.contacts);
    const verifiedUpdates = verification.updates;
    const outcomes = verifiedUpdates.length
      ? await updateXeroContactsBatch(connection, verifiedUpdates.map((entry) => entry.update), run.id, { env, fetchImpl })
      : [];
    const outcomeByContactId = new Map(outcomes.map((outcome) => [outcome.contactId, outcome]));
    const verificationByRowId = new Map(verification.failedRows.map((row) => [row.id, row]));
    const appliedAt = new Date().toISOString();

    const updatedRows = run.rows.map((row) => {
      if (!canApplyContactLifecycleRow(row)) return row;
      if (!selectedIds.has(row.id)) {
        return {
          ...row,
          selected: false,
          status: 'not-selected',
          reason: 'not-selected',
          message: CONTACT_LIFECYCLE_REASON_LABELS['not-selected'],
        };
      }
      const verificationFailure = verificationByRowId.get(row.id);
      if (verificationFailure) return verificationFailure;
      const outcome = outcomeByContactId.get(row.xeroContactId);
      if (outcome?.success) {
        return {
          ...row,
          selected: true,
          status: row.action === 'archive' ? 'archived' : 'updated',
          xeroContactName: outcome.name || (row.action === 'rename' ? row.proposedName : row.xeroContactName),
          xeroContactStatus: outcome.contactStatus || (row.action === 'archive' ? 'ARCHIVED' : row.xeroContactStatus),
          idempotencyKey: outcome.idempotencyKey,
          appliedAt,
          message: row.action === 'archive' ? 'Archived in Xero.' : 'Renamed in Xero.',
          validationErrors: [],
        };
      }
      return {
        ...row,
        selected: true,
        status: 'failed',
        reason: row.reason || 'xero-create-failed',
        idempotencyKey: outcome?.idempotencyKey,
        appliedAt,
        message: outcome?.errors?.[0] || 'Xero contact update failed.',
        validationErrors: outcome?.errors || ['Xero contact update failed.'],
      };
    });
    const summary = summarizeContactLifecycleRows(updatedRows, [], run.salesforce?.totalRecords || 0);
    const updatedRun = {
      ...run,
      state: 'applied',
      appliedAt,
      updatedAt: appliedAt,
      xero: {
        ...run.xero,
        applyVerifyCalls: fresh.xeroCalls,
        applyMutationCalls: Math.ceil(verifiedUpdates.length / XERO_CONTACT_BATCH_SIZE),
      },
      summary,
      rows: updatedRows,
    };
    await replaceLifecycleRows(client, updatedRun);
    await updateContactNameCacheFromLifecycle(client, connection, updatedRows).catch(() => null);
    return { run: updatedRun };
  } finally {
    await lock.release();
  }
}

export async function xeroPortalContactAutoCreateLatest(_body = {}, { env = process.env } = {}) {
  const client = xeroContactSyncServiceClient(env);
  const latest = await latestAutoCreateRunSummary(client);
  if (!latest?.id) return { run: null };
  return xeroPortalContactAutoCreateRun({ runId: latest.id }, { env });
}

export async function xeroPortalContactAutoCreateRun(body = {}, { env = process.env } = {}) {
  const client = xeroContactSyncServiceClient(env);
  const runId = String(body.runId || '').trim();
  if (!runId) throw portalError('Run ID is required.', 400, 'XERO_PORTAL_RUN_ID_REQUIRED');
  const { data: run, error: runError } = await client
    .from('xero_contact_sync_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();
  if (runError) throw storageError(runError, 'xero_contact_sync_runs');
  if (!run) return { run: null };
  const { data: rows, error: rowsError } = await client
    .from('xero_contact_sync_rows')
    .select('*')
    .eq('run_id', runId)
    .order('row_index', { ascending: true });
  if (rowsError) throw storageError(rowsError, 'xero_contact_sync_rows');
  return {
    run: {
      id: run.id,
      eventId: run.event_id,
      receivedAt: run.received_at,
      updatedAt: run.updated_at,
      salesforce: run.salesforce || {},
      xero: run.xero || {},
      summary: run.summary || {},
      rows: (rows || []).map(serializeAutoCreateRow),
    },
  };
}

export function buildContactLifecycleRows(salesforceAccounts, xeroContacts, usageByContactId = new Map(), options = {}) {
  const renameRows = buildContactRenameRows(salesforceAccounts, xeroContacts);
  const renameRowsByXeroId = groupBy(
    renameRows.filter((row) => row.xeroContactId),
    (row) => row.xeroContactId,
  );
  const protectedIndexes = buildSalesforceProtectionIndexes(salesforceAccounts);
  const rows = [];

  for (const contact of xeroContacts) {
    if (isArchived(contact)) continue;

    const matchingRenameRows = renameRowsByXeroId.get(contact.contactId) || [];
    const usage = usageEvidenceFor(contact.contactId, usageByContactId);

    if (matchingRenameRows.length === 1) {
      rows.push(lifecycleRowFromRenameRow(matchingRenameRows[0], contact, usage));
      continue;
    }

    if (matchingRenameRows.length > 1 || isProtectedBySalesforce(contact, protectedIndexes)) {
      rows.push(xeroContactRow(contact, {
        action: 'exception',
        status: 'blocked',
        reason: 'ambiguous-salesforce-match',
        message: CONTACT_LIFECYCLE_REASON_LABELS['ambiguous-salesforce-match'],
        usage,
      }));
      continue;
    }

    if (usage.length > 0) {
      rows.push(xeroContactRow(contact, {
        action: 'exception',
        status: 'blocked',
        reason: 'used-unmatched-xero-contact',
        message: CONTACT_LIFECYCLE_REASON_LABELS['used-unmatched-xero-contact'],
        usage,
      }));
      continue;
    }

    if (hasNonzeroBalance(contact)) {
      rows.push(xeroContactRow(contact, {
        action: 'exception',
        status: 'blocked',
        reason: 'nonzero-balance',
        message: CONTACT_LIFECYCLE_REASON_LABELS['nonzero-balance'],
        usage,
      }));
      continue;
    }

    if (options.usageCoverageComplete === false) {
      rows.push(xeroContactRow(contact, {
        action: 'exception',
        status: 'blocked',
        reason: 'usage-scan-incomplete',
        message: 'Archive is blocked because one or more readable Xero usage sources could not be scanned or loaded from cache.',
        usage,
      }));
      continue;
    }

    rows.push(xeroContactRow(contact, {
      action: 'archive',
      status: 'eligible',
      reason: 'unused-unmatched-xero-contact',
      message: 'Ready to archive because no readable Xero usage or Salesforce stem match was found.',
      usage,
    }));
  }

  for (const row of renameRows) {
    if (row.xeroContactId) continue;
    rows.push({
      id: `sf-${row.salesforceAccountId}`,
      action: 'exception',
      status: 'blocked',
      reason: row.reason,
      message: row.message,
      salesforceAccountId: row.salesforceAccountId,
      salesforceName: row.salesforceName,
      salesforceCompanyCode: row.salesforceCompanyCode,
      salesforceRecordType: row.salesforceRecordType,
      proposedName: row.proposedName,
      usage: [],
    });
  }

  return rows.sort(compareLifecycleRows);
}

export function summarizeContactLifecycleRows(rows, xeroContacts = [], totalSalesforce = 0) {
  const summary = {
    totalSalesforce,
    totalXeroContacts: xeroContacts.length,
    nonArchivedXeroContacts: xeroContacts.filter(isNonArchived).length,
    activeXeroContacts: xeroContacts.filter(isActive).length,
    archivedXeroContacts: xeroContacts.filter(isArchived).length,
    unmatchedNonArchivedXeroContacts: 0,
    renameEligible: 0,
    archiveEligible: 0,
    keep: 0,
    exception: 0,
    updated: 0,
    archived: 0,
    failed: 0,
    notSelected: 0,
    selected: 0,
    actionCounts: {},
    statusCounts: {},
    reasonCounts: {},
  };

  for (const row of rows) {
    summary.actionCounts[row.action] = (summary.actionCounts[row.action] || 0) + 1;
    summary.statusCounts[row.status] = (summary.statusCounts[row.status] || 0) + 1;
    if (row.reason) summary.reasonCounts[row.reason] = (summary.reasonCounts[row.reason] || 0) + 1;
    if (row.action === 'rename' && row.status === 'eligible') summary.renameEligible += 1;
    if (row.action === 'archive' && row.status === 'eligible') summary.archiveEligible += 1;
    if (row.xeroContactId && !row.salesforceAccountId && isNonArchivedLifecycleRow(row)) {
      summary.unmatchedNonArchivedXeroContacts += 1;
    }
    if (row.action === 'keep' || row.status === 'kept') summary.keep += 1;
    if (row.action === 'exception' || row.status === 'blocked') summary.exception += 1;
    if (row.status === 'updated') summary.updated += 1;
    if (row.status === 'archived') summary.archived += 1;
    if (row.status === 'failed') summary.failed += 1;
    if (row.status === 'not-selected') summary.notSelected += 1;
    if (row.selected) summary.selected += 1;
  }

  return summary;
}

export function canApplyContactLifecycleRow(row) {
  return row?.status === 'eligible'
    && Boolean(row.xeroContactId)
    && (row.action === 'rename' || row.action === 'archive');
}

async function readXeroPublicStatus(client, { env, fetchImpl, refresh = false }) {
  const stored = await readStoredXeroConnection(client).catch((error) => {
    throw storageError(error, 'xero_contact_sync_connections');
  });
  const config = xeroPortalConfig(env);
  let connection = stored;
  let refreshError = null;
  const expiresAtMs = Date.parse(stored?.expiresAt || '');
  const shouldRefresh = refresh || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + 90_000;
  if (shouldRefresh && (stored?.refreshToken || env.XERO_REFRESH_TOKEN)) {
    try {
      connection = await getFreshXeroConnection(client, { env, fetchImpl });
    } catch (error) {
      refreshError = error?.message || 'Xero token refresh failed.';
    }
  }
  const scopes = splitScopes(connection?.scope || env.XERO_SCOPES || DEFAULT_XERO_SCOPES);
  return {
    configured: config.configured,
    connected: Boolean(connection?.tenantId && (connection?.refreshToken || env.XERO_REFRESH_TOKEN)),
    tenantId: connection?.tenantId || env.XERO_TENANT_ID || null,
    tenantName: connection?.tenantName || env.XERO_TENANT_NAME || null,
    expiresAt: connection?.expiresAt || null,
    scopes,
    scopeFlags: xeroScopeFlags(scopes),
    hasContactsScope: scopeAllows(scopes, 'accounting.contacts'),
    missing: config.missing,
    refreshError,
  };
}

function xeroPortalConfig(env = process.env, req = null, forcedRedirectUri = '') {
  const origin = requestOrigin(req, env);
  const redirectUri = nonBlank(forcedRedirectUri || env.XERO_REDIRECT_URI) || `${origin}/api/xero/callback`;
  const clientId = nonBlank(env.XERO_CLIENT_ID);
  const clientSecret = nonBlank(env.XERO_CLIENT_SECRET);
  const scopes = nonBlank(env.XERO_SCOPES) || DEFAULT_XERO_SCOPES;
  const missing = [
    ...(!clientId ? ['XERO_CLIENT_ID'] : []),
    ...(!clientSecret ? ['XERO_CLIENT_SECRET'] : []),
  ];
  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    configured: missing.length === 0,
    missing,
  };
}

function requestOrigin(req = null, env = process.env) {
  const configured = nonBlank(env.XERO_PUBLIC_APP_URL || env.FCOS_PUBLIC_URL || env.APP_URL);
  if (configured) return configured.replace(/\/+$/g, '');
  const protocol = nonBlank(req?.headers?.['x-forwarded-proto'] || req?.headers?.['X-Forwarded-Proto']) || 'https';
  const host = nonBlank(req?.headers?.['x-forwarded-host'] || req?.headers?.['X-Forwarded-Host'] || req?.headers?.host || req?.headers?.Host);
  if (host) return `${protocol.split(',')[0]}://${host.split(',')[0]}`;
  const vercelUrl = nonBlank(env.VERCEL_URL);
  if (vercelUrl) return `https://${vercelUrl}`;
  return 'https://fcos.fcuno.com';
}

function xeroScopeFlags(scopes) {
  return {
    contacts: scopeAllows(scopes, 'accounting.contacts'),
    invoices: scopeAllows(scopes, 'accounting.invoices') || scopeAllows(scopes, 'accounting.transactions'),
    attachments: scopeAllows(scopes, 'accounting.attachments'),
    bankTransactionsRead: scopeAllows(scopes, 'accounting.banktransactions.read') || scopeAllows(scopes, 'accounting.banktransactions') || scopeAllows(scopes, 'accounting.transactions.read') || scopeAllows(scopes, 'accounting.transactions'),
    paymentsRead: scopeAllows(scopes, 'accounting.payments.read') || scopeAllows(scopes, 'accounting.payments') || scopeAllows(scopes, 'accounting.transactions.read') || scopeAllows(scopes, 'accounting.transactions'),
    paymentsWrite: scopeAllows(scopes, 'accounting.payments') || scopeAllows(scopes, 'accounting.transactions'),
    settingsRead: scopeAllows(scopes, 'accounting.settings.read') || scopeAllows(scopes, 'accounting.settings') || scopeAllows(scopes, 'accounting.transactions'),
  };
}

function assertXeroScopes(connection, required, actionLabel) {
  const scopes = splitScopes(connection.scope || '');
  const missing = required.filter((scope) => !scopeAllows(scopes, scope));
  if (missing.length) {
    throw portalError(`${actionLabel} requires reconnecting Xero with: ${missing.join(', ')}`, 409, 'XERO_PORTAL_SCOPE_MISSING', { missing });
  }
}

function scopeAllows(scopes, required) {
  if (scopes.includes(required)) return true;
  if (required === 'accounting.invoices' && scopes.includes('accounting.transactions')) return true;
  if (required === 'accounting.payments.read' && (scopes.includes('accounting.payments') || scopes.includes('accounting.transactions'))) return true;
  if (required === 'accounting.payments' && scopes.includes('accounting.transactions')) return true;
  if (required === 'accounting.banktransactions.read' && (scopes.includes('accounting.banktransactions') || scopes.includes('accounting.transactions'))) return true;
  if (required === 'accounting.settings.read' && (scopes.includes('accounting.settings') || scopes.includes('accounting.transactions'))) return true;
  return false;
}

async function exportSalesforceAccountsForLifecycle(env = process.env) {
  const accountQuery =
    'SELECT Id, Name, Company_Code__c, Inactive_Suspended__c, RecordType.DeveloperName ' +
    'FROM Account ' +
    "WHERE Company_Code__c LIKE 'HK%' " +
    'AND Inactive_Suspended__c = false ' +
    "AND RecordType.DeveloperName IN ('Buyer','Supplier','Buyer_Supplier','Broker')";
  const referenceQueries = recentStemAccountReferenceQueries(env);
  const [accountResult, referenceResults] = await Promise.all([
    sfQuery(accountQuery, { clean: true, limit: 100000 }),
    sfCompositeQueries(referenceQueries.map((query) => ({ soql: query.query, clean: true, limit: 100000 }))),
  ]);
  const recentStemAccountIds = new Set();
  const sources = referenceQueries.map((query, index) => {
    const result = referenceResults[index] || { records: [], totalSize: 0 };
    const beforeSize = recentStemAccountIds.size;
    let accountReferences = 0;
    for (const row of result.records || []) {
      for (const field of query.accountFields) {
        const accountId = nonBlank(row[field]);
        if (!isSalesforceAccountId(accountId)) continue;
        accountReferences += 1;
        recentStemAccountIds.add(accountId);
      }
    }
    return {
      source: query.source,
      totalRecords: result.totalSize ?? (result.records || []).length,
      accountReferences,
      uniqueAccountIdsAdded: recentStemAccountIds.size - beforeSize,
    };
  });
  const baseAccounts = (accountResult.records || []).map(toSalesforceAccountForRename);
  const accounts = baseAccounts.filter((account) => recentStemAccountIds.has(account.id));
  return {
    totalRecords: accounts.length,
    accounts,
    filterSummary: {
      clKeyPrefix: 'HK',
      inactiveField: 'Inactive_Suspended__c',
      inactiveValueExcluded: true,
      recentStemDeliveryFrom: recentStemDeliveryFrom(env),
      sourceAccountRecords: baseAccounts.length,
      recentStemAccountIds: recentStemAccountIds.size,
      includedRecords: accounts.length,
      excludedWithoutRecentStem: Math.max(baseAccounts.length - accounts.length, 0),
      stemReferenceSources: sources,
    },
  };
}

function recentStemAccountReferenceQueries(env = process.env) {
  const date = normalizedSalesforceDate(recentStemDeliveryFrom(env));
  const stemDeliveryWhere = `Delivery_Date_Or_Expected__c >= ${date}`;
  const relatedStemDeliveryWhere = `STEM__r.Delivery_Date_Or_Expected__c >= ${date}`;
  return [
    {
      source: 'STEM__c buyer and buyer broker',
      query: `SELECT Account__c, Buyer_Broker__c FROM STEM__c WHERE ${stemDeliveryWhere}`,
      accountFields: ['Account__c', 'Buyer_Broker__c'],
    },
    {
      source: 'STEM_Line_Item__c suppliers and brokers',
      query: 'SELECT Original_Supplier__c, Substitute_Supplier__c, Buyers_Broker__c, Supplier_Broker__c ' +
        `FROM STEM_Line_Item__c WHERE ${relatedStemDeliveryWhere}`,
      accountFields: ['Original_Supplier__c', 'Substitute_Supplier__c', 'Buyers_Broker__c', 'Supplier_Broker__c'],
    },
    {
      source: 'STEM_Extra_Cost__c supplier',
      query: `SELECT Supplier__c FROM STEM_Extra_Cost__c WHERE ${relatedStemDeliveryWhere}`,
      accountFields: ['Supplier__c'],
    },
    {
      source: 'STEM_Variable_Charge_Supplier__c supplier',
      query: `SELECT Supplier__c FROM STEM_Variable_Charge_Supplier__c WHERE ${relatedStemDeliveryWhere}`,
      accountFields: ['Supplier__c'],
    },
    {
      source: 'STEM_Buyer_Broker__c buyer broker',
      query: `SELECT Buyer_Broker__c FROM STEM_Buyer_Broker__c WHERE ${relatedStemDeliveryWhere}`,
      accountFields: ['Buyer_Broker__c'],
    },
    {
      source: 'STEM_Payment_Overview__c account',
      query: `SELECT Account__c FROM STEM_Payment_Overview__c WHERE ${relatedStemDeliveryWhere}`,
      accountFields: ['Account__c'],
    },
    {
      source: 'Stem_Status__c account',
      query: `SELECT Account__c FROM Stem_Status__c WHERE ${relatedStemDeliveryWhere}`,
      accountFields: ['Account__c'],
    },
  ];
}

function toSalesforceAccountForRename(row) {
  return {
    id: nonBlank(row.Id),
    name: nonBlank(row.Name),
    companyCode: nonBlank(row.Company_Code__c),
    recordType: nonBlank(row.RecordType?.DeveloperName || row['RecordType.DeveloperName']),
    inactiveSuspended: row.Inactive_Suspended__c === true,
  };
}

async function listXeroContactsForLifecycle(connection, { env = process.env, fetchImpl = fetch } = {}) {
  const contacts = [];
  let xeroCalls = 0;
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ includeArchived: 'true', page: String(page), pageSize: '100' });
    xeroCalls += 1;
    const response = await xeroAccountingFetch(connection, `/Contacts?${params}`, {
      method: 'GET',
      retryOnRateLimit: true,
      env,
      fetchImpl,
    });
    const pageContacts = Array.isArray(response.Contacts) ? response.Contacts : [];
    contacts.push(...pageContacts.filter((contact) => contact.ContactID).map(toLifecycleContact));
    const pageCount = Number(response.pagination?.pageCount || 0);
    if ((pageCount && page >= pageCount) || pageContacts.length < 100) break;
    page += 1;
    await sleep(xeroContactDelayMs(env));
  }
  return { contacts, xeroCalls };
}

async function getXeroContactsByIds(connection, contactIds, { env = process.env, fetchImpl = fetch } = {}) {
  const ids = [...new Set((contactIds || []).map((id) => nonBlank(id)).filter(Boolean))];
  const contacts = [];
  let xeroCalls = 0;
  for (let index = 0; index < ids.length; index += 100) {
    const params = new URLSearchParams({ includeArchived: 'true', IDs: ids.slice(index, index + 100).join(',') });
    xeroCalls += 1;
    const response = await xeroAccountingFetch(connection, `/Contacts?${params}`, {
      method: 'GET',
      retryOnRateLimit: true,
      env,
      fetchImpl,
    });
    contacts.push(...(response.Contacts || []).filter((contact) => contact.ContactID).map(toLifecycleContact));
    if (index + 100 < ids.length) await sleep(xeroContactDelayMs(env));
  }
  return { contacts, xeroCalls };
}

async function resolveUsageCacheForPreview(client, connection, { env = process.env, fetchImpl = fetch, forceUsageRefresh = false, incrementalUsageRefresh = false } = {}) {
  const existing = await loadUsageCacheRows(client);
  const existingBySource = new Map(existing.map((row) => [row.source, row]));
  const scanned = [];
  let xeroCalls = 0;

  for (const source of READABLE_USAGE_SOURCES) {
    const cached = existingBySource.get(source.source);
    if (source.blocked) {
      const blocked = cached || usageCacheRowFromResult({
        source: source.source,
        label: source.label,
        status: 'blocked',
        recordsScanned: 0,
        recordsWithContact: 0,
        xeroCalls: 0,
        contacts: new Map(),
        error: 'Current Xero OAuth/API access cannot read this endpoint.',
      });
      if (!cached) await saveUsageScanResult(client, blocked);
      scanned.push(blocked);
      continue;
    }

    if (cached && !forceUsageRefresh && !incrementalUsageRefresh) {
      scanned.push(cached);
      continue;
    }

    const ifModifiedSince = cached && incrementalUsageRefresh && !forceUsageRefresh ? cached.scanned_at : null;
    const result = await scanXeroContactUsageSource(connection, source, ifModifiedSince, { env, fetchImpl });
    xeroCalls += result.xeroCalls;
    const cacheRow = usageCacheRowFromResult(result);
    await saveUsageScanResult(client, cacheRow);
    scanned.push(cacheRow);
  }

  const readableRows = scanned.filter((row) => !READABLE_USAGE_SOURCES.find((source) => source.source === row.source)?.blocked);
  const coverageComplete = readableRows.length >= READABLE_USAGE_SOURCES.filter((source) => !source.blocked).length
    && readableRows.every((row) => row.status === 'complete');
  return {
    usageByContactId: usageMapFromCacheRows(scanned),
    xeroCalls,
    coverageComplete,
    summary: usageCacheSummary(scanned, xeroCalls, coverageComplete),
  };
}

async function scanXeroContactUsageSource(connection, source, ifModifiedSince = null, { env = process.env, fetchImpl = fetch } = {}) {
  if (source.blocked) {
    return {
      source: source.source,
      label: source.label,
      status: 'blocked',
      recordsScanned: 0,
      recordsWithContact: 0,
      xeroCalls: 0,
      contacts: new Map(),
      error: 'Current Xero OAuth/API access cannot read this endpoint.',
    };
  }

  const contacts = new Map();
  let recordsScanned = 0;
  let recordsWithContact = 0;
  let xeroCalls = 0;
  let page = 1;

  try {
    while (true) {
      const params = new URLSearchParams({ page: String(page), pageSize: '100' });
      xeroCalls += 1;
      const response = await xeroAccountingFetch(connection, `${source.pathName}?${params}`, {
        method: 'GET',
        retryOnRateLimit: true,
        headers: ifModifiedSince ? { 'If-Modified-Since': ifModifiedSince } : {},
        env,
        fetchImpl,
      });
      const records = response[source.collection] || [];
      recordsScanned += records.length;
      for (const record of records) {
        const ids = contactIdsFromUsageRecord(record);
        if (!ids.length) continue;
        recordsWithContact += 1;
        for (const contactId of ids) {
          const existing = contacts.get(contactId);
          contacts.set(contactId, {
            source: source.source,
            label: source.label,
            records: (existing?.records || 0) + 1,
            lastSeenAt: new Date().toISOString(),
          });
        }
      }
      const pageCount = Number(response.pagination?.pageCount || 0);
      if ((pageCount && page >= pageCount) || records.length < 100) break;
      page += 1;
      await sleep(xeroContactDelayMs(env));
    }
    return {
      source: source.source,
      label: source.label,
      status: 'complete',
      recordsScanned,
      recordsWithContact,
      xeroCalls,
      contacts,
    };
  } catch (error) {
    return {
      source: source.source,
      label: source.label,
      status: error?.status === 401 || error?.status === 403 ? 'blocked' : 'failed',
      recordsScanned,
      recordsWithContact,
      xeroCalls,
      contacts,
      error: error?.message || 'Xero usage scan failed.',
    };
  }
}

function usageCacheRowFromResult(result) {
  return {
    source: result.source,
    label: result.label,
    status: result.status,
    records_scanned: result.recordsScanned || result.records_scanned || 0,
    records_with_contact: result.recordsWithContact || result.records_with_contact || 0,
    xero_calls: result.xeroCalls || result.xero_calls || 0,
    contact_usage: Array.isArray(result.contact_usage) ? result.contact_usage : [...(result.contacts || new Map()).entries()].map(([contactId, evidence]) => ({
      contactId,
      source: evidence.source || result.source,
      label: evidence.label || result.label,
      records: evidence.records || 0,
      lastSeenAt: evidence.lastSeenAt || new Date().toISOString(),
    })),
    error_message: result.error || result.error_message || null,
    scanned_at: result.scanned_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function loadUsageCacheRows(client) {
  const { data, error } = await client
    .from('xero_contact_usage_cache')
    .select('*')
    .order('source', { ascending: true });
  if (error) throw storageError(error, 'xero_contact_usage_cache');
  return data || [];
}

async function loadUsageCacheSummary(client) {
  const rows = await loadUsageCacheRows(client).catch((error) => {
    if (error?.status === 503) return [];
    throw error;
  });
  return usageCacheSummary(rows, 0, rows.filter((row) => !READABLE_USAGE_SOURCES.find((source) => source.source === row.source)?.blocked).every((row) => row.status === 'complete'));
}

function usageCacheSummary(rows, xeroCalls, coverageComplete) {
  const bySource = Object.fromEntries(READABLE_USAGE_SOURCES.map((source) => {
    const row = rows.find((candidate) => candidate.source === source.source);
    return [source.source, {
      source: source.source,
      label: source.label,
      blockedByDesign: source.blocked === true,
      status: row?.status || (source.blocked ? 'blocked' : 'missing'),
      recordsScanned: Number(row?.records_scanned || 0),
      recordsWithContact: Number(row?.records_with_contact || 0),
      contactCount: Array.isArray(row?.contact_usage) ? row.contact_usage.length : 0,
      scannedAt: row?.scanned_at || null,
      error: row?.error_message || null,
    }];
  }));
  return {
    bySource,
    sources: Object.values(bySource),
    xeroCalls,
    coverageComplete,
    missingReadableSources: Object.values(bySource).filter((row) => !row.blockedByDesign && row.status === 'missing').length,
    failedReadableSources: Object.values(bySource).filter((row) => !row.blockedByDesign && row.status === 'failed').length,
  };
}

async function saveUsageScanResult(client, row) {
  const { error } = await client.from('xero_contact_usage_cache').upsert(row, { onConflict: 'source' });
  if (error) throw storageError(error, 'xero_contact_usage_cache');
}

function usageMapFromCacheRows(rows) {
  const usageByContactId = new Map();
  for (const row of rows) {
    for (const item of Array.isArray(row.contact_usage) ? row.contact_usage : []) {
      const contactId = nonBlank(item.contactId || item.contact_id);
      if (!contactId) continue;
      const evidence = {
        source: nonBlank(item.source || row.source),
        label: nonBlank(item.label || row.label),
        records: Number(item.records || 0),
        lastSeenAt: item.lastSeenAt || item.last_seen_at || row.scanned_at || null,
      };
      const list = usageByContactId.get(contactId) || [];
      list.push(evidence);
      usageByContactId.set(contactId, list);
    }
  }
  return usageByContactId;
}

function verifySelectedLifecycleRows(rows, freshContacts) {
  const contactById = new Map(freshContacts.map((contact) => [contact.contactId, contact]));
  const updates = [];
  const failedRows = [];
  const checkedAt = new Date().toISOString();
  for (const row of rows) {
    const contact = contactById.get(row.xeroContactId);
    if (!contact) {
      failedRows.push(staleRow(row, 'Xero contact was not returned during apply verification.', checkedAt));
      continue;
    }
    if (isArchived(contact) && row.action !== 'archive') {
      failedRows.push(staleRow(row, 'Xero contact is archived now. Run a fresh preview.', checkedAt));
      continue;
    }
    if (normalizeName(contact.name) !== normalizeName(row.xeroContactName)) {
      failedRows.push(staleRow(row, 'Xero contact name changed after preview. Run a fresh preview.', checkedAt));
      continue;
    }
    updates.push({
      row,
      update: {
        contactId: row.xeroContactId,
        ...(row.action === 'rename' ? { name: row.proposedName } : {}),
        ...(row.action === 'archive' ? { contactStatus: 'ARCHIVED' } : {}),
      },
    });
  }
  return { updates, failedRows };
}

function staleRow(row, message, appliedAt) {
  return {
    ...row,
    selected: true,
    status: 'failed',
    reason: 'stale-preview',
    appliedAt,
    message,
    validationErrors: [message],
  };
}

async function updateXeroContactsBatch(connection, updates, runId, { env = process.env, fetchImpl = fetch } = {}) {
  const outcomes = [];
  for (let index = 0; index < updates.length; index += XERO_CONTACT_BATCH_SIZE) {
    const chunk = updates.slice(index, index + XERO_CONTACT_BATCH_SIZE);
    const chunkNumber = Math.floor(index / XERO_CONTACT_BATCH_SIZE) + 1;
    const idempotencyKey = `${runId}-lifecycle-${chunkNumber}`;
    try {
      const response = await xeroAccountingFetch(connection, '/Contacts?summarizeErrors=false', {
        method: 'POST',
        idempotencyKey,
        retryOnRateLimit: true,
        env,
        fetchImpl,
        body: {
          Contacts: chunk.map((update) => ({
            ContactID: update.contactId,
            ...(update.name ? { Name: update.name } : {}),
            ...(update.contactStatus ? { ContactStatus: update.contactStatus } : {}),
          })),
        },
      });
      const responseById = new Map((response.Contacts || []).filter((contact) => contact.ContactID).map((contact) => [String(contact.ContactID), contact]));
      for (const update of chunk) {
        const contact = responseById.get(update.contactId);
        const validationErrors = (contact?.ValidationErrors || []).map((error) => error.Message).filter(Boolean);
        outcomes.push({
          contactId: update.contactId,
          success: Boolean(contact && contact.HasValidationErrors !== true && validationErrors.length === 0),
          name: contact?.Name,
          contactStatus: contact?.ContactStatus,
          idempotencyKey,
          errors: contact ? validationErrors : ['Xero did not return this contact in the update response.'],
        });
      }
    } catch (error) {
      outcomes.push(...chunk.map((update) => ({
        contactId: update.contactId,
        success: false,
        idempotencyKey,
        errors: [error?.message || 'Xero contact update failed.'],
      })));
      if (/RATE_LIMIT|DAILY|QUOTA/i.test(String(error?.code || error?.message || ''))) {
        outcomes.push(...updates.slice(index + XERO_CONTACT_BATCH_SIZE).map((update) => ({
          contactId: update.contactId,
          success: false,
          idempotencyKey: null,
          errors: ['Skipped because Xero rate limit was reached before this contact was mutated.'],
        })));
        break;
      }
    }
    if (index + XERO_CONTACT_BATCH_SIZE < updates.length) await sleep(xeroContactDelayMs(env));
  }
  return outcomes;
}

async function createDraftBill(connection, receipt, { env = process.env, fetchImpl = fetch } = {}) {
  const response = await xeroAccountingFetch(connection, '/Invoices', {
    method: 'POST',
    idempotencyKey: `${receipt.id}-draft-bill`,
    retryOnRateLimit: true,
    env,
    fetchImpl,
    body: {
      Invoices: [
        {
          Type: 'ACCPAY',
          Contact: { Name: receipt.merchant || 'Unknown supplier' },
          Date: receipt.receipt_date,
          DueDate: receipt.receipt_date,
          Reference: `Receipt ${String(receipt.id).slice(0, 8)}`,
          CurrencyCode: receipt.currency || 'HKD',
          LineAmountTypes: 'Inclusive',
          Status: 'DRAFT',
          LineItems: [
            {
              Description: receipt.category || 'Receipt expense',
              Quantity: 1,
              UnitAmount: Number(receipt.total),
              AccountCode: receipt.account_code || '429',
              TaxType: receipt.tax_type || 'NONE',
            },
          ],
        },
      ],
    },
  });
  const invoice = response.Invoices?.[0] || {};
  const errors = (invoice.ValidationErrors || []).map((error) => error.Message).filter(Boolean);
  if (invoice.HasValidationErrors || errors.length) throw portalError(errors.join('; ') || 'Xero rejected the draft bill.', 422, 'XERO_PORTAL_INVOICE_VALIDATION_FAILED');
  return invoice;
}

async function attachReceiptFile(client, connection, receipt, invoiceId, { fetchImpl = fetch } = {}) {
  const { data, error } = await client.storage.from(RECEIPT_BUCKET).download(receipt.storage_path);
  if (error) throw storageError(error, RECEIPT_BUCKET);
  const buffer = Buffer.from(await data.arrayBuffer());
  const fileName = encodeURIComponent(receipt.file_name || `receipt-${receipt.id}`);
  const response = await fetchImpl(`${XERO_API_BASE}/api.xro/2.0/Invoices/${invoiceId}/Attachments/${fileName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'xero-tenant-id': connection.tenantId,
      'Content-Type': receipt.file_type || 'application/octet-stream',
    },
    body: new Uint8Array(buffer),
  });
  if (!response.ok) throw portalError(await formatXeroError(response), response.status || 502, 'XERO_PORTAL_ATTACHMENT_FAILED');
}

async function writeLifecycleRun(client, run) {
  const runRow = lifecycleRunToDb(run);
  const { error: runError } = await client.from('xero_contact_lifecycle_runs').insert(runRow);
  if (runError) throw storageError(runError, 'xero_contact_lifecycle_runs');
  const rows = run.rows.map((row, index) => lifecycleRowToDb(run.id, row, index));
  if (rows.length) {
    const { error: rowsError } = await client.from('xero_contact_lifecycle_rows').insert(rows);
    if (rowsError) throw storageError(rowsError, 'xero_contact_lifecycle_rows');
  }
}

async function replaceLifecycleRows(client, run) {
  const { error: runError } = await client
    .from('xero_contact_lifecycle_runs')
    .update(lifecycleRunToDb(run))
    .eq('id', run.id);
  if (runError) throw storageError(runError, 'xero_contact_lifecycle_runs');
  const { error: deleteError } = await client.from('xero_contact_lifecycle_rows').delete().eq('run_id', run.id);
  if (deleteError) throw storageError(deleteError, 'xero_contact_lifecycle_rows');
  const rows = run.rows.map((row, index) => lifecycleRowToDb(run.id, row, index));
  if (rows.length) {
    const { error: rowsError } = await client.from('xero_contact_lifecycle_rows').insert(rows);
    if (rowsError) throw storageError(rowsError, 'xero_contact_lifecycle_rows');
  }
}

async function loadLifecycleRun(client, runId) {
  const id = nonBlank(runId);
  if (!id) throw portalError('Run ID is required.', 400, 'XERO_PORTAL_RUN_ID_REQUIRED');
  const { data: run, error: runError } = await client
    .from('xero_contact_lifecycle_runs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (runError) throw storageError(runError, 'xero_contact_lifecycle_runs');
  if (!run) return null;
  const { data: rows, error: rowsError } = await client
    .from('xero_contact_lifecycle_rows')
    .select('*')
    .eq('run_id', id)
    .order('row_index', { ascending: true });
  if (rowsError) throw storageError(rowsError, 'xero_contact_lifecycle_rows');
  return serializeLifecycleRun(run, rows || []);
}

async function latestLifecycleRunSummary(client) {
  const { data, error } = await client
    .from('xero_contact_lifecycle_runs')
    .select('id,state,created_at,updated_at,applied_at,summary,xero_call_estimate,error_message')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const wrapped = storageError(error, 'xero_contact_lifecycle_runs');
    if (wrapped?.status === 503) return null;
    throw wrapped;
  }
  return data ? {
    id: data.id,
    state: data.state,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    appliedAt: data.applied_at,
    summary: data.summary || {},
    xeroCallEstimate: data.xero_call_estimate || {},
    error: data.error_message || null,
  } : null;
}

async function latestAutoCreateRunSummary(client) {
  const { data, error } = await client
    .from('xero_contact_sync_runs')
    .select('id,event_id,received_at,updated_at,summary,xero')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const wrapped = storageError(error, 'xero_contact_sync_runs');
    if (wrapped?.status === 503) return null;
    throw wrapped;
  }
  return data ? {
    id: data.id,
    eventId: data.event_id,
    receivedAt: data.received_at,
    updatedAt: data.updated_at,
    summary: data.summary || {},
    xero: data.xero || {},
  } : null;
}

async function acquireLifecycleLock(client, runId, profile = null, env = process.env) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + Number(env.XERO_CONTACT_LIFECYCLE_LOCK_SECONDS || '900') * 1000).toISOString();
  const owner = nonBlank(profile?.email || profile?.id) || 'fcos';
  const patch = {
    run_id: runId,
    locked_by: owner,
    locked_at: now.toISOString(),
    locked_until: lockedUntil,
    updated_at: now.toISOString(),
  };
  const updated = await client
    .from('xero_contact_lifecycle_locks')
    .update(patch)
    .eq('id', 'primary')
    .lt('locked_until', now.toISOString())
    .select('*')
    .maybeSingle();
  if (updated.error) throw storageError(updated.error, 'xero_contact_lifecycle_locks');
  if (updated.data) return lifecycleLockHandle(client, runId);

  const inserted = await client.from('xero_contact_lifecycle_locks').insert({ id: 'primary', ...patch });
  if (!inserted.error) return lifecycleLockHandle(client, runId);
  if (inserted.error?.code !== '23505') throw storageError(inserted.error, 'xero_contact_lifecycle_locks');

  const current = await client
    .from('xero_contact_lifecycle_locks')
    .select('run_id,locked_by,locked_until')
    .eq('id', 'primary')
    .maybeSingle();
  if (current.error) throw storageError(current.error, 'xero_contact_lifecycle_locks');
  throw portalError('Another Xero contact lifecycle job is already running.', 409, 'XERO_PORTAL_LIFECYCLE_LOCKED', current.data || {});
}

function lifecycleLockHandle(client, runId) {
  return {
    async release() {
      const now = new Date().toISOString();
      await client
        .from('xero_contact_lifecycle_locks')
        .update({ locked_until: now, updated_at: now })
        .eq('id', 'primary')
        .eq('run_id', runId);
    },
  };
}

function lifecycleRunToDb(run) {
  return {
    id: run.id,
    state: run.state,
    created_by: run.createdBy || null,
    created_by_email: run.createdByEmail || null,
    created_at: run.createdAt || new Date().toISOString(),
    updated_at: run.updatedAt || new Date().toISOString(),
    applied_at: run.appliedAt || null,
    salesforce: run.salesforce || {},
    xero: run.xero || {},
    usage_cache: run.usageCache || {},
    xero_call_estimate: run.xeroCallEstimate || {},
    summary: run.summary || {},
    row_count: run.rows?.length || 0,
    error_message: run.error || null,
  };
}

function lifecycleRowToDb(runId, row, index) {
  return {
    run_id: runId,
    row_index: index,
    row_id: row.id,
    action: row.action,
    status: row.status,
    reason: row.reason || null,
    selected: row.selected === true,
    salesforce_account_id: row.salesforceAccountId || null,
    salesforce_record_type: row.salesforceRecordType || null,
    salesforce_cl_key: row.salesforceCompanyCode || null,
    salesforce_name: row.salesforceName || null,
    proposed_name: row.proposedName || null,
    xero_contact_id: row.xeroContactId || null,
    xero_contact_name: row.xeroContactName || null,
    xero_contact_number: row.xeroContactNumber || null,
    xero_account_number: row.xeroAccountNumber || null,
    xero_contact_status: row.xeroContactStatus || null,
    match_field: row.matchField || null,
    usage_evidence: Array.isArray(row.usage) ? row.usage : [],
    idempotency_key: row.idempotencyKey || null,
    applied_at: row.appliedAt || null,
    message: row.message || null,
    validation_errors: Array.isArray(row.validationErrors) ? row.validationErrors : [],
    raw_row: row,
  };
}

function serializeLifecycleRun(run, rows) {
  return {
    id: run.id,
    state: run.state,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    appliedAt: run.applied_at,
    createdBy: run.created_by,
    createdByEmail: run.created_by_email,
    salesforce: run.salesforce || {},
    xero: run.xero || {},
    usageCache: run.usage_cache || {},
    xeroCallEstimate: run.xero_call_estimate || {},
    summary: run.summary || {},
    error: run.error_message || null,
    rows: rows.map(serializeLifecycleRow),
  };
}

function serializeLifecycleRow(row) {
  return {
    ...(row.raw_row || {}),
    id: row.row_id,
    action: row.action,
    status: row.status,
    reason: row.reason,
    selected: row.selected === true,
    salesforceAccountId: row.salesforce_account_id,
    salesforceRecordType: row.salesforce_record_type,
    salesforceCompanyCode: row.salesforce_cl_key,
    salesforceName: row.salesforce_name,
    proposedName: row.proposed_name,
    xeroContactId: row.xero_contact_id,
    xeroContactName: row.xero_contact_name,
    xeroContactNumber: row.xero_contact_number,
    xeroAccountNumber: row.xero_account_number,
    xeroContactStatus: row.xero_contact_status,
    matchField: row.match_field,
    usage: row.usage_evidence || [],
    idempotencyKey: row.idempotency_key,
    appliedAt: row.applied_at,
    message: row.message,
    validationErrors: row.validation_errors || [],
  };
}

function serializeAutoCreateRow(row) {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    message: row.message,
    salesforceAccountId: row.salesforce_account_id,
    salesforceName: row.salesforce_name,
    salesforceCompanyCode: row.salesforce_cl_key,
    salesforceRecordType: row.salesforce_record_type,
    xeroContactId: row.xero_contact_id,
    xeroContactName: row.xero_contact_name,
    matchField: row.match_field,
    appliedAt: row.applied_at,
    idempotencyKey: row.idempotency_key,
    validationErrors: row.validation_errors || [],
    sourceRecords: row.source_records || [],
  };
}

function lifecycleRowFromRenameRow(row, contact, usage) {
  const base = xeroContactRow(contact, {
    usage,
    salesforceAccountId: row.salesforceAccountId,
    salesforceName: row.salesforceName,
    salesforceCompanyCode: row.salesforceCompanyCode,
    salesforceRecordType: row.salesforceRecordType,
    proposedName: row.proposedName,
    matchField: row.matchField,
  });

  if (row.status === 'eligible') {
    return { ...base, action: 'rename', status: 'eligible', message: 'Ready to sync Xero contact name from Salesforce.' };
  }
  if (row.reason === 'unchanged-name') {
    return {
      ...base,
      action: 'keep',
      status: 'kept',
      reason: 'unchanged-name',
      message: CONTACT_LIFECYCLE_REASON_LABELS['unchanged-name'],
    };
  }
  return {
    ...base,
    action: 'exception',
    status: 'blocked',
    reason: row.reason,
    message: row.message || (row.reason ? CONTACT_LIFECYCLE_REASON_LABELS[row.reason] : 'Cannot sync safely.'),
  };
}

function xeroContactRow(contact, overrides = {}) {
  return {
    id: `xero-${contact.contactId}`,
    action: 'keep',
    status: 'kept',
    xeroContactId: contact.contactId,
    xeroContactName: nonBlank(contact.name),
    xeroContactNumber: nonBlank(contact.contactNumber),
    xeroAccountNumber: nonBlank(contact.accountNumber),
    xeroContactStatus: nonBlank(contact.status),
    xeroIsCustomer: contact.isCustomer === true,
    xeroIsSupplier: contact.isSupplier === true,
    xeroAccountsReceivableOutstanding: numberValue(contact.accountsReceivableOutstanding),
    xeroAccountsPayableOutstanding: numberValue(contact.accountsPayableOutstanding),
    usage: [],
    ...overrides,
  };
}

function buildSalesforceProtectionIndexes(accounts) {
  const salesforceNames = new Set();
  const hkStrippedClKeyNames = new Set();
  for (const account of accounts) {
    const salesforceName = normalizeName(account.name);
    if (salesforceName) salesforceNames.add(salesforceName);
    const clKeyName = hkStrippedClKeyNameMatchKey(account.companyCode);
    if (clKeyName) hkStrippedClKeyNames.add(clKeyName);
  }
  return { salesforceNames, hkStrippedClKeyNames };
}

function isProtectedBySalesforce(contact, indexes) {
  const contactName = normalizeName(contact.name);
  return indexes.salesforceNames.has(contactName) || indexes.hkStrippedClKeyNames.has(contactName);
}

function usageEvidenceFor(contactId, usageByContactId) {
  const usage = usageByContactId instanceof Map ? usageByContactId.get(contactId) : usageByContactId?.[contactId];
  return Array.isArray(usage) ? usage : [];
}

function compareLifecycleRows(first, second) {
  const actionOrder = { archive: 0, rename: 1, exception: 2, keep: 3 };
  const actionDifference = (actionOrder[first.action] ?? 9) - (actionOrder[second.action] ?? 9);
  if (actionDifference !== 0) return actionDifference;
  return normalizeName(first.xeroContactName || first.salesforceName).localeCompare(
    normalizeName(second.xeroContactName || second.salesforceName),
  );
}

function toLifecycleContact(contact) {
  return {
    contactId: nonBlank(contact.ContactID),
    name: nonBlank(contact.Name),
    contactNumber: nonBlank(contact.ContactNumber),
    accountNumber: nonBlank(contact.AccountNumber),
    status: nonBlank(contact.ContactStatus),
    isCustomer: contact.IsCustomer === true,
    isSupplier: contact.IsSupplier === true,
    accountsReceivableOutstanding: numberValue(contact.Balances?.AccountsReceivable?.Outstanding ?? contact.AccountsReceivable?.Outstanding),
    accountsPayableOutstanding: numberValue(contact.Balances?.AccountsPayable?.Outstanding ?? contact.AccountsPayable?.Outstanding),
    updatedDateUtc: contact.UpdatedDateUTC,
  };
}

function contactIdsFromUsageRecord(record) {
  return [
    record.Contact?.ContactID,
    record.Invoice?.Contact?.ContactID,
    record.BankTransaction?.Contact?.ContactID,
    record.Overpayment?.Contact?.ContactID,
    record.Prepayment?.Contact?.ContactID,
  ].map((id) => nonBlank(id)).filter(Boolean);
}

async function updateContactNameCacheFromLifecycle(client, connection, rows) {
  const { data } = await client
    .from('xero_contact_name_cache')
    .select('*')
    .eq('id', 'primary')
    .maybeSingle();
  if (!data?.contacts) return;
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];
  const byId = new Map(contacts.map((contact) => [contact.contactId, contact]));
  for (const row of rows) {
    if (row.status === 'updated' && row.xeroContactId) {
      byId.set(row.xeroContactId, {
        contactId: row.xeroContactId,
        name: row.xeroContactName || row.proposedName,
        contactNumber: row.xeroContactNumber || '',
        accountNumber: row.xeroAccountNumber || '',
        status: row.xeroContactStatus || 'ACTIVE',
      });
    }
    if (row.status === 'archived' && row.xeroContactId && byId.has(row.xeroContactId)) {
      byId.set(row.xeroContactId, { ...byId.get(row.xeroContactId), status: 'ARCHIVED' });
    }
  }
  const nextContacts = [...byId.values()].sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)));
  await client.from('xero_contact_name_cache').upsert({
    id: 'primary',
    tenant_id: connection.tenantId,
    tenant_name: connection.tenantName,
    contacts: nextContacts,
    contact_count: nextContacts.length,
    refreshed_at: data.refreshed_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
}

async function loadReceipt(client, id) {
  const receiptId = nonBlank(id);
  if (!receiptId) throw portalError('Receipt ID is required.', 400, 'XERO_PORTAL_RECEIPT_ID_REQUIRED');
  const { data, error } = await client.from('xero_portal_receipts').select('*').eq('id', receiptId).maybeSingle();
  if (error) throw storageError(error, 'xero_portal_receipts');
  if (!data) throw portalError('Receipt was not found.', 404, 'XERO_PORTAL_RECEIPT_NOT_FOUND');
  return data;
}

async function updateReceipt(client, id, patch) {
  const { data, error } = await client
    .from('xero_portal_receipts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw storageError(error, 'xero_portal_receipts');
  return data;
}

function serializeReceipt(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    merchant: row.merchant,
    date: row.receipt_date,
    total: row.total == null ? null : Number(row.total),
    currency: row.currency,
    category: row.category,
    accountCode: row.account_code,
    taxType: row.tax_type,
    note: row.note || '',
    ocrText: row.ocr_text || '',
    fileName: row.file_name,
    fileType: row.file_type,
    fileSizeBytes: Number(row.file_size_bytes || 0),
    status: row.status,
    autoSynced: row.auto_synced === true,
    xeroInvoiceId: row.xero_invoice_id,
    xeroInvoiceUrl: row.xero_invoice_url,
    error: row.error_message,
  };
}

function normalizeReceiptFields(input) {
  return {
    merchant: nonBlank(input.merchant),
    date: normalizeDate(input.date),
    total: numberOrNull(input.total),
    currency: normalizeCurrency(input.currency),
    category: nonBlank(input.category) || 'General expense',
    accountCode: nonBlank(input.accountCode || input.account_code) || '429',
    taxType: nonBlank(input.taxType || input.tax_type) || 'NONE',
    note: String(input.note || ''),
    ocrText: String(input.ocrText || input.ocr_text || ''),
  };
}

function decodeReceiptFile(file) {
  const value = objectValue(file);
  const base64 = nonBlank(value.base64 || value.data || value.content).replace(/^data:[^;]+;base64,/i, '');
  if (!base64) throw portalError('Receipt file is required.', 400, 'XERO_PORTAL_RECEIPT_FILE_REQUIRED');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw portalError('Receipt file could not be decoded.', 400, 'XERO_PORTAL_RECEIPT_FILE_INVALID');
  if (buffer.length > MAX_RECEIPT_BYTES) throw portalError('Receipt file is larger than 10 MB.', 413, 'XERO_PORTAL_RECEIPT_FILE_TOO_LARGE');
  return {
    buffer,
    fileName: nonBlank(value.fileName || value.name) || 'receipt',
    fileType: nonBlank(value.fileType || value.type) || 'application/octet-stream',
  };
}

function sanitizeFileName(fileName) {
  return nonBlank(fileName)
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 140) || 'receipt';
}

function normalizeDate(value) {
  const text = nonBlank(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10);
}

function normalizeCurrency(value) {
  const text = nonBlank(value).toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : 'HKD';
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasNonzeroBalance(contact) {
  return Math.abs(numberValue(contact.accountsReceivableOutstanding)) > 0.0001
    || Math.abs(numberValue(contact.accountsPayableOutstanding)) > 0.0001;
}

function isActive(contact) {
  return nonBlank(contact.status).toUpperCase() === 'ACTIVE';
}

function isArchived(contact) {
  return nonBlank(contact.status).toUpperCase() === 'ARCHIVED';
}

function isNonArchived(contact) {
  return !isArchived(contact);
}

function isNonArchivedLifecycleRow(row) {
  return nonBlank(row.xeroContactStatus).toUpperCase() !== 'ARCHIVED';
}

function groupBy(items, getKey) {
  const grouped = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    const matches = grouped.get(key) || [];
    matches.push(item);
    grouped.set(key, matches);
  }
  return grouped;
}

function recentStemDeliveryFrom(env) {
  return env.SALESFORCE_RECENT_STEM_DELIVERY_FROM || DEFAULT_RECENT_STEM_DELIVERY_FROM;
}

function normalizedSalesforceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw portalError('SALESFORCE_RECENT_STEM_DELIVERY_FROM must use YYYY-MM-DD format.', 500, 'XERO_PORTAL_SALESFORCE_DATE_INVALID');
  return value;
}

function isSalesforceAccountId(value) {
  return /^001[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(value);
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function xeroContactDelayMs(env) {
  return Number(env.XERO_CONTACT_SYNC_DELAY_MS || '1100');
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

function storageError(error, table) {
  if (isMissingTableError(error)) {
    return portalError(`Apply the native Xero Portal Supabase migration before using ${table}.`, 503, 'XERO_PORTAL_MIGRATION_REQUIRED');
  }
  error.expose = error.status < 500;
  return error;
}

function isMissingTableError(error) {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /schema cache|does not exist|relation .* does not exist/i.test(String(error?.message || ''));
}

function portalError(message, status = 400, code = 'XERO_PORTAL_REJECTED', details = undefined) {
  const error = xeroContactSyncError(message, status, code, status < 500);
  if (details !== undefined) error.details = details;
  return error;
}

function oauthStateSecret(env) {
  const secret = nonBlank(env.XERO_OAUTH_STATE_SECRET || env.SALESFORCE_CONTACT_SYNC_SECRET || env.XERO_CONTACT_SYNC_SECRET || env.XERO_CLIENT_SECRET);
  if (!secret) throw portalError('XERO_OAUTH_STATE_SECRET or XERO_CLIENT_SECRET is required for Xero OAuth state signing.', 503, 'XERO_PORTAL_STATE_SECRET_MISSING');
  return secret;
}

function timingSafeStringEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonBlank(value) {
  return String(value ?? '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

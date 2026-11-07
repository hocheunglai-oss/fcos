import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { XERO_RECONCILIATION_VERSION } from './_xeroFinancialSync.js';
import { hydratePreviewPayments } from './_xeroPreviewPayments.js';
import { previewEvidenceHash } from './_xeroPreviewPersistence.js';

// Reporting is a projection of saved observations. It is never a provider
// check, financial approval, or source-universe census.
const ROW_CAP = 3000;
const HISTORY_CAP = 500;
const RUN_LOOKUP_CAP = 20;
const READ_PAGE = 250;
const STALE_MS = 24 * 60 * 60 * 1000;
const STATUSES = ['matched', 'missing', 'mismatched', 'blocked', 'uncertain', 'unverified'];
const KINDS = ['buyer_invoice', 'buyer_credit', 'supplier_bill', 'supplier_credit', 'payment', 'contact'];
const INPUTS = new Set(['from', 'to', 'search', 'status', 'kind', 'page', 'pageSize', 'historyPage', 'historyPageSize']);
const READ_RPCS = new Set(['xero_preview_checkpoint_load_v2', 'xero_preview_checkpoint_read_chunks_v2']);
const SF_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const text = value => typeof value === 'string' ? value.slice(0, 1000) : null;
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value)) ? Number(value) : null;
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const scalar = value => typeof value === 'string' ? text(value) : typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' ? value : null;
const strings = value => Array.isArray(value) ? value.filter(entry => typeof entry === 'string').map(text).slice(0, 20) : [];

function invalid(message) { return Object.assign(new Error(message), { status: 400, code: 'XERO_INTEGRITY_FILTER_INVALID', expose: true }); }

export function integrityFilters(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !INPUTS.has(key))) {
    throw invalid('Only report filters and pagination are accepted. Run review, approval and sync operations in Codex.');
  }
  const from = body.from === undefined ? '2026-01-01' : isoDate(body.from);
  const to = body.to == null || body.to === '' ? null : isoDate(body.to);
  if (!from || body.to != null && body.to !== '' && !to || to && to < from) throw invalid('Use a valid date range.');
  const page = (key, fallback, max) => {
    const value = body[key] === undefined ? fallback : body[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw invalid('Report pagination is invalid.');
    return value;
  };
  if (body.search != null && (typeof body.search !== 'string' || body.search.length > 200)) throw invalid('Search must be at most 200 characters.');
  const status = body.status || 'all'; const kind = body.kind || 'all';
  if (status !== 'all' && !STATUSES.includes(status) || kind !== 'all' && !KINDS.includes(kind)) throw invalid('Unknown report filter.');
  return { from, to, search: (body.search || '').trim().toLowerCase(), status, kind,
    page: page('page', 1, 100000), pageSize: page('pageSize', 25, 100),
    historyPage: page('historyPage', 1, 100000), historyPageSize: page('historyPageSize', 20, 100) };
}

function salesforceUrl(id, sfObject) {
  if (!SF_ID.test(id || '') || !['Invoice__c', 'Supplier_Invoice__c', 'Payment__c', 'Account'].includes(sfObject)) return null;
  const { instanceUrl } = fcosSalesforceEnvironment('production');
  return instanceUrl ? `${instanceUrl}/lightning/r/${sfObject}/${id}/view` : null;
}

function xeroUrl(id, kind) {
  if (!UUID.test(id || '')) return null;
  if (kind === 'contact') return `https://go.xero.com/Contacts/View.aspx?contactID=${id}`;
  if (kind.includes('credit')) return `https://go.xero.com/${kind === 'supplier_credit' ? 'AccountsPayable' : 'AccountsReceivable'}/ViewCreditNote.aspx?creditNoteID=${id}`;
  return `https://go.xero.com/${kind === 'supplier_bill' ? 'AccountsPayable' : 'AccountsReceivable'}/View.aspx?InvoiceID=${id}`;
}

function safeDifferences(value) {
  const displayFields = new Set(['date', 'dueDate', 'invoiceNumber', 'reference', 'total', 'currency', 'contact', 'name',
    'Date', 'DueDate', 'InvoiceNumber', 'Reference', 'Total', 'CurrencyCode', 'Description', 'detailedLines', 'lines', 'account', 'tax']);
  return Array.isArray(value) ? value.filter(entry => displayFields.has(entry?.field)).slice(0, 30).map(entry => ({ field: text(entry?.field) || 'Unspecified field',
    source: scalar(entry?.salesforce ?? entry?.source ?? entry?.expected), xero: scalar(entry?.xero ?? entry?.current),
  })) : [];
}

function documentFields(value, raw = false) {
  const row = object(value);
  return { documentNumber: text(raw ? row.InvoiceNumber : row.documentNumber ?? row.invoiceNumber ?? row.creditNoteNumber),
    reference: text(raw ? row.Reference : row.reference), date: raw ? isoDate(row.Date) : isoDate(row.invoiceDate ?? row.date),
    dueDate: raw ? isoDate(row.DueDate) : isoDate(row.dueDate), currency: text(raw ? row.CurrencyCode : row.currency),
    total: number(raw ? row.Total : row.total), status: text(raw ? row.Status : row.status),
    contact: text(raw ? row.Contact?.Name : row.accountName ?? row.contactName),
    lineCount: Array.isArray(raw ? row.LineItems : row.lines ?? row.lineItems) ? (raw ? row.LineItems : row.lines ?? row.lineItems).length : null };
}

function uncertainty(...values) { return values.some(value => /uncertain|unknown|unconfirmed/i.test(String(value || ''))); }

export function integrityDocumentRow(item, checkedAt) {
  const source = object(item.source_payload); const xero = object(item.xero_payload);
  const projection = object(source.documentFieldProjection);
  // Legacy source.deliveryDate is STEM delivery, not the approved buyer-invoice
  // delivery date. Do not silently use it for this report's date scope.
  const date = projection.evidence?.dateSource === 'Invoice__c.Delivery_Date__c' ? isoDate(projection.fields?.Date) : null;
  const blockers = strings(item.blockers); const differences = safeDifferences(item.differences);
  const correction = object(source.documentFieldCorrection);
  const headerDifferences = safeDifferences(correction.differences);
  differences.push(...headerDifferences);
  const id = item.xero_document_id || xero.id;
  const kind = KINDS.includes(item.source_type) ? item.source_type : 'buyer_invoice';
  for (const [field, expected, actual] of [['total', number(item.source_total), number(xero.total)], ['currency', item.currency, xero.currency]]) {
    if (expected != null && actual != null && String(expected) !== String(actual)
      && !differences.some(row => row.field === field)) differences.push({ field, source: scalar(expected), xero: scalar(actual) });
  }
  if (id && projection.fields) {
    for (const [field, key] of [['Date', 'date'], ['DueDate', 'dueDate'], ['InvoiceNumber', 'invoiceNumber'], ['Reference', 'reference']]) {
      const expected = projection.fields[field]; const actual = xero[key];
      if (expected != null && actual != null && String(expected) !== String(actual)
        && !differences.some(row => row.field.toLowerCase() === field.toLowerCase())) differences.push({ field, source: scalar(expected), xero: scalar(actual) });
    }
  }
  const sourceTotal = number(item.source_total) ?? number(source.total);
  const observedTotal = number(xero.total);
  if (id && sourceTotal !== null && observedTotal !== null
    && Math.round(sourceTotal * 100) !== Math.round(observedTotal * 100)
    && !differences.some(row => row.field.toLowerCase() === 'total')) {
    differences.push({ field: 'total', source: sourceTotal, xero: observedTotal });
  }
  if (id && item.currency && xero.currency && item.currency !== xero.currency
    && !differences.some(row => row.field.toLowerCase().includes('currency'))) {
    differences.push({ field: 'currency', source: text(item.currency), xero: text(xero.currency) });
  }
  let status = 'unverified';
  if (uncertainty(item.status, item.error_code)) status = 'uncertain';
  else if (item.status === 'blocked' || item.status === 'failed' || blockers.length) status = 'blocked';
  else if ((Array.isArray(item.differences) && item.differences.length) || differences.length) status = 'mismatched';
  else if (!id && item.proposed_action === 'create_draft') status = 'missing';
  else if (UUID.test(id || '') && observedTotal !== null && xero.currency
    && (item.status === 'linked' || item.status === 'protected' && source.acceptedLegacy === true)) status = 'matched';
  // Creation/update statuses alone do not prove an exact provider readback.
  const sourceValues = documentFields(source);
  sourceValues.date = date;
  if (projection.fields) {
    sourceValues.documentNumber = text(projection.fields.InvoiceNumber) || sourceValues.documentNumber;
    sourceValues.reference = text(projection.fields.Reference) || sourceValues.reference;
    sourceValues.dueDate = isoDate(projection.fields.DueDate) || sourceValues.dueDate;
  }
  return { id: `document:${item.id}`, kind, status, documentNumber: text(item.source_document_number ?? source.documentNumber),
    stemReference: text(projection.evidence?.refCode ?? source.stemKey ?? source.stemName), accountName: text(source.accountName),
    date, reason: blockers.join(' ') || (status === 'mismatched' ? 'Saved Salesforce and Xero fields differ.'
      : status === 'missing' ? 'No existing Xero document was matched in the saved check.'
        : status === 'matched' ? 'A verified existing link is recorded in this saved check.' : 'Exact verified matching evidence is unavailable.'),
    checkedAt, sourceValues, xeroValues: documentFields(xero), differences,
    sourceUrl: salesforceUrl(item.source_id, item.source_object), xeroUrl: xeroUrl(id, kind),
    amount: number(source.signedTotal) ?? (number(item.source_total) === null ? null : number(item.source_total) * (kind.includes('credit') ? -1 : 1)),
    currency: /^[A-Z]{3}$/.test(item.currency || '') ? item.currency : null };
}

function paymentRow(row, checkedAt) {
  const blockers = strings(row.blockers);
  const status = uncertainty(row.status, row.errorCode) ? 'uncertain' : blockers.length || row.status === 'blocked' ? 'blocked'
    : row.action === 'payment_apply' && !row.xeroPaymentId ? 'missing' : 'unverified';
  return { id: `payment:${text(row.salesforcePaymentId) || text(row.id)}`, kind: 'payment', status,
    documentNumber: text(row.salesforcePaymentName), stemReference: text(row.stemReference ?? row.stemName), accountName: text(row.accountName),
    date: isoDate(row.paymentDate), reason: blockers.join(' ') || 'Saved payment allocation evidence requires verified readback in Codex.', checkedAt,
    sourceValues: { amount: number(row.amount), currency: text(row.currency), date: isoDate(row.paymentDate) },
    xeroValues: { documentNumber: text(row.xeroDocumentNumber), paymentRecorded: Boolean(row.xeroPaymentId), amount: null }, differences: [],
    sourceUrl: salesforceUrl(row.salesforcePaymentId, 'Payment__c'), xeroUrl: xeroUrl(row.xeroDocumentId, row.type === 'Buyer' ? 'buyer_invoice' : 'supplier_bill'),
    amount: number(row.amount), currency: /^[A-Z]{3}$/.test(row.currency || '') ? row.currency : null };
}

function contactRow(row, checkedAt) {
  let status = 'unverified';
  if (uncertainty(row.status)) status = 'uncertain';
  else if (!row.xero_contact_id && row.reason === 'missing-xero-contact') status = 'missing';
  else if (['blocked', 'failed'].includes(row.status) || row.action === 'exception') status = 'blocked';
  else if (row.action === 'rename' || row.salesforce_name && row.xero_contact_name && row.salesforce_name !== row.xero_contact_name) status = 'mismatched';
  else if (row.action === 'keep' && row.xero_contact_id && row.salesforce_account_id && row.salesforce_name === row.xero_contact_name) status = 'matched';
  return { id: `contact:${row.id}`, kind: 'contact', status, documentNumber: null, stemReference: null,
    accountName: text(row.salesforce_name ?? row.xero_contact_name), date: null, reason: text(row.reason) || 'Saved Contact identity snapshot.', checkedAt,
    sourceValues: { name: text(row.salesforce_name), companyCode: text(row.salesforce_cl_key) },
    xeroValues: { name: text(row.xero_contact_name), status: text(row.xero_contact_status) }, differences: row.salesforce_name !== row.xero_contact_name
      ? [{ field: 'name', source: text(row.salesforce_name), xero: text(row.xero_contact_name) }] : [],
    sourceUrl: salesforceUrl(row.salesforce_account_id, 'Account'), xeroUrl: xeroUrl(row.xero_contact_id, 'contact'), amount: null, currency: null };
}

export function integrityCorrectionHistory(claims, events) {
  const latest = new Map();
  for (const event of events) {
    const previous = latest.get(event.claim_id);
    if (!previous || BigInt(event.sequence || 0) > BigInt(previous.sequence || 0)) latest.set(event.claim_id, event);
  }
  return claims.map(claim => {
    const evidence = object(claim.evidence); const event = latest.get(claim.id); const observed = object(event?.evidence?.observed);
    const expected = object(evidence.expectedAfter);
    const before = documentFields(evidence.before, true); const after = documentFields(observed, true);
    const validProjection = evidence.policyVersion === 'document_field_correction_v1' && claim.evidence_hash === previewEvidenceHash(evidence)
      && event?.status === 'confirmed' && event.evidence?.basis === 'exact_provider_readback'
      && event.evidence_hash === previewEvidenceHash(event.evidence)
      && observed.InvoiceID === claim.xero_invoice_id && Object.keys(expected).length > 0
      && previewEvidenceHash(observed) === previewEvidenceHash(expected);
    const rejected = event?.status === 'rejected' && claim.evidence_hash === previewEvidenceHash(evidence)
      && event.evidence_hash === previewEvidenceHash(event.evidence);
    const previewId = String(claim.idempotency_key || '').split(':')[1];
    return { id: `correction:${claim.id}`, batchId: UUID.test(previewId || '') ? previewId : text(evidence.batchId),
      documentNumber: text(evidence.source?.documentNumber), kind: evidence.source?.documentKind === 'supplier_bill' ? 'supplier_bill' : 'buyer_invoice',
      status: validProjection ? 'confirmed' : rejected ? 'rejected' : 'uncertain',
      occurredAt: instant(event?.created_at ?? claim.created_at), before, after: Object.keys(observed).length ? after : null,
      readbackVerified: Boolean(validProjection), notice: validProjection ? 'Exact provider readback verified; protected financial fields preserved.'
        : rejected ? 'Correction rejected; no successful correction is recorded.' : 'No exact confirmed readback is recorded. Resolve this operation in Codex.',
      date: isoDate(evidence.projection?.header?.Date) };
  });
}

async function savedRead(query, label, errors) {
  try {
    const result = await query;
    if (result.error) throw new Error('saved-read');
    return result;
  } catch {
    errors.push({ code: 'XERO_INTEGRITY_SAVED_READ_UNAVAILABLE', message: `Saved ${label} evidence is unavailable.` });
    return { data: null, error: true, count: null };
  }
}

// Select candidate IDs through the timestamp index before inspecting large JSON
// snapshots. Filtering every historical workflowSnapshot can exhaust PostgREST's
// statement timeout. The candidate window is explicit; it is not global coverage.
async function boundedRunRead(client, { mode = null, columns, limit }, tenantId, label, errors) {
  let candidates = client.from('xero_financial_sync_runs').select('id,mode,status,created_at');
  if (mode) candidates = candidates.eq('mode', mode).not('status', 'in', '(building,cancelled)');
  const recent = await savedRead(candidates.order('created_at', { ascending: false }).limit(RUN_LOOKUP_CAP), label, errors);
  if (recent.error || !recent.data?.length) return recent;
  return savedRead(client.from('xero_financial_sync_runs').select(columns)
    .in('id', recent.data.map(row => row.id))
    .eq('control_totals->workflowSnapshot->>tenantId', tenantId)
    .eq('control_totals->workflowSnapshot->>salesforceOrgId', fcosSalesforceEnvironment('production').orgId)
    .order('created_at', { ascending: false }).order('id').limit(limit), label, errors);
}

async function boundedRows(factory, cap, label, errors) {
  const rows = []; let total = null;
  while (rows.length < cap) {
    const result = await savedRead(factory().range(rows.length, Math.min(cap, rows.length + READ_PAGE) - 1), label, errors);
    if (result.error || !Array.isArray(result.data)) return { rows, available: false, complete: false, total };
    if (Number.isSafeInteger(result.count) && result.count >= 0) total = result.count;
    rows.push(...result.data);
    if (!result.data.length || result.data.length < READ_PAGE || total !== null && rows.length >= total) {
      return { rows, available: true, complete: total === null || rows.length === total, total: total ?? rows.length };
    }
  }
  return { rows, available: true, complete: total !== null && rows.length === total, total };
}

/** SQL audited in 20260930004000_xero_preview_checkpoint_chunks.sql. These two
 * modes pass p_write=false and only SELECT/verify saved metadata/chunks. No
 * creation, publication, allowance RPC, provider request or token renewal is
 * reachable. The cap bounds a dashboard read to <= 66 calls / ~16 MiB chunks. */
export async function integrityPaymentSnapshot(client, run) {
  let calls = 0;
  const readClient = { rpc(name, args) {
    if (!READ_RPCS.has(name) || ++calls > 66) throw new Error('Saved payment hydration is unavailable or exceeds the report cap.');
    return client.rpc(name, args);
  } };
  return hydratePreviewPayments(readClient, run);
}

function paginate(rows, page, pageSize) {
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), pagination: { page, pageSize, total: rows.length, hasNext: start + pageSize < rows.length } };
}

function inScope(row, filters) { return row.kind === 'contact' || row.date && row.date >= filters.from && (!filters.to || row.date <= filters.to); }

function currencyTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    // Documents and payments are separate coverage dimensions; combining them
    // would double-count settlement. Financial differences use documents only.
    if (['contact', 'payment'].includes(row.kind) || !row.currency) continue;
    const total = totals.get(row.currency) || { currency: row.currency, sourceAmount: 0, xeroAmount: 0, difference: 0, recordCount: 0 };
    const source = number(row.amount);
    const targetAmount = row.xeroValues.currency === row.currency ? number(row.xeroValues.total) : null;
    const target = targetAmount === null ? null : targetAmount * (row.kind.includes('credit') ? -1 : 1);
    total.sourceAmount = total.sourceAmount === null || source === null ? null : total.sourceAmount + source;
    total.xeroAmount = total.xeroAmount === null || target === null ? null : total.xeroAmount + target;
    total.recordCount += 1; totals.set(row.currency, total);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)).map(row => ({ ...row,
    sourceAmount: row.sourceAmount === null ? null : Math.round(row.sourceAmount * 100) / 100,
    xeroAmount: row.xeroAmount === null ? null : Math.round(row.xeroAmount * 100) / 100,
    difference: row.sourceAmount === null || row.xeroAmount === null ? null : Math.round((row.sourceAmount - row.xeroAmount) * 100) / 100 }));
}

export async function xeroIntegrityReport(body = {}, { client, accessContext, now = Date.now() } = {}) {
  const filters = integrityFilters(body);
  client ||= accessContext?.client;
  if (!client?.from) throw Object.assign(new Error('Saved reporting access is unavailable.'), { status: 503, code: 'XERO_INTEGRITY_ACCESS_UNAVAILABLE' });
  const errors = []; const notices = ['Counts describe saved evidence only. They do not establish the complete Salesforce/Xero source universe or authorise a financial action.'];
  const connectionResult = await savedRead(client.from('xero_contact_sync_connections').select('tenant_id,tenant_name').eq('id', 'primary').maybeSingle(), 'organisation', errors);
  const tenantId = connectionResult.data?.tenant_id;
  const coverage = [];
  let rows = []; let history = []; let checkedAt = null; let lastConfirmedCorrectionAt = null; let quota = null;
  let recentRuns = [];
  if (!UUID.test(tenantId || '')) notices.push('The approved saved Xero organisation is unavailable. No records can be safely attributed to this organisation.');
  else {
    const [runResult, contactsResult, claimsResult, quotaResult, recentResult] = await Promise.all([
      boundedRunRead(client, { mode: 'preview', columns: 'id,mode,status,cutoff_date,source_snapshot_at,xero_snapshot_at,control_totals,classification_summary,error_code,created_by,created_at,completed_at', limit: 1 }, tenantId, 'document check', errors),
      savedRead(client.from('xero_contact_lifecycle_runs').select('id,state,xero,row_count,created_at,applied_at')
        .eq('xero->>tenantId', tenantId).order('created_at', { ascending: false }).limit(1), 'Contact identity check', errors),
      boundedRows(() => client.from('xero_document_field_correction_claims').select('id,tenant_id,xero_invoice_id,idempotency_key,evidence,evidence_hash,created_at', { count: 'exact' })
        .eq('tenant_id', tenantId).order('created_at', { ascending: false }).order('id'), HISTORY_CAP, 'correction claims', errors),
      savedRead(client.from('xero_shared_tenant_control').select('tenant_id,allowance_known,available_calls,observed_at,retry_at,daily_hold')
        .eq('tenant_id', tenantId).maybeSingle(), 'quota', errors),
      boundedRunRead(client, { columns: 'id,mode,status,created_at,completed_at,classification_summary,error_code', limit: 10 }, tenantId, 'recent run metadata', errors),
    ]);
    notices.push(`Document lookup checks the latest ${RUN_LOOKUP_CAP} saved preview candidates; recent-run metadata checks the latest ${RUN_LOOKUP_CAP} runs. Older or unbound evidence is not included.`);
    recentRuns = (recentResult.data || []).map(row => ({ id: row.id, mode: text(row.mode), status: text(row.status),
      createdAt: instant(row.created_at), completedAt: instant(row.completed_at),
      counts: Object.fromEntries(['total', 'linked', 'updated', 'created', 'applied', 'failed', 'blocked', 'eligible'].filter(key =>
        Number.isSafeInteger(row.classification_summary?.[key]) && row.classification_summary[key] >= 0).map(key => [key, row.classification_summary[key]])),
      errorCode: /^XERO_[A-Z0-9_]+$/.test(row.error_code || '') ? row.error_code : null, readbackVerified: false }));
    const run = runResult.data?.[0]; const snapshot = object(run?.control_totals?.workflowSnapshot);
    const validRun = run && snapshot.tenantId === tenantId && snapshot.reconciliationVersion === XERO_RECONCILIATION_VERSION
      && snapshot.salesforceOrgId === fcosSalesforceEnvironment('production').orgId
      && [1, 2].includes(snapshot.persistenceVersion)
      && (!snapshot.paymentsReference || snapshot.paymentsReference.salesforceOrgId === fcosSalesforceEnvironment('production').orgId);
    const runNotice = runResult.error ? 'Saved document evidence is unavailable.' : !run ? 'No saved document check for this organisation.'
      : !validRun ? 'The saved document check uses unsupported policy or org evidence. Recheck through Codex.' : null;
    let items = { rows: [], available: false, complete: false, total: null }; let paymentRows = null;
    let savedRowsComplete = false;
    if (validRun) {
      checkedAt = instant(snapshot.checkedAt ?? run.source_snapshot_at ?? run.xero_snapshot_at ?? run.created_at);
      items = await boundedRows(() => client.from('xero_financial_sync_items')
        .select('id,source_object,source_id,source_type,source_document_number,currency,source_total,proposed_action,status,blockers,source_payload,xero_payload,differences,xero_document_id,error_code,applied_at', { count: 'exact' })
        .eq('run_id', run.id).order('row_index'), ROW_CAP, 'document rows', errors);
      rows.push(...items.rows.map(row => integrityDocumentRow(row, checkedAt)));
      savedRowsComplete = items.complete && snapshot.complete === true && Number.isSafeInteger(snapshot.expectedItemCount)
        && snapshot.expectedItemCount === items.total && snapshot.expectedItemCount === items.rows.length;
      if (!savedRowsComplete) notices.push('The complete saved document row count could not be confirmed against its capture manifest.');
      if (!items.complete) notices.push('Document counts are partial: saved rows were capped or could not be fully loaded.');
      if (snapshot.includePayments === true) {
        try {
          const hydrated = await integrityPaymentSnapshot(client, run);
          if (!Array.isArray(hydrated.payments?.rows) || hydrated.payments.tenantId !== tenantId) throw new Error('payments');
          paymentRows = hydrated.payments.rows;
          rows.push(...paymentRows.slice(0, ROW_CAP).map(row => paymentRow(row, checkedAt)));
          if (paymentRows.length > ROW_CAP) notices.push(`Payment observations are partial: ${ROW_CAP} of ${paymentRows.length} saved rows were loaded.`);
        } catch { errors.push({ code: 'XERO_INTEGRITY_PAYMENT_EVIDENCE_UNAVAILABLE', message: 'Saved payment capture could not be verified or exceeded the report read limit.' }); }
      }
    }
    for (const [key, label, kinds] of [['sales', 'Sales invoices / credits', ['buyer_invoice', 'buyer_credit']], ['bills', 'Supplier bills / credits', ['supplier_bill', 'supplier_credit']]]) {
      coverage.push({ key, label, checkedAt, available: Boolean(validRun && items.available), complete: Boolean(validRun && savedRowsComplete),
        total: validRun && items.available ? rows.filter(row => kinds.includes(row.kind) && inScope(row, filters)).length : null,
        notice: runNotice || 'Observed saved check only; matched records omitted by the capture cannot be counted. Missing buyer-invoice delivery dates are excluded from date scope.' });
    }
    coverage.push({ key: 'payments', label: 'Payments / allocations', checkedAt, available: paymentRows !== null,
      complete: paymentRows !== null && paymentRows.length <= ROW_CAP && snapshot.complete === true,
      total: paymentRows === null ? null : rows.filter(row => row.kind === 'payment' && inScope(row, filters)).length,
      notice: paymentRows === null ? 'A complete verified saved payment capture is unavailable.' : 'Saved payment observations only. Settlement cannot be inferred from a link or a successful API request.' });
    const contactRun = contactsResult.data?.[0];
    if (contactRun && contactRun.xero?.tenantId === tenantId) {
      const contacts = await boundedRows(() => client.from('xero_contact_lifecycle_rows')
        .select('id,action,status,reason,salesforce_account_id,salesforce_cl_key,salesforce_name,xero_contact_id,xero_contact_name,xero_contact_status', { count: 'exact' })
        .eq('run_id', contactRun.id).order('row_index'), ROW_CAP, 'Contact rows', errors);
      rows.push(...contacts.rows.map(row => contactRow(row, instant(contactRun.created_at))));
      if (!contacts.complete || contacts.total !== contactRun.row_count) notices.push('Contact observations are partial: the saved row cap, a read failure or a capture-count mismatch prevented complete loading.');
      coverage.push({ key: 'contacts', label: 'Contact identities', checkedAt: instant(contactRun.created_at), available: contacts.available,
        complete: contacts.complete && contacts.total === contactRun.row_count, total: contacts.available ? contacts.rows.length : null,
        notice: 'Saved identity snapshot; Contact records are not filtered by delivery date. Contact creation/update is not a financial-settlement check.' });
    } else coverage.push({ key: 'contacts', label: 'Contact identities', checkedAt: null, available: false, complete: false, total: null, notice: 'No saved Contact identity check for this organisation.' });
    if (claimsResult.rows.length) {
      const events = await boundedRows(() => client.from('xero_document_field_correction_events')
        .select('id,claim_id,sequence,status,evidence,evidence_hash,created_at', { count: 'exact' }).in('claim_id', claimsResult.rows.map(row => row.id))
        .order('sequence', { ascending: false }), HISTORY_CAP, 'correction outcomes', errors);
      history = integrityCorrectionHistory(claimsResult.rows, events.rows);
      if (!claimsResult.complete || !events.complete) notices.push('Correction history is partial: the report cap or a saved-read error limited available evidence.');
      lastConfirmedCorrectionAt = history.filter(row => row.readbackVerified).map(row => row.occurredAt).filter(Boolean).sort().at(-1) || null;
    }
    const savedQuota = quotaResult.data;
    const observedAt = instant(savedQuota?.observed_at);
    const quotaFresh = observedAt && now >= Date.parse(observedAt) && now - Date.parse(observedAt) <= STALE_MS;
    quota = { available: savedQuota?.allowance_known === true && Number.isSafeInteger(savedQuota.available_calls) && savedQuota.available_calls >= 0 && Boolean(quotaFresh),
      availableCalls: savedQuota?.allowance_known === true && Number.isSafeInteger(savedQuota.available_calls) && savedQuota.available_calls >= 0 ? savedQuota.available_calls : null,
      observedAt, dailyHold: savedQuota?.daily_hold === true, retryAt: instant(savedQuota?.retry_at),
      notice: quotaFresh ? 'Saved allowance observation only; it cannot authorise new requests.' : 'Fresh Xero allowance is unavailable; no provider probe is performed by the portal.' };
  }
  if (!coverage.length) for (const [key, label] of [['sales', 'Sales invoices / credits'], ['bills', 'Supplier bills / credits'], ['payments', 'Payments / allocations'], ['contacts', 'Contact identities']]) {
    coverage.push({ key, label, checkedAt: null, complete: false, available: false, total: null, notice: 'Saved evidence unavailable.' });
  }
  const undated = rows.filter(row => row.kind !== 'contact' && !row.date).length;
  if (undated) notices.push(`${undated} saved records have no verified date for the selected scope and are excluded from the totals.`);
  rows = rows.filter(row => inScope(row, filters));
  const metrics = Object.fromEntries(['checked', ...STATUSES].map(key => [key, rows.length || coverage.some(row => row.available) ? 0 : null]));
  for (const row of rows) { metrics.checked += 1; metrics[row.status] += 1; }
  const amounts = currencyTotals(rows);
  const matches = row => (!filters.search || [row.documentNumber, row.stemReference, row.accountName, row.reason].some(value => String(value || '').toLowerCase().includes(filters.search)));
  const visible = rows.filter(row => (filters.status === 'all' || row.status === filters.status) && (filters.kind === 'all' || row.kind === filters.kind) && matches(row));
  history = history.filter(row => row.date && row.date >= filters.from && (!filters.to || row.date <= filters.to) && matches(row))
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  const page = paginate(visible, filters.page, filters.pageSize); const historyPage = paginate(history, filters.historyPage, filters.historyPageSize);
  const checkedTimes = coverage.map(row => row.checkedAt).filter(Boolean).sort();
  const lastCheckedAt = checkedTimes.at(-1) || null;
  const stale = !checkedTimes.length || coverage.some(row => row.available && (!row.checkedAt || now < Date.parse(row.checkedAt) || now - Date.parse(row.checkedAt) > STALE_MS));
  return { schemaVersion: 1, generatedAt: new Date(now).toISOString(), scope: { from: filters.from, to: filters.to,
    dateBasis: 'buyer_invoice_delivery_date', contactsDateBound: false, universeTotal: null }, coverage, metrics, currencyTotals: amounts,
    rows: page.rows, pagination: page.pagination, history: historyPage.rows.map(({ date: _date, ...row }) => row), historyPagination: historyPage.pagination,
    health: { lastCheckedAt, lastSuccessfulSyncAt: null, lastConfirmedCorrectionAt, recentRuns, stale,
      errors, quota: quota || { available: false, availableCalls: null, observedAt: null, dailyHold: false, retryAt: null, notice: 'Saved quota evidence unavailable.' },
      notice: 'Refresh reloads saved evidence. History covers field corrections with exact readback; recent run status does not prove sync or financial settlement. Global sync completion is unavailable. Checks, corrections and sync are operated in Codex.' }, notices };
}

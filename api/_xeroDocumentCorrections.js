import { randomUUID } from 'node:crypto';
import { xeroRateLimitError, xeroRequestGate } from './_xeroRateLimit.js';
import { requireExternalActionGate } from './_externalActionGates.js';
import { getFreshXeroConnection, splitScopes, xeroAccountingFetch, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { previewEvidenceHash as hash } from './_xeroPreviewPersistence.js';
import { allFinancialRows, buildFinancialClassifications, loadAllXeroPages,
  loadSalesforceFinancialSnapshot, loadStoredFinancialControls, normalizeXeroInvoice, recordXeroFinancialAudit, xeroFinancialRateSnapshot, XERO_FINANCIAL_CUTOFF } from './_xeroFinancialSync.js';
import { buildDocumentFieldCorrectionPayload, evaluateDocumentFieldCorrection, verifyDocumentFieldCorrectionReadback } from './_xeroDocumentFieldPolicy.js';
import { claimDocumentCorrection, finishDocumentCorrection } from './_xeroDocumentCorrectionPersistence.js';
import { assertDocumentCorrectionPreviewBounds, buildDocumentCorrectionScope, collectDocumentCorrectionInvoices,
  compactDocumentCorrectionPreview, correctionScopeError } from './_xeroDocumentCorrectionScope.js';
import { assertCorrectionAllowance, resolveCorrectionReserveAuthority, verifyCorrectionCanary } from './_xeroDocumentCorrectionReserve.js';

const POLICY = 'document_field_correction_v1';
const TABLE = 'xero_document_field_correction_previews';
const PAGE_SIZE = 100;
// Xero's detail endpoint expands Contact/settlement fields differently from the
// paginated collection used by immutable previews. Compare the same complete
// collection representation throughout the correction and its later recovery.
const exactInvoiceReadPath = (id) => `/Invoices?IDs=${encodeURIComponent(id)}&unitdp=4&summaryOnly=false&page=1`;
const uuid = (value) => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value || '');
const sameSf = (a, b) => Boolean(a && b && a.slice(0, 15) === b.slice(0, 15));
const fail = (message, code = 'XERO_DOCUMENT_CORRECTION_INVALID', status = 409) => Object.assign(new Error(message), { code, status });
const money = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < 0.005;
const cleanText = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
const needsCompleteHistoricalIdentity = mapping => ['groupedPreservation', 'issuedSupplierPreservation']
  .some(key => mapping?.retained_differences && Object.hasOwn(mapping.retained_differences, key));
const actorFor = (context) => {
  const actor = { id: context?.profile?.id, email: String(context?.profile?.email || '').trim().toLowerCase() };
  if (!uuid(actor.id) || !actor.email) throw fail('An authenticated Finance session is required.', 'XERO_DOCUMENT_CORRECTION_ACTOR_REQUIRED', 403);
  return actor;
};
const isoDate = (value) => {
  if (typeof value !== 'string') return value;
  const ms = value.match(/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/);
  return ms ? new Date(Number(ms[1])).toISOString().slice(0, 10) : value.slice(0, 10);
};
export function canonicalCorrectionInvoice(invoice) {
  for (const [field, alias] of [['Date', 'DateString'], ['DueDate', 'DueDateString']]) {
    if (invoice[alias] !== undefined && isoDate(invoice[alias]) !== isoDate(invoice[field])) throw fail('Xero returned conflicting accounting date fields.', 'XERO_DOCUMENT_CORRECTION_UNCERTAIN');
  }
  const { UpdatedDateUTC: _updated, UpdatedDateUTCString: _updatedString, DateString: _dateString, DueDateString: _dueString, ...value } = structuredClone(invoice);
  value.Date = isoDate(value.Date); value.DueDate = isoDate(value.DueDate);
  return value;
}
async function readExactCorrectionInvoice(accountingFetch, connection, id, options, message, code = 'XERO_DOCUMENT_CORRECTION_INVALID') {
  const result = await accountingFetch(connection, exactInvoiceReadPath(id), { ...options, method: 'GET' });
  const pagination = result?.pagination;
  const completePage = pagination == null || (typeof pagination === 'object' && !Array.isArray(pagination)
    && ['page', 'pageSize', 'pageCount', 'itemCount'].every((key) => Number.isSafeInteger(pagination[key]) && pagination[key] > 0)
    && pagination.page === 1 && pagination.pageCount === 1 && pagination.itemCount === 1);
  if (!completePage || !Array.isArray(result?.Invoices) || result.Invoices.length !== 1 || result.Invoices[0]?.InvoiceID !== id) throw fail(message, code);
  return canonicalCorrectionInvoice(result.Invoices[0]);
}
function financialBuckets(lines, xero = false) {
  const result = {};
  for (const line of lines || []) {
    const key = `${xero ? line.AccountCode : line.accountCode}:${xero ? line.TaxType : line.taxType}`;
    const value = xero ? line.LineAmount : Number(line.quantity) * Number(line.unitAmount);
    if (!Number.isFinite(Number(value)) || !key.split(':').every(Boolean)) return null;
    if (xero && (Number(line.TaxAmount || 0) !== 0 || Number(line.DiscountRate || line.DiscountAmount || 0) !== 0)) return null;
    result[key] = (result[key] || 0) + Math.round(Number(value) * 100);
  }
  return result;
}
function vesselMatches(source, target) {
  const vessel = cleanText(source.vesselName);
  if (!vessel) return false;
  return source.xeroType === 'ACCREC' ? cleanText(target.Reference) === vessel
    : cleanText(target.InvoiceNumber).endsWith(`-${vessel}`) || cleanText(target.InvoiceNumber).endsWith(`- ${vessel}`);
}
const publicItem = (item) => ({ ...Object.fromEntries(['id', 'salesforceId', 'documentNumber', 'kind', 'stemKey', 'vesselName', 'xeroInvoiceId', 'outcome', 'reason', 'changes', 'projectionFingerprint'].map((key) => [key, item[key]])), sourceEvidence: item.projection?.evidence || null,
  linkOnly: item.outcome === 'eligible' && item.changes.length === 0 && !item.mapping && Boolean(item.before) });
function summary(items) {
  return { eligible: items.filter((x) => x.outcome === 'eligible').length, alreadyCompliant: items.filter((x) => x.outcome === 'already_compliant').length,
    legacyPreserved: items.filter((x) => x.outcome === 'legacy_preserved').length, blocked: items.filter((x) => x.outcome === 'blocked').length,
    applied: items.filter((x) => x.outcome === 'applied').length, uncertain: items.filter((x) => x.outcome === 'uncertain').length };
}

// Complete source and target inventories establish one-to-one ownership. The old
// ERP number itself is never treated as a Salesforce supplier invoice number.
export function buildDocumentCorrectionItems({ salesforce, xero, stored }) {
  const { sources, rows: classifications } = buildFinancialClassifications(salesforce, xero, stored);
  const raw = xero.rawInvoices || [];
  const items = sources.filter((source) => source.xeroCollection === 'Invoices').map((source) => {
    const projection = source.documentFieldProjection;
    const item = { id: randomUUID(), salesforceId: source.salesforceId, documentNumber: source.documentNumber, kind: source.documentKind,
      stemKey: source.stemKey, vesselName: source.vesselName, xeroInvoiceId: null, outcome: 'blocked', reason: '', changes: [],
      projectionFingerprint: projection?.fingerprint, source, projection, mapping: null, before: null };
    if (projection?.scope === 'legacy') return { ...item, outcome: 'legacy_preserved', reason: 'Buyer invoice delivery is before 1 January 2026.' };
    if (!projection || projection.scope !== 'current' || projection.blockers.length) return { ...item, reason: projection?.blockers.join(' ') || 'Buyer invoice delivery evidence is unavailable.' };
    if (source.blockers.length) return { ...item, reason: source.blockers.join(' ') };
    const mappings = stored.documentMappings.filter((m) => m.salesforce_object === source.salesforceObject && sameSf(m.salesforce_id, source.salesforceId));
    if (mappings.length > 1) return { ...item, reason: 'More than one saved mapping identifies this Salesforce document.' };
    const mapping = mappings[0]; item.mapping = mapping || null;
    const compatible = (target) => target.Type === source.xeroType && target.Contact?.ContactID === source.contactId
      && target.CurrencyCode === source.currency && money(target.Total, source.total) && ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID'].includes(target.Status);
    const candidates = mapping ? raw.filter((r) => r.InvoiceID === mapping.xero_document_id)
      : raw.filter((r) => compatible(r) && (r.InvoiceNumber === source.documentNumber || r.InvoiceNumber === projection.fields.InvoiceNumber
        || (isoDate(r.Date) === projection.fields.Date && vesselMatches(source, r))));
    if (candidates.length !== 1 || !compatible(candidates[0])) return { ...item, reason: candidates.length ? 'The exact source and Xero identity is ambiguous or conflicts.' : 'No verified existing Xero transaction. Use ordinary sync for a new record.' };
    const target = candidates[0]; item.xeroInvoiceId = target.InvoiceID;
    const classified = classifications.find((row) => row.salesforceId === source.salesforceId && row.salesforceObject === source.salesforceObject);
    if (mapping?.retained_differences?.issuedSupplierPreservation && classified?.status === 'blocked') return { ...item, reason: classified.blockers.join(' ') };
    if (mapping?.retained_differences?.groupedPreservation && !classified?.acceptedLegacy) return { ...item, reason: 'The existing grouped preservation receipt could not be verified.' };
    const owner = stored.documentMappings.find((m) => m.xero_document_id === target.InvoiceID
      && (m.salesforce_object !== source.salesforceObject || !sameSf(m.salesforce_id, source.salesforceId)));
    if (owner) return { ...item, reason: 'This Xero transaction is already linked to a different Salesforce document.' };
    if (source.sharedContactAccounts.length > 1 && (!mapping || !sameSf(mapping.retained_differences?.accountId, source.accountId))) return { ...item, reason: 'The shared Contact requires a verified Salesforce Account identity.' };
    if (mapping && (mapping.xero_contact_id !== target.Contact.ContactID || (mapping.retained_differences?.accountId && !sameSf(mapping.retained_differences.accountId, source.accountId)))) return { ...item, reason: 'The saved Contact or Salesforce Account identity changed.' };
    if (mapping?.protected_legacy && (mapping.source_fingerprint !== source.sourceFingerprint || mapping.financial_fingerprint !== source.financialFingerprint)) return { ...item, reason: 'Preserved source evidence changed; review the financial evidence before correction.' };
    const sourceBuckets = financialBuckets(source.lines); const targetBuckets = financialBuckets(target.LineItems, true);
    if (!sourceBuckets || !targetBuckets || hash(sourceBuckets) !== hash(targetBuckets)) return { ...item, reason: 'Account, tax or complete accounting-line totals differ; this is not a date/reference-only correction.' };
    if (source.xeroType === 'ACCREC' && raw.some((r) => r.Type === 'ACCREC' && r.InvoiceNumber === projection.fields.InvoiceNumber && r.InvoiceID !== target.InvoiceID)) return { ...item, reason: 'Another Xero sales invoice already uses the proposed invoice number.' };
    item.before = canonicalCorrectionInvoice(target);
    const eligibility = evaluateDocumentFieldCorrection({ projection, rawXeroInvoice: item.before, direction: source.xeroType === 'ACCREC' ? 'buyer' : 'supplier', organisation: xero.organisation });
    item.changes = (eligibility.differences || []).map((d) => ({ field: d.field, before: d.current, after: d.expected }));
    item.outcome = eligibility.eligible ? (item.changes.length || !mapping ? 'eligible' : 'already_compliant') : 'blocked';
    item.reason = eligibility.blockers.join(' ') || (item.changes.length ? 'Verified identity and accounting totals; only the displayed fields will change.' : mapping ? 'Already follows the confirmed mapping.' : 'Already follows the mapping; verify and link without changing Xero.');
    return item;
  });
  const targetCounts = new Map();
  for (const item of items) if (item.xeroInvoiceId) targetCounts.set(item.xeroInvoiceId, (targetCounts.get(item.xeroInvoiceId) || 0) + 1);
  for (const item of items) if (targetCounts.get(item.xeroInvoiceId) > 1) { item.outcome = 'blocked'; item.reason = 'More than one Salesforce document claims this Xero transaction.'; }
  return items;
}

async function currentEvidence(dependencies, rate, correctionSelection = null) {
  const { env = process.env, fetchImpl = fetch, client = xeroContactSyncServiceClient(env), getConnection = getFreshXeroConnection,
    loadSalesforce = loadSalesforceFinancialSnapshot, loadControls = loadStoredFinancialControls, accountingFetch = xeroAccountingFetch, loadPages = loadAllXeroPages } = dependencies;
  let callCount = 0; let allowanceAuthority = null; let correctionTenantId = null;
  const onResponse = ({ headers, status }) => {
    callCount += 1; Object.assign(rate, xeroFinancialRateSnapshot(headers, rate));
    if (status === 429) throw xeroRateLimitError(headers);
    assertCorrectionAllowance(rate, env, allowanceAuthority);
  };
  const requestGate = (tenant, operation, limits) => xeroRequestGate(fetchImpl)(tenant, () => {
    assertCorrectionAllowance(rate, env, allowanceAuthority, { beforeRequest: true }); return operation();
  }, limits);
  const options = { env, fetchImpl, onResponse, callsPerMinute: 45, retryOnRateLimit: false, requestGate };
  try {
  const connection = await getConnection(client, { env, fetchImpl });
  const scopes = splitScopes(connection.scope || '');
  if (!uuid(connection.tenantId) || !['accounting.invoices', 'accounting.transactions'].some((x) => scopes.includes(x))) throw fail('The connected Xero organisation or invoice scope is unavailable.');
  correctionTenantId = connection.tenantId;
  allowanceAuthority = resolveCorrectionReserveAuthority(env, actorFor(dependencies.accessContext), connection.tenantId);
  const [salesforce, stored] = await Promise.all([loadSalesforce(XERO_FINANCIAL_CUTOFF), loadControls(client)]);
  if (correctionSelection && stored.documentMappings.some(mapping => needsCompleteHistoricalIdentity(mapping)
    && correctionSelection.some(item => item.salesforceObject === mapping.salesforce_object && sameSf(item.salesforceId, mapping.salesforce_id)))) {
    throw fail('Preservation evidence changed after preview and requires a complete historical identity check. Create a fresh preview.');
  }
  const plan = buildDocumentCorrectionScope(salesforce, stored, XERO_FINANCIAL_CUTOFF, correctionSelection);
  // Let every already-started read finish before persisting a failure's final
  // allowance snapshot. A rejected parallel read cannot leave unobserved calls.
  const reads = await Promise.allSettled([
    loadPages(connection, '/Contacts', 'Contacts', options), accountingFetch(connection, '/Organisations', { method: 'GET', ...options }),
    collectDocumentCorrectionInvoices(connection, plan, { ...options, accountingFetch,
      loadPages: dependencies.loadCorrectionPages || dependencies.loadPages, canonicalizeInvoice: canonicalCorrectionInvoice }),
  ]);
  const failure = reads.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  const [contacts, organisations, collected] = reads.map((result) => result.value);
  const invoices = collected.invoices;
  const organisation = organisations.Organisations?.find((org) => org.OrganisationID === connection.tenantId);
  if (!organisation) throw fail('Xero organisation identity could not be verified.');
  const xero = { tenantId: connection.tenantId, cutoffDate: XERO_FINANCIAL_CUTOFF, documentIdentityScopeComplete: correctionSelection === null,
    rawInvoices: invoices, documents: invoices.filter((r) => ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID'].includes(r.Status)).map(normalizeXeroInvoice),
    inactiveDocuments: invoices.filter((r) => !['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID'].includes(r.Status)).map(normalizeXeroInvoice), contactsComplete: true,
    contacts: contacts.map((c) => ({ id: c.ContactID, name: c.Name, status: c.ContactStatus, accountNumber: c.AccountNumber || '', contactNumber: c.ContactNumber || '' })),
    organisation: { periodLockDate: organisation.PeriodLockDate ? isoDate(organisation.PeriodLockDate) : null,
      endOfYearLockDate: organisation.EndOfYearLockDate ? isoDate(organisation.EndOfYearLockDate) : null, baseCurrency: organisation.BaseCurrency } };
  const items = compactDocumentCorrectionPreview(buildDocumentCorrectionItems({ salesforce, stored, xero }), plan.scope);
  return { connection, salesforce, stored, xero, items, scope: plan.scope, get callCount() { return callCount; }, queryFingerprint: collected.queryFingerprint, onResponse, requestGate, allowanceAuthority };
  } catch (error) {
    const failure = error.code === 'XERO_FINANCIAL_XERO_INCOMPLETE'
      ? correctionScopeError() : error;
    failure.details = { ...(error.details || {}), rateLimit: { ...rate }, callCount };
    failure.correctionAllowanceAuthority = allowanceAuthority;
    failure.correctionTenantId = correctionTenantId;
    throw failure;
  }
}

export async function xeroFinancialDocumentCorrectionPreview(_body = {}, dependencies = {}) {
  const { env = process.env, client = xeroContactSyncServiceClient(env), accessContext } = dependencies;
  const actor = actorFor(accessContext); const rate = {}; let correctionTenantId = null;
  const audit = dependencies.recordAudit || recordXeroFinancialAudit;
  try {
    const evidence = await currentEvidence({ ...dependencies, client }, rate);
    correctionTenantId = evidence.connection.tenantId;
    const preview = { id: randomUUID(), tenant_id: evidence.connection.tenantId, policy: POLICY, created_by: actor.id,
      created_at: new Date().toISOString(), items: evidence.items, summary: { ...summary(evidence.items),
        legacyPreserved: evidence.scope.excludedLegacyCount, scope: evidence.scope,
        ...(evidence.allowanceAuthority ? { allowanceAuthority: evidence.allowanceAuthority } : {}) } };
    assertDocumentCorrectionPreviewBounds(preview.items, preview.summary);
    // Durable allowance observations are separate from financial runs/approval.
    await audit(client, { runId: null, eventType: 'document_correction_preview', outcome: 'complete', actor,
      counts: { ...evidence.scope, totalCount: preview.items.length, providerCalls: evidence.callCount },
      fingerprints: { tenantId: evidence.connection.tenantId, previewId: preview.id, queryFingerprint: evidence.queryFingerprint,
        ...(evidence.allowanceAuthority ? { allowanceAuthority: evidence.allowanceAuthority } : {}) }, rate });
    const { error } = await client.from(TABLE).insert(preview);
    if (error) throw fail('The complete correction preview could not be saved.', 'XERO_DOCUMENT_CORRECTION_STORAGE_FAILED', 503);
    return { policy: POLICY, previewId: preview.id, createdAt: preview.created_at, items: preview.items.slice(0, PAGE_SIZE).map(publicItem),
      totalCount: preview.items.length, nextOffset: preview.items.length > PAGE_SIZE ? PAGE_SIZE : null, summary: preview.summary,
      scope: evidence.scope, callCount: evidence.callCount, rateLimit: rate };
  } catch (error) {
    const failure = error.code === 'XERO_FINANCIAL_XERO_INCOMPLETE'
      ? correctionScopeError() : error;
    failure.details = { ...(error.details || {}), rateLimit: { ...rate } };
    try { await audit(client, { runId: null, eventType: 'document_correction_preview', outcome: 'failed', actor,
      counts: { providerCalls: error.details?.callCount || 0 },
      fingerprints: { ...(uuid(error.correctionTenantId || correctionTenantId) ? { tenantId: error.correctionTenantId || correctionTenantId } : {}),
        ...(error.correctionAllowanceAuthority ? { allowanceAuthority: error.correctionAllowanceAuthority } : {}) },
      rate, errorCode: failure.code || 'XERO_DOCUMENT_CORRECTION_PREVIEW_FAILED' }); }
    catch { failure.details.allowanceAuditUnavailable = true; }
    throw failure;
  }
}

export async function xeroFinancialDocumentCorrectionPage(body = {}, dependencies = {}) {
  const { env = process.env, client = xeroContactSyncServiceClient(env), accessContext } = dependencies;
  actorFor(accessContext);
  if (!uuid(body.previewId) || !Number.isSafeInteger(body.offset) || body.offset < 0 || body.offset % PAGE_SIZE) throw fail('Select a valid saved correction preview page.');
  const { data, error } = await client.rpc('read_xero_document_field_correction_page_v1', { p_preview_id: body.previewId, p_offset: body.offset });
  if (error || data?.id !== body.previewId || data?.policy !== POLICY || !Array.isArray(data.items)
    || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 || (body.offset > 0 && body.offset >= data.totalCount) || data.items.length !== Math.min(PAGE_SIZE, data.totalCount - body.offset)
    || data.nextOffset !== (body.offset + data.items.length < data.totalCount ? body.offset + PAGE_SIZE : null)
    || data.summary?.scope?.cutoff !== XERO_FINANCIAL_CUTOFF || !Number.isSafeInteger(data.summary.scope.totalSourceCount)
    || !Number.isSafeInteger(data.summary.scope.excludedLegacyCount) || data.summary.scope.excludedLegacyCount < 0
    || data.summary.scope.totalSourceCount !== data.totalCount + data.summary.scope.excludedLegacyCount
    || data.summary.legacyPreserved !== data.summary.scope.excludedLegacyCount) throw fail('The complete saved correction page could not be verified.');
  return { policy: POLICY, previewId: data.id, createdAt: data.created_at, summary: data.summary, totalCount: data.totalCount,
    scope: data.summary.scope, nextOffset: data.nextOffset, items: data.items.map(publicItem) };
}

function journalEvidence(item, before, _actor, preview, allowanceAuthority = null) {
  const fields = item.projection.fields; const expectedAfter = structuredClone(before);
  const header = { Date: fields.Date, DueDate: fields.DueDate, InvoiceNumber: fields.InvoiceNumber,
    ...(item.source.xeroType === 'ACCREC' ? { Reference: fields.Reference } : {}) };
  Object.assign(expectedAfter, header);
  const lineDescriptions = {};
  for (const line of expectedAfter.LineItems) { line.Description = fields.Description; lineDescriptions[line.LineItemID] = fields.Description; }
  return { policyVersion: POLICY, source: { object: item.source.salesforceObject, id: item.salesforceId, accountId: item.source.accountId,
    stemId: item.source.stemId, documentNumber: item.source.documentNumber, documentKind: item.source.documentKind,
    xeroType: item.source.xeroType, contactId: item.source.contactId, currency: item.source.currency, total: item.source.total, sourceFingerprint: item.source.sourceFingerprint, financialFingerprint: item.source.financialFingerprint,
    deliveryDate: fields.Date, fieldSourceFingerprint: item.source.documentFieldSourceFingerprint, projectionFingerprint: item.projectionFingerprint, buyerInvoiceEvidence: item.projection.evidence },
  before, expectedAfter, projection: { header, lineDescriptions }, mappingSnapshot: item.mapping,
  ...(allowanceAuthority ? { allowanceAuthority } : {}),
  authority: { basis: 'explicit_user_requested_2026_field_correction', scopeHash: hash({ previewId: preview.id, itemId: item.id, actorId: preview.created_by,
    ...(allowanceAuthority ? { allowanceAuthority } : {}) }), reviewedAt: preview.created_at } };
}

async function verifyClaim(claim, saved, context) {
  const { client, actor, accountingFetch, connection, options, finish, events = [] } = context;
  const latest = events.filter((event) => event.claim_id === claim.id).sort((a, b) => Number(b.sequence) - Number(a.sequence))[0];
  if (claim.evidence_hash !== hash(claim.evidence) || claim.evidence.source.object !== saved.source.salesforceObject
    || !sameSf(claim.evidence.source.id, saved.salesforceId) || claim.xero_invoice_id !== saved.xeroInvoiceId
    || claim.evidence.source.projectionFingerprint !== saved.projectionFingerprint) throw fail('The original correction intent could not be verified.');
  if (latest?.status === 'confirmed' && latest.evidence_hash === hash(latest.evidence)
    && hash(latest.evidence.observed) === hash(claim.evidence.expectedAfter)) return { ...publicItem(saved), outcome: 'applied', reason: 'This correction was already confirmed; no update was resent.' };
  if (latest?.status === 'rejected') return { ...publicItem(saved), outcome: 'blocked', reason: 'Xero rejected the earlier correction. Create a fresh preview.' };
  const observed = await readExactCorrectionInvoice(accountingFetch, connection, claim.xero_invoice_id, options, 'The exact correction readback is unavailable.');
  if (hash(observed) !== hash(claim.evidence.expectedAfter)) return { ...publicItem(saved), outcome: 'uncertain', reason: 'Readback does not yet confirm the exact approved correction. No update was resent; the barrier remains.' };
  await finish(client, { claimId: claim.id, status: 'confirmed', evidence: { observed, basis: 'exact_provider_readback' }, actor });
  return { ...publicItem(saved), outcome: 'applied', reason: 'Recovered through exact readback; no update was resent.' };
}

// Quota observations are separate from immutable financial intent/readback.
// Their storage must never change a correction outcome or retry its finish RPC.
async function auditCorrectionAllowance(dependencies, { client, actor, preview, stage, rate, selectedCount, providerCalls, items = [], error = null }) {
  if (!Number.isFinite(Date.parse(rate.observedAt || ''))) return false;
  try {
    await (dependencies.recordAudit || recordXeroFinancialAudit)(client, {
      runId: null, eventType: `document_correction_${stage}`, outcome: error ? 'failed' : 'complete', actor,
      counts: { selectedCount, providerCalls, ...summary(items) },
      fingerprints: { tenantId: preview.tenant_id, previewId: preview.id }, rate: { ...rate },
      errorCode: error ? (/^XERO_[A-Z0-9_]+$/.test(error.code || '') ? error.code : `XERO_DOCUMENT_CORRECTION_${stage.toUpperCase()}_FAILED`) : null,
    });
    return false;
  } catch { return true; }
}

export async function xeroFinancialDocumentCorrectionVerify(body = {}, dependencies = {}) {
  const { env = process.env, fetchImpl = fetch, client = xeroContactSyncServiceClient(env), accessContext,
    getConnection = getFreshXeroConnection, accountingFetch = xeroAccountingFetch, finish = finishDocumentCorrection } = dependencies;
  const actor = actorFor(accessContext);
  if (!uuid(body.previewId) || !Array.isArray(body.itemIds) || !body.itemIds.length || body.itemIds.length > 25
    || body.itemIds.some((id) => !uuid(id)) || new Set(body.itemIds).size !== body.itemIds.length) throw fail('Select the original correction items to verify.');
  const { data: preview, error } = await client.from(TABLE).select('*').eq('id', body.previewId).maybeSingle();
  if (error || !preview || preview.policy !== POLICY) throw fail('The original correction preview is unavailable.');
  const connection = await getConnection(client, { env, fetchImpl });
  if (connection.tenantId !== preview.tenant_id) throw fail('The reviewed Xero organisation changed.');
  const configuredAllowance = resolveCorrectionReserveAuthority(env, actor, connection.tenantId);
  const allowanceAuthority = configuredAllowance && hash(configuredAllowance) === hash(preview.summary?.allowanceAuthority)
    ? configuredAllowance : null;
  if (preview.summary?.allowanceAuthority) await verifyCorrectionCanary(client, {
    authority: preview.summary.allowanceAuthority, preview,
    selected: preview.items.filter((item) => body.itemIds.includes(item.id)), actor, readbackOnly: true,
  });
  const [claims, events] = await Promise.all([allFinancialRows(client, 'xero_document_field_correction_claims', (q) => q.eq('tenant_id', preview.tenant_id)),
    allFinancialRows(client, 'xero_document_field_correction_events')]);
  const rate = {}; let callCount = 0;
  const options = { env, fetchImpl, callsPerMinute: 45, retryOnRateLimit: false,
    requestGate: (tenant, operation, limits) => xeroRequestGate(fetchImpl)(tenant, () => { assertCorrectionAllowance(rate, env, allowanceAuthority, { beforeRequest: true }); return operation(); }, limits),
    onResponse: ({ headers, status }) => { callCount += 1; Object.assign(rate, xeroFinancialRateSnapshot(headers, rate)); if (status === 429) throw xeroRateLimitError(headers); assertCorrectionAllowance(rate, env, allowanceAuthority); } };
  const items = [];
  try {
  for (const id of body.itemIds) {
    const saved = preview.items.find((item) => item.id === id);
    if (!saved) throw fail('The selected item is outside the original correction preview.');
    const claim = claims.data.find((row) => row.idempotency_key === `${POLICY}:${preview.id}:${id}` && row.xero_invoice_id === saved.xeroInvoiceId);
    if (!claim) { items.push({ ...publicItem(saved), outcome: 'blocked', reason: 'No previous intent exists; verification never sends a new update.' }); continue; }
    try { items.push(await verifyClaim(claim, saved, { client, actor, accountingFetch, connection, options, finish, events: events.data })); }
    catch (err) { items.push({ ...publicItem(saved), outcome: 'uncertain', reason: err.message }); if (Number(err.status) === 429) break; }
  }
  for (const id of body.itemIds) if (!items.some((item) => item.id === id)) {
    const saved = preview.items.find((item) => item.id === id);
    if (!saved) throw fail('The selected item is outside the original correction preview.');
    items.push({ ...publicItem(saved), outcome: 'uncertain', reason: 'Verification stopped at the Xero reserve; no update was resent.' });
  }
  const allowanceAuditUnavailable = await auditCorrectionAllowance(dependencies, { client, actor, preview, stage: 'verify', rate,
    selectedCount: body.itemIds.length, providerCalls: callCount, items });
  return { policy: POLICY, previewId: preview.id, items, summary: summary(items), rateLimit: rate,
    ...(allowanceAuditUnavailable ? { allowanceAuditUnavailable: true } : {}) };
  } catch (error) {
    error.details = { ...(error.details || {}), rateLimit: { ...rate } };
    if (await auditCorrectionAllowance(dependencies, { client, actor, preview, stage: 'verify', rate,
      selectedCount: body.itemIds.length, providerCalls: callCount, items, error })) error.details.allowanceAuditUnavailable = true;
    throw error;
  }
}

export async function xeroFinancialDocumentCorrectionApply(body = {}, dependencies = {}) {
  const { env = process.env, fetchImpl = fetch, client = xeroContactSyncServiceClient(env), accessContext,
    accountingFetch = xeroAccountingFetch, claim = claimDocumentCorrection, finish = finishDocumentCorrection } = dependencies;
  requireExternalActionGate('xero_financial_sync', env);
  const actor = actorFor(accessContext);
  if (!uuid(body.previewId) || !Array.isArray(body.itemIds) || !body.itemIds.length || body.itemIds.length > 25
    || body.itemIds.some((id) => !uuid(id)) || new Set(body.itemIds).size !== body.itemIds.length) throw fail('Select between 1 and 25 distinct reviewed corrections.');
  const { data: preview, error } = await client.from(TABLE).select('*').eq('id', body.previewId).maybeSingle();
  if (error || !preview || preview.policy !== POLICY) throw fail('The saved correction preview is unavailable.');
  const selected = body.itemIds.map((id) => preview.items.find((item) => item.id === id));
  if (selected.some((item) => !item || item.outcome !== 'eligible')) throw fail('Only eligible items from this exact preview can be applied.');
  const connection = await (dependencies.getConnection || getFreshXeroConnection)(client, { env, fetchImpl });
  if (connection.tenantId !== preview.tenant_id) throw fail('The reviewed Xero organisation changed.');
  const allowanceAuthority = resolveCorrectionReserveAuthority(env, actor, connection.tenantId);
  const allowanceReceipt = allowanceAuthority || preview.summary?.allowanceAuthority
    ? await verifyCorrectionCanary(client, { authority: allowanceAuthority, preview, selected, actor }) : null;
  // Special preservation receipts depend on the complete historical identity
  // closure; retain their full scan. Ordinary corrections need only selected
  // number checks, while all mapped IDs and current-date records remain complete.
  const correctionSelection = selected.some(item => needsCompleteHistoricalIdentity(item.mapping)) ? null
    : selected.map(item => ({ salesforceObject: item.source.salesforceObject, salesforceId: item.salesforceId, xeroInvoiceId: item.xeroInvoiceId }));
  const rate = {}; let current; const outcomes = [];
  try {
  current = await currentEvidence({ ...dependencies, client, getConnection: async () => connection }, rate, correctionSelection);
  if (current.connection.tenantId !== preview.tenant_id) throw fail('The reviewed Xero organisation changed.');
  for (const saved of selected) {
    let claimed = null; let attempted = false;
    const idempotencyKey = `${POLICY}:${preview.id}:${saved.id}`;
    const previousClaim = current.stored.documentCorrectionClaims?.find((row) => row.idempotency_key === idempotencyKey && row.tenant_id === preview.tenant_id);
    try {
      if (previousClaim) {
        claimed = previousClaim;
        outcomes.push(await verifyClaim(previousClaim, saved, { client, actor, accountingFetch, connection: current.connection,
          options: { env, fetchImpl, onResponse: current.onResponse, callsPerMinute: 45, retryOnRateLimit: false, requestGate: current.requestGate }, finish,
          events: current.stored.documentCorrectionEvents || [] }));
        if (outcomes.at(-1).outcome === 'uncertain') break;
        continue;
      }
      const freshSalesforce = await (dependencies.loadSalesforce || loadSalesforceFinancialSnapshot)(XERO_FINANCIAL_CUTOFF);
      const freshItems = buildDocumentCorrectionItems({ salesforce: freshSalesforce, xero: current.xero, stored: current.stored });
      const fresh = freshItems.find((item) => item.source.salesforceObject === saved.source.salesforceObject && sameSf(item.salesforceId, saved.salesforceId));
      if (!fresh || fresh.xeroInvoiceId !== saved.xeroInvoiceId || fresh.projectionFingerprint !== saved.projectionFingerprint
        || fresh.source.sourceFingerprint !== saved.source.sourceFingerprint || fresh.source.documentFieldSourceFingerprint !== saved.source.documentFieldSourceFingerprint || (!previousClaim && hash(fresh.mapping) !== hash(saved.mapping))) throw fail('Source, mapping or proposed fields changed. Create a fresh preview.');
      const options = { env, fetchImpl, onResponse: current.onResponse, callsPerMinute: 45, retryOnRateLimit: false, requestGate: current.requestGate };
      const before = await readExactCorrectionInvoice(accountingFetch, current.connection, saved.xeroInvoiceId, options, 'The exact current Xero transaction was not returned.');
      const evidence = journalEvidence(saved, saved.before, actor, preview, allowanceReceipt);
      // Persist the original reviewed intent. A replay reads it back; it cannot
      // send another provider mutation, including after an uncertain timeout.
      if (hash(before) !== hash(saved.before) && hash(before) !== hash(evidence.expectedAfter)) throw fail('Xero changed after preview. Create a fresh preview.');
      if (fresh.outcome !== 'eligible' && fresh.outcome !== 'already_compliant') throw fail(fresh.reason);
      assertCorrectionAllowance(rate, env, allowanceAuthority, { beforeRequest: true, requiredCalls: 3 });
      claimed = await claim(client, { tenantId: preview.tenant_id, xeroInvoiceId: saved.xeroInvoiceId, mappingId: saved.mapping?.id || null,
        idempotencyKey, evidence, actor });
      const lockedBefore = await readExactCorrectionInvoice(accountingFetch, current.connection, saved.xeroInvoiceId, options,
        'The protected transaction readback was incomplete.', 'XERO_DOCUMENT_CORRECTION_UNCERTAIN');
      if (hash(lockedBefore) !== hash(before)) throw fail('The Xero transaction changed while the correction was being claimed.', 'XERO_DOCUMENT_CORRECTION_UNCERTAIN');
      if (claimed.alreadyClaimed || hash(before) === hash(evidence.expectedAfter)) {
        if (hash(before) !== hash(evidence.expectedAfter)) throw fail('The earlier request has an unconfirmed outcome; readback did not confirm completion.', 'XERO_DOCUMENT_CORRECTION_UNCERTAIN');
      } else {
        const payload = buildDocumentFieldCorrectionPayload({ projection: saved.projection, rawXeroInvoice: before,
          direction: saved.source.xeroType === 'ACCREC' ? 'buyer' : 'supplier', organisation: current.xero.organisation });
        assertCorrectionAllowance(rate, env, allowanceAuthority, { beforeRequest: true });
        attempted = true;
        const response = await accountingFetch(current.connection, `/Invoices/${saved.xeroInvoiceId}?unitdp=4`, {
          ...options, method: 'POST', body: { Invoices: [payload] }, idempotencyKey: claimed.id,
        });
        const rejected = response.Invoices?.length === 1 && response.Invoices[0].InvoiceID === saved.xeroInvoiceId
          && response.Invoices[0].Type === before.Type && response.Invoices[0].Contact?.ContactID === before.Contact.ContactID
          && response.Invoices[0].CurrencyCode === before.CurrencyCode && response.Invoices[0].HasErrors === true
          && Array.isArray(response.Invoices[0].ValidationErrors) && response.Invoices[0].ValidationErrors.length > 0
          && response.Invoices[0].ValidationErrors.every((error) => typeof error.Message === 'string' && error.Message.trim());
        if (rejected) {
          const observed = await readExactCorrectionInvoice(accountingFetch, current.connection, saved.xeroInvoiceId, options,
            'Provider rejection did not have an unchanged exact readback.', 'XERO_DOCUMENT_CORRECTION_UNCERTAIN');
          if (hash(observed) !== hash(before)) throw fail('Provider rejection did not have an unchanged exact readback.', 'XERO_DOCUMENT_CORRECTION_UNCERTAIN');
          const reason = response.Invoices[0].ValidationErrors.map((error) => error.Message).join(' ').slice(0, 2000);
          await finish(client, { claimId: claimed.id, status: 'rejected', evidence: { observed, basis: 'definitive_provider_rejection', reason }, actor });
          outcomes.push({ ...publicItem(saved), outcome: 'blocked', reason });
          continue;
        }
        if (!Array.isArray(response.Invoices) || response.Invoices.length !== 1 || response.Invoices[0].InvoiceID !== saved.xeroInvoiceId
          || response.Invoices[0].HasErrors || response.Invoices[0].ValidationErrors?.length) throw fail('Xero did not confirm the exact requested correction.', 'XERO_DOCUMENT_CORRECTION_UNCERTAIN');
      }
      const after = await readExactCorrectionInvoice(accountingFetch, current.connection, saved.xeroInvoiceId, options,
        'Correction readback was incomplete.', 'XERO_DOCUMENT_CORRECTION_UNCERTAIN');
      const verified = verifyDocumentFieldCorrectionReadback({ before: saved.before, after, projection: saved.projection,
        direction: saved.source.xeroType === 'ACCREC' ? 'buyer' : 'supplier' });
      if (!verified.ok || hash(after) !== hash(evidence.expectedAfter)) throw fail('The correction readback changed unapproved fields or did not match the requested values.', 'XERO_DOCUMENT_CORRECTION_UNCERTAIN');
      await finish(client, { claimId: claimed.id, status: 'confirmed', evidence: { observed: after, basis: 'exact_provider_readback' }, actor });
      outcomes.push({ ...publicItem(saved), outcome: 'applied', reason: 'Exact Xero readback verified; financial details and payments preserved.' });
    } catch (err) {
      if (claimed) {
        await finish(client, { claimId: claimed.id, status: 'uncertain', evidence: { observed: null, basis: 'unconfirmed_provider_outcome', reason: err.message }, actor }).catch(() => {});
      }
      outcomes.push({ ...publicItem(saved), outcome: claimed || attempted ? 'uncertain' : 'blocked', reason: err.message });
      if (claimed || attempted || Number(err.status) === 429) break;
    }
  }
  for (const item of selected) if (!outcomes.some((row) => row.id === item.id)) outcomes.push({ ...publicItem(item), outcome: 'blocked', reason: 'Batch stopped before this record; no update attempted.' });
  const allowanceAuditUnavailable = await auditCorrectionAllowance(dependencies, { client, actor, preview, stage: 'apply', rate,
    selectedCount: selected.length, providerCalls: current.callCount, items: outcomes });
  return { policy: POLICY, previewId: preview.id, items: outcomes, summary: summary(outcomes), rateLimit: rate,
    ...(allowanceAuditUnavailable ? { allowanceAuditUnavailable: true } : {}) };
  } catch (error) {
    error.details = { ...(error.details || {}), rateLimit: { ...rate } };
    if (await auditCorrectionAllowance(dependencies, { client, actor, preview, stage: 'apply', rate,
      selectedCount: selected.length, providerCalls: current?.callCount ?? error.details.callCount ?? 0,
      items: outcomes, error })) error.details.allowanceAuditUnavailable = true;
    throw error;
  }
}

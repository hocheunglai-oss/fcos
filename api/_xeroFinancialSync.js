import { createHash, randomUUID } from 'node:crypto';
import { accountingPayload, documentConfirmationErrors, documentPostingBlockers, documentReadiness, financialSourceCurrency, loadFinancialSafetyContext, matchDocumentResponses, matchedXeroLines, normalizePostingMode, reviewedPostingMode, safetySelectFields, unownedXeroMetadata } from './_xeroDocumentSafety.js';
import { approvePetroleumMappings, PETROLEUM_PRODUCT_QUERY } from './_xeroPetroleumMappings.js';
import { buildGroupedPreservationContext, completeGroupedAccountSnapshot, evaluateGroupedFinancialDocument, groupedInvoiceNumber,
  groupedPreservationReview, groupedSourceAccounting, hasGroupedPreservation } from './_xeroGroupedPreservationAdapter.js';
import { groupedPreservationCanonical } from './_xeroGroupedPreservation.js';
import { requireExternalActionGate } from './_externalActionGates.js';
import { paymentCurrency, paymentDocumentIdentityBlockers, selectXeroPaymentMatch, selectXeroReferenceRetentionMatch } from './_xeroPaymentIdentity.js';
import { resolveRemittanceBankEvidence } from './_xeroPaymentBankEvidence.js';
import { buyerPaymentDocumentBlockers, enrichBuyerPaymentDocumentEvidence } from './_xeroBuyerPaymentEvidence.js';
import { persistReviewedPaymentReferenceLinks } from './_xeroPaymentReferenceLink.js';
import { loadPaymentPostingClaims, paymentClaimEvidenceIds, postReviewedPaymentBatch, resolvePaymentPostingClaim, reviewPaymentPostingClaim } from './_xeroPaymentPosting.js';
import { xeroRateLimitSnapshot } from './_xeroRateLimit.js';
import { sfCompositeQueries, sfQuery } from './_salesforce.js';
import {
  getFreshXeroConnection,
  hkStrippedClKeyNameMatchKey,
  normalizeName,
  splitScopes,
  xeroAccountingFetch as accountingFetch,
  xeroContactSyncError,
  xeroContactSyncServiceClient,
} from './_xeroContactSync.js';

export const XERO_FINANCIAL_CUTOFF = '2026-01-01';
export const XERO_RECONCILIATION_VERSION = 9;
const MAX_BATCH_SIZE = 25;
const DEFAULT_CALLS_PER_MINUTE = 45;
const DEFAULT_DAILY_LIMIT = 1000;
const DEFAULT_DAILY_RESERVE_RATIO = 0.2;
// Paginated reads and writes use the same per-tenant pace, including parallel scans.
function xeroAccountingFetch(connection, pathName, options) {
  const configured = Number(options.env?.XERO_FINANCIAL_CALLS_PER_MINUTE ?? DEFAULT_CALLS_PER_MINUTE);
  const callsPerMinute = Number.isFinite(configured) ? Math.max(1, Math.min(45, configured)) : DEFAULT_CALLS_PER_MINUTE;
  return accountingFetch(connection, pathName, { ...options, callsPerMinute });
}
const ACTIVE_XERO_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID']);
const MUTABLE_XERO_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'AUTHORISED']);
const BUYER_INVOICE_QUERY = `
  SELECT Id, Name, CreatedDate, STEM__c, STEM__r.Name, STEM__r.KeyStem__c,
         STEM__r.Account__c, STEM__r.Account__r.Name, STEM__r.Account__r.Company_Code__c,
         STEM__r.Delivery_Date__c, Amount__c, Invoice_Date__c, Invoice_Due_Date__c, LastModifiedDate
  FROM Invoice__c
  WHERE (Invoice_Date__c >= {cutoff} OR (Invoice_Date__c = null AND CreatedDate >= {cutoff}T00:00:00Z))
    AND Proforma__c = false
    AND Deprecated__c = false
  ORDER BY Invoice_Date__c, Id`;
const SUPPLIER_INVOICE_QUERY = `
  SELECT Id, Name, CreatedDate, STEM__c, STEM__r.Name, STEM__r.KeyStem__c,
         Supplier__c, Supplier__r.Name, Supplier__r.Company_Code__c, STEM__r.Delivery_Date__c,
         Invoice_Amount__c, Invoice_Date__c, Invoice_Due_Date__c,
         Payable_Balance__c, LastModifiedDate
  FROM Supplier_Invoice__c
  WHERE (Invoice_Date__c >= {cutoff} OR (Invoice_Date__c = null AND CreatedDate >= {cutoff}T00:00:00Z))
  ORDER BY Invoice_Date__c, Id`;

export const XERO_FINANCIAL_ACTION_LABELS = Object.freeze({
  link: 'Link exact match',
  safe_update: 'Update safely editable Xero record',
  create_draft: 'Create Xero draft',
  protected_legacy: 'Preserve protected legacy record',
  blocked: 'Finance exception',
  payment_link: 'Link existing exact payment',
  payment_apply: 'Apply exact payment',
});

export function xeroFinancialRateSnapshot(headers, previous = {}, options = {}) {
  return xeroRateLimitSnapshot(headers, previous, options);
}

export function assertXeroFinancialDailyReserve(rate, env = process.env) {
  if (rate?.dayRemaining == null) return;
  const limit = Math.max(1, Number(env.XERO_DAILY_LIMIT || DEFAULT_DAILY_LIMIT));
  const ratio = Math.min(0.9, Math.max(0.2, Number(env.XERO_DAILY_RESERVE_RATIO || DEFAULT_DAILY_RESERVE_RATIO)));
  const reserve = Math.ceil(limit * ratio);
  if (Number(rate.dayRemaining) <= reserve) {
    throw financialError(
      `Xero daily allowance reserve reached (${Number(rate.dayRemaining)} remaining; ${reserve} reserved). Resume after the allowance resets.`,
      429,
      'XERO_FINANCIAL_DAILY_RESERVE',
      { rateLimit: rate, reserve },
    );
  }
}

export function classifyXeroFinancialDocument(source, candidates, {
  storedMapping = null,
  organisation = {},
  deletedCandidates = [],
  groupedContext = null,
} = {}) {
  const active = candidates.filter((candidate) => candidate.type === source.xeroType
    && ACTIVE_XERO_STATUSES.has(String(candidate.status || '').toUpperCase()));
  const sharedAccounts = source.sharedContactAccounts || [];
  const groupedSaved = hasGroupedPreservation(storedMapping);
  const evidence = { basis: null, sharedAccounts, candidates: [] };
  const blocked = (code, message, matches = []) => ({
    ...blockedClassification(code, message), matchEvidence: { ...evidence, candidates: matches.map(documentCandidateEvidence) },
  });
  const stored = storedMapping ? active.find((candidate) => groupedSaved
    ? String(candidate.id).toLowerCase() === String(storedMapping.xero_document_id).toLowerCase()
    : candidate.id === storedMapping.xero_document_id) : null;
  if (storedMapping && !stored) return blocked('stored_xero_document_missing', 'The stored Xero link no longer points to an active transaction. Restore or resolve the saved link before syncing.');
  if (storedMapping?.retained_differences?.accountId && (groupedSaved
    ? String(storedMapping.retained_differences.accountId).slice(0, 15) !== String(source.accountId).slice(0, 15)
    : storedMapping.retained_differences.accountId !== source.accountId)) {
    return blocked('salesforce_account_changed', 'The Salesforce Account changed after this document was linked. Finance must review the counterparty identity.', stored ? [stored] : []);
  }
  if (stored && storedMapping.xero_contact_id && (groupedSaved
    ? String(storedMapping.xero_contact_id).toLowerCase() !== String(stored.contactId).toLowerCase()
    : storedMapping.xero_contact_id !== stored.contactId)) {
    return blocked('stored_xero_contact_changed', 'The linked Xero transaction changed Contact. Finance must resolve the counterparty before syncing.', [stored]);
  }
  const allNumberMatches = active.filter((candidate) => exactDocumentNumber(candidate) === source.documentNumber);
  // Supplier invoice numbers are not globally unique: the current Contact is part of their identity.
  const numberMatches = source.xeroType.startsWith('ACCPAY')
    ? allNumberMatches.filter((candidate) => candidate.contactId === source.contactId) : allNumberMatches;
  const groupedNumberMatches = groupedSaved || source.lines?.length > 1 ? active.filter((candidate) => candidate.collection === 'Invoices'
    && groupedInvoiceNumber(exactDocumentNumber(candidate)) === groupedInvoiceNumber(source.documentNumber)
    && (source.xeroType !== 'ACCPAY' || candidate.contactId === source.contactId)) : [];
  if (groupedNumberMatches.length > 1) return blocked('duplicate_xero_document_number', 'More than one active Xero transaction uses this exact normalized invoice number. Finance must resolve the identity.', groupedNumberMatches);
  if (numberMatches.length > 1) return blocked('duplicate_xero_document_number', 'More than one active Xero transaction uses this document number. Finance must identify the exact invoice.', numberMatches);
  if (stored && numberMatches.some((candidate) => candidate.id !== stored.id)) {
    return blocked('conflicting_document_identity', 'The saved link and exact document number identify different Xero transactions. Resolve these links before syncing.', [stored, ...numberMatches]);
  }
  const supportMatches = active.filter((candidate) => supportingMatch(source, candidate));
  const stemMatches = supportMatches.filter((candidate) => exactStemEvidence(source, candidate));
  const preferred = stemMatches.length ? stemMatches : supportMatches;
  const match = stored || numberMatches[0] || groupedNumberMatches[0] || (preferred.length === 1 ? preferred[0] : null);
  if (!match && preferred.length > 1) return blocked('ambiguous_legacy_match', 'More than one Xero transaction matches the Contact, currency, amount and supporting evidence. Finance must identify the exact invoice.', preferred);
  const warnings = sharedAccounts.length > 1
    ? ['This Xero Contact is shared by several Salesforce Account IDs. Review the Account IDs and this exact document; no Salesforce Accounts will be merged.'] : [];
  const sameSharedName = sharedAccounts.length < 2 || sharedAccounts.every((account) => normalizeName(account.accountName)
    && normalizeName(account.accountName) === normalizeName(source.accountName));
  if (!match) {
    const near = active.filter((candidate) => candidate.contactId === source.contactId && candidate.currency === source.currency && sameMoney(candidate.total, source.total)
      && (!validDate(candidate.date) || (!validDate(source.invoiceDate) && !validDate(source.deliveryDate))));
    if (near.length) return blocked('possible_legacy_match', 'The Contact, currency and amount match existing Xero transactions, but date/STEM evidence is missing. Confirm the invoice before creating another draft.', near);
    const blockers = [...(source.blockers || []), ...documentPostingBlockers(source, organisation)];
    if (source.postingMode === 'authorised' && deletedCandidates.some((candidate) => exactDocumentNumber(candidate) === source.documentNumber)) blockers.push('A deleted or voided document already uses this identity. Finance must resolve it before authorised posting.');
    if (!sameSharedName) blockers.push('Different Salesforce Account names share this Xero Contact. Finance must resolve the Account identity before creating a draft.');
    return { action: 'create_draft', status: blockers.length ? 'blocked' : 'eligible', blockers,
      warnings: [...warnings, ...(deletedCandidates.some((candidate) => exactDocumentNumber(candidate) === source.documentNumber)
        ? ['A deleted or voided Xero record uses this number; it remains untouched.'] : [])],
      xero: null, differences: [], matchEvidence: evidence, reviewRequired: false, acceptedLegacy: false };
  }
  evidence.basis = stored ? 'stored_link' : numberMatches.length || groupedNumberMatches.length ? 'document_number' : stemMatches.length ? 'stem_reference' : 'date_amount';
  const blockers = uniqueStrings([...(source.blockers || []), ...documentIdentityProblems(source, match)]);
  if (!sameSharedName && (evidence.basis === 'date_amount' || (stored && storedMapping.retained_differences?.accountId !== source.accountId))) {
    blockers.push('Different Salesforce Account names share this Contact; date and amount alone cannot establish the correct invoice. Finance must resolve the Account identity.');
  }
  const differences = compareDocument(source, match);
  if (source.postingMode === 'authorised' && ['DRAFT', 'SUBMITTED'].includes(match.status)) differences.push({ field: 'status', xero: match.status, salesforce: 'AUTHORISED' });
  const accepted = storedMapping?.retained_differences?.reviewFingerprint === legacyReviewFingerprint(source, match);
  if (blockers.length) return { action: 'blocked', status: 'blocked', blockers, warnings, xero: match, differences, matchEvidence: evidence, reviewRequired: false, acceptedLegacy: false };
  // Once a grouped proof exists, every recheck stays on this preservation path,
  // even if line counts, source evidence, settlement or protection flags change.
  // This branch never constructs an accounting update payload.
  if (groupedSaved || (source.xeroCollection === 'Invoices' && source.lines?.length > 1 && match.lineItems?.length === 1
    && ['AUTHORISED', 'PAID'].includes(match.status))) {
    const grouped = evaluateGroupedFinancialDocument(source, match, groupedContext);
    return { action: 'protected_legacy', status: grouped.eligible ? 'eligible' : 'protected',
      blockers: grouped.eligible ? [] : uniqueStrings(grouped.blockers.map((blocker) => blocker.path ? `${blocker.path}: ${blocker.message}` : blocker.message)),
      warnings: [...warnings, 'Review the grouped accounting equivalence and retained line, date and reference differences. Linking preserves every Xero accounting line.'],
      xero: match, differences, matchEvidence: evidence, reviewRequired: grouped.eligible && !grouped.accepted,
      acceptedLegacy: grouped.eligible && grouped.accepted,
      groupedPreservation: groupedPreservationReview(grouped), groupedPreservationProof: grouped.evidence || null };
  }
  const preserved = storedMapping?.protected_legacy === true;
  if (preserved || isProtectedXeroDocument(match, organisation)) {
    const compatible = equivalentAccountingLines(source.lines, match.lineItems);
    if ((differences.length || preserved) && !compatible) {
      return { action: 'protected_legacy', status: 'protected', blockers: ['Protected Xero history has different or incomplete accounting-line amounts, account codes or tax treatment. Finance must resolve the accounting evidence; FCOS will not rewrite it.'],
        warnings, xero: match, differences, matchEvidence: evidence, reviewRequired: false, acceptedLegacy: false };
    }
    return { action: 'protected_legacy', status: 'eligible', blockers: [],
      warnings: [...warnings, ...(differences.length || (preserved && !accepted) ? ['Review and accept the retained legacy evidence to link this invoice only. Xero accounting history will remain unchanged.'] : [])],
      xero: match, differences, matchEvidence: evidence,
      reviewRequired: !accepted && (differences.length > 0 || sharedAccounts.length > 1 || preserved), acceptedLegacy: accepted && (differences.length > 0 || preserved) };
  }
  const updateBlockers = differences.length ? [...documentPostingBlockers(source, organisation, match), ...matchedXeroLines(source.lines, match.lineItems).blockers] : [];
  if (updateBlockers.length) return { action: 'blocked', status: 'blocked', blockers: updateBlockers, warnings, xero: match, differences, matchEvidence: evidence, reviewRequired: false, acceptedLegacy: false };
  return { action: differences.length ? 'safe_update' : 'link', status: 'eligible', blockers: [], warnings,
    xero: match, differences, matchEvidence: evidence,
    reviewRequired: !accepted && sharedAccounts.length > 1, acceptedLegacy: false };
}

function documentCandidateEvidence(row) {
  return { id: row.id, number: exactDocumentNumber(row), contactName: row.contactName, date: row.date, total: row.total, currency: row.currency };
}

function legacyReviewFingerprint(source, candidate) {
  return hashJson({ source: source.sourceFingerprint, accountId: source.accountId, contactId: source.contactId,
    lines: source.lines, document: { id: candidate.id, type: candidate.type, contactId: candidate.contactId,
      number: exactDocumentNumber(candidate), currency: candidate.currency, total: candidate.total, date: candidate.date,
      dueDate: candidate.dueDate, reference: candidate.reference, lines: comparableLines(candidate.lineItems, true),
      tracking: (candidate.lineItems || []).map((line) => [...(line.Tracking || [])].sort(compareJson)).sort(compareJson) } });
}

// Preserve duplicate lines, while ignoring ordering and descriptions for an explicitly reviewed legacy link.
function equivalentAccountingLines(sourceLines = [], xeroLines = []) {
  const accounting = (lines, xero) => lines.map((line) => {
    const quantity = Number(xero ? line.Quantity : line.quantity);
    const unitAmount = Number(xero ? line.UnitAmount : line.unitAmount);
    const account = String(xero ? line.AccountCode || '' : line.accountCode || '');
    const tax = String((xero ? line.TaxType : line.taxType) || '');
    const amount = quantity * unitAmount;
    if (!account || !tax || !Number.isFinite(amount) || (xero && Math.abs(Number(line.TaxAmount || 0)) > 0.005)) return null;
    if (xero && line.LineAmount != null && !sameMoney(line.LineAmount, amount)) return null;
    return { account, tax, amount: roundMoney(amount) };
  });
  const left = accounting(sourceLines, false); const right = accounting(xeroLines, true);
  return left.length > 0 && left.every(Boolean) && right.every(Boolean)
    && hashJson(left.sort(compareJson)) === hashJson(right.sort(compareJson));
}

function compareJson(left, right) { return stableStringify(left).localeCompare(stableStringify(right)); }

function comparableLines(lines = [], xero = false) {
  return lines.map((line) => ({ description: String((xero ? line.Description : line.description) || '').trim().replace(/\s+/g, ' '),
    quantity: Number(xero ? line.Quantity : line.quantity), unitAmount: Number(xero ? line.UnitAmount : line.unitAmount),
    accountCode: String((xero ? line.AccountCode : line.accountCode) || ''), taxType: String((xero ? line.TaxType : line.taxType) || ''),
    lineAmount: roundMoney(xero ? line.LineAmount ?? Number(line.Quantity) * Number(line.UnitAmount) : Number(line.quantity) * Number(line.unitAmount)),
    taxAmount: Number(xero ? line.TaxAmount || 0 : 0), discount: Number(xero ? line.DiscountRate || 0 : 0) })).sort(compareJson);
}

export function isProtectedXeroDocument(document, organisation = {}) {
  const status = String(document?.status || '').toUpperCase();
  if (status === 'PAID') return true;
  if (Math.abs(Number(document?.amountPaid || 0)) > 0.005) return true;
  if (Math.abs(Number(document?.amountCredited || 0)) > 0.005) return true;
  if (Math.abs(Number(document?.total || 0) - Number(document?.amountDue ?? document?.total ?? 0)) > 0.005) return true;
  if (status === 'AUTHORISED') {
    const documentDate = dateOnly(document?.date);
    const locks = [dateOnly(organisation.periodLockDate), dateOnly(organisation.endOfYearLockDate)].filter(Boolean).sort();
    if (locks.length && documentDate && documentDate <= locks.at(-1)) return true;
    return false;
  }
  return !MUTABLE_XERO_STATUSES.has(status);
}

export function buildXeroAccountingPayload(source, xeroDocumentId = null, currentStatus = null, current = null) {
  if (source.groupedPreservation) throw financialError('Grouped preservation never creates or updates Xero accounting.', 409, 'XERO_GROUPED_PRESERVATION_LINK_ONLY');
  return accountingPayload(source, xeroDocumentId, currentStatus, current);
}

export async function xeroFinancialMappingsGet(_body = {}, {
  env = process.env,
  fetchImpl = fetch,
  client = xeroContactSyncServiceClient(env),
} = {}) {
  const [productResult, bankResult] = await Promise.all([
    allFinancialRows(client, 'xero_financial_product_mappings', (query) => query.order('direction').order('salesforce_product_name')),
    allFinancialRows(client, 'xero_financial_bank_mappings', (query) => query.order('salesforce_bank_name')),
  ]);
  if (productResult.error) throw storageError(productResult.error, 'xero_financial_product_mappings');
  if (bankResult.error) throw storageError(bankResult.error, 'xero_financial_bank_mappings');

  const connection = await getFreshXeroConnection(client, { env, fetchImpl });
  assertScopes(connection, ['accounting.invoices', 'accounting.contacts', 'accounting.settings.read'], 'Financial mappings');
  const rate = {};
  const onResponse = ({ headers }) => Object.assign(rate, xeroFinancialRateSnapshot(headers, rate));
  const [accountResponse, taxResponse] = await Promise.all([
    xeroAccountingFetch(connection, '/Accounts', { method: 'GET', env, fetchImpl, onResponse }),
    xeroAccountingFetch(connection, '/TaxRates', { method: 'GET', env, fetchImpl, onResponse }),
  ]);
  const accounts = (accountResponse.Accounts || []).filter((row) => row.Status === 'ACTIVE');
  return {
    productMappings: (productResult.data || []).map(serializeProductMapping),
    bankMappings: (bankResult.data || []).map(serializeBankMapping),
    accountOptions: accounts.map((row) => ({
      id: row.AccountID,
      code: row.Code || '',
      name: row.Name || '',
      type: row.Type || '',
      currency: row.CurrencyCode || null,
      bank: row.Type === 'BANK' || Boolean(row.BankAccountNumber),
    })),
    taxOptions: (taxResponse.TaxRates || []).filter((row) => row.Status === 'ACTIVE').map((row) => ({
      taxType: row.TaxType,
      name: row.Name,
      displayRate: row.DisplayTaxRate,
    })),
    rateLimit: rate,
  };
}

export async function xeroFinancialMappingsSave(body = {}, {
  accessContext = null,
  env = process.env,
  client = xeroContactSyncServiceClient(env),
} = {}) {
  const actor = actorFields(accessContext);
  if (body.mappingType === 'bank') {
    const { data, error } = await client.rpc('save_xero_financial_bank_mapping_v1', {
      p_mapping_id: body.id || null,
      p_salesforce_bank_name: body.salesforceBankName,
      p_xero_bank_account_id: body.xeroBankAccountId,
      p_xero_bank_account_code: body.xeroBankAccountCode || null,
      p_xero_bank_account_name: body.xeroBankAccountName,
      p_enabled: body.enabled !== false,
      p_expected_revision: numberOrNull(body.revision),
      p_actor_id: actor.id,
      p_actor_email: actor.email,
    });
    if (error) throw optimisticStorageError(error, 'Xero bank mapping');
    return { mappingType: 'bank', mapping: serializeBankMapping(data) };
  }
  const { data, error } = await client.rpc('save_xero_financial_product_mapping_v1', {
    p_mapping_id: body.id || null,
    p_direction: body.direction,
    p_salesforce_product_id: body.salesforceProductId,
    p_salesforce_product_name: body.salesforceProductName,
    p_xero_account_code: body.xeroAccountCode,
    p_xero_account_name: body.xeroAccountName || '',
    p_xero_tax_type: body.xeroTaxType || 'NONE',
    p_enabled: body.enabled !== false,
    p_expected_revision: numberOrNull(body.revision),
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  });
  if (error) throw optimisticStorageError(error, 'Xero Product mapping');
  return { mappingType: 'product', mapping: serializeProductMapping(data) };
}

export async function xeroFinancialSyncPreview(body = {}, dependencies = {}) {
  const {
    accessContext = null,
    env = process.env,
    fetchImpl = fetch,
    client = xeroContactSyncServiceClient(env),
  } = dependencies;
  const cutoff = XERO_FINANCIAL_CUTOFF;
  const postingMode = normalizePostingMode(body.postingMode);
  const actor = actorFields(accessContext);
  const connection = await getFreshXeroConnection(client, { env, fetchImpl });
  assertScopes(connection, ['accounting.invoices', 'accounting.contacts', 'accounting.settings.read'], 'Financial sync preview');
  if (body.refreshIfChangedRunId) {
    const probe = await financialPreviewChanges(body.refreshIfChangedRunId, { client, connection, env, fetchImpl, postingMode });
    if (!probe.changed) return { unchanged: true, checkedAt: new Date().toISOString(), rateLimit: probe.rateLimit };
  }
  const snapshotStartedAt = new Date().toISOString();
  const rate = {};
  const onResponse = ({ headers }) => { Object.assign(rate, xeroFinancialRateSnapshot(headers, rate)); assertXeroFinancialDailyReserve(rate, env); };
  const safetyContext = await loadFinancialSafetyContext();
  const [salesforce, stored, sourcePayments, paymentMappings] = await Promise.all([
    loadSalesforceFinancialSnapshot(cutoff, sfCompositeQueries, safetyContext),
    loadStoredFinancialControls(client),
    body.includePayments === true ? loadSalesforcePayments(cutoff, safetyContext) : Promise.resolve([]),
    body.includePayments === true ? allFinancialRows(client, 'xero_financial_payment_mappings') : Promise.resolve({ data: [] }),
  ]);
  if (paymentMappings.error) throw storageError(paymentMappings.error, 'xero_financial_payment_mappings');
  const evidenceIds = xeroPaymentEvidenceIds(sourcePayments, stored.documentMappings, paymentMappings.data);
  const xero = await loadXeroFinancialSnapshot(connection, cutoff, {
    env, fetchImpl, onResponse, includePayments: body.includePayments === true, ...evidenceIds,
  });
  if (xero.paymentReadSnapshot) xero.paymentReadSnapshot.sourcePayments = sourcePayments;
  const [accountResponse, taxResponse, allMappings] = await Promise.all([
    xeroAccountingFetch(connection, '/Accounts', { method: 'GET', env, fetchImpl, onResponse }),
    xeroAccountingFetch(connection, '/TaxRates', { method: 'GET', env, fetchImpl, onResponse }),
    allFinancialRows(client, 'xero_financial_product_mappings'),
  ]);
  const automaticMappingPolicy = await approvePetroleumMappings({
    products: salesforce.productRecords, extras: salesforce.extras, accounts: accountResponse.Accounts || [], taxRates: taxResponse.TaxRates || [],
    mappings: allMappings.data, client, actor,
  });
  stored.productMappings = (await allFinancialRows(client, 'xero_financial_product_mappings', (query) => query.eq('enabled', true))).data;
  const classified = buildFinancialClassifications(salesforce, xero, stored, { postingMode });
  const disputeStates = await loadDisputeReconciliationStates(client, classified.rows.map((row) => row.stemId));
  for (const row of classified.rows) row.dispute = disputeStates.get(row.stemId) || null;
  const mappingProposals = deriveXeroProductMappingProposals(classified.rows);
  const runId = randomUUID();
  const now = new Date().toISOString();
  const runRow = {
    id: runId,
    idempotency_key: `preview:${runId}`,
    mode: 'preview',
    status: 'ready_for_review',
    cutoff_date: cutoff,
    source_snapshot_at: snapshotStartedAt,
    xero_snapshot_at: snapshotStartedAt,
    source_fingerprint: hashJson(salesforce.fingerprintBasis),
    xero_fingerprint: hashJson(xero.fingerprintBasis),
    control_totals: { ...classified.controlTotals, postingMode },
    classification_summary: classified.summary,
    rate_limit_snapshot: rate,
    revision: 1,
    created_by: actor.id,
    created_by_email: actor.email,
    created_at: now,
    updated_at: now,
  };
  const { error: runError } = await client.from('xero_financial_sync_runs').insert(runRow);
  if (runError) throw storageError(runError, 'xero_financial_sync_runs');
  const itemRows = classified.rows.map((row, rowIndex) => toSyncItemRow(row, runId, rowIndex, now));
  for (const chunk of chunks(itemRows, 100)) {
    const { error } = await client.from('xero_financial_sync_items').insert(chunk);
    if (error) throw storageError(error, 'xero_financial_sync_items');
  }
  if (body.recordExactMatches === true) {
    const exact = itemRows.filter((item) => item.status === 'eligible'
      && ['link', 'protected_legacy'].includes(item.proposed_action) && !item.differences?.length && !item.blockers?.length && !item.source_payload.reviewRequired
      && !item.source_payload.groupedPreservation)
      .map((row) => documentMappingRow(row, row.xero_payload, row.proposed_action === 'protected_legacy'));
    for (const batch of chunks(exact, 100)) {
      const { error } = await client.from('xero_financial_document_mappings').upsert(batch, { onConflict: 'salesforce_object,salesforce_id' });
      if (error) throw storageError(error, 'xero_financial_document_mappings');
    }
  }
  let paymentSnapshot = null;
  if (body.includePayments === true) {
    paymentSnapshot = await previewPayments({ recordExactMatches: body.recordExactMatches === true }, { accessContext, env, fetchImpl, client, xeroReadSnapshot: xero.paymentReadSnapshot });
    runRow.control_totals = { ...runRow.control_totals, workflowSnapshot: { reconciliationVersion: XERO_RECONCILIATION_VERSION, payments: paymentSnapshot, products: salesforce.products, mappingProposals, automaticMappingPolicy, checkedAt: now, controlsFingerprint: hashJson(await loadStoredFinancialControls(client)), organisation: xero.organisation } };
    const { error } = await client.from('xero_financial_sync_runs').update({ control_totals: runRow.control_totals }).eq('id', runId);
    if (error) throw storageError(error, 'xero_financial_sync_runs');
  }
  await recordAudit(client, {
    runId,
    eventType: 'preview_completed',
    outcome: 'success',
    actor,
    counts: classified.summary,
    fingerprints: { source: runRow.source_fingerprint, xero: runRow.xero_fingerprint },
    rate,
  });
  return {
    run: serializeRun(runRow),
    postingMode,
    payments: paymentSnapshot,
    checkedAt: now,
    rows: classified.rows.map((row, index) => ({ ...serializeClassification(row), id: itemRows[index].id })),
    products: salesforce.products,
    mappingProposals,
    automaticMappingPolicy,
    controlTotals: classified.controlTotals,
    summary: classified.summary,
    rateLimit: rate,
    callEstimate: xero.callCount + 2,
    externalWriteEnabled: financialWriteGateEnabled(env),
  };
}

// Probe for changes on return to the page. Manual checks and checks older than six hours
// always retrieve the complete population, including hard deletions. Writes always revalidate.
export async function financialPreviewChanges(runId, { client, connection, env = process.env, fetchImpl = fetch,
  querySalesforce = sfCompositeQueries, accountingFetch = xeroAccountingFetch, now = Date.now(), postingMode }) {
  if (!isUuid(runId)) throw financialError('A valid saved check is required.', 400, 'XERO_FINANCIAL_RUN_INVALID');
  const { data: run, error } = await client.from('xero_financial_sync_runs').select('*').eq('id', runId).maybeSingle();
  if (error) throw storageError(error, 'xero_financial_sync_runs');
  if (postingMode !== undefined && postingMode !== reviewedPostingMode(run)) return { changed: true };
  const since = new Date(run?.source_snapshot_at);
  const snapshot = run?.control_totals?.workflowSnapshot;
  if (snapshot?.reconciliationVersion !== XERO_RECONCILIATION_VERSION || !snapshot?.controlsFingerprint || !Number.isFinite(since.getTime()) || now - since.getTime() > 21600000) return { changed: true };
  const controls = await loadStoredFinancialControls(client);
  if (hashJson(controls) !== snapshot.controlsFingerprint) return { changed: true };
  // Parent identity, delivery, Product and payment edits can change a child classification.
  const changes = await querySalesforce(['Invoice__c', 'Supplier_Invoice__c', 'STEM_Line_Item__c', 'STEM_Extra_Cost__c', 'Payment__c', 'STEM__c', 'Account', 'Product2', 'ContentDocument']
    .map((object) => ({ soql: `SELECT Id FROM ${object} WHERE SystemModstamp >= ${since.toISOString()} LIMIT 1`, clean: true, limit: 1 })));
  if (changes.some((result) => result?.error)) throw financialError('The background Salesforce check could not be completed.', 502, 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE');
  if (changes.some((result) => result.records?.length)) return { changed: true };
  const rate = {};
  const onResponse = ({ headers }) => {
    Object.assign(rate, xeroFinancialRateSnapshot(headers, rate));
    assertXeroFinancialDailyReserve(rate, env);
  };
  for (const collection of ['Invoices', 'CreditNotes', 'Payments', 'Contacts']) {
    const result = await accountingFetch(connection, `/${collection}?page=1&pageSize=1`, {
      method: 'GET', headers: { 'If-Modified-Since': since.toUTCString() }, env, fetchImpl, onResponse,
    });
    if (!Array.isArray(result[collection])) throw financialError('The background Xero check was incomplete.', 502, 'XERO_FINANCIAL_XERO_INCOMPLETE');
    if (result[collection].length) return { changed: true };
  }
  const result = await accountingFetch(connection, '/Organisations', { method: 'GET', env, fetchImpl, onResponse });
  const organisation = result.Organisations?.[0];
  if (!organisation) throw financialError('The Xero period lock could not be checked.', 502, 'XERO_FINANCIAL_XERO_INCOMPLETE');
  return { changed: hashJson({ periodLockDate: dateOnly(organisation.PeriodLockDate), endOfYearLockDate: dateOnly(organisation.EndOfYearLockDate), baseCurrency: organisation.BaseCurrency || null }) !== hashJson(snapshot.organisation), rateLimit: rate };
}

export function xeroReviewFingerprint(row) {
  return hashJson({ postingMode: normalizePostingMode(row.postingMode), source: row.sourceFingerprint, action: row.action, payload: row.proposedPayload || {},
    xero: row.xero && Object.keys(row.xero).length ? row.xero : null, blockers: row.blockers || [], differences: row.differences || [],
    ...(row.groupedPreservation ? { groupedPreservation: row.groupedPreservation } : {}),
    matchEvidence: row.matchEvidence || null, reviewRequired: Boolean(row.reviewRequired), acceptedLegacy: Boolean(row.acceptedLegacy) });
}

export function changedXeroReviewItems(items, currentBySource) {
  return items.flatMap((item) => {
    const source = item.source_payload || {};
    const current = currentBySource.get(`${source.salesforceObject}:${source.salesforceId}`);
    const original = { ...source, action: item.proposed_action, proposedPayload: item.proposed_payload,
      xero: Object.keys(item.xero_payload || {}).length ? item.xero_payload : null, blockers: item.blockers, differences: item.differences };
    if (current && xeroReviewFingerprint(original) === xeroReviewFingerprint(current)) return [];
    const details = !current ? ['Source record no longer qualifies'] : [
      source.sourceFingerprint !== current.sourceFingerprint ? 'Salesforce accounting fields changed' : '',
      hashJson(item.proposed_payload || {}) !== hashJson(current.proposedPayload || {}) ? 'Amounts, lines, contact, tax or approved mapping changed' : '',
      hashJson(original.xero) !== hashJson(current.xero) ? 'Xero record changed' : '',
      ...(current.blockers || []),
    ].filter(Boolean);
    return [{ id: item.id, reason: `${source.documentNumber}: ${details.join('; ') || 'Matching classification changed'}. Review this record again.` }];
  });
}

async function loadDisputeReconciliationStates(client, stemIds) {
  const states = new Map();
  for (const batch of chunks(uniqueStrings(stemIds), 200)) {
    const { data, error } = await client.from('dispute_beta_cases').select('stem_id,workflow_status,approval_status,updated_at').in('stem_id', batch);
    if (error) throw storageError(error, 'dispute_beta_cases');
    for (const row of data || []) states.set(row.stem_id, { status: row.workflow_status, approvalStatus: row.approval_status, updatedAt: row.updated_at });
  }
  return states;
}

export async function xeroFinancialSyncLatest(_body = {}, { env = process.env, client = xeroContactSyncServiceClient(env) } = {}) {
  const { data: runs, error } = await client.from('xero_financial_sync_runs').select('*').eq('mode', 'preview').not('control_totals->workflowSnapshot', 'is', null).order('created_at', { ascending: false }).limit(1);
  if (error) throw storageError(error, 'xero_financial_sync_runs');
  const run = runs?.[0];
  if (!run || run.control_totals?.workflowSnapshot?.reconciliationVersion !== XERO_RECONCILIATION_VERSION) return { preview: null, refreshRequired: Boolean(run) };
  const items = [];
  for (let offset = 0; ; offset += 500) {
    const page = await client.from('xero_financial_sync_items').select('*').eq('run_id', run.id).order('row_index').range(offset, offset + 499);
    if (page.error) throw storageError(page.error, 'xero_financial_sync_items');
    items.push(...page.data);
    if (page.data.length < 500) break;
  }
  const snapshot = run.control_totals?.workflowSnapshot || {};
  const disputeStates = await loadDisputeReconciliationStates(client, items.map((item) => item.source_payload?.stemId));
  return { preview: { run: serializeRun(run), rows: items.map((item) => ({
    ...serializeClassification({ ...item.source_payload, action: item.proposed_action, status: item.status,
      blockers: item.error_message ? [...(item.blockers || []), item.error_message] : item.blockers,
      warnings: item.warnings, differences: item.differences, xero: item.xero_payload, proposedPayload: item.proposed_payload }),
    id: item.id, selected: item.selected, dispute: disputeStates.get(item.source_payload?.stemId) || null,
  })), summary: run.classification_summary, products: snapshot.products || [], mappingProposals: snapshot.mappingProposals || [],
    automaticMappingPolicy: snapshot.automaticMappingPolicy || null, payments: snapshot.payments || null, checkedAt: snapshot.checkedAt || run.created_at, restored: true } };
}

export async function xeroFinancialSyncApply(body = {}, {
  accessContext = null,
  env = process.env,
  client = xeroContactSyncServiceClient(env),
} = {}) {
  const selected = uniqueStrings(body.selectedItemIds).filter(isUuid);
  if (!body.reviewed || !selected.length) {
    throw financialError('Finance must review the preview and select at least one eligible row.', 400, 'XERO_FINANCIAL_REVIEW_REQUIRED');
  }
  const { data: saved, error: savedError } = await client.from('xero_financial_sync_runs').select('*').eq('id', body.runId).maybeSingle();
  if (savedError) throw storageError(savedError, 'xero_financial_sync_runs');
  if (!saved) throw financialError('The saved financial preview was not found.', 404, 'XERO_FINANCIAL_RUN_INVALID');
  reviewedPostingMode(saved, body.postingMode);
  const actor = actorFields(accessContext);
  const { data, error } = await client.rpc('authorise_xero_financial_sync_run_v1', {
    p_run_id: body.runId,
    p_expected_revision: Number(body.revision),
    p_selected_item_ids: selected,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  });
  if (error) throw optimisticStorageError(error, 'Xero financial preview');
  return { run: serializeRun(data), selectedCount: selected.length, writeGateEnabled: financialWriteGateEnabled(env) };
}

export async function xeroFinancialSyncRun(body = {}, {
  accessContext = null,
  env = process.env,
  fetchImpl = fetch,
  client = xeroContactSyncServiceClient(env),
  getConnection = getFreshXeroConnection,
  loadSalesforce = loadSalesforceFinancialSnapshot,
  loadXero = loadXeroFinancialSnapshot,
  accountingFetch = xeroAccountingFetch,
} = {}) {
  requireExternalActionGate('xero_financial_sync', env);
  if (body.reviewed === true) {
    const approved = await xeroFinancialSyncApply(body, { accessContext, env, client });
    body = { ...body, revision: approved.run.revision };
  }
  const actor = actorFields(accessContext);
  const { data: started, error: startError } = await client.rpc('start_xero_financial_sync_run_v1', {
    p_run_id: body.runId,
    p_expected_revision: Number(body.revision),
  });
  const processingConstraint = 'xero_financial_one_processing_document_run_uidx';
  if (startError?.code === '23505' && (startError.constraint === processingConstraint
    || [startError.message, startError.details].some((value) => String(value || '').includes(`"${processingConstraint}"`)))) {
    throw financialError('Another financial document batch is still processing. Wait for it to finish; if interrupted, Finance must verify its outcome before retrying.', 409, 'XERO_FINANCIAL_RUN_BUSY');
  }
  if (startError) throw optimisticStorageError(startError, 'Xero financial sync run');
  const rate = {};
  const outcomes = [];
  let outstandingPost = null;
  try {
  const postingMode = reviewedPostingMode(started, body.postingMode);
  const { data: rows } = await allFinancialRows(client, 'xero_financial_sync_items', (query) => query
    .eq('run_id', body.runId).eq('selected', true)
    .in('status', ['selected', 'linked', 'updated', 'created', 'failed']).order('row_index'));
  const connection = await getConnection(client, { env, fetchImpl });
  assertScopes(connection, ['accounting.invoices', 'accounting.contacts', 'accounting.settings.read'], 'Financial sync apply');
  const onResponse = ({ headers }) => {
    Object.assign(rate, xeroFinancialRateSnapshot(headers, rate));
    assertXeroFinancialDailyReserve(rate, env);
  };
    const [currentSalesforce, currentXero] = await Promise.all([
      loadSalesforce(XERO_FINANCIAL_CUTOFF),
      loadXero(connection, XERO_FINANCIAL_CUTOFF, { env, fetchImpl, onResponse }),
    ]);
    assertXeroFinancialDailyReserve(rate, env);
    const controls = await loadStoredFinancialControls(client);
    const classifications = buildFinancialClassifications(currentSalesforce, currentXero, controls, { postingMode });
    const currentBySource = new Map(classifications.rows.map((row) => [`${row.salesforceObject}:${row.salesforceId}`, row]));
    const unconfirmed = (rows || []).filter((row) => row.error_code === 'XERO_FINANCIAL_CONFIRMATION_UNCERTAIN');
    outcomes.push(...unconfirmed.map((row) => ({ id: row.id, status: 'failed', reviewRequired: true,
      errors: ['The previous Xero result was not confirmed. Create a fresh preview and review the current transaction before another posting.'] })));
    const pendingRows = (rows || []).filter((row) => !['linked', 'updated', 'created'].includes(row.status) && row.error_code !== 'XERO_FINANCIAL_CONFIRMATION_UNCERTAIN');
    const changes = changedXeroReviewItems(pendingRows, currentBySource);
    const changedIds = new Set(changes.map((row) => row.id));
    for (const change of changes) {
      const { error } = await client.from('xero_financial_sync_items').update({
        status: 'failed', error_code: 'XERO_FINANCIAL_REVIEW_CHANGED', error_message: change.reason,
        updated_at: new Date().toISOString(),
      }).eq('id', change.id);
      if (error) throw storageError(error, 'xero_financial_sync_items');
      outcomes.push({ id: change.id, status: 'failed', errors: [change.reason], reviewRequired: true });
    }
    const rowGroups = chunks(pendingRows.filter((row) => !changedIds.has(row.id)), MAX_BATCH_SIZE);
    for (const [groupIndex, group] of rowGroups.entries()) {
      const pending = group.filter((row) => !['linked', 'updated', 'created'].includes(row.status));
      const noWrite = pending.filter((row) => ['link', 'protected_legacy'].includes(row.proposed_action));
      for (const row of noWrite) outcomes.push(await finalizeLinkedItem(client, row, {
        current: currentBySource.get(`${row.source_object}:${row.source_id}`), run: started, tenantId: connection.tenantId, actor,
      }));
      const writes = pending.filter((row) => ['safe_update', 'create_draft'].includes(row.proposed_action));
      if (writes.some((row) => row.source_payload?.groupedPreservation)) throw financialError('Grouped preservation cannot post a Xero document.', 409, 'XERO_GROUPED_PRESERVATION_LINK_ONLY');
      for (const collection of ['Invoices', 'CreditNotes']) {
        const collectionRows = writes.filter((row) => row.source_payload?.xeroCollection === collection);
        if (!collectionRows.length) continue;
        assertXeroFinancialDailyReserve(rate, env);
        const idempotencyKey = `fcos-${body.runId}-${collection}-${collectionRows[0].row_index}`;
        outstandingPost = { rows: [...collectionRows], attemptCounts: new Map(collectionRows.map((row) => [row.id, Number(row.mutation_attempts || 0) + 1])),
          collection, idempotencyKey, returnedDocumentIds: [], nonRateLimitResponse: false };
        let response;
        try {
          response = await accountingFetch(connection, `/${collection}?summarizeErrors=false`, {
            method: 'POST', body: { [collection]: collectionRows.map((row) => row.proposed_payload) },
            idempotencyKey, retryOnRateLimit: true, env, fetchImpl,
            onResponse: (event) => {
              if (event.status !== 429) outstandingPost.nonRateLimitResponse = true;
              onResponse(event);
            },
          });
        } catch (error) {
          // A local reserve exception can be thrown by onResponse after Xero
          // accepted a 200 POST. Status=429 alone therefore proves nothing.
          if (!outstandingPost.nonRateLimitResponse && ['XERO_CONTACT_SYNC_RATE_LIMITED', 'XERO_CONTACT_SYNC_RATE_LIMIT_RETRY_EXHAUSTED'].includes(error.code)) outstandingPost = null;
          throw error;
        }
        const confirmations = documentWriteConfirmations(collectionRows, response?.[collection]);
        outstandingPost.returnedDocumentIds = confirmations.map((confirmation) => confirmation.response?.InvoiceID || confirmation.response?.CreditNoteID).filter(isUuid);
        for (const [index, row] of collectionRows.entries()) {
          const outcome = await finalizeDocumentOutcome(client, row, confirmations[index], actor);
          outcomes.push(outcome);
          if (['created', 'updated'].includes(outcome.status) || outcome.definitivelyRejected === true) outstandingPost.rows = outstandingPost.rows.filter((pending) => pending.id !== row.id);
        }
        if (outstandingPost.rows.length) throw financialError('Xero did not confirm every accounting result. Finance must verify the existing outcome before further document writes.', 409, 'XERO_FINANCIAL_CONFIRMATION_UNCERTAIN');
        outstandingPost = null;
      }
      if (groupIndex < rowGroups.length - 1) await sleep(batchDelayMs(env));
    }
    const summary = summarizeOutcomes(outcomes);
    const terminal = summary.failed ? 'partial' : 'completed';
    const { data: finished, error: finishError } = await client.rpc('finish_xero_financial_sync_run_v1', {
      p_run_id: body.runId,
      p_status: terminal,
      p_expected_revision: Number(started.revision),
      p_classification_summary: summary,
      p_rate_limit_snapshot: rate,
      p_error_code: null,
      p_error_message: null,
    });
    if (finishError) throw optimisticStorageError(finishError, 'Xero financial sync completion');
    await recordAudit(client, { runId: body.runId, eventType: 'document_apply_completed', outcome: terminal, actor, counts: summary, rate });
    return { run: serializeRun(finished), outcomes, summary, rateLimit: rate };
  } catch (error) {
    if (outstandingPost?.rows.length) {
      const message = 'A Xero document POST has an unconfirmed outcome. This run remains processing and blocks other document batches. Finance must verify the existing Xero outcome before this barrier can be released.';
      const uncertainty = financialError(message, 409, 'XERO_FINANCIAL_DOCUMENT_POST_UNCERTAIN', { runId: body.runId, processingBarrierRetained: true });
      // The processing row was committed before provider reads. If recording
      // diagnostics fails, leave that durable barrier intact; never finish here.
      try {
        await client.from('xero_financial_sync_runs').update({ error_code: uncertainty.code, error_message: message,
          rate_limit_snapshot: rate, updated_at: new Date().toISOString() }).eq('id', body.runId).eq('revision', Number(started.revision)).eq('status', 'processing');
      } catch { /* Retain the already committed processing barrier. */ }
      for (const row of outstandingPost.rows) {
        try {
          await client.from('xero_financial_sync_items').update({ status: 'failed', error_code: 'XERO_FINANCIAL_CONFIRMATION_UNCERTAIN',
            error_message: message, mutation_attempts: outstandingPost.attemptCounts.get(row.id),
            updated_at: new Date().toISOString() }).eq('id', row.id);
        } catch { /* Diagnostics must never turn uncertainty into an unlocked run. */ }
      }
      await recordAudit(client, { runId: body.runId, eventType: 'document_post_uncertain', outcome: 'failed', actor,
        counts: summarizeOutcomes(outcomes), rate, errorCode: uncertainty.code,
        fingerprints: { collection: outstandingPost.collection, idempotencyKey: outstandingPost.idempotencyKey,
          uncertainItemIds: outstandingPost.rows.map((row) => row.id), returnedDocumentIds: outstandingPost.returnedDocumentIds } }).catch(() => null);
      throw uncertainty;
    }
    const currentRevision = Number(started.revision);
    await client.rpc('finish_xero_financial_sync_run_v1', {
      p_run_id: body.runId,
      p_status: 'failed',
      p_expected_revision: currentRevision,
      p_classification_summary: summarizeOutcomes(outcomes),
      p_rate_limit_snapshot: rate,
      p_error_code: error.code || 'XERO_FINANCIAL_APPLY_FAILED',
      p_error_message: error.message,
    }).catch(() => null);
    await recordAudit(client, { runId: body.runId, eventType: 'document_apply_failed', outcome: 'failed', actor, counts: summarizeOutcomes(outcomes), rate, errorCode: error.code }).catch(() => null);
    throw error;
  }
}

export async function xeroFinancialPaymentApply(body = {}, dependencies = {}) {
  const {
    accessContext = null,
    env = process.env,
    fetchImpl = fetch,
    client = xeroContactSyncServiceClient(env),
    paymentPreview = previewPayments,
    getConnection = getFreshXeroConnection,
    accountingFetch = xeroAccountingFetch,
    persistReferenceLinks = persistReviewedPaymentReferenceLinks,
  } = dependencies;
  if (body.mode === 'link_existing') {
    requireExternalActionGate('xero_financial_sync', env);
    const requested = body.selectedPayments;
    if (body.reviewed !== true || !Array.isArray(requested) || !requested.length || requested.length > 25
      || requested.some((row) => !/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(row?.id || '')
        || !/^[a-f0-9]{64}$/.test(row?.sourceFingerprint || '') || !/^[a-f0-9]{64}$/.test(row?.reviewFingerprint || ''))
      || new Set(requested.map((row) => row.id.slice(0, 15))).size !== requested.length) {
      throw financialError('Select up to 25 distinct reviewed existing payment links.', 400, 'XERO_PAYMENT_REFERENCE_REVIEW_REQUIRED');
    }
    const preview = await paymentPreview({ ...body, persist: false, recordExactMatches: false }, { accessContext, env, fetchImpl, client });
    const rows = requested.map((selected) => {
      const matches = preview.rows.filter((row) => row.salesforcePaymentId === selected.id);
      const row = matches.length === 1 ? matches[0] : null;
      if (!row || (row.blockers || []).length || row.proposedPayment
        || !((row.action === 'payment_reference_link' && row.status === 'eligible' && row.reviewRequired === true)
          || (row.action === 'payment_link' && row.status === 'protected' && row.acceptedReference === true))
        || row.sourceFingerprint !== selected.sourceFingerprint || row.reviewFingerprint !== selected.reviewFingerprint
        || !row.referenceReviewFingerprint || !row.retainedReferenceEvidence) {
        throw financialError('Existing payment evidence or selection changed. Refresh and review every selected link again.', 409, 'XERO_PAYMENT_REFERENCE_REVIEW_CHANGED');
      }
      return row;
    });
    const connection = await getConnection(client, { env, fetchImpl });
    if (!preview.tenantId || preview.tenantId !== connection.tenantId) throw financialError('The Xero tenant changed. Refresh before linking.', 409, 'XERO_PAYMENT_TENANT_CHANGED');
    assertScopes(connection, ['accounting.payments.read', 'accounting.invoices', 'accounting.settings.read'], 'Existing payment link review');
    return { ...await persistReferenceLinks(client, { tenantId: preview.tenantId, rows, actor: actorFields(accessContext) }), rateLimit: preview.rateLimit };
  }
  if (body.mode !== 'apply') return paymentPreview(body, { accessContext, env, fetchImpl, client });
  requireExternalActionGate('xero_financial_sync', env);
  if (body.reviewed !== true) throw financialError('Finance review is required before applying Xero payments.', 400, 'XERO_FINANCIAL_REVIEW_REQUIRED');
  const preview = await paymentPreview({ ...body, persist: false }, { accessContext, env, fetchImpl, client });
  const reviewedFingerprints = new Map((body.selectedPayments || []).map((row) => [String(row.id || ''), String(row.sourceFingerprint || '')]));
  if (!reviewedFingerprints.size || (body.selectedPayments || []).some((row) => !row.sourceFingerprint || !row.reviewFingerprint)) throw financialError('Refresh and review the selected payment allocations before applying them.', 400, 'XERO_FINANCIAL_REVIEW_REQUIRED');
  const selected = new Set(reviewedFingerprints.keys());
  const allocationReviews = new Map((body.selectedPayments || []).map((row) => [String(row.id || ''), row.reviewFingerprint]));
  const stale = preview.rows.filter((row) => selected.has(row.salesforcePaymentId)
    && reviewedFingerprints.size
    && (reviewedFingerprints.get(row.salesforcePaymentId) !== row.sourceFingerprint
      || !allocationReviews.get(row.salesforcePaymentId) || allocationReviews.get(row.salesforcePaymentId) !== row.reviewFingerprint));
  const staleIds = new Set(stale.map((row) => row.salesforcePaymentId));
  const eligible = preview.rows.filter((row) => selected.has(row.salesforcePaymentId) && !staleIds.has(row.salesforcePaymentId) && row.action === 'payment_apply' && row.status === 'eligible');
  if (!eligible.length) throw financialError('No exact eligible payments were selected.', 400, 'XERO_FINANCIAL_NO_ELIGIBLE_PAYMENTS');
  for (const group of index(eligible, (row) => row.proposedPayment.Invoice.InvoiceID).values()) {
    const amount = group.reduce((sum, row) => sum + row.amount, 0);
    if (!Number.isFinite(group[0].amountDue) || amount > group[0].amountDue + 0.01) throw financialError('The selected payments exceed the current invoice amount due. Review the allocation selection.', 409, 'XERO_PAYMENT_SELECTION_EXCEEDS_DUE');
  }
  const connection = await getConnection(client, { env, fetchImpl });
  assertScopes(connection, ['accounting.payments'], 'Payment apply');
  if (!preview.tenantId || preview.tenantId !== connection.tenantId) throw financialError('The connected Xero tenant changed during payment review. Refresh before posting.', 409, 'XERO_PAYMENT_TENANT_CHANGED');
  const rate = {};
  const onResponse = ({ headers }) => {
    Object.assign(rate, xeroFinancialRateSnapshot(headers, rate));
    assertXeroFinancialDailyReserve(rate, env);
  };
  const actor = actorFields(accessContext);
  const outcomes = stale.map((row) => ({ salesforcePaymentId: row.salesforcePaymentId, status: 'failed', reviewRequired: true, errors: ['Payment, bank or invoice changed. Review this allocation again.'] }));
  await accountingFetch(connection, '/Organisations', { method: 'GET', env, fetchImpl, onResponse });
  assertXeroFinancialDailyReserve(rate, env);
  for (const group of chunks(eligible, MAX_BATCH_SIZE)) {
    outcomes.push(...await postReviewedPaymentBatch(group, { client, connection, actor, accountingFetch, options: { env, fetchImpl, onResponse } }));
  }
  await recordAudit(client, { runId: null, eventType: 'payment_apply_completed', outcome: outcomes.some((row) => row.status === 'failed') ? 'partial' : 'success', actor, counts: summarizeOutcomes(outcomes), rate });
  return { outcomes, summary: summarizeOutcomes(outcomes), rateLimit: rate };
}

async function previewPayments(body, { accessContext, env, fetchImpl, client, xeroReadSnapshot = null }) {
  const cutoff = XERO_FINANCIAL_CUTOFF;
  const connection = await getFreshXeroConnection(client, { env, fetchImpl });
  assertScopes(connection, ['accounting.payments.read', 'accounting.invoices', 'accounting.settings.read'], 'Payment preview');
  const [payments, documentMappings, paymentMappings, bankMappings] = await Promise.all([
    xeroReadSnapshot?.sourcePayments || loadSalesforcePayments(cutoff),
    allFinancialRows(client, 'xero_financial_document_mappings'),
    allFinancialRows(client, 'xero_financial_payment_mappings'),
    allFinancialRows(client, 'xero_financial_bank_mappings', (query) => query.eq('enabled', true)),
  ]);
  for (const result of [documentMappings, paymentMappings, bankMappings]) if (result.error) throw storageError(result.error, 'xero_financial_payment_preview');
  const paymentPostingClaims = await loadPaymentPostingClaims(client, connection.tenantId, payments.map((payment) => payment.Id));
  const evidenceIds = xeroPaymentEvidenceIds(payments, documentMappings.data, paymentMappings.data);
  evidenceIds.paymentIds = uniqueStrings([...evidenceIds.paymentIds, ...paymentClaimEvidenceIds(paymentPostingClaims)]);
  const rate = {};
  const onResponse = ({ headers }) => Object.assign(rate, xeroFinancialRateSnapshot(headers, rate));
  const readSnapshot = await loadXeroPaymentEvidence(connection, cutoff, {
    env, fetchImpl, onResponse, invoices: xeroReadSnapshot?.invoices, payments: xeroReadSnapshot?.payments, ...evidenceIds,
  });
  const [accountResponse, organisationResponse] = await Promise.all([
    xeroAccountingFetch(connection, '/Accounts', { method: 'GET', env, fetchImpl, onResponse }),
    xeroAccountingFetch(connection, '/Organisations', { method: 'GET', env, fetchImpl, onResponse }),
  ]);
  const organisationRow = organisationResponse.Organisations?.[0] || {};
  const organisation = { baseCurrency: organisationRow.BaseCurrency || null, periodLockDate: dateOnly(organisationRow.PeriodLockDate), endOfYearLockDate: dateOnly(organisationRow.EndOfYearLockDate) };
  const bankAccounts = new Map((accountResponse.Accounts || []).filter((account) => account.Status === 'ACTIVE' && account.Type === 'BANK').map((account) => [account.AccountID, account]));
  const [xeroPayments, xeroInvoices] = [readSnapshot.payments, readSnapshot.invoices];
  const documentBySupplierInvoice = new Map((documentMappings.data || []).filter((row) => row.salesforce_object === 'Supplier_Invoice__c').map((row) => [row.salesforce_id, row]));
  const documentMappingById = new Map((documentMappings.data || []).map((row) => [row.id, row]));
  const buyerByStem = index((documentMappings.data || []).filter((row) => row.salesforce_object === 'Invoice__c'), (row) => row.retained_differences?.stemId || row.stem_id);
  const existingBySalesforce = new Map((paymentMappings.data || []).map((row) => [row.salesforce_payment_id, row]));
  const bankByName = new Map((bankMappings.data || []).map((row) => [normalizeName(row.salesforce_bank_name), row]));
  const currentDocumentById = new Map(xeroInvoices.map((row) => [row.InvoiceID, normalizeXeroInvoice(row)]));
  const rows = payments.map((payment) => classifyXeroFinancialPayment(payment, {
    documentBySupplierInvoice,
    documentMappingById,
    buyerByStem,
    existingBySalesforce,
    bankByName,
    xeroPayments,
    paymentMappings: paymentMappings.data || [],
    currentDocumentById, organisation, bankAccounts, paymentPostingClaims, tenantId: connection.tenantId,
  }));
  blockRepeatedFinancialTargets(rows, (row) => row.xeroPaymentId, 'More than one Salesforce payment matches this Xero payment. Resolve the payment identity before linking.');
  blockRepeatedFinancialTargets(rows, (row) => row.action === 'payment_apply' ? hashJson({ payment: row.proposedPayment, currency: row.currency }) : null,
    'More than one Salesforce payment proposes this exact allocation. Resolve the duplicate payment identity before posting.');
  for (const row of rows) while (row.blockerCodes.length < row.blockers.length) row.blockerCodes.push('finance_exception');
  if (body.recordExactMatches === true) {
    const exactMappings = [];
    const xeroById = new Map(xeroPayments.map((row) => [row.PaymentID, row]));
    for (const row of rows.filter((item) => item.action === 'payment_link' && item.status === 'eligible' && !item.blockers.length)) {
      const matched = xeroById.get(row.xeroPaymentId);
      if (!matched || !row.documentMappingId) continue;
      exactMappings.push({
        salesforce_payment_id: row.salesforcePaymentId, salesforce_payment_name: row.salesforcePaymentName,
        document_mapping_id: row.documentMappingId, xero_payment_id: matched.PaymentID,
        xero_bank_account_id: matched.Account?.AccountID, source_fingerprint: row.sourceFingerprint,
        amount: row.amount, currency: row.currency, payment_date: row.paymentDate, ...row.confirmedPayment, status: 'linked',
        last_reconciled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
    for (const batch of chunks(exactMappings, 100)) {
      const { error } = await client.from('xero_financial_payment_mappings').upsert(batch, { onConflict: 'salesforce_payment_id' });
      if (error) throw storageError(error, 'xero_financial_payment_mappings');
    }
    for (const row of rows.filter((item) => item.action === 'payment_link' && ['eligible', 'protected'].includes(item.status) && !item.blockers.length)) {
      const claim = paymentPostingClaims.get(row.salesforcePaymentId);
      if (claim) await resolvePaymentPostingClaim(client, claim, xeroById.get(row.xeroPaymentId), actorFields(accessContext));
    }
  }
  return { rows, tenantId: connection.tenantId, summary: summarizeClassifications(rows), rateLimit: rate, actor: actorFields(accessContext) };
}

export function classifyXeroFinancialPayment(payment, context) {
  const row = classifyPayment(payment, context);
  // Keep durable payment/reference identities stable; every actionable review also
  // binds the complete current source inventory, including unlinked invoices.
  row.reviewFingerprint = hashJson({ review: row.reviewFingerprint, tenantId: context.tenantId || null,
    ...(payment.RecordType?.DeveloperName === 'Receivable' ? { buyerDocuments: payment._buyerDocumentEvidence ?? null } : {}) });
  const actual = context.xeroPayments.find((item) => item.PaymentID === row.xeroPaymentId);
  return reviewPaymentPostingClaim(row, context.paymentPostingClaims?.get(payment.Id), actual);
}

function classifyPayment(payment, context) {
  const existing = context.existingBySalesforce.get(payment.Id)
    || [...context.existingBySalesforce.values()].find((row) => String(row.salesforce_payment_id).slice(0, 15) === String(payment.Id).slice(0, 15));
  if (existing) {
    const xeroPayment = context.xeroPayments.find((row) => row.PaymentID === existing.xero_payment_id);
    const documentMapping = context.documentMappingById.get(existing.document_mapping_id);
    const currentDocument = documentMapping ? context.currentDocumentById?.get(documentMapping.xero_document_id) : null;
    if (existing.retained_reference && Object.keys(existing.retained_reference).length) return referencePaymentRow(payment, context, documentMapping, currentDocument, existing);
    const blockers = [...unsupportedPaymentBlockers(payment), ...paymentDocumentIdentityBlockers(payment, documentMapping, currentDocument),
      ...buyerPaymentDocumentBlockers(payment, documentMapping)];
    if (xeroPayment) {
      const selected = selectXeroPaymentMatch({ payment, documentMapping, bankAccountId: existing.xero_bank_account_id,
        xeroPayments: [xeroPayment], paymentMappings: context.paymentMappings || [...context.existingBySalesforce.values()] });
      blockers.push(...selected.blockers);
      if (selected.match?.PaymentID !== existing.xero_payment_id) blockers.push('The stored Xero payment no longer matches the exact amount, date, bank and reference. Review this allocation again.');
    }
    if (!xeroPayment) blockers.push('The stored Xero payment link no longer points to a current payment.');
    if (!documentMapping) blockers.push('The stored Xero payment no longer has its document mapping.');
    if (xeroPayment && documentMapping && xeroPayment.Invoice?.InvoiceID !== documentMapping.xero_document_id) blockers.push('The stored Xero payment is allocated to a different Xero transaction.');
    if (xeroPayment && !sameMoney(xeroPayment.Amount, Math.abs(Number(payment.Amount__c || 0)))) blockers.push('The stored Xero payment amount differs from Salesforce.');
    if (xeroPayment && dateOnly(xeroPayment.Date) !== dateOnly(payment.Date__c)) blockers.push('The stored Xero payment date differs from Salesforce.');
    if (xeroPayment && existing.xero_bank_account_id && xeroPayment.Account?.AccountID !== existing.xero_bank_account_id) blockers.push('The stored Xero payment bank account differs from its approved mapping.');
    if (xeroPayment && String(xeroPayment.Reference || '') !== paymentReference(payment)) blockers.push('The stored Xero payment reference differs from Salesforce.');
    const legacyFingerprint = !payment._bankEvidence && [legacyPaymentSourceFingerprint(payment), paymentSourceFingerprint(payment, false)].includes(existing.source_fingerprint);
    if (existing.source_fingerprint !== paymentSourceFingerprint(payment) && (!legacyFingerprint || !documentMapping?.retained_differences?.accountId)) blockers.push('The Salesforce payment changed or its saved Account evidence is incomplete. Run the document check and review this payment again.');
    return paymentRow(payment, blockers.length ? 'blocked' : 'payment_link', blockers.length ? 'blocked' : legacyFingerprint ? 'eligible' : 'protected', uniqueStrings(blockers), documentMapping, xeroPayment, null, currentDocument);
  }
  const type = String(payment.RecordType?.DeveloperName || '');
  let documentMapping = null;
  const blockers = unsupportedPaymentBlockers(payment);
  if (type === 'Payable') {
    documentMapping = context.documentBySupplierInvoice.get(payment.Supplier_Invoice__c);
    if (!payment.Supplier_Invoice__c) blockers.push('Payable payment is not linked to one exact Supplier Invoice.');
  } else if (type === 'Receivable') {
    const candidates = context.buyerByStem.get(payment.STEM__c) || [];
    if (candidates.length === 1) [documentMapping] = candidates;
    else blockers.push(candidates.length ? 'More than one buyer invoice exists for this STEM.' : 'No linked buyer invoice exists for this STEM.');
  } else {
    blockers.push(`Payment type ${type || 'Unknown'} is outside exact Receivable/Payable allocations.`);
  }
  const currentDocument = documentMapping ? context.currentDocumentById.get(documentMapping.xero_document_id) : null;
  blockers.push(...paymentDocumentIdentityBlockers(payment, documentMapping, currentDocument));
  blockers.push(...buyerPaymentDocumentBlockers(payment, documentMapping));
  const bankName = normalizeName(payment.Bank__c);
  const bank = bankName ? context.bankByName.get(bankName) : null;
  if (bankName && !bank) blockers.push(`No approved Xero bank mapping exists for ${payment.Bank__c}.`);
  const amount = Number(payment.Amount__c);
  const matched = selectXeroPaymentMatch({ payment, documentMapping, bankAccountId: bank?.xero_bank_account_id,
    xeroPayments: context.xeroPayments, paymentMappings: context.paymentMappings || [...context.existingBySalesforce.values()] });
  if (!matched.match && !blockers.length) {
    const retained = referencePaymentRow(payment, context, documentMapping, currentDocument);
    if (retained?.action === 'payment_reference_link') return retained;
  }
  blockers.push(...matched.blockers);
  if (matched.match) return paymentRow(payment, blockers.length ? 'blocked' : 'payment_link', blockers.length ? 'blocked' : 'eligible',
    uniqueStrings(blockers), documentMapping, matched.match, null, currentDocument);
  const sourceCurrency = paymentCurrency(payment);
  const bankAccount = context.bankAccounts?.get(bank?.xero_bank_account_id);
  if (!bankAccount || !bankAccount.CurrencyCode) blockers.push('The approved Xero bank account currency could not be verified.');
  else if (bankAccount.CurrencyCode !== sourceCurrency) blockers.push('Payment and Xero bank currencies differ. Routine FX payments are not supported.');
  if (!context.organisation?.baseCurrency || context.organisation.baseCurrency !== sourceCurrency) blockers.push('Routine payment requires verified matching source and Xero organisation currencies.');
  const paymentLock = [context.organisation?.periodLockDate, context.organisation?.endOfYearLockDate].filter(Boolean).sort().at(-1);
  if (paymentLock && dateOnly(payment.Date__c) <= paymentLock) blockers.push('Payment date falls in a locked Xero period.');
  if (currentDocument && amount > Number(currentDocument.amountDue || 0) + 0.01) blockers.push('Payment exceeds the linked Xero transaction amount due.');
  const proposedPayment = blockers.length ? null : {
    Invoice: { InvoiceID: documentMapping.xero_document_id },
    Account: { AccountID: bank.xero_bank_account_id },
    Date: payment.Date__c,
    Amount: amount,
    Reference: paymentReference(payment),
  };
  return paymentRow(payment, blockers.length ? 'blocked' : 'payment_apply', blockers.length ? 'blocked' : 'eligible', uniqueStrings(blockers), documentMapping, null, proposedPayment, currentDocument);
}

function referencePaymentRow(payment, context, mapping, currentDocument, existing = null) {
  const bankName = normalizeName(payment.Bank__c);
  const bank = bankName ? context.bankByName.get(bankName) : null;
  const result = selectXeroReferenceRetentionMatch({ payment, documentMapping: mapping, currentDocument,
    bankAccountId: bank?.xero_bank_account_id, bankAccount: context.bankAccounts?.get(bank?.xero_bank_account_id),
    organisation: context.organisation, xeroPayments: context.xeroPayments,
    paymentMappings: context.paymentMappings || [...context.existingBySalesforce.values()] });
  const blockers = uniqueStrings([...unsupportedPaymentBlockers(payment), ...buyerPaymentDocumentBlockers(payment, mapping), ...result.blockers]);
  const actual = result.match;
  if (!actual || blockers.length || !context.tenantId || !bank?.id || !Number.isInteger(bank.revision)) {
    return paymentRow(payment, 'blocked', 'blocked', [...blockers, 'Retained-reference evidence is incomplete or changed. Review the existing payment; no replacement will be created.'], mapping, actual, null, currentDocument);
  }
  const sourceFingerprint = paymentSourceFingerprint(payment);
  const snapshot = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key] ?? null]));
  const referenceComparison = { sourceReference: payment.Reference__c || null,
    sourceFallbackReference: payment.Name, xeroReference: actual.Reference };
  const evidence = { version: 1, tenantId: context.tenantId, sourceFingerprint, accountId: payment.Account__c,
    sourcePaymentId: payment.Id, referenceComparison,
    documentMapping: snapshot(mapping, ['id', 'salesforce_object', 'salesforce_id', 'xero_document_id', 'xero_document_type',
      'xero_contact_id', 'source_fingerprint', 'retained_differences', 'protected_legacy']),
    bankMapping: snapshot(bank, ['id', 'salesforce_bank_name', 'xero_bank_account_id', 'revision', 'enabled']),
    document: snapshot(currentDocument, ['id', 'type', 'contactId', 'currency', 'total']),
    payment: { id: actual.PaymentID, invoiceId: actual.Invoice.InvoiceID, type: actual.PaymentType, invoiceType: actual.Invoice.Type,
      contactId: actual.Invoice.Contact.ContactID, bankAccountId: actual.Account.AccountID,
      currency: actual.Invoice.CurrencyCode, bankCurrency: actual.Account.CurrencyCode, status: actual.Status,
      amount: actual.Amount, bankAmount: actual.BankAmount, currencyRate: actual.CurrencyRate, date: dateOnly(actual.Date), reference: actual.Reference } };
  const referenceReviewFingerprint = hashJson(evidence);
  const proof = existing?.retained_reference;
  const acceptedReference = Boolean(proof?.version === 1 && proof.tenantId === context.tenantId
    && proof.sourceFingerprint === sourceFingerprint && proof.referenceReviewFingerprint === referenceReviewFingerprint
    && existing.xero_payment_id === actual.PaymentID && existing.document_mapping_id === mapping.id
    && existing.xero_bank_account_id === actual.Account.AccountID && hashJson(proof.evidence ?? null) === referenceReviewFingerprint
    && existing.status === 'linked' && existing.exception_reason == null && existing.source_fingerprint === sourceFingerprint
    && Number(existing.amount) === Number(payment.Amount__c) && existing.currency === paymentCurrency(payment)
    && existing.payment_date === dateOnly(payment.Date__c));
  if (existing && !acceptedReference) blockers.push('The approved reference-retention evidence changed. Finance must resolve the saved payment link before further action.');
  return { ...paymentRow(payment, blockers.length ? 'blocked' : acceptedReference ? 'payment_link' : 'payment_reference_link',
    blockers.length ? 'blocked' : acceptedReference ? 'protected' : 'eligible', blockers, mapping, actual, null, currentDocument),
  bankAccountId: actual.Account.AccountID, referenceComparison, referenceReviewFingerprint,
  xeroDocumentId: mapping.xero_document_id, xeroDocumentNumber: mapping.xero_document_number || null,
  bankAccountCode: context.bankAccounts.get(actual.Account.AccountID)?.Code || null,
  bankAccountName: context.bankAccounts.get(actual.Account.AccountID)?.Name || null,
  retainedReferenceEvidence: evidence, reviewFingerprint: referenceReviewFingerprint,
  reviewRequired: !acceptedReference && !blockers.length, acceptedReference };
}

function paymentRow(payment, action, status, blockers, mapping, xeroPayment, proposedPayment = null, currentDocument = null) {
  return {
    salesforcePaymentId: payment.Id,
    salesforcePaymentName: payment.Name,
    stemId: payment.STEM__c,
    supplierInvoiceId: payment.Supplier_Invoice__c,
    type: payment.RecordType?.DeveloperName,
    amount: Number(payment.Amount__c || 0),
    currency: paymentCurrency(payment),
    paymentDate: payment.Date__c,
    bank: payment.Bank__c,
    ...(payment._bankEvidence ? { bankEvidence: payment._bankEvidence } : {}),
    ...(payment._buyerDocumentEvidence ? { buyerDocumentEvidence: payment._buyerDocumentEvidence } : {}),
    action,
    status,
    blockers,
    blockerCodes: blockers.map((message) => message === 'No linked buyer invoice exists for this STEM.' || message === 'The Salesforce document is not durably linked to Xero. Run the document check again.' ? 'invoice_link_pending' : message === 'The linked Xero transaction is not authorised for payment.' && ['DRAFT', 'SUBMITTED'].includes(currentDocument?.status) ? 'invoice_authorisation_pending' : 'finance_exception'),
    documentMappingId: mapping?.id || null,
    xeroPaymentId: xeroPayment?.PaymentID || null,
    proposedPayment,
    amountDue: currentDocument?.amountDue ?? null,
    sourceFingerprint: paymentSourceFingerprint(payment),
    reviewFingerprint: hashJson({ source: paymentSourceFingerprint(payment), proposedPayment, mappingId: mapping?.id, xeroPayment, currentDocument, blockers }),
    xeroDocumentUrl: mapping ? xeroDocumentUrl({ id: mapping.xero_document_id, type: mapping.xero_document_type }) : null,
  };
}

function paymentSourceFingerprint(payment, includeCurrency = true) {
  return hashJson({ ...(includeCurrency ? { currency: paymentCurrency(payment) } : {}), id: payment.Id, amount: payment.Amount__c, date: payment.Date__c, bank: payment.Bank__c, invoice: payment.Supplier_Invoice__c, stem: payment.STEM__c, reference: paymentReference(payment), type: payment.RecordType?.DeveloperName, deposit: payment.Is_Deposit__c, account: payment.Account__c, commission: payment.Commission_Invoice__c, volumeDiscount: payment.Is_Volume_Discount__c, ...(payment._bankEvidence ? { bankEvidence: payment._bankEvidence } : {}) });
}

// Upgrade old fingerprints only after all current invoice, Account, bank and allocation evidence passes.
function legacyPaymentSourceFingerprint(payment) {
  return hashJson({ id: payment.Id, amount: payment.Amount__c, date: payment.Date__c, bank: payment.Bank__c, invoice: payment.Supplier_Invoice__c, stem: payment.STEM__c, reference: paymentReference(payment), type: payment.RecordType?.DeveloperName, deposit: payment.Is_Deposit__c });
}

function paymentReference(payment) {
  return String(payment.Reference__c || payment.Name || '');
}

function unsupportedPaymentBlockers(payment) {
  const blockers = [];
  if (payment._bankEvidenceBlocker) blockers.push(payment._bankEvidenceBlocker);
  if (!normalizeName(payment.Bank__c) && !payment._bankEvidenceBlocker) blockers.push('Salesforce payment bank is missing. Identify the actual bank in Salesforce, then recheck this payment.');
  if (payment.Is_Deposit__c) blockers.push('Deposit payments require Finance allocation before Xero sync.');
  if (payment.Commission_Invoice__c) blockers.push('Commission-linked payments require Finance allocation before Xero sync.');
  if (payment.Is_Volume_Discount__c) blockers.push('Volume-discount payments require Finance allocation before Xero sync.');
  return blockers;
}

export async function loadSalesforceFinancialSnapshot(cutoff, querySalesforce = sfCompositeQueries, safetyContext = null) {
  safetyContext ||= await loadFinancialSafetyContext();
  const selected = (object, fields, prefix = '') => safetySelectFields(safetyContext, object, fields, prefix);
  const quotedCutoff = cutoff;
  const queries = [
    PETROLEUM_PRODUCT_QUERY,
    BUYER_INVOICE_QUERY.replace('LastModifiedDate', `LastModifiedDate, Proforma__c, Deprecated__c, File__c${selected('Invoice__c', ['CurrencyIsoCode', 'Buyer_Charge_Snapshot__c', 'Delivery_Date__c'])}${selected('STEM__c', ['CurrencyIsoCode', 'Payment_Term__c'], 'STEM__r.')}`).replaceAll('{cutoff}', quotedCutoff),
    SUPPLIER_INVOICE_QUERY.replace('LastModifiedDate', `LastModifiedDate${selected('Supplier_Invoice__c', ['CurrencyIsoCode', 'Invoice_File__c', 'Invoice_Upload_Date__c', 'File__c', 'Status__c', 'Invoice_Status__c'])}`).replaceAll('{cutoff}', quotedCutoff),
    `SELECT Id, Name, Buyer_Invoice__c, Supplier_Invoice__c, Product__c, Product__r.Name,
            Quantity_Delivered_Per_BDN__c, Quantity__c, Unit_of_Measure__c,
            Price_Per_Unit__c, Cost_Per_Unit__c, Total_Price__c, Total_Cost__c, LastModifiedDate${selected('STEM_Line_Item__c', ['CurrencyIsoCode', 'Quantity_Max__c', 'Unit_Sell_At__c', 'Unit_Buy_At__c', 'Cancelled__c', 'STEM__c', 'Supplier__c'])}
       FROM STEM_Line_Item__c
      WHERE Cancelled__c = false
        AND ((Buyer_Invoice__c != null AND (Buyer_Invoice__r.Invoice_Date__c >= ${quotedCutoff}
          OR (Buyer_Invoice__r.Invoice_Date__c = null AND Buyer_Invoice__r.CreatedDate >= ${quotedCutoff}T00:00:00Z)))
          OR (Supplier_Invoice__c != null AND (Supplier_Invoice__r.Invoice_Date__c >= ${quotedCutoff}
          OR (Supplier_Invoice__r.Invoice_Date__c = null AND Supplier_Invoice__r.CreatedDate >= ${quotedCutoff}T00:00:00Z))))`,
    `SELECT Id, Name, Description__c, Buyer_Invoice__c, Supplier_Invoice__c, Product2Id__c, Product2Id__r.Name,
            Quantity_Delivered_Per_BDN__c, Quantity__c, Unit_of_Measure__c,
            Unit_Price__c, Unit_Cost__c, Lumpsum_Price__c, Lumpsum_Cost__c,
            Line_Total__c, Line_Total_Buy__c, LastModifiedDate${selected('STEM_Extra_Cost__c', ['CurrencyIsoCode', 'Quantity_Range_Max__c', 'Cancelled__c', 'STEM__c', 'Supplier__c'])}
       FROM STEM_Extra_Cost__c
      WHERE Cancelled__c = false
        AND ((Buyer_Invoice__c != null AND (Buyer_Invoice__r.Invoice_Date__c >= ${quotedCutoff}
          OR (Buyer_Invoice__r.Invoice_Date__c = null AND Buyer_Invoice__r.CreatedDate >= ${quotedCutoff}T00:00:00Z)))
          OR (Supplier_Invoice__c != null AND (Supplier_Invoice__r.Invoice_Date__c >= ${quotedCutoff}
          OR (Supplier_Invoice__r.Invoice_Date__c = null AND Supplier_Invoice__r.CreatedDate >= ${quotedCutoff}T00:00:00Z))))`,
    'SELECT Id, Name, Company_Code__c, Inactive_Suspended__c, RecordType.DeveloperName FROM Account ORDER BY Id',
  ];
  const results = await querySalesforce(queries.map((soql) => ({ soql, clean: true, limit: 100000 })));
  const [productResult, buyerResult, supplierResult, lineResult, extraResult, accountResult] = results;
  const allResults = [productResult, buyerResult, supplierResult, lineResult, extraResult, accountResult];
  const failedIndex = allResults.findIndex((result) => !Array.isArray(result?.records) || result?.error || Number(result.totalSize || 0) > result.records.length);
  if (failedIndex >= 0) throw financialError(`Salesforce financial snapshot is incomplete: ${allResults[failedIndex]?.error || 'Record limit reached'}`, 502, 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE');
  const groupedAccountSnapshot = completeGroupedAccountSnapshot(accountResult);
  if (!groupedAccountSnapshot.complete) throw financialError('Complete global Salesforce Account identity evidence is unavailable.', 502, 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE');
  const fileIds = uniqueStrings((buyerResult.records || []).filter((row) => row.Buyer_Charge_Snapshot__c).map((row) => String(row.File__c || '').split('/').at(-1))).filter((id) => /^069[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(id));
  const documents = new Map();
  for (const batch of chunks(fileIds, 200)) {
    const [result] = await querySalesforce([{ soql: `SELECT Id, LatestPublishedVersionId FROM ContentDocument WHERE Id IN (${batch.map((id) => `'${id}'`).join(',')})`, clean: true, limit: 100000 }]);
    if (result?.error || !Array.isArray(result?.records) || Number(result.totalSize || 0) > result.records.length) throw financialError('Issued source document verification was incomplete.', 502, 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE');
    for (const row of result.records) documents.set(row.Id, row);
  }
  for (const row of buyerResult.records || []) if (row.Buyer_Charge_Snapshot__c) row._buyerInvoiceDocument = documents.get(String(row.File__c || '').split('/').at(-1)) || null;
  const productMap = new Map((productResult.records || []).filter((row) => row.RecordType?.DeveloperName === 'Petroleum_Product').map((row) => [row.Id, { id: row.Id, name: row.Name }]));
  for (const row of [...(lineResult.records || []), ...(extraResult.records || [])]) {
    const productId = row.Product__c || row.Product2Id__c;
    const productName = row.Product__r?.Name || row.Product2Id__r?.Name;
    if (productId && productName) productMap.set(productId, { id: productId, name: productName });
  }
  return {
    safetyContext,
    cutoffDate: cutoff,
    groupedAccountSnapshot,
    productRecords: productResult.records || [],
    buyers: buyerResult.records || [],
    suppliers: supplierResult.records || [],
    lines: lineResult.records || [],
    extras: extraResult.records || [],
    products: [...productMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    fingerprintBasis: {
      safetyContext,
      accounts: groupedAccountSnapshot.accounts,
      products: productResult.records || [],
      buyers: (buyerResult.records || []).map(financialRecordFingerprint),
      suppliers: (supplierResult.records || []).map(financialRecordFingerprint),
      lines: (lineResult.records || []).map(financialRecordFingerprint),
      extras: (extraResult.records || []).map(financialRecordFingerprint),
    },
  };
}

export async function loadSalesforcePayments(cutoff, safetyContext = null, querySalesforce = sfQuery) {
  safetyContext ||= await loadFinancialSafetyContext();
  const fields = `Id, Name, CreatedDate, RecordType.DeveloperName, STEM__c, Account__c, Amount__c, Date__c,
           Supplier_Invoice__c, Reference__c, Bank__c, Remittance__c, Is_Deposit__c,
           Commission_Invoice__c, Is_Volume_Discount__c, LastModifiedDate${safetySelectFields(safetyContext, 'Payment__c', ['CurrencyIsoCode'])}`;
  const result = await querySalesforce(`
    SELECT ${fields}
      FROM Payment__c
     WHERE (Date__c >= ${cutoff} OR (Date__c = null AND CreatedDate >= ${cutoff}T00:00:00Z))
     ORDER BY Date__c, Id`, { clean: true, limit: 100000 });
  if (result.error || Number(result.totalSize || 0) > (result.records || []).length) throw financialError('Salesforce payment retrieval is incomplete.', 502, 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE');
  const withCurrency = (payment) => ({ ...payment, _currency: financialSourceCurrency(payment, [], safetyContext, 'Payment__c') });
  const payments = await enrichBuyerPaymentDocumentEvidence((result.records || []).map(withCurrency), {
    querySalesforce,
    currencyFields: safetySelectFields(safetyContext, 'Invoice__c', ['CurrencyIsoCode', 'Is_Credit_Note__c', 'Credit_Note__c', 'CreditNote__c']),
    currencyForRecord: (record) => financialSourceCurrency(record, [], safetyContext, 'Invoice__c'),
  });
  const candidates = payments.filter((payment) => payment.RecordType?.DeveloperName === 'Receivable'
    && !normalizeName(payment.Bank__c) && Number(payment.Amount__c) > 0);
  if (!candidates.length) return payments;
  const parentIds = uniqueStrings(candidates.map((payment) => payment.Remittance__c).filter((value) => /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value)));
  let parents = [];
  let siblings = [];
  let complete = true;
  try {
    for (const idBatch of chunks(parentIds, 50)) {
      const ids = idBatch.map((id) => `'${id}'`).join(',');
      const [parentResult, siblingResult] = await Promise.all([
        querySalesforce(`SELECT ${fields} FROM Payment__c WHERE Id IN (${ids}) ORDER BY Id`, { clean: true, limit: 100000 }),
        querySalesforce(`SELECT ${fields} FROM Payment__c WHERE Remittance__c IN (${ids}) ORDER BY Remittance__c, Id`, { clean: true, limit: 100000 }),
      ]);
      if (parentResult.error || siblingResult.error || parentResult.done === false || siblingResult.done === false
        || !Number.isSafeInteger(parentResult.totalSize)
        || !Number.isSafeInteger(siblingResult.totalSize) || parentResult.totalSize !== parentResult.records?.length
        || siblingResult.totalSize !== siblingResult.records?.length
        || parentResult.records.some((row) => !idBatch.includes(row.Id))
        || siblingResult.records.some((row) => !idBatch.includes(row.Remittance__c))) { complete = false; break; }
      parents.push(...parentResult.records.map(withCurrency));
      siblings.push(...siblingResult.records.map(withCurrency));
    }
  } catch { complete = false; }
  const parentsById = new Map();
  const siblingsByParent = new Map();
  if (complete) {
    for (const parent of parents) parentsById.set(parent.Id, [...(parentsById.get(parent.Id) || []), parent]);
    for (const sibling of siblings) siblingsByParent.set(sibling.Remittance__c, [...(siblingsByParent.get(sibling.Remittance__c) || []), sibling]);
  }
  return payments.map((payment) => {
    if (!candidates.includes(payment)) return payment;
    const found = parentsById.get(payment.Remittance__c) || [];
    return resolveRemittanceBankEvidence(payment, {
      parent: found.length === 1 ? found[0] : null, siblings: siblingsByParent.get(payment.Remittance__c) || [],
      complete: complete && found.length === 1,
    }).payment;
  });
}

export async function loadXeroFinancialSnapshot(connection, cutoff, { env, fetchImpl, onResponse = () => {}, includePayments = false, requestGate, invoiceIds = [], paymentIds = [] }) {
  const where = encodeURIComponent(`Date>=DateTime(${cutoff.replaceAll('-', ',')})`);
  let callCount = 0;
  const observed = (event) => { callCount += 1; onResponse(event); };
  const options = { env, fetchImpl, onResponse: observed, requestGate };
  // Read the complete accounting-date scope, then fetch only historical records that
  // current payments actually reference. Unrelated history must not consume the scan limit.
  // All provider reads finish before any new saved reconciliation is persisted.
  const [invoices, creditNotes, contacts, payments] = await Promise.all([
    loadAllXeroPages(connection, `/Invoices?where=${where}`, 'Invoices', options),
    loadAllXeroPages(connection, `/CreditNotes?where=${where}`, 'CreditNotes', options),
    loadAllXeroPages(connection, '/Contacts', 'Contacts', options),
    includePayments ? loadAllXeroPages(connection, `/Payments?where=${where}`, 'Payments', options) : Promise.resolve(null),
  ]);
  const paymentReadSnapshot = includePayments ? await loadXeroPaymentEvidence(connection, cutoff, {
    ...options, invoices, payments, invoiceIds, paymentIds,
  }) : null;
  const organisations = await xeroAccountingFetch(connection, '/Organisations', {
    method: 'GET', ...options,
  }).then((response) => response.Organisations?.[0] || {});
  const documents = [
    ...invoices.map(normalizeXeroInvoice),
    ...creditNotes.map(normalizeXeroCreditNote),
  ];
  return {
    tenantId: connection.tenantId,
    cutoffDate: cutoff,
    contactsComplete: true,
    documents: documents.filter((row) => ACTIVE_XERO_STATUSES.has(row.status)),
    inactiveDocuments: documents.filter((row) => !ACTIVE_XERO_STATUSES.has(row.status)),
    contacts: contacts.map(normalizeXeroContact),
    organisation: {
      periodLockDate: dateOnly(organisations.PeriodLockDate),
      endOfYearLockDate: dateOnly(organisations.EndOfYearLockDate),
      baseCurrency: organisations.BaseCurrency || null,
    },
    callCount,
    paymentReadSnapshot,
    fingerprintBasis: {
      documents: documents.map((row) => ({ id: row.id, status: row.status, updated: row.updatedDateUTC, total: row.total, number: exactDocumentNumber(row) })),
      contacts: contacts.map((row) => ({ id: row.ContactID, name: row.Name, status: row.ContactStatus })),
      organisation: { periodLockDate: organisations.PeriodLockDate, endOfYearLockDate: organisations.EndOfYearLockDate, baseCurrency: organisations.BaseCurrency || null },
    },
  };
}

export function xeroPaymentEvidenceIds(payments = [], documentMappings = [], paymentMappings = []) {
  const sourceIds = new Set(payments.map((row) => row.Id));
  const supplierIds = new Set(payments.map((row) => row.Supplier_Invoice__c).filter(Boolean));
  const stems = new Set(payments.map((row) => row.STEM__c).filter(Boolean));
  const existing = paymentMappings.filter((row) => sourceIds.has(row.salesforce_payment_id));
  const mappedDocumentIds = new Set(existing.map((row) => row.document_mapping_id));
  return {
    invoiceIds: uniqueStrings(documentMappings.filter((row) => mappedDocumentIds.has(row.id)
      || (row.salesforce_object === 'Supplier_Invoice__c' && supplierIds.has(row.salesforce_id))
      || (row.salesforce_object === 'Invoice__c' && stems.has(row.retained_differences?.stemId || row.stem_id)))
      .map((row) => row.xero_document_id)),
    paymentIds: uniqueStrings(existing.map((row) => row.xero_payment_id)),
  };
}

export async function loadXeroPaymentEvidence(connection, cutoff, {
  env, fetchImpl, onResponse = () => {}, requestGate, invoices = null, payments = null, invoiceIds = [], paymentIds = [],
}) {
  const options = { env, fetchImpl, onResponse, requestGate };
  const where = encodeURIComponent(`Date>=DateTime(${cutoff.replaceAll('-', ',')})`);
  const [scopedInvoices, scopedPayments] = await Promise.all([
    invoices || loadAllXeroPages(connection, `/Invoices?where=${where}`, 'Invoices', options),
    payments || loadAllXeroPages(connection, `/Payments?where=${where}`, 'Payments', options),
  ]);
  const paymentById = new Map(scopedPayments.map((row) => [row.PaymentID, row]));
  // A previously linked payment may have moved outside the date scope. Re-read it
  // explicitly so its changed date/amount is still classified as a conflict.
  for (const id of uniqueStrings(paymentIds).filter((id) => !paymentById.has(id))) {
    try {
      const response = await xeroAccountingFetch(connection, `/Payments/${encodeURIComponent(id)}`, { method: 'GET', ...options });
      if (!Array.isArray(response.Payments)) throw financialError('Xero payment evidence was incomplete.', 502, 'XERO_FINANCIAL_XERO_INCOMPLETE');
      if (response.Payments.some((row) => row.PaymentID !== id)) throw financialError('Xero returned mismatched payment evidence.', 502, 'XERO_FINANCIAL_XERO_INCOMPLETE');
      for (const row of response.Payments) paymentById.set(id, row);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  const invoiceById = new Map(scopedInvoices.map((row) => [row.InvoiceID, row]));
  const requiredIds = uniqueStrings([...invoiceIds, ...[...paymentById.values()].map((row) => row.Invoice?.InvoiceID)]);
  // Keep encoded UUID lists below the provider's query-string size limit.
  for (const batch of chunks(requiredIds.filter((id) => !invoiceById.has(id)), 50)) {
    const historical = await loadAllXeroPages(connection, `/Invoices?IDs=${encodeURIComponent(batch.join(','))}`, 'Invoices', options);
    if (historical.some((row) => !batch.includes(row.InvoiceID))) throw financialError('Xero returned mismatched invoice evidence.', 502, 'XERO_FINANCIAL_XERO_INCOMPLETE');
    for (const row of historical) invoiceById.set(row.InvoiceID, row);
  }
  return { invoices: [...invoiceById.values()], payments: [...paymentById.values()] };
}

export async function allFinancialRows(client, table, configure = (query) => query) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const result = await configure(client.from(table).select('*')).order('id').range(offset, offset + 499);
    if (result.error) throw storageError(result.error, table);
    rows.push(...(result.data || []));
    if ((result.data || []).length < 500) return { data: rows };
  }
}

async function loadStoredFinancialControls(client) {
  const [productMappings, documentMappings, bankMappings] = await Promise.all([
    allFinancialRows(client, 'xero_financial_product_mappings', (query) => query.eq('enabled', true)),
    allFinancialRows(client, 'xero_financial_document_mappings'),
    allFinancialRows(client, 'xero_financial_bank_mappings'),
  ]);
  if (productMappings.error) throw storageError(productMappings.error, 'xero_financial_product_mappings');
  if (documentMappings.error) throw storageError(documentMappings.error, 'xero_financial_document_mappings');
  if (bankMappings.error) throw storageError(bankMappings.error, 'xero_financial_bank_mappings');
  return {
    productMappings: productMappings.data || [],
    documentMappings: documentMappings.data || [],
    bankMappings: bankMappings.data || [],
  };
}

export function buildFinancialClassifications(salesforce, xero, stored, { postingMode = 'draft' } = {}) {
  normalizePostingMode(postingMode);
  const sourceContext = { ...(salesforce.safetyContext || {}), postingMode };
  const linesByBuyer = index([...salesforce.lines, ...salesforce.extras].filter((row) => row.Buyer_Invoice__c), (row) => row.Buyer_Invoice__c);
  const linesBySupplier = index([...salesforce.lines, ...salesforce.extras].filter((row) => row.Supplier_Invoice__c), (row) => row.Supplier_Invoice__c);
  const mappingByKey = new Map(stored.productMappings.map((row) => [`${row.direction}:${row.salesforce_product_id}`, row]));
  const storedBySource = new Map(stored.documentMappings.map((row) => [`${row.salesforce_object}:${row.salesforce_id}`, row]));
  const storedByXero = new Map(stored.documentMappings.map((row) => [`${row.xero_document_type}:${row.xero_document_id}`, row]));
  const contactIndex = buildXeroContactIndex(xero.contacts);
  const buyerSources = salesforce.buyers.map((invoice) => buildSalesforceDocument(invoice, 'buyer', linesByBuyer.get(invoice.Id) || [], mappingByKey, contactIndex, sourceContext));
  const supplierSources = salesforce.suppliers.map((invoice) => buildSalesforceDocument(invoice, 'supplier', linesBySupplier.get(invoice.Id) || [], mappingByKey, contactIndex, sourceContext));
  const allSources = [...buyerSources, ...supplierSources];
  const groupedContext = buildGroupedPreservationContext(salesforce, xero, stored, allSources);
  const accountsByContact = index(allSources.filter((source) => source.contactId && source.accountId), (source) => source.contactId);
  for (const source of allSources) {
    source.sharedContactAccounts = [...new Map((accountsByContact.get(source.contactId) || []).map((row) => [row.accountId,
      { accountId: row.accountId, accountName: row.accountName, companyCode: row.companyCode }])).values()].sort((a, b) => a.accountId.localeCompare(b.accountId));
  }
  const rows = [];
  for (const source of buyerSources) {
    rows.push(mergeClassification(source, preventReusedXeroIdentity(source, classifyXeroFinancialDocument(
      source,
      xero.documents.filter((row) => row.type === source.xeroType),
      {
        storedMapping: storedBySource.get(`Invoice__c:${source.salesforceId}`) || stored.documentMappings.find((row) => hasGroupedPreservation(row)
          && row.salesforce_object === 'Invoice__c' && String(row.salesforce_id).slice(0, 15) === String(source.salesforceId).slice(0, 15)),
        organisation: xero.organisation,
        groupedContext,
        deletedCandidates: xero.inactiveDocuments.filter((row) => row.type === source.xeroType),
      },
    ), storedByXero)));
  }
  for (const source of supplierSources) {
    rows.push(mergeClassification(source, preventReusedXeroIdentity(source, classifyXeroFinancialDocument(
      source,
      xero.documents.filter((row) => row.type === source.xeroType),
      {
        storedMapping: storedBySource.get(`Supplier_Invoice__c:${source.salesforceId}`) || stored.documentMappings.find((row) => hasGroupedPreservation(row)
          && row.salesforce_object === 'Supplier_Invoice__c' && String(row.salesforce_id).slice(0, 15) === String(source.salesforceId).slice(0, 15)),
        organisation: xero.organisation,
        groupedContext,
        deletedCandidates: xero.inactiveDocuments.filter((row) => row.type === source.xeroType),
      },
    ), storedByXero)));
  }
  blockRepeatedFinancialTargets(rows, (row) => row.xero?.id && `${row.xeroType}:${row.xero.id}`, 'More than one Salesforce document matches this Xero transaction. Resolve the document identity before linking or syncing.',
    (row) => ({ stored_link: 3, document_number: 2, stem_reference: 1, date_amount: 0 }[row.matchEvidence?.basis] || 0));
  blockRepeatedFinancialTargets(rows, (row) => row.documentNumber && `${row.xeroType}:${row.xeroType.startsWith('ACCPAY') ? row.contactId : ''}:${row.documentNumber}`,
    'More than one Salesforce document uses this invoice identity. Resolve the duplicate source documents before syncing.');
  return { rows, summary: summarizeClassifications(rows), controlTotals: financialControlTotals(rows) };
}

export function blockRepeatedFinancialTargets(rows, targetKey, reason, priority = () => 0) {
  const targets = index(rows.filter((row) => targetKey(row)), targetKey);
  for (const matches of targets.values()) {
    if (matches.length < 2) continue;
    const highest = Math.max(...matches.map(priority));
    const strongest = matches.filter((row) => priority(row) === highest);
    const retained = highest > 0 && strongest.length === 1 ? strongest[0] : null;
    for (const row of matches.filter((row) => row !== retained)) { row.status = 'blocked'; row.action = 'blocked'; row.proposedPayload = null; row.blockers = uniqueStrings([...(row.blockers || []), reason]); }
  }
}

export function deriveXeroProductMappingProposals(rows = []) {
  const evidenceByProduct = new Map();
  for (const row of rows) {
    if (!row?.xero?.lineItems?.length || !mappingProposalEvidenceAllowed(row)) continue;
    const pairs = legacyMappingEvidencePairs(row);
    if (!pairs.length) continue;
    const direction = row.salesforceObject === 'Invoice__c' ? 'buyer' : 'supplier';
    for (const { sourceLine, xeroLine, basis } of pairs) {
      const accountCode = String(xeroLine.AccountCode || '').trim();
      if (!sourceLine.productId || !accountCode) continue;
      const taxType = String(xeroLine.TaxType || 'NONE').trim().toUpperCase() || 'NONE';
      const key = `${direction}:${sourceLine.productId}`;
      const evidence = evidenceByProduct.get(key) || {
        direction,
        salesforceProductId: sourceLine.productId,
        salesforceProductName: sourceLine.productName,
        signatures: new Map(),
      };
      const signatureKey = `${accountCode}:${taxType}`;
      const signature = evidence.signatures.get(signatureKey) || {
        xeroAccountCode: accountCode,
        xeroTaxType: taxType,
        sampleCount: 0,
        documentIds: new Set(),
        evidenceBases: new Set(),
      };
      signature.sampleCount += 1;
      if (row.xero.id) signature.documentIds.add(row.xero.id);
      signature.evidenceBases.add(basis);
      evidence.signatures.set(signatureKey, signature);
      evidenceByProduct.set(key, evidence);
    }
  }

  return [...evidenceByProduct.values()].map((evidence) => {
    const alternatives = [...evidence.signatures.values()]
      .map((signature) => ({
        xeroAccountCode: signature.xeroAccountCode,
        xeroTaxType: signature.xeroTaxType,
        sampleCount: signature.sampleCount,
        documentCount: signature.documentIds.size,
        evidenceBasis: signature.evidenceBases.size === 1 ? [...signature.evidenceBases][0] : 'mixed',
      }))
      .sort((left, right) => right.sampleCount - left.sampleCount
        || left.xeroAccountCode.localeCompare(right.xeroAccountCode)
        || left.xeroTaxType.localeCompare(right.xeroTaxType));
    const proposal = alternatives.length === 1 ? alternatives[0] : null;
    return {
      direction: evidence.direction,
      salesforceProductId: evidence.salesforceProductId,
      salesforceProductName: evidence.salesforceProductName,
      status: proposal ? 'proposed' : 'conflict',
      xeroAccountCode: proposal?.xeroAccountCode || null,
      xeroTaxType: proposal?.xeroTaxType || null,
      evidenceBasis: proposal?.evidenceBasis || null,
      sampleCount: alternatives.reduce((sum, item) => sum + item.sampleCount, 0),
      documentCount: alternatives.reduce((sum, item) => sum + item.documentCount, 0),
      alternatives,
    };
  }).sort((left, right) => left.direction.localeCompare(right.direction)
    || left.salesforceProductName.localeCompare(right.salesforceProductName)
    || left.salesforceProductId.localeCompare(right.salesforceProductId));
}

function mappingProposalEvidenceAllowed(row) {
  const blockers = row.blockers || [];
  return blockers.every((blocker) => /: Finance-approved Xero account mapping is missing\.$/.test(String(blocker)));
}

function legacyMappingEvidencePairs(row) {
  const sourceLines = row.lines || [];
  const xeroLines = row.xero?.lineItems || [];
  const exactPairs = exactLegacyLinePairs(sourceLines, xeroLines);
  if (exactPairs.length) return exactPairs.map((pair) => ({ ...pair, basis: 'exact_line' }));
  if (!sourceLines.length || !xeroLines.length || !sameMoney(row.total, row.xero?.total)) return [];
  const signatures = new Map();
  for (const xeroLine of xeroLines) {
    const accountCode = String(xeroLine.AccountCode || '').trim();
    if (!accountCode) return [];
    const taxType = String(xeroLine.TaxType || 'NONE').trim().toUpperCase() || 'NONE';
    signatures.set(`${accountCode}:${taxType}`, { ...xeroLine, AccountCode: accountCode, TaxType: taxType });
  }
  if (signatures.size !== 1 || sourceLines.some((line) => !line.productId || !Number.isFinite(sourceAccountingLineAmount(line)))) return [];
  const [uniformXeroLine] = signatures.values();
  return sourceLines.map((sourceLine) => ({ sourceLine, xeroLine: uniformXeroLine, basis: 'uniform_document' }));
}

function exactLegacyLinePairs(sourceLines, xeroLines) {
  if (!sourceLines.length || sourceLines.length !== xeroLines.length) return [];
  const available = new Set(xeroLines.map((_line, index) => index));
  const pairs = [];
  for (const sourceLine of sourceLines) {
    const candidates = [...available].filter((index) => exactLegacyLineMatch(
      sourceLine,
      xeroLines[index],
      sourceLines.length === 1,
    ));
    if (candidates.length !== 1) return [];
    const [index] = candidates;
    available.delete(index);
    pairs.push({ sourceLine, xeroLine: xeroLines[index] });
  }
  return available.size ? [] : pairs;
}

function exactLegacyLineMatch(sourceLine, xeroLine, singleLineDocument) {
  const sourceAmount = sourceAccountingLineAmount(sourceLine);
  const xeroAmount = xeroLegacyLineAmount(xeroLine);
  if (!Number.isFinite(sourceAmount) || !Number.isFinite(xeroAmount) || !sameMoney(Math.abs(sourceAmount), Math.abs(xeroAmount))) return false;
  if (singleLineDocument) return true;
  const productName = normalizeName(sourceLine.productName);
  const sourceDescription = normalizeName(sourceLine.description);
  const xeroDescription = normalizeName(xeroLine.Description);
  if (!productName || !xeroDescription) return false;
  return xeroDescription.includes(productName)
    || productName.includes(xeroDescription)
    || (sourceDescription && (xeroDescription.includes(sourceDescription) || sourceDescription.includes(xeroDescription)));
}

function sourceAccountingLineAmount(line) {
  const explicit = Number(line?.lineAmount);
  if (Number.isFinite(explicit)) return explicit;
  const quantity = Number(line?.quantity);
  const unitAmount = Number(line?.unitAmount);
  return Number.isFinite(quantity) && Number.isFinite(unitAmount) ? quantity * unitAmount : Number.NaN;
}

function xeroLegacyLineAmount(line) {
  const explicit = Number(line?.LineAmount);
  if (Number.isFinite(explicit)) return explicit;
  const quantity = Number(line?.Quantity);
  const unitAmount = Number(line?.UnitAmount);
  return Number.isFinite(quantity) && Number.isFinite(unitAmount) ? quantity * unitAmount : Number.NaN;
}

function preventReusedXeroIdentity(source, classification, storedByXero) {
  if (!classification.xero?.id) return classification;
  const assigned = storedByXero.get(`${source.xeroType}:${classification.xero.id}`);
  if (!assigned || (assigned.salesforce_object === source.salesforceObject && (assigned.salesforce_id === source.salesforceId
    || (hasGroupedPreservation(assigned) && String(assigned.salesforce_id).slice(0, 15) === String(source.salesforceId).slice(0, 15))))) return classification;
  return {
    ...classification,
    action: 'blocked',
    status: 'blocked',
    blockers: ['This active Xero transaction is already linked to a different Salesforce document.'],
  };
}

function buildSalesforceDocument(record, direction, children, mappingByKey, contactIndex, context) {
  const buyer = direction === 'buyer';
  const signedTotal = Number(buyer ? record.Amount__c : record.Invoice_Amount__c);
  const credit = signedTotal < 0 || (buyer && /-CN-/i.test(record.Name || ''));
  const kind = buyer ? (credit ? 'buyer_credit' : 'buyer_invoice') : (credit ? 'supplier_credit' : 'supplier_bill');
  const xeroType = buyer ? (credit ? 'ACCRECCREDIT' : 'ACCREC') : (credit ? 'ACCPAYCREDIT' : 'ACCPAY');
  const accountId = buyer ? record.STEM__r?.Account__c : record.Supplier__c;
  const accountName = buyer ? record.STEM__r?.Account__r?.Name : record.Supplier__r?.Name;
  const companyCode = buyer ? record.STEM__r?.Account__r?.Company_Code__c : record.Supplier__r?.Company_Code__c;
  const contactMatches = resolveContact(contactIndex, accountName, companyCode);
  const currencyEvidence = financialSourceCurrency(record, children, context, buyer ? 'Invoice__c' : 'Supplier_Invoice__c');
  const readiness = documentReadiness(record, direction, children, context);
  const blockers = [...currencyEvidence.blockers];
  if (!record.Name) blockers.push('Salesforce document number is missing.');
  if (!validDate(record.Invoice_Date__c)) blockers.push('Salesforce invoice date is missing or invalid.');
  if (record.Invoice_Due_Date__c && !validDate(record.Invoice_Due_Date__c)) blockers.push('Salesforce due date is invalid.');
  if (!Number.isFinite(signedTotal) || Math.abs(signedTotal) <= 0.005) blockers.push('Salesforce document amount is missing or zero.');
  if (!accountId || !accountName) blockers.push('Exact Salesforce Account identity is missing.');
  if (contactMatches.length !== 1) blockers.push(contactMatches.length ? 'Salesforce Account matches multiple active Xero Contacts.' : 'No exact active Xero Contact matches the Salesforce Account name or CL Key.');
  const sortedChildren = [...children].sort((left, right) => {
    const leftName = left.Product__r?.Name || left.Product2Id__r?.Name || left.Name || '';
    const rightName = right.Product__r?.Name || right.Product2Id__r?.Name || right.Name || '';
    return leftName.localeCompare(rightName) || String(left.Id).localeCompare(String(right.Id));
  });
  const sourceLines = sortedChildren.map((child) => buildAccountingLine(child, direction, credit, mappingByKey));
  for (const sourceLine of sourceLines) blockers.push(...sourceLine.blockers);
  if (!sourceLines.length) blockers.push('No non-cancelled Salesforce product or extra-cost lines are linked to this document.');
  const lineTotal = roundMoney(sourceLines.reduce((sum, row) => sum + row.lineAmount, 0));
  if (Number.isFinite(signedTotal) && Math.abs(lineTotal - Math.abs(signedTotal)) > 0.01) {
    blockers.push(`Detailed Salesforce lines total ${lineTotal.toFixed(2)}, not document amount ${Math.abs(signedTotal).toFixed(2)}.`);
  }
  const contact = contactMatches.length === 1 ? contactMatches[0] : null;
  const source = {
    salesforceObject: buyer ? 'Invoice__c' : 'Supplier_Invoice__c',
    salesforceId: record.Id,
    documentNumber: String(record.Name || ''),
    documentKind: kind,
    xeroType,
    xeroCollection: credit ? 'CreditNotes' : 'Invoices',
    accountId,
    accountName,
    companyCode,
    contactId: contact?.id || null,
    contactName: contact?.name || null,
    stemId: record.STEM__c,
    stemName: record.STEM__r?.Name || record.STEM__r?.KeyStem__c || null,
    stemKey: record.STEM__r?.KeyStem__c || null,
    invoiceDate: validDate(record.Invoice_Date__c),
    dueDate: validDate(record.Invoice_Due_Date__c),
    deliveryDate: validDate(record.STEM__r?.Delivery_Date__c),
    currency: currencyEvidence.currency,
    postingMode: context.postingMode,
    readiness,
    signedTotal,
    total: Math.abs(signedTotal),
    reference: [record.STEM__r?.KeyStem__c || record.STEM__r?.Name, buyer ? 'Salesforce buyer invoice' : 'Salesforce supplier invoice'].filter(Boolean).join(' · '),
    lines: sourceLines.map(({ blockers: _blockers, lineAmount: _lineAmount, ...line }) => line),
    blockers: uniqueStrings(blockers),
    lastModifiedDate: record.LastModifiedDate,
  };
  source.sourceFingerprint = hashJson({ source: documentSourceFingerprint(record, children), postingMode: source.postingMode, currency: source.currency, readiness });
  source.financialFingerprint = hashJson(buildXeroAccountingPayload(source));
  source.groupedAccounting = groupedSourceAccounting(record, sortedChildren, direction, source, context);
  return source;
}

function documentSourceFingerprint(record, children) {
  // Unit_Buy_At is newly retrieved exclusively for grouped preservation. Keep
  // existing accepted document fingerprints byte-compatible; the complete raw
  // snapshot and grouped accounting proof separately bind this new evidence.
  const legacyChild = (child) => {
    if (!child.Product__c) return financialRecordFingerprint(child);
    const { Unit_Buy_At__c: _groupedBuyUnit, ...legacy } = child;
    return financialRecordFingerprint(legacy);
  };
  return hashJson({ record: financialRecordFingerprint(record), children: [...children].sort((left, right) => String(left.Id).localeCompare(String(right.Id))).map(legacyChild) });
}

function buildAccountingLine(row, direction, credit, mappingByKey) {
  const lineItem = Boolean(row.Product__c);
  const productId = row.Product__c || row.Product2Id__c;
  const productName = row.Product__r?.Name || row.Product2Id__r?.Name || row.Name || 'Unidentified Salesforce line';
  const mapping = mappingByKey.get(`${direction}:${productId}`);
  const rawTotal = direction === 'buyer'
    ? firstNumber(row.Total_Price__c, row.Line_Total__c)
    : firstNumber(row.Total_Cost__c, row.Line_Total_Buy__c);
  const quantity = firstPositiveNumber(row.Quantity_Delivered_Per_BDN__c, row.Quantity__c) || 1;
  const rawUnit = direction === 'buyer'
    ? firstNumber(row.Price_Per_Unit__c, row.Unit_Price__c, row.Lumpsum_Price__c)
    : firstNumber(row.Cost_Per_Unit__c, row.Unit_Cost__c, row.Lumpsum_Cost__c);
  const signedForDocument = Number(rawTotal || (Number(rawUnit || 0) * quantity));
  const normalizedAmount = credit ? Math.abs(signedForDocument) : signedForDocument;
  const lineAmount = Math.abs(normalizedAmount) <= 0.005 ? 0 : normalizedAmount;
  const blockers = [];
  if (!productId) blockers.push(`${productName}: Salesforce Product is missing.`);
  if (!mapping) blockers.push(`${productName}: Finance-approved Xero account mapping is missing.`);
  if (!Number.isFinite(lineAmount) || Math.abs(lineAmount) <= 0.005) blockers.push(`${productName}: line amount is missing or zero.`);
  const descriptionParts = [productName];
  const description = String(row.Description__c || '').trim();
  if (description && normalizeName(description) !== normalizeName(productName)) descriptionParts.push(description);
  if (row.Unit_of_Measure__c) descriptionParts.push(`${quantity} ${row.Unit_of_Measure__c}`);
  const unitAmount = quantity && Number.isFinite(rawUnit) && sameMoney(Number(rawUnit) * quantity, signedForDocument)
    ? roundUnit(credit ? Math.abs(Number(rawUnit)) : Number(rawUnit))
    : roundUnit(lineAmount);
  const xeroQuantity = quantity && Number.isFinite(rawUnit) && sameMoney(Number(rawUnit) * quantity, signedForDocument) ? quantity : 1;
  return {
    sourceId: row.Id,
    sourceType: lineItem ? 'STEM_Line_Item__c' : 'STEM_Extra_Cost__c',
    productId,
    productName,
    description: descriptionParts.join(' · ').slice(0, 4000),
    quantity: roundUnit(xeroQuantity),
    unitAmount,
    lineAmount: roundMoney(lineAmount),
    accountCode: mapping?.xero_account_code || '',
    taxType: mapping?.xero_tax_type || 'NONE',
    blockers,
  };
}

function mergeClassification(source, classification) {
  const blockers = uniqueStrings(classification.blockers || []);
  const writable = !blockers.length && classification.status === 'eligible' && ['create_draft', 'safe_update'].includes(classification.action);
  const readinessBlockers = source.readiness?.blockers || [];
  const blockerCodes = blockers.map((blocker) => readinessBlockers.includes(blocker) && /no (issued|verified issued) source file/.test(blocker) ? 'source_not_issued' : 'finance_exception');
  return { ...source, ...classification, blockers, blockerCodes,
    proposedPayload: writable ? buildXeroAccountingPayload(source,
      classification.action === 'safe_update' ? classification.xero?.id : null,
      classification.action === 'safe_update' ? classification.xero?.status : null,
      classification.action === 'safe_update' ? classification.xero : null) : null };
}

export async function loadAllXeroPages(connection, pathName, collection, { env, fetchImpl, onResponse, requestGate }) {
  const rows = [];
  const pageSize = 1000;
  const maxRows = 10_000;
  for (let page = 1; page <= maxRows / pageSize + 1; page += 1) {
    const separator = pathName.includes('?') ? '&' : '?';
    const response = await xeroAccountingFetch(connection, `${pathName}${separator}page=${page}&pageSize=${pageSize}`, {
      method: 'GET', env, fetchImpl, onResponse, requestGate,
    });
    if (!Array.isArray(response[collection])) throw financialError(`Xero ${collection} retrieval was incomplete.`, 502, 'XERO_FINANCIAL_XERO_INCOMPLETE');
    const pageRows = response[collection];
    rows.push(...pageRows);
    if (rows.length > maxRows) break;
    if (pageRows.length < pageSize) return rows;
  }
  throw financialError(`Xero ${collection} retrieval exceeded its complete-scan limit.`, 502, 'XERO_FINANCIAL_XERO_INCOMPLETE');
}

export function normalizeXeroInvoice(row) {
  return {
    id: row.InvoiceID,
    collection: 'Invoices',
    type: row.Type,
    status: String(row.Status || '').toUpperCase(),
    invoiceNumber: String(row.InvoiceNumber || ''),
    reference: String(row.Reference || ''),
    contactId: row.Contact?.ContactID,
    contactName: row.Contact?.Name,
    currency: row.CurrencyCode || null,
    date: dateOnly(row.Date),
    dueDate: dateOnly(row.DueDate),
    total: Math.abs(Number(row.Total || 0)),
    amountDue: Math.abs(Number(row.AmountDue ?? row.Total ?? 0)),
    amountPaid: Math.abs(Number(row.AmountPaid || 0)),
    amountCredited: Math.abs(Number(row.AmountCredited || 0)),
    lineItems: row.LineItems || [],
    unowned: unownedXeroMetadata(row),
    updatedDateUTC: row.UpdatedDateUTC,
    groupedAccounting: {
      complete: ['SubTotal', 'Total', 'TotalTax', 'LineAmountTypes', 'IsDiscounted', 'CurrencyRate', 'AmountDue', 'AmountPaid', 'AmountCredited'].every((key) => Object.hasOwn(row, key)) && Array.isArray(row.LineItems),
      subtotal: row.SubTotal, total: row.Total, totalTax: row.TotalTax, lineAmountTypes: row.LineAmountTypes,
      isDiscounted: row.IsDiscounted, currencyRate: row.CurrencyRate,
      amountDue: row.AmountDue, amountPaid: row.AmountPaid, amountCredited: row.AmountCredited,
    },
  };
}

function normalizeXeroCreditNote(row) {
  return {
    id: row.CreditNoteID,
    collection: 'CreditNotes',
    type: row.Type,
    status: String(row.Status || '').toUpperCase(),
    creditNoteNumber: String(row.CreditNoteNumber || ''),
    reference: String(row.Reference || ''),
    contactId: row.Contact?.ContactID,
    contactName: row.Contact?.Name,
    currency: row.CurrencyCode || null,
    date: dateOnly(row.Date),
    dueDate: dateOnly(row.DueDate),
    total: Math.abs(Number(row.Total || 0)),
    amountDue: Math.abs(Number(row.RemainingCredit ?? row.Total ?? 0)),
    amountPaid: Math.abs(Number(row.AmountPaid || 0)),
    amountCredited: Math.abs(Number(row.Total || 0) - Number(row.RemainingCredit ?? row.Total ?? 0)),
    lineItems: row.LineItems || [],
    unowned: unownedXeroMetadata(row),
    updatedDateUTC: row.UpdatedDateUTC,
  };
}

function normalizeXeroContact(row) {
  return { id: row.ContactID, name: row.Name || '', status: String(row.ContactStatus || '').toUpperCase(), accountNumber: row.AccountNumber || '', contactNumber: row.ContactNumber || '' };
}

function buildXeroContactIndex(contacts) {
  const map = new Map();
  for (const contact of contacts.filter((row) => row.status === 'ACTIVE')) {
    for (const value of [contact.name]) {
      const key = normalizeName(value);
      if (!key) continue;
      const rows = map.get(key) || [];
      rows.push(contact);
      map.set(key, rows);
    }
  }
  return map;
}

function resolveContact(contactIndex, accountName, companyCode) {
  const keys = uniqueStrings([normalizeName(accountName), hkStrippedClKeyNameMatchKey(companyCode)]).filter(Boolean);
  const matches = new Map();
  for (const key of keys) for (const contact of contactIndex.get(key) || []) matches.set(contact.id, contact);
  return [...matches.values()];
}

function exactStemEvidence(source, candidate) {
  const stem = source.stemKey || String(source.stemName || '').match(/\bHK\d+[A-Z]\b/i)?.[0] || source.stemName;
  if (!stem || !candidate.reference) return false;
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escape(normalizeName(stem))}([^A-Z0-9]|$)`, 'i').test(normalizeName(candidate.reference));
}

function supportingMatch(source, candidate) {
  if (candidate.type !== source.xeroType || !source.contactId || candidate.contactId !== source.contactId
    || candidate.currency !== source.currency || !sameMoney(candidate.total, source.total)) return false;
  const date = validDate(candidate.date);
  return Boolean(date && (date === validDate(source.invoiceDate) || date === validDate(source.deliveryDate))) || exactStemEvidence(source, candidate);
}

function documentIdentityProblems(source, candidate) {
  const issues = [];
  if (candidate.type !== source.xeroType) issues.push('Xero transaction type conflicts with Salesforce.');
  if (candidate.contactId !== source.contactId) issues.push('Xero Contact conflicts with the exact Salesforce Account.');
  if (candidate.currency !== source.currency) issues.push(`Xero currency ${candidate.currency} conflicts with Salesforce ${source.currency}.`);
  if (!sameMoney(candidate.total, source.total)) issues.push(`Xero total ${candidate.total.toFixed(2)} conflicts with Salesforce ${source.total.toFixed(2)}.`);
  return issues;
}

function compareDocument(source, candidate) {
  const differences = [];
  addDifference(differences, 'documentNumber', exactDocumentNumber(candidate), source.documentNumber);
  addDifference(differences, 'invoiceDate', candidate.date, source.invoiceDate);
  if (source.xeroCollection !== 'CreditNotes') addDifference(differences, 'dueDate', candidate.dueDate, source.dueDate || source.invoiceDate);
  addDifference(differences, 'reference', candidate.reference, source.reference);
  addDifference(differences, 'currency', candidate.currency, source.currency);
  if (!sameMoney(candidate.total, source.total)) differences.push({ field: 'total', xero: candidate.total, salesforce: source.total });
  const xeroLineSignature = comparableLines(candidate.lineItems, true);
  const sourceLineSignature = comparableLines(source.lines);
  if (hashJson(xeroLineSignature) !== hashJson(sourceLineSignature)) differences.push({ field: 'detailedLines', xero: xeroLineSignature, salesforce: sourceLineSignature });
  return differences;
}

async function finalizeLinkedItem(client, row, context = {}) {
  if (row.source_payload?.groupedPreservation) {
    const { current, run, tenantId, actor } = context;
    const review = current?.groupedPreservation;
    const proof = current?.groupedPreservationProof;
    const expectedReview = row.source_payload.groupedReviewFingerprint;
    if (row.proposed_action !== 'protected_legacy' || !review?.eligible || review.accepted || !proof
      || !expectedReview || expectedReview !== xeroReviewFingerprint(current)
      || proof.accounting?.tenantId !== tenantId) throw financialError('The grouped preservation proof changed or is already accepted. Refresh this reviewed link.', 409, 'XERO_GROUPED_PRESERVATION_STALE');
    const { data, error } = await client.rpc('link_xero_grouped_document_v1', {
      p_run_id: run.id, p_expected_run_revision: Number(run.revision), p_item_id: row.id,
      p_expected_item_updated_at: row.updated_at, p_tenant_id: tenantId,
      p_review: { policyVersion: review.policyVersion, fingerprint: review.fingerprint, evidenceFingerprint: review.evidenceFingerprint,
        reviewFingerprint: expectedReview, legacyReviewFingerprint: legacyReviewFingerprint(row.source_payload, row.xero_payload), evidence: proof,
        accountingCanonical: groupedPreservationCanonical({ policyVersion: proof.policyVersion, accounting: proof.accounting }),
        evidenceCanonical: groupedPreservationCanonical(proof) },
      p_actor_id: actor.id, p_actor_email: actor.email,
    });
    if (error) throw optimisticStorageError(error, 'Grouped invoice preservation');
    if (data?.id !== row.id || data?.status !== 'linked' || data?.xeroDocumentId !== row.xero_document_id) {
      throw financialError('The grouped preservation transaction did not confirm the exact reviewed invoice.', 409, 'XERO_GROUPED_PRESERVATION_UNCONFIRMED');
    }
    return data;
  }
  await upsertDocumentMapping(client, row, row.xero_payload, row.proposed_action === 'protected_legacy');
  const { error } = await client.from('xero_financial_sync_items').update({ status: 'linked', applied_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'selected');
  if (error) throw storageError(error, 'xero_financial_sync_items');
  return { id: row.id, status: 'linked', xeroDocumentId: row.xero_document_id };
}

async function finalizeDocumentOutcome(client, row, confirmation, actor) {
  const response = confirmation.response;
  if (definitiveDocumentRejection(row, confirmation)) {
    const errors = validationMessages(response);
    const { error } = await client.from('xero_financial_sync_items').update({
      status: 'failed', mutation_attempts: Number(row.mutation_attempts || 0) + 1,
      error_code: 'XERO_FINANCIAL_VALIDATION_REJECTED', error_message: errors.join('; '),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) throw storageError(error, 'xero_financial_sync_items');
    return { id: row.id, status: 'failed', errors, reviewRequired: true, definitivelyRejected: true };
  }
  const errors = [...confirmation.errors, ...documentConfirmationErrors(row, response),
    ...(Array.isArray(response.ValidationErrors) ? validationMessages(response) : [])];
  const xeroId = row.source_payload.xeroCollection === 'CreditNotes' ? response.CreditNoteID : response.InvoiceID;
  if (errors.length) {
    const { error } = await client.from('xero_financial_sync_items').update({
      status: 'failed', mutation_attempts: Number(row.mutation_attempts || 0) + 1,
      error_code: 'XERO_FINANCIAL_CONFIRMATION_UNCERTAIN', error_message: errors.join('; '), updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) throw storageError(error, 'xero_financial_sync_items');
    return { id: row.id, status: 'failed', errors, reviewRequired: true };
  }
  const normalized = row.source_payload.xeroCollection === 'CreditNotes' ? normalizeXeroCreditNote(response) : normalizeXeroInvoice(response);
  await upsertDocumentMapping(client, row, normalized, false);
  const status = row.proposed_action === 'create_draft' ? 'created' : 'updated';
  const { error } = await client.from('xero_financial_sync_items').update({
    status, xero_document_id: xeroId, xero_document_status: normalized.status,
    xero_payload: normalized, mutation_attempts: Number(row.mutation_attempts || 0) + 1,
    applied_at: new Date().toISOString(), updated_at: new Date().toISOString(), error_code: null, error_message: null,
  }).eq('id', row.id);
  if (error) throw storageError(error, 'xero_financial_sync_items');
  return { id: row.id, status, xeroDocumentId: xeroId, xeroStatus: normalized.status, actor: actor.email };
}

// summarizeErrors=false can return HTTP200 with rejected elements. Only an
// unambiguous, explicitly rejected element proves no write for this exact item.
// Missing/colliding responses, contradictory success evidence and newly assigned
// transaction IDs remain uncertain and retain the processing barrier.
function definitiveDocumentRejection(row, confirmation) {
  if (confirmation.errors?.length || !confirmation.response) return false;
  const response = confirmation.response;
  const source = row.source_payload || {};
  const credit = source.xeroCollection === 'CreditNotes';
  const idKey = credit ? 'CreditNoteID' : 'InvoiceID';
  const numberKey = credit ? 'CreditNoteNumber' : 'InvoiceNumber';
  const errors = response.ValidationErrors;
  const explicitFailure = response.HasErrors === true || response.HasValidationErrors === true || response.StatusAttributeString === 'ERROR';
  if (!explicitFailure || response.StatusAttributeString === 'OK' || response.HasErrors === false || response.HasValidationErrors === false
    || !Array.isArray(errors) || !errors.length || errors.some((error) => typeof error?.Message !== 'string' || !error.Message.trim())
    || response.Type !== source.xeroType || response.Contact?.ContactID !== source.contactId
    || response.CurrencyCode !== source.currency || response[numberKey] !== source.documentNumber || response.Status === 'PAID') return false;
  const expectedId = row.proposed_payload?.[idKey] || row.xero_document_id;
  if (row.proposed_action === 'safe_update') return Boolean(expectedId) && response[idKey] === expectedId;
  return row.proposed_action === 'create_draft' && (!response[idKey] || response[idKey] === '00000000-0000-0000-0000-000000000000');
}

function documentWriteConfirmations(rows, responses) {
  const strict = matchDocumentResponses(rows, responses);
  if (!Array.isArray(responses) || responses.length !== rows.length) return strict;
  const identity = (row, response) => {
    const source = row.source_payload || {};
    const numberKey = source.xeroCollection === 'CreditNotes' ? 'CreditNoteNumber' : 'InvoiceNumber';
    return response && response.Type === source.xeroType && response.Contact?.ContactID === source.contactId
      && response.CurrencyCode === source.currency && response[numberKey] === source.documentNumber;
  };
  // Several rejected creates legitimately have absent/zero IDs. Correlate ONLY
  // those proven rejections by unique submitted identity; successful responses
  // continue using the stricter existing transaction-ID correlation unchanged.
  return strict.map((confirmation, index) => {
    const row = rows[index];
    if (!confirmation.errors.length || row.proposed_action !== 'create_draft') return confirmation;
    const matches = responses.filter((response) => identity(row, response));
    if (matches.length !== 1 || rows.filter((candidate) => identity(candidate, matches[0])).length !== 1) return confirmation;
    const rejection = { response: matches[0], errors: [] };
    return definitiveDocumentRejection(row, rejection) ? rejection : confirmation;
  });
}

function documentMappingRow(row, xero, protectedLegacy) {
  const source = row.source_payload;
  return {
    salesforce_object: source.salesforceObject,
    salesforce_id: source.salesforceId,
    salesforce_document_number: source.documentNumber,
    document_kind: source.documentKind,
    xero_document_type: source.xeroType,
    xero_document_id: xero.id || row.xero_document_id,
    xero_document_number: exactDocumentNumber(xero) || source.documentNumber,
    xero_contact_id: xero.contactId || source.contactId,
    xero_status: xero.status || row.xero_document_status,
    source_fingerprint: source.sourceFingerprint,
    financial_fingerprint: source.financialFingerprint,
    protected_legacy: protectedLegacy,
    retained_differences: { differences: row.differences || [], stemId: source.stemId, accountId: source.accountId,
      reviewFingerprint: legacyReviewFingerprint(source, xero) },
    last_reconciled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function upsertDocumentMapping(client, row, xero, protectedLegacy) {
  const mapping = documentMappingRow(row, xero, protectedLegacy);
  const { error } = await client.from('xero_financial_document_mappings').upsert(mapping, { onConflict: 'salesforce_object,salesforce_id' });
  if (error) throw storageError(error, 'xero_financial_document_mappings');
}

export function toSyncItemRow(row, runId, rowIndex, now) {
  return {
    id: randomUUID(), run_id: runId, row_index: rowIndex,
    row_key: `${row.salesforceObject}:${row.salesforceId}`,
    source_object: row.salesforceObject, source_id: row.salesforceId,
    source_type: row.documentKind, source_document_number: row.documentNumber,
    currency: row.currency || '', source_total: row.total,
    proposed_action: row.action, status: row.status === 'protected' ? 'protected' : row.status,
    selected: false, blockers: row.blockers, warnings: row.warnings,
    source_payload: { ...stripClassification(row), ...(row.groupedPreservation ? { groupedReviewFingerprint: xeroReviewFingerprint(row) } : {}) },
    xero_payload: row.xero || {}, proposed_payload: row.proposedPayload || {}, differences: row.differences,
    xero_document_id: row.xero?.id || null, xero_document_status: row.xero?.status || null,
    idempotency_key: `${runId}:${row.salesforceObject}:${row.salesforceId}`,
    created_at: now, updated_at: now,
  };
}

function stripClassification(row) {
  const { action: _action, status: _status, xero: _xero, proposedPayload: _proposedPayload, differences: _differences, warnings: _warnings,
    groupedPreservationProof: _groupedPreservationProof, groupedAccounting: _groupedAccounting, ...source } = row;
  return source;
}

function financialControlTotals(rows) {
  const totals = {};
  for (const row of rows) {
    const key = `${row.documentKind}:${row.currency}`;
    totals[key] ||= { count: 0, amount: 0 };
    totals[key].count += 1;
    totals[key].amount = roundMoney(totals[key].amount + row.total);
  }
  return totals;
}

function summarizeClassifications(rows) {
  const summary = { total: rows.length, eligible: 0, protected: 0, blocked: 0, link: 0, safeUpdate: 0, createDraft: 0, paymentApply: 0, paymentLink: 0 };
  for (const row of rows) {
    if (row.status === 'eligible') summary.eligible += 1;
    if (row.action === 'protected_legacy') summary.protected += 1;
    if (row.status === 'blocked') summary.blocked += 1;
    if (row.action === 'link') summary.link += 1;
    if (row.action === 'safe_update') summary.safeUpdate += 1;
    if (row.action === 'create_draft') summary.createDraft += 1;
    if (row.action === 'payment_apply') summary.paymentApply += 1;
    if (row.action === 'payment_link') summary.paymentLink += 1;
  }
  return summary;
}

function summarizeOutcomes(rows) {
  const summary = { total: rows.length, linked: 0, updated: 0, created: 0, applied: 0, failed: 0 };
  for (const row of rows) if (Object.hasOwn(summary, row.status)) summary[row.status] += 1;
  return summary;
}

function serializeClassification(row) {
  return {
    salesforceObject: row.salesforceObject, salesforceId: row.salesforceId,
    documentNumber: row.documentNumber, documentKind: row.documentKind, stemId: row.stemId, dispute: row.dispute || null,
    postingMode: row.postingMode || 'draft', blockerCodes: row.blockerCodes || [],
    sourceFingerprint: row.sourceFingerprint, reviewFingerprint: xeroReviewFingerprint(row),
    mappingProducts: (row.lines || []).map((line) => ({ id: line.productId, name: line.productName })),
    accountId: row.accountId, matchEvidence: row.matchEvidence || null, reviewRequired: Boolean(row.reviewRequired), acceptedLegacy: Boolean(row.acceptedLegacy),
    ...(row.groupedPreservation ? { groupedPreservation: row.groupedPreservation } : {}),
    accountName: row.accountName, companyCode: row.companyCode, stemName: row.stemName,
    invoiceDate: row.invoiceDate, dueDate: row.dueDate, currency: row.currency, total: row.total,
    action: row.action, actionLabel: row.action === 'create_draft' && row.postingMode === 'authorised' ? 'Create authorised Xero document' : XERO_FINANCIAL_ACTION_LABELS[row.action] || row.action,
    status: row.status, blockers: row.blockers, warnings: row.warnings,
    differences: (row.differences || []).map((difference) => difference.field === 'detailedLines'
      ? { ...difference, xeroLineCount: difference.xero?.length || 0, salesforceLineCount: difference.salesforce?.length || 0 }
      : difference),
    xero: row.xero ? { id: row.xero.id, number: exactDocumentNumber(row.xero), status: row.xero.status, date: row.xero.date, total: row.xero.total, url: xeroDocumentUrl(row.xero) } : null,
  };
}

function serializeRun(row) {
  return {
    id: row.id, mode: row.mode, postingMode: reviewedPostingMode(row), status: row.status, cutoffDate: row.cutoff_date,
    revision: row.revision, createdAt: row.created_at, reviewedAt: row.reviewed_at,
    completedAt: row.completed_at, summary: row.classification_summary || {}, controlTotals: row.control_totals || {},
    rateLimit: row.rate_limit_snapshot || {}, errorCode: row.error_code, error: row.error_message,
  };
}

function serializeProductMapping(row) {
  return { id: row.id, direction: row.direction, salesforceProductId: row.salesforce_product_id, salesforceProductName: row.salesforce_product_name, xeroAccountCode: row.xero_account_code, xeroAccountName: row.xero_account_name, xeroTaxType: row.xero_tax_type, enabled: row.enabled, revision: row.revision, approvedAt: row.approved_at, approvedByEmail: row.approved_by_email };
}

function serializeBankMapping(row) {
  return { id: row.id, salesforceBankName: row.salesforce_bank_name, xeroBankAccountId: row.xero_bank_account_id, xeroBankAccountCode: row.xero_bank_account_code, xeroBankAccountName: row.xero_bank_account_name, enabled: row.enabled, revision: row.revision, approvedAt: row.approved_at, approvedByEmail: row.approved_by_email };
}

function blockedClassification(code, message) {
  return { action: 'blocked', status: 'blocked', blockers: [`${code}: ${message}`], warnings: [], xero: null, differences: [] };
}

function exactDocumentNumber(document) {
  return String(document?.invoiceNumber || document?.creditNoteNumber || document?.InvoiceNumber || document?.CreditNoteNumber || '');
}

function xeroDocumentUrl(document) {
  if (!document?.id) return null;
  if (document.collection === 'CreditNotes') return `https://go.xero.com/AccountsReceivable/ViewCreditNote.aspx?creditNoteID=${encodeURIComponent(document.id)}`;
  return document.type === 'ACCPAY'
    ? `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${encodeURIComponent(document.id)}`
    : `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(document.id)}`;
}

function addDifference(rows, field, xero, salesforce) {
  if (String(xero ?? '') !== String(salesforce ?? '')) rows.push({ field, xero: xero ?? null, salesforce: salesforce ?? null });
}

function financialRecordFingerprint(row) {
  // Every retrieved accounting field is material; Salesforce's edit timestamp alone is not.
  const { LastModifiedDate: _modified, attributes: _attributes, ...accountingFields } = row;
  return accountingFields;
}

function validationMessages(row) {
  return (row?.ValidationErrors || []).map((error) => error.Message).filter(Boolean);
}

function hashJson(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function index(rows, keyGetter) {
  const map = new Map();
  for (const row of rows) {
    const key = keyGetter(row);
    if (!key) continue;
    const values = map.get(key) || [];
    values.push(row);
    map.set(key, values);
  }
  return map;
}

function chunks(rows, size) {
  const output = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

function dateOnly(value) {
  if (!value) return null;
  const slash = String(value).match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
  if (slash) return new Date(Number(slash[1])).toISOString().slice(0, 10);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function validDate(value) {
  const text = String(value || '');
  const day = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (day) {
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
  }
  const normalized = dateOnly(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(normalized || '')) && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function sameMoney(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= 0.01;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function roundUnit(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
}

function firstNumber(...values) {
  for (const value of values) if (value != null && value !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function firstPositiveNumber(...values) {
  for (const value of values) if (Number(value) > 0) return Number(value);
  return null;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function actorFields(accessContext) {
  return { id: accessContext?.profile?.id || null, email: String(accessContext?.profile?.email || '').trim().toLowerCase() || null };
}

function assertScopes(connection, required, label) {
  const scopes = splitScopes(connection.scope || '');
  const missing = required.filter((scope) => !scopeAllowed(scopes, scope));
  if (missing.length) throw financialError(`${label} requires reconnecting Xero with: ${missing.join(', ')}`, 409, 'XERO_FINANCIAL_SCOPE_MISSING', { missing });
}

function scopeAllowed(scopes, required) {
  if (scopes.includes(required)) return true;
  if (required === 'accounting.payments.read') return scopes.includes('accounting.payments') || scopes.includes('accounting.transactions');
  if (required === 'accounting.payments') return scopes.includes('accounting.transactions');
  if (required === 'accounting.settings.read') return scopes.includes('accounting.settings');
  if (required === 'accounting.invoices') return scopes.includes('accounting.transactions');
  return false;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null));
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function financialWriteGateEnabled(env) {
  return String(env.FCOS_ENABLE_XERO_FINANCIAL_SYNC || '').toLowerCase() === 'true';
}

function batchDelayMs(env) {
  const perMinute = Math.min(45, Math.max(1, Number(env.XERO_FINANCIAL_CALLS_PER_MINUTE || DEFAULT_CALLS_PER_MINUTE)));
  return Math.ceil(60_000 / perMinute);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordAudit(client, { runId, eventType, outcome, actor, counts = {}, fingerprints = {}, rate = {}, errorCode = null }) {
  const { error } = await client.from('xero_financial_audit_events').insert({
    run_id: runId, event_type: eventType, outcome,
    actor_id: actor?.id || null, actor_email: actor?.email || null,
    record_counts: counts, fingerprints, rate_limit_snapshot: rate, error_code: errorCode,
  });
  if (error) throw storageError(error, 'xero_financial_audit_events');
}

function storageError(error, table) {
  return financialError(`Xero financial storage failed for ${table}: ${error?.message || 'Unknown storage error'}`, 500, 'XERO_FINANCIAL_STORAGE_FAILED');
}

function optimisticStorageError(error, label) {
  const stale = String(error?.code || error?.message || '').includes('40001');
  return financialError(stale ? `${label} changed after it was loaded. Refresh and review again.` : `${label} could not be saved: ${error?.message || 'Unknown storage error'}`, stale ? 409 : 500, stale ? 'XERO_FINANCIAL_STALE_WRITE' : 'XERO_FINANCIAL_STORAGE_FAILED');
}

function financialError(message, status = 400, code = 'XERO_FINANCIAL_REJECTED', details = null) {
  return Object.assign(xeroContactSyncError(message, status, code, status < 500), details ? { details } : {});
}
